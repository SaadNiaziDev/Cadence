from datetime import date

from django.test import SimpleTestCase

from trips.services import rules
from trips.services.hos_engine import (
    MINUTES_PER_DAY,
    RESTART_MINUTES,
    ClockSnapshot,
    DutyStatus,
    Leg,
    Segment,
    simulate,
)
from trips.services.log_builder import build_sheets

START_DATE = date(2026, 3, 9)
EMPTY_CLOCKS = ClockSnapshot(0, 0, 0, 0, 0, 0, 0, 0)


def segment(status, start, end, *, start_miles=0.0, end_miles=0.0, rule_id="driving", label="x"):
    return Segment(
        status=status,
        start_minute=start,
        end_minute=end,
        start_miles=start_miles,
        end_miles=end_miles,
        rule_id=rule_id,
        label=label,
        clocks_after=EMPTY_CLOCKS,
    )


def leg(minutes: int, mph: float = 60.0) -> Leg:
    return Leg(distance_miles=minutes / 60.0 * mph, duration_minutes=minutes, label="Leg")


class CompletenessTests(SimpleTestCase):
    def test_a_single_day_sheet_accounts_for_all_1440_minutes(self):
        segments = [segment(DutyStatus.ON_DUTY, 8 * 60, 9 * 60)]
        sheets = build_sheets(segments, START_DATE)

        self.assertEqual(len(sheets), 1)
        self.assertEqual(sheets[0].total_minutes, MINUTES_PER_DAY)
        self.assertTrue(sheets[0].is_complete)

    def test_time_before_the_trip_starts_is_drawn_as_off_duty(self):
        sheets = build_sheets([segment(DutyStatus.ON_DUTY, 8 * 60, 9 * 60)], START_DATE)
        first = sheets[0].entries[0]
        self.assertIs(first.status, DutyStatus.OFF_DUTY)
        self.assertEqual(first.start_minute, 0)
        self.assertEqual(first.end_minute, 8 * 60)

    def test_the_final_day_runs_through_to_midnight(self):
        sheets = build_sheets([segment(DutyStatus.ON_DUTY, 8 * 60, 9 * 60)], START_DATE)
        last = sheets[-1].entries[-1]
        self.assertIs(last.status, DutyStatus.OFF_DUTY)
        self.assertEqual(last.end_minute, MINUTES_PER_DAY)

    def test_entries_within_a_sheet_are_contiguous(self):
        sheets = build_sheets([segment(DutyStatus.DRIVING, 600, 900)], START_DATE)
        for previous, current in zip(sheets[0].entries, sheets[0].entries[1:]):
            self.assertEqual(previous.end_minute, current.start_minute)

    def test_dates_advance_one_day_per_sheet(self):
        segments = [segment(DutyStatus.DRIVING, 60, 3 * MINUTES_PER_DAY - 60)]
        sheets = build_sheets(segments, START_DATE)
        self.assertEqual([s.log_date for s in sheets], [date(2026, 3, 9), date(2026, 3, 10), date(2026, 3, 11)])


class MidnightSplitTests(SimpleTestCase):
    def test_a_segment_crossing_midnight_appears_on_both_sheets(self):
        # Driving 22:00 to 02:00 must be two entries, not one.
        segments = [segment(DutyStatus.DRIVING, 22 * 60, 26 * 60, end_miles=240.0)]
        sheets = build_sheets(segments, START_DATE)

        self.assertEqual(len(sheets), 2)
        first_driving = [e for e in sheets[0].entries if e.status is DutyStatus.DRIVING][0]
        second_driving = [e for e in sheets[1].entries if e.status is DutyStatus.DRIVING][0]

        self.assertEqual(first_driving.end_minute, MINUTES_PER_DAY)
        self.assertEqual(second_driving.start_minute, 0)
        self.assertEqual(second_driving.end_minute, 2 * 60)

    def test_status_is_continuous_across_the_midnight_boundary(self):
        segments = [segment(DutyStatus.DRIVING, 22 * 60, 26 * 60)]
        sheets = build_sheets(segments, START_DATE)
        self.assertIs(sheets[0].entries[-1].status, sheets[1].entries[0].status)

    def test_mileage_is_prorated_across_the_split(self):
        # Four hours of driving covering 240 miles, split evenly by midnight.
        segments = [segment(DutyStatus.DRIVING, 22 * 60, 26 * 60, end_miles=240.0)]
        sheets = build_sheets(segments, START_DATE)
        self.assertAlmostEqual(sheets[0].driving_miles, 120.0)
        self.assertAlmostEqual(sheets[1].driving_miles, 120.0)

    def test_a_34_hour_restart_spanning_two_midnights_leaves_every_sheet_complete(self):
        # The case a single split gets wrong: 34 hours started at 20:00 crosses midnight
        # twice, so it has to be cut into three pieces, not two.
        segments = [
            segment(DutyStatus.ON_DUTY, 19 * 60, 20 * 60, rule_id=rules.RULE_PICKUP),
            segment(DutyStatus.OFF_DUTY, 20 * 60, 20 * 60 + RESTART_MINUTES, rule_id=rules.RULE_RESTART),
            segment(DutyStatus.ON_DUTY, 20 * 60 + RESTART_MINUTES, 21 * 60 + RESTART_MINUTES, rule_id=rules.RULE_DROPOFF),
        ]
        sheets = build_sheets(segments, START_DATE)

        self.assertEqual(len(sheets), 3)
        for sheet in sheets:
            self.assertTrue(sheet.is_complete, f"day {sheet.day_index} totals {sheet.total_minutes} minutes")

        # The middle day is entirely consumed by the restart.
        self.assertEqual(sheets[1].totals[DutyStatus.OFF_DUTY], MINUTES_PER_DAY)

        restart_minutes = sum(
            entry.duration_minutes
            for sheet in sheets
            for entry in sheet.entries
            if entry.rule_id == rules.RULE_RESTART
        )
        self.assertEqual(restart_minutes, RESTART_MINUTES)


class RealPlanTests(SimpleTestCase):
    """The invariants applied to plans the engine actually produces."""

    def test_every_sheet_of_a_multi_day_trip_totals_exactly_24_hours(self):
        plan = simulate([leg(120), leg(2800)], cycle_used_minutes=0, start_minute=8 * 60)
        sheets = build_sheets(plan.segments, START_DATE)

        self.assertGreater(len(sheets), 3)
        for sheet in sheets:
            self.assertEqual(sheet.total_minutes, MINUTES_PER_DAY, f"day {sheet.day_index}")

    def test_daily_mileage_sums_to_the_trip_distance(self):
        plan = simulate([leg(120), leg(2800)], cycle_used_minutes=0, start_minute=8 * 60)
        sheets = build_sheets(plan.segments, START_DATE)
        self.assertAlmostEqual(sum(s.driving_miles for s in sheets), plan.total_miles, places=6)

    def test_daily_driving_totals_sum_to_the_plan_driving_time(self):
        plan = simulate([leg(120), leg(2800)], cycle_used_minutes=0, start_minute=8 * 60)
        sheets = build_sheets(plan.segments, START_DATE)
        driving = sum(s.totals[DutyStatus.DRIVING] for s in sheets)
        self.assertEqual(driving, plan.driving_minutes)

    def test_a_trip_needing_a_restart_still_produces_complete_sheets(self):
        plan = simulate([leg(0), leg(900)], cycle_used_minutes=69 * 60, start_minute=13 * 60)
        sheets = build_sheets(plan.segments, START_DATE)
        self.assertTrue(any(e.rule_id == rules.RULE_RESTART for s in sheets for e in s.entries))
        for sheet in sheets:
            self.assertEqual(sheet.total_minutes, MINUTES_PER_DAY, f"day {sheet.day_index}")

    def test_cycle_recap_accumulates_on_duty_time_across_days(self):
        plan = simulate([leg(120), leg(1500)], cycle_used_minutes=0, start_minute=8 * 60)
        sheets = build_sheets(plan.segments, START_DATE)
        self.assertEqual(sheets[-1].cycle_used_minutes, plan.on_duty_minutes)
        for previous, current in zip(sheets, sheets[1:]):
            self.assertGreaterEqual(current.cycle_used_minutes, previous.cycle_used_minutes)


class RemarksTests(SimpleTestCase):
    def test_each_entry_is_named_by_where_it_begins(self):
        segments = [
            segment(DutyStatus.DRIVING, 0, 120, start_miles=0.0, end_miles=120.0),
            segment(DutyStatus.ON_DUTY, 120, 180, start_miles=120.0, end_miles=120.0),
        ]
        sheets = build_sheets(segments, START_DATE, locate=lambda miles: f"mile {miles:.0f}")

        driving = [e for e in sheets[0].entries if e.status is DutyStatus.DRIVING][0]
        on_duty = [e for e in sheets[0].entries if e.status is DutyStatus.ON_DUTY][0]
        self.assertEqual(driving.location, "mile 0")
        self.assertEqual(on_duty.location, "mile 120")

    def test_split_entries_are_named_by_their_own_start_position(self):
        segments = [segment(DutyStatus.DRIVING, 22 * 60, 26 * 60, start_miles=0.0, end_miles=240.0)]
        sheets = build_sheets(segments, START_DATE, locate=lambda miles: f"mile {miles:.0f}")
        self.assertEqual(sheets[0].entries[-1].location, "mile 0")
        self.assertEqual(sheets[1].entries[0].location, "mile 120")
