import { useMemo, useState } from "react";
import { AlertTriangle, CircleCheck, Info, Navigation, PackageCheck, PackageOpen, Route } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CYCLE_LIMIT_HOURS } from "@/lib/hos";
import type { TripRequest } from "@/types/hos";

import { adviseOnCycle } from "./cycle-advice";
import { LocationField } from "./LocationField";
import { SAMPLE_TRIPS } from "./samples";

interface TripFormProps {
  onSubmit: (request: TripRequest) => void;
  isPending: boolean;
  /**
   * Values to open with, used when a shared link supplies a trip that was planned
   * elsewhere. Read once at mount — the caller remounts on a new trip id rather than
   * pushing values in, so typing is never overwritten mid-edit.
   */
  defaults?: Partial<FormState>;
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

/*
  The advice callout is an Alert, but its tint carries meaning the two stock variants do
  not: "ok / warn / danger" is the same three-step pressure scale the clock gauges and the
  timeline use, and it has to stay legible against them. Only the border and wash are
  themed here — structure, spacing and typography come from Alert.
*/
const ADVICE_STYLES = {
  ok: { wrapper: "border-signal-ok/40 bg-signal-ok/10", icon: CircleCheck, tint: "text-signal-ok" },
  warn: { wrapper: "border-signal-warn/40 bg-signal-warn/10", icon: Info, tint: "text-signal-warn" },
  danger: { wrapper: "border-signal-danger/50 bg-signal-danger/10", icon: AlertTriangle, tint: "text-signal-danger" },
} as const;

export function TripForm({ onSubmit, isPending, defaults }: TripFormProps) {
  const [form, setForm] = useState<FormState>({
    current: "",
    pickup: "",
    dropoff: "",
    cycleUsed: "0",
    startDateTime: defaultStart(),
    compareRoutes: true,
    ...defaults,
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
  const cycleError = showErrors ? errors.cycleUsed : undefined;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <FieldGroup className="gap-5">
        <FieldGroup className="gap-4">
          <LocationField
            id="current-location"
            label="Current location"
            placeholder="Where is the truck now?"
            value={form.current}
            onChange={(value) => update("current", value)}
            icon={Navigation}
            error={showErrors ? errors.current : undefined}
          />
          <LocationField
            id="pickup-location"
            label="Pickup"
            placeholder="Where is the load collected?"
            value={form.pickup}
            onChange={(value) => update("pickup", value)}
            icon={PackageOpen}
            error={showErrors ? errors.pickup : undefined}
          />
          <LocationField
            id="dropoff-location"
            label="Dropoff"
            placeholder="Where is the load delivered?"
            value={form.dropoff}
            onChange={(value) => update("dropoff", value)}
            icon={PackageCheck}
            error={showErrors ? errors.dropoff : undefined}
          />
        </FieldGroup>

        <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field className="gap-1.5" data-invalid={cycleError ? true : undefined}>
            <FieldLabel htmlFor="cycle-used" className="text-xs uppercase tracking-wide text-muted-foreground">
              Cycle hours used
            </FieldLabel>
            <Input
              id="cycle-used"
              type="number"
              inputMode="decimal"
              min={0}
              max={CYCLE_LIMIT_HOURS}
              step={0.5}
              value={form.cycleUsed}
              onChange={(event) => update("cycleUsed", event.target.value)}
              aria-invalid={Boolean(cycleError)}
              className="tabular h-11"
            />
            <FieldError>{cycleError}</FieldError>
          </Field>

          <Field className="gap-1.5">
            <FieldLabel htmlFor="start-time" className="text-xs uppercase tracking-wide text-muted-foreground">
              Departure
            </FieldLabel>
            <Input
              id="start-time"
              type="datetime-local"
              value={form.startDateTime}
              onChange={(event) => update("startDateTime", event.target.value)}
              className="tabular h-11"
            />
          </Field>
        </FieldGroup>

        {/* The prevention layer: the consequence of the cycle balance, while it is still
            being typed rather than after a plan has been read. */}
        <Alert className={ADVICE_STYLES[advice.level].wrapper} aria-live="polite">
          <AdviceIcon className={ADVICE_STYLES[advice.level].tint} aria-hidden />
          <AlertTitle>{advice.headline}</AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">{advice.detail}</AlertDescription>
        </Alert>

        <Field orientation="horizontal" className="rounded-md border px-3 py-2.5">
          <FieldContent>
            <FieldLabel htmlFor="compare-routes">Compare routes</FieldLabel>
            <FieldDescription className="text-xs">Rank alternatives by arrival time, not distance.</FieldDescription>
          </FieldContent>
          <Switch
            id="compare-routes"
            checked={form.compareRoutes}
            onCheckedChange={(checked) => update("compareRoutes", checked)}
          />
        </Field>

        <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={isPending}>
          {isPending ? <Spinner /> : <Route aria-hidden />}
          {isPending ? "Planning…" : "Plan this trip"}
        </Button>

        <FieldSeparator />

        <Field className="gap-2">
          {/* FieldTitle rather than FieldLabel: these prefill the whole form, so there is no
              single control for a label to point at. */}
          <FieldTitle className="text-xs uppercase tracking-wide text-muted-foreground">Or try one</FieldTitle>
          <div className="flex flex-wrap gap-2">
            {SAMPLE_TRIPS.map((sample) => (
              <Tooltip key={sample.name}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() =>
                      setForm((previous) => ({
                        ...previous,
                        current: sample.current,
                        pickup: sample.pickup,
                        dropoff: sample.dropoff,
                        cycleUsed: String(sample.cycleUsedHours),
                      }))
                    }
                  >
                    {sample.name}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{sample.why}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </Field>
      </FieldGroup>
    </form>
  );
}
