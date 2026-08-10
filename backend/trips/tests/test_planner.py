from datetime import datetime
from unittest.mock import patch

from django.test import SimpleTestCase

from trips.services import planner, rules
from trips.services.geocoding import Place
from trips.services.routing import Route, RouteLeg

NEW_YORK = Place(label="New York, NY", latitude=40.7128, longitude=-74.0060)
NEWARK = Place(label="Newark, NJ", latitude=40.7357, longitude=-74.1724)
LOS_ANGELES = Place(label="Los Angeles, CA", latitude=34.0522, longitude=-118.2437)

START = datetime(2026, 3, 9, 8, 0)


def straight_geometry(steps: int = 200) -> list[tuple[float, float]]:
    """A simple west-bound line, enough for positions to interpolate along."""
    return [(-74.0 - (44.0 * i / steps), 40.7 - (6.6 * i / steps)) for i in range(steps + 1)]


def route(distance_miles: float, duration_minutes: int, *, source: str = "osrm") -> Route:
    geometry = straight_geometry()
    return Route(
        distance_miles=distance_miles,
        duration_minutes=duration_minutes,
        geometry=geometry,
        legs=[
            RouteLeg(distance_miles=10.0, duration_minutes=20, geometry_end_index=2),
            RouteLeg(distance_miles=distance_miles - 10.0, duration_minutes=duration_minutes - 20, geometry_end_index=len(geometry) - 1),
        ],
        source=source,
    )


class StubProvider:
    def __init__(self, routes):
        self.routes = routes
        self.requested_alternatives = None

    def route(self, waypoints, alternatives=0):
        self.requested_alternatives = alternatives
        return self.routes


def plan_with(routes, cycle_used_hours=0.0, **kwargs):
    """Plan a trip against stubbed geocoding and routing."""
    with patch("trips.services.planner.geocoding.geocode", side_effect=[NEW_YORK, NEWARK, LOS_ANGELES]), patch(
        "trips.services.planner.geocoding.reverse", return_value="Somewhere, US"
    ):
        return planner.plan_trip(
            "New York, NY",
            "Newark, NJ",
            "Los Angeles, CA",
            cycle_used_hours=cycle_used_hours,
            start_datetime=START,
            provider=StubProvider(routes),
            **kwargs,
        )


class PlanningTests(SimpleTestCase):
    def test_a_single_route_is_planned_end_to_end(self):
        result = plan_with([route(2794.0, 2988)])
        planned = result.selected

        self.assertEqual(planned.plan.violations, [])
        self.assertGreater(len(planned.sheets), 3)
        self.assertTrue(planned.stops)

    def test_stops_are_positioned_along_the_route(self):
        planned = plan_with([route(2794.0, 2988)]).selected
        longitudes = [stop.longitude for stop in planned.stops]

        # The route runs west, so stop longitudes must decrease and stay within it.
        self.assertEqual(longitudes, sorted(longitudes, reverse=True))
        self.assertLessEqual(max(longitudes), -74.0 + 1e-6)
        self.assertGreaterEqual(min(longitudes), -118.0 - 1.0)

    def test_pickup_and_dropoff_both_appear_as_stops(self):
        planned = plan_with([route(2794.0, 2988)]).selected
        rule_ids = {stop.rule_id for stop in planned.stops}
        self.assertIn(rules.RULE_PICKUP, rule_ids)
        self.assertIn(rules.RULE_DROPOFF, rule_ids)

    def test_geometry_is_simplified_for_transport(self):
        planned = plan_with([route(2794.0, 2988)]).selected
        self.assertLessEqual(len(planned.geometry), len(planned.route.geometry))

    def test_every_sheet_of_the_plan_is_complete(self):
        planned = plan_with([route(2794.0, 2988)]).selected
        for sheet in planned.sheets:
            self.assertTrue(sheet.is_complete, f"day {sheet.day_index}")


class RankingTests(SimpleTestCase):
    def test_the_earliest_arrival_ranks_first_even_when_it_is_longer(self):
        # The shorter route runs just past the point where an extra rest becomes
        # necessary, so the longer one gets there sooner. Ranking on distance would
        # pick the wrong one.
        shorter = route(700.0, 700)
        longer = route(760.0, 660)

        result = plan_with([shorter, longer])
        self.assertLessEqual(result.routes[0].arrival_minute, result.routes[1].arrival_minute)
        self.assertEqual([entry.index for entry in result.routes], [0, 1])

    def test_a_route_needing_a_restart_loses_to_one_that_does_not(self):
        result = plan_with([route(2794.0, 2988), route(2700.0, 2900)], cycle_used_hours=0.0)
        best, worst = result.routes
        self.assertLessEqual(
            (best.arrival_minute, best.restart_count),
            (worst.arrival_minute, worst.restart_count),
        )

    def test_indexes_are_reassigned_after_sorting(self):
        result = plan_with([route(2794.0, 2988), route(2700.0, 2900), route(3000.0, 3200)])
        self.assertEqual([entry.index for entry in result.routes], [0, 1, 2])

    def test_alternatives_are_not_requested_when_comparison_is_off(self):
        provider = StubProvider([route(500.0, 520)])
        with patch("trips.services.planner.geocoding.geocode", side_effect=[NEW_YORK, NEWARK, LOS_ANGELES]), patch(
            "trips.services.planner.geocoding.reverse", return_value="Somewhere, US"
        ):
            planner.plan_trip(
                "a", "b", "c", cycle_used_hours=0.0, start_datetime=START, provider=provider, alternatives=0
            )
        self.assertEqual(provider.requested_alternatives, 0)


class WarningTests(SimpleTestCase):
    def test_a_driver_at_the_cycle_limit_is_warned_before_reading_the_plan(self):
        result = plan_with([route(500.0, 520)], cycle_used_hours=70.0)
        self.assertTrue(any("34-hour restart" in warning for warning in result.warnings))

    def test_a_nearly_exhausted_cycle_is_flagged(self):
        result = plan_with([route(500.0, 520)], cycle_used_hours=69.0)
        self.assertTrue(any("two hours" in warning for warning in result.warnings))

    def test_a_single_route_says_there_is_nothing_to_compare(self):
        result = plan_with([route(500.0, 520)])
        self.assertTrue(any("Only one sensible route" in warning for warning in result.warnings))

    def test_an_estimated_route_is_declared(self):
        result = plan_with([route(500.0, 520, source="estimated")])
        self.assertTrue(any("straight-line estimates" in warning for warning in result.warnings))


class PayloadTests(SimpleTestCase):
    def setUp(self):
        self.payload = planner.to_payload(plan_with([route(2794.0, 2988)]))

    def test_payload_carries_routes_waypoints_and_warnings(self):
        self.assertEqual(self.payload["selectedIndex"], 0)
        self.assertEqual(len(self.payload["waypoints"]), 3)
        self.assertIn("warnings", self.payload)
        self.assertTrue(self.payload["routes"])

    def test_initial_clocks_are_published_for_the_opening_gauge_reading(self):
        payload = planner.to_payload(plan_with([route(2794.0, 2988)], cycle_used_hours=12.0))
        initial = payload["routes"][0]["initialClocks"]
        self.assertEqual(initial["cycleUsed"], 12 * 60)
        self.assertEqual(initial["drivingUsed"], 0)

    def test_segments_carry_clock_snapshots_for_the_gauges(self):
        segment = self.payload["routes"][0]["segments"][0]
        self.assertIn("clocksAfter", segment)
        self.assertIn("drivingRemaining", segment["clocksAfter"])
        self.assertIn("cycleRemaining", segment["clocksAfter"])

    def test_segments_carry_the_rule_that_caused_them(self):
        rule_ids = {segment["ruleId"] for segment in self.payload["routes"][0]["segments"]}
        self.assertIn(rules.RULE_INSPECTION, rule_ids)
        self.assertTrue(rule_ids.issubset(set(rules.CATALOG)))

    def test_stops_carry_a_map_position(self):
        stop = self.payload["routes"][0]["stops"][0]
        self.assertEqual(len(stop["position"]), 2)
        self.assertIn("location", stop)

    def test_daily_logs_report_complete_days(self):
        for sheet in self.payload["routes"][0]["logs"]:
            self.assertTrue(sheet["isComplete"])
            self.assertEqual(sheet["totalMinutes"], 1440)

    def test_timestamps_are_absolute_so_the_client_never_recomputes_dates(self):
        summary = self.payload["routes"][0]["summary"]
        self.assertTrue(summary["arrivalAt"].startswith("2026-03-"))
