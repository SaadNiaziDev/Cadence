"""Place-name geocoding backed by Nominatim, with an offline fallback.

Nominatim is community-run: it rate limits and its public instance sometimes refuses
traffic, so a table of major US cities backs it up.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from django.conf import settings

from .errors import GeocodingError, UpstreamError
from .geo import haversine_miles
from .upstream import get_json, register_rate_limit

logger = logging.getLogger(__name__)

NOMINATIM_KEY = "nominatim"
register_rate_limit(NOMINATIM_KEY, 1.1)

PHOTON_KEY = "photon"
# Photon publishes no hard rate limit, but it is a free community service and a
# type-ahead field is the one thing capable of hammering it.
register_rate_limit(PHOTON_KEY, 0.2)

# Cached for a week: a city does not move, and this is the single hottest upstream call.
_GEOCODE_CACHE_SECONDS = 60 * 60 * 24 * 7

# Offline fallback. Coordinates are city centres; precise enough to plan a multi-hundred
# mile trip, and only ever used when Nominatim itself is unreachable.
US_CITY_FALLBACK: dict[str, tuple[float, float]] = {
    "new york, ny": (40.7128, -74.0060),
    "brooklyn, ny": (40.6782, -73.9442),
    "buffalo, ny": (42.8864, -78.8784),
    "los angeles, ca": (34.0522, -118.2437),
    "san francisco, ca": (37.7749, -122.4194),
    "san diego, ca": (32.7157, -117.1611),
    "sacramento, ca": (38.5816, -121.4944),
    "fresno, ca": (36.7378, -119.7871),
    "chicago, il": (41.8781, -87.6298),
    "springfield, il": (39.7817, -89.6501),
    "houston, tx": (29.7604, -95.3698),
    "dallas, tx": (32.7767, -96.7970),
    "san antonio, tx": (29.4241, -98.4936),
    "austin, tx": (30.2672, -97.7431),
    "el paso, tx": (31.7619, -106.4850),
    "amarillo, tx": (35.2220, -101.8313),
    "phoenix, az": (33.4484, -112.0740),
    "tucson, az": (32.2226, -110.9747),
    "flagstaff, az": (35.1983, -111.6513),
    "philadelphia, pa": (39.9526, -75.1652),
    "pittsburgh, pa": (40.4406, -79.9959),
    "harrisburg, pa": (40.2732, -76.8867),
    "jacksonville, fl": (30.3322, -81.6557),
    "miami, fl": (25.7617, -80.1918),
    "orlando, fl": (28.5383, -81.3792),
    "tampa, fl": (27.9506, -82.4572),
    "columbus, oh": (39.9612, -82.9988),
    "cleveland, oh": (41.4993, -81.6944),
    "cincinnati, oh": (39.1031, -84.5120),
    "toledo, oh": (41.6528, -83.5379),
    "indianapolis, in": (39.7684, -86.1581),
    "fort wayne, in": (41.0793, -85.1394),
    "charlotte, nc": (35.2271, -80.8431),
    "raleigh, nc": (35.7796, -78.6382),
    "greensboro, nc": (36.0726, -79.7920),
    "seattle, wa": (47.6062, -122.3321),
    "spokane, wa": (47.6588, -117.4260),
    "denver, co": (39.7392, -104.9903),
    "colorado springs, co": (38.8339, -104.8214),
    "grand junction, co": (39.0639, -108.5506),
    "boston, ma": (42.3601, -71.0589),
    "springfield, ma": (42.1015, -72.5898),
    "detroit, mi": (42.3314, -83.0458),
    "grand rapids, mi": (42.9634, -85.6681),
    "nashville, tn": (36.1627, -86.7816),
    "memphis, tn": (35.1495, -90.0490),
    "knoxville, tn": (35.9606, -83.9207),
    "portland, or": (45.5152, -122.6784),
    "eugene, or": (44.0521, -123.0868),
    "oklahoma city, ok": (35.4676, -97.5164),
    "tulsa, ok": (36.1540, -95.9928),
    "las vegas, nv": (36.1699, -115.1398),
    "reno, nv": (39.5296, -119.8138),
    "louisville, ky": (38.2527, -85.7585),
    "baltimore, md": (39.2904, -76.6122),
    "milwaukee, wi": (43.0389, -87.9065),
    "madison, wi": (43.0731, -89.4012),
    "albuquerque, nm": (35.0844, -106.6504),
    "kansas city, mo": (39.0997, -94.5786),
    "st. louis, mo": (38.6270, -90.1994),
    "saint louis, mo": (38.6270, -90.1994),
    "omaha, ne": (41.2565, -95.9345),
    "north platte, ne": (41.1239, -100.7654),
    "minneapolis, mn": (44.9778, -93.2650),
    "duluth, mn": (46.7867, -92.1005),
    "atlanta, ga": (33.7490, -84.3880),
    "savannah, ga": (32.0809, -81.0912),
    "salt lake city, ut": (40.7608, -111.8910),
    "boise, id": (43.6150, -116.2023),
    "billings, mt": (45.7833, -108.5007),
    "cheyenne, wy": (41.1400, -104.8202),
    "des moines, ia": (41.5868, -93.6250),
    "little rock, ar": (34.7465, -92.2896),
    "new orleans, la": (29.9511, -90.0715),
    "shreveport, la": (32.5252, -93.7502),
    "jackson, ms": (32.2988, -90.1848),
    "birmingham, al": (33.5186, -86.8104),
    "richmond, va": (37.5407, -77.4360),
    "norfolk, va": (36.8508, -76.2859),
    "charleston, wv": (38.3498, -81.6326),
    "wichita, ks": (37.6872, -97.3301),
    "sioux falls, sd": (43.5460, -96.7313),
    "fargo, nd": (46.8772, -96.7898),
    "portland, me": (43.6591, -70.2568),
    "newark, nj": (40.7357, -74.1724),
    "hartford, ct": (41.7658, -72.6734),
    "providence, ri": (41.8240, -71.4128),
    "columbia, sc": (34.0007, -81.0348),
    "wilmington, de": (39.7391, -75.5398),
    "anchorage, ak": (61.2181, -149.9003),
    "honolulu, hi": (21.3069, -157.8583),
}

# Nominatim reports the subdivision as an ISO 3166-2 code such as "US-IL".
_ISO_SUBDIVISION = re.compile(r"^[A-Z]{2}-([A-Z0-9]{1,3})$")

# Photon returns states by full name, sometimes already abbreviated. A log sheet's
# remarks column has room for a code, not for "Massachusetts".
_STATE_CODES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "district of columbia": "DC",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
    "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
    "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI",
    "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT",
    "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
    "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", "tennessee": "TN",
    "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}


def _state_code(value: str | None) -> str:
    """Normalise a state name to its two-letter code, passing codes through unchanged."""
    if not value:
        return ""
    return _STATE_CODES.get(value.strip().lower(), value.strip())


@dataclass(frozen=True)
class Place:
    """A resolved location: a short display label plus coordinates."""

    label: str
    latitude: float
    longitude: float
    full_name: str = ""
    source: str = "nominatim"

    @property
    def lonlat(self) -> tuple[float, float]:
        """Coordinates in GeoJSON order, which is what OSRM and MapLibre both expect."""
        return (self.longitude, self.latitude)


def _populated_place(address: dict) -> str | None:
    """Return the most specific inhabited place in a Nominatim address, if any.

    Deliberately excludes county-level fields. Rural interstate mileposts resolve to
    administrative divisions with names like "Richland VIII Precinct", which is accurate
    but not how a driver writes a log remark.
    """
    for key in ("city", "town", "village", "hamlet", "municipality"):
        value = address.get(key)
        if value:
            return str(value)
    return None


def _subdivision_code(address: dict) -> str:
    """State code from the ISO 3166-2 field, falling back to the full state name."""
    match = _ISO_SUBDIVISION.match(address.get("ISO3166-2-lvl4") or "")
    if match:
        return match.group(1)
    return str(address.get("state", ""))


def _short_label(entry: dict) -> str:
    """Collapse a Nominatim result into a "City, ST" label.

    The full display name ("Springfield, Sangamon County, Illinois, 62701, United States")
    does not fit a remarks column, so take the most specific populated place plus the
    state abbreviation.
    """
    address = entry.get("address") or {}
    locality = _populated_place(address) or address.get("county") or entry.get("name")

    subdivision = _subdivision_code(address)

    if locality and subdivision:
        return f"{locality}, {subdivision}"
    if locality:
        return str(locality)
    return str(entry.get("display_name", "")).split(",")[0]


def _fallback_lookup(query: str) -> Place | None:
    """Resolve a query against the offline city table, tolerating loose formatting."""
    normalised = " ".join(query.lower().replace(".", "").split())
    for key, (lat, lon) in US_CITY_FALLBACK.items():
        if normalised == key.replace(".", ""):
            return Place(label=_fallback_label(key), latitude=lat, longitude=lon, source="fallback")
    # Also accept a bare city name when it is unambiguous in the table ("Chicago").
    matches = [
        (key, coords) for key, coords in US_CITY_FALLBACK.items() if key.split(",")[0].replace(".", "") == normalised
    ]
    if len(matches) == 1:
        key, (lat, lon) = matches[0]
        return Place(label=_fallback_label(key), latitude=lat, longitude=lon, source="fallback")
    return None


def search(query: str, limit: int = 5) -> list[Place]:
    """Return candidate places for a free-text query, best match first."""
    query = query.strip()
    if not query:
        return []

    try:
        payload = get_json(
            NOMINATIM_KEY,
            f"{settings.NOMINATIM_BASE_URL}/search",
            {
                "q": query,
                "format": "jsonv2",
                "addressdetails": 1,
                "limit": limit,
            },
            cache_timeout=_GEOCODE_CACHE_SECONDS,
        )
    except UpstreamError:
        fallback = _fallback_lookup(query)
        if fallback:
            logger.info("Nominatim unavailable; served %r from the offline city table.", query)
            return [fallback]
        raise

    results: list[Place] = []
    for entry in payload if isinstance(payload, list) else []:
        try:
            results.append(
                Place(
                    label=_short_label(entry),
                    latitude=float(entry["lat"]),
                    longitude=float(entry["lon"]),
                    full_name=str(entry.get("display_name", "")),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    return results


def suggest(query: str, limit: int = 5) -> list[Place]:
    """Type-ahead suggestions for the location fields.

    Photon rather than Nominatim: Nominatim returns almost nothing for a partial word like
    "denv", which is exactly what a field sends on each keystroke. Photon indexes the same
    OpenStreetMap data for prefix matching. Falls back to Nominatim when unavailable.
    """
    query = query.strip()
    if len(query) < 2:
        return []

    try:
        payload = get_json(
            PHOTON_KEY,
            f"{settings.PHOTON_BASE_URL}/api/",
            {"q": query, "limit": limit, "lang": "en"},
            cache_timeout=_GEOCODE_CACHE_SECONDS,
        )
    except UpstreamError:
        logger.info("Photon unavailable; falling back to Nominatim for suggestions.")
        return search(query, limit=limit)

    results: list[Place] = []
    # OpenStreetMap holds a city as several objects — a node, a boundary relation, a
    # metropolitan area — so a plain query returns "Chicago, IL" three times. Photon
    # ranks the best one first, so keeping the first of each label is enough.
    seen_labels: set[str] = set()

    for feature in (payload or {}).get("features", []):
        properties = feature.get("properties") or {}
        coordinates = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coordinates) != 2:
            continue

        locality = properties.get("city") or properties.get("name")
        if not locality:
            continue

        state = _state_code(properties.get("state"))
        label = f"{locality}, {state}" if state else str(locality)
        # A named feature inside a city ("Denver Art Museum") is a legitimate destination,
        # so keep its own name rather than collapsing it to the city it sits in.
        if properties.get("city") and properties.get("name") and properties["name"] != properties["city"]:
            label = f"{properties['name']}, {label}"

        if label in seen_labels:
            continue
        seen_labels.add(label)

        results.append(
            Place(
                label=label,
                longitude=float(coordinates[0]),
                latitude=float(coordinates[1]),
                full_name=", ".join(
                    part
                    for part in (properties.get("name"), properties.get("city"), properties.get("state"), properties.get("country"))
                    if part
                ),
                source="photon",
            )
        )
    return results


def geocode(query: str) -> Place:
    """Resolve a place name to a single best-match location, or raise GeocodingError."""
    candidates = search(query, limit=1)
    if not candidates:
        raise GeocodingError(f"Could not find a location matching “{query}”.")
    return candidates[0]


def reverse(latitude: float, longitude: float) -> str:
    """Describe a coordinate as "City, ST" for log remarks and stop labels.

    Zoom 10 requests city-level detail rather than a street address, which is also more
    likely to be cache-shared between nearby stops on the same route.
    """
    try:
        payload = get_json(
            NOMINATIM_KEY,
            f"{settings.NOMINATIM_BASE_URL}/reverse",
            {
                "lat": round(latitude, 4),
                "lon": round(longitude, 4),
                "format": "jsonv2",
                "zoom": 10,
                "addressdetails": 1,
            },
            cache_timeout=_GEOCODE_CACHE_SECONDS,
        )
    except UpstreamError:
        return _nearest_fallback_city(latitude, longitude)

    if isinstance(payload, dict):
        address = payload.get("address") or {}
        town = _populated_place(address)
        if town:
            subdivision = _subdivision_code(address)
            return f"{town}, {subdivision}" if subdivision else town

        # Rest areas and fuel stops usually land between towns, where the only thing
        # Nominatim can name is a county subdivision. Naming the nearest real city
        # instead matches how remarks are actually written on a paper log.
        return _nearest_fallback_city(latitude, longitude)

    return _nearest_fallback_city(latitude, longitude)


def _fallback_label(key: str) -> str:
    """Format an offline-table key as a display label ("denver, co" -> "Denver, CO")."""
    city, _, state = key.partition(",")
    city = city.strip().title()
    state = state.strip().upper()
    return f"{city}, {state}" if state else city


def _nearest_fallback_city(latitude: float, longitude: float) -> str:
    """Name the closest known city, so a stop never renders as an anonymous coordinate."""
    nearest_key = min(
        US_CITY_FALLBACK,
        key=lambda key: haversine_miles(latitude, longitude, *US_CITY_FALLBACK[key]),
    )
    return f"near {_fallback_label(nearest_key)}"
