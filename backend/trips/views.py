import logging
from datetime import datetime

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import Trip
from .serializers import TripRequestSerializer
from .services import geocoding, planner, rules
from .services.errors import GeocodingError, RoutingError, UpstreamError

logger = logging.getLogger(__name__)


@api_view(["GET"])
def health(_request):
    """Liveness probe used by the deploy host and by the frontend's connectivity check."""
    return Response({"status": "ok", "service": "fmcsa-hos-trip-planner"})


@api_view(["GET"])
def rule_catalog(_request):
    """The regulations this planner enforces, in the words the interface shows.

    Served rather than hard-coded in the frontend so that the explanation a driver reads
    always comes from the same place as the ids the engine tags its segments with.
    """
    return Response({"rules": rules.as_dicts()})


@api_view(["GET"])
def geocode_suggest(request):
    """Autocomplete for the three location fields."""
    query = request.query_params.get("q", "").strip()
    if len(query) < 2:
        return Response({"results": []})

    try:
        places = geocoding.suggest(query, limit=5)
    except UpstreamError as error:
        return Response({"detail": error.message}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    return Response(
        {
            "results": [
                {
                    "label": place.label,
                    "fullName": place.full_name,
                    "longitude": place.longitude,
                    "latitude": place.latitude,
                }
                for place in places
            ]
        }
    )


@api_view(["POST"])
def create_trip(request):
    """Plan a trip and persist it so the result has a shareable URL."""
    serializer = TripRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    start_datetime = data.get("start_datetime") or datetime.now().replace(second=0, microsecond=0)

    try:
        result = planner.plan_trip(
            current_location=data["current_location"],
            pickup_location=data["pickup_location"],
            dropoff_location=data["dropoff_location"],
            cycle_used_hours=data["cycle_used_hours"],
            start_datetime=start_datetime,
            alternatives=planner.ALTERNATIVES_REQUESTED if data["compare_routes"] else 0,
        )
    except GeocodingError as error:
        return Response({"detail": error.message}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
    except RoutingError as error:
        return Response({"detail": error.message}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
    except UpstreamError as error:
        return Response({"detail": error.message}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

    payload = planner.to_payload(result)

    trip = Trip.objects.create(
        current_location=data["current_location"],
        pickup_location=data["pickup_location"],
        dropoff_location=data["dropoff_location"],
        cycle_used_hours=data["cycle_used_hours"],
        start_datetime=start_datetime,
        result=payload,
    )

    return Response({"id": str(trip.id), **payload}, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def retrieve_trip(_request, trip_id):
    """Return a previously planned trip verbatim, for shared links."""
    trip = get_object_or_404(Trip, pk=trip_id)
    return Response({"id": str(trip.id), **trip.result})
