import { forwardRef } from "react";

import { cn } from "@/lib/utils";
import { MINUTES_PER_HOUR, PRESSURE_STROKE, PRESSURE_TEXT, formatDuration, pressureOf } from "@/lib/hos";

interface ClockGaugeProps {
  label: string;
  caption: string;
  usedMinutes: number;
  limitHours: number;
  isBinding?: boolean;
  onClick?: () => void;
}

// Dial width and reading size are coupled. The longest value is a cycle clock at
// "57h 45m", and the space for it is the arc's mouth: diameter less the stroke either
// side. At 170px the mouth is ~117px and a 30px reading collides with the arc; 220px
// gives ~152px, which clears the same string at 26px.
const RADIUS = 40;
const CENTER_X = 50;
const CENTER_Y = 46;
const STROKE = 11;

// Half a circumference: the full arc length, used as the dash pattern.
const ARC_LENGTH = Math.PI * RADIUS;

function polar(angleDegrees: number): [number, number] {
  const radians = (angleDegrees * Math.PI) / 180;
  return [CENTER_X + RADIUS * Math.cos(radians), CENTER_Y - RADIUS * Math.sin(radians)];
}

// Sweeps left (180 deg) to right (0 deg) across the top half.
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
          {/* One fixed path revealed by dash offset: a CSS transition can ease it, and at
              full offset nothing paints, so an unused clock draws no stray round cap. */}
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

        <span className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-0.5">
          <span
            className={cn(
              "tabular whitespace-nowrap text-[26px] font-semibold leading-none tracking-tight",
              PRESSURE_TEXT[pressure],
            )}
          >
            {formatDuration(remaining)}
          </span>
          <span className="text-[11px] leading-none text-muted-foreground">left of {limitHours}h</span>
        </span>
      </span>

      {/* Space reserved either way so the row does not jolt as the binding clock changes. */}
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
