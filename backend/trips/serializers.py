from datetime import datetime

from rest_framework import serializers

from .services.hos_engine import CYCLE_LIMIT_MINUTES, MINUTES_PER_HOUR

CYCLE_LIMIT_HOURS = CYCLE_LIMIT_MINUTES / MINUTES_PER_HOUR


class HomeTerminalDateTimeField(serializers.DateTimeField):
    """Reads the wall-clock time the driver chose, ignoring any timezone offset.

    Log sheets are kept in a single home-terminal local time for the whole trip, as
    395.8(d) prescribes, and the engine slices days at midnight in that same frame.

    The default field would convert an offset-bearing timestamp to UTC and hand back a
    naive datetime, so a driver in Karachi asking to leave at 08:00 would be planned as
    leaving at 03:00 — every midnight boundary, and therefore every log sheet, shifted by
    five hours. Keeping the wall clock and discarding the offset is what the driver meant.
    """

    def to_internal_value(self, value):
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value).replace(tzinfo=None)
            except ValueError:
                # Fall through to the parent for the formats fromisoformat rejects, and
                # for its error message.
                pass
        parsed = super().to_internal_value(value)
        return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


class TripRequestSerializer(serializers.Serializer):
    """Validates the four inputs a driver supplies, plus optional planning controls."""

    current_location = serializers.CharField(max_length=200, trim_whitespace=True)
    pickup_location = serializers.CharField(max_length=200, trim_whitespace=True)
    dropoff_location = serializers.CharField(max_length=200, trim_whitespace=True)

    # A driver cannot have used more than the cycle allows; anything above 70 is a typo
    # rather than a state the regulations can describe.
    cycle_used_hours = serializers.FloatField(min_value=0, max_value=CYCLE_LIMIT_HOURS)

    #: Defaults to the current local time when the client does not send one.
    start_datetime = HomeTerminalDateTimeField(required=False, allow_null=True)
    #: Set to false to skip route alternatives and return a single route faster.
    compare_routes = serializers.BooleanField(required=False, default=True)
