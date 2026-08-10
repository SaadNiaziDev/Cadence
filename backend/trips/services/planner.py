"""Turns three place names and a cycle balance into a complete, ranked trip plan.

This is the only module that knows about all the others. It geocodes the waypoints, asks
the router for one or more routes, runs the HOS engine over each, positions the resulting
stops on the road, builds the daily log sheets, and ranks the alternatives by what a
driver actually cares about — when they arrive — rather than by distance.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from . import geo, geocoding, rules
from .geocoding import Place
from .hos_engine import (
    MINUTES_PER_DAY,
    MINUTES_PER_HOUR,
    CYCLE_LIMIT_MINUTES,
    DutyStatus,
    Leg,
    Segment,
    TripPlan,
    simulate,
)
from .log_builder import DailySheet, build_sheets
from .routing import Route, RoutingProvider, default_provider

logger = logging.getLogger(__name__)

#: How many distinct routes to ask the router for. OSRM returns fewer when no genuinely
#: different road exists, which is common on long interstate hauls.
ALTERNATIVES_REQUESTED = 3

#: Reverse geocoding is rate limited to roughly one call a second, so a plan with dozens
#: of status changes would take a minute to name every one. Beyond this budget the
#: offline nearest-city table is used instead, which is accurate enough for a remark.
_REVERSE_GEOCODE_BUDGET = 20

#: Statuses that represent an actual stop a driver makes, as opposed to driving or the
#: off-duty padding at either end of the trip.
_STOP_RULES = {
    rules.RULE_BREAK,
    rules.RULE_DRIVING_LIMIT,
    rules.RULE_DUTY_WINDOW,
    rules.RULE_RESTART,
    rules.RULE_FUEL,
    rules.RULE_PICKUP,
    rules.RULE_DROPOFF,
    rules.RULE_INSPECTION,
}


@dataclass(frozen=True)
class Stop:
    """A place the driver must stop, ready to be drawn on the map."""

    rule_id: str
    label: str
    start_minute: int
    duration_minutes: int
    miles_from_origin: float
    longitude: float
    latitude: float
    location: str


@dataclass
class PlannedRoute:
    """One route, simulated end to end."""

    index: int
    route: Route
    plan: TripPlan
    stops: list[Stop]
    sheets: list[DailySheet]
    geometry: list[tuple[float, float]]
    arrival_minute: int
    rest_count: int
    restart_count: int
    break_count: int
    fuel_count: int


@dataclass
class TripResult:
    """Everything the API returns for one planning request."""

    waypoints: list[Place]
    routes: list[PlannedRoute]
    start_datetime: datetime
    warnings: list[str] = field(default_factory=list)

    @property
    def selected(self) -> PlannedRoute:
        return self.routes[0]


class _LocationNamer:
    """Names positions along a route, staying inside the reverse-geocoding budget.

    Positions are rounded before lookup so that the many status changes that happen at
    the same rest area collapse onto a single upstream call.
    """

    def __init__(self, budget: int = _REVERSE_GEOCODE_BUDGET):
        self._budget = budget
        self._seen: dict[tuple[float, float], str] = {}

    def name(self, longitude: float, latitude: float) -> str:
        key = (round(longitude, 2), round(latitude, 2))
        if key in self._seen:
            return self._seen[key]

        if self._budget > 0:
            self._budget -= 1
            label = geocoding.reverse(latitude, longitude)
        else:
            label = geocoding._nearest_fallback_city(latitude, longitude)

        self._seen[key] = label
        return label


def plan_trip(
    current_location: str,
    pickup_location: str,
    dropoff_location: str,
    cycle_used_hours: float,
    start_datetime: datetime,
    *,
    provider: RoutingProvider | None = None,
    alternatives: int = ALTERNATIVES_REQUESTED,
) -> TripResult:
    """Geocode, route, simulate and rank. Raises GeocodingError or RoutingError on failure."""
    router = provider or default_provider

    origin = geocoding.geocode(current_location)
    pickup = geocoding.geocode(pickup_location)
    dropoff = geocoding.geocode(dropoff_location)
    waypoints = [origin, pickup, dropoff]

    routes = router.route(waypoints, alternatives=alternatives)

    cycle_used_minutes = round(cycle_used_hours * MINUTES_PER_HOUR)
    start_minute = start_datetime.hour * MINUTES_PER_HOUR + start_datetime.minute
    start_date = start_datetime.date()

    planned = [
        _plan_one(index, route, cycle_used_minutes, start_minute, start_date)
        for index, route in enumerate(routes)
    ]
    planned.sort(key=_ranking_key)
    for position, entry in enumerate(planned):
        entry.index = position

    return TripResult(
        waypoints=waypoints,
        routes=planned,
        start_datetime=start_datetime,
        warnings=_warnings(planned, routes, cycle_used_minutes, waypoints),
    )


def _plan_one(
    index: int,
    route: Route,
    cycle_used_minutes: int,
    start_minute: int,
    start_date: date,
) -> PlannedRoute:
    """Simulate one route and dress the result with map positions and log sheets."""
    legs = _legs_for(route)
    plan = simulate(legs, cycle_used_minutes=cycle_used_minutes, start_minute=start_minute)

    cumulative = geo.cumulative_miles(route.geometry)
    # The polyline's great-circle length and the router's reported road distance differ
    # by a fraction of a percent. Scaling by the ratio keeps a stop's map position lined
    # up with the mileage the engine actually planned it at.
    polyline_miles = cumulative[-1] if cumulative else 0.0
    scale = polyline_miles / route.distance_miles if route.distance_miles > 0 else 1.0

    namer = _LocationNamer()

    def locate(miles_from_origin: float) -> str:
        longitude, latitude = geo.position_at_miles(route.geometry, cumulative, miles_from_origin * scale)
        return namer.name(longitude, latitude)

    stops = _extract_stops(plan.segments, route, cumulative, scale, locate)
    sheets = build_sheets(plan.segments, start_date, locate=locate)

    return PlannedRoute(
        index=index,
        route=route,
        plan=plan,
        stops=stops,
        sheets=sheets,
        geometry=geo.simplify(route.geometry),
        arrival_minute=plan.segments[-1].end_minute if plan.segments else start_minute,
        rest_count=sum(1 for s in plan.segments if s.rule_id in (rules.RULE_DRIVING_LIMIT, rules.RULE_DUTY_WINDOW)),
        restart_count=sum(1 for s in plan.segments if s.rule_id == rules.RULE_RESTART),
        break_count=sum(1 for s in plan.segments if s.rule_id == rules.RULE_BREAK),
        fuel_count=sum(1 for s in plan.segments if s.rule_id == rules.RULE_FUEL),
    )


def _legs_for(route: Route) -> list[Leg]:
    """Split a route into the legs the engine drives, inserting the pickup between them.

    A router asked for three waypoints reports two legs. If it reports anything else —
    the offline estimate, or a provider that collapses waypoints — the whole route is
    treated as a single leg so the trip still plans.
    """
    if len(route.legs) >= 2:
        return [
            Leg(leg.distance_miles, leg.duration_minutes, "Driving")
            for leg in route.legs
        ]
    return [
        Leg(0.0, 0, "Driving"),
        Leg(route.distance_miles, route.duration_minutes, "Driving"),
    ]


def _extract_stops(
    segments: list[Segment],
    route: Route,
    cumulative: list[float],
    scale: float,
    locate,
) -> list[Stop]:
    """Every non-driving segment that represents a real stop, placed on the road."""
    stops: list[Stop] = []
    for segment in segments:
        if segment.rule_id not in _STOP_RULES:
            continue
        longitude, latitude = geo.position_at_miles(route.geometry, cumulative, segment.start_miles * scale)
        stops.append(
            Stop(
                rule_id=segment.rule_id,
                label=segment.label,
                start_minute=segment.start_minute,
                duration_minutes=segment.duration_minutes,
                miles_from_origin=segment.start_miles,
                longitude=longitude,
                latitude=latitude,
                location=locate(segment.start_miles),
            )
        )
    return stops


def _ranking_key(entry: PlannedRoute) -> tuple:
    """Rank routes by what a driver feels, not by what a map measures.

    Arrival time comes first because Hours of Service is quantised: a route that is sixty
    miles longer can still arrive a full day earlier if it lets the driver finish a leg
    before the 14-hour window closes instead of parking for ten hours. Restarts and rests
    break the ties, and distance only matters when everything else is equal.
    """
    return (
        entry.arrival_minute,
        entry.restart_count,
        entry.rest_count,
        entry.plan.on_duty_minutes,
        entry.route.distance_miles,
    )


def _warnings(
    planned: list[PlannedRoute],
    raw_routes: list[Route],
    cycle_used_minutes: int,
    waypoints: list[Place],
) -> list[str]:
    """Things worth telling the driver before they read the plan."""
    messages: list[str] = []

    if any(route.source == "estimated" for route in raw_routes):
        messages.append(
            "The routing service was unavailable, so distances are straight-line estimates. "
            "The hours-of-service plan is still accurate for the distance shown."
        )

    if any(place.source == "fallback" for place in waypoints):
        messages.append("Some locations were matched from a built-in city list because the geocoder was unavailable.")

    if len(planned) == 1:
        messages.append("Only one sensible route exists between these locations, so there is nothing to compare.")

    if cycle_used_minutes >= CYCLE_LIMIT_MINUTES:
        messages.append("You have no cycle hours left, so this plan begins with a 34-hour restart.")
    elif cycle_used_minutes >= CYCLE_LIMIT_MINUTES - 2 * MINUTES_PER_HOUR:
        messages.append("You have under two hours left in your 70-hour cycle; a 34-hour restart happens almost immediately.")

    if planned and planned[0].restart_count:
        messages.append("This trip needs a 34-hour restart, which adds a day and a half to the schedule.")

    return messages


def to_payload(result: TripResult) -> dict:
    """Serialise a trip result for the API, in the shape the frontend consumes."""
    return {
        "startDateTime": result.start_datetime.isoformat(),
        "waypoints": [_place_payload(place) for place in result.waypoints],
        "selectedIndex": 0,
        "warnings": result.warnings,
        "routes": [_route_payload(entry, result.start_datetime) for entry in result.routes],
    }


def _place_payload(place: Place) -> dict:
    return {
        "label": place.label,
        "fullName": place.full_name,
        "longitude": place.longitude,
        "latitude": place.latitude,
        "source": place.source,
    }


def _route_payload(entry: PlannedRoute, start_datetime: datetime) -> dict:
    midnight = datetime.combine(start_datetime.date(), datetime.min.time())

    def at(minute: int) -> str:
        return (midnight + timedelta(minutes=minute)).isoformat()

    plan = entry.plan
    return {
        "index": entry.index,
        "source": entry.route.source,
        "distanceMiles": round(entry.route.distance_miles, 1),
        "durationMinutes": entry.route.duration_minutes,
        "geometry": [[round(lon, 5), round(lat, 5)] for lon, lat in entry.geometry],
        "summary": {
            "arrivalMinute": entry.arrival_minute,
            "arrivalAt": at(entry.arrival_minute),
            "elapsedMinutes": plan.total_minutes,
            "drivingMinutes": plan.driving_minutes,
            "onDutyMinutes": plan.on_duty_minutes,
            "dayCount": len(entry.sheets),
            "restCount": entry.rest_count,
            "restartCount": entry.restart_count,
            "breakCount": entry.break_count,
            "fuelCount": entry.fuel_count,
            "cycleUsedAtArrival": plan.segments[-1].clocks_after.cycle_used if plan.segments else 0,
        },
        "violations": plan.violations,
        "segments": [_segment_payload(segment, at) for segment in plan.segments],
        "stops": [_stop_payload(stop, at) for stop in entry.stops],
        "logs": [_sheet_payload(sheet) for sheet in entry.sheets],
    }


def _segment_payload(segment: Segment, at) -> dict:
    clocks = segment.clocks_after
    return {
        "status": segment.status.value,
        "startMinute": segment.start_minute,
        "endMinute": segment.end_minute,
        "durationMinutes": segment.duration_minutes,
        "startAt": at(segment.start_minute),
        "endAt": at(segment.end_minute),
        "startMiles": round(segment.start_miles, 2),
        "endMiles": round(segment.end_miles, 2),
        "ruleId": segment.rule_id,
        "label": segment.label,
        "clocksAfter": {
            "drivingUsed": clocks.driving_used,
            "drivingRemaining": clocks.driving_remaining,
            "windowUsed": clocks.window_used,
            "windowRemaining": clocks.window_remaining,
            "breakDrivingUsed": clocks.break_driving_used,
            "breakDrivingRemaining": clocks.break_driving_remaining,
            "cycleUsed": clocks.cycle_used,
            "cycleRemaining": clocks.cycle_remaining,
        },
    }


def _stop_payload(stop: Stop, at) -> dict:
    return {
        "ruleId": stop.rule_id,
        "label": stop.label,
        "startMinute": stop.start_minute,
        "startAt": at(stop.start_minute),
        "durationMinutes": stop.duration_minutes,
        "milesFromOrigin": round(stop.miles_from_origin, 1),
        "location": stop.location,
        "position": [round(stop.longitude, 5), round(stop.latitude, 5)],
    }


def _sheet_payload(sheet: DailySheet) -> dict:
    return {
        "dayIndex": sheet.day_index,
        "date": sheet.log_date.isoformat(),
        "totals": {status.value: sheet.totals.get(status, 0) for status in DutyStatus},
        "totalMinutes": sheet.total_minutes,
        "isComplete": sheet.is_complete,
        "drivingMiles": round(sheet.driving_miles, 1),
        "onDutyMinutes": sheet.on_duty_minutes,
        "cycleUsedMinutes": sheet.cycle_used_minutes,
        "entries": [
            {
                "status": entry.status.value,
                "startMinute": entry.start_minute,
                "endMinute": entry.end_minute,
                "durationMinutes": entry.duration_minutes,
                "ruleId": entry.rule_id,
                "label": entry.label,
                "miles": round(entry.miles, 1),
                "location": entry.location,
            }
            for entry in sheet.entries
        ],
    }


__all__ = ["MINUTES_PER_DAY", "PlannedRoute", "Stop", "TripResult", "plan_trip", "to_payload"]
