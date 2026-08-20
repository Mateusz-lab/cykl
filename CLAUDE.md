# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Cykl" — a private, offline-capable menstrual cycle tracker built as an installable PWA for iPhone. The interface is in **Polish** and must stay in Polish (all labels, buttons, empty states, dates via `pl-PL`). It is deployed to **GitHub Pages** and has no backend, no accounts, and no network dependencies.

## Commands

There is **no package.json, no build step, no npm install, and no framework.** The whole app is one static `index.html`.

- **Run / preview:** open `index.html` directly in a browser, or serve the folder locally (`python -m http.server 8000` or `npx serve .`).
- **Test:** the `__verify_*.js` files are the only tests. Run one with Node:
  ```
  node __verify_cycle.js      # cycle-logic rules (docs/SPEC.md §5)
  node __verify_dom.js        # DOM-level behavior
  node __verify_stage7.js     # backups: panel-due, snapshots, restore, import
  ```
  A verify script reads `index.html`, runs it in Node against a **minimal DOM stub + a `Map`-backed `localStorage`**, then appends a test body that *shares the script's scope* — so the test can read `state` directly, call the app's internal functions, and monkeypatch them (e.g. `getAverageCycleLength = () => 12345`). Assertions use a local `check` helper and print `N passed, M failed` before exiting non-zero on failure. There is no test runner/framework; a "test" is a check added to the relevant `__verify_*.js`.

  Two harness styles, one per target: `__verify_dom.js` and `__verify_stage7.js` run the **whole `<script>` block** and inspect the produced DOM (e.g. `document.getElementById('ring-wrap')`, an SVG tick's `class` string), asserting with `check(name, cond, detail)`. `__verify_cycle.js` instead extracts only the pure-function section by its banner markers, returns an explicit `api` object (`new Function('state', code + 'return { getAverageCycleLength, predictNextCycles, ... }')`), and asserts return values with `check(name, actual, expected)` (deep-equals via `JSON.stringify`).
- **Deploy:** `git commit` + `git push` to `main`. GitHub Pages serves the branch. No build or release step.
- **Regenerate PWA icons** from the template if you change the app icon: `node __make_icons.js` produces `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`.

## Architecture

`index.html` (~2000 lines) holds all HTML, CSS, and JS in one file, in this order: the `<style>` block with `:root` design tokens → the tabbed HTML body (a bottom nav with four tabs) → one large `<script>` block at the end. Because the script is appended inline, the entire app is one shared lexical scope: any function defined anywhere in it is visible everywhere else and to the verify harnesses.

The `<script>` is organized into sections marked by a two-line banner comment — a `//  SECTION NAME  —  description  ` line (e.g. `//  CYCLE LOGIC  —  Stage 3 (pure functions)  `) followed by a `//  ====  ...  ` underline (`index.html:1167-1168`) — in roughly this order:
1. **STORAGE LAYER** — all persistence.
2. **DATE HELPERS** — `toKey` / `fromKey`.
3. **TAB NAVIGATION** — `switchTab`.
4. **CALENDAR** (Stage 2) — month grid, `renderCalendar`, `shiftMonth`.
5. **BOTTOM SHEET** — the day-logging form (`openDaySheet`, `saveSheetState`, chips).
6. **CYCLE LOGIC** (Stage 3) — the pure functions; the heart of the domain.
7. **TODAY** (Stage 4) — the SVG ring, `renderToday`, `markPeriodToday`.
8. **HISTORY** (Stage 5) — stat tiles, cycle list, `renderCycleChart`.
9. **SETTINGS** (Stage 5) — `renderSettings`, `exportData`, `validateBackup`, `normalizeBackup`.
10. **STAGE 7 — BACKUPS** — snapshots and the reminder panel.

These banner comment strings are load-bearing: `__verify_cycle.js` slices the pure-function block by them (`slice('// CYCLE LOGIC', 'function renderToday')`), so renaming a section banner breaks the cycle test harness.

### Data model (the thing to preserve)

All user data lives under a **single `localStorage` key `cykl.data`** — one read, one write. Stage 7 added a **second key `cykl.snapshots`** for automatic in-app snapshots (kept under `SNAPSHOT_KEY`, capped at `SNAPSHOT_LIMIT`). Shape of `state`:

```js
{
  v: 1,
  settings: { cycleLen: 28, periodLen: 5, lutealLen: 14 },
  backup:   { freq: 'month', lastExport: null, lastExportCount: 0 },  // 'daily'|'week'|'month'|'never'
  days: { "2026-08-17": { flow: 3, sym: [...], mood: [...], note: "..." } }
}
```

- Mutations go through `updateDay` / `setSettings` / `setBackup`, each of which calls `saveState()`. `saveState` **debounces** writes (~100ms) so it never blocks a gesture.
- `updateDay` **deletes a day from `days` once it has no flow/sym/mood/note**, so storage doesn't bloat — keep this behavior.
- `loadState` merges saved data over defaults (`Object.assign`) so older saved states gain new fields safely.
- `flow`: `1`=spotting, `2`=light, `3`=medium, `4`=heavy; **period days are `flow >= 2`** (spotting is displayed but excluded from stats/predictions).

### Cycle logic — read docs/SPEC.md §5 first

The pure functions (`getPeriodDays`, `groupPeriods`, `computeCycles`, `getAverageCycleLength`, `predictNextCycles`, `getTodayCycleDay`, …) encode a spec that lives in **docs/SPEC.md §5**. Treat that section as the contract. Key invariants: consecutive period days group into one period even across a single 1-day gap (a ≥2-day gap starts a new period); cycle length is measured **between the starts** of two periods; only cycles of 15–60 days count toward the average; the average uses at most the **last 6** valid cycles; predictions loop forward (`next_start + avg`) until in the future; ovulation = `next_start − lutealLen`, fertile window = 5 days before through 1 day after; and **predictions must always render differently from manually-entered data** (outline/dashed, never a solid fill). `renderHistory`'s "Średnia długość cyklu" tile must call `getAverageCycleLength()` (capped at 6), not an inline mean.

### Dates are local, always

Day keys are `YYYY-MM-DD` in **local time, never UTC**. Build them with `toKey(date)` and parse with `fromKey(key)` → `new Date(y, m - 1, d)`. Never call `new Date("2026-08-17")` — it parses as UTC and the day shifts. This is the single most likely source of a subtle bug.

## Conventions

- **No external libraries and no web fonts** — the app must work fully offline. Use the system font stack and inline SVG.
- The design tokens in `:root` (`--night #141020`, `--rose #F05C7C`, `--mint #68CEB6`, `--amber #F7B858`, …) define the visual identity. Reuse them rather than introducing new colors.
- `sw.js` is a **cache-first** service worker covering `index.html`, `manifest.json`, and the icons. Because it serves from cache, a phone may show a stale copy after deploy — users hard-reload / re-add-to-home-screen to pick up a change.
- `__body.json` and the `*.png` screenshots plus the `.playwright-mcp/` logs are committed working artifacts from previous verification sessions; they're not part of the shipped app.
- **docs/SPEC.md is the source of truth** for the data model (§4), the cycle rules (§5), and the visual direction (§6). Read it before changing any of those, and keep its stage checkboxes accurate.
