/**
 * Coordinates for the FMCSA Driver's Daily Log sheet, traced from
 * `resources/blank-paper-log.png`.
 *
 * This module is the single source of the sheet's geometry. The screen SVG, the print
 * stylesheet and the PDF export all render from these numbers rather than each plotting
 * the form themselves — two independent renderers of one form is how they drift apart.
 *
 * Everything is expressed in one user-space unit system sized to `SHEET.width` /
 * `SHEET.height`, and the SVG viewBox does the scaling. That keeps every constant below a
 * plain number rather than a percentage of something else, which is what makes the tick
 * arithmetic checkable by hand against the paper form.
 *
 * Pure arithmetic, no React and no DOM: the grid maths is easy to get subtly wrong and is
 * far easier to assert on directly than through a rendered component.
 */

import type { DutyStatus } from "@/types/hos";

export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_HOUR = 60;

export const SHEET = {
  width: 1000,
  height: 1040,
  padding: 20,
} as const;

/**
 * The duty grid.
 *
 * `left` leaves room for the four row captions ("1. Off Duty" … "4. On Duty"), and the
 * strip between `right` and `totalsRight` is the form's "Total Hours" column.
 */
export const GRID = {
  left: 132,
  right: 900,
  totalsRight: 980,
  /** Top of the hour-label band that sits above the first status row. */
  headerTop: 372,
  headerHeight: 30,
  rowHeight: 34,
} as const;

export const GRID_TOP = GRID.headerTop + GRID.headerHeight;
export const HOUR_WIDTH = (GRID.right - GRID.left) / 24;
export const QUARTER_WIDTH = HOUR_WIDTH / 4;

/** Form row order, which is fixed by the regulation: off duty, sleeper, driving, on duty. */
export const ROW_ORDER = ["OFF", "SB", "D", "ON"] as const;

export const ROW_CAPTIONS: Record<DutyStatus, string> = {
  OFF: "1. Off Duty",
  SB: "2. Sleeper Berth",
  D: "3. Driving",
  ON: "4. On Duty (not driving)",
};

export const GRID_BOTTOM = GRID_TOP + ROW_ORDER.length * GRID.rowHeight;

/** X for a minute past this sheet's midnight. Clamped, because a sheet is exactly one day. */
export function xForMinute(minute: number): number {
  const clamped = Math.max(0, Math.min(minute, MINUTES_PER_DAY));
  return GRID.left + (clamped / MINUTES_PER_DAY) * (GRID.right - GRID.left);
}

/** X for an hour gridline, 0 (midnight) through 24 (the following midnight). */
export function xForHour(hour: number): number {
  return xForMinute(hour * MINUTES_PER_HOUR);
}

export function rowIndex(status: DutyStatus): number {
  return ROW_ORDER.indexOf(status as (typeof ROW_ORDER)[number]);
}

export function rowTop(status: DutyStatus): number {
  return GRID_TOP + rowIndex(status) * GRID.rowHeight;
}

/** The line for a duty status is drawn down the middle of its band, as on the paper form. */
export function yForStatus(status: DutyStatus): number {
  return rowTop(status) + GRID.rowHeight / 2;
}

/**
 * The hour labels across the top: midnight, 1–11, noon, 1–11, midnight.
 *
 * Twenty-five labels for twenty-four columns, because on the paper form they sit on the
 * gridlines rather than over the middle of each hour.
 */
export function hourLabels(): Array<{ hour: number; x: number; label: string; isAnchor: boolean }> {
  return Array.from({ length: 25 }, (_, hour) => {
    const isAnchor = hour === 0 || hour === 12 || hour === 24;
    const label = hour === 0 || hour === 24 ? "Mid-night" : hour === 12 ? "Noon" : String(hour % 12);
    return { hour, x: xForHour(hour), label, isAnchor };
  });
}

export interface Tick {
  x: number;
  /** How far down from the top of a row band the tick reaches. */
  depth: number;
  isHour: boolean;
}

/**
 * The quarter-hour ticks inside one row band.
 *
 * The paper form marks every 15 minutes, with the half-hour drawn deeper than the
 * quarters so a driver can read a line's start and end to the nearest quarter without
 * counting marks. Hour boundaries are full-height rules and are drawn separately.
 */
export function ticksForRow(): Tick[] {
  const ticks: Tick[] = [];
  for (let quarter = 0; quarter <= 96; quarter += 1) {
    const isHour = quarter % 4 === 0;
    const isHalf = quarter % 4 === 2;
    ticks.push({
      x: GRID.left + quarter * QUARTER_WIDTH,
      depth: isHour ? GRID.rowHeight : isHalf ? GRID.rowHeight * 0.5 : GRID.rowHeight * 0.3,
      isHour,
    });
  }
  return ticks;
}

export interface DutyRun {
  status: DutyStatus;
  startMinute: number;
  endMinute: number;
}

/**
 * The duty line: horizontal runs at each status's row, joined by vertical connectors at
 * every change.
 *
 * Emitted as one path rather than a line per entry so the connectors are genuinely
 * continuous — a driver's log line never lifts off the page, and a gap here would read as
 * unaccounted time.
 */
export function dutyPath(runs: readonly DutyRun[]): string {
  if (runs.length === 0) return "";

  const parts: string[] = [];
  let previousY: number | null = null;

  for (const run of runs) {
    const y = yForStatus(run.status);
    const startX = xForMinute(run.startMinute);
    const endX = xForMinute(run.endMinute);

    if (previousY === null) {
      parts.push(`M ${round(startX)} ${round(y)}`);
    } else if (previousY !== y) {
      parts.push(`V ${round(y)}`);
    }

    parts.push(`H ${round(endX)}`);
    previousY = y;
  }

  return parts.join(" ");
}

/** Header blocks above the grid, traced from the form's boxed fields. */
export const HEADER = {
  title: { x: SHEET.padding, y: 46 },
  subtitle: { x: SHEET.padding, y: 66 },
  dateBoxes: { y: 40, width: 74, height: 24, gap: 10, x: 300 },
  filingNote: { x: 620, y: 34, lineHeight: 16 },
  fromTo: { y: 104, labelGap: 8, lineY: 112, fromX: 20, fromLineEnd: 470, toX: 490, toLineEnd: 980 },
  milesDriving: { x: 20, y: 140, width: 200, height: 44 },
  totalMileage: { x: 236, y: 140, width: 200, height: 44 },
  vehicles: { x: 20, y: 214, width: 416, height: 44 },
  carrier: { x: 470, y: 140, width: 510, height: 40 },
  officeAddress: { x: 470, y: 196, width: 510, height: 40 },
  terminalAddress: { x: 470, y: 252, width: 510, height: 40 },
} as const;

/** The remarks band under the grid, where each change of duty is named. */
export const REMARKS = {
  x: 20,
  y: GRID_BOTTOM + 30,
  width: 960,
  height: 96,
  labelOffset: 18,
} as const;

/** Shipping-document fields down the left, below remarks. */
export const SHIPPING = {
  x: 20,
  y: REMARKS.y + REMARKS.height + 12,
  width: 460,
  rowHeight: 30,
  rows: ["Shipping Documents:", "DVL or Manifest No. or", "Shipper & Commodity"],
} as const;

export const SHIPPING_BOTTOM = SHIPPING.y + SHIPPING.rows.length * SHIPPING.rowHeight;

export const INSTRUCTIONS = {
  x: SHEET.width / 2,
  y: SHIPPING_BOTTOM + 20,
  lineHeight: 16,
  lines: [
    "Enter name of place you reported and where released from work and when and where each change of duty occurred.",
    "Use time standard of home terminal.",
  ],
} as const;

/**
 * The recap box.
 *
 * Only the 70-hour/8-day half is filled in — the assessment fixes the driver to that
 * cycle — but the 60-hour/7-day columns are still drawn, because they are on the real
 * form and a sheet missing half its recap does not read as a faithful trace.
 */
export const RECAP = {
  x: 20,
  y: INSTRUCTIONS.y + 30,
  width: 960,
  height: 132,
  captionWidth: 120,
  onDutyWidth: 130,
  columnCount: 3,
} as const;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
