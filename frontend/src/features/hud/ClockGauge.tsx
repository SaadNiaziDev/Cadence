import { forwardRef } from "react";

import { cn } from "@/lib/utils";
import { MINUTES_PER_HOUR, PRESSURE_STROKE, PRESSURE_TEXT, formatDuration, pressureOf } from "@/lib/hos";

interface ClockGaugeProps {
  label: string;
  caption: string;
  usedMinutes: number;
  limitHours: number;
  /** Highlights the clock that forced the next stop. */
  isBinding?: boolean;
  onClick?: () => void;
}

/*
  A half-circle gauge, opening upward.

  The obvious shape for a "clock" is a full or three-quarter ring, but the value that has
  to sit inside it can be as long as "58h 31m" — wider than the interior of a ring small
  enough to fit four across. A semicircle is the same height while leaving the full
  diameter free for the reading, so the number never collides with the arc.
*/
const RADIUS = 40;
const CENTER_X = 50;
const CENTER_Y = 48;
const STROKE = 8;

/** Half a circumference: the length of the full arc, used as the dash pattern. */
const ARC_LENGTH = Math.PI * RADIUS;

function polar(angleDegrees: number): [number, number] {
  const radians = (angleDegrees * Math.PI) / 180;
  return [CENTER_X + RADIUS * Math.cos(radians), CENTER_Y - RADIUS * Math.sin(radians)];
}

/** The whole arc, sweeping left (180°) to right (0°) across the top half. */
function arcPath(): string {
  const [startX, startY] = polar(180);
  const [endX, endY] = polar(0);
  return `M ${startX} ${startY} A ${RADIUS} ${RADIUS} 0 0 1 ${endX} ${endY}`;
}

// forwardRef because every gauge is a PopoverTrigger's `asChild` target, and on React 18
// a plain function component cannot receive the ref Radix needs to anchor the popover.
export const ClockGauge = forwardRef<HTMLButtonElement, ClockGaugeProps>(function ClockGauge(
  { label, caption, usedMinutes, limitHours, isBinding, onClick },
  ref,
) {
  const limitMinutes = limitHours * MINUTES_PER_HOUR;
  const remaining = Math.max(limitMinutes - usedMinutes, 0);
  const pressure = pressureOf(usedMinutes, limitMinutes);
  const fraction = limitMinutes > 0 ? Math.max(0, Math.min(usedMinutes / limitMinutes, 1)) : 0;

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title={caption}
      aria-label={`${caption}. ${formatDuration(remaining)} remaining of ${limitHours} hours.`}
      className={cn(
        "flex flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 transition-colors",
        isBinding ? "border-ring bg-accent/40" : "border-transparent hover:border-border",
      )}
    >
      <span className="relative block w-full max-w-[104px]">
        <svg
          viewBox="0 0 100 56"
          className="w-full"
          role="meter"
          aria-valuenow={usedMinutes}
          aria-valuemin={0}
          aria-valuemax={limitMinutes}
        >
          <path d={arcPath()} fill="none" strokeWidth={STROKE} strokeLinecap="round" className="stroke-muted" />
          {/* One fixed path revealed by its dash offset, rather than a path whose `d` is
              recomputed per frame. That is what lets a plain CSS transition ease the sweep
              as the scrubber moves, and it removes the old zero-length special case too:
              at full offset nothing is painted, so an unused clock draws no stray cap. */}
          <path
            d={arcPath()}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={ARC_LENGTH}
            style={{ strokeDashoffset: ARC_LENGTH * (1 - fraction) }}
            className={cn("gauge-sweep", PRESSURE_STROKE[pressure])}
          />
        </svg>

        {/* Sits inside the arc's mouth, where the full diameter is available. */}
        <span className="absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span className={cn("tabular whitespace-nowrap text-[13px] font-semibold leading-none", PRESSURE_TEXT[pressure])}>
            {formatDuration(remaining)}
          </span>
          <span className="text-[9px] uppercase leading-none tracking-wide text-muted-foreground">left</span>
        </span>
      </span>

      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
});
