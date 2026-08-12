# Cadence

Plan a truck trip that obeys FMCSA Hours of Service rules (49 CFR Part 395), and get the driver's daily log sheets for it.

Give it four things — where the truck is, where the load is collected, where it's delivered, and how many of the 70 cycle hours are already used — and it returns the route with every legally required stop on it, plus a filled-in log sheet for each day.

| | |
|---|---|
| **Live app** | _add the Vercel URL_ |
| **Walkthrough** | _add the Loom URL_ |

---

## Features

- **Four clock gauges** — the 11-hour driving limit, 14-hour window, 30-minute break and 70-hour/8-day cycle, live.
- **Every mandatory stop on the map** — fuel, 30-minute breaks, 10-hour rests, 34-hour restarts, pickup and dropoff.
- **Scrubber** — play the trip; the truck moves, the gauges drain, the timeline follows and the log sheet turns the page.
- **Timeline** — each row shows the time span, the place, the miles, and which clock forces the next stop.
- **Why-this-stop popovers** — every stop names the rule that caused it and cites the regulation.
- **Live cycle warnings** — type your cycle hours and it tells you the consequence before you plan.
- **Route comparison** — alternatives ranked by arrival and cycle cost, not by distance.
- **Daily log sheets** — drawn as SVG on the real FMCSA form, one per day, printable one sheet per page.
- **Compliance check** — re-verifies the finished plan in the browser: no clock exceeded, every sheet totals 24.00, fuel at most every 1,000 miles.
- **Shareable link** — every plan gets its own URL.

---

## Running locally

Needs Python 3.13 and Node 20+ with pnpm.

```bash
pnpm install     # root tooling
pnpm setup       # backend venv, both dependency sets, migrations
pnpm dev         # Django on :8000 and Vite on :5173
```

Open http://localhost:5173.

| Script | Does |
|---|---|
| `pnpm dev` | Runs the API and web dev servers together |
| `pnpm build` | Builds the frontend into `frontend/dist` |
| `pnpm test` | Backend test suite (147 tests) |
| `pnpm lint` | Frontend lint |

Set `UPSTREAM_USER_AGENT` in `backend/.env` to a real contact address — Nominatim's usage policy requires it. Copy `backend/.env.example` to start.

---

## Stack

Django 5 + DRF · React 18 + TypeScript + Tailwind + shadcn/ui · MapLibre GL with OpenFreeMap tiles · OSRM routing · Nominatim geocoding. No paid APIs, no API keys.

```
backend/    Django API — HOS engine, log builder, routing and geocoding
frontend/   React SPA — map, gauges, scrubber, timeline, log sheets
```

The HOS simulation in `backend/trips/services/hos_engine.py` is a pure function with no I/O. Each step it works out how far the driver may legally drive as the minimum of the four clocks, the next fuel point and the next waypoint, then inserts whichever event stopped them. Everything is integer minutes, so every log sheet totals exactly 1,440.

---

## Deploying

**Frontend → Vercel.** `vercel.json` has the build settings and proxies `/api/*` to the backend, so the browser only ever talks to the Vercel origin.

**Backend → Railway.** `backend/railway.json` pins the build, the migration step and the start command.

```bash
cd backend && railway up
vercel --prod
```

Backend environment: `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=false`, `UPSTREAM_USER_AGENT`, and `DATABASE_URL` pointing at Postgres.

---

## Known simplifications

- **Car routing, not truck-legal.** OSRM ignores bridge clearances, weight limits and HGV bans.
- **No sleeper-berth split.** Only plain 10-hour resets.
- **One timezone** — home-terminal time throughout, as §395.8 prescribes.
- **No traffic model** — constant speed within a leg, from the router's own duration.
- **Cycle hours are a single total.** Per-day history would let departure timing change the plan; with one number it cannot.
- **PDF export is the print dialog** — "Print all" gives one sheet per page; save as PDF from there.

---

Map tiles © [OpenFreeMap](https://openfreemap.org) © [OpenMapTiles](https://openmaptiles.org), data from [OpenStreetMap](https://www.openstreetmap.org/copyright). Routing by [OSRM](https://project-osrm.org), geocoding by [Nominatim](https://nominatim.org).
