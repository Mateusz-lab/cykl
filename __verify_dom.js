// Runs the REAL renderToday()/initCalendar()/renderCalendar() from index.html
// against a minimal DOM stub and inspects the produced markup.
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));

// ---- minimal DOM stub ------------------------------------------------------
function makeEl(tag) {
  const el = {
    tag, children: [], attributes: {}, dataset: {}, style: {},
    _class: new Set(), parentNode: null,
    get className() { return [...this._class].join(' '); },
    set className(v) { this._class = new Set(v.split(/\s+/).filter(Boolean)); },
    classList: {
      add: c => el._class.add(c),
      remove: c => el._class.delete(c),
      toggle: (c, f) => { (f === undefined ? !el._class.has(c) : f) ? el._class.add(c) : el._class.delete(c); return el._class.has(c); },
      contains: c => el._class.has(c),
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    append(...ns) { ns.forEach(c => this.appendChild(c)); },
    addEventListener() {},
    value: '',
  };
  // faithful textContent: getter aggregates descendant text, setter replaces it
  let _text = '';
  Object.defineProperty(el, 'textContent', {
    get: () => _text + el.children.map(c => c.textContent).join(''),
    set: v => { _text = String(v); el.children = []; },
  });
  let _innerHTML = '';
  Object.defineProperty(el, 'innerHTML', {
    get: () => _innerHTML,
    set: v => { _innerHTML = v; if (v === '') el.children = []; },
  });
  return el;
}

function buildEnv(seed) {
  const byId = {};
  const document = {
    getElementById: id => (byId[id] ||= makeEl('div#' + id)),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: t => makeEl(t),
    createElementNS: (_ns, t) => makeEl(t),
  };
  const store = new Map(seed ? [['cykl.data', seed]] : []);
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: k => store.delete(k),
  };
  const window = { matchMedia: () => ({ matches: false }) };
  return { document, localStorage, window };
}

// run the real script with a given localStorage seed; return the DOM snapshot
function run(seed) {
  const { document, localStorage, window } = buildEnv(seed);
  new Function('document', 'localStorage', 'window', script)(document, localStorage, window);
  return document;
}

const pass = [], fail = [];
function check(name, cond, detail) {
  (cond ? pass : fail).push(name);
  if (!cond) console.log(`  FAIL ${name}${detail ? '\n    ' + detail : ''}`);
}
const day = k => k; // keys already YYYY-MM-DD

// ================= Scenario A: empty (no data) =================
let doc = run(null);
let wrap = doc.getElementById('ring-wrap');
let num = doc.getElementById('ring-day-num');
let phase = doc.getElementById('ring-phase');
let btn = doc.getElementById('mark-period-btn');
let list = doc.getElementById('upcoming-list');
let svg = doc.getElementById('cycle-ring');
let ticks = svg.children.filter(c => c.tag === 'line');

check('A empty: ring-wrap has ring-empty', wrap.classList.contains('ring-empty'));
check("A empty: day numeral is '—'", num.textContent === '—', 'got ' + JSON.stringify(num.textContent));
check('A empty: phase invites first entry', /pierwsz/i.test(phase.textContent), 'got ' + JSON.stringify(phase.textContent));
check("A empty: button says mark first day", /pierwszy dzień okresu/i.test(btn.textContent), 'got ' + JSON.stringify(btn.textContent));
check('A empty: 28 ticks (settings cycleLen)', ticks.length === 28, 'got ' + ticks.length);
check('A empty: all ticks predicted (dashed)', ticks.every(t => t.getAttribute('class').includes('tick-predicted')));
check('A empty: no today dot', !svg.children.some(c => c.tag === 'circle'));
check('A empty: upcoming shows invite text', list.children.length === 1 && /Zaznacz okres/i.test(list.children[0].textContent));

// ================= Scenario B: 3 regular cycles =================
function seedPeriod(start, len, flow = 3) {
  const d = new Date(start[0], start[1], start[2]);
  const out = {};
  const key = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  for (let i = 0; i < len; i++) {
    const x = new Date(d); x.setDate(d.getDate() + i);
    out[key(x)] = { flow };
  }
  return out;
}
const daysObj = Object.assign({},
  seedPeriod([2026, 5, 17], 5), seedPeriod([2026, 6, 15], 5), seedPeriod([2026, 7, 12], 5));
const seedJSON = JSON.stringify({ v: 1, settings: { cycleLen: 28, periodLen: 5, lutealLen: 14 }, days: daysObj });

doc = run(seedJSON);
wrap = doc.getElementById('ring-wrap'); num = doc.getElementById('ring-day-num');
phase = doc.getElementById('ring-phase'); btn = doc.getElementById('mark-period-btn');
list = doc.getElementById('upcoming-list'); svg = doc.getElementById('cycle-ring');
ticks = svg.children.filter(c => c.tag === 'line');

// expected cycle day from actual run date, last start 2026-08-12
const t = new Date(); t.setHours(0, 0, 0, 0);
const expCycleDay = Math.round((t - new Date(2026, 7, 12)) / 86400000) + 1;

check('B: ring NOT in empty state', !wrap.classList.contains('ring-empty'));
check('B: day numeral = cycle day', num.textContent === String(expCycleDay), `got ${num.textContent}, want ${expCycleDay}`);
check('B: phase name present', phase.textContent.length > 0, 'got ' + JSON.stringify(phase.textContent));
check("B: button = 'Zaznacz okres na dziś'", /Zaznacz okres na dziś/.test(btn.textContent), 'got ' + JSON.stringify(btn.textContent));
check('B: button not in unmark state', !btn.classList.contains('unmark'));
check('B: has today dot circle', svg.children.some(c => c.tag === 'circle' && c.getAttribute('id') === 'today-dot'));
check('B: upcoming has 3 items (period, ovulation, fertile)', list.children.length === 3, 'got ' + list.children.length);

// tick coloring: period days 1-5 solid rose; entered (dates<=today & flow>=2) are NOT dashed
const clsOf = i => ticks[i] ? ticks[i].getAttribute('class') : '';
check('B: tick day1 period+solid', /tick-period/.test(clsOf(0)) && !/tick-predicted/.test(clsOf(0)), clsOf(0));
check('B: tick day5 period+solid', /tick-period/.test(clsOf(4)) && !/tick-predicted/.test(clsOf(4)), clsOf(4));
check('B: tick day14 ovulation', /tick-ovulation/.test(clsOf(13)), clsOf(13));
check('B: tick day12 fertile', /tick-fertile/.test(clsOf(11)), clsOf(11));
check('B: tick day20 rest', /tick-rest/.test(clsOf(19)), clsOf(19));
check('B: future period ticks are dashed (predicted)', /tick-predicted/.test(clsOf(6)) && /tick-predicted/.test(clsOf(13)));

// upcoming item contents
const item = i => list.children[i];
check('B: item1 label Następny okres', item(0).children[0].textContent === 'Następny okres', item(0).children[0].textContent);
check('B: item2 label Owulacja', /Owulacja/.test(item(1).children[0].textContent), item(1).children[0].textContent);
check('B: item3 label Okno płodne', /Okno płodne/.test(item(2).children[0].textContent), item(2).children[0].textContent);

// relative wording: today's next period is 2026-09-09 => not dzisiaj/jutro => "za N dni"
check('B: rel text is Polish "za N dni"', /za \d+ dni/.test(item(0).textContent), item(0).textContent);

// ================= Scenario C: clicking mark button toggles today ============
doc = run(seedJSON);
// simulate a click by re-running: seed today as a period day and confirm label flips
const todayKey = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
const withToday = JSON.parse(seedJSON); withToday.days[todayKey] = { flow: 3 };
const doc2 = run(JSON.stringify(withToday));
const btn2 = doc2.getElementById('mark-period-btn');
check("C: with today marked, button = 'Odznacz okres na dziś'", /Odznacz okres na dziś/.test(btn2.textContent), 'got ' + JSON.stringify(btn2.textContent));
check('C: today-marked button has unmark style', btn2.classList.contains('unmark'));

console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
