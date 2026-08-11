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

// Trip minutes per second of playback: a five-day trip replays in about half a minute.
const MINUTES_PER_SECOND = 240;
const FRAME_MS = 50;

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
            className="size-11 shrink-0 rounded-full"
            onClick={() => (atEnd ? (onMinuteChange(start), onPlayingChange(true)) : onPlayingChange(!isPlaying))}
            aria-label={isPlaying ? "Pause" : atEnd ? "Replay the trip" : "Play the trip"}
          >
            {isPlaying ? <Pause className="size-5" /> : atEnd ? <RotateCcw className="size-5" /> : <Play className="size-5" />}
          </Button>

          <div className="tabular flex items-baseline gap-2.5">
            <span className="text-2xl font-semibold leading-none tracking-tight">{formatClockTime(minute)}</span>
            <span className="text-[13px] text-muted-foreground">
              Day {dayNumber} · {formatDuration(elapsed)} in
            </span>
          </div>

          <span className="tabular ml-auto text-[13px] text-muted-foreground">
            {formatDuration(end - minute)} to go
          </span>
        </div>

        {/* A transparent native range sits over the duty-status strip; padding lifts its
            hit area to 44px without making the bands that tall. */}
        <div className="relative py-2">
          <div className="flex h-7 w-full overflow-hidden rounded-md" aria-hidden>
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
            className="pointer-events-none absolute inset-y-0.5 w-1 rounded-full bg-foreground shadow-md ring-2 ring-background"
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
