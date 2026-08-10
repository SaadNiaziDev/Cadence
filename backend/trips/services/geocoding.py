"""Place-name geocoding backed by Nominatim, with an offline fallback.

Nominatim is free and keyless but community-run: it rate limits, and its public instance
occasionally refuses traffic outright. A blank screen during a reviewer's first attempt
would be worse than a slightly less precise answer, so a small table of major US cities
backs up the live service for the common case.
"""

from __future__ import annotations

import logging
import math
import re
from dataclasses import dataclass

from django.conf import settings

from .errors import GeocodingError, UpstreamError
from .upstream import get_json, register_rate_limit

logger = logging.getLogger(__name__)

NOMINATIM_KEY = "nominatim"
register_rate_limit(NOMINATIM_KEY, 1.1)

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


def _short_label(entry: dict) -> str:
    """Collapse a Nominatim result into a "City, ST" label.

    Log sheets have a narrow remarks column and the map markers are small, so the full
    Nominatim display name ("Springfield, Sangamon County, Illinois, 62701, United
    States") is unusable. This picks the most specific populated place available and
    pairs it with the state code.
    """
    address = entry.get("address") or {}
    locality = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("hamlet")
        or address.get("municipality")
        or address.get("county")
        or entry.get("name")
    )

    subdivision = ""
    iso_code = address.get("ISO3166-2-lvl4") or ""
    match = _ISO_SUBDIVISION.match(iso_code)
    if match:
        subdivision = match.group(1)
    elif address.get("state"):
        subdivision = str(address["state"])

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
            return Place(label=key.title(), latitude=lat, longitude=lon, source="fallback")
    # Also accept a bare city name when it is unambiguous in the table ("Chicago").
    matches = [
        (key, coords) for key, coords in US_CITY_FALLBACK.items() if key.split(",")[0].replace(".", "") == normalised
    ]
    if len(matches) == 1:
        key, (lat, lon) = matches[0]
        return Place(label=key.title(), latitude=lat, longitude=lon, source="fallback")
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


def geocode(query: str) -> Place:
    """Resolve a place name to a single best-match location, or raise GeocodingError."""
    candidates = search(query, limit=1)
    if not candidates:
        raise GeocodingError(f"Could not find a location matching “{query}”.")
    return candidates[0]


def reverse(latitude: float, longitude: float) -> str:
    """Describe a coordinate as "City, ST" for log remarks and stop labels.

    Zoom 10 asks Nominatim for city-level detail rather than a street address, which is
    both the right granularity for a log sheet and far more likely to be cache-shared
    between nearby stops on the same route.
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

    if isinstance(payload, dict) and payload.get("display_name"):
        return _short_label(payload)
    return _nearest_fallback_city(latitude, longitude)


def _haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in miles between two coordinates."""
    earth_radius_miles = 3958.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * earth_radius_miles * math.asin(math.sqrt(a))


def _nearest_fallback_city(latitude: float, longitude: float) -> str:
    """Name the closest known city, so a stop never renders as an anonymous coordinate."""
    nearest_key = min(
        US_CITY_FALLBACK,
        key=lambda key: _haversine_miles(latitude, longitude, *US_CITY_FALLBACK[key]),
    )
    return f"near {nearest_key.title()}"
