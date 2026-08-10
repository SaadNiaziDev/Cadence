import { useMemo, useState } from "react";
import { AlertTriangle, CircleCheck, Info, Navigation, PackageCheck, PackageOpen, Route } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CYCLE_LIMIT_HOURS } from "@/lib/hos";
import { cn } from "@/lib/utils";
import type { TripRequest } from "@/types/hos";

import { adviseOnCycle } from "./cycle-advice";
import { LocationField } from "./LocationField";
import { SAMPLE_TRIPS } from "./samples";

interface TripFormProps {
  onSubmit: (request: TripRequest) => void;
  isPending: boolean;
}

interface FormState {
  current: string;
  pickup: string;
  dropoff: string;
  cycleUsed: string;
  startDateTime: string;
  compareRoutes: boolean;
}

/** Now, rounded down to the minute, in the format a datetime-local input expects. */
function defaultStart(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  const offsetMinutes = now.getTimezoneOffset();
  return new Date(now.getTime() - offsetMinutes * 60_000).toISOString().slice(0, 16);
}

const ADVICE_STYLES = {
  ok: { wrapper: "border-signal-ok/40 bg-signal-ok/10", icon: CircleCheck, tint: "text-signal-ok" },
  warn: { wrapper: "border-signal-warn/40 bg-signal-warn/10", icon: Info, tint: "text-signal-warn" },
  danger: { wrapper: "border-signal-danger/50 bg-signal-danger/10", icon: AlertTriangle, tint: "text-signal-danger" },
} as const;

export function TripForm({ onSubmit, isPending }: TripFormProps) {
  const [form, setForm] = useState<FormState>({
    current: "",
    pickup: "",
    dropoff: "",
    cycleUsed: "0",
    startDateTime: defaultStart(),
    compareRoutes: true,
  });
  const [showErrors, setShowErrors] = useState(false);

  const cycleUsedHours = Number.parseFloat(form.cycleUsed);
  const advice = useMemo(() => adviseOnCycle(cycleUsedHours), [cycleUsedHours]);

  const errors = {
    current: form.current.trim() ? undefined : "Where is the truck now?",
    pickup: form.pickup.trim() ? undefined : "Where is the load collected?",
    dropoff: form.dropoff.trim() ? undefined : "Where is the load delivered?",
    cycleUsed:
      Number.isFinite(cycleUsedHours) && cycleUsedHours >= 0 && cycleUsedHours <= CYCLE_LIMIT_HOURS
        ? undefined
        : `Enter a number between 0 and ${CYCLE_LIMIT_HOURS}.`,
  };
  const isValid = Object.values(errors).every((error) => error === undefined);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setShowErrors(true);
    if (!isValid) return;

    onSubmit({
      current_location: form.current.trim(),
      pickup_location: form.pickup.trim(),
      dropoff_location: form.dropoff.trim(),
      cycle_used_hours: cycleUsedHours,
      start_datetime: form.startDateTime ? `${form.startDateTime}:00` : undefined,
      compare_routes: form.compareRoutes,
    });
  }

  const AdviceIcon = ADVICE_STYLES[advice.level].icon;

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="space-y-4">
        <LocationField
          id="current-location"
          label="Current location"
          placeholder="Where is the truck now?"
          value={form.current}
          onChange={(value) => update("current", value)}
          icon={<Navigation className="size-4" aria-hidden />}
          error={showErrors ? errors.current : undefined}
        />
        <LocationField
          id="pickup-location"
          label="Pickup"
          placeholder="Where is the load collected?"
          value={form.pickup}
          onChange={(value) => update("pickup", value)}
          icon={<PackageOpen className="size-4" aria-hidden />}
          error={showErrors ? errors.pickup : undefined}
        />
        <LocationField
          id="dropoff-location"
          label="Dropoff"
          placeholder="Where is the load delivered?"
          value={form.dropoff}
          onChange={(value) => update("dropoff", value)}
          icon={<PackageCheck className="size-4" aria-hidden />}
          error={showErrors ? errors.dropoff : undefined}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cycle-used" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Cycle hours used
          </Label>
          <Input
            id="cycle-used"
            type="number"
            inputMode="decimal"
            min={0}
            max={CYCLE_LIMIT_HOURS}
            step={0.5}
            value={form.cycleUsed}
            onChange={(event) => update("cycleUsed", event.target.value)}
            aria-invalid={showErrors && Boolean(errors.cycleUsed)}
            className={cn("tabular h-11", showErrors && errors.cycleUsed && "border-destructive")}
          />
          {showErrors && errors.cycleUsed && <p className="text-xs text-destructive">{errors.cycleUsed}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="start-time" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Departure
          </Label>
          <Input
            id="start-time"
            type="datetime-local"
            value={form.startDateTime}
            onChange={(event) => update("startDateTime", event.target.value)}
            className="tabular h-11"
          />
        </div>
      </div>

      {/* The prevention layer: the consequence of the cycle balance, while it is still
          being typed rather than after a plan has been read. */}
      <div
        className={cn("flex gap-3 rounded-md border p-3", ADVICE_STYLES[advice.level].wrapper)}
        role="status"
        aria-live="polite"
      >
        <AdviceIcon className={cn("mt-0.5 size-4 shrink-0", ADVICE_STYLES[advice.level].tint)} aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium">{advice.headline}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{advice.detail}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5">
        <div>
          <Label htmlFor="compare-routes" className="text-sm font-medium">
            Compare routes
          </Label>
          <p className="text-xs text-muted-foreground">Rank alternatives by arrival time, not distance.</p>
        </div>
        <Switch
          id="compare-routes"
          checked={form.compareRoutes}
          onCheckedChange={(checked) => update("compareRoutes", checked)}
        />
      </div>

      <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={isPending}>
        <Route className="size-4" aria-hidden />
        {isPending ? "Planning…" : "Plan this trip"}
      </Button>

      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Or try one</p>
        <div className="flex flex-wrap gap-2">
          {SAMPLE_TRIPS.map((sample) => (
            <button
              key={sample.name}
              type="button"
              title={sample.why}
              onClick={() =>
                setForm((previous) => ({
                  ...previous,
                  current: sample.current,
                  pickup: sample.pickup,
                  dropoff: sample.dropoff,
                  cycleUsed: String(sample.cycleUsedHours),
                }))
              }
              className="rounded-full border border-border px-3 py-1.5 text-xs transition-colors hover:border-primary/50 hover:bg-accent"
            >
              {sample.name}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
