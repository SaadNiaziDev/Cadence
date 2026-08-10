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

  Sized for the real reading conditions rather than for the layout: this is the one panel a
  driver checks at a glance in a moving cab, so the reading is set large and the arc is
  thick enough to read as a bar from arm's length. Four of these fill the width of the
  panel they sit in, which is also what stops the row looking like four small dials
  marooned in a wide empty card.

  The dial's width and the reading's size are coupled and cannot be tuned separately. The
  longest value this has to hold is a cycle clock at "57h 45m", and the space available for
  it is the arc's mouth — the diameter less the stroke on either side. At 170px wide that
  mouth is about 117px, which a 30px reading overruns, and the digits then collide with the
  arc at both ends. 220px buys a 152px mouth, which clears the same string at 26px with
  room to spare.
*/
const RADIUS = 40;
const CENTER_X = 50;
const CENTER_Y = 46;
const STROKE = 11;

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
      aria-label={`${caption}. ${formatDuration(remaining)} remaining of ${limitHours} hours.`}
      className={cn(
        "group flex min-h-[44px] flex-col items-center gap-1 rounded-xl border px-3 py-2 transition-colors",
        isBinding ? "border-ring bg-accent/50" : "border-transparent hover:bg-accent/30",
      )}
    >
      {/* Label above the dial rather than below it: a driver scanning the row is looking
          for a named clock first and its reading second, and the label is what they scan. */}
      <span className="text-[13px] font-semibold leading-none">{label}</span>

      <span className="relative block w-full max-w-[220px]">
        <svg
          viewBox="0 0 100 52"
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
        <span className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-0.5">
          <span
            className={cn(
              "tabular whitespace-nowrap text-[26px] font-semibold leading-none tracking-tight",
              PRESSURE_TEXT[pressure],
            )}
          >
            {formatDuration(remaining)}
          </span>
          {/* "left of 11h" rather than a bare "left": the remaining figure only means
              something against the limit it is counting down from, and printing the limit
              beside the label as well just showed the same number twice at trip start. */}
          <span className="text-[11px] leading-none text-muted-foreground">left of {limitHours}h</span>
        </span>
      </span>

      {/* Reserved whether or not this clock is the binding one, so the row does not jolt
          upward as the scrubber moves the constraint from one clock to another. */}
      <span
        className={cn(
          "text-[11px] font-medium leading-none",
          isBinding ? "text-signal-warn" : "invisible",
        )}
      >
        Forces next stop
      </span>
    </button>
  );
});
