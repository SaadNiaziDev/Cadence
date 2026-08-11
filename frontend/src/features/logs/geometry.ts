// Coordinates for the FMCSA Driver's Daily Log sheet, traced from
// `resources/blank-paper-log.png`. All values are SVG user-space units against
// SHEET.width / SHEET.height; the viewBox does the scaling.

import type { DutyStatus } from "@/types/hos";

export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_HOUR = 60;

export const SHEET = {
  width: 1000,
  height: 1040,
  padding: 20,
} as const;

// `left` clears the four row captions; `right`..`totalsRight` is the "Total Hours" column.
export const GRID = {
  left: 132,
  right: 900,
  totalsRight: 980,
  headerTop: 372,
  headerHeight: 30,
  rowHeight: 34,
} as const;

export const GRID_TOP = GRID.headerTop + GRID.headerHeight;
export const HOUR_WIDTH = (GRID.right - GRID.left) / 24;
export const QUARTER_WIDTH = HOUR_WIDTH / 4;

// Grid rules are 1 unit and quarter ticks 0.5, so the duty line needs several times that
// to stay the dominant mark. 4.5 is just over an eighth of a 34-unit row band.
export const DUTY_STROKE = 4.5;

// Row order is fixed by the regulation: off duty, sleeper, driving, on duty.
export const ROW_ORDER = ["OFF", "SB", "D", "ON"] as const;

export const ROW_CAPTIONS: Record<DutyStatus, string> = {
  OFF: "1. Off Duty",
  SB: "2. Sleeper Berth",
  D: "3. Driving",
  ON: "4. On Duty (not driving)",
};

export const GRID_BOTTOM = GRID_TOP + ROW_ORDER.length * GRID.rowHeight;

// Clamped: a sheet covers exactly one day.
export function xForMinute(minute: number): number {
  const clamped = Math.max(0, Math.min(minute, MINUTES_PER_DAY));
  return GRID.left + (clamped / MINUTES_PER_DAY) * (GRID.right - GRID.left);
}

export function xForHour(hour: number): number {
  return xForMinute(hour * MINUTES_PER_HOUR);
}

export function rowIndex(status: DutyStatus): number {
  return ROW_ORDER.indexOf(status as (typeof ROW_ORDER)[number]);
}

export function rowTop(status: DutyStatus): number {
  return GRID_TOP + rowIndex(status) * GRID.rowHeight;
}

export function yForStatus(status: DutyStatus): number {
  return rowTop(status) + GRID.rowHeight / 2;
}

// 25 labels for 24 columns: on the paper form they sit on the gridlines, not over the
// middle of each hour.
export function hourLabels(): Array<{ hour: number; x: number; label: string; isAnchor: boolean }> {
  return Array.from({ length: 25 }, (_, hour) => {
    const isAnchor = hour === 0 || hour === 12 || hour === 24;
    const label = hour === 0 || hour === 24 ? "Mid-night" : hour === 12 ? "Noon" : String(hour % 12);
    return { hour, x: xForHour(hour), label, isAnchor };
  });
}

export interface Tick {
  x: number;
  depth: number;
  isHour: boolean;
}

// 96 quarter-hour ticks per row. Depth encodes the subdivision so a start or end time is
// readable to the nearest quarter: full height on the hour, half on the half-hour, 0.3
// otherwise. Hour rules themselves are drawn separately.
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

// One continuous path rather than a line per entry: a gap in the duty line would read as
// unaccounted time.
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

export const REMARKS = {
  x: 20,
  y: GRID_BOTTOM + 30,
  width: 960,
  height: 96,
  labelOffset: 18,
} as const;

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

// Only the 70-hour/8-day half is computed; the driver is fixed to that cycle. The
// 60-hour/7-day columns are drawn but left blank.
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
