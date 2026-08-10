import uuid

from django.db import models


class Trip(models.Model):
    """A planned trip, stored so it can be shared by link.

    The planning itself is stateless — this table exists only so a finished plan has a
    stable URL. The computed result is kept verbatim rather than recomputed on read,
    because a shared link should show what the sender saw even if the road network or
    the geocoder has since changed its mind.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    current_location = models.CharField(max_length=200)
    pickup_location = models.CharField(max_length=200)
    dropoff_location = models.CharField(max_length=200)
    cycle_used_hours = models.FloatField()
    start_datetime = models.DateTimeField()

    result = models.JSONField()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.current_location} → {self.pickup_location} → {self.dropoff_location}"
