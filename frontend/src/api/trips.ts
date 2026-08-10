import { useMutation, useQuery } from "@tanstack/react-query";

import { apiFetch } from "./client";
import {
  ruleCatalogSchema,
  suggestionsSchema,
  tripSchema,
  type Rule,
  type RuleId,
  type Trip,
  type TripRequest,
} from "@/types/hos";

export function planTrip(request: TripRequest): Promise<Trip> {
  return apiFetch("/api/trips/", tripSchema, {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export function usePlanTrip() {
  return useMutation({ mutationFn: planTrip });
}

export function useTrip(tripId: string | undefined) {
  return useQuery({
    queryKey: ["trip", tripId],
    queryFn: () => apiFetch(`/api/trips/${tripId}/`, tripSchema),
    enabled: Boolean(tripId),
  });
}

/**
 * The rule catalog, fetched once and reused by every popover.
 *
 * It is served by the backend rather than written into the components so that the
 * explanation a driver reads always comes from the same source as the ids the engine
 * tags its segments with.
 */
export function useRules() {
  return useQuery({
    queryKey: ["rules"],
    queryFn: () => apiFetch("/api/rules/", ruleCatalogSchema),
    staleTime: Infinity,
    select: (data): Record<RuleId, Rule> =>
      Object.fromEntries(data.rules.map((rule) => [rule.id, rule])) as Record<RuleId, Rule>,
  });
}

export function useSuggestions(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["suggest", trimmed],
    queryFn: () =>
      apiFetch(`/api/geocode/suggest/?q=${encodeURIComponent(trimmed)}`, suggestionsSchema),
    // Below two characters the backend returns nothing anyway, so do not ask.
    enabled: trimmed.length >= 2,
    select: (data) => data.results,
  });
}
