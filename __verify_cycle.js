// Verification harness: extract the REAL pure functions from index.html and test them.
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');

function slice(startMarker, endMarker) {
  const s = html.indexOf(startMarker);
  const e = html.indexOf(endMarker, s);
  if (s < 0 || e < 0) throw new Error('marker not found: ' + startMarker);
  return html.slice(s, e);
}

// Date helpers + the Stage 3 cycle-logic block + Stage 4 pure helpers (relPL/phaseName/fmtPL)
const code =
  slice('// DATE HELPERS', '// TAB NAVIGATION') +
  '\n' +
  slice('// CYCLE LOGIC', 'function renderToday'); // includes fmtPL/relPL/phaseName, ends before the DOM code

// Controllable state (mirrors the app's default)
let state = { v: 1, settings: { cycleLen: 28, periodLen: 5, lutealLen: 14 }, days: {} };

const api = new Function('state', code +
  '\nreturn { getPeriodDays, groupPeriods, computeCycles, getAverageCycleLength, ' +
  'getLastPeriodStart, addDays, predictNextCycles, getTodayCycleDay, toKey, fromKey, relPL, phaseName };')(state);

// --- test vectors -----------------------------------------------------------
const pass = [], fail = [];
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  (ok ? pass : fail).push(name);
  if (!ok) console.log(`  FAIL ${name}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`);
}

// helper to seed a period
function seedPeriod(start, len, flow = 3) {
  for (let i = 0; i < len; i++) state.days[api.toKey(api.addDays(new Date(...start), i))] = { flow };
}

// 1. No data at all
state.days = {};
check('no data: getPeriodDays empty', api.getPeriodDays(), []);
check('no data: getAverageCycleLength = settings fallback', api.getAverageCycleLength(), 28);
check('no data: getLastPeriodStart = null', api.getLastPeriodStart(), null);
check('no data: predictNextCycles empty', api.predictNextCycles(3), []);
check('no data: getTodayCycleDay = null', api.getTodayCycleDay(), null);

// 2. Three regular 28-day cycles: starts 2026-06-17, 2026-07-15, 2026-08-12
state.days = {};
seedPeriod([2026, 5, 17], 5);
seedPeriod([2026, 6, 15], 5);
seedPeriod([2026, 7, 12], 5);
check('3 cycles: groups into 3 periods', api.groupPeriods(api.getPeriodDays()).length, 3);
const cycles3 = api.computeCycles(api.groupPeriods(api.getPeriodDays()));
check('3 cycles: lengths are 28 and 28', cycles3.map(c => c.length), [28, 28]);
check('3 cycles: both valid', cycles3.map(c => c.valid), [true, true]);
check('3 cycles: average = 28', api.getAverageCycleLength(), 28);

// 3. Outlier: single 200-day cycle must NOT distort average
state.days = {};
seedPeriod([2025, 11, 31], 5);   // 2025-12-31
seedPeriod([2026, 6, 19], 5);    // 2026-07-19  (gap ~200 days)
const cyclesOut = api.computeCycles(api.groupPeriods(api.getPeriodDays()));
check('outlier: cycle length 200', cyclesOut[0].length, 200);
check('outlier: marked invalid', cyclesOut[0].valid, false);
check('outlier: average falls back to settings (28)', api.getAverageCycleLength(), 28);

// 4. Grouping: 1-day gap stays in one period; 2+ day gap splits
state.days = {};
// period A: 3 days, then skip 1, then 2 more days (gap of 1 non-period day => same period)
seedPeriod([2026, 6, 1], 3);           // Jul 1-3
state.days[api.toKey(new Date(2026, 6, 5))] = { flow: 3 }; // Jul 5 (Jul 4 is the gap)
state.days[api.toKey(new Date(2026, 6, 6))] = { flow: 3 }; // Jul 6
// period B starts Jul 10 (gap Jul 7,8,9 = 3 non-period days => new period)
seedPeriod([2026, 6, 10], 2);
check('grouping: 1-day gap does not split; 2+ gap splits into 2 periods',
  api.groupPeriods(api.getPeriodDays()).length, 2);

// 5. relPL Polish relative wording
state.days = {};
const today = new Date(); today.setHours(0, 0, 0, 0);
check('relPL today => dzisiaj', api.relPL(today), 'dzisiaj');
check('relPL tomorrow => jutro', api.relPL(api.addDays(today, 1)), 'jutro');
check('relPL +3 => za 3 dni', api.relPL(api.addDays(today, 3)), 'za 3 dni');

// 6. phaseName sanity (avgCycle 28, luteal 14 => ovDay 14)
check('phase day 1 => Okres', api.phaseName(1, 28), 'Okres');
check('phase day 5 => Okres (periodLen)', api.phaseName(5, 28), 'Okres');
check('phase day 14 => Owulacja', api.phaseName(14, 28), 'Owulacja');
check('phase day 12 => Okno płodne', api.phaseName(12, 28), 'Okno płodne');
check('phase day 7 => Faza folikularna', api.phaseName(7, 28), 'Faza folikularna');
check('phase day 20 => Faza lutealna', api.phaseName(20, 28), 'Faza lutealna');

// 7. Prediction lands on/after today and carries ovulation/fertile window
state.days = {};
seedPeriod([2026, 7, 12], 5); // last period start Aug 12, 2026; today is Aug 18, 2026
const p = api.predictNextCycles(1)[0];
check('predict: next start is 2026-09-09', api.toKey(p.start), '2026-09-09');
check('predict: ovulation = start - luteal (14)', api.toKey(p.ovulation), '2026-08-26');
check('predict: fertileStart = ov - 5', api.toKey(p.fertileStart), '2026-08-21');
check('predict: fertileEnd = ov + 1', api.toKey(p.fertileEnd), '2026-08-27');
// cycle day depends on the actual run date, so compute the expected value from it
const t = new Date(); t.setHours(0, 0, 0, 0);
const expCycleDay = Math.round((t - api.fromKey('2026-08-12')) / 86400000) + 1;
check('predict: today cycle day matches run date', api.getTodayCycleDay(), expCycleDay);

console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
