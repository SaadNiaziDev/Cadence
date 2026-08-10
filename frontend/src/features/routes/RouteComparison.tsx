import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatDuration, formatMiles } from "@/lib/hos";
import { cn } from "@/lib/utils";
import type { PlannedRoute } from "@/types/hos";

interface RouteComparisonProps {
  routes: PlannedRoute[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onHover: (index: number | null) => void;
}

const ROUTE_NAMES = ["Route A", "Route B", "Route C", "Route D"];

/**
 * Alternatives ranked by what they cost a driver, not by distance.
 *
 * Hours of Service is quantised: a route sixty miles longer can arrive a full day earlier
 * because it lets the driver finish a leg before the 14-hour window shuts instead of
 * parking for ten hours. Neither distance nor raw drive time can show that, which is why
 * the winning line here is the arrival datetime and the restart count rather than the
 * mileage — and why the badge names the saving in the units a driver actually feels.
 */
export function RouteComparison({ routes, selectedIndex, onSelect, onHover }: RouteComparisonProps) {
  // Nothing at all when there is no comparison to make. The planner already emits a
  // warning saying only one sensible route exists, and a card restating that in the
  // comparison slot would be the same sentence twice.
  if (routes.length < 2) return null;

  const winner = routes[selectedIndex] ?? routes[0]!;

  return (
    <Card className="gap-2 py-3" onMouseLeave={() => onHover(null)}>
      <CardHeader className="px-3">
        <CardTitle className="text-sm">Compare routes</CardTitle>
        <CardDescription className="text-xs">
          Ranked by arrival, then by how much of the 70-hour cycle each one burns.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-2 px-3">
        {routes.map((route) => (
          <RouteCard
            key={route.index}
            route={route}
            name={ROUTE_NAMES[route.index] ?? `Route ${route.index + 1}`}
            isSelected={route.index === selectedIndex}
            advantage={route.index === winner.index ? advantageOver(winner, routes) : null}
            onSelect={() => onSelect(route.index)}
            onHover={() => onHover(route.index)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function RouteCard({
  route,
  name,
  isSelected,
  advantage,
  onSelect,
  onHover,
}: {
  route: PlannedRoute;
  name: string;
  isSelected: boolean;
  advantage: string | null;
  onSelect: () => void;
  onHover: () => void;
}) {
  const stats = [
    { label: "Distance", value: formatMiles(route.distanceMiles) },
    { label: "Drive time", value: formatDuration(route.summary.drivingMinutes) },
    { label: "10-h rests", value: String(route.summary.restCount) },
    { label: "34-h restarts", value: String(route.summary.restartCount) },
    { label: "Sheets", value: String(route.summary.dayCount) },
    { label: "Cycle at arrival", value: formatDuration(route.summary.cycleUsedAtArrival) },
  ];

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={onHover}
      onFocus={onHover}
      aria-pressed={isSelected}
      className={cn(
        "flex w-full flex-col gap-2 rounded-md border p-2.5 text-left transition-colors",
        isSelected ? "border-ring bg-accent/40" : "border-border hover:bg-accent/25",
      )}
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium">{name}</span>
        {isSelected && (
          <Badge variant="outline" className="gap-1 border-signal-ok/40 bg-signal-ok/10 text-signal-ok">
            <Check aria-hidden />
            Chosen
          </Badge>
        )}
        {advantage && (
          <Badge variant="secondary" className="text-[11px]">
            {advantage}
          </Badge>
        )}
      </span>

      {/* Arrival is the headline because it is the number the ranking turns on. */}
      <span className="flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Arrives</span>
        <span className="tabular text-sm font-semibold">{formatDateTime(route.summary.arrivalAt)}</span>
      </span>

      <span className="grid grid-cols-2 gap-x-3 gap-y-1">
        {stats.map((stat) => (
          <span key={stat.label} className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{stat.label}</span>
            <span className="tabular text-[11px] font-medium">{stat.value}</span>
          </span>
        ))}
      </span>

      {route.violations.length > 0 && (
        <span className="text-[11px] text-signal-danger">{route.violations.length} violations on this route</span>
      )}
    </button>
  );
}

/**
 * What the winning route buys over the best of the rest, phrased in the unit that differs
 * most. Whole days first, because that is the difference a dispatcher acts on; then a
 * saved restart; then cycle hours. If nothing separates them, say nothing rather than
 * manufacture a distinction out of a rounding difference.
 */
function advantageOver(winner: PlannedRoute, routes: PlannedRoute[]): string | null {
  const rivals = routes.filter((route) => route.index !== winner.index);
  if (rivals.length === 0) return null;

  const runnerUp = rivals.reduce((best, route) =>
    new Date(route.summary.arrivalAt) < new Date(best.summary.arrivalAt) ? route : best,
  );

  const winnerArrival = new Date(winner.summary.arrivalAt).getTime();
  const rivalArrival = new Date(runnerUp.summary.arrivalAt).getTime();
  const savedMinutes = Math.round((rivalArrival - winnerArrival) / 60_000);

  const savedDays = Math.floor(savedMinutes / (24 * 60));
  if (savedDays >= 1) return `Arrives ${savedDays} day${savedDays === 1 ? "" : "s"} sooner`;

  const savedRestarts = runnerUp.summary.restartCount - winner.summary.restartCount;
  if (savedRestarts > 0) return `Avoids ${savedRestarts === 1 ? "a 34-hour restart" : `${savedRestarts} restarts`}`;

  const savedCycle = runnerUp.summary.cycleUsedAtArrival - winner.summary.cycleUsedAtArrival;
  if (savedCycle >= 30) return `Burns ${formatDuration(savedCycle)} less of your 70`;

  if (savedMinutes >= 30) return `Arrives ${formatDuration(savedMinutes)} sooner`;

  return null;
}
