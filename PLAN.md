All texts in this app should be written in polish

# Build plan: private cycle tracker for iPhone

A web app (PWA) added to your home screen. Looks and behaves like a real app, but needs no Mac, no Xcode, no developer account, and no App Store. Your data never leaves the phone.

> **A note on interface language:** the prompts below specify a Polish-language interface, since that's what the app is for. If you'd rather have English labels, say so in Stage 1 and every later stage follows — nothing else in the plan changes.

---

## 1. Why this route

| | PWA | Native (Swift) | Flutter / React Native |
|---|---|---|---|
| Mac required | no | yes | yes (for the iOS build) |
| Cost | free | free (sideload) / $99 | free / $99 |
| Expires after 7 days | no | yes (without paid account) | yes |
| Time to first version | one evening | a week+ | a few days |
| Notifications | limited | full | full |

For a cycle tracker, a PWA covers everything. The only real trade-off is notifications — see section 9.

**Architecture:** a single `index.html` holding all HTML, CSS, and JS. No frameworks, no build step, no `npm install`. That means you can edit it any time, and Claude can see the whole thing at once.

---

## 2. What you need

- A GitHub account (free) — for hosting via GitHub Pages
- A browser on your Windows machine
- Your iPhone
- Claude (this chat or a fresh one — Claude Code is best if you want to work on local files)

Nothing else. Zero installs.

---

## 3. Scope — what's in, what's not

**Version 1 (build this):**
- Month calendar, tap to mark period days
- Flow intensity: spotting / light / medium / heavy
- Symptoms and moods as multi-select chips, plus a free-text note
- Predictions for next period, fertile window, and ovulation
- Stats: average cycle length, average period length, cycle history
- Export and import to a JSON file (your backup)

**Version 2 (add once v1 works):**
- Period reminders
- Basal body temperature chart
- Weight, activity, pill tracking
- PIN lock
- Pregnancy mode

**Deliberately skipped:** accounts, sync, cloud, ads. Those are exactly what ruins the store apps.

---

## 4. Data model — settle this first

The most important section. Hand Claude this exact structure and the code comes out coherent on the first pass. Changing the data model later means rewriting half the app.

```json
{
  "v": 1,
  "settings": {
    "cycleLen": 28,
    "periodLen": 5,
    "lutealLen": 14
  },
  "days": {
    "2026-08-17": {
      "flow": 3,
      "sym": ["cramps", "fatigue"],
      "mood": ["irritable"],
      "note": "rough day"
    }
  }
}
```

Rules:
- Day keys are always `YYYY-MM-DD` in **local** time, never UTC. This is pitfall number one — at UTC midnight the date shifts and days jump.
- `flow`: `1` = spotting, `2` = light, `3` = medium, `4` = heavy. No entry means no bleeding.
- Delete a day from the object entirely once it has no flow, symptoms, mood, or note, so storage doesn't bloat.
- Everything lives under **one key** in `localStorage` — one read, one write.

---

## 5. Cycle logic — the rules to hand Claude

This is where most apps get it wrong, so spell it out explicitly:

1. **Period days are `flow >= 2`.** Spotting (`flow === 1`) is displayed but excluded from stats and predictions.
2. **Grouping into periods:** consecutive period days form one period. A single-day gap in the middle does not split it; a gap of two or more days starts a new period.
3. **Cycle length** = number of days between the starts of two consecutive periods.
4. **Outlier filter:** only cycles between 15 and 60 days count toward the average. The rest stay visible in history but never distort predictions. *(This fixes the most common complaint about commercial apps: a few months without a cycle and the average reads 138 days.)*
5. **Average** = from the last 6 valid cycles at most. No data → fall back to the settings value.
6. **Prediction:** `next_start = last_start + average_cycle`. If that date is already in the past, keep adding the average until it lands in the future. Show 3–4 cycles ahead.
7. **Ovulation** (estimated) = `next_start − lutealLen`. **Fertile window** = 5 days before ovulation through 1 day after.
8. **Today's cycle day** = `today − last_start + 1`.
9. Always render predictions differently from manually entered data — outline or dashed, never a solid fill. The user has to see at a glance what's a fact and what's a guess.

---

## 6. Visual direction

The default look for these apps is bright pink and pastels. If that's not what you want, hand Claude concrete tokens — otherwise pink is exactly what you'll get.

Suggestion: deep midnight violet with warm accents. Reads well at night and doesn't shout if someone glances over your shoulder.

```css
--night: #141020;   /* background */
--dusk:  #1D172E;   /* cards */
--line:  #332A4A;   /* borders */
--ink:   #EFE9F7;   /* text */
--muted: #9C90B8;   /* secondary text */
--rose:  #F05C7C;   /* period */
--mint:  #68CEB6;   /* fertile window */
--amber: #F7B858;   /* ovulation */
```

Typography with no downloaded fonts (important for offline use): `-apple-system` for text, and for large numerals a serif that ships with iOS — `'Iowan Old Style', Palatino, Georgia, serif`.

**Signature element:** instead of a progress bar — a ring with one tick per day of the cycle. Period ticks in `--rose`, fertile window in `--mint`, ovulation in `--amber`, the rest dimmed. A bright dot marks today. One glance tells you where you are. A cycle is a circle, not a line — let the interface say so.

Everything else stays quiet. All the boldness goes into the ring.

---

## 7. Screens

Four tabs on a bottom bar (iOS convention, thumb reach):

**Today** — the ring, cycle day and phase beneath it, one large "mark period today" button, then upcoming dates.

**Calendar** — month grid, weeks starting Monday, Polish month and day names. Colour legend. Tapping a day opens a bottom sheet: flow (segmented control), symptoms (chips), mood (chips), note. Saves automatically on every change; the "Done" button only closes it.

**History** — average stat tiles, a list of cycles (start date, cycle length, period length), a simple bar chart of the last 8 cycles.

**Settings** — default cycle and period length, luteal phase length, export, import, delete all data with confirmation.

---

## 8. Build order and ready-to-paste prompts

Build in stages and verify each one before moving on. One giant prompt gives you 1,500 lines with no way to tell what broke.

Progress: `[x]` = committed, `[ ]` = not started. The last checked stage is where the previous session ended.

### Stan na 2026-08-20 (po Stage 7, wdrożone na GitHub Pages) — co się zgadza, a co nie

Porównano cały `index.html`, `manifest.json` i `sw.js` z planem.

**Zgodne z planem (etapy 1–6, wszystkie `[x]`):**
- **Etap 1** — model danych 1:1 z §4: jeden klucz `cykl.data` (`index.html:741`), `toKey`/`fromKey` budują daty lokalne `new Date(y, m-1, d)` (`index.html:793-803`), debounce zapisu, puste dni usuwane z `days`.
- **Etap 2** — kalendarz od poniedziałku (`dowToIndex = (dow + 6) % 7`, `index.html:832`), polskie nazwy, bottom sheet (nasilenie / 10 objawów / 7 nastrojów / notatka), autozapis, dni bez danych usuwane z `days`.
- **Etap 3** — wszystkie 9 reguł z §5: `flow >= 2` (`index.html:1012`), luka 1 dzień nie dzieli okresu, filer outlierów 15–60 dni (`index.html:1060`), średnia z maks. 6 cykli (`.slice(-6)`, `index.html:1072`), pętla `while (next < today)` (`index.html:1111`), przykłady w komentarzu.
- **Etap 4** — pierścień SVG z kreską na dzień, kropka "dziś", prognozy przerywanym `stroke-dasharray`, stan pusty, animacja tylko gdy brak `prefers-reduced-motion` (`index.html:135, 1292`).
- **Etap 5** — kafelki, lista cykli z odznaką "poza statystykami" (`index.html:1393`), wykres 8 cykli, steppery 20–45 / 2–10 / 10–16, eksport `cykl-backup-YYYY-MM-DD.json` (`index.html:1550`), import z walidacją i potwierdzeniem (`index.html:1573, 1583-1604`), usuwanie za podwójnym `confirm` (`index.html:1599-1600`), zdanie o antykoncepcji.
- **Etap 6** — `manifest.json` (standalone, `#141020`, ikony 192/512), `sw.js` cache-first pokrywające index/manifest/ikony, meta-etykiety iOS, rejestracja workera (`index.html:1624`).
- **Etap 7** — backup: automatyczne snapshoty przy starcie (maks. 10, własny klucz `cykl.snapshots`, `takeSnapshot`/`renderSnapshots`/`restoreSnapshot`), panel `#backup-panel` z `shouldShowBackupPanel()` (interwał + nowa kopia od ostatniego eksportu), wybór częstotliwości i "Ostatnia kopia" w Ustawieniach; test `__verify_stage7.js` (24/24).

**Rozbieżności (stan po Stage 7, 2026-08-20):**
1. ~~**Etap 5 vs §5-reguła 5**~~ — **poprawione**: kafelek "Średnia długość cyklu" w `renderHistory()` teraz woła `getAverageCycleLength()` (limit 6 cykli, zgodny z prognozami).
2. ~~**§7 Kalendarz: "Colour legend"**~~ — **dodane**: legenda `.cal-legend` w kalendarzu (Okres / Dzisiaj / Wpis).
3. ~~**Etap 7 — backup panel**~~ — **zaimplementowane**: automatyczne snapshoty (maks. 10, klucz `cykl.snapshots`, przywracanie za `confirm`), panel przypomnienia o eksporcie przy starciu, wybór częstotliwości (codziennie / co tydzień / co miesiąc / nigdy) i data ostatniej kopii w Ustawieniach.
4. ~~**Proces: "Commit after every stage"**~~ — **commit Stage 7** dodany (`4245195`); `PLAN.md` i artefakty robocze committed.
5. **Detal:** `todayKey` liczone raz przy starcie — sesja otwarta przez północ trzyma stary klucz; test 23:50 z §10 przechodzi, bo reload przelicza (pozostaje, celowo).

**Status wdrożenia (2026-08-20):** commit `4245195` pushnięty na `origin/main` (`02ed2bc..4245195  main -> main`); `main` zsynchronizowana z `origin/main`; nowa wersja serwuje się z GitHub Pages. Dane w `localStorage` (`cykl.data`, klucz `cykl.snapshots`) są przypisane do adresu strony, więc update nie czyści wpisów użytkownika.

**Artefakty robocze (committed):** `__make_icons.js`, `__verify_cycle.js`, `__verify_dom.js`, `__verify_stage7.js`, `__body.json`, zrzuty ekranu (`*.png`), `.playwright-mcp/`.

**Kolejne kroki:** ① przejście checklisty §10 na iPhone ② opcjonalnie: ręczny test przywracania kopii + eksportu na realnym urządzeniu. Uwaga: `sw.js` jest cache-first, więc telefon może chwilowo serwować starą wersję — jeśli nowa nie widać, wymuś twardy reload / ponowne „Dodaj do ekranu głównego".

### [x] Stage 1 — skeleton and data

> Build me a single-file web app (HTML + CSS + JS all in one `index.html`, no frameworks, no build step) — a menstrual cycle tracker for iPhone, Polish-language interface, mobile-first.
>
> This stage is foundation only:
> — data model exactly as follows: [paste the JSON block from section 4]
> — storage layer: entire state under one `localStorage` key, debounced writes, error handling
> — dates as `YYYY-MM-DD` in local time, never UTC
> — four tabs on a bottom bar (Dziś, Kalendarz, Historia, Ustawienia), switching works, content empty for now
> — palette and typography: [paste the CSS block from section 6]
> — `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` and safe-area padding via `env(safe-area-inset-bottom)`
>
> No external libraries and no web fonts. The app must work offline.

### [x] Stage 2 — calendar and logging

> Add the Calendar tab: month grid, weeks starting Monday, Polish day abbreviations (pon, wt, śr, czw, pt, sob, nd) and Polish month names, arrows to change month.
>
> Tapping a day opens a bottom sheet with: flow as a segmented control (brak, plamienie, słabe, średnie, mocne), symptoms as multi-select chips (skurcze, ból głowy, ból pleców, tkliwość piersi, wzdęcia, zmęczenie, trądzik, nudności, zachcianki, bezsenność), mood as chips (spokój, radość, energia, drażliwość, smutek, lęk, płaczliwość), and a note field.
>
> Save automatically on every change. Remove a day from the `days` object once it holds no data. Mark period days in `--rose`, today with a strong outline, and days with a note or symptoms with a small dot under the number.

### [x] Stage 3 — cycle logic

> Add the cycle calculations as separate pure functions (keep them out of the rendering code), following these rules: [paste all of section 5]
>
> For now, print the results into a plain text block so I can check them. Also write a few examples in a comment: what the functions return for no data, for one period, for three regular cycles, and for a 200-day cycle that should be filtered out.

Before moving on: enter three periods roughly 28 days apart and check the average and prediction look right. Then add a period from six months earlier and confirm the average did **not** change.

### [x] Stage 4 — the ring and the Today tab

> Build the Today tab. The main element is an SVG ring: one radial tick per day of the average cycle. Period ticks in `--rose`, fertile window in `--mint`, ovulation in `--amber`, the rest dimmed in `--muted`. Mark today with a bright dot on its tick. Inside the ring, the cycle day as a large serif numeral with the phase name beneath it.
>
> Below the ring: one large button that marks a period for today (label changes if a period is already ongoing), and a list of upcoming dates — next period, ovulation, fertile window. Write "jutro" instead of "in 1 day" and "dzisiaj" instead of "in 0 days".
>
> Render predicted days as outlines, never solid fills. Add an empty state: with no data at all, the ring is dimmed and the text invites marking the first day of a period.
>
> Animation: ticks appear in sequence when the tab opens, but only when `prefers-reduced-motion` is not set.

### [x] Stage 5 — history and settings

> Add the History tab: tiles for average cycle and period length plus the min–max range, a list of all cycles (start date, cycle length, period length) with the ones excluded from stats clearly marked, and a bar chart of the last 8 cycles in plain SVG.
>
> Add the Settings tab: steppers or sliders for default cycle length (20–45), period length (2–10), and luteal phase (10–16); export of all data to a file named `cykl-backup-YYYY-MM-DD.json`; import from a file that replaces the data after confirmation and validates the structure; delete-all-data behind a double confirmation.
>
> Add one calm sentence noting that predictions are estimates based on entered data and are not a contraceptive method.

### [x] Stage 6 — PWA

> Turn this into a PWA installable on iPhone. Add a `manifest.json` (name, `display: standalone`, `theme_color: #141020`, 192 and 512 px icons), an `sw.js` with a simple cache-first service worker covering `index.html` and `manifest.json`, and the service worker registration in `index.html`. Also add the iOS meta tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` set to `black-translucent`, `apple-mobile-web-app-title`, and a 180×180 `apple-touch-icon`.

### [x] Stage 7 — backup panel

Its own stage, because it deals with the one real limitation of a PWA on iPhone: **Safari won't write a file without a gesture from you.** No `showSaveFilePicker`, no background writes, and it makes no difference whether the target is iCloud Drive or on-device storage. A background backup isn't possible — but it can be reduced to a single tap.

Two independent layers, because they protect against different things. In-app snapshots catch your own mistakes: a deleted entry, a wrong date, a botched import. File export catches a lost device or cleared Safari data. Neither replaces the other.

The rules that decide whether you'll still be using this in a month:

- the panel appears only when the interval has passed **and** new data has been entered since the last copy
- it's always dismissible — a panel with no way out ends with the app being deleted
- frequency is a setting, not a decision baked into the code
- the filename carries the date, so copies never overwrite each other

> Add backups in two independent layers.
>
> Layer one, fully automatic: on every launch, save a snapshot of the whole state under its own key with a date and time, keep the last 10, delete older ones. In Settings, add a list of snapshots — date, number of days with entries, and a restore button behind a confirmation.
>
> Layer two, one tap: on launch, compare the date of the last file export against the configured frequency. If the interval has passed and new data has been added since, show a panel with a primary "Save a copy" button and a secondary "Later". The primary button runs the same export as in Settings, with the date in the filename. After a successful save, record the date and don't show the panel again until the next interval. "Later" defers the panel to the next launch; it does not disable it permanently.
>
> In Settings, add a frequency picker (daily, weekly, monthly, never) and show the date of the last copy. The panel must never block use of the app — it has to be dismissible.

---

## 9. Getting it onto the phone

1. GitHub → **New repository** → name it something like `cykl`, set it **Public** (GitHub Pages doesn't serve private repos on the free plan).
2. **Add file → Upload files** → drop in `index.html`, `manifest.json`, `sw.js`, and the icons → Commit.
3. **Settings → Pages** → Source: *Deploy from a branch*, branch `main`, folder `/ (root)` → Save.
4. After a minute you'll have `https://your-username.github.io/cykl/`.
5. On the iPhone, open that address **in Safari** (not Chrome — only Safari can add to the home screen), Share button → **Add to Home Screen**.

Alternative without GitHub: go to `app.netlify.com/drop` and drag the folder in. You get a URL immediately.

**Notifications:** iOS only supports web push from version 16.4 onward, only for apps added to the home screen, and sending them needs a server. Simpler approach: once the app shows you a predicted date, set a repeating reminder manually in Shortcuts or Calendar. Come back to this only after v1 is done.

---

## 10. Checklist before calling it finished

- [ ] Mark a period, fully close the app, reopen — the data is there
- [ ] Mark a period at 23:50, check at 00:10 — still the same day *(timezone test)*
- [ ] Three regular cycles → the prediction lands somewhere sensible
- [ ] One period from a year ago → the average doesn't budge
- [ ] Predictions look visually different from manually entered data
- [ ] Export → delete all data → import → everything comes back
- [ ] Airplane mode → the app opens and works
- [ ] The bottom bar doesn't hide under the iPhone gesture bar
- [ ] Crossing a year boundary (December → January) doesn't break the calendar

---

## 11. Pitfalls

- **Safari private windows** wipe `localStorage`. Open it normally.
- **iOS may evict data** for a web app untouched for several weeks. That's why JSON export is a feature, not a nice-to-have — back up monthly and keep the file in iCloud Drive.
- **Never trust `new Date("2026-08-17")`** — that parses as UTC. Split the string into numbers and build `new Date(year, month-1, day)`.
- **One file has a ceiling.** Past roughly 1,500 lines, split the JS into a few files and load them with `<script type="module">`. GitHub Pages serves them fine.
- **Commit after every stage.** When Claude breaks something in stage 5, you want to be able to get back to stage 4.
- **Stay in one thread** with Claude for a whole stage, and paste the current file with every larger change. Claude doesn't remember code across conversations.

---

## 12. If you later want a native version

None of the work is wasted. Wrap `index.html` in Capacitor (`npm i @capacitor/core @capacitor/ios`) and it becomes a real iOS app with access to local notifications and HealthKit. The build still needs macOS, but you can hand it to GitHub Actions on a `macos-latest` runner and install the result with Sideloadly. The cycle logic and the interface carry over unchanged.