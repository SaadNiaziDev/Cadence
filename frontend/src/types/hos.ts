
import { z } from "zod";

export const DUTY_STATUSES = ["OFF", "SB", "D", "ON"] as const;
export type DutyStatus = (typeof DUTY_STATUSES)[number];

export const RULE_IDS = [
  "drive-11",
  "window-14",
  "break-30",
  "cycle-70",
  "restart-34",
  "fuel-1000",
  "pickup",
  "dropoff",
  "inspection",
  "driving",
  "off-duty",
] as const;
export type RuleId = (typeof RULE_IDS)[number];

const dutyStatusSchema = z.enum(DUTY_STATUSES);
const ruleIdSchema = z.enum(RULE_IDS);

/** A legal clock reading. All values are whole minutes. */
export const clockSnapshotSchema = z.object({
  drivingUsed: z.number(),
  drivingRemaining: z.number(),
  windowUsed: z.number(),
  windowRemaining: z.number(),
  breakDrivingUsed: z.number(),
  breakDrivingRemaining: z.number(),
  cycleUsed: z.number(),
  cycleRemaining: z.number(),
});
export type ClockSnapshot = z.infer<typeof clockSnapshotSchema>;

export const segmentSchema = z.object({
  status: dutyStatusSchema,
  startMinute: z.number(),
  endMinute: z.number(),
  durationMinutes: z.number(),
  startAt: z.string(),
  endAt: z.string(),
  startMiles: z.number(),
  endMiles: z.number(),
  ruleId: ruleIdSchema,
  label: z.string(),
  clocksAfter: clockSnapshotSchema,
});
export type Segment = z.infer<typeof segmentSchema>;

export const stopSchema = z.object({
  ruleId: ruleIdSchema,
  label: z.string(),
  startMinute: z.number(),
  startAt: z.string(),
  durationMinutes: z.number(),
  milesFromOrigin: z.number(),
  milesToDestination: z.number().default(0),
  minutesToDestination: z.number().default(0),
  /** A mandatory long stop that lands within sight of the delivery. */
  isNearDestination: z.boolean().default(false),
  location: z.string(),
  position: z.tuple([z.number(), z.number()]),
});
export type Stop = z.infer<typeof stopSchema>;

export const logEntrySchema = z.object({
  status: dutyStatusSchema,
  startMinute: z.number(),
  endMinute: z.number(),
  durationMinutes: z.number(),
  ruleId: ruleIdSchema,
  label: z.string(),
  miles: z.number(),
  location: z.string(),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

export const dailyLogSchema = z.object({
  dayIndex: z.number(),
  date: z.string(),
  totals: z.record(dutyStatusSchema, z.number()),
  totalMinutes: z.number(),
  isComplete: z.boolean(),
  drivingMiles: z.number(),
  onDutyMinutes: z.number(),
  cycleUsedMinutes: z.number(),
  entries: z.array(logEntrySchema),
});
export type DailyLog = z.infer<typeof dailyLogSchema>;

export const routeSummarySchema = z.object({
  arrivalMinute: z.number(),
  arrivalAt: z.string(),
  elapsedMinutes: z.number(),
  drivingMinutes: z.number(),
  onDutyMinutes: z.number(),
  dayCount: z.number(),
  restCount: z.number(),
  restartCount: z.number(),
  breakCount: z.number(),
  fuelCount: z.number(),
  cycleUsedAtArrival: z.number(),
});
export type RouteSummary = z.infer<typeof routeSummarySchema>;

export const plannedRouteSchema = z.object({
  index: z.number(),
  source: z.string(),
  distanceMiles: z.number(),
  durationMinutes: z.number(),
  /** GeoJSON order: [longitude, latitude]. */
  geometry: z.array(z.tuple([z.number(), z.number()])),
  summary: routeSummarySchema,
  violations: z.array(z.string()),
  /** Clock state before the trip begins; a driver with cycle hours used does not start at zero. */
  initialClocks: clockSnapshotSchema.nullable().optional(),
  segments: z.array(segmentSchema),
  stops: z.array(stopSchema),
  logs: z.array(dailyLogSchema),
});
export type PlannedRoute = z.infer<typeof plannedRouteSchema>;

export const waypointSchema = z.object({
  label: z.string(),
  fullName: z.string(),
  longitude: z.number(),
  latitude: z.number(),
  source: z.string(),
});
export type Waypoint = z.infer<typeof waypointSchema>;

export const tripSchema = z.object({
  id: z.string().optional(),
  startDateTime: z.string(),
  waypoints: z.array(waypointSchema),
  selectedIndex: z.number(),
  warnings: z.array(z.string()),
  routes: z.array(plannedRouteSchema).min(1),
});
export type Trip = z.infer<typeof tripSchema>;

export const ruleSchema = z.object({
  id: ruleIdSchema,
  title: z.string(),
  citation: z.string(),
  summary: z.string(),
  countsAs: z.string(),
  consequence: z.string(),
  isAssumption: z.boolean(),
});
export type Rule = z.infer<typeof ruleSchema>;

export const ruleCatalogSchema = z.object({ rules: z.array(ruleSchema) });

export const suggestionSchema = z.object({
  label: z.string(),
  fullName: z.string(),
  longitude: z.number(),
  latitude: z.number(),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

export const suggestionsSchema = z.object({ results: z.array(suggestionSchema) });

/** What the trip form collects. */
export interface TripRequest {
  current_location: string;
  pickup_location: string;
  dropoff_location: string;
  cycle_used_hours: number;
  start_datetime?: string;
  compare_routes?: boolean;
}
