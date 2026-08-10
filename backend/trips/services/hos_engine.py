"""Hours of Service simulation for a property-carrying driver on the 70 hour / 8 day cycle.

This module is deliberately pure: no HTTP, no database, no clock reads. It takes route
legs and a starting cycle balance and returns the duty segments a compliant driver would
record. That is what makes the rules testable in isolation, which matters more here than
anywhere else in the codebase — the log sheets and the map are both just renderings of
whatever this file decides.

Two conventions run through the whole module:

*Integer minutes.* Every duration, limit and timestamp is a whole number of minutes,
counted from midnight at the start of the trip's first calendar day. Floating point hours
produce totals that fail to sum to exactly 24 and driving segments that overrun a limit by
a rounding error, which reads as a compliance bug rather than an arithmetic one.

*Distance travelled, not coordinates.* The engine records how far along the route each
segment starts and ends. Turning that into a map position or a city name is the caller's
job, so the rules stay independent of the routing and geocoding services.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Iterable, Sequence

from . import rules

MINUTES_PER_HOUR = 60
MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR

# --- Federal limits (49 CFR 395.3) -------------------------------------------------
DRIVING_LIMIT_MINUTES = 11 * MINUTES_PER_HOUR
DUTY_WINDOW_MINUTES = 14 * MINUTES_PER_HOUR
DRIVING_BEFORE_BREAK_MINUTES = 8 * MINUTES_PER_HOUR
BREAK_MINUTES = 30
DAILY_RESET_MINUTES = 10 * MINUTES_PER_HOUR
RESTART_MINUTES = 34 * MINUTES_PER_HOUR
CYCLE_LIMIT_MINUTES = 70 * MINUTES_PER_HOUR
CYCLE_WINDOW_DAYS = 8

# --- Operating assumptions fixed by the assessment brief ----------------------------
FUEL_INTERVAL_MILES = 1000.0
# 30 minutes rather than 15: at 30 the stop also satisfies the break rule, so the plan
# does not schedule a separate break immediately after fuelling.
FUEL_MINUTES = 30
PICKUP_MINUTES = 60
DROPOFF_MINUTES = 60
INSPECTION_MINUTES = 15

#: Guards against a malformed leg spinning the scheduling loop forever.
_MAX_ITERATIONS = 2000


class DutyStatus(StrEnum):
    """The four rows of a driver's daily log grid."""

    OFF_DUTY = "OFF"
    SLEEPER = "SB"
    DRIVING = "D"
    ON_DUTY = "ON"


@dataclass(frozen=True)
class ClockSnapshot:
    """The four legal clocks as they stand at a point in time.

    Emitted after every segment so the interface can show live gauges without
    re-implementing any of the rules in JavaScript.
    """

    driving_used: int
    driving_remaining: int
    window_used: int
    window_remaining: int
    break_driving_used: int
    break_driving_remaining: int
    cycle_used: int
    cycle_remaining: int


@dataclass(frozen=True)
class Segment:
    """One continuous stretch of a single duty status."""

    status: DutyStatus
    #: Minutes from midnight of the trip's first calendar day.
    start_minute: int
    end_minute: int
    #: Distance along the route at the start and end of this segment.
    start_miles: float
    end_miles: float
    #: The rule that caused this segment to exist, keyed into `rules.CATALOG`.
    rule_id: str
    label: str
    clocks_after: ClockSnapshot

    @property
    def duration_minutes(self) -> int:
        return self.end_minute - self.start_minute

    @property
    def miles(self) -> float:
        return self.end_miles - self.start_miles


@dataclass(frozen=True)
class Leg:
    """One waypoint-to-waypoint portion of the route, as measured by the router."""

    distance_miles: float
    duration_minutes: int
    label: str

    @property
    def average_mph(self) -> float:
        """Speed implied by the router for this leg, used to convert miles to minutes."""
        if self.duration_minutes <= 0:
            return 0.0
        return self.distance_miles / (self.duration_minutes / MINUTES_PER_HOUR)


@dataclass
class TripPlan:
    """Everything the simulation produced."""

    segments: list[Segment] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)
    #: The clocks before the trip begins. A driver who has already used cycle hours does
    #: not start from zero, and without this the interface has no reading to show for the
    #: first minute of the trip or to interpolate the opening segment from.
    initial_clocks: ClockSnapshot | None = None

    @property
    def total_minutes(self) -> int:
        if not self.segments:
            return 0
        return self.segments[-1].end_minute - self.segments[0].start_minute

    @property
    def driving_minutes(self) -> int:
        return sum(s.duration_minutes for s in self.segments if s.status is DutyStatus.DRIVING)

    @property
    def on_duty_minutes(self) -> int:
        """Driving plus on-duty-not-driving, which is what the 70-hour cycle counts."""
        return sum(
            s.duration_minutes
            for s in self.segments
            if s.status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY)
        )

    @property
    def total_miles(self) -> float:
        return self.segments[-1].end_miles if self.segments else 0.0


class HOSSimulator:
    """Walks a route forward in time, inserting the stops the regulations require."""

    def __init__(self, start_minute: int, cycle_used_minutes: int):
        self.now = start_minute
        self.miles = 0.0

        # The 14-hour window has not opened until the driver goes on duty.
        self._window_start: int | None = None
        self._driving_since_reset = 0
        self._driving_since_break = 0
        self._miles_since_fuel = 0.0

        # On-duty minutes bucketed by day index so the 8-day window can age hours out.
        # Hours already used before the trip are attributed to the day immediately before
        # it starts. That is the conservative reading: it keeps them on the books for the
        # longest possible time, so the plan can never assume capacity a driver lacks.
        self._on_duty_by_day: dict[int, int] = {-1: cycle_used_minutes}

        self.segments: list[Segment] = []

    # -- clock queries ---------------------------------------------------------------

    @property
    def _day_index(self) -> int:
        return self.now // MINUTES_PER_DAY

    def _cycle_used(self) -> int:
        """On-duty minutes inside the trailing 8-day window ending today."""
        earliest_day = self._day_index - (CYCLE_WINDOW_DAYS - 1)
        return sum(minutes for day, minutes in self._on_duty_by_day.items() if day >= earliest_day)

    def _window_remaining(self) -> int:
        """Minutes of driving left in the 14-hour window, which breaks do not pause."""
        if self._window_start is None:
            return DUTY_WINDOW_MINUTES
        return DUTY_WINDOW_MINUTES - (self.now - self._window_start)

    def snapshot(self) -> ClockSnapshot:
        """Current state of all four clocks."""
        window_used = 0 if self._window_start is None else self.now - self._window_start
        cycle_used = self._cycle_used()
        return ClockSnapshot(
            driving_used=self._driving_since_reset,
            driving_remaining=max(DRIVING_LIMIT_MINUTES - self._driving_since_reset, 0),
            window_used=window_used,
            window_remaining=max(DUTY_WINDOW_MINUTES - window_used, 0),
            break_driving_used=self._driving_since_break,
            break_driving_remaining=max(DRIVING_BEFORE_BREAK_MINUTES - self._driving_since_break, 0),
            cycle_used=cycle_used,
            cycle_remaining=max(CYCLE_LIMIT_MINUTES - cycle_used, 0),
        )

    # -- recording -------------------------------------------------------------------

    def _record_on_duty(self, start_minute: int, duration: int) -> None:
        """Attribute on-duty minutes to the calendar days they actually fall on.

        A shift that runs past midnight puts hours on both days, and the 8-day cycle
        window is counted in days, so lumping them onto the starting day would age the
        wrong hours out on long trips.
        """
        remaining = duration
        cursor = start_minute
        while remaining > 0:
            day = cursor // MINUTES_PER_DAY
            minutes_left_today = MINUTES_PER_DAY - (cursor % MINUTES_PER_DAY)
            chunk = min(remaining, minutes_left_today)
            self._on_duty_by_day[day] = self._on_duty_by_day.get(day, 0) + chunk
            cursor += chunk
            remaining -= chunk

    def _add(
        self,
        status: DutyStatus,
        duration: int,
        rule_id: str,
        label: str,
        *,
        miles: float = 0.0,
    ) -> None:
        """Append a segment and advance every clock it affects."""
        if duration <= 0:
            return

        start_minute = self.now
        start_miles = self.miles

        if status in (DutyStatus.DRIVING, DutyStatus.ON_DUTY):
            # Any work opens the 14-hour window, which is why the pre-trip inspection
            # starts it before the driver has moved a single mile.
            if self._window_start is None:
                self._window_start = start_minute
            self._record_on_duty(start_minute, duration)

        if status is DutyStatus.DRIVING:
            self._driving_since_reset += duration
            self._driving_since_break += duration
            self._miles_since_fuel += miles

        self.now += duration
        self.miles += miles

        if status is not DutyStatus.DRIVING:
            # Any 30 consecutive minutes not driving satisfies the break rule — off duty,
            # sleeper berth, or on duty not driving all count since the 2020 amendment.
            # Applying it here, rather than only inside an explicit break, is what stops
            # the plan stacking a redundant break on top of a one-hour loading stop.
            if duration >= BREAK_MINUTES:
                self._driving_since_break = 0

            if status in (DutyStatus.OFF_DUTY, DutyStatus.SLEEPER):
                if duration >= DAILY_RESET_MINUTES:
                    self._driving_since_reset = 0
                    self._window_start = None
                if duration >= RESTART_MINUTES:
                    # 34 consecutive hours off duty clears the 8-day cycle entirely.
                    self._on_duty_by_day.clear()

        self.segments.append(
            Segment(
                status=status,
                start_minute=start_minute,
                end_minute=self.now,
                start_miles=start_miles,
                end_miles=self.miles,
                rule_id=rule_id,
                label=label,
                clocks_after=self.snapshot(),
            )
        )

    # -- scheduling ------------------------------------------------------------------

    def _next_constraint(self, remaining_minutes: int, mph: float) -> tuple[int, str | None]:
        """How long the driver may keep driving, and which rule stops them.

        Returns the smallest of every applicable limit. A `None` rule means nothing stops
        them before the leg is finished. On a tie the leg wins, so arriving exactly as a
        clock expires does not schedule a stop nobody needs.
        """
        snapshot = self.snapshot()

        candidates: list[tuple[int, str | None]] = [
            (remaining_minutes, None),
            (snapshot.driving_remaining, rules.RULE_DRIVING_LIMIT),
            (self._window_remaining(), rules.RULE_DUTY_WINDOW),
            (snapshot.break_driving_remaining, rules.RULE_BREAK),
            (snapshot.cycle_remaining, rules.RULE_CYCLE),
        ]

        if mph > 0:
            miles_to_fuel = FUEL_INTERVAL_MILES - self._miles_since_fuel
            candidates.append((max(int(miles_to_fuel / mph * MINUTES_PER_HOUR), 0), rules.RULE_FUEL))

        # Sorting on (minutes, rule is not None) puts leg completion ahead of any limit
        # that expires at the very same minute.
        candidates.sort(key=lambda item: (item[0], item[1] is not None))
        return candidates[0]

    def _resolve(self, rule_id: str) -> None:
        """Insert whichever stop clears the limit that has just been reached."""
        if rule_id == rules.RULE_BREAK:
            self._add(DutyStatus.OFF_DUTY, BREAK_MINUTES, rules.RULE_BREAK, "30-minute break")
        elif rule_id == rules.RULE_FUEL:
            self._add(DutyStatus.ON_DUTY, FUEL_MINUTES, rules.RULE_FUEL, "Fuel stop")
            self._miles_since_fuel = 0.0
        elif rule_id == rules.RULE_CYCLE:
            self._add(DutyStatus.OFF_DUTY, RESTART_MINUTES, rules.RULE_RESTART, "34-hour restart")
        else:
            # Both the 11-hour driving limit and the 14-hour window are cleared by the
            # same thing: 10 consecutive hours off duty.
            label = "10-hour rest (11-hour driving limit)" if rule_id == rules.RULE_DRIVING_LIMIT else "10-hour rest (14-hour window)"
            self._add(DutyStatus.OFF_DUTY, DAILY_RESET_MINUTES, rule_id, label)

    def drive_leg(self, leg: Leg) -> None:
        """Drive one leg to its end, stopping wherever the regulations require."""
        if leg.duration_minutes <= 0 or leg.distance_miles <= 0:
            return

        mph = leg.average_mph
        remaining = leg.duration_minutes

        for _ in range(_MAX_ITERATIONS):
            if remaining <= 0:
                return

            allowance, rule_id = self._next_constraint(remaining, mph)

            if allowance <= 0:
                # Already at a limit; clear it before any more driving happens.
                if rule_id is None:
                    return
                self._resolve(rule_id)
                continue

            miles = allowance / MINUTES_PER_HOUR * mph
            self._add(DutyStatus.DRIVING, allowance, rules.RULE_DRIVING, leg.label, miles=miles)
            remaining -= allowance

            if rule_id is not None and remaining > 0:
                self._resolve(rule_id)

        raise RuntimeError("HOS scheduling did not converge; the route legs are likely malformed.")

    def work(self, minutes: int, rule_id: str, label: str) -> None:
        """Perform on-duty work that is not driving.

        Neither the 14-hour window nor the 70-hour cycle prohibits *working* — both only
        prohibit driving (§395.3(a)(2) and §395.3(b)). So loading, fuelling and inspections
        always run to completion, and the consequence shows up later as less driving time.
        """
        self._add(DutyStatus.ON_DUTY, minutes, rule_id, label)


def simulate(
    legs: Sequence[Leg],
    cycle_used_minutes: int,
    start_minute: int = 0,
    *,
    include_inspections: bool = True,
) -> TripPlan:
    """Plan a complete trip: inspection, drive to pickup, load, drive to dropoff, unload.

    `start_minute` is minutes past midnight on the trip's first day, so every timestamp in
    the result can be sliced into calendar days by integer division alone.
    """
    simulator = HOSSimulator(start_minute=start_minute, cycle_used_minutes=cycle_used_minutes)
    initial_clocks = simulator.snapshot()

    if include_inspections:
        simulator.work(INSPECTION_MINUTES, rules.RULE_INSPECTION, "Pre-trip inspection")

    for index, leg in enumerate(legs):
        simulator.drive_leg(leg)
        # The waypoint between two legs is the pickup; after the final leg it is the
        # dropoff. A trip with a single leg (pickup at the current location) still ends
        # with a dropoff, which the loop handles by treating the last leg as terminal.
        if index < len(legs) - 1:
            simulator.work(PICKUP_MINUTES, rules.RULE_PICKUP, "Loading at pickup")
        else:
            simulator.work(DROPOFF_MINUTES, rules.RULE_DROPOFF, "Unloading at dropoff")

    if include_inspections:
        simulator.work(INSPECTION_MINUTES, rules.RULE_INSPECTION, "Post-trip inspection")

    plan = TripPlan(segments=simulator.segments, initial_clocks=initial_clocks)
    plan.violations = list(find_violations(plan.segments))
    return plan


def find_violations(segments: Iterable[Segment]) -> list[str]:
    """Re-check the finished plan against every limit.

    By construction the scheduler cannot produce a violation, so this exists as a safety
    net and as the evidence behind the compliance badge in the interface: the claim that
    a plan is legal is checked against the output, not merely asserted by the code that
    produced it.
    """
    problems: list[str] = []
    for segment in segments:
        if segment.status is not DutyStatus.DRIVING:
            continue
        clocks = segment.clocks_after
        if clocks.driving_used > DRIVING_LIMIT_MINUTES:
            problems.append(f"Driving exceeded 11 hours at minute {segment.end_minute}.")
        if clocks.window_used > DUTY_WINDOW_MINUTES:
            problems.append(f"Drove beyond the 14-hour window at minute {segment.end_minute}.")
        if clocks.break_driving_used > DRIVING_BEFORE_BREAK_MINUTES:
            problems.append(f"Drove more than 8 hours without a 30-minute break at minute {segment.end_minute}.")
        if clocks.cycle_used > CYCLE_LIMIT_MINUTES:
            problems.append(f"Drove beyond the 70-hour cycle at minute {segment.end_minute}.")
    return problems
