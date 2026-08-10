# HOS Trip Planner

Plan a truck route that obeys FMCSA Hours of Service rules (49 CFR Part 395) and generate the driver's daily log sheets for it.

Enter a current location, a pickup, a dropoff and how many hours of the 70-hour cycle are already used. The app returns the route with every legally required stop marked on it — fuel, 30-minute breaks, 10-hour rests, 34-hour restarts — and a filled-in log sheet for each calendar day of the trip.

**Stack:** Django + Django REST Framework · React 18 + TypeScript + Tailwind + shadcn/ui · MapLibre GL with OpenFreeMap tiles · OSRM routing · Nominatim geocoding. No paid APIs and no API keys.

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

## Attribution

Map tiles © [OpenFreeMap](https://openfreemap.org) © [OpenMapTiles](https://openmaptiles.org), data from [OpenStreetMap](https://www.openstreetmap.org/copyright). Geocoding by Nominatim, routing by OSRM.
