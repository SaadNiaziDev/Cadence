from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase

from trips.services import geo, routing
from trips.services.errors import RoutingError, UpstreamError
from trips.services.geocoding import Place

CHICAGO = Place(label="Chicago, IL", latitude=41.8781, longitude=-87.6298)
INDIANAPOLIS = Place(label="Indianapolis, IN", latitude=39.7684, longitude=-86.1581)
COLUMBUS = Place(label="Columbus, OH", latitude=39.9612, longitude=-82.9988)


def osrm_payload(routes):
    return {"code": "Ok", "routes": routes}


def osrm_route(distance_meters, duration_seconds, coordinates, legs=None):
    return {
        "distance": distance_meters,
        "duration": duration_seconds,
        "geometry": {"coordinates": coordinates},
        "legs": legs or [],
    }


class ParseTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.provider = routing.OSRMProvider()

    @patch("trips.services.routing.get_json")
    def test_converts_meters_and_seconds_to_miles_and_minutes(self, get_json):
        get_json.return_value = osrm_payload(
            [osrm_route(1609.344 * 100, 3600 * 2, [[-87.6298, 41.8781], [-86.1581, 39.7684]])]
        )
        route = self.provider.route([CHICAGO, INDIANAPOLIS])[0]
        self.assertAlmostEqual(route.distance_miles, 100.0, places=3)
        self.assertEqual(route.duration_minutes, 120)
        self.assertAlmostEqual(route.average_mph, 50.0, places=3)

    @patch("trips.services.routing.get_json")
    def test_geometry_is_returned_in_longitude_latitude_order(self, get_json):
        get_json.return_value = osrm_payload([osrm_route(1000.0, 60.0, [[-87.6298, 41.8781], [-86.1581, 39.7684]])])
        route = self.provider.route([CHICAGO, INDIANAPOLIS])[0]
        self.assertEqual(route.geometry[0], (-87.6298, 41.8781))

    @patch("trips.services.routing.get_json")
    def test_leg_end_indexes_track_the_combined_geometry(self, get_json):
        # Three collinear points roughly 100 miles apart; the first leg covers the first
        # half of the polyline, so its end index must land on the middle vertex.
        coordinates = [[-87.6298, 41.8781], [-86.1581, 39.7684], [-82.9988, 39.9612]]
        first_leg_miles = geo.haversine_miles(41.8781, -87.6298, 39.7684, -86.1581)
        second_leg_miles = geo.haversine_miles(39.7684, -86.1581, 39.9612, -82.9988)
        get_json.return_value = osrm_payload(
            [
                osrm_route(
                    (first_leg_miles + second_leg_miles) * routing.METERS_PER_MILE,
                    7200.0,
                    coordinates,
                    legs=[
                        {"distance": first_leg_miles * routing.METERS_PER_MILE, "duration": 3600.0},
                        {"distance": second_leg_miles * routing.METERS_PER_MILE, "duration": 3600.0},
                    ],
                )
            ]
        )
        route = self.provider.route([CHICAGO, INDIANAPOLIS, COLUMBUS])[0]
        self.assertEqual(len(route.legs), 2)
        self.assertEqual(route.legs[0].geometry_end_index, 1)
        self.assertEqual(route.legs[1].geometry_end_index, 2)

    @patch("trips.services.routing.get_json")
    def test_unusable_route_entries_are_discarded(self, get_json):
        get_json.return_value = osrm_payload([{"distance": "nope"}])
        with self.assertRaises(RoutingError):
            self.provider.route([CHICAGO, INDIANAPOLIS])

    @patch("trips.services.routing.get_json")
    def test_non_ok_response_raises_routing_error(self, get_json):
        get_json.return_value = {"code": "NoRoute", "message": "Impossible route"}
        with self.assertRaises(RoutingError) as raised:
            self.provider.route([CHICAGO, INDIANAPOLIS])
        self.assertIn("Impossible route", str(raised.exception))

    def test_single_waypoint_is_rejected_before_calling_upstream(self):
        with self.assertRaises(RoutingError):
            self.provider.route([CHICAGO])


class AlternativesTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.provider = routing.OSRMProvider()

    @patch("trips.services.routing.get_json")
    def test_alternatives_parameter_is_only_sent_when_requested(self, get_json):
        get_json.return_value = osrm_payload([osrm_route(1000.0, 60.0, [[-87.6, 41.8], [-86.1, 39.7]])])

        self.provider.route([CHICAGO, INDIANAPOLIS])
        self.assertNotIn("alternatives", get_json.call_args.args[2])

        self.provider.route([CHICAGO, INDIANAPOLIS], alternatives=3)
        self.assertEqual(get_json.call_args.args[2]["alternatives"], 3)

    @patch("trips.services.routing.get_json")
    def test_near_identical_alternatives_are_collapsed(self, get_json):
        geometry = [[-87.6, 41.8], [-86.1, 39.7]]
        get_json.return_value = osrm_payload(
            [
                osrm_route(1609.344 * 1000, 3600 * 18, geometry),
                # 1% longer and 10 minutes slower: the same trip with different scenery.
                osrm_route(1609.344 * 1010, 3600 * 18 + 600, geometry),
            ]
        )
        self.assertEqual(len(self.provider.route([CHICAGO, INDIANAPOLIS], alternatives=3)), 1)

    @patch("trips.services.routing.get_json")
    def test_genuinely_different_alternatives_are_kept(self, get_json):
        geometry = [[-87.6, 41.8], [-86.1, 39.7]]
        get_json.return_value = osrm_payload(
            [
                osrm_route(1609.344 * 1000, 3600 * 18, geometry),
                osrm_route(1609.344 * 1080, 3600 * 20, geometry),
            ]
        )
        self.assertEqual(len(self.provider.route([CHICAGO, INDIANAPOLIS], alternatives=3)), 2)


class FallbackTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.provider = routing.OSRMProvider()

    @patch("trips.services.routing.get_json", side_effect=UpstreamError())
    def test_estimates_a_route_when_the_router_is_unreachable(self, _get_json):
        route = self.provider.route([CHICAGO, INDIANAPOLIS])[0]
        self.assertEqual(route.source, "estimated")
        # Chicago to Indianapolis is about 165 road miles; the estimate should be in
        # the right neighbourhood rather than exact.
        self.assertGreater(route.distance_miles, 140)
        self.assertLess(route.distance_miles, 220)
        self.assertEqual(len(route.legs), 1)

    @patch("trips.services.routing.get_json", side_effect=UpstreamError())
    def test_estimated_route_covers_every_leg(self, _get_json):
        route = self.provider.route([CHICAGO, INDIANAPOLIS, COLUMBUS])[0]
        self.assertEqual(len(route.legs), 2)
        self.assertEqual(route.legs[-1].geometry_end_index, 2)
