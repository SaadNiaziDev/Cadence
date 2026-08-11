"""Shared HTTP plumbing for the free upstream services (Nominatim, OSRM).

Both are community-run and rate limited, so every request is cached, throttled and
retried here rather than at each call site.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from typing import Any

import requests
from django.conf import settings
from django.core.cache import cache

from .errors import UpstreamError

logger = logging.getLogger(__name__)

# Nominatim's usage policy allows at most one request per second per application. The
# lock serialises callers across threads so a burst of autocomplete keystrokes from
# several browser tabs cannot exceed that between them.
_RATE_LIMIT_LOCK = threading.Lock()
_MIN_SECONDS_BETWEEN_CALLS: dict[str, float] = {}
_LAST_CALL_AT: dict[str, float] = {}


def register_rate_limit(host_key: str, min_interval_seconds: float) -> None:
    """Declare the minimum spacing between outbound calls for a given upstream."""
    _MIN_SECONDS_BETWEEN_CALLS[host_key] = min_interval_seconds


def _throttle(host_key: str) -> None:
    """Block until enough time has passed since the previous call to this upstream."""
    min_interval = _MIN_SECONDS_BETWEEN_CALLS.get(host_key)
    if not min_interval:
        return
    with _RATE_LIMIT_LOCK:
        last = _LAST_CALL_AT.get(host_key, 0.0)
        wait = min_interval - (time.monotonic() - last)
        if wait > 0:
            time.sleep(wait)
        _LAST_CALL_AT[host_key] = time.monotonic()


def _cache_key(host_key: str, url: str, params: dict[str, Any]) -> str:
    """Build a stable cache key; params are sorted so key order cannot cause a miss."""
    canonical = json.dumps({"url": url, "params": params}, sort_keys=True)
    digest = hashlib.sha256(canonical.encode()).hexdigest()[:32]
    return f"upstream:{host_key}:{digest}"


def get_json(
    host_key: str,
    url: str,
    params: dict[str, Any],
    *,
    cache_timeout: int | None = None,
    attempts: int = 2,
) -> Any:
    """GET a JSON document, serving from cache when possible.

    Cached before returning: a city's coordinates and the road network between two points
    are stable between page loads.
    """
    key = _cache_key(host_key, url, params)
    cached = cache.get(key)
    if cached is not None:
        return cached

    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        _throttle(host_key)
        try:
            response = requests.get(
                url,
                params=params,
                timeout=settings.UPSTREAM_TIMEOUT_SECONDS,
                headers={
                    "User-Agent": settings.UPSTREAM_USER_AGENT,
                    "Accept": "application/json",
                },
            )
        except requests.RequestException as exc:
            last_error = exc
            logger.warning("%s request failed (attempt %s/%s): %s", host_key, attempt, attempts, exc)
            continue

        # 429 and 5xx are transient on these shared servers, so they are worth one retry.
        if response.status_code == 429 or response.status_code >= 500:
            last_error = UpstreamError(f"{host_key} returned status {response.status_code}")
            logger.warning("%s returned %s (attempt %s/%s)", host_key, response.status_code, attempt, attempts)
            continue

        if not response.ok:
            raise UpstreamError(f"{host_key} rejected the request (status {response.status_code}).")

        try:
            payload = response.json()
        except ValueError as exc:
            raise UpstreamError(f"{host_key} returned a malformed response.") from exc

        cache.set(key, payload, timeout=cache_timeout)
        return payload

    raise UpstreamError(f"{host_key} is not responding.") from last_error
