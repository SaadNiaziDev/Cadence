
import {
  Bed,
  CircleParking,
  ClipboardCheck,
  Clock,
  Coffee,
  Fuel,
  Moon,
  PackageCheck,
  PackageOpen,
  Truck,
  type LucideIcon,
} from "lucide-react";

import type { ClockSnapshot, DutyStatus, RuleId } from "@/types/hos";

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 1440;
export const CYCLE_LIMIT_HOURS = 70;

interface StatusPresentation {
  label: string;
  /** Short form for the log grid's row headings, where space is tight. */
  short: string;
  icon: LucideIcon;
  /** Tailwind tokens, all resolving to the four reserved duty hues. */
  text: string;
  bg: string;
  border: string;
  /** Raw CSS variable, for canvas and MapLibre paint properties. */
  cssVar: string;
}

export const DUTY_STATUS: Record<DutyStatus, StatusPresentation> = {
  OFF: {
    label: "Off Duty",
    short: "OFF",
    icon: Moon,
    text: "text-status-off",
    bg: "bg-status-off",
    border: "border-status-off",
    cssVar: "var(--status-off)",
  },
  SB: {
    label: "Sleeper Berth",
    short: "SB",
    icon: Bed,
    text: "text-status-sleeper",
    bg: "bg-status-sleeper",
    border: "border-status-sleeper",
    cssVar: "var(--status-sleeper)",
  },
  D: {
    label: "Driving",
    short: "D",
    icon: Truck,
    text: "text-status-driving",
    bg: "bg-status-driving",
    border: "border-status-driving",
    cssVar: "var(--status-driving)",
  },
  ON: {
    label: "On Duty (Not Driving)",
    short: "ON",
    icon: ClipboardCheck,
    text: "text-status-onduty",
    bg: "bg-status-onduty",
    border: "border-status-onduty",
    cssVar: "var(--status-onduty)",
  },
};

interface RulePresentation {
  icon: LucideIcon;
  /** Short name for map markers and timeline chips. */
  short: string;
  /** Whether this rule represents a stop worth drawing on the map. */
  isStop: boolean;
}

export const RULE: Record<RuleId, RulePresentation> = {
  "drive-11": { icon: Bed, short: "10-hour rest", isStop: true },
  "window-14": { icon: Bed, short: "10-hour rest", isStop: true },
  "break-30": { icon: Coffee, short: "30-min break", isStop: true },
  "cycle-70": { icon: Clock, short: "Cycle limit", isStop: false },
  "restart-34": { icon: CircleParking, short: "34-hour restart", isStop: true },
  "fuel-1000": { icon: Fuel, short: "Fuel", isStop: true },
  pickup: { icon: PackageOpen, short: "Pickup", isStop: true },
  dropoff: { icon: PackageCheck, short: "Dropoff", isStop: true },
  inspection: { icon: ClipboardCheck, short: "Inspection", isStop: true },
  driving: { icon: Truck, short: "Driving", isStop: false },
  "off-duty": { icon: Moon, short: "Off duty", isStop: false },
};

/** The four clocks, in the order they are shown in the heads-up display. */
export const CLOCKS = [
  { key: "driving", label: "Drive", limitHours: 11, caption: "11-hour driving limit", ruleId: "drive-11" },
  { key: "window", label: "Window", limitHours: 14, caption: "14-hour driving window", ruleId: "window-14" },
  { key: "break", label: "Break", limitHours: 8, caption: "8 hours before a 30-minute break", ruleId: "break-30" },
  { key: "cycle", label: "Cycle", limitHours: 70, caption: "70 hours in 8 days", ruleId: "cycle-70" },
] as const;

export type ClockKey = (typeof CLOCKS)[number]["key"];

/** Pull the used and remaining minutes for one clock out of a snapshot. */
export function readClock(snapshot: ClockSnapshot, key: ClockKey): { used: number; remaining: number } {
  switch (key) {
    case "driving":
      return { used: snapshot.drivingUsed, remaining: snapshot.drivingRemaining };
    case "window":
      return { used: snapshot.windowUsed, remaining: snapshot.windowRemaining };
    case "break":
      return { used: snapshot.breakDrivingUsed, remaining: snapshot.breakDrivingRemaining };
    case "cycle":
      return { used: snapshot.cycleUsed, remaining: snapshot.cycleRemaining };
  }
}

export type Pressure = "ok" | "warn" | "danger";

// Amber at 80% of the limit, red at 100%.
export function pressureOf(used: number, limitMinutes: number): Pressure {
  if (limitMinutes <= 0) return "ok";
  const ratio = used / limitMinutes;
  if (ratio >= 1) return "danger";
  if (ratio >= 0.8) return "warn";
  return "ok";
}

export const PRESSURE_TEXT: Record<Pressure, string> = {
  ok: "text-signal-ok",
  warn: "text-signal-warn",
  danger: "text-signal-danger",
};

export const PRESSURE_STROKE: Record<Pressure, string> = {
  ok: "stroke-signal-ok",
  warn: "stroke-signal-warn",
  danger: "stroke-signal-danger",
};

/** "8h 45m", or "45m" when there are no whole hours to show. */
export function formatDuration(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / MINUTES_PER_HOUR);
  const remainder = rounded % MINUTES_PER_HOUR;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

/** Decimal hours as they appear in a log sheet's totals column, always two places. */
export function formatHours(minutes: number): string {
  return (minutes / MINUTES_PER_HOUR).toFixed(2);
}

/** "14:35" — 24-hour time, which is what log sheets use. */
export function formatClockTime(minutesFromMidnight: number): string {
  const withinDay = ((minutesFromMidnight % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(withinDay / MINUTES_PER_HOUR);
  const minutes = withinDay % MINUTES_PER_HOUR;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** "Mon 9 Mar, 14:35" from an ISO timestamp. */
export function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "Mon 9 Mar 2026" from an ISO date. */
export function formatDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatMiles(miles: number): string {
  return `${Math.round(miles).toLocaleString()} mi`;
}
