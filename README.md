# Cadence

**Plan a truck trip that cannot break Hours of Service, and get the paper logs for it.**

Hours of Service doesn't govern where a truck goes. It governs the *rhythm* of driving and resting — and that rhythm is what this app makes visible.

Enter four things: where the truck is, where the load is collected, where it's delivered, and how much of the 70-hour cycle is already spent. Cadence returns the route with every legally required stop placed on it — fuel, 30-minute breaks, 10-hour rests, 34-hour restarts — and a filled-in FMCSA Driver's Daily Log for each calendar day.

Built as a full-stack assessment for **[Spotter AI](https://spotter.ai)**. Not affiliated with or endorsed by them.

| | |
|---|---|
| **Live app** | _not yet deployed — add the Vercel URL here_ |
| **Live API** | [cadence-api-production-b42d.up.railway.app](https://cadence-api-production-b42d.up.railway.app/api/health/) |
| **Walkthrough** | _not yet recorded — add the Loom URL here_ |

![The planner: four clock gauges, a trip scrubber, every mandatory stop on the map, routes ranked by what they cost the driver, and the compliance rubric re-checked in the browser](docs/planner.jpg)

---

## The problem, in sixty seconds

A property-carrying driver runs **four legal clocks at once**. Whichever one runs out first stops the truck.

| Clock | Limit | Resets on | Cite |
|---|---|---|---|
| **Driving** | 11 h of wheel time per shift | 10 consecutive hours off duty | §395.3(a)(3)(i) |
| **Window** | no driving after 14 h from when work began — breaks do **not** pause it | 10 consecutive hours off duty | §395.3(a)(2) |
| **Break** | no driving past 8 h of cumulative driving | any 30 consecutive minutes not driving | §395.3(a)(3)(ii) |
| **Cycle** | 70 h on duty in a rolling 8 days | days aging out, or 34 consecutive hours off | §395.3(b)(2), (c) |

Two consequences that catch planners out, and that this app gets right:

- **After 14 hours you may still work — you just may not drive.** Non-driving work keeps burning the 70-hour cycle.
- **A 1-hour pickup already satisfies the 30-minute break.** Since the 2020 amendment, any 30+ consecutive minutes not driving qualifies — off duty, sleeper berth, *or* on-duty-not-driving. Stacking a separate break after a loading stop is wrong, not merely redundant. Cadence says so out loud when it avoids one.

---

## What it does

**Four clocks, always visible.** Every gauge reads straight from the engine's own snapshot for the scrubbed moment, so the display cannot disagree with the plan it describes. The clock that forces the next stop is called out in words.

**One time cursor, four synchronised views.** Scrub or hit play, and the truck moves along the route, the timeline highlights, the gauges drain, and the log sheet switches day with a playhead sweeping its grid. Watching a stop appear at the exact moment its clock runs out is the clearest proof the numbers agree with each other.

**Every stop explains itself.** Click any stop — on the map, the timeline, or a gauge — and it names the rule that forced it, quotes the citation, says what counts, and says what happens if it's ignored. That text is served from a backend rule catalog keyed by the same rule id the engine tags segments with, so the explanation cannot drift from the rule actually applied.

**It warns before the trip, not after.** Typing cycle hours updates a live verdict: at 62 h you have roughly one shift left; at 70 h you cannot legally drive until a 34-hour restart, and it will cost you a day and a half at the start.

**Routes ranked by what they cost a driver.** HOS is quantised, so a route 60 miles longer can arrive a full day earlier by letting a leg finish before the 14-hour window shuts. Distance and drive-time rankings cannot show that. Cadence ranks by arrival, then restarts, then rests, then cycle burned — and badges the winner with the saving in the units a driver feels.

**What-if departure.** Shift departure ±12 h and re-plan. Leaving earlier frequently removes a whole overnight rest and a whole log sheet.

**Log sheets that are the real form.** Traced from the blank FMCSA sheet: 24-hour grid, 15-minute ticks, the duty line with vertical connectors at every change, per-status totals, remarks naming where each change happened, and the recap box. Hover a segment for its status and duration; click it to jump the scrubber there. Print gives one sheet per page on white paper.

**A shareable link for every plan.** Each trip is persisted and lives at `/trip/:id` — the full working app with that plan loaded, not a screenshot.

![A Driver's Daily Log rendered as SVG: 15-minute grid, duty line with vertical connectors, per-status totals adding to 24.00, and remarks naming where each change happened](docs/log-sheet.jpg)

---

## Verifying accuracy in two minutes

Accuracy is the thing being graded, so here is how to check it rather than take it on faith.

1. **Open a sample.** Click **Cross-country** then **Plan this trip** — New York → Newark → Los Angeles, ~2,800 miles, 5 log sheets.
2. **Open the compliance badge** in the tab row. It expands into a rubric, each line re-computed *in the browser from the delivered plan* rather than reported by the planner:
   - *No clock exceeded while driving* — checks `clocksAfter` on every driving segment for a negative remainder on any of the four clocks.
   - *Every sheet totals 24.00* — checks each sheet accounts for exactly 1,440 minutes.
   - *Fuel at most every 1,000 mi* — measures the longest gap between fuel stops, including origin-to-first and last-to-destination.
3. **Check the pickup doesn't get a redundant break.** Open the **Timeline** tab and find the 1-hour pickup. It carries the note *"No separate 30-minute break needed — this stop already satisfies it."*
4. **Check a midnight split.** Open **Log sheets** and step through the days. A segment that crosses midnight ends one sheet and starts the next at the same status, and both still total 24.00.
5. **Run the suite.** `pnpm test` — 147 tests, including the guide's own "John Doe" example, every clock boundary, the break-satisfied-by-pickup case, a 34-hour restart spanning two midnights, and rolling 8-day aging.

Try **Near cycle limit** to watch a 34-hour restart get placed immediately, and **Overnight run** for a trip that crosses midnight.

---

## How the engine works

`backend/trips/services/hos_engine.py` is a pure function — no I/O, no framework — and the whole simulation is one loop. At each step it computes how far it may legally drive as the **minimum** of:

- hours left on the 11-hour driving clock
- minutes until the 14-hour window shuts
- driving left before a 30-minute break is due
- remaining 70-hour cycle
- distance to the next 1,000-mile fuel point
- distance to the next waypoint

It drives exactly that far, inserts whichever event bound it, and tags the segment with the rule id that caused it.

Three design decisions do most of the work:

- **Every segment carries a `clocks_after` snapshot.** The gauges read it directly instead of re-deriving HOS in JavaScript. One implementation of the rules, not two.
- **Every segment carries a `trigger_rule_id`**, and popover text is looked up by that id from `GET /api/rules/`. The explanation and the rule cannot diverge.
- **Integer minutes end to end**, converted to hours only at render. Float hours cause off-by-a-tick violations and totals that don't quite reach 24.

`log_builder.py` slices segments at every midnight in home-terminal time. The split **loops** rather than running once — a 34-hour restart crosses two midnights, and a single split would leave more than 24 hours on one sheet.

---

## Architecture

```
React (Vercel)  ──POST /api/trips/──▶  Django + DRF (Railway)
     │                                      │
  MapLibre GL + OpenFreeMap                 ├── services/geocoding.py   → Nominatim + offline US city fallback
  SVG log sheets                            ├── services/routing.py     → OSRM, alternatives, offline estimate
  Four clock gauges                         ├── services/hos_engine.py  → pure Python, no I/O
  One scrubber driving all four views       ├── services/log_builder.py → segments → daily sheets
                                            └── services/rules.py       → rule catalog for the popovers
```

```
backend/    Django API — HOS engine, log builder, routing and geocoding services, 147 tests
frontend/   React SPA — map, clock gauges, scrubber, timeline, log sheets
docs/       Screenshots used in this README
resources/  Assessment brief, FMCSA driver's guide, blank log sheet reference
PLAN.md     Full build plan, rule notes and design decisions
```

### API

| Endpoint | Purpose |
|---|---|
| `POST /api/trips/` | Plan a trip. Returns 1–3 ranked routes, each with segments, stops, per-day log sheets and a summary. Persists the result and returns its `id`. |
| `GET /api/trips/:id/` | A previously planned trip, verbatim — what a shared link loads. |
| `GET /api/rules/` | The rule catalog: id, citation, plain-English why, what counts, consequence. Single source for every popover. |
| `GET /api/geocode/suggest/?q=` | Debounced autocomplete for the three location fields. |
| `GET /api/health/` | Liveness probe. |

**Stack:** Django 5 + DRF · React 18 + TypeScript (strict) + Tailwind + shadcn/ui · MapLibre GL with OpenFreeMap tiles · OSRM routing · Nominatim geocoding. No paid APIs and no API keys.

---

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
| `pnpm test` | Backend test suite (147 tests) |
| `pnpm lint` | Frontend lint |

<details>
<summary>Running each half on its own</summary>

**Backend** (Python 3.13):

```bash
cd backend
python3.13 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # then set UPSTREAM_USER_AGENT to a real contact address
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver
```

API at `http://localhost:8000`, health check at `/api/health/`.

**Frontend** (Node 20+, pnpm):

```bash
cd frontend
pnpm install
cp .env.example .env          # optional; defaults to http://localhost:8000
pnpm dev
```

App at `http://localhost:5173`.

</details>

> **Nominatim requires a real `UPSTREAM_USER_AGENT`** with contact details — it is a condition of their usage policy. Geocoding and routing responses are cached aggressively, and both fall back gracefully: a bundled US city table when Nominatim is unreachable, and great-circle estimation when OSRM is.

---

## Deployment

The two halves deploy separately, because Vercel cannot run a long-lived Django process.

**Frontend → Vercel.** `vercel.json` at the repository root already contains the monorepo build settings and the SPA rewrite that `/trip/:id` needs, so importing the repo is enough. Set `VITE_API_URL` to the deployed backend URL.

<details>
<summary>Configuring Vercel by hand instead</summary>

| Setting | Value |
|---|---|
| Framework Preset | Vite |
| Root Directory | `frontend` |
| Install Command | `pnpm install` |
| Build Command | `pnpm build` |
| Output Directory | `dist` |

</details>

**Backend → Railway.** `backend/railway.json` pins the build, the pre-deploy migration and the start command, so a deploy is:

```bash
cd backend
railway link          # or `railway init` for a new project
railway up
```

`ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS` already default to `.railway.app`, so only these need setting:

| Variable | Purpose |
|---|---|
| `DJANGO_SECRET_KEY` | Django signing key |
| `DJANGO_DEBUG` | `false` in production |
| `CORS_ALLOWED_ORIGINS` | the deployed frontend origin |
| `UPSTREAM_USER_AGENT` | identifying string with contact details, required by Nominatim |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}`; falls back to SQLite when absent |

Postgres rather than the SQLite fallback matters here: a planned trip is persisted so it has a shareable `/trip/:id` URL, and a container filesystem does not survive a restart.

CI runs the backend suite and the frontend typecheck, lint and build on every push — `.github/workflows/ci.yml`.

---

## Stated simplifications

Called out rather than buried, because each is a real limitation:

- **Car routing, not truck-legal routing.** OSRM ignores bridge clearances, weight limits and HGV bans. A production planner needs an HGV profile (OpenRouteService) or a commercial engine (PC\*Miler, Trimble). Routing sits behind a `RoutingProvider` interface, so a second adapter is a small change.
- **No sleeper-berth split.** The 7+3 and 8+2 pairings under §395.1(g) are not modelled; plain 10-hour resets are compliant and far easier to verify.
- **One timezone.** Home-terminal time throughout, which is what §395.8 prescribes for the sheet, so midnight stays in one place as the driver crosses time zones.
- **No traffic model.** Speed within a leg is constant, taken from the router's own reported duration.
- **Adverse driving conditions exception** (§395.1(b)) is not applied, per the brief's assumptions.
- **Fuel every 1,000 miles, logged as 30 minutes on duty.** An assessment assumption, not a regulation. Thirty minutes is chosen deliberately so the stop also legally satisfies the break rule.
- **Pickup and dropoff are 1 hour each; pre- and post-trip inspections 15 minutes each.** Assumptions — but the inspection correctly starts the 14-hour window before any driving, which is the detail that matters.
- **PDF export is the print stylesheet.** *Print all* opens the browser's print dialog with one sheet per page and backgrounds forced on; "Save as PDF" there produces the file. There is no separate PDF toolchain.

---

## Attribution

Map tiles © [OpenFreeMap](https://openfreemap.org) © [OpenMapTiles](https://openmaptiles.org), data from [OpenStreetMap](https://www.openstreetmap.org/copyright). Geocoding by [Nominatim](https://nominatim.org), routing by [OSRM](https://project-osrm.org). Rule text derived from the FMCSA *Interstate Truck Driver's Guide to Hours of Service* (2022), included in `resources/`.
