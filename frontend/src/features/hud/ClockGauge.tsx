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

function polar(angleDegrees: number): [number, number] {
  const radians = (angleDegrees * Math.PI) / 180;
  return [CENTER_X + RADIUS * Math.cos(radians), CENTER_Y - RADIUS * Math.sin(radians)];
}

/** Sweeps left (180°) to right (0°) across the top half. */
function arcPath(fraction: number): string {
  const clamped = Math.max(0, Math.min(fraction, 1));
  // An unused clock draws nothing at all. A zero-length path with a round cap renders as
  // a lone dot floating at the start of the track, which reads as a rendering glitch
  // rather than as "none of this clock has been used".
  if (clamped <= 0) return "";
  const [startX, startY] = polar(180);
  const [endX, endY] = polar(180 - 180 * clamped);
  return `M ${startX} ${startY} A ${RADIUS} ${RADIUS} 0 0 1 ${endX} ${endY}`;
}

export function ClockGauge({ label, caption, usedMinutes, limitHours, isBinding, onClick }: ClockGaugeProps) {
  const limitMinutes = limitHours * MINUTES_PER_HOUR;
  const remaining = Math.max(limitMinutes - usedMinutes, 0);
  const pressure = pressureOf(usedMinutes, limitMinutes);
  const fraction = limitMinutes > 0 ? usedMinutes / limitMinutes : 0;

  return (
    <button
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
          <path d={arcPath(1)} fill="none" strokeWidth={STROKE} strokeLinecap="round" className="stroke-muted" />
          <path
            d={arcPath(fraction)}
            fill="none"
            strokeWidth={STROKE}
            strokeLinecap="round"
            className={PRESSURE_STROKE[pressure]}
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
}
