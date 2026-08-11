import { Fragment, useEffect, useMemo, useRef } from "react";
import { CircleHelp, Sparkles, TriangleAlert } from "lucide-react";

import { RulePopover } from "@/features/hud/RulePopover";
import {
  DUTY_STATUS,
  MINUTES_PER_DAY,
  RULE,
  formatClockTime,
  formatDuration,
  formatMiles,
} from "@/lib/hos";
import { cn } from "@/lib/utils";
import type { ClockSnapshot, PlannedRoute, Segment } from "@/types/hos";

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

// Whichever of the four clocks has least left is the one that will stop the truck next,
// so it is the only one worth printing on a driving row. At zero the clock is what forces
// the stop that follows, and naming the consequence reads better than "0m left".
function tightestClock(clocks: ClockSnapshot): string {
  const candidates = [
    { label: "drive", spent: "11-hour limit reached", remaining: clocks.drivingRemaining },
    { label: "window", spent: "14-hour window closed", remaining: clocks.windowRemaining },
    { label: "break", spent: "break now due", remaining: clocks.breakDrivingRemaining },
    { label: "cycle", spent: "70-hour cycle spent", remaining: clocks.cycleRemaining },
  ];
  const tightest = candidates.reduce((least, clock) => (clock.remaining < least.remaining ? clock : least));
  return tightest.remaining <= 0 ? tightest.spent : `${formatDuration(tightest.remaining)} ${tightest.label} left`;
}

function dayLabel(startAt: string, dayIndex: number): string {
  const parsed = new Date(startAt);
  if (Number.isNaN(parsed.getTime())) return `Day ${dayIndex + 1}`;
  return `Day ${dayIndex + 1} · ${parsed.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  })}`;
}

export function TripTimeline({ route, activeSegmentIndex, onSelectMinute }: TripTimelineProps) {
  const activeRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeSegmentIndex]);

  // Segments carry no place name, but a stop at the same minute under the same rule is the
  // same event, so the name can be borrowed from there.
  const locations = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const stop of route.stops) byKey.set(`${stop.startMinute}-${stop.ruleId}`, stop.location);
    return byKey;
  }, [route.stops]);

  return (
    <ol className="flex flex-col">
      {route.segments.map((segment, index) => {
        const presentation = DUTY_STATUS[segment.status];
        const rule = RULE[segment.ruleId];
        const Icon = rule.icon;
        const isActive = index === activeSegmentIndex;
        const isLast = index === route.segments.length - 1;
        const note = smartNote(segment, route.segments[index + 1]);
        const nearDelivery = minutesFromDelivery(route, segment);
        const location = locations.get(`${segment.startMinute}-${segment.ruleId}`);
        const miles = segment.endMiles - segment.startMiles;

        const dayIndex = Math.floor(segment.startMinute / MINUTES_PER_DAY);
        const startsNewDay =
          index === 0 || dayIndex !== Math.floor(route.segments[index - 1]!.startMinute / MINUTES_PER_DAY);

        const tightest = segment.status === "D" ? tightestClock(segment.clocksAfter) : null;

        return (
          <Fragment key={`${segment.startMinute}-${segment.ruleId}`}>
            {startsNewDay && (
              <li className="flex items-center gap-2 pb-2 pt-3 first:pt-0" aria-hidden>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {dayLabel(segment.startAt, dayIndex)}
                </span>
                <span className="h-px flex-1 bg-border" />
              </li>
            )}

            <li className="relative" ref={isActive ? activeRef : undefined}>
              {/* Spine between consecutive markers, aligned to the icon's centre. */}
              {!isLast && <span className="absolute bottom-0 left-6.5 top-9 w-px bg-border" aria-hidden />}

              <button
                type="button"
                onClick={() => onSelectMinute(segment.startMinute)}
                className={cn(
                  "relative flex w-full items-start gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                  isActive ? "border-ring bg-accent/50" : "border-transparent hover:bg-accent/30",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-background",
                    presentation.bg,
                  )}
                >
                  <Icon className="size-3.5 text-background" aria-hidden />
                </span>

                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="tabular text-sm font-semibold">
                      {formatClockTime(segment.startMinute)}
                      <span className="font-normal text-muted-foreground">
                        {" → "}
                        {formatClockTime(segment.endMinute)}
                      </span>
                    </span>
                    <span className="text-sm">{rule.short}</span>
                    <span className="tabular ml-auto text-xs font-medium text-muted-foreground">
                      {formatDuration(segment.durationMinutes)}
                    </span>
                  </span>

                  <span className="tabular flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                    {location && <span className="min-w-0 truncate">{location}</span>}
                    {segment.status === "D" && miles >= 1 && <span>{formatMiles(miles)}</span>}
                    {tightest && <span>{tightest}</span>}
                  </span>

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

              {rule.isStop && (
                <RulePopover ruleId={segment.ruleId}>
                  <button
                    type="button"
                    className="ml-13 mt-0.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <CircleHelp className="size-3" aria-hidden />
                    Why is this here?
                  </button>
                </RulePopover>
              )}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
