import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Info, Moon, Sun } from "lucide-react";

import { ApiError } from "@/api/client";
import { usePlanTrip } from "@/api/trips";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClocksHud } from "@/features/hud/ClocksHud";
import { Scrubber } from "@/features/scrubber/Scrubber";
import { TripTimeline } from "@/features/timeline/TripTimeline";
import { TripForm } from "@/features/trip/TripForm";
import { useTheme } from "@/hooks/use-theme";
import { formatDateTime, formatDuration, formatMiles } from "@/lib/hos";
import { coordinateAtMiles, positionAt, tripStartMinute } from "@/lib/trip-position";
import type { PlannedRoute, RuleId, Trip, TripRequest } from "@/types/hos";

// MapLibre is by far the heaviest dependency here — about 270 kB gzipped — and nothing
// needs it until a trip has actually been planned, so it is fetched only once there is a
// route to draw. That keeps the form itself on a much smaller entry chunk.
const TripMap = lazy(() => import("@/features/map/TripMap").then((module) => ({ default: module.TripMap })));

export default function App() {
  const { theme, toggle } = useTheme();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [minute, setMinute] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const plan = usePlanTrip();
  const route: PlannedRoute | null = trip?.routes[selectedRoute] ?? trip?.routes[0] ?? null;

  // Switching to another route rewinds, because the same minute means something
  // different on a schedule with a different set of stops.
  useEffect(() => {
    if (route) setMinute(tripStartMinute(route));
  }, [route]);

  const position = useMemo(() => (route ? positionAt(route, minute) : null), [route, minute]);

  const vehiclePosition = useMemo(() => {
    if (!route || !position) return null;
    return coordinateAtMiles(route.geometry, route.distanceMiles, position.milesFromOrigin);
  }, [route, position]);

  // Which clock forces the next stop, so its gauge can be picked out while the driver is
  // still approaching it.
  const bindingRuleId = useMemo<RuleId | null>(() => {
    if (!route || !position) return null;
    const upcoming = route.segments.slice(position.segmentIndex + 1).find((segment) => segment.status !== "D");
    return upcoming?.ruleId ?? null;
  }, [route, position]);

  function handleSubmit(request: TripRequest) {
    plan.mutate(request, {
      onSuccess: (result) => {
        setTrip(result);
        setSelectedRoute(result.selectedIndex);
        setIsPlaying(false);
      },
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Clock className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">HOS Trip Planner</h1>
              <p className="text-xs text-muted-foreground">Route and daily logs under 49 CFR Part 395</p>
            </div>
          </div>

          <Button variant="ghost" size="icon" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-[1600px] flex-1 gap-4 p-4 sm:px-6 lg:grid-cols-[380px_1fr]">
        <section className="space-y-4" aria-label="Trip details">
          <div className="rounded-lg border border-border bg-card p-4">
            <TripForm onSubmit={handleSubmit} isPending={plan.isPending} />
          </div>

          {plan.isError && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertDescription>
                {plan.error instanceof ApiError ? plan.error.message : "Something went wrong while planning."}
              </AlertDescription>
            </Alert>
          )}

          {trip?.warnings.map((warning) => (
            <Alert key={warning}>
              <Info className="size-4" />
              <AlertDescription className="text-xs leading-relaxed">{warning}</AlertDescription>
            </Alert>
          ))}
        </section>

        <section className="min-h-[60vh] lg:min-h-0" aria-label="Planned trip">
          {plan.isPending ? (
            <PlanningSkeleton />
          ) : route && trip && position ? (
            <div className="flex h-full flex-col gap-3">
              <TripSummaryBar route={route} />
              <ClocksHud clocks={position.clocks} bindingRuleId={bindingRuleId} />
              <Scrubber
                route={route}
                minute={minute}
                isPlaying={isPlaying}
                onMinuteChange={setMinute}
                onPlayingChange={setIsPlaying}
              />

              <Tabs defaultValue="map" className="flex min-h-[55vh] flex-1 flex-col">
                <TabsList>
                  <TabsTrigger value="map">Map</TabsTrigger>
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                </TabsList>

                <TabsContent value="map" className="mt-3 min-h-[50vh] flex-1">
                  <Suspense fallback={<Skeleton className="size-full rounded-lg" />}>
                    <TripMap
                      routes={trip.routes}
                      selectedIndex={selectedRoute}
                      waypoints={trip.waypoints}
                      theme={theme}
                      onSelectRoute={setSelectedRoute}
                      vehiclePosition={vehiclePosition}
                    />
                  </Suspense>
                </TabsContent>

                <TabsContent value="timeline" className="mt-3 max-h-[60vh] flex-1 overflow-y-auto pr-1">
                  <TripTimeline
                    route={route}
                    activeSegmentIndex={position.segmentIndex}
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

function PlanningSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3">
      <Skeleton className="h-16 rounded-lg" />
      <Skeleton className="h-24 rounded-lg" />
      <Skeleton className="min-h-[50vh] flex-1 rounded-lg" />
    </div>
  );
}

function TripSummaryBar({ route }: { route: PlannedRoute }) {
  const stats = [
    { label: "Distance", value: formatMiles(route.distanceMiles) },
    { label: "Driving", value: formatDuration(route.summary.drivingMinutes) },
    { label: "Arrives", value: formatDateTime(route.summary.arrivalAt) },
    { label: "Log sheets", value: String(route.summary.dayCount) },
    { label: "Stops", value: String(route.stops.length) },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
      {stats.map((stat) => (
        <div key={stat.label}>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{stat.label}</p>
          <p className="tabular text-sm font-medium">{stat.value}</p>
        </div>
      ))}
      <div className="ml-auto">
        {route.violations.length === 0 ? (
          <span className="rounded-full border border-signal-ok/40 bg-signal-ok/10 px-3 py-1 text-xs font-medium text-signal-ok">
            Compliant — 0 violations
          </span>
        ) : (
          <span className="rounded-full border border-signal-danger/40 bg-signal-danger/10 px-3 py-1 text-xs font-medium text-signal-danger">
            {route.violations.length} violations
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex size-full min-h-[60vh] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Clock className="size-8 text-muted-foreground" aria-hidden />
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium">No trip planned yet</p>
        <p className="text-sm text-muted-foreground">
          Enter where the truck is, where the load is collected and delivered, and how many of your 70 cycle hours are
          already used. Every stop the regulations require will be placed on the map.
        </p>
      </div>
    </div>
  );
}
