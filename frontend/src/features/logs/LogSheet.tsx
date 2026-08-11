import { Fragment, forwardRef, useMemo } from "react";

import { DUTY_STATUS, formatClockTime, formatDuration, formatHours, formatMiles } from "@/lib/hos";
import { cn } from "@/lib/utils";
import type { DailyLog, LogEntry } from "@/types/hos";

import type { CarrierDetails } from "./carrier-details";
import {
  DUTY_STROKE,
  GRID,
  GRID_BOTTOM,
  GRID_TOP,
  HEADER,
  INSTRUCTIONS,
  RECAP,
  REMARKS,
  ROW_CAPTIONS,
  ROW_ORDER,
  SHEET,
  SHIPPING,
  dutyPath,
  hourLabels,
  rowTop,
  ticksForRow,
  xForMinute,
  yForStatus,
} from "./geometry";

interface LogSheetProps {
  log: DailyLog;
  details: CarrierDetails;
  /** Minutes past this sheet's midnight; null when the scrubber is on another day. */
  playheadMinute?: number | null;
  onSelectMinute?: (minuteOfDay: number) => void;
  className?: string;
}

const CYCLE_LIMIT_MINUTES = 70 * 60;

export const LogSheet = forwardRef<SVGSVGElement, LogSheetProps>(function LogSheet(
  { log, details, playheadMinute, onSelectMinute, className },
  ref,
) {
  const runs = useMemo(
    () => log.entries.map((entry) => ({ status: entry.status, startMinute: entry.startMinute, endMinute: entry.endMinute })),
    [log.entries],
  );

  const path = useMemo(() => dutyPath(runs), [runs]);

  const remarks = useMemo(() => selectRemarks(log.entries), [log.entries]);

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${SHEET.width} ${SHEET.height}`}
      className={cn("log-sheet w-full", className)}
      role="img"
      aria-label={`Driver's daily log for ${log.date}`}
    >
      <rect x={0} y={0} width={SHEET.width} height={SHEET.height} fill="var(--sheet-paper)" />

      <SheetHeader log={log} details={details} />
      <DutyGrid log={log} />

      <path
        d={path}
        fill="none"
        stroke="var(--sheet-ink)"
        strokeWidth={DUTY_STROKE}
        strokeLinejoin="miter"
        strokeLinecap="butt"
        pointerEvents="none"
      />

      {/* Colour drawn over the black line, not instead of it: the regulation asks for the
          line, the hue matches the map and timeline. */}
      {log.entries.map((entry) => (
        <line
          key={`ink-${entry.startMinute}-${entry.status}`}
          x1={xForMinute(entry.startMinute)}
          y1={yForStatus(entry.status)}
          x2={xForMinute(entry.endMinute)}
          y2={yForStatus(entry.status)}
          stroke={DUTY_STATUS[entry.status].cssVar}
          strokeWidth={DUTY_STROKE}
          pointerEvents="none"
        />
      ))}

      {playheadMinute != null && (
        <line
          x1={xForMinute(playheadMinute)}
          y1={GRID_TOP - 6}
          x2={xForMinute(playheadMinute)}
          y2={GRID_BOTTOM + 6}
          stroke="var(--sheet-ink)"
          strokeWidth={2}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}

      <EntryHitAreas entries={log.entries} onSelectMinute={onSelectMinute} />
      <Remarks entries={remarks} />
      <ShippingBlock details={details} />
      <Instructions />
      <Recap log={log} />
    </svg>
  );
});

function SheetHeader({ log, details }: { log: DailyLog; details: CarrierDetails }) {
  const [year, month, day] = log.date.split("-");

  return (
    <g>
      <text x={HEADER.title.x} y={HEADER.title.y} className="sheet-title" fill="var(--sheet-ink)">
        Drivers Daily Log
      </text>
      <text x={HEADER.subtitle.x} y={HEADER.subtitle.y} className="sheet-caption" fill="var(--sheet-muted)">
        (24 hours)
      </text>

      {[
        { value: month, caption: "(month)" },
        { value: day, caption: "(day)" },
        { value: year, caption: "(year)" },
      ].map((part, index) => {
        const x = HEADER.dateBoxes.x + index * (HEADER.dateBoxes.width + HEADER.dateBoxes.gap);
        return (
          <Fragment key={part.caption}>
            <line
              x1={x}
              y1={HEADER.dateBoxes.y + HEADER.dateBoxes.height}
              x2={x + HEADER.dateBoxes.width}
              y2={HEADER.dateBoxes.y + HEADER.dateBoxes.height}
              stroke="var(--sheet-ink)"
            />
            <text
              x={x + HEADER.dateBoxes.width / 2}
              y={HEADER.dateBoxes.y + HEADER.dateBoxes.height - 6}
              textAnchor="middle"
              className="sheet-value"
              fill="var(--sheet-ink)"
            >
              {part.value}
            </text>
            <text
              x={x + HEADER.dateBoxes.width / 2}
              y={HEADER.dateBoxes.y + HEADER.dateBoxes.height + 14}
              textAnchor="middle"
              className="sheet-caption"
              fill="var(--sheet-muted)"
            >
              {part.caption}
            </text>
          </Fragment>
        );
      })}

      <text x={HEADER.filingNote.x} y={HEADER.filingNote.y} className="sheet-caption" fill="var(--sheet-muted)">
        Original — File at home terminal.
      </text>
      <text
        x={HEADER.filingNote.x}
        y={HEADER.filingNote.y + HEADER.filingNote.lineHeight}
        className="sheet-caption"
        fill="var(--sheet-muted)"
      >
        Duplicate — Driver retains in his/her possession for 8 days.
      </text>

      <FieldLine x={HEADER.fromTo.fromX} y={HEADER.fromTo.lineY} endX={HEADER.fromTo.fromLineEnd} label="From:" />
      <FieldLine x={HEADER.fromTo.toX} y={HEADER.fromTo.lineY} endX={HEADER.fromTo.toLineEnd} label="To:" />

      {/* Same figure in both boxes: they differ only under personal conveyance, which this
          planner never schedules. */}
      <BoxedField box={HEADER.milesDriving} caption="Total Miles Driving Today" value={formatMiles(log.drivingMiles)} />
      <BoxedField box={HEADER.totalMileage} caption="Total Mileage Today" value={formatMiles(log.drivingMiles)} />
      <BoxedField
        box={HEADER.vehicles}
        caption="Truck/Tractor and Trailer Numbers or License Plate(s)/State (show each unit)"
        value={details.vehicles}
      />
      <BoxedField box={HEADER.carrier} caption="Name of Carrier or Carriers" value={details.carrier} captionBelow />
      <BoxedField box={HEADER.officeAddress} caption="Main Office Address" value={details.officeAddress} captionBelow />
      <BoxedField
        box={HEADER.terminalAddress}
        caption="Home Terminal Address"
        value={details.terminalAddress}
        captionBelow
      />
    </g>
  );
}

function FieldLine({ x, y, endX, label }: { x: number; y: number; endX: number; label: string }) {
  return (
    <g>
      <text x={x} y={y - 4} className="sheet-label" fill="var(--sheet-ink)">
        {label}
      </text>
      <line x1={x + 46} y1={y} x2={endX} y2={y} stroke="var(--sheet-ink)" />
    </g>
  );
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function BoxedField({
  box,
  caption,
  value,
  captionBelow,
}: {
  box: Box;
  caption: string;
  value: string;
  captionBelow?: boolean;
}) {
  return (
    <g>
      <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="none" stroke="var(--sheet-ink)" />
      <text
        x={box.x + box.width / 2}
        y={box.y + box.height / 2 + 5}
        textAnchor="middle"
        className="sheet-value"
        fill="var(--sheet-ink)"
      >
        {value}
      </text>
      <text
        x={box.x + box.width / 2}
        y={captionBelow ? box.y + box.height + 14 : box.y + box.height + 14}
        textAnchor="middle"
        className="sheet-caption"
        fill="var(--sheet-muted)"
      >
        {caption}
      </text>
    </g>
  );
}

function DutyGrid({ log }: { log: DailyLog }) {
  const ticks = ticksForRow();

  return (
    <g>
      <rect
        x={GRID.left}
        y={GRID.headerTop}
        width={GRID.right - GRID.left}
        height={GRID.headerHeight}
        fill="var(--sheet-band)"
      />
      {hourLabels().map(({ hour, x, label, isAnchor }) => (
        <text
          key={hour}
          x={x}
          y={GRID.headerTop + GRID.headerHeight / 2 + 4}
          textAnchor="middle"
          className={isAnchor ? "sheet-hour-anchor" : "sheet-hour"}
          fill="var(--sheet-ink)"
        >
          {label}
        </text>
      ))}

      <text
        x={(GRID.right + GRID.totalsRight) / 2}
        y={GRID.headerTop + GRID.headerHeight / 2}
        textAnchor="middle"
        className="sheet-caption"
        fill="var(--sheet-ink)"
      >
        <tspan x={(GRID.right + GRID.totalsRight) / 2} dy={-1}>
          Total
        </tspan>
        <tspan x={(GRID.right + GRID.totalsRight) / 2} dy={11}>
          Hours
        </tspan>
      </text>

      {ROW_ORDER.map((status) => {
        const top = rowTop(status);
        return (
          <g key={status}>
            <rect
              x={GRID.left}
              y={top}
              width={GRID.right - GRID.left}
              height={GRID.rowHeight}
              fill="none"
              stroke="var(--sheet-ink)"
            />
            <text x={GRID.left - 8} y={top + GRID.rowHeight / 2 + 4} textAnchor="end" className="sheet-label" fill="var(--sheet-ink)">
              {ROW_CAPTIONS[status]}
            </text>

            {ticks.map((tick, index) => (
              <line
                key={index}
                x1={tick.x}
                y1={top}
                x2={tick.x}
                y2={top + tick.depth}
                stroke={tick.isHour ? "var(--sheet-ink)" : "var(--sheet-rule)"}
                strokeWidth={tick.isHour ? 1 : 0.5}
              />
            ))}

            <rect
              x={GRID.right}
              y={top}
              width={GRID.totalsRight - GRID.right}
              height={GRID.rowHeight}
              fill="none"
              stroke="var(--sheet-ink)"
            />
            <text
              x={(GRID.right + GRID.totalsRight) / 2}
              y={top + GRID.rowHeight / 2 + 4}
              textAnchor="middle"
              className="sheet-total"
              fill="var(--sheet-ink)"
            >
              {formatHours(log.totals[status] ?? 0)}
            </text>
          </g>
        );
      })}

      {/* Must read 24.00 on every sheet. */}
      <text
        x={(GRID.right + GRID.totalsRight) / 2}
        y={GRID_BOTTOM + 16}
        textAnchor="middle"
        className="sheet-total"
        fill="var(--sheet-ink)"
      >
        {formatHours(log.totalMinutes)}
      </text>
    </g>
  );
}

function EntryHitAreas({
  entries,
  onSelectMinute,
}: {
  entries: LogEntry[];
  onSelectMinute?: (minuteOfDay: number) => void;
}) {
  return (
    <g>
      {entries.map((entry) => {
        const x = xForMinute(entry.startMinute);
        const width = Math.max(xForMinute(entry.endMinute) - x, 1);
        return (
          <rect
            key={`hit-${entry.startMinute}-${entry.status}-${entry.ruleId}`}
            x={x}
            y={rowTop(entry.status)}
            width={width}
            height={GRID.rowHeight}
            fill="transparent"
            className={cn("sheet-hit", onSelectMinute && "cursor-pointer")}
            onClick={onSelectMinute ? () => onSelectMinute(entry.startMinute) : undefined}
          >
            <title>
              {`${DUTY_STATUS[entry.status].label} · ${formatClockTime(entry.startMinute)}–${formatClockTime(
                entry.endMinute,
              )} · ${formatDuration(entry.durationMinutes)}${entry.location ? ` · ${entry.location}` : ""}`}
            </title>
          </rect>
        );
      })}
    </g>
  );
}

// Minimum horizontal gap before two rotated remark labels collide.
const REMARK_MIN_GAP = 13;

// Drop consecutive repeats of a place, and anything landing within a label's width of
// the previous remark, so rotated labels do not stack on top of each other.
function selectRemarks(entries: readonly LogEntry[]): LogEntry[] {
  const chosen: LogEntry[] = [];
  let lastLocation = "";
  let lastX = Number.NEGATIVE_INFINITY;

  entries.forEach((entry, index) => {
    if (index === 0 || !entry.location || entry.durationMinutes <= 0) return;
    if (entry.location === lastLocation) return;

    const x = xForMinute(entry.startMinute);
    if (x - lastX < REMARK_MIN_GAP) return;

    chosen.push(entry);
    lastLocation = entry.location;
    lastX = x;
  });

  return chosen;
}

function Remarks({ entries }: { entries: LogEntry[] }) {
  return (
    <g>
      <rect
        x={REMARKS.x}
        y={REMARKS.y}
        width={REMARKS.width}
        height={REMARKS.height}
        fill="none"
        stroke="var(--sheet-ink)"
      />
      <text x={REMARKS.x + 8} y={REMARKS.y + REMARKS.labelOffset} className="sheet-label" fill="var(--sheet-ink)">
        Remarks
      </text>

      {entries.map((entry) => {
        const x = xForMinute(entry.startMinute);
        return (
          <g key={`remark-${entry.startMinute}-${entry.ruleId}`}>
            <line x1={x} y1={GRID_BOTTOM} x2={x} y2={REMARKS.y + 8} stroke="var(--sheet-rule)" strokeWidth={0.5} />
            <text
              x={x}
              y={REMARKS.y + 26}
              transform={`rotate(-60 ${x} ${REMARKS.y + 26})`}
              className="sheet-remark"
              fill="var(--sheet-ink)"
            >
              {entry.location}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function ShippingBlock({ details }: { details: CarrierDetails }) {
  const values = [details.shippingDocuments, details.manifestNumber, details.shipperCommodity];

  return (
    <g>
      {SHIPPING.rows.map((label, index) => {
        const y = SHIPPING.y + index * SHIPPING.rowHeight;
        return (
          <g key={label}>
            <text x={SHIPPING.x} y={y + 14} className="sheet-label" fill="var(--sheet-ink)">
              {label}
            </text>
            <line x1={SHIPPING.x + 170} y1={y + 18} x2={SHIPPING.x + SHIPPING.width} y2={y + 18} stroke="var(--sheet-ink)" />
            <text x={SHIPPING.x + 178} y={y + 14} className="sheet-value" fill="var(--sheet-ink)">
              {values[index]}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Instructions() {
  return (
    <g>
      {INSTRUCTIONS.lines.map((line, index) => (
        <text
          key={line}
          x={INSTRUCTIONS.x}
          y={INSTRUCTIONS.y + index * INSTRUCTIONS.lineHeight}
          textAnchor="middle"
          className="sheet-caption"
          fill="var(--sheet-muted)"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function Recap({ log }: { log: DailyLog }) {
  const available = Math.max(CYCLE_LIMIT_MINUTES - log.cycleUsedMinutes, 0);
  const columnWidth = (RECAP.width - RECAP.captionWidth - RECAP.onDutyWidth) / (RECAP.columnCount * 2);

  // Only the 70-hour/8-day half is computed: the assessment fixes the driver to that
  // cycle. The 60-hour/7-day columns are still drawn because they are on the real form.
  const columns = [
    { key: "A", caption: "Total hours on duty last 7 days including today", value: formatHours(log.cycleUsedMinutes) },
    { key: "B", caption: "Total hours available tomorrow 70 hr. minus A*", value: formatHours(available) },
    { key: "C", caption: "Total hours on duty last 5 days including today", value: formatHours(log.cycleUsedMinutes) },
    { key: "A", caption: "Total hours on duty last 8 days including today", value: "" },
    { key: "B", caption: "Total hours available tomorrow 60 hr. minus A*", value: "" },
    { key: "C", caption: "Total hours on duty last 7 days including today", value: "" },
  ];

  return (
    <g>
      <rect x={RECAP.x} y={RECAP.y} width={RECAP.width} height={RECAP.height} fill="none" stroke="var(--sheet-ink)" />

      <text x={RECAP.x + 8} y={RECAP.y + 18} className="sheet-label" fill="var(--sheet-ink)">
        Recap:
      </text>
      <text x={RECAP.x + 8} y={RECAP.y + 34} className="sheet-caption" fill="var(--sheet-muted)">
        Complete at end of day
      </text>

      <line x1={RECAP.x + RECAP.captionWidth} y1={RECAP.y} x2={RECAP.x + RECAP.captionWidth} y2={RECAP.y + RECAP.height} stroke="var(--sheet-ink)" />
      <WrappedCaption
        x={RECAP.x + RECAP.captionWidth + 8}
        y={RECAP.y + 18}
        width={RECAP.onDutyWidth - 16}
        text="On duty hours today, total lines 3 & 4"
      />
      <text x={RECAP.x + RECAP.captionWidth + 8} y={RECAP.y + 62} className="sheet-total" fill="var(--sheet-ink)">
        {formatHours(log.onDutyMinutes)}
      </text>

      <line
        x1={RECAP.x + RECAP.captionWidth + RECAP.onDutyWidth}
        y1={RECAP.y}
        x2={RECAP.x + RECAP.captionWidth + RECAP.onDutyWidth}
        y2={RECAP.y + RECAP.height}
        stroke="var(--sheet-ink)"
      />

      {columns.map((column, index) => {
        const x = RECAP.x + RECAP.captionWidth + RECAP.onDutyWidth + index * columnWidth;
        const isSeventyDay = index < RECAP.columnCount;
        return (
          <g key={`${column.key}-${index}`}>
            {index > 0 && <line x1={x} y1={RECAP.y + 26} x2={x} y2={RECAP.y + RECAP.height} stroke="var(--sheet-rule)" />}
            {index === 0 && (
              <text x={x + 8} y={RECAP.y + 18} className="sheet-caption" fill="var(--sheet-ink)">
                70 Hour / 8 Day Drivers
              </text>
            )}
            {index === RECAP.columnCount && (
              <text x={x + 8} y={RECAP.y + 18} className="sheet-caption" fill="var(--sheet-ink)">
                60 Hour / 7 Day Drivers
              </text>
            )}
            <text x={x + 8} y={RECAP.y + 42} className="sheet-label" fill="var(--sheet-ink)">
              {column.key}.
            </text>
            <WrappedCaption x={x + 8} y={RECAP.y + 58} width={columnWidth - 16} text={column.caption} />
            {isSeventyDay && (
              <text x={x + 8} y={RECAP.y + RECAP.height - 12} className="sheet-total" fill="var(--sheet-ink)">
                {column.value}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

// SVG has no text wrapping and foreignObject does not serialise reliably for print, so
// wrap by character count. Stable because these are fixed form strings, not user input.
function WrappedCaption({ x, y, width, text }: { x: number; y: number; width: number; text: string }) {
  const charsPerLine = Math.max(Math.floor(width / 4.4), 8);
  const lines: string[] = [];
  let current = "";

  for (const word of text.split(" ")) {
    if (current.length + word.length + 1 > charsPerLine) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);

  return (
    <text x={x} y={y} className="sheet-caption" fill="var(--sheet-muted)">
      {lines.map((line, index) => (
        <tspan key={index} x={x} dy={index === 0 ? 0 : 11}>
          {line}
        </tspan>
      ))}
    </text>
  );
}
