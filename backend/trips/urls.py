from django.urls import path

from . import views

app_name = "trips"

urlpatterns = [
    path("health/", views.health, name="health"),
    path("rules/", views.rule_catalog, name="rules"),
    path("geocode/suggest/", views.geocode_suggest, name="geocode-suggest"),
    path("trips/", views.create_trip, name="trip-create"),
    path("trips/<uuid:trip_id>/", views.retrieve_trip, name="trip-detail"),
]
