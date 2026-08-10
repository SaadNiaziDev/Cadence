"""Turns a trip plan into one FMCSA daily log sheet per calendar day.

A paper log is a 24-hour grid, so every sheet must account for exactly 1,440 minutes —
no gaps, no overlap, and the four status totals adding up to 24:00 exactly. That is the
first thing a reviewer checks, and it is why the engine works in integer minutes: this
module only has to slice and bucket, never to round.

Times are kept in home-terminal local time for the whole trip, which is what 395.8(d)
prescribes for the log sheet, and which keeps midnight in one place rather than moving it
as the driver crosses time zones.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from typing import Callable, Sequence

from .hos_engine import MINUTES_PER_DAY, DutyStatus, Segment
from .rules import RULE_OFF_DUTY

#: Maps a distance along the route to a place name for the remarks column. The default
#: leaves remarks blank; the API supplies one that interpolates the route polyline and
#: reverse-geocodes the result.
LocationResolver = Callable[[float], str]


@dataclass(frozen=True)
class LogEntry:
    """One stretch of a single duty status, clipped to a single calendar day."""

    status: DutyStatus
    #: Minutes from midnight of this sheet's day, always within 0..1440.
    start_minute: int
    end_minute: int
    rule_id: str
    label: str
    #: Distance covered during this entry.
    miles: float
    #: Distance from the trip origin at the moment this entry begins, which is what the
    #: remarks column needs in order to name where the status change happened.
    start_miles: float = 0.0
    #: City and state where this status change happened, for the remarks row.
    location: str = ""

    @property
    def duration_minutes(self) -> int:
        return self.end_minute - self.start_minute


@dataclass
class DailySheet:
    """A single day's log, complete and self-consistent."""

    day_index: int
    log_date: date
    entries: list[LogEntry] = field(default_factory=list)
    totals: dict[DutyStatus, int] = field(default_factory=dict)
    driving_miles: float = 0.0
    #: On-duty minutes recorded on this sheet (driving plus on-duty not driving).
    on_duty_minutes: int = 0
    #: Running 8-day cycle total at the end of this day, for the recap box.
    cycle_used_minutes: int = 0

    @property
    def total_minutes(self) -> int:
        return sum(self.totals.values())

    @property
    def is_complete(self) -> bool:
        """Whether this sheet accounts for a full 24 hours, which it always must."""
        return self.total_minutes == MINUTES_PER_DAY


def build_sheets(
    segments: Sequence[Segment],
    start_date: date,
    locate: LocationResolver | None = None,
) -> list[DailySheet]:
    """Slice a plan's segments into one complete sheet per calendar day."""
    if not segments:
        return []

    resolve = locate or (lambda _miles: "")
    padded = _pad_to_whole_days(segments)

    last_minute = padded[-1][1]
    day_count = _day_of(last_minute - 1) + 1
    buckets: list[list[LogEntry]] = [[] for _ in range(day_count)]

    for start, end, status, rule_id, label, start_miles, end_miles in padded:
        for entry_day, entry in _split_across_midnights(start, end, status, rule_id, label, start_miles, end_miles):
            buckets[entry_day].append(entry)

    sheets: list[DailySheet] = []
    cycle_running = 0
    for day_index, entries in enumerate(buckets):
        # A remark records where a status change happened, so each entry is named by the
        # position at which it begins rather than where it ends.
        located = [replace(entry, location=resolve(entry.start_miles)) for entry in entries]
        sheets.append(_summarise(day_index, start_date + timedelta(days=day_index), located))

    for sheet in sheets:
        cycle_running += sheet.on_duty_minutes
        sheet.cycle_used_minutes = cycle_running

    return sheets


def _day_of(minute: int) -> int:
    return minute // MINUTES_PER_DAY


def _pad_to_whole_days(
    segments: Sequence[Segment],
) -> list[tuple[int, int, DutyStatus, str, str, float, float]]:
    """Extend the plan with off-duty time so it starts at 00:00 and ends at 24:00.

    A trip that begins at 08:00 still needs the preceding eight hours drawn on the sheet
    as off duty, and the final day has to run through to midnight. Without this the
    totals would be short and the grid would start and stop mid-line.
    """
    first_minute = segments[0].start_minute
    last_minute = segments[-1].end_minute

    padded: list[tuple[int, int, DutyStatus, str, str, float, float]] = []

    if first_minute > 0:
        padded.append((0, first_minute, DutyStatus.OFF_DUTY, RULE_OFF_DUTY, "Off duty", 0.0, 0.0))

    for segment in segments:
        padded.append(
            (
                segment.start_minute,
                segment.end_minute,
                segment.status,
                segment.rule_id,
                segment.label,
                segment.start_miles,
                segment.end_miles,
            )
        )

    end_of_last_day = (_day_of(last_minute - 1) + 1) * MINUTES_PER_DAY
    if last_minute < end_of_last_day:
        total_miles = segments[-1].end_miles
        padded.append(
            (last_minute, end_of_last_day, DutyStatus.OFF_DUTY, RULE_OFF_DUTY, "Off duty", total_miles, total_miles)
        )

    return padded


def _split_across_midnights(
    start: int,
    end: int,
    status: DutyStatus,
    rule_id: str,
    label: str,
    start_miles: float,
    end_miles: float,
):
    """Cut one stretch of duty at every midnight it crosses.

    The loop matters: a 34-hour restart spans two midnights, so splitting only once would
    leave more than 24 hours of activity sitting on a single sheet. Distance is prorated
    by time, which is exact because speed is constant within a segment.
    """
    total_minutes = end - start
    total_miles = end_miles - start_miles
    cursor = start

    while cursor < end:
        day = _day_of(cursor)
        next_midnight = (day + 1) * MINUTES_PER_DAY
        chunk_end = min(end, next_midnight)

        elapsed_share = (cursor - start) / total_minutes if total_minutes else 0.0
        chunk_share = (chunk_end - cursor) / total_minutes if total_minutes else 0.0

        yield day, LogEntry(
            status=status,
            start_minute=cursor - day * MINUTES_PER_DAY,
            end_minute=chunk_end - day * MINUTES_PER_DAY,
            rule_id=rule_id,
            label=label,
            miles=total_miles * chunk_share,
            start_miles=start_miles + total_miles * elapsed_share,
        )
        cursor = chunk_end


def _summarise(day_index: int, log_date: date, entries: list[LogEntry]) -> DailySheet:
    """Total a day's entries by status and compute its mileage."""
    totals = {status: 0 for status in DutyStatus}
    for entry in entries:
        totals[entry.status] += entry.duration_minutes

    driving_miles = sum(e.miles for e in entries if e.status is DutyStatus.DRIVING)
    on_duty = totals[DutyStatus.DRIVING] + totals[DutyStatus.ON_DUTY]

    return DailySheet(
        day_index=day_index,
        log_date=log_date,
        entries=entries,
        totals=totals,
        driving_miles=driving_miles,
        on_duty_minutes=on_duty,
    )
