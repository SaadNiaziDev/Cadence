# HOS Trip Planner

Plan a truck route that obeys FMCSA Hours of Service rules (49 CFR Part 395) and generate the driver's daily log sheets for it.

Enter a current location, a pickup, a dropoff and how many hours of the 70-hour cycle are already used. The app returns the route with every legally required stop marked on it — fuel, 30-minute breaks, 10-hour rests, 34-hour restarts — and a filled-in log sheet for each calendar day of the trip.

**Stack:** Django + Django REST Framework · React 18 + TypeScript + Tailwind + shadcn/ui · MapLibre GL with OpenFreeMap tiles · OSRM routing · Nominatim geocoding. No paid APIs and no API keys.

> **Live demo:** _not yet deployed — add the Vercel and Render URLs here once both halves are up._

---

## Screenshots

![The planner: four clock gauges, the trip scrubber, every mandatory stop on the map, routes ranked by what they cost the driver, and the compliance rubric re-checked in the browser](docs/planner.jpg)

![A Driver's Daily Log rendered as SVG: 15-minute grid, duty line with vertical connectors at each change, per-status totals adding to 24.00, and remarks naming where each change happened](docs/log-sheet.jpg)

---

## Repository layout

```
backend/    Django API — HOS simulation engine, routing and geocoding services
frontend/   React single-page app — map, clock gauges, timeline, log sheets
resources/  Assessment brief, FMCSA drivers' guide, blank log sheet reference
PLAN.md     Full build plan, rule notes and design decisions
```

## Running locally

Both halves run from the repository root. First time:

```bash
pnpm install     # root tooling
pnpm setup       # creates the backend venv, installs both dependency sets, migrates
```

Then:

```bash
pnpm dev         # Django on :8000 and Vite on :5173, together
```

| Script | What it does |
|---|---|
| `pnpm dev` | Runs API and web dev servers side by side with prefixed output |
| `pnpm build` | Production build of the frontend into `frontend/dist` |
| `pnpm start` | Serves the built frontend and runs the API under gunicorn |
| `pnpm test` | Backend test suite |
| `pnpm lint` | Frontend lint |

The individual halves can still be run on their own.

**Backend** (Python 3.13):

```bash
cd backend
python3.13 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # then set UPSTREAM_USER_AGENT to a real contact address
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver
```

API is served at `http://localhost:8000`, health check at `/api/health/`.

**Frontend** (Node 20+, pnpm):

```bash
cd frontend
pnpm install
cp .env.example .env          # optional; defaults to http://localhost:8000
pnpm dev
```

App is served at `http://localhost:5173`.

## Deployment

The two halves deploy separately because Vercel cannot run a long-lived Django process.

**Frontend → Vercel.** `vercel.json` at the repository root already contains the monorepo build settings, so importing the repo is enough. To configure it by hand in the dashboard instead:

| Setting | Value |
|---|---|
| Framework Preset | Vite |
| Root Directory | `frontend` |
| Install Command | `pnpm install` |
| Build Command | `pnpm build` |
| Output Directory | `dist` |

Set `VITE_API_URL` to the deployed backend URL in the project's environment variables.

**Backend → Render or Railway.** `render.yaml` and `backend/Procfile` are both committed. Render picks up the blueprint automatically; Railway reads the Procfile. Required environment variables:

| Variable | Purpose |
|---|---|
| `DJANGO_SECRET_KEY` | Django signing key |
| `DJANGO_DEBUG` | `false` in production |
| `DJANGO_ALLOWED_HOSTS` | the deployed backend hostname |
| `CORS_ALLOWED_ORIGINS` | the deployed frontend origin |
| `UPSTREAM_USER_AGENT` | identifying string with contact details, required by Nominatim's usage policy |
| `DATABASE_URL` | set by the host; falls back to SQLite when absent |

## How the HOS engine works

A driver carries four legal clocks at once, and whichever runs out first stops the truck:

| Clock | Limit | Resets on | Cite |
|---|---|---|---|
| Driving | 11 h of wheel time per shift | 10 consecutive hours off duty | §395.3(a)(3)(i) |
| Window | no driving after 14 h from when work began | 10 consecutive hours off duty | §395.3(a)(2) |
| Break | no driving past 8 h of cumulative driving | any 30 consecutive minutes not driving | §395.3(a)(3)(ii) |
| Cycle | 70 h on duty in a rolling 8 days | days aging out, or 34 consecutive hours off | §395.3(b)(2), (c) |

`backend/trips/services/hos_engine.py` is a pure function — no I/O, no framework — and the whole simulation is one loop. Each step it computes how far it may legally drive as the **minimum** of: hours left on the 11-hour clock, minutes until the 14-hour window shuts, driving left before a break is due, remaining cycle, distance to the next fuel point, and distance to the next waypoint. It drives exactly that far, then inserts whichever event bound it and tags the segment with the rule id that caused it.

Three consequences worth knowing:

- **Every segment carries a `clocks_after` snapshot**, so the gauges in the interface are read straight from the engine rather than re-deriving the rules in JavaScript. The HUD cannot disagree with the plan it describes.
- **Every segment carries a `trigger_rule_id`**, and the popover text is looked up by that same id from `GET /api/rules/`. The explanation a driver reads cannot drift from the rule the engine applied.
- **A 1-hour pickup already satisfies the 30-minute break.** Since the 2020 amendment any 30+ consecutive minutes not driving qualifies — off duty, sleeper, or on-duty-not-driving. Stacking a separate break after a loading stop is wrong, not merely redundant, and the interface says so out loud when it avoids one.

`log_builder.py` then slices the segments at every midnight in home-terminal time. The split **loops** rather than running once, because a 34-hour restart crosses two midnights and a single split would leave more than 24 hours on one sheet. Everything is integer minutes end to end, converted to hours only at render, which is why every sheet totals exactly 1,440 minutes instead of almost.

Run the suite with `pnpm test` — 147 tests covering the clock boundaries, the break-satisfied-by-pickup case, multi-midnight splitting, rolling 8-day aging, and route splicing.

## Stated simplifications

Called out rather than buried, because each is a real limitation:

- **Car routing, not truck-legal routing.** OSRM ignores bridge clearances, weight limits and HGV bans. A production planner needs an HGV profile (OpenRouteService) or a commercial engine (PC*Miler, Trimble). Routing sits behind a `RoutingProvider` interface so a second adapter is a small change.
- **No sleeper-berth split.** The 7+3 and 8+2 pairings under §395.1(g) are not modelled; plain 10-hour resets are compliant and far easier to verify.
- **One timezone.** Home-terminal time for the whole trip, which is what §395.8 prescribes for the sheet, so midnight stays in one place as the driver crosses time zones.
- **No traffic model.** Speed within a leg is constant, taken from the router's own duration.
- **Adverse driving conditions exception** (§395.1(b)) is not applied.
- **Fuel every 1,000 miles, logged as 30 minutes on duty.** An assessment assumption, not a regulation. Thirty minutes is chosen so the stop also legally satisfies the break rule.
- **Pickup and dropoff are 1 hour each; pre- and post-trip inspections 15 minutes each.** Assumptions, but the inspection correctly starts the 14-hour window before any driving.
- **PDF export is the print stylesheet.** `Print all` opens the browser's print dialog with one sheet per page and backgrounds forced on; "Save as PDF" there produces the file. There is no separate PDF toolchain.

## Attribution

Map tiles © [OpenFreeMap](https://openfreemap.org) © [OpenMapTiles](https://openmaptiles.org), data from [OpenStreetMap](https://www.openstreetmap.org/copyright). Geocoding by Nominatim, routing by OSRM.
