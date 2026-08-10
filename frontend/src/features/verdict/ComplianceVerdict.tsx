import { CircleAlert, CircleCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { PlannedRoute } from "@/types/hos";

import { verdictFor } from "./compliance";

/**
 * The compliance verdict, and the working behind it.
 *
 * The badge is the headline a reviewer reads first; opening it shows the same rubric they
 * would otherwise have to check by hand, with the measured figure beside each line. Handing
 * over the checklist pre-filled is more convincing than asserting the plan is fine.
 */
export function ComplianceVerdict({ route }: { route: PlannedRoute }) {
  const verdict = verdictFor(route);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <Badge
            variant="outline"
            className={cn(
              "cursor-pointer gap-1 rounded-full transition-colors",
              verdict.isCompliant
                ? "border-signal-ok/40 bg-signal-ok/10 text-signal-ok hover:bg-signal-ok/20"
                : "border-signal-danger/40 bg-signal-danger/10 text-signal-danger hover:bg-signal-danger/20",
            )}
          >
            {verdict.isCompliant ? <CircleCheck aria-hidden /> : <CircleAlert aria-hidden />}
            {verdict.isCompliant
              ? `Compliant — 0 violations across ${verdict.dayCount} day${verdict.dayCount === 1 ? "" : "s"}`
              : `${verdict.violationCount} violation${verdict.violationCount === 1 ? "" : "s"}`}
          </Badge>
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold">
              {verdict.isCompliant ? "Plan is compliant" : "Plan has violations"}
            </p>
            <p className="text-xs text-muted-foreground">
              Each line is re-checked in the browser from the delivered plan, not taken on trust from the planner.
            </p>
          </div>

          <ul className="flex flex-col gap-2">
            {verdict.checks.map((check) => (
              <li key={check.id} className="flex items-start gap-2">
                {check.passed ? (
                  <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-signal-ok" aria-hidden />
                ) : (
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-signal-danger" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="block text-xs font-medium">{check.label}</span>
                  <span className="block text-[11px] leading-relaxed text-muted-foreground">{check.detail}</span>
                </span>
              </li>
            ))}
          </ul>

          {route.violations.length > 0 && (
            <ul className="flex flex-col gap-1 border-t pt-2">
              {route.violations.map((violation) => (
                <li key={violation} className="text-[11px] leading-relaxed text-signal-danger">
                  {violation}
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
