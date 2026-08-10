from datetime import datetime
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse

from trips.models import Trip
from trips.services import rules
from trips.services.errors import GeocodingError, RoutingError, UpstreamError
from trips.services.geocoding import Place
from trips.services.routing import Route, RouteLeg

NEW_YORK = Place(label="New York, NY", latitude=40.7128, longitude=-74.0060)
NEWARK = Place(label="Newark, NJ", latitude=40.7357, longitude=-74.1724)
PHILADELPHIA = Place(label="Philadelphia, PA", latitude=39.9526, longitude=-75.1652)

VALID_REQUEST = {
    "current_location": "New York, NY",
    "pickup_location": "Newark, NJ",
    "dropoff_location": "Philadelphia, PA",
    "cycle_used_hours": 12.5,
    "start_datetime": "2026-03-09T08:00:00",
}


def stub_route(distance_miles=110.0, duration_minutes=120):
    geometry = [(-74.0 - i * 0.01, 40.7 - i * 0.008) for i in range(120)]
    return Route(
        distance_miles=distance_miles,
        duration_minutes=duration_minutes,
        geometry=geometry,
        legs=[
            RouteLeg(distance_miles=10.0, duration_minutes=15, geometry_end_index=10),
            RouteLeg(distance_miles=distance_miles - 10.0, duration_minutes=duration_minutes - 15, geometry_end_index=119),
        ],
    )


class StubProvider:
    def route(self, waypoints, alternatives=0):
        return [stub_route()]


def patched_plan():
    """Patch the upstream services a plan depends on, leaving the planning itself real."""
    return (
        patch("trips.services.planner.geocoding.geocode", side_effect=[NEW_YORK, NEWARK, PHILADELPHIA]),
        patch("trips.services.planner.geocoding.reverse", return_value="Trenton, NJ"),
        patch("trips.services.planner.default_provider", StubProvider()),
    )


class HealthTests(TestCase):
    def test_health_reports_ok(self):
        response = self.client.get(reverse("trips:health"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")


class RuleCatalogTests(TestCase):
    def test_every_rule_the_engine_tags_is_documented(self):
        response = self.client.get(reverse("trips:rules"))
        self.assertEqual(response.status_code, 200)

        served = {rule["id"] for rule in response.json()["rules"]}
        self.assertEqual(served, set(rules.CATALOG))

    def test_rules_carry_the_text_the_popovers_need(self):
        served = self.client.get(reverse("trips:rules")).json()["rules"]
        break_rule = next(rule for rule in served if rule["id"] == rules.RULE_BREAK)

        self.assertIn("395.3(a)(3)(ii)", break_rule["citation"])
        self.assertTrue(break_rule["summary"])
        # The detail people get wrong: on-duty-not-driving counts toward the break.
        self.assertIn("on-duty-not-driving", break_rule["countsAs"])


class GeocodeSuggestTests(TestCase):
    def test_short_queries_do_not_reach_the_geocoder(self):
        with patch("trips.views.geocoding.suggest") as search:
            response = self.client.get(reverse("trips:geocode-suggest"), {"q": "a"})
        search.assert_not_called()
        self.assertEqual(response.json()["results"], [])

    @patch("trips.views.geocoding.suggest", return_value=[NEW_YORK])
    def test_suggestions_are_returned_with_coordinates(self, _search):
        response = self.client.get(reverse("trips:geocode-suggest"), {"q": "new yo"})
        result = response.json()["results"][0]
        self.assertEqual(result["label"], "New York, NY")
        self.assertAlmostEqual(result["latitude"], 40.7128)

    @patch("trips.views.geocoding.suggest", side_effect=UpstreamError())
    def test_an_unavailable_geocoder_returns_503(self, _search):
        response = self.client.get(reverse("trips:geocode-suggest"), {"q": "new york"})
        self.assertEqual(response.status_code, 503)


class ValidationTests(TestCase):
    def post(self, **overrides):
        return self.client.post(
            reverse("trips:trip-create"),
            {**VALID_REQUEST, **overrides},
            content_type="application/json",
        )

    def test_cycle_hours_above_the_legal_maximum_are_rejected(self):
        self.assertEqual(self.post(cycle_used_hours=71).status_code, 400)

    def test_negative_cycle_hours_are_rejected(self):
        self.assertEqual(self.post(cycle_used_hours=-1).status_code, 400)

    def test_exactly_seventy_hours_is_accepted(self):
        # A driver with a full cycle is a real state; the plan opens with a restart.
        geocode, reverse_geocode, provider = patched_plan()
        with geocode, reverse_geocode, provider:
            self.assertEqual(self.post(cycle_used_hours=70).status_code, 201)

    def test_missing_locations_are_rejected(self):
        response = self.post(pickup_location="")
        self.assertEqual(response.status_code, 400)
        self.assertIn("pickup_location", response.json())


class CreateTripTests(TestCase):
    def create(self, **overrides):
        return self.client.post(
            reverse("trips:trip-create"),
            {**VALID_REQUEST, **overrides},
            content_type="application/json",
        )

    def test_a_trip_is_planned_and_persisted(self):
        geocode, reverse_geocode, provider = patched_plan()
        with geocode, reverse_geocode, provider:
            response = self.create()

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(Trip.objects.count(), 1)
        self.assertEqual(body["id"], str(Trip.objects.get().id))
        self.assertTrue(body["routes"])
        self.assertTrue(body["routes"][0]["logs"])

    def test_the_plan_reports_no_violations(self):
        geocode, reverse_geocode, provider = patched_plan()
        with geocode, reverse_geocode, provider:
            body = self.create().json()
        self.assertEqual(body["routes"][0]["violations"], [])

    def test_an_unknown_location_returns_422_with_a_readable_message(self):
        with patch(
            "trips.services.planner.geocoding.geocode",
            side_effect=GeocodingError("Could not find a location matching “Sprngfeld”."),
        ):
            response = self.create(current_location="Sprngfeld")

        self.assertEqual(response.status_code, 422)
        self.assertIn("Sprngfeld", response.json()["detail"])

    def test_an_unroutable_pair_returns_422(self):
        class NoRouteProvider:
            def route(self, waypoints, alternatives=0):
                raise RoutingError()

        with patch("trips.services.planner.geocoding.geocode", side_effect=[NEW_YORK, NEWARK, PHILADELPHIA]), patch(
            "trips.services.planner.default_provider", NoRouteProvider()
        ):
            response = self.create()

        self.assertEqual(response.status_code, 422)
        self.assertIn("route", response.json()["detail"].lower())

    def test_an_upstream_outage_returns_503(self):
        with patch("trips.services.planner.geocoding.geocode", side_effect=UpstreamError()):
            response = self.create()
        self.assertEqual(response.status_code, 503)

    def test_start_time_defaults_to_now_when_omitted(self):
        payload = dict(VALID_REQUEST)
        payload.pop("start_datetime")

        geocode, reverse_geocode, provider = patched_plan()
        with geocode, reverse_geocode, provider:
            response = self.client.post(reverse("trips:trip-create"), payload, content_type="application/json")

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["startDateTime"])

    def test_a_timezone_aware_start_is_reduced_to_local_time(self):
        # Log sheets stay in one home-terminal time, so an offset must not shift midnight.
        geocode, reverse_geocode, provider = patched_plan()
        with geocode, reverse_geocode, provider:
            body = self.create(start_datetime="2026-03-09T08:00:00+05:00").json()

        self.assertEqual(datetime.fromisoformat(body["startDateTime"]).hour, 8)
        self.assertIsNone(datetime.fromisoformat(body["startDateTime"]).tzinfo)


class RetrieveTripTests(TestCase):
    def test_a_saved_trip_can_be_fetched_by_id(self):
        geocode, reverse_geocode, provider = patched_plan()
        with geocode, reverse_geocode, provider:
            created = self.client.post(
                reverse("trips:trip-create"), VALID_REQUEST, content_type="application/json"
            ).json()

        response = self.client.get(reverse("trips:trip-detail", args=[created["id"]]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["routes"][0]["distanceMiles"], created["routes"][0]["distanceMiles"])

    def test_an_unknown_trip_id_returns_404(self):
        response = self.client.get(reverse("trips:trip-detail", args=["3f2504e0-4f89-11d3-9a0c-0305e82c3301"]))
        self.assertEqual(response.status_code, 404)
