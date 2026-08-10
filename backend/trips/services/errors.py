"""Errors raised by the upstream geocoding and routing services.

Each carries a message written for a driver rather than a developer, because these
surface directly in the UI when Nominatim or OSRM is unavailable.
"""


class UpstreamError(Exception):
    """An upstream service was unreachable, too slow, or returned something unusable."""

    default_message = "A mapping service is temporarily unavailable. Please try again."

    def __init__(self, message: str | None = None):
        super().__init__(message or self.default_message)
        self.message = message or self.default_message


class GeocodingError(UpstreamError):
    """A place name could not be resolved to coordinates."""

    default_message = "That location could not be found."


class RoutingError(UpstreamError):
    """No drivable route exists between the given points, or the router failed."""

    default_message = "No drivable route could be found between those locations."
