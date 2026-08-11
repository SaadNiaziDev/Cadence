export interface SampleTrip {
  name: string;
  why: string;
  current: string;
  pickup: string;
  dropoff: string;
  cycleUsedHours: number;
}

export const SAMPLE_TRIPS: SampleTrip[] = [
  {
    name: "Cross-country",
    why: "New York to Los Angeles: five log sheets, several 10-hour rests and two fuel stops.",
    current: "New York, NY",
    pickup: "Newark, NJ",
    dropoff: "Los Angeles, CA",
    cycleUsedHours: 12,
  },
  {
    name: "Near cycle limit",
    why: "68 hours already used, so the plan opens with a 34-hour restart.",
    current: "Chicago, IL",
    pickup: "Indianapolis, IN",
    dropoff: "Atlanta, GA",
    cycleUsedHours: 68,
  },
  {
    name: "Short haul",
    why: "Comfortably inside one shift: a single log sheet and no mandatory stops.",
    current: "Dallas, TX",
    pickup: "Fort Worth, TX",
    dropoff: "Austin, TX",
    cycleUsedHours: 8,
  },
  {
    name: "Overnight run",
    why: "Departs late enough that a driving stretch is split across midnight onto two sheets.",
    current: "Denver, CO",
    pickup: "Colorado Springs, CO",
    dropoff: "Salt Lake City, UT",
    cycleUsedHours: 20,
  },
];
