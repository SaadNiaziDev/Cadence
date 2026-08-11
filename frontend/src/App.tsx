import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, Info, Link2, Moon, Sun } from "lucide-react";

import { ApiError } from "@/api/client";
import { usePlanTrip, useTrip } from "@/api/trips";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClocksHud } from "@/features/hud/ClocksHud";
import { LogSheets } from "@/features/logs/LogSheets";
import { RouteComparison } from "@/features/routes/RouteComparison";
import { Scrubber } from "@/features/scrubber/Scrubber";
import { TripTimeline } from "@/features/timeline/TripTimeline";
import { PlanningProgress } from "@/features/trip/PlanningProgress";
import { TripForm } from "@/features/trip/TripForm";
import { WhatIfDeparture } from "@/features/trip/WhatIfDeparture";
import { ComplianceVerdict } from "@/features/verdict/ComplianceVerdict";
import { useTheme } from "@/hooks/use-theme";
import { formatDateTime, formatDuration, formatMiles } from "@/lib/hos";
import { coordinateAtMiles, positionAt, tripStartMinute } from "@/lib/trip-position";
import type { PlannedRoute, RuleId, Trip, TripRequest } from "@/types/hos";

// ~270 kB gzipped, and unused until a route exists, so it stays off the entry chunk.
const TripMap = lazy(() => import("@/features/map/TripMap").then((module) => ({ default: module.TripMap })));

export default function App() {
  const { theme, toggle } = useTheme();
  const { tripId } = useParams<{ tripId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [minute, setMinute] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [highlightedRoute, setHighlightedRoute] = useState<number | null>(null);

  const plan = usePlanTrip();
  const shared = useTrip(tripId);

  // Adopt the planner's ranking, or a shared link always opens on route A.
  useEffect(() => {
    if (!shared.data) return;
    setTrip(shared.data);
    setSelectedRoute(shared.data.selectedIndex);
    setIsPlaying(false);
  }, [shared.data]);

  const route: PlannedRoute | null = trip?.routes[selectedRoute] ?? trip?.routes[0] ?? null;
  const tripRequest = useMemo(() => requestFor(trip), [trip]);

  // Rewind on route change: the same minute maps to a different schedule.
  useEffect(() => {
    if (route) setMinute(tripStartMinute(route));
  }, [route]);

  const position = useMemo(() => (route ? positionAt(route, minute) : null), [route, minute]);

  const vehiclePosition = useMemo(() => {
    if (!route || !position) return null;
    return coordinateAtMiles(route.geometry, route.distanceMiles, position.milesFromOrigin);
  }, [route, position]);

  // The clock that forces the next stop: the first non-driving segment ahead of us.
  const bindingRuleId = useMemo<RuleId | null>(() => {
    if (!route || !position) return null;
    const upcoming = route.segments.slice(position.segmentIndex + 1).find((segment) => segment.status !== "D");
    return upcoming?.ruleId ?? null;
  }, [route, position]);

  function adoptTrip(result: Trip) {
    setTrip(result);
    setSelectedRoute(result.selectedIndex);
    setIsPlaying(false);

    if (result.id) {
      // Seed the cache so navigating to the id does not refetch what we already hold.
      queryClient.setQueryData(["trip", result.id], result);
      navigate(`/trip/${result.id}`);
    }
  }

  function handleSubmit(request: TripRequest) {
    plan.mutate(request, { onSuccess: adoptTrip });
  }

  return (
    <div className="app-shell flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="shrink-0 border-b">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-4 py-2.5 sm:px-6">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Clock className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-base font-semibold leading-tight tracking-tight">Cadence</h1>
            <p className="text-xs leading-tight text-muted-foreground">Hours of Service · 49 CFR Part 395</p>
          </div>

          <div className="ml-auto flex items-center gap-1">
            {trip?.id && <ShareLinkButton />}

            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid min-h-0 w-full max-w-[1600px] flex-1 gap-4 overflow-y-auto p-4 sm:px-6 lg:grid-cols-[360px_1fr] lg:overflow-hidden">
        <section className="flex flex-col gap-4 lg:overflow-y-auto lg:pr-1" aria-label="Trip details">
          <Card className="gap-4 py-4">
            <CardHeader className="px-4">
              <CardTitle className="text-sm">Plan a trip</CardTitle>
              <CardDescription className="text-xs">
                Every stop the regulations require is placed for you.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              {/* Keyed on the trip: remounting is what applies the defaults, so a trip
                  loading mid-edit cannot overwrite what someone is typing. */}
              <TripForm
                key={trip?.id ?? "new"}
                onSubmit={handleSubmit}
                isPending={plan.isPending}
                defaults={formDefaultsFor(trip)}
              />
            </CardContent>
          </Card>

          {trip && (
            <RouteComparison
              routes={trip.routes}
              selectedIndex={selectedRoute}
              onSelect={setSelectedRoute}
              onHover={setHighlightedRoute}
            />
          )}

          {trip && tripRequest && <WhatIfDeparture trip={trip} request={tripRequest} onApply={adoptTrip} />}

          {plan.isError && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>
                {plan.error instanceof ApiError ? plan.error.message : "Something went wrong while planning."}
              </AlertDescription>
            </Alert>
          )}

          {trip?.warnings.map((warning) => (
            <Alert key={warning}>
              <Info />
              <AlertDescription className="text-xs leading-relaxed">{warning}</AlertDescription>
            </Alert>
          ))}
        </section>

        <section className="flex min-h-[70vh] flex-col lg:min-h-0" aria-label="Planned trip">
          {plan.isPending || (shared.isLoading && !trip) ? (
            <PlanningProgress />
          ) : shared.isError && !trip ? (
            <SharedTripMissing />
          ) : route && trip && position ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2.5">
              <ClocksHud clocks={position.clocks} bindingRuleId={bindingRuleId} />
              <Scrubber
                route={route}
                minute={minute}
                isPlaying={isPlaying}
                onMinuteChange={setMinute}
                onPlayingChange={setIsPlaying}
              />

              <Tabs defaultValue="map" className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2">
                  <TabsList>
                    <TabsTrigger value="map">Map</TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="logs">Log sheets</TabsTrigger>
                  </TabsList>

                  <TripSummaryStats route={route} />

                  <div className="ml-auto">
                    <ComplianceVerdict route={route} />
                  </div>
                </div>

                <TabsContent value="map" className="mt-2 min-h-[45vh] flex-1 lg:min-h-0">
                  <Suspense fallback={<Skeleton className="size-full rounded-lg" />}>
                    <TripMap
                      routes={trip.routes}
                      selectedIndex={selectedRoute}
                      waypoints={trip.waypoints}
                      theme={theme}
                      onSelectRoute={setSelectedRoute}
                      vehiclePosition={vehiclePosition}
                      highlightedRoute={highlightedRoute}
                    />
                  </Suspense>
                </TabsContent>

                <TabsContent value="timeline" className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
                  <TripTimeline
                    route={route}
                    activeSegmentIndex={position.segmentIndex}
                    onSelectMinute={(value) => {
                      setIsPlaying(false);
                      setMinute(value);
                    }}
                  />
                </TabsContent>

                <TabsContent value="logs" className="mt-2 flex min-h-0 flex-1 flex-col">
                  <LogSheets
                    route={route}
                    minute={minute}
                    onSelectMinute={(value) => {
                      setIsPlaying(false);
                      setMinute(value);
                    }}
                  />
                </TabsContent>
              </Tabs>
            </div>
          ) : (
            <EmptyState />
          )}
        </section>
      </main>
    </div>
  );
}


function TripSummaryStats({ route }: { route: PlannedRoute }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
      <span>
        Arrives <span className="tabular font-semibold text-foreground">{formatDateTime(route.summary.arrivalAt)}</span>
      </span>
      <span aria-hidden>·</span>
      <span className="tabular">{formatMiles(route.distanceMiles)}</span>
      <span aria-hidden>·</span>
      <span className="tabular">{formatDuration(route.summary.drivingMinutes)} driving</span>
      <span aria-hidden>·</span>
      <span className="tabular">
        {route.summary.dayCount} {route.summary.dayCount === 1 ? "sheet" : "sheets"}
      </span>
      <span aria-hidden>·</span>
      <span className="tabular">{route.stops.length} stops</span>
    </p>
  );
}

// Rebuild the request from a trip: the waypoint labels are the three locations, and the
// cycle hours entered are the cycle clock's reading before the trip's first minute.
function requestFor(trip: Trip | null): TripRequest | null {
  if (!trip) return null;

  const [current, pickup, dropoff] = trip.waypoints;
  if (!current || !pickup || !dropoff) return null;

  return {
    current_location: current.label,
    pickup_location: pickup.label,
    dropoff_location: dropoff.label,
    cycle_used_hours: (trip.routes[0]?.initialClocks?.cycleUsed ?? 0) / 60,
    start_datetime: trip.startDateTime,
    compare_routes: trip.routes.length > 1,
  };
}

function formDefaultsFor(trip: Trip | null) {
  const request = requestFor(trip);
  if (!request || !trip) return undefined;

  const startedAt = new Date(trip.startDateTime);

  return {
    current: request.current_location,
    pickup: request.pickup_location,
    dropoff: request.dropoff_location,
    cycleUsed: String(request.cycle_used_hours),
    // Spread onto the form's initial state, so an unparseable timestamp has to omit the
    // key rather than carry undefined — which would blank the field instead of leaving
    // the "now" default in place.
    ...(Number.isNaN(startedAt.getTime())
      ? {}
      : {
          startDateTime: new Date(startedAt.getTime() - startedAt.getTimezoneOffset() * 60_000)
            .toISOString()
            .slice(0, 16),
        }),
  };
}

function ShareLinkButton() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Refused on insecure origins; the URL is in the address bar either way.
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={copy}>
      {copied ? <Check className="text-signal-ok" /> : <Link2 />}
      {copied ? "Copied" : "Share"}
    </Button>
  );
}

function SharedTripMissing() {
  return (
    <Empty className="size-full border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Link2 aria-hidden />
        </EmptyMedia>
        <EmptyTitle className="text-base">That trip link is no longer available</EmptyTitle>
        <EmptyDescription>
          The plan behind this link could not be found. Enter the three locations on the left to plan it again — the
          new trip gets a link of its own.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function EmptyState() {
  return (
    <Empty className="size-full border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Clock aria-hidden />
        </EmptyMedia>
        <EmptyTitle className="text-base">No trip planned yet</EmptyTitle>
        <EmptyDescription>
          Enter where the truck is, where the load is collected and delivered, and how many of your 70 cycle hours are
          already used. Every stop the regulations require will be placed on the map.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
