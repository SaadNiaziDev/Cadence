"""Geometry helpers shared by the routing, geocoding and planning services.

All coordinates are `(longitude, latitude)` — GeoJSON order, as OSRM returns and MapLibre
consumes. Mixing orders is how coordinates end up silently transposed.
"""

from __future__ import annotations

import math
from typing import Sequence

EARTH_RADIUS_MILES = 3958.8

Coordinate = tuple[float, float]


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in miles between two points."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(math.sqrt(a))


def cumulative_miles(geometry: Sequence[Coordinate]) -> list[float]:
    """Running distance along a polyline, one entry per vertex."""
    totals = [0.0]
    for index in range(1, len(geometry)):
        previous_lon, previous_lat = geometry[index - 1]
        lon, lat = geometry[index]
        totals.append(totals[-1] + haversine_miles(previous_lat, previous_lon, lat, lon))
    return totals


def index_at_miles(cumulative: Sequence[float], miles: float) -> int:
    """First vertex index at or beyond a given distance along the polyline."""
    for index, total in enumerate(cumulative):
        if total >= miles:
            return index
    return max(len(cumulative) - 1, 0)


def position_at_miles(
    geometry: Sequence[Coordinate],
    cumulative: Sequence[float],
    miles: float,
) -> Coordinate:
    """Interpolate the point that lies a given distance along the polyline.

    Stops are placed by distance travelled, not by nearest vertex, so a rest falling
    between two shape points lands where it happened rather than snapping to a bend.
    """
    if not geometry:
        return (0.0, 0.0)
    if miles <= 0 or len(geometry) == 1:
        return geometry[0]

    total = cumulative[-1]
    if miles >= total:
        return geometry[-1]

    index = index_at_miles(cumulative, miles)
    if index == 0:
        return geometry[0]

    previous_distance = cumulative[index - 1]
    span = cumulative[index] - previous_distance
    fraction = (miles - previous_distance) / span if span > 0 else 0.0

    start_lon, start_lat = geometry[index - 1]
    end_lon, end_lat = geometry[index]
    return (
        start_lon + (end_lon - start_lon) * fraction,
        start_lat + (end_lat - start_lat) * fraction,
    )


#: Ramer-Douglas-Peucker degrades to O(n²) when every vertex is a local extreme. Real
#: road geometry is smooth enough that this never happens — a 34,000-point transcontinental
#: route reduces to about a hundred points in a quarter of a second — but a malformed or
#: hostile polyline should not be able to occupy a worker for a minute. Thinning the input
#: first bounds the work, and costs nothing in practice because the output is an order of
#: magnitude smaller than this cap either way.
_MAX_INPUT_VERTICES = 4000


def simplify(geometry: Sequence[Coordinate], tolerance_degrees: float = 0.0015) -> list[Coordinate]:
    """Reduce a polyline with Ramer-Douglas-Peucker, keeping its visible shape.

    A cross-country OSRM route carries tens of thousands of vertices describing lane-level
    detail invisible above street zoom. The default tolerance is roughly a street width.
    """
    if len(geometry) < 3:
        return list(geometry)

    geometry = _thin(geometry, _MAX_INPUT_VERTICES)
    keep = [False] * len(geometry)
    keep[0] = keep[-1] = True
    stack: list[tuple[int, int]] = [(0, len(geometry) - 1)]

    while stack:
        start, end = stack.pop()
        if end <= start + 1:
            continue

        furthest_index = -1
        furthest_distance = 0.0
        for index in range(start + 1, end):
            distance = _perpendicular_distance(geometry[index], geometry[start], geometry[end])
            if distance > furthest_distance:
                furthest_index, furthest_distance = index, distance

        if furthest_distance > tolerance_degrees:
            keep[furthest_index] = True
            stack.append((start, furthest_index))
            stack.append((furthest_index, end))

    return [point for point, kept in zip(geometry, keep) if kept]


def _thin(geometry: Sequence[Coordinate], limit: int) -> list[Coordinate]:
    """Take an evenly spaced subset of a polyline, always keeping both endpoints."""
    if len(geometry) <= limit:
        return list(geometry)

    stride = len(geometry) / limit
    thinned = [geometry[int(index * stride)] for index in range(limit)]
    if thinned[-1] != geometry[-1]:
        thinned.append(geometry[-1])
    return thinned


def _perpendicular_distance(point: Coordinate, start: Coordinate, end: Coordinate) -> float:
    """Distance from a point to the line through start and end, in degrees.

    Longitude is scaled by cos(latitude) so that a degree of longitude counts for what it
    is actually worth at this latitude; without it, routes in the north would be
    simplified far more aggressively than routes in the south.
    """
    scale = math.cos(math.radians(point[1])) or 1e-9

    px, py = point[0] * scale, point[1]
    ax, ay = start[0] * scale, start[1]
    bx, by = end[0] * scale, end[1]

    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)

    return abs(dy * px - dx * py + bx * ay - by * ax) / math.hypot(dx, dy)
