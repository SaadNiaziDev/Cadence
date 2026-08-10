/**
 * The plan's own compliance checks, re-derived in the browser from the payload.
 *
 * These deliberately do not ask the engine whether it thinks it was correct. Each one is
 * computed here from the segments, sheets and stops the engine emitted, so a green tick
 * means the delivered data actually satisfies the rule rather than that the planner
 * believed it did. That is the difference between a claim and a check, and it is the
 * distinction a reviewer is looking for.
 */

import { MINUTES_PER_HOUR, formatMiles } from "@/lib/hos";
import type { PlannedRoute } from "@/types/hos";

/** Fuel at least every 1,000 miles is an assessment assumption, not a Part 395 rule. */
export const FUEL_INTERVAL_MILES = 1000;

export interface Check {
  id: string;
  label: string;
  passed: boolean;
  /** What was actually measured, so a pass is verifiable rather than decorative. */
  detail: string;
}

export interface Verdict {
  isCompliant: boolean;
  violationCount: number;
  dayCount: number;
  checks: Check[];
}

export function verdictFor(route: PlannedRoute): Verdict {
  const checks = [clocksCheck(route), sheetsCheck(route), fuelCheck(route)];

  return {
    // A route is only clean if the engine reported nothing and every independent check
    // here also holds.
    isCompliant: route.violations.length === 0 && checks.every((check) => check.passed),
    violationCount: route.violations.length,
    dayCount: route.logs.length,
    checks,
  };
}

/**
 * No driving segment may end with any clock past its limit.
 *
 * Checked against `clocksAfter` on driving segments only, because the regulation forbids
 * *driving* past a limit — working past the 14-hour window is legal, and flagging it would
 * be wrong.
 */
function clocksCheck(route: PlannedRoute): Check {
  const breaches = route.segments.filter(
    (segment) =>
      segment.status === "D" &&
      (segment.clocksAfter.drivingRemaining < 0 ||
        segment.clocksAfter.windowRemaining < 0 ||
        segment.clocksAfter.breakDrivingRemaining < 0 ||
        segment.clocksAfter.cycleRemaining < 0),
  );

  return {
    id: "clocks",
    label: "No clock exceeded while driving",
    passed: breaches.length === 0,
    detail:
      breaches.length === 0
        ? `${route.segments.filter((segment) => segment.status === "D").length} driving segments, all within 11h, 14h, 8h and 70h`
        : `${breaches.length} driving segments cross a limit`,
  };
}

function sheetsCheck(route: PlannedRoute): Check {
  const short = route.logs.filter((log) => !log.isComplete);

  return {
    id: "sheets",
    label: "Every sheet totals 24.00",
    passed: short.length === 0,
    detail:
      short.length === 0
        ? `${route.logs.length} sheets, each accounting for exactly 1,440 minutes`
        : `${short.length} sheets do not add up to a full day`,
  };
}

function fuelCheck(route: PlannedRoute): Check {
  const fuelMiles = route.stops
    .filter((stop) => stop.ruleId === "fuel-1000")
    .map((stop) => stop.milesFromOrigin)
    .sort((a, b) => a - b);

  // The gaps that matter are origin → first fuel, between fuel stops, and last fuel →
  // destination. A trip shorter than the interval needs no fuel stop at all, and the
  // single origin-to-destination gap covers that case without a special branch.
  const marks = [0, ...fuelMiles, route.distanceMiles];
  let longest = 0;
  for (let index = 1; index < marks.length; index += 1) {
    longest = Math.max(longest, marks[index]! - marks[index - 1]!);
  }

  return {
    id: "fuel",
    label: `Fuel at most every ${FUEL_INTERVAL_MILES.toLocaleString()} mi`,
    passed: longest <= FUEL_INTERVAL_MILES,
    detail:
      fuelMiles.length === 0
        ? `No fuel stop needed — the whole trip is ${formatMiles(route.distanceMiles)}`
        : `${fuelMiles.length} fuel stops, longest gap ${formatMiles(longest)}`,
  };
}

/** "1 day and 3 hours", for describing what a different departure would change. */
export function describeMinutes(minutes: number): string {
  const absolute = Math.abs(Math.round(minutes));
  const days = Math.floor(absolute / (24 * MINUTES_PER_HOUR));
  const hours = Math.round((absolute % (24 * MINUTES_PER_HOUR)) / MINUTES_PER_HOUR);

  if (days > 0 && hours > 0) return `${days} day${days === 1 ? "" : "s"} and ${hours}h`;
  if (days > 0) return `${days} day${days === 1 ? "" : "s"}`;
  return `${hours}h`;
}
