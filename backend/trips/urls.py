from django.urls import path

from . import views

app_name = "trips"

urlpatterns = [
    path("health/", views.health, name="health"),
]
