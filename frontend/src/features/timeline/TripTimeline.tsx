import { useEffect, useRef } from "react";
import { Sparkles, TriangleAlert } from "lucide-react";

import { RulePopover } from "@/features/hud/RulePopover";
import { DUTY_STATUS, RULE, formatClockTime, formatDuration, formatMiles } from "@/lib/hos";
import { cn } from "@/lib/utils";
import type { PlannedRoute, Segment } from "@/types/hos";

interface TripTimelineProps {
  route: PlannedRoute;
  activeSegmentIndex: number;
  onSelectMinute: (minute: number) => void;
}

/** Minutes of driving left to the delivery when a stop begins, if it is close enough to matter. */
function minutesFromDelivery(route: PlannedRoute, segment: Segment): number | null {
  const stop = route.stops.find(
    (candidate) => candidate.startMinute === segment.startMinute && candidate.ruleId === segment.ruleId,
  );
  return stop?.isNearDestination ? stop.minutesToDestination : null;
}

// A non-driving stop of 30+ minutes already satisfies the break rule (2020 amendment),
// so no separate break is inserted after one. Flagged rather than left silent.
function smartNote(segment: Segment, next: Segment | undefined): string | null {
  const satisfiesBreak =
    segment.status !== "D" && segment.durationMinutes >= 30 && segment.clocksAfter.breakDrivingUsed === 0;

  if (!satisfiesBreak) return null;
  if (segment.ruleId === "break-30") return null;
  // A rest long enough to reset the daily clocks obviously covers the break too; saying
  // so adds nothing.
  if (segment.durationMinutes >= 600) return null;
  if (next && next.status !== "D") return null;

  return "No separate 30-minute break needed — this stop already satisfies it.";
}

export function TripTimeline({ route, activeSegmentIndex, onSelectMinute }: TripTimelineProps) {
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSegmentIndex]);

  return (
    <ol className="flex flex-col gap-1">
      {route.segments.map((segment, index) => {
        const presentation = DUTY_STATUS[segment.status];
        const Icon = RULE[segment.ruleId].icon;
        const isActive = index === activeSegmentIndex;
        const note = smartNote(segment, route.segments[index + 1]);
        const nearDelivery = minutesFromDelivery(route, segment);

        return (
          <li key={`${segment.startMinute}-${segment.ruleId}`} ref={isActive ? activeRef : undefined}>
            <button
              type="button"
              onClick={() => onSelectMinute(segment.startMinute)}
              className={cn(
                "flex w-full items-start gap-3 rounded-md border px-2.5 py-2 text-left transition-colors",
                isActive ? "border-ring bg-accent/50" : "border-transparent hover:bg-accent/30",
              )}
            >
              <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded", presentation.bg)}>
                <Icon className="size-3.5 text-background" aria-hidden />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="tabular text-sm font-medium">{formatClockTime(segment.startMinute)}</span>
                  <span className="text-sm">{RULE[segment.ruleId].short}</span>
                  <span className="tabular text-xs text-muted-foreground">
                    {formatDuration(segment.durationMinutes)}
                  </span>
                </span>

                {segment.status === "D" && (
                  <span className="tabular block text-xs text-muted-foreground">
                    {formatMiles(segment.endMiles - segment.startMiles)} driven
                  </span>
                )}

                {note && (
                  <span className="mt-1 flex items-start gap-1 text-xs leading-relaxed text-signal-ok">
                    <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden />
                    {note}
                  </span>
                )}

                {nearDelivery !== null && (
                  <span className="mt-1 flex items-start gap-1 text-xs leading-relaxed text-signal-warn">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                    Only {formatDuration(nearDelivery)} of driving from the dropoff, but the clock has run out.
                    Part 395 has no exemption for the last few miles.
                  </span>
                )}
              </span>
            </button>

            {RULE[segment.ruleId].isStop && (
              <RulePopover ruleId={segment.ruleId}>
                <button
                  type="button"
                  className="ml-11 text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                >
                  Why is this here?
                </button>
              </RulePopover>
            )}
          </li>
        );
      })}
    </ol>
  );
}
