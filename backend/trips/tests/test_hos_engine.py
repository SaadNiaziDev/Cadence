from django.test import SimpleTestCase

from trips.services import rules
from trips.services.hos_engine import (
    BREAK_MINUTES,
    CYCLE_LIMIT_MINUTES,
    DAILY_RESET_MINUTES,
    DRIVING_BEFORE_BREAK_MINUTES,
    DRIVING_LIMIT_MINUTES,
    DUTY_WINDOW_MINUTES,
    INSPECTION_MINUTES,
    MINUTES_PER_DAY,
    RESTART_MINUTES,
    DutyStatus,
    HOSSimulator,
    Leg,
    simulate,
)


def leg(minutes: int, mph: float = 60.0, label: str = "Leg") -> Leg:
    """A leg of a given driving duration, at a speed that keeps the arithmetic obvious."""
    return Leg(distance_miles=minutes / 60.0 * mph, duration_minutes=minutes, label=label)


def rule_ids(plan, status: DutyStatus | None = None) -> list[str]:
    return [s.rule_id for s in plan.segments if status is None or s.status is status]


def segments_with(plan, rule_id: str) -> list:
    return [s for s in plan.segments if s.rule_id == rule_id]


class StructuralTests(SimpleTestCase):
    """Invariants that must hold for every plan the engine produces."""

    def setUp(self):
        self.plan = simulate([leg(300), leg(900)], cycle_used_minutes=0, start_minute=8 * 60)

    def test_segments_are_contiguous(self):
        for previous, current in zip(self.plan.segments, self.plan.segments[1:]):
            self.assertEqual(previous.end_minute, current.start_minute)

    def test_every_timestamp_is_a_whole_number_of_minutes(self):
        for segment in self.plan.segments:
            self.assertIsInstance(segment.start_minute, int)
            self.assertIsInstance(segment.end_minute, int)
            self.assertGreater(segment.duration_minutes, 0)

    def test_distance_only_accumulates_while_driving(self):
        for segment in self.plan.segments:
            if segment.status is not DutyStatus.DRIVING:
                self.assertAlmostEqual(segment.miles, 0.0)

    def test_plan_reports_no_violations(self):
        self.assertEqual(self.plan.violations, [])

    def test_trip_starts_with_a_pre_trip_inspection_and_ends_with_a_post_trip(self):
        self.assertEqual(self.plan.segments[0].rule_id, rules.RULE_INSPECTION)
        self.assertEqual(self.plan.segments[0].duration_minutes, INSPECTION_MINUTES)
        self.assertEqual(self.plan.segments[-1].rule_id, rules.RULE_INSPECTION)


class DutyWindowTests(SimpleTestCase):
    def test_pre_trip_inspection_opens_the_fourteen_hour_window(self):
        # The window must start at the first minute of *work*, not the first mile driven.
        plan = simulate([leg(0), leg(60)], cycle_used_minutes=0, start_minute=0)
        after_inspection = plan.segments[0].clocks_after
        self.assertEqual(after_inspection.window_used, INSPECTION_MINUTES)
        self.assertEqual(after_inspection.window_remaining, DUTY_WINDOW_MINUTES - INSPECTION_MINUTES)

    def test_driving_stops_when_the_window_closes_even_with_hours_left(self):
        # Six hours of driving, then a very long on-duty task, leaves plenty of the
        # 11-hour clock but almost none of the 14-hour window.
        simulator = HOSSimulator(start_minute=0, cycle_used_minutes=0)
        simulator.work(INSPECTION_MINUTES, rules.RULE_INSPECTION, "Pre-trip")
        simulator.drive_leg(leg(360))
        simulator.work(400, rules.RULE_PICKUP, "Very slow loading")
        simulator.drive_leg(leg(300))

        clocks = simulator.segments[-1].clocks_after
        self.assertLess(clocks.driving_used, DRIVING_LIMIT_MINUTES)
        rest = [s for s in simulator.segments if s.rule_id == rules.RULE_DUTY_WINDOW]
        self.assertTrue(rest, "expected a 10-hour rest triggered by the 14-hour window")
        self.assertEqual(rest[0].duration_minutes, DAILY_RESET_MINUTES)

    def test_on_duty_work_is_never_blocked_by_the_window(self):
        # 395.3(a)(2) prohibits driving after 14 hours, not working. The dropoff must
        # still run its full hour.
        simulator = HOSSimulator(start_minute=0, cycle_used_minutes=0)
        simulator.work(DUTY_WINDOW_MINUTES + 60, rules.RULE_PICKUP, "Marathon loading")
        simulator.work(60, rules.RULE_DROPOFF, "Unloading")
        self.assertEqual(simulator.segments[-1].duration_minutes, 60)


class DrivingLimitTests(SimpleTestCase):
    def test_driving_is_capped_at_eleven_hours_before_a_ten_hour_rest(self):
        plan = simulate([leg(0), leg(900)], cycle_used_minutes=0, start_minute=0)

        rests = segments_with(plan, rules.RULE_DRIVING_LIMIT)
        self.assertEqual(len(rests), 1)
        self.assertEqual(rests[0].duration_minutes, DAILY_RESET_MINUTES)

        driving_before_rest = sum(
            s.duration_minutes
            for s in plan.segments[: plan.segments.index(rests[0])]
            if s.status is DutyStatus.DRIVING
        )
        self.assertEqual(driving_before_rest, DRIVING_LIMIT_MINUTES)

    def test_ten_hour_rest_resets_the_driving_clock(self):
        plan = simulate([leg(0), leg(900)], cycle_used_minutes=0, start_minute=0)
        rest = segments_with(plan, rules.RULE_DRIVING_LIMIT)[0]
        self.assertEqual(rest.clocks_after.driving_used, 0)
        self.assertEqual(rest.clocks_after.window_used, 0)


class BreakRuleTests(SimpleTestCase):
    def test_break_is_inserted_after_eight_hours_of_driving(self):
        plan = simulate([leg(0), leg(600)], cycle_used_minutes=0, start_minute=0)
        breaks = segments_with(plan, rules.RULE_BREAK)
        self.assertEqual(len(breaks), 1)
        self.assertEqual(breaks[0].duration_minutes, BREAK_MINUTES)
        self.assertEqual(breaks[0].clocks_after.break_driving_used, 0)

    def test_a_one_hour_pickup_satisfies_the_break_rule(self):
        # The 2020 amendment lets on-duty-not-driving time count, so eight hours of
        # driving followed by an hour of loading needs no separate 30-minute break.
        plan = simulate([leg(DRIVING_BEFORE_BREAK_MINUTES), leg(120)], cycle_used_minutes=0, start_minute=0)
        self.assertEqual(segments_with(plan, rules.RULE_BREAK), [])

    def test_break_clock_is_actually_cleared_by_the_pickup(self):
        plan = simulate([leg(DRIVING_BEFORE_BREAK_MINUTES), leg(120)], cycle_used_minutes=0, start_minute=0)
        pickup = segments_with(plan, rules.RULE_PICKUP)[0]
        self.assertEqual(pickup.clocks_after.break_driving_used, 0)

    def test_break_is_still_inserted_when_driving_runs_past_eight_hours(self):
        # The contrast case: one minute more driving than the pickup can absorb.
        plan = simulate([leg(DRIVING_BEFORE_BREAK_MINUTES + 60), leg(60)], cycle_used_minutes=0, start_minute=0)
        self.assertEqual(len(segments_with(plan, rules.RULE_BREAK)), 1)

    def test_no_break_is_added_when_the_leg_ends_exactly_on_the_limit(self):
        # Arriving at the same minute a clock expires must not schedule a stop that the
        # driver would never actually take.
        plan = simulate([leg(0), leg(DRIVING_BEFORE_BREAK_MINUTES)], cycle_used_minutes=0, start_minute=0)
        self.assertEqual(segments_with(plan, rules.RULE_BREAK), [])


class FuelTests(SimpleTestCase):
    def test_fuel_stop_is_scheduled_within_a_thousand_miles(self):
        plan = simulate([leg(0), leg(1200)], cycle_used_minutes=0, start_minute=0)
        fuel_stops = segments_with(plan, rules.RULE_FUEL)
        self.assertTrue(fuel_stops)
        self.assertLessEqual(fuel_stops[0].start_miles, 1000.0 + 1e-6)

    def test_driver_never_covers_more_than_a_thousand_miles_between_fuel_stops(self):
        plan = simulate([leg(0), leg(3000)], cycle_used_minutes=0, start_minute=0)
        last_fuel_miles = 0.0
        for segment in plan.segments:
            if segment.rule_id == rules.RULE_FUEL:
                self.assertLessEqual(segment.start_miles - last_fuel_miles, 1000.0 + 1e-6)
                last_fuel_miles = segment.start_miles
        self.assertLessEqual(plan.total_miles - last_fuel_miles, 1000.0 + 1e-6)

    def test_a_thirty_minute_fuel_stop_also_satisfies_the_break_rule(self):
        plan = simulate([leg(0), leg(1200)], cycle_used_minutes=0, start_minute=0)
        fuel = segments_with(plan, rules.RULE_FUEL)[0]
        self.assertEqual(fuel.clocks_after.break_driving_used, 0)


class CycleTests(SimpleTestCase):
    def test_restart_is_inserted_when_the_seventy_hour_cycle_runs_out(self):
        plan = simulate([leg(0), leg(600)], cycle_used_minutes=68 * 60, start_minute=0)
        restarts = segments_with(plan, rules.RULE_RESTART)
        self.assertEqual(len(restarts), 1)
        self.assertEqual(restarts[0].duration_minutes, RESTART_MINUTES)
        self.assertEqual(restarts[0].clocks_after.cycle_used, 0)

    def test_a_driver_at_exactly_seventy_hours_restarts_before_driving_at_all(self):
        plan = simulate([leg(0), leg(300)], cycle_used_minutes=CYCLE_LIMIT_MINUTES, start_minute=0)
        first_drive = next(i for i, s in enumerate(plan.segments) if s.status is DutyStatus.DRIVING)
        first_restart = next(i for i, s in enumerate(plan.segments) if s.rule_id == rules.RULE_RESTART)
        self.assertLess(first_restart, first_drive)

    def test_on_duty_work_still_runs_when_the_cycle_is_exhausted(self):
        # The 70-hour rule bars driving, not working, so unloading is never truncated.
        simulator = HOSSimulator(start_minute=0, cycle_used_minutes=CYCLE_LIMIT_MINUTES)
        simulator.work(60, rules.RULE_DROPOFF, "Unloading")
        self.assertEqual(simulator.segments[-1].duration_minutes, 60)

    def test_hours_age_out_of_the_rolling_eight_day_window(self):
        simulator = HOSSimulator(start_minute=0, cycle_used_minutes=40 * 60)
        self.assertEqual(simulator.snapshot().cycle_used, 40 * 60)

        # Those hours sit on the day before the trip. On day seven they are still inside
        # the eight-day window; by day eight they have dropped off the back of it.
        simulator.now = 6 * MINUTES_PER_DAY
        self.assertEqual(simulator.snapshot().cycle_used, 40 * 60)
        simulator.now = 7 * MINUTES_PER_DAY
        self.assertEqual(simulator.snapshot().cycle_used, 0)

    def test_on_duty_minutes_are_attributed_to_the_day_they_fall_on(self):
        # A shift that runs through midnight must not put all of its hours on one day,
        # or the wrong hours age out of the cycle later.
        simulator = HOSSimulator(start_minute=MINUTES_PER_DAY - 60, cycle_used_minutes=0)
        simulator.work(120, rules.RULE_PICKUP, "Loading through midnight")
        self.assertEqual(simulator._on_duty_by_day[0], 60)
        self.assertEqual(simulator._on_duty_by_day[1], 60)


class EdgeCaseTests(SimpleTestCase):
    def test_zero_length_first_leg_still_produces_a_pickup(self):
        plan = simulate([leg(0), leg(120)], cycle_used_minutes=0, start_minute=0)
        self.assertEqual(len(segments_with(plan, rules.RULE_PICKUP)), 1)

    def test_short_trip_needs_no_stops_at_all(self):
        plan = simulate([leg(30), leg(30)], cycle_used_minutes=0, start_minute=8 * 60)
        self.assertEqual(segments_with(plan, rules.RULE_BREAK), [])
        self.assertEqual(segments_with(plan, rules.RULE_DRIVING_LIMIT), [])
        self.assertEqual(segments_with(plan, rules.RULE_FUEL), [])
        self.assertEqual(plan.driving_minutes, 60)

    def test_a_trip_with_no_distance_still_completes(self):
        plan = simulate([leg(0), leg(0)], cycle_used_minutes=0, start_minute=0)
        self.assertEqual(plan.driving_minutes, 0)
        self.assertEqual(plan.violations, [])


class ComplianceSweepTests(SimpleTestCase):
    """The property that actually matters: no plan the engine emits may be illegal."""

    def test_no_generated_plan_ever_breaks_a_clock(self):
        cases = [
            ([leg(0), leg(minutes)], cycle)
            for minutes in (15, 90, 480, 481, 660, 661, 900, 1500, 2640, 5000)
            for cycle in (0, 20 * 60, 60 * 60, 68 * 60, 70 * 60)
        ]
        for legs, cycle_used in cases:
            with self.subTest(minutes=legs[1].duration_minutes, cycle_used=cycle_used):
                plan = simulate(legs, cycle_used_minutes=cycle_used, start_minute=7 * 60)
                self.assertEqual(plan.violations, [])
                for previous, current in zip(plan.segments, plan.segments[1:]):
                    self.assertEqual(previous.end_minute, current.start_minute)

    def test_total_driving_matches_the_route_regardless_of_stops(self):
        plan = simulate([leg(200), leg(1400)], cycle_used_minutes=30 * 60, start_minute=6 * 60)
        self.assertEqual(plan.driving_minutes, 1600)


class InitialClockTests(SimpleTestCase):
    """The state before departure, which the gauges read at minute zero."""

    def test_initial_clocks_carry_the_cycle_hours_already_used(self):
        plan = simulate([leg(0), leg(120)], cycle_used_minutes=12 * 60, start_minute=8 * 60)
        assert plan.initial_clocks is not None
        self.assertEqual(plan.initial_clocks.cycle_used, 12 * 60)
        self.assertEqual(plan.initial_clocks.cycle_remaining, CYCLE_LIMIT_MINUTES - 12 * 60)

    def test_the_daily_clocks_start_empty(self):
        plan = simulate([leg(0), leg(120)], cycle_used_minutes=12 * 60, start_minute=8 * 60)
        assert plan.initial_clocks is not None
        self.assertEqual(plan.initial_clocks.driving_used, 0)
        self.assertEqual(plan.initial_clocks.window_used, 0)
        self.assertEqual(plan.initial_clocks.break_driving_used, 0)

    def test_a_fresh_driver_starts_with_the_whole_cycle(self):
        plan = simulate([leg(0), leg(120)], cycle_used_minutes=0, start_minute=0)
        assert plan.initial_clocks is not None
        self.assertEqual(plan.initial_clocks.cycle_remaining, CYCLE_LIMIT_MINUTES)


class NoNearlyThereExemptionTests(SimpleTestCase):
    """Part 395 has no allowance for finishing a trip on an expired clock.

    These exist because the tempting shortcut — "it is only a few more miles, let it
    finish" — is the one place a planner is most likely to quietly become non-compliant.
    """

    def test_the_rest_still_happens_one_minute_from_the_destination(self):
        # Driving one minute longer than the 11-hour limit allows.
        plan = simulate([leg(0), leg(DRIVING_LIMIT_MINUTES + 1)], cycle_used_minutes=0, start_minute=0)

        rests = segments_with(plan, rules.RULE_DRIVING_LIMIT)
        self.assertEqual(len(rests), 1)
        self.assertEqual(rests[0].duration_minutes, DAILY_RESET_MINUTES)
        self.assertEqual(plan.violations, [])

    def test_the_final_minute_is_driven_only_after_the_rest(self):
        plan = simulate([leg(0), leg(DRIVING_LIMIT_MINUTES + 1)], cycle_used_minutes=0, start_minute=0)

        rest_index = plan.segments.index(segments_with(plan, rules.RULE_DRIVING_LIMIT)[0])
        after_rest = [s for s in plan.segments[rest_index + 1 :] if s.status is DutyStatus.DRIVING]
        self.assertEqual(sum(s.duration_minutes for s in after_rest), 1)

    def test_no_driving_segment_ever_exceeds_a_clock_however_short_the_overrun(self):
        # One minute past each limit in turn: the engine must stop at every one.
        for minutes in (DRIVING_BEFORE_BREAK_MINUTES + 1, DRIVING_LIMIT_MINUTES + 1, DRIVING_LIMIT_MINUTES + 5):
            with self.subTest(minutes=minutes):
                plan = simulate([leg(0), leg(minutes)], cycle_used_minutes=0, start_minute=0)
                self.assertEqual(plan.violations, [])
                for segment in plan.segments:
                    if segment.status is DutyStatus.DRIVING:
                        self.assertLessEqual(segment.clocks_after.driving_used, DRIVING_LIMIT_MINUTES)
                        self.assertLessEqual(segment.clocks_after.break_driving_used, DRIVING_BEFORE_BREAK_MINUTES)
