import { useEffect, useState } from "react";
import { Check, ClipboardList, Clock, MapPin, Route } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const STEPS = [
  { icon: MapPin, label: "Finding your locations", detail: "Geocoding the three places you entered" },
  { icon: Route, label: "Routing the road", detail: "Asking for drivable routes and any alternatives" },
  { icon: Clock, label: "Running the four clocks", detail: "11-hour, 14-hour, 30-minute break and 70-hour cycle" },
  { icon: ClipboardList, label: "Drawing the log sheets", detail: "One FMCSA sheet per calendar day" },
] as const;

// The API is a single POST with no progress events, so these are paced on elapsed time.
// They are the stages the server genuinely works through in order, and the last one stays
// active until the response lands rather than pretending to finish early.
const STEP_DELAYS_MS = [900, 2200, 3600];

export function PlanningProgress() {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const timers = STEP_DELAYS_MS.map((delay, index) =>
      window.setTimeout(() => setActiveStep(index + 1), delay),
    );
    return () => timers.forEach(window.clearTimeout);
  }, []);

  return (
    <div className="flex size-full flex-1 flex-col items-center justify-center rounded-lg border p-8">
      <div className="flex w-full max-w-sm flex-col gap-5">
        <div className="flex flex-col gap-1 text-center">
          <p className="text-base font-semibold">Building your plan</p>
          <p className="text-sm text-muted-foreground">
            Placing every stop the regulations require between your pickup and dropoff.
          </p>
        </div>

        <ol className="flex flex-col gap-3">
          {STEPS.map((step, index) => {
            const isDone = index < activeStep;
            const isActive = index === activeStep;
            const Icon = step.icon;

            return (
              <li key={step.label} className="flex items-start gap-3">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors",
                    isDone && "border-signal-ok/40 bg-signal-ok/10 text-signal-ok",
                    isActive && "border-ring bg-accent text-foreground",
                    !isDone && !isActive && "border-border text-muted-foreground",
                  )}
                >
                  {isDone ? <Check className="size-4" /> : isActive ? <Spinner className="size-4" /> : <Icon className="size-4" />}
                </span>

                <span className="flex min-w-0 flex-col gap-0.5 pt-1">
                  <span
                    className={cn(
                      "text-sm leading-none transition-colors",
                      isDone || isActive ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {step.label}
                  </span>
                  {isActive && <span className="text-xs leading-snug text-muted-foreground">{step.detail}</span>}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="text-center text-xs text-muted-foreground">
          Geocoding and routing run against free, community-run services, so the first plan for a new pair of places
          takes a moment.
        </p>
      </div>
    </div>
  );
}
