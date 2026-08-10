import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, Info, Moon, Sun } from "lucide-react";

import { ApiError } from "@/api/client";
import { usePlanTrip } from "@/api/trips";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClocksHud } from "@/features/hud/ClocksHud";
import { LogSheets } from "@/features/logs/LogSheets";
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
    // A fixed-height shell rather than a growing document: the map is the primary
    // surface, so it claims whatever height is left instead of being pushed below the
    // fold by the panels above it. Each column scrolls on its own.
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* The trip summary lives in the header rather than in its own row. The header had
          empty space to spare and the map did not, and these are read-once figures that
          do not need to sit beside the controls. */}
      <header className="shrink-0 border-b">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Clock className="size-4" aria-hidden />
            </span>
            <div>
              <h1 className="text-sm font-semibold leading-tight tracking-tight">HOS Trip Planner</h1>
              <p className="text-[11px] leading-tight text-muted-foreground">49 CFR Part 395</p>
            </div>
          </div>

          {route && <TripSummaryStats route={route} />}

          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            onClick={toggle}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
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
              <TripForm onSubmit={handleSubmit} isPending={plan.isPending} />
            </CardContent>
          </Card>

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
          {plan.isPending ? (
            <PlanningSkeleton />
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
                <TabsList className="shrink-0 self-start">
                  <TabsTrigger value="map">Map</TabsTrigger>
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="logs">Log sheets</TabsTrigger>
                </TabsList>

                <TabsContent value="map" className="mt-2 min-h-[45vh] flex-1 lg:min-h-0">
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

function PlanningSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <Skeleton className="h-[86px] shrink-0 rounded-lg" />
      <Skeleton className="h-20 shrink-0 rounded-lg" />
      <Skeleton className="min-h-[45vh] flex-1 rounded-lg lg:min-h-0" />
    </div>
  );
}

function TripSummaryStats({ route }: { route: PlannedRoute }) {
  const stats = [
    { label: "Distance", value: formatMiles(route.distanceMiles) },
    { label: "Driving", value: formatDuration(route.summary.drivingMinutes) },
    { label: "Arrives", value: formatDateTime(route.summary.arrivalAt) },
    { label: "Sheets", value: String(route.summary.dayCount) },
    { label: "Stops", value: String(route.stops.length) },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 sm:border-l sm:pl-6">
      {stats.map((stat) => (
        <div key={stat.label}>
          <p className="text-[10px] uppercase leading-tight tracking-wide text-muted-foreground">{stat.label}</p>
          <p className="tabular text-sm font-medium leading-tight">{stat.value}</p>
        </div>
      ))}

      {/* Outline Badge carrying the signal hue: the compliant/violating verdict has to read
          as the same green and red the gauges and timeline use, not as a neutral chip. */}
      {route.violations.length === 0 ? (
        <Badge variant="outline" className="rounded-full border-signal-ok/40 bg-signal-ok/10 text-signal-ok">
          Compliant — 0 violations
        </Badge>
      ) : (
        <Badge variant="outline" className="rounded-full border-signal-danger/40 bg-signal-danger/10 text-signal-danger">
          {route.violations.length} violations
        </Badge>
      )}
    </div>
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
