import { CYCLE_LIMIT_HOURS } from "@/lib/hos";
import type { Pressure } from "@/lib/hos";

export interface CycleAdvice {
  level: Pressure;
  remainingHours: number;
  headline: string;
  detail: string;
}

// Cycle hours remaining, read before anything is planned: at 70 the driver cannot drive
// at all until a 34-hour restart, and the thresholds below step down from there.
export function adviseOnCycle(cycleUsedHours: number): CycleAdvice {
  const used = Number.isFinite(cycleUsedHours) ? Math.min(Math.max(cycleUsedHours, 0), CYCLE_LIMIT_HOURS) : 0;
  const remaining = Math.round((CYCLE_LIMIT_HOURS - used) * 10) / 10;

  if (remaining <= 0) {
    return {
      level: "danger",
      remainingHours: 0,
      headline: "No cycle hours left",
      detail:
        "You cannot legally drive until you take a 34-hour restart. This trip will be planned, but it starts with a day and a half parked.",
    };
  }

  if (remaining <= 2) {
    return {
      level: "danger",
      remainingHours: remaining,
      headline: `${remaining} hours left in your cycle`,
      detail:
        "You will hit the 70-hour limit almost immediately and need a 34-hour restart. Taking the restart before you leave usually gets you there sooner.",
    };
  }

  if (remaining <= 11) {
    return {
      level: "warn",
      remainingHours: remaining,
      headline: `${remaining} hours left in your cycle`,
      detail:
        "That is less than one full 11-hour shift. Expect a 34-hour restart part way through anything longer than a day's run.",
    };
  }

  return {
    level: "ok",
    remainingHours: remaining,
    headline: `${remaining} hours left in your cycle`,
    detail:
      remaining >= 22
        ? "Enough for two full driving shifts before the 70-hour limit becomes a factor."
        : "Enough for a full 11-hour shift with room to spare.",
  };
}
