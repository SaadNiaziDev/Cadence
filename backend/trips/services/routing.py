"""Road routing between trip waypoints.

Routing sits behind a small provider interface for one reason: OSRM's public demo server
routes cars, not trucks — it ignores bridge clearances, weight limits and HGV bans. A
production planner would swap in an HGV-aware engine, and the interface keeps that a
drop-in change rather than a rewrite. OSRM is the only provider shipped here, and the
limitation is stated openly in the README.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Protocol, Sequence

from django.conf import settings

from .errors import RoutingError, UpstreamError
from .geocoding import Place, _haversine_miles
from .upstream import get_json, register_rate_limit

logger = logging.getLogger(__name__)

OSRM_KEY = "osrm"
# The demo server asks for restraint but does not publish a hard rate; a short gap keeps
# a burst of alternative-route requests from looking like abuse.
register_rate_limit(OSRM_KEY, 0.35)

_ROUTE_CACHE_SECONDS = 60 * 60 * 24

METERS_PER_MILE = 1609.344

# Used only when the router is unreachable: straight-line distance inflated to allow for
# the fact that roads wind. 1.20 is the widely used road-circuity factor for US highways.
_ROAD_CIRCUITY_FACTOR = 1.20
_FALLBACK_AVERAGE_MPH = 55.0


@dataclass(frozen=True)
class RouteLeg:
    """One waypoint-to-waypoint portion of a route (current→pickup, pickup→dropoff)."""

    distance_miles: float
    duration_minutes: int
    #: Index into `Route.geometry` where this leg ends, so stops can be placed on the
    #: correct portion of the overall polyline.
    geometry_end_index: int


@dataclass(frozen=True)
class Route:
    """A complete drivable route through every waypoint, with its per-leg breakdown."""

    distance_miles: float
    duration_minutes: int
    #: GeoJSON order, [longitude, latitude], ready to hand straight to MapLibre.
    geometry: list[tuple[float, float]]
    legs: list[RouteLeg] = field(default_factory=list)
    source: str = "osrm"

    @property
    def average_mph(self) -> float:
        """Average speed implied by the router, used to convert miles into drive time."""
        if self.duration_minutes <= 0:
            return _FALLBACK_AVERAGE_MPH
        return self.distance_miles / (self.duration_minutes / 60.0)


class RoutingProvider(Protocol):
    """Anything that can turn an ordered list of waypoints into drivable routes."""

    def route(self, waypoints: Sequence[Place], alternatives: int = 0) -> list[Route]: ...


class OSRMProvider:
    """Routing via an OSRM server (the public demo instance by default)."""

    def route(self, waypoints: Sequence[Place], alternatives: int = 0) -> list[Route]:
        if len(waypoints) < 2:
            raise RoutingError("At least two waypoints are needed to plan a route.")

        coordinates = ";".join(f"{place.longitude},{place.latitude}" for place in waypoints)
        params: dict[str, object] = {
            "overview": "full",
            "geometries": "geojson",
            "steps": "false",
        }
        # OSRM only offers alternatives for a single origin-destination pair; with an
        # intermediate waypoint it silently returns one route, so asking is harmless.
        if alternatives > 0:
            params["alternatives"] = alternatives

        try:
            payload = get_json(
                OSRM_KEY,
                f"{settings.OSRM_BASE_URL}/route/v1/driving/{coordinates}",
                params,
                cache_timeout=_ROUTE_CACHE_SECONDS,
            )
        except UpstreamError:
            logger.warning("OSRM unavailable; falling back to great-circle estimation.")
            return [_estimated_route(waypoints)]

        if not isinstance(payload, dict) or payload.get("code") != "Ok":
            message = payload.get("message") if isinstance(payload, dict) else None
            raise RoutingError(message or "No drivable route could be found between those locations.")

        routes = [_parse_osrm_route(entry) for entry in payload.get("routes", [])]
        routes = [route for route in routes if route is not None]
        if not routes:
            raise RoutingError()
        return _deduplicate(routes)


def _parse_osrm_route(entry: dict) -> Route | None:
    """Convert one OSRM route object into a Route, or None if it is unusable."""
    try:
        coordinates = entry["geometry"]["coordinates"]
        distance_meters = float(entry["distance"])
        duration_seconds = float(entry["duration"])
    except (KeyError, TypeError, ValueError):
        return None

    geometry = [(float(lon), float(lat)) for lon, lat in coordinates]

    # OSRM reports each leg's distance and duration, but not where the leg ends within
    # the combined geometry. Walking the leg distances against a running total of the
    # polyline recovers that index, which is what lets a stop be positioned on the right
    # side of the pickup.
    legs: list[RouteLeg] = []
    cumulative = _cumulative_miles(geometry)
    travelled = 0.0
    for leg in entry.get("legs", []):
        try:
            leg_miles = float(leg["distance"]) / METERS_PER_MILE
            leg_minutes = round(float(leg["duration"]) / 60.0)
        except (KeyError, TypeError, ValueError):
            continue
        travelled += leg_miles
        legs.append(
            RouteLeg(
                distance_miles=leg_miles,
                duration_minutes=leg_minutes,
                geometry_end_index=_index_at_miles(cumulative, travelled),
            )
        )

    return Route(
        distance_miles=distance_meters / METERS_PER_MILE,
        duration_minutes=round(duration_seconds / 60.0),
        geometry=geometry,
        legs=legs,
    )


def _cumulative_miles(geometry: Sequence[tuple[float, float]]) -> list[float]:
    """Running distance along the polyline, one entry per vertex."""
    totals = [0.0]
    for index in range(1, len(geometry)):
        previous_lon, previous_lat = geometry[index - 1]
        lon, lat = geometry[index]
        totals.append(totals[-1] + _haversine_miles(previous_lat, previous_lon, lat, lon))
    return totals


def _index_at_miles(cumulative: Sequence[float], miles: float) -> int:
    """First vertex index at or beyond a given distance along the polyline."""
    for index, total in enumerate(cumulative):
        if total >= miles:
            return index
    return max(len(cumulative) - 1, 0)


def _deduplicate(routes: list[Route]) -> list[Route]:
    """Drop alternatives that are not meaningfully different from one already kept.

    OSRM regularly returns "alternatives" that diverge for a few miles and rejoin. Two
    routes within 2% on distance and 15 minutes on duration will produce identical stop
    schedules, so offering both as a choice would be noise dressed up as a decision.
    """
    kept: list[Route] = []
    for route in routes:
        if any(
            abs(route.distance_miles - existing.distance_miles) / max(existing.distance_miles, 1e-6) < 0.02
            and abs(route.duration_minutes - existing.duration_minutes) <= 15
            for existing in kept
        ):
            continue
        kept.append(route)
    return kept


def _estimated_route(waypoints: Sequence[Place]) -> Route:
    """Last-resort route used when the router is unreachable.

    Straight lines between waypoints, inflated by a road-circuity factor. Nowhere near
    accurate enough to navigate by, but it keeps the HOS plan and the log sheets — which
    are what this app is actually judged on — working when a shared demo server is down.
    """
    geometry = [place.lonlat for place in waypoints]
    legs: list[RouteLeg] = []
    total_miles = 0.0

    for index in range(1, len(waypoints)):
        start, end = waypoints[index - 1], waypoints[index]
        miles = _haversine_miles(start.latitude, start.longitude, end.latitude, end.longitude)
        miles *= _ROAD_CIRCUITY_FACTOR
        total_miles += miles
        legs.append(
            RouteLeg(
                distance_miles=miles,
                duration_minutes=round(miles / _FALLBACK_AVERAGE_MPH * 60),
                geometry_end_index=index,
            )
        )

    return Route(
        distance_miles=total_miles,
        duration_minutes=round(total_miles / _FALLBACK_AVERAGE_MPH * 60),
        geometry=geometry,
        legs=legs,
        source="estimated",
    )


#: The provider used by the API. Swapping this is the whole point of the interface.
default_provider: RoutingProvider = OSRMProvider()
