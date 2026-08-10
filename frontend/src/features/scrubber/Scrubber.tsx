import { useEffect, useRef } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DUTY_STATUS, MINUTES_PER_DAY, formatClockTime, formatDuration } from "@/lib/hos";
import { cn } from "@/lib/utils";
import type { PlannedRoute } from "@/types/hos";

interface ScrubberProps {
  route: PlannedRoute;
  minute: number;
  isPlaying: boolean;
  onMinuteChange: (minute: number) => void;
  onPlayingChange: (playing: boolean) => void;
}

/** Trip minutes advanced per second of playback: a five-day trip replays in about half a minute. */
const MINUTES_PER_SECOND = 240;
const FRAME_MS = 50;

/**
 * One time cursor for the whole interface.
 *
 * The map marker, the clock gauges, the timeline and the log sheet all read from this
 * single minute. Driving them from one value is what makes the plan legible: a viewer
 * watches the gauges drain and sees the stop appear at the moment the clock that caused
 * it runs out, rather than being asked to trust that the numbers agree.
 */
export function Scrubber({ route, minute, isPlaying, onMinuteChange, onPlayingChange }: ScrubberProps) {
  const start = route.segments[0]?.startMinute ?? 0;
  const end = route.segments[route.segments.length - 1]?.endMinute ?? 0;
  const minuteRef = useRef(minute);
  minuteRef.current = minute;

  useEffect(() => {
    if (!isPlaying) return;

    const timer = window.setInterval(() => {
      const next = minuteRef.current + (MINUTES_PER_SECOND * FRAME_MS) / 1000;
      if (next >= end) {
        onMinuteChange(end);
        onPlayingChange(false);
        return;
      }
      onMinuteChange(next);
    }, FRAME_MS);

    return () => window.clearInterval(timer);
  }, [isPlaying, end, onMinuteChange, onPlayingChange]);

  const dayNumber = Math.floor(minute / MINUTES_PER_DAY) + 1;
  const elapsed = minute - start;
  const atEnd = minute >= end;

  return (
    <Card className="shrink-0 gap-0 rounded-lg py-2 shadow-none">
      <CardContent className="flex flex-col gap-1.5 px-3">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            onClick={() => (atEnd ? (onMinuteChange(start), onPlayingChange(true)) : onPlayingChange(!isPlaying))}
            aria-label={isPlaying ? "Pause" : atEnd ? "Replay the trip" : "Play the trip"}
          >
            {isPlaying ? <Pause /> : atEnd ? <RotateCcw /> : <Play />}
          </Button>

          <div className="tabular flex items-baseline gap-2">
            <span className="text-base font-semibold">{formatClockTime(minute)}</span>
            <span className="text-xs text-muted-foreground">
              Day {dayNumber} · {formatDuration(elapsed)} in
            </span>
          </div>

          <span className="ml-auto text-xs text-muted-foreground">{formatDuration(end - minute)} to go</span>
        </div>

        {/* The track is a duty-status strip, so the shape of the whole trip — driving,
            breaks, overnight rests — is readable before anything is scrubbed.

            This stays a native range input rather than a Slider: the control's own track is
            replaced by the status strip, so Slider's track, range and thumb would all have
            to be hidden to get here. A transparent range over the strip is the smaller,
            more accessible construction. */}
        <div className="relative">
          <div className="flex h-5 w-full overflow-hidden rounded" aria-hidden>
            {route.segments.map((segment) => (
              <span
                key={`${segment.startMinute}-${segment.ruleId}`}
                className={cn(DUTY_STATUS[segment.status].bg, "h-full")}
                style={{ width: `${(segment.durationMinutes / (end - start)) * 100}%` }}
                title={`${DUTY_STATUS[segment.status].label} · ${segment.label}`}
              />
            ))}
          </div>

          <span
            className="pointer-events-none absolute -top-1 bottom-[-4px] w-0.5 bg-foreground shadow"
            style={{ left: `${((minute - start) / (end - start)) * 100}%` }}
            aria-hidden
          />

          <input
            type="range"
            min={start}
            max={end}
            step={1}
            value={minute}
            onChange={(event) => {
              onPlayingChange(false);
              onMinuteChange(Number(event.target.value));
            }}
            aria-label="Scrub through the trip"
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </div>
      </CardContent>
    </Card>
  );
}
