import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Printer, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { MINUTES_PER_DAY, formatHours } from "@/lib/hos";
import type { DailyLog, PlannedRoute } from "@/types/hos";

import { CARRIER_FIELDS, useCarrierDetails } from "./carrier-details";
import { LogSheet } from "./LogSheet";

interface LogSheetsProps {
  route: PlannedRoute;
  /** Trip minute, counted from midnight of day one — the same cursor the scrubber drives. */
  minute: number;
  onSelectMinute: (minute: number) => void;
}

/**
 * The day's log sheets, as the fourth surface the scrubber drives.
 *
 * The visible sheet follows the time cursor across midnight on its own, because a driver
 * scrubbing into day three should not also have to change tabs to see the sheet they are
 * looking at. Selecting a day by hand still wins until the cursor next crosses a midnight.
 */
export function LogSheets({ route, minute, onSelectMinute }: LogSheetsProps) {
  const logs = route.logs;
  const [details, updateDetail] = useCarrierDetails();

  const cursorDay = Math.max(0, Math.min(Math.floor(minute / MINUTES_PER_DAY), logs.length - 1));
  const [selectedDay, setSelectedDay] = useState(cursorDay);

  useEffect(() => {
    setSelectedDay(cursorDay);
  }, [cursorDay]);

  if (logs.length === 0) return null;

  const day = Math.min(selectedDay, logs.length - 1);
  const log = logs[day];
  if (!log) return null;

  const everySheetComplete = logs.every((sheet) => sheet.isComplete);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 print-hidden">
        <ToggleGroup
          type="single"
          value={String(day)}
          onValueChange={(value) => value && setSelectedDay(Number(value))}
          variant="outline"
          className="flex-wrap"
          aria-label="Log sheet day"
        >
          {logs.map((sheet, index) => (
            <ToggleGroupItem key={sheet.date} value={String(index)} className="flex-col gap-0 px-3 py-1.5">
              <span className="text-[11px] font-medium">Day {index + 1}</span>
              <span className="tabular text-[10px] text-muted-foreground">{shortDate(sheet.date)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <TotalsBadge log={log} />

        <div className="ml-auto flex items-center gap-2">
          <CarrierDetailsDialog details={details} onChange={updateDetail} />
          <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
            <Printer />
            Print all {logs.length}
          </Button>
        </div>
      </div>

      {!everySheetComplete && (
        <p className="flex items-center gap-1.5 text-xs text-signal-danger print-hidden">
          <CircleAlert className="size-3.5 shrink-0" aria-hidden />
          At least one sheet does not account for a full 24 hours. That is an engine bug, not a rounding artefact.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card p-3 print-hidden">
        <LogSheet
          log={log}
          details={details}
          playheadMinute={day === cursorDay ? minute % MINUTES_PER_DAY : null}
          onSelectMinute={(minuteOfDay) => onSelectMinute(day * MINUTES_PER_DAY + minuteOfDay)}
        />
      </div>

      {/* Paper gets the whole set, one sheet per page. The screen never shows this copy. */}
      <div className="print-only">
        {logs.map((sheet) => (
          <div key={`print-${sheet.date}`} className="print-sheet">
            <LogSheet log={sheet} details={details} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TotalsBadge({ log }: { log: DailyLog }) {
  const total = formatHours(log.totalMinutes);

  return log.isComplete ? (
    <Badge variant="outline" className="gap-1 border-signal-ok/40 bg-signal-ok/10 text-signal-ok">
      <CircleCheck aria-hidden />
      Totals {total}
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 border-signal-danger/40 bg-signal-danger/10 text-signal-danger">
      <CircleAlert aria-hidden />
      Totals {total}
    </Badge>
  );
}

function CarrierDetailsDialog({
  details,
  onChange,
}: {
  details: ReturnType<typeof useCarrierDetails>[0];
  onChange: ReturnType<typeof useCarrierDetails>[1];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <SlidersHorizontal />
          Sheet details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sheet details</DialogTitle>
          <DialogDescription>
            The boxes a driver fills in by hand. Nothing here is derivable from the trip, so it is kept on this device
            and reused across plans.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="gap-4">
          {CARRIER_FIELDS.map((field) => (
            <Field key={field.key} className="gap-1.5">
              <FieldLabel htmlFor={`carrier-${field.key}`}>{field.label}</FieldLabel>
              <Input
                id={`carrier-${field.key}`}
                value={details[field.key]}
                placeholder={field.placeholder}
                onChange={(event) => onChange(field.key, event.target.value)}
              />
            </Field>
          ))}
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}

function shortDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
