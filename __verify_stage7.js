// Runs the REAL Stage 7 backup code (panel-due logic, snapshots, restore,
// import/normalize threading, and the avg-cycle tile) from index.html against
// a minimal DOM stub + a localStorage Map, then inspects both the DOM and the
// saved snapshot store. Mirrors the harness style in __verify_dom.js.
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));

// ---- minimal DOM stub (same shape as __verify_dom.js) ----------------------
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
    body: makeEl('body'),
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

const pass = [], fail = [];
function check(name, cond, detail) {
  (cond ? pass : fail).push(name);
  if (!cond) console.log(`  FAIL ${name}${detail ? '\n    ' + detail : ''}`);
}

// Build N consecutive days-of-entries starting 2026-05-20.
function daysWith(n, flow = 3) {
  const out = {};
  const d = new Date(2026, 4, 20);
  for (let i = 0; i < n; i++) {
    const x = new Date(d); x.setDate(d.getDate() + i);
    const k = x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    out[k] = { flow };
  }
  return out;
}

// Test body appended to the script so it shares the script's scope: it can read
// `state` directly, call the app's internal functions, and monkeypatch them.
const testCode = `
;(() => {
  function setDays(n) {
    state.days = {};
    const d = new Date(2026, 4, 20);
    for (let i = 0; i < n; i++) {
      const x = new Date(d); x.setDate(d.getDate() + i);
      const k = x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
      state.days[k] = { flow: 3 };
    }
  }
  const resetBackup = () => Object.assign(state.backup, BACKUP_DEFAULTS);

  // --- init wiring: seeded 5 days -> init's takeSnapshot + renderSettings listed it ---
  let initList = document.getElementById('snapshot-list');
  check('I1: init with data -> snapshot list has 1 item', initList.children.length === 1, 'got ' + initList.children.length);

  // ================= Panel-due logic (shouldShowBackupPanel) =================
  resetBackup(); setDays(0);
  check('P1: no data -> not due', shouldShowBackupPanel() === false);
  setDays(5);
  check('P2: data + never exported -> due', shouldShowBackupPanel() === true);
  markExportDone();
  check('P3: export records today + count 5', state.backup.lastExport !== null && state.backup.lastExportCount === 5, JSON.stringify(state.backup));
  check('P4: after export (no new data) -> not due', shouldShowBackupPanel() === false);
  setDays(7);
  check('P5: new data but interval not yet elapsed -> not due', shouldShowBackupPanel() === false);
  // simulate 40 days having passed since the export (interval 30d now elapsed)
  const past = new Date(); past.setDate(past.getDate() - 40);
  state.backup.lastExport = toKey(past);
  check('P6: new data + interval elapsed -> due again', shouldShowBackupPanel() === true);
  resetBackup(); setDays(3); state.backup.freq = 'never';
  check('P7: freq=never -> never due', shouldShowBackupPanel() === false);
  state.backup.freq = 'month';

  // ================= Automatic snapshots (keep last 10) =================
  localStorage.removeItem('cykl.snapshots');
  setDays(3);
  for (let i = 0; i < 13; i++) takeSnapshot();
  check('S1: takeSnapshot keeps last 10', loadSnapshots().length === SNAPSHOT_LIMIT, 'got ' + loadSnapshots().length);
  check('S2: snapshots stored under own key', localStorage.getItem('cykl.snapshots') !== null);
  const n0 = loadSnapshots().length;
  setDays(0); takeSnapshot();
  check('S3: empty state adds no snapshot', loadSnapshots().length === n0, 'got ' + loadSnapshots().length);
  setDays(4); takeSnapshot();
  check('S4: snapshot records full state (4 days captured)', Object.keys(loadSnapshots()[loadSnapshots().length - 1].d.days).length === 4);

  // ================= Snapshot list rendering =================
  localStorage.removeItem('cykl.snapshots');
  setDays(3); takeSnapshot();
  renderSnapshots();
  let listEl = document.getElementById('snapshot-list');
  check('L1: list renders 1 item', listEl.children.length === 1, 'got ' + listEl.children.length);
  check('L2: item is a snapshot-item with a restore button',
    listEl.children[0].classList.contains('snapshot-item')
    && listEl.children[0].children.some(c => c.className === 'snapshot-restore'), JSON.stringify(listEl.children[0].children.map(c => c.className)));
  check('L3: item shows "N dni z wpisami" count', /dni z wpisami/.test(listEl.textContent), listEl.textContent);
  check('L4: count reflects snapshot (3 dni)', listEl.textContent.includes('3 dni z wpisami'), listEl.textContent);
  // empty state
  localStorage.removeItem('cykl.snapshots');
  renderSnapshots();
  listEl = document.getElementById('snapshot-list');
  check('L5: empty list shows the hint', /Brak automatycznych kopii/.test(listEl.textContent), listEl.textContent);

  // ================= Restore replaces current state =================
  localStorage.removeItem('cykl.snapshots');
  setDays(5); takeSnapshot();
  check('R0: snapshot captured 5 days', Object.keys(loadSnapshots()[0].d.days).length === 5, 'got ' + Object.keys(loadSnapshots()[0].d.days).length);
  setDays(2);                 // current state diverges from the snapshot
  restoreSnapshot(0);
  check('R1: restore replaces state.days with the snapshot (5 days)', Object.keys(state.days).length === 5, 'got ' + Object.keys(state.days).length);
  check('R2: restore preserves backup settings', state.backup.freq === 'month');

  // ================= Import/normalize threading =================
  check('N1: validateBackup accepts a backup object', validateBackup({ settings: {}, days: {} }) === true);
  const norm = normalizeBackup({ settings: {}, days: { '2026-01-01': { flow: 3 } }, backup: { freq: 'daily', lastExport: null, lastExportCount: 0 } });
  check('N2: normalizeBackup threads backup through', norm.backup && norm.backup.freq === 'daily' && 'lastExport' in norm.backup);

  // ================= Avg-cycle tile is sourced from getAverageCycleLength ====
  // Monkeypatch the helper to a sentinel and confirm the renderHistory tile
  // reflects it — proves the tile uses the capped helper, not an inline mean.
  getAverageCycleLength = function () { return 12345; };
  renderHistory();
  const grid = document.getElementById('stat-grid');
  const avgTile = grid.children[0];
  check('T1: first tile is the cycle-average tile', avgTile.children[1].textContent === 'Średnia długość cyklu', avgTile.children[1].textContent);
  check('T2: avg tile sourced from getAverageCycleLength (sentinel 12345)', avgTile.children[0].textContent.includes('12345'), avgTile.children[0].textContent);
})();
`;

function run(seed) {
  const { document, localStorage, window } = buildEnv(seed);
  new Function('document', 'localStorage', 'window', 'check', 'confirm', 'alert',
    script + '\n' + testCode)(document, localStorage, window, check, () => true, () => {});
  return { document, localStorage };
}

// Seed: 5 days of data + defaults -> init's takeSnapshot creates a snapshot.
run(JSON.stringify({ v: 1, settings: { cycleLen: 28, periodLen: 5, lutealLen: 14 }, days: daysWith(5) }));

console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
