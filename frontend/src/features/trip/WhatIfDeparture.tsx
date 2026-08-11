import { useEffect, useState } from "react";
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

// HOS is quantised around the 14-hour window, so a shift of a couple of hours can remove
// a whole overnight rest and a whole log sheet. Re-planned on release, not per drag frame:
// every request persists a trip.
export function WhatIfDeparture({ trip, request, onApply }: WhatIfDepartureProps) {
  const [shiftHours, setShiftHours] = useState(0);
  const [preview, setPreview] = useState<Trip | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // A new trip invalidates any preview built against the previous one.
  useEffect(() => {
    setShiftHours(0);
    setPreview(null);
    setFailed(false);
  }, [trip.id]);

  async function run(hours: number) {
    if (hours === 0) {
      setPreview(null);
      setFailed(false);
      return;
    }

    setIsLoading(true);
    setFailed(false);
    try {
      setPreview(await planTrip({ ...request, start_datetime: shiftedStart(request, trip, hours) }));
    } catch {
      setFailed(true);
      setPreview(null);
    } finally {
      setIsLoading(false);
    }
  }

  const base = trip.routes[trip.selectedIndex] ?? trip.routes[0]!;
  const alternative = preview?.routes[preview.selectedIndex] ?? preview?.routes[0] ?? null;

  const arrivalDeltaMinutes = alternative
    ? Math.round(
        (new Date(alternative.summary.arrivalAt).getTime() - new Date(base.summary.arrivalAt).getTime()) / 60_000,
      )
    : 0;
  const sheetDelta = alternative ? alternative.summary.dayCount - base.summary.dayCount : 0;
  const restartDelta = alternative ? alternative.summary.restartCount - base.summary.restartCount : 0;

  return (
    <Card className="gap-2 py-3">
      <CardHeader className="px-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
          What if you left earlier?
        </CardTitle>
        <CardDescription className="text-xs">
          Shift the departure and re-plan. Release the slider to run it.
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
            <span>−{MAX_SHIFT_HOURS}h</span>
            <span className="tabular font-medium text-foreground">
              {shiftHours === 0 ? "As planned" : `${shiftHours > 0 ? "+" : "−"}${Math.abs(shiftHours)}h`}
            </span>
            <span>+{MAX_SHIFT_HOURS}h</span>
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

        {alternative && !isLoading && (
          <div className="flex flex-col gap-2 rounded-md border p-2.5">
            <p className="text-xs font-medium">
              {arrivalDeltaMinutes === 0
                ? "Arrives at the same time."
                : `Arrives ${describeMinutes(arrivalDeltaMinutes)} ${arrivalDeltaMinutes < 0 ? "sooner" : "later"}.`}
            </p>

            <div className="flex flex-col gap-1">
              <Delta label="Arrival" value={formatDateTime(alternative.summary.arrivalAt)} />
              <Delta label="Sheets" value={String(alternative.summary.dayCount)} delta={sheetDelta} lowerIsBetter />
              <Delta
                label="34-h restarts"
                value={String(alternative.summary.restartCount)}
                delta={restartDelta}
                lowerIsBetter
              />
            </div>

            <Button type="button" variant="outline" size="sm" onClick={() => onApply(preview!)}>
              Use this departure
              <ArrowRight />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Delta({
  label,
  value,
  delta,
  lowerIsBetter,
}: {
  label: string;
  value: string;
  delta?: number;
  lowerIsBetter?: boolean;
}) {
  const isBetter = delta !== undefined && delta !== 0 && (lowerIsBetter ? delta < 0 : delta > 0);
  const isWorse = delta !== undefined && delta !== 0 && !isBetter;

  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span className="tabular text-[11px] font-medium">{value}</span>
        {delta !== undefined && delta !== 0 && (
          <span
            className={cn("tabular text-[11px]", isBetter && "text-signal-ok", isWorse && "text-signal-warn")}
          >
            ({delta > 0 ? "+" : ""}
            {delta})
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
