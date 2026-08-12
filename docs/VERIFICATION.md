# Verification cases

Every check below is one you can run by hand and confirm yourself. Each says what to do, what should happen, and **why it matters** — so if one fails you know whether it's cosmetic or a correctness bug.

Work top to bottom the first time. Cases 1–4 are the ones worth showing in the Loom.

---

## 0. Automated suite — run this first

```bash
pnpm test          # backend: 147 tests
pnpm lint          # frontend lint
pnpm --dir frontend build   # runs tsc -b, so this is the typecheck too
```

**Expect:** `Ran 147 tests … OK`, no lint output, `✓ built`.

If anything here fails, stop — the manual cases below assume a green suite.

---

## 1. The headline demo — cross-country

**Do:** open the app → click **Cross-country** → **Plan this trip**.

**Expect:**

| Check | Value |
|---|---|
| Distance | ~2,794 mi |
| Sheets | 5 |
| Violations | 0 |
| Fuel stops | 3, longest gap ≤ 1,000 mi |

**Then:** click the green **Compliant** badge in the tab row. Three lines, all ticked:

- *No clock exceeded while driving* — with a count of driving segments
- *Every sheet totals 24.00* — with a count of sheets
- *Fuel at most every 1,000 mi* — with the **longest gap measured**, which should read close to but never above 999 mi

**Why it matters:** these three are recomputed in the browser from the delivered payload, not reported by the planner. A tick means the data actually satisfies the rule. This is the fastest way to show the app is correct rather than assert it.

---

## 2. The 30-minute break is satisfied by the pickup

**Do:** with the cross-country trip planned, open the **Timeline** tab. Find the 1-hour **Pickup** entry.

**Expect:** underneath it, in green:

> ✓ No separate 30-minute break needed — this stop already satisfies it.

**Then:** confirm there is **no** separate "30-min break" entry immediately after the pickup.

**Why it matters:** since the 2020 amendment, any 30+ consecutive minutes not driving satisfies §395.3(a)(3)(ii) — including on-duty-not-driving. Stacking a break right after a 1-hour loading is the single most common mistake in this assessment, and it's legally wrong, not just redundant.

---

## 3. Log sheets are real and add up

**Do:** open the **Log sheets** tab. Step through every day with the Day 1…Day 5 buttons.

**Expect on each sheet:**

- The badge reads **Totals 24.00** in green — on *every* day, not just the first
- The duty line is continuous: horizontal runs joined by vertical connectors at each status change, never a gap
- The right-hand column shows four per-status totals that sum to the 24.00 shown beneath them
- Remarks under the grid name real places (e.g. "Chicago, IL", "Knoxville, TN"), not "En Route", and don't overlap each other
- The recap box shows on-duty hours today and hours available tomorrow

**Then — the midnight check:** find a day where driving is in progress at midnight. The duty line should run to the right edge of that sheet and resume at the left edge of the next, **at the same status**. Both sheets still read 24.00.

**Why it matters:** a sheet that doesn't total exactly 1,440 minutes is the first thing a reviewer checks. The engine works in integer minutes end to end specifically so this can never be "23.98".

---

## 4. One cursor drives four surfaces

**Do:** press **play** on the scrubber. Watch, then pause mid-trip.

**Expect, simultaneously:**

- the truck marker moves along the route on the map
- the four gauges drain, and the number inside each counts down
- the **Timeline** highlights the segment you're inside
- the **Log sheets** tab auto-switches day at midnight, with a dashed playhead sweeping that day's grid

**Then:** pause just before a mandatory stop. The gauge that caused it reads **"Forces next stop"** underneath.

**Why it matters:** it's proof the numbers agree with each other. The gauges read the engine's own `clocks_after` snapshot rather than re-deriving HOS in JavaScript, so they cannot disagree with the plan they describe.

---

## 5. Prevention — the warning arrives before the trip

**Do:** in the form, type these into **Cycle hours used** one at a time and read the callout below it.

| Input | Expect |
|---|---|
| `0` | green — plenty of cycle left |
| `62` | still green/neutral, roughly one shift left |
| `68` | **amber** — warns you'll hit the 70-hour limit early and need a 34-hour restart |
| `70` | **red** — cannot legally drive until a 34-hour restart |
| `71` | field goes red, inline error: enter a number between 0 and 70 |
| `abc` | same validation error, form will not submit |

**Why it matters:** the product thesis is prevention over reporting. The driver is told before the wasted trip, not after.

---

## 6. Cycle at the limit actually plans a restart

**Do:** click **Near cycle limit** → **Plan this trip**.

**Expect:** a **34-hour restart** appears as the first mandatory stop, on the map and in the timeline. The trip's sheet count is higher than the same trip with 0 cycle hours used.

**Then:** click the restart's *"Why is this here?"* link. The popover cites §395.3(c) and explains what a restart is.

**Why it matters:** a driver at 70 hours cannot legally drive at all. Any planner that just starts driving is wrong.

---

## 7. Routes are ranked by HOS cost, not distance

**Do:** plan **Chicago, IL → Indianapolis, IN → Atlanta, GA** with cycle used `5`.

**Expect:**

- Two route cards in the sidebar, **Route A** badged **Chosen**
- The winner carries a saving badge — e.g. *"Burns 44m less of your 70"*
- Route B is **longer in miles** yet ranked second on arrival/cycle, not on distance
- **Hovering a card** highlights that polyline on the map and dims the other
- **Clicking a card** re-renders the timeline, gauges and log sheets for that route

**Why it matters:** HOS is quantised — a longer route can arrive sooner by finishing a leg before the 14-hour window shuts. Distance-based ranking cannot show this.

> If only one route comes back, that's legitimate (OSRM often has no genuine alternative). You'll see a warning saying so instead of an empty comparison. Try a different city pair.

---

## 8. What-if departure

**Do:** with a trip planned, drag the **What if you left earlier?** slider to −6h and release.

**Expect:** it re-plans and shows the delta — arrival, sheet count and restart count, with better values in green and worse in amber. **Use this departure** applies it and the URL changes to the new trip.

**Why it matters:** leaving a couple of hours earlier frequently removes a whole overnight rest — invisible until you try it.

---

## 9. Shareable links survive a cold load

**Do:** plan any trip. Click **Share** in the header (button appears once a trip exists). Paste the URL into a **new incognito window**.

**Expect:** the full working app with that plan loaded — map, gauges, scrubber, log sheets — and the **form repopulated** with the same three locations and cycle hours. Not a screenshot, not an empty form.

**Then:** visit a made-up id, e.g. `/trip/00000000-0000-0000-0000-000000000000`.

**Expect:** a clear "That trip link is no longer available" empty state, not a crash or a blank screen.

---

## 10. Printing

**Do:** open **Log sheets** → **Print all N** → inspect the print preview.

**Expect:**

- **One sheet per page** — N pages for N days
- Black ink on white paper, the duty line still in its status colour, the hour band still shaded
- No app chrome: no sidebar, no tabs, no buttons
- "Save as PDF" in the same dialog produces the PDF export

**Why it matters:** the output is a legal document. It has to survive contact with a printer.

> The screen layout is a 100vh flex frame with `overflow: hidden` panes. The print copy is therefore rendered through a React portal to `<body>`, outside that frame, and the print stylesheet hides the app shell wholesale rather than hiding each control in turn. Printed from inside the frame, all N sheets clip to a single page.

---

## 11. Themes and readability

**Do:** toggle the theme in the header, both ways.

**Expect:** both light and dark are fully legible — gauges, timeline, log sheet, map tiles all switch. The log sheet stays a document (card-coloured paper) rather than a glaring white slab in dark mode.

**Do:** scrub with the OS setting **Reduce motion** on.

**Expect:** gauges and markers jump to position rather than easing. Nothing breaks.

---

## 12. Keyboard and screen reader

**Do:** from a fresh load, press **Tab** repeatedly.

**Expect:** a visible focus ring on every control in a sensible order — the three location fields, cycle hours, departure, the compare toggle, submit, the sample buttons — then into the results. **Enter** and **Space** activate buttons. **Escape** closes popovers and the sheet-details dialog.

**Do:** in the location fields, type a partial city and use **↓ ↑** then **Enter**.

**Expect:** the suggestion list navigates and selects by keyboard alone.

---

## 13. Error and edge handling

| Case | Do | Expect |
|---|---|---|
| Unknown place | Enter `Sprngfieldd, ZZ` as pickup | A clear error naming the problem; the app does not hang or blank |
| Empty form | Submit with all fields blank | Three inline field errors, no request sent |
| Same origin and pickup | Set current and pickup to the same city | Plans successfully; the first leg is zero-length |
| Very short trip | `Dallas, TX → Fort Worth, TX → Arlington, TX` | One sheet, mostly off duty, still totals 24.00 |
| Double submit | Click **Plan this trip** twice quickly | Button disabled with a spinner while in flight; only one plan results |
| Backend down | Stop the API, then submit | A specific, recoverable error message — not a silent failure |

---

## 14. Live deployment

Once both halves are deployed, repeat **1, 3, 9 and 10** against the live URL, not localhost. Specifically confirm:

- the app loads with no CORS errors in the browser console
- `POST` to plan a trip succeeds from the deployed frontend
- a **Share** link opens correctly in an incognito window on a different device

**Why it matters:** the brief says *"We will test the hosted version for accuracy."* Localhost passing proves nothing about what the reviewer will see.

---

## Known limitations — expected to "fail", by design

These are declared in the README's *Stated simplifications*. Don't log them as bugs:

- **No sleeper-berth split** — 7+3 and 8+2 pairings under §395.1(g) aren't modelled; only plain 10-hour resets
- **Car routing** — OSRM ignores bridge clearances, weight limits and HGV bans
- **One timezone** — home-terminal time throughout, per §395.8
- **No traffic model** — constant speed within a leg, from the router's own duration
- **Adverse driving conditions exception** not applied, per the brief's assumptions
