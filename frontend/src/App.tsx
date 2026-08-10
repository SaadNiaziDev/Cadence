import { Suspense, lazy, useState } from "react";
import { AlertTriangle, Clock, Info, Moon, Sun } from "lucide-react";

import { ApiError } from "@/api/client";
import { usePlanTrip } from "@/api/trips";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TripForm } from "@/features/trip/TripForm";
import { useTheme } from "@/hooks/use-theme";
import { formatDateTime, formatDuration, formatMiles } from "@/lib/hos";
import type { Trip, TripRequest } from "@/types/hos";

// MapLibre is by far the heaviest dependency here — about 270 kB gzipped — and nothing
// needs it until a trip has actually been planned, so it is fetched only once there is a
// route to draw. That keeps the form itself on a 47 kB entry chunk.
const TripMap = lazy(() => import("@/features/map/TripMap").then((module) => ({ default: module.TripMap })));

export default function App() {
  const { theme, toggle } = useTheme();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [selectedRoute, setSelectedRoute] = useState(0);

  const plan = usePlanTrip();

  function handleSubmit(request: TripRequest) {
    plan.mutate(request, {
      onSuccess: (result) => {
        setTrip(result);
        setSelectedRoute(result.selectedIndex);
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

        <section className="min-h-[60vh] lg:min-h-0" aria-label="Route map">
          {plan.isPending ? (
            <Skeleton className="size-full min-h-[60vh] rounded-lg" />
          ) : trip ? (
            <div className="flex h-full min-h-[60vh] flex-col gap-3">
              <TripSummaryBar trip={trip} selectedRoute={selectedRoute} />
              <div className="min-h-[50vh] flex-1">
                <Suspense fallback={<Skeleton className="size-full rounded-lg" />}>
                  <TripMap
                    routes={trip.routes}
                    selectedIndex={selectedRoute}
                    waypoints={trip.waypoints}
                    theme={theme}
                    onSelectRoute={setSelectedRoute}
                  />
                </Suspense>
              </div>
            </div>
          ) : (
            <EmptyState />
          )}
        </section>
      </main>
    </div>
  );
}

function TripSummaryBar({ trip, selectedRoute }: { trip: Trip; selectedRoute: number }) {
  const route = trip.routes[selectedRoute] ?? trip.routes[0];
  if (!route) return null;

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
