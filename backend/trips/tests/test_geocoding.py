from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase

from trips.services import geocoding
from trips.services.errors import GeocodingError, UpstreamError

NOMINATIM_RESULT = [
    {
        "lat": "39.7817",
        "lon": "-89.6501",
        "display_name": "Springfield, Sangamon County, Illinois, 62701, United States",
        "address": {
            "city": "Springfield",
            "county": "Sangamon County",
            "state": "Illinois",
            "ISO3166-2-lvl4": "US-IL",
        },
    }
]


class ShortLabelTests(SimpleTestCase):
    def test_prefers_city_and_iso_state_code(self):
        self.assertEqual(geocoding._short_label(NOMINATIM_RESULT[0]), "Springfield, IL")

    def test_falls_back_through_less_specific_place_types(self):
        entry = {"address": {"village": "Effingham", "ISO3166-2-lvl4": "US-IL"}}
        self.assertEqual(geocoding._short_label(entry), "Effingham, IL")

    def test_uses_full_state_name_when_iso_code_missing(self):
        entry = {"address": {"town": "Barstow", "state": "California"}}
        self.assertEqual(geocoding._short_label(entry), "Barstow, California")


class SearchTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    @patch("trips.services.geocoding.get_json", return_value=NOMINATIM_RESULT)
    def test_returns_places_from_nominatim(self, _get_json):
        places = geocoding.search("Springfield IL")
        self.assertEqual(len(places), 1)
        self.assertEqual(places[0].label, "Springfield, IL")
        self.assertAlmostEqual(places[0].latitude, 39.7817)
        self.assertEqual(places[0].source, "nominatim")

    @patch("trips.services.geocoding.get_json", return_value=[{"display_name": "broken"}])
    def test_skips_entries_missing_coordinates(self, _get_json):
        self.assertEqual(geocoding.search("nowhere"), [])

    def test_empty_query_short_circuits_without_calling_upstream(self):
        with patch("trips.services.geocoding.get_json") as get_json:
            self.assertEqual(geocoding.search("   "), [])
        get_json.assert_not_called()

    @patch("trips.services.geocoding.get_json", side_effect=UpstreamError())
    def test_falls_back_to_offline_table_when_upstream_is_down(self, _get_json):
        places = geocoding.search("Denver, CO")
        self.assertEqual(len(places), 1)
        self.assertEqual(places[0].source, "fallback")
        self.assertAlmostEqual(places[0].latitude, 39.7392)

    @patch("trips.services.geocoding.get_json", side_effect=UpstreamError())
    def test_fallback_accepts_bare_city_when_unambiguous(self, _get_json):
        places = geocoding.search("chicago")
        self.assertEqual(places[0].label, "Chicago, Il")

    @patch("trips.services.geocoding.get_json", side_effect=UpstreamError())
    def test_fallback_rejects_ambiguous_bare_city(self, _get_json):
        # "Springfield" exists in both IL and MA in the table, so guessing would be wrong.
        with self.assertRaises(UpstreamError):
            geocoding.search("springfield")


class GeocodeTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    @patch("trips.services.geocoding.get_json", return_value=[])
    def test_raises_when_nothing_matches(self, _get_json):
        with self.assertRaises(GeocodingError):
            geocoding.geocode("Sprngfeld")


class ReverseTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    @patch("trips.services.geocoding.get_json", return_value=NOMINATIM_RESULT[0])
    def test_describes_a_coordinate_as_city_and_state(self, _get_json):
        self.assertEqual(geocoding.reverse(39.7817, -89.6501), "Springfield, IL")

    @patch("trips.services.geocoding.get_json", side_effect=UpstreamError())
    def test_names_nearest_known_city_when_upstream_is_down(self, _get_json):
        # A point just outside Denver should still produce a usable remark.
        self.assertEqual(geocoding.reverse(39.70, -104.95), "near Denver, Co")
