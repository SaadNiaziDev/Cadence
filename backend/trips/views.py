from rest_framework.decorators import api_view
from rest_framework.response import Response


@api_view(["GET"])
def health(_request):
    """Liveness probe used by the deploy host and by the frontend's connectivity check."""
    return Response({"status": "ok", "service": "fmcsa-hos-trip-planner"})
