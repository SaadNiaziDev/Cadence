// Clock values are read from the `clocksAfter` snapshot on each segment and interpolated,
// never recomputed. Every clock moves linearly within a segment, so blending two snapshots
// is exact.

import type { ClockSnapshot, PlannedRoute, Segment } from "@/types/hos";

export interface TripPosition {
  minute: number;
  segment: Segment;
  segmentIndex: number;
  /** How far into the segment, 0 to 1. */
  progress: number;
  milesFromOrigin: number;
  clocks: ClockSnapshot;
}

const ZERO_CLOCKS: ClockSnapshot = {
  drivingUsed: 0,
  drivingRemaining: 0,
  windowUsed: 0,
  windowRemaining: 0,
  breakDrivingUsed: 0,
  breakDrivingRemaining: 0,
  cycleUsed: 0,
  cycleRemaining: 0,
};

export function tripStartMinute(route: PlannedRoute): number {
  return route.segments[0]?.startMinute ?? 0;
}

export function tripEndMinute(route: PlannedRoute): number {
  return route.segments[route.segments.length - 1]?.endMinute ?? 0;
}

/** Index of the segment covering a minute; the last segment owns the final instant. */
export function segmentIndexAt(segments: Segment[], minute: number): number {
  if (segments.length === 0) return -1;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (minute >= segment.startMinute && minute < segment.endMinute) return index;
  }
  return minute < segments[0]!.startMinute ? 0 : segments.length - 1;
}

// A snapshot is the state at the END of a segment, so a reading part way through lies
// between the previous segment's snapshot and this one.
function interpolateClocks(from: ClockSnapshot, to: ClockSnapshot, progress: number): ClockSnapshot {
  const mix = (a: number, b: number) => Math.round(a + (b - a) * progress);
  return {
    drivingUsed: mix(from.drivingUsed, to.drivingUsed),
    drivingRemaining: mix(from.drivingRemaining, to.drivingRemaining),
    windowUsed: mix(from.windowUsed, to.windowUsed),
    windowRemaining: mix(from.windowRemaining, to.windowRemaining),
    breakDrivingUsed: mix(from.breakDrivingUsed, to.breakDrivingUsed),
    breakDrivingRemaining: mix(from.breakDrivingRemaining, to.breakDrivingRemaining),
    cycleUsed: mix(from.cycleUsed, to.cycleUsed),
    cycleRemaining: mix(from.cycleRemaining, to.cycleRemaining),
  };
}

export function positionAt(route: PlannedRoute, minute: number): TripPosition | null {
  const { segments } = route;
  if (segments.length === 0) return null;

  const clamped = Math.min(Math.max(minute, tripStartMinute(route)), tripEndMinute(route));
  const index = segmentIndexAt(segments, clamped);
  const segment = segments[index]!;

  const span = segment.endMinute - segment.startMinute;
  const progress = span > 0 ? (clamped - segment.startMinute) / span : 1;

  // The state before the first segment is not zero: a driver who arrives with 12 hours
  // already on their cycle starts there. Falling back to zeros would show a full 70-hour
  // cycle at the moment of departure, which is the one reading a driver would check.
  const previousClocks = index > 0 ? segments[index - 1]!.clocksAfter : route.initialClocks ?? ZERO_CLOCKS;

  return {
    minute: clamped,
    segment,
    segmentIndex: index,
    progress,
    milesFromOrigin: segment.startMiles + (segment.endMiles - segment.startMiles) * progress,
    clocks: interpolateClocks(previousClocks, segment.clocksAfter, progress),
  };
}

// The polyline is simplified, so vertex spacing no longer matches road distance. Walk it
// by cumulative chord length and scale by (polyline length / reported route mileage).
export function coordinateAtMiles(
  geometry: [number, number][],
  totalMiles: number,
  miles: number,
): [number, number] | null {
  if (geometry.length === 0) return null;
  if (geometry.length === 1 || miles <= 0) return geometry[0]!;

  const cumulative: number[] = [0];
  for (let index = 1; index < geometry.length; index += 1) {
    const [previousLon, previousLat] = geometry[index - 1]!;
    const [lon, lat] = geometry[index]!;
    // Chord length in degrees, with longitude scaled for latitude. Only the ratios
    // matter here, so degrees are as good as miles and far cheaper.
    const scale = Math.cos((lat * Math.PI) / 180);
    cumulative.push(cumulative[index - 1]! + Math.hypot((lon - previousLon) * scale, lat - previousLat));
  }

  const total = cumulative[cumulative.length - 1]!;
  if (total === 0) return geometry[0]!;

  const target = (Math.min(miles, totalMiles) / totalMiles) * total;

  for (let index = 1; index < cumulative.length; index += 1) {
    if (cumulative[index]! >= target) {
      const spanStart = cumulative[index - 1]!;
      const span = cumulative[index]! - spanStart;
      const fraction = span > 0 ? (target - spanStart) / span : 0;
      const [startLon, startLat] = geometry[index - 1]!;
      const [endLon, endLat] = geometry[index]!;
      return [startLon + (endLon - startLon) * fraction, startLat + (endLat - startLat) * fraction];
    }
  }

  return geometry[geometry.length - 1]!;
}
