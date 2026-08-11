import { useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarClock } from "lucide-react";

import { planTrip } from "@/api/trips";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { describeMinutes } from "@/features/verdict/compliance";
import { formatDateTime } from "@/lib/hos";
import { cn } from "@/lib/utils";
import type { Trip, TripRequest } from "@/types/hos";

interface WhatIfDepartureProps {
  trip: Trip;
  request: TripRequest;
  onApply: (result: Trip) => void;
}

const MAX_SHIFT_HOURS = 12;

// Below this the two plans are the same trip and any difference is rounding.
const MEANINGFUL_MINUTES = 15;

interface Preview {
  /** The shift this result was produced for, so the panel can never describe another one. */
  shiftHours: number;
  trip: Trip;
}

export function WhatIfDeparture({ trip, request, onApply }: WhatIfDepartureProps) {
  const [shiftHours, setShiftHours] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const latestRequest = useRef(0);

  useEffect(() => {
    setShiftHours(0);
    setPreview(null);
    setFailed(false);
    latestRequest.current += 1;
  }, [trip.id]);

  async function run(hours: number) {
    // Dragging past several stops fires a request per release. Only the newest may write
    // a result, or a slow earlier one lands last and the panel describes a shift the
    // slider is no longer on.
    const requestId = (latestRequest.current += 1);

    if (hours === 0) {
      setPreview(null);
      setFailed(false);
      return;
    }

    setIsLoading(true);
    setFailed(false);
    try {
      const result = await planTrip({ ...request, start_datetime: shiftedStart(request, trip, hours) });
      if (requestId !== latestRequest.current) return;
      setPreview({ shiftHours: hours, trip: result });
    } catch {
      if (requestId !== latestRequest.current) return;
      setFailed(true);
      setPreview(null);
    } finally {
      if (requestId === latestRequest.current) setIsLoading(false);
    }
  }

  const base = trip.routes[trip.selectedIndex] ?? trip.routes[0]!;
  const alternative = preview ? (preview.trip.routes[preview.trip.selectedIndex] ?? preview.trip.routes[0]!) : null;

  // The figure that matters is how long the trip takes, not when it ends. Leaving six
  // hours earlier and arriving six hours earlier has saved nothing — the arrival moved
  // only because the departure did.
  const elapsedDelta = alternative ? alternative.summary.elapsedMinutes - base.summary.elapsedMinutes : 0;
  const sheetDelta = alternative ? alternative.summary.dayCount - base.summary.dayCount : 0;
  const restartDelta = alternative ? alternative.summary.restartCount - base.summary.restartCount : 0;

  return (
    <Card className="gap-2 py-3">
      <CardHeader className="px-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
          Try a different departure
        </CardTitle>
        <CardDescription className="text-xs">
          Some departures finish a leg before the 14-hour window shuts and save a whole rest. Release the slider to
          re-plan.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 px-3">
        <div className="flex flex-col gap-1.5">
          <Slider
            value={[shiftHours]}
            min={-MAX_SHIFT_HOURS}
            max={MAX_SHIFT_HOURS}
            step={1}
            onValueChange={([value]) => setShiftHours(value ?? 0)}
            onValueCommit={([value]) => run(value ?? 0)}
            aria-label="Shift departure time"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{MAX_SHIFT_HOURS}h earlier</span>
            <span className="tabular font-medium text-foreground">{describeShift(shiftHours)}</span>
            <span>{MAX_SHIFT_HOURS}h later</span>
          </div>
        </div>

        {isLoading && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            Re-planning…
          </p>
        )}

        {failed && !isLoading && (
          <p className="text-xs text-signal-danger">That departure could not be planned. Try another shift.</p>
        )}

        {preview && alternative && !isLoading && (
          <div className="flex flex-col gap-2 rounded-md border p-2.5">
            <p className="text-xs font-medium">{verdict(elapsedDelta, preview.shiftHours)}</p>

            <div className="flex flex-col gap-1">
              <Delta label="Leaves" value={formatDateTime(preview.trip.startDateTime)} />
              <Delta label="Arrives" value={formatDateTime(alternative.summary.arrivalAt)} />
              <Delta
                label="Trip length"
                value={describeMinutes(alternative.summary.elapsedMinutes)}
                delta={elapsedDelta}
                unit="m"
              />
              <Delta label="Sheets" value={String(alternative.summary.dayCount)} delta={sheetDelta} />
              <Delta label="34-h restarts" value={String(alternative.summary.restartCount)} delta={restartDelta} />
            </div>

            {/* A trip of unchanged length can still touch a different number of midnights,
                which moves the sheet count without the plan being any better or worse. */}
            {sheetDelta !== 0 && Math.abs(elapsedDelta) < MEANINGFUL_MINUTES && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                The sheet count moved only because the trip now spans a different set of midnights.
              </p>
            )}

            <Button type="button" variant="outline" size="sm" onClick={() => onApply(preview.trip)}>
              Use this departure
              <ArrowRight />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function describeShift(hours: number): string {
  if (hours === 0) return "As planned";
  return `${Math.abs(hours)}h ${hours < 0 ? "earlier" : "later"}`;
}

/** States plainly whether the trip itself got shorter, or only moved in the calendar. */
function verdict(elapsedDelta: number, shiftHours: number): string {
  if (elapsedDelta <= -MEANINGFUL_MINUTES) {
    return `Saves ${describeMinutes(elapsedDelta)} of trip time.`;
  }
  if (elapsedDelta >= MEANINGFUL_MINUTES) {
    return `Costs ${describeMinutes(elapsedDelta)} more trip time.`;
  }
  return `Same trip length — leaving ${describeShift(shiftHours).toLowerCase()} simply arrives that much ${
    shiftHours < 0 ? "earlier" : "later"
  }.`;
}

function Delta({
  label,
  value,
  delta,
  unit,
}: {
  label: string;
  value: string;
  delta?: number;
  unit?: "m";
}) {
  // Fewer is better for every figure shown here: less trip time, fewer sheets, fewer
  // restarts. A change smaller than the threshold is not worth colouring either way.
  const significant = delta !== undefined && delta !== 0 && (unit !== "m" || Math.abs(delta) >= MEANINGFUL_MINUTES);
  const isBetter = significant && delta! < 0;

  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="tabular text-[11px] font-medium">{value}</span>
        {significant && (
          <span className={cn("tabular text-[11px]", isBetter ? "text-signal-ok" : "text-signal-warn")}>
            ({delta! > 0 ? "+" : "−"}
            {unit === "m" ? describeMinutes(delta!) : Math.abs(delta!)})
          </span>
        )}
      </span>
    </div>
  );
}

// Anchored on the trip's own start, not the request's: a request that omitted
// start_datetime was planned from "now" on the server, and shifting from an absent value
// would re-anchor the comparison to the browser clock.
function shiftedStart(request: TripRequest, trip: Trip, hours: number): string {
  const base = new Date(request.start_datetime ?? trip.startDateTime);
  const shifted = new Date(base.getTime() + hours * 60 * 60_000);
  return `${new Date(shifted.getTime() - shifted.getTimezoneOffset() * 60_000).toISOString().slice(0, 19)}`;
}
