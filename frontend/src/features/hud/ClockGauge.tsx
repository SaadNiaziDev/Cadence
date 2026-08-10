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

// A three-quarter arc, opening downward. Leaving a gap reads as an instrument dial
// rather than a progress ring, and the gap is where the remaining-time figure sits.
const START_ANGLE = 135;
const SWEEP_ANGLE = 270;
const RADIUS = 33;
const CENTER = 44;

function polar(angleDegrees: number): [number, number] {
  const radians = (angleDegrees * Math.PI) / 180;
  return [CENTER + RADIUS * Math.cos(radians), CENTER + RADIUS * Math.sin(radians)];
}

function arcPath(fraction: number): string {
  const sweep = SWEEP_ANGLE * Math.max(0, Math.min(fraction, 1));
  const [startX, startY] = polar(START_ANGLE);
  const [endX, endY] = polar(START_ANGLE + sweep);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${startX} ${startY} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${endX} ${endY}`;
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
        "group flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-colors",
        isBinding ? "border-ring bg-accent/40" : "border-transparent hover:border-border",
      )}
    >
      <span className="relative block">
        <svg viewBox="0 0 88 88" className="size-[76px]" role="meter" aria-valuenow={usedMinutes} aria-valuemin={0} aria-valuemax={limitMinutes}>
          <path d={arcPath(1)} fill="none" strokeWidth={7} strokeLinecap="round" className="stroke-muted" />
          <path
            d={arcPath(fraction)}
            fill="none"
            strokeWidth={7}
            strokeLinecap="round"
            className={cn(PRESSURE_STROKE[pressure], "transition-[d] duration-300")}
          />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center px-3">
          <span className={cn("tabular text-xs font-semibold leading-none", PRESSURE_TEXT[pressure])}>
            {formatDuration(remaining)}
          </span>
          <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">left</span>
        </span>
      </span>
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}
