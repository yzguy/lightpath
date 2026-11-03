// ===== App =====
(() => {
const { db, lin } = PHY;
const $ = s => document.querySelector(s);
const BOOL_ATTRS = new Set(['hidden', 'disabled', 'checked', 'selected', 'readonly', 'required', 'open', 'multiple']);
const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const k in attrs) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else if (BOOL_ATTRS.has(k)) { if (attrs[k]) e.setAttribute(k, ''); } else e.setAttribute(k, attrs[k]); } // a boolean attribute is there or not: disabled="false" would still disable
  for (const c of [].concat(kids)) if (c != null) e.append(c);
  return e;
};
const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const f1 = x => (isFinite(x) ? x.toFixed(1) : '—');
const { TYPES, PREFIX, PRESETS, uid, linkDefaults, isEnd } = MODEL;

// ---------- state ----------
let S;
let sel = null, tool = 'select';
const KEY = 'lightpath-v1', OLD_KEY = 'optical-lab-v1'; // the app was called Optical Line Lab: still read its saved lab
function load() {
  try {
    const t = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (t) { const o = JSON.parse(t), v = o && o.view; S = { ...MODEL.sanitize(o), view: v && isFinite(v.k) && isFinite(v.x) && isFinite(v.y) && v.k > 0 ? { x: v.x, y: v.y, k: v.k } : { x: -40, y: -60, k: 1 } };
      try { const l = JSON.parse(localStorage.getItem(LAB_KEY)); if (l && PRESETS[l.key]) { labKey = l.key; labHash = l.hash; } } catch (e) {} // which scenario it started as
      return; }
  } catch (e) { /* corrupt or outdated save: fall through to the default scenario */ }
  applyPreset('dci', true);
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} if (!restoring) remember(); syncLab(); }
// The Lab menu keeps showing the scenario on the bench, with "· edited" once it has been changed; a lab that is not a scenario says so.
const LAB_KEY = 'lightpath-lab';
let labKey = '', labHash = null;
const strHash = t => { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return String(h); };
function syncLab() {
  const sel = $('#preset'); if (!sel || !S) return;
  for (const o of sel.options) { o.dataset.base ??= o.textContent; o.textContent = o.dataset.base; }
  if (labKey && PRESETS[labKey]) {
    labHash ??= strHash(snapshot()); // the first render after a load is the baseline
    sel.value = labKey; sel.selectedOptions[0].textContent = sel.selectedOptions[0].dataset.base + (strHash(snapshot()) !== labHash ? ' · edited' : '');
  } else { sel.value = ''; sel.options[0].textContent = 'Your own lab · load a scenario…'; }
  try { localStorage.setItem(LAB_KEY, JSON.stringify({ key: labKey, hash: labHash })); } catch (e) {}
}
// Undo and redo: every change ends in save(), which records a snapshot of the lab (not the pan and zoom). Edits that come in a quick burst (typing a number,
// dragging a slider or a node) are one step; checkpoint() makes the next change a step of its own (a scenario load, a delete, an import, a clear).
const hist = { stack: [], i: -1, last: 0, seal: false, max: 60 };
let restoring = false;
const snapshot = () => { const { view, ...rest } = S; return JSON.stringify(rest); };
function checkpoint() { hist.last = 0; hist.seal = true; }
function remember() {
  const j = snapshot(); if (hist.stack[hist.i] === j) return;
  { const t = $('#toast'); if (!restoring && t && !t.hidden && t.querySelector('.toast-act')) t.hidden = true; } // an Undo offered for an earlier action must not outlive a later change: it would revert the wrong step
  const now = Date.now(), burst = hist.i >= 1 && hist.i === hist.stack.length - 1 && now - hist.last < 500;
  hist.stack.length = hist.i + 1; // a new change ends the redo branch
  if (burst) hist.stack[hist.i] = j; else { hist.stack.push(j); hist.i++; }
  if (hist.stack.length > hist.max) { hist.stack.shift(); hist.i--; }
  hist.last = hist.seal ? 0 : now; hist.seal = false; syncUndo();
}
function syncUndo() { const u = $('#btn-undo'), r = $('#btn-redo'); if (u) u.disabled = hist.i < 1; if (r) r.disabled = hist.i >= hist.stack.length - 1; }
function stepHistory(d) {
  const j = hist.i + d; if (j < 0 || j >= hist.stack.length) return false;
  hist.i = j; restoring = true;
  try { S = { ...S, ...MODEL.sanitize(JSON.parse(hist.stack[j])) }; if (sel && !(node(sel.id) || link(sel.id))) sel = null; renderAll(); } finally { restoring = false; }
  hist.last = 0; syncUndo(); return true;
}
const undo = () => { if (stepHistory(-1)) toast('Undone', { label: 'Redo', fn: redo }); else toast('Nothing to undo'); };
const redo = () => { if (stepHistory(1)) toast('Redone', { label: 'Undo', fn: undo }); else toast('Nothing to redo'); };
function applyPreset(k, quiet) {
  const p = MODEL.sanitize(PRESETS[k].build());
  S = { ...p, view: { x: -40, y: -60, k: 1 } }; // everything the scenario defines, its traffic flows included
  labKey = k; labHash = null; sel = null; if (!quiet) { fitView(true); checkpoint(); renderAll(); toast('Loaded: ' + PRESETS[k].name, { label: 'Undo', fn: undo }); }
}
const node = id => S.nodes.find(n => n.id === id);
const link = id => S.links.find(l => l.id === id);
const linksOf = id => S.links.filter(l => l.a === id || l.b === id);
const linkName = l => MODEL.mkGraph(S).linkName(l);
const simulate = (launchOverride, opts) => MODEL.simulate(S, launchOverride, opts);
const reqOsnr = MODEL.reqOsnr;

// ---------- canvas ----------
const svg = $('#cv'), gRoot = $('#world');
function fitView(readable) {
  if (!S.nodes.length) return;
  const xs = S.nodes.map(n => n.x), ys = S.nodes.map(n => n.y);
  const r = svg.getBoundingClientRect();
  const w = Math.max(...xs) - Math.min(...xs) + 220, h = Math.max(...ys) - Math.min(...ys) + 200;
  const k = Math.min(1.4, Math.max(0.15, Math.min(r.width / w, r.height / h)));
  S.view = { k, x: (Math.min(...xs) + Math.max(...xs)) / 2 - r.width / 2 / k, y: (Math.min(...ys) + Math.max(...ys)) / 2 - r.height / 2 / k };
  // On a phone the whole-lab overview would render labels at 5px: open at a readable zoom from the left (pan or pinch for the rest; Fit gives the overview)
  if (readable && r.width < 600 && k < 0.6) { const k2 = 0.6; S.view = { k: k2, x: Math.min(...xs) - 70 / k2, y: (Math.min(...ys) + Math.max(...ys)) / 2 - r.height / 2 / k2 }; }
}
// Text and the fault badge are drawn in canvas units, so zooming out shrinks them below what can be read. They are counter-scaled to a floor on screen (names 11px,
// cable labels and A/Z tags 9px, the badge 9px across) and only grow, never shrink, so a zoomed-in view looks as drawn.
const floorScale = (px, k, max = 2.4) => Math.min(max, Math.max(1, px / (k * 1)));
function applyView() {
  const k = S.view.k;
  gRoot.setAttribute('transform', `scale(${k}) translate(${-S.view.x},${-S.view.y})`);
  gRoot.style.setProperty('--lf1', floorScale(11, k * 11.5)); gRoot.style.setProperty('--lf2', floorScale(9, k * 11)); gRoot.style.setProperty('--lf3', floorScale(9, k * 10));
  gRoot.querySelectorAll('.faultg').forEach(g => g.setAttribute('transform', `translate(40,-16) scale(${floorScale(9, k * 8)})`));
}
function toWorld(cx, cy) { const r = svg.getBoundingClientRect(); return { x: (cx - r.left) / S.view.k + S.view.x, y: (cy - r.top) / S.view.k + S.view.y }; }

// a host whose traffic cannot get through is outlined on the canvas, like any other faulty device (computed once per change, not per drag)
let hostFaults = new Set();
function refreshHostFaults() {
  hostFaults = new Set(); if (!(S.flows || []).length) return;
  const R = MODEL.reach(S, lastRes);
  for (const f of S.flows) { const r = R.find(x => (x.a === f.a && x.z === f.z) || (x.a === f.z && x.z === f.a)); if (r && !r.ok) { hostFaults.add(f.a); hostFaults.add(f.z); } }
}
const panelDirty = n => n.type === 'panel' && !!n.p.dirty && Object.values(n.p.dirty).some(v => +v > 0.3);
function nodeShape(n) {
  const g = sv('g', { class: 'node t-' + n.type + (panelDirty(n) || hostFaults.has(n.id) ? ' faulty' : '') + (n.p && n.p.fail === 'dead' ? ' failed' : n.p && n.p.fail === 'degraded' ? ' degraded' : '') + (sel && sel.id === n.id ? ' sel' : ''), 'data-id': n.id, transform: `translate(${n.x},${n.y})`, tabindex: 0, role: 'button', 'aria-pressed': sel && sel.id === n.id ? 'true' : 'false',
    'aria-label': `${n.name}, ${(TYPES[n.type] || {}).label || n.type}${S.svc && S.svc.a === n.id ? ', service A end' : S.svc && S.svc.z === n.id ? ', service Z end' : ''}${n.p && n.p.fail === 'dead' ? ', failed' : n.p && n.p.fail === 'degraded' ? ', degraded' : ''}${panelDirty(n) ? ', dirty connector on port ' + Object.entries(n.p.dirty).filter(([, v]) => +v > 0.3).map(([k]) => k).join(', ') : ''}` });
  if (n.type === 'trx') {
    g.append(sv('rect', { x: -46, y: -22, width: 92, height: 44, rx: 4, class: 'body' }));
    g.append(sv('rect', { x: 30, y: -6, width: 10, height: 12, rx: 1, class: 'port' }));
    const t = sv('text', { x: -38, y: 4, class: 'glyph' }); t.textContent = PHY.MODES[n.p.mode].short; g.append(t);
    g.append(sv('circle', { cx: -36, cy: -12, r: 3, class: 'led' }));
  } else if (n.type === 'mxp') {
    g.append(sv('rect', { x: -46, y: -30, width: 92, height: 60, rx: 4, class: 'body' }));
    const nc = n.p.clients.length;
    n.p.clients.forEach((c, i) => { const y = nc > 1 ? -22 + i * (44 / (nc - 1)) : 0; g.append(sv('line', { x1: -56, y1: y, x2: -46, y2: y, class: 'thin' })); g.append(sv('circle', { cx: -56, cy: y, r: 2.2, class: 'led' })); });
    g.append(sv('rect', { x: 30, y: -6, width: 10, height: 12, rx: 1, class: 'port' }));
    const t = sv('text', { x: -38, y: -6, class: 'glyph' }); t.textContent = PHY.MODES[n.p.mode].short; g.append(t);
    const t2 = sv('text', { x: -38, y: 10, class: 'glyph small' }); t2.textContent = `${nc} client${nc === 1 ? '' : 's'}`; g.append(t2);
  } else if (n.type === 'mux') {
    g.append(sv('path', { d: 'M-30,-30 L30,-14 L30,14 L-30,30 Z', class: 'body' }));
    for (let i = -2; i <= 2; i++) g.append(sv('line', { x1: -30, y1: i * 10, x2: -14, y2: i * 4, class: 'thin' }));
    g.append(sv('line', { x1: 0, y1: 0, x2: 30, y2: 0, class: 'thin' }));
  } else if (n.type === 'panel') {
    g.append(sv('rect', { x: -40, y: -16, width: 80, height: 32, rx: 3, class: 'body' }));
    const t = sv('text', { x: -34, y: -4, class: 'glyph small' }); t.textContent = `ODF ${n.p.ports}`; g.append(t);
    const k = Math.min(12, n.p.ports); for (let i = 0; i < k; i++) g.append(sv('rect', { x: -34 + i * (68 / k), y: 3, width: Math.max(3, 68 / k - 2), height: 8, rx: 1, class: 'pport' + (n.p.dirty && n.p.dirty[i + 1] ? ' dirty' : '') }));
    if (panelDirty(n)) { const fg = sv('g', { class: 'faultg', transform: `translate(40,-16) scale(${floorScale(9, S.view.k * 8)})` }); fg.append(sv('circle', { cx: 0, cy: 0, r: 8, class: 'faultbadge' })); const b = sv('text', { x: 0, y: 3.5, class: 'faultmark', 'text-anchor': 'middle' }); b.textContent = '!'; fg.append(b); g.append(fg); } // a dirty connector you can see at any zoom
  } else if (n.type === 'splitter') {
    g.append(sv('rect', { x: -34, y: -20, width: 68, height: 40, rx: 4, class: 'body' }));
    g.append(sv('path', { d: 'M-28,0 L-6,0 M-6,0 L26,-10 M-6,0 L26,10', class: 'thin' }));
    const t = sv('text', { x: 0, y: -26, class: 'glyph small', 'text-anchor': 'middle' }); t.textContent = n.p.ratio; g.append(t);
    for (const [pt, y] of [['A', -10], ['B', 10]]) { const e = sv('text', { x: 31, y: y + 3, class: 'glyph small' }); e.textContent = pt; g.append(e); }
  } else if (n.type === 'switch') {
    g.append(sv('rect', { x: -34, y: -20, width: 68, height: 40, rx: 4, class: 'body' }));
    g.append(sv('path', { d: 'M-28,0 L-8,0', class: 'thin' }));
    const sel = n.p.pos === 'b' ? 10 : -10; g.append(sv('path', { d: `M-8,0 L22,${sel}`, class: 'thin' })); g.append(sv('circle', { cx: 24, cy: sel, r: 2.6, class: 'led' }));
    const t = sv('text', { x: -26, y: -9, class: 'glyph small' }); t.textContent = 'SW'; g.append(t);
    for (const [pt, y] of [['A', -10], ['B', 10]]) { const e = sv('text', { x: 29, y: y + 3, class: 'glyph small' }); e.textContent = pt; g.append(e); }
  } else if (n.type === 'meter') {
    const m = lastRes && lastRes.meters && lastRes.meters[n.id], txt = m ? (m.status === 'over' ? 'OVER' : m.status === 'low' ? 'LOW' : m.dbm != null ? f1(m.dbm) + ' dBm' : '—') : '—';
    g.append(sv('rect', { x: -34, y: -18, width: 68, height: 36, rx: 5, class: 'body' }));
    g.append(sv('rect', { x: -28, y: -12, width: 56, height: 16, rx: 2, class: m && m.status === 'over' ? 'pport dirty' : 'pport' }));
    const t = sv('text', { x: 0, y: 0, class: 'glyph small', 'text-anchor': 'middle' }); t.textContent = txt; g.append(t);
    const c = sv('text', { x: 0, y: 14, class: 'glyph small', 'text-anchor': 'middle' }); c.textContent = 'POWER METER'; g.append(c);
  } else if (n.type === 'otdr') {
    g.append(sv('rect', { x: -34, y: -18, width: 68, height: 36, rx: 5, class: 'body' }));
    g.append(sv('path', { d: 'M-28,-8 L-14,-8 L-14,-2 L2,-2 L2,3 L14,3 L14,-7 L16,-7 L16,5 L28,5', class: 'thin', fill: 'none' }));
    const c = sv('text', { x: 0, y: 14, class: 'glyph small', 'text-anchor': 'middle' }); c.textContent = 'OTDR ' + n.p.pulse + ' ns'; g.append(c);
  } else if (n.type === 'host') {
    g.append(sv('rect', { x: -38, y: -20, width: 76, height: 40, rx: 4, class: 'body' }));
    g.append(sv('line', { x1: -38, y1: -7, x2: 38, y2: -7, class: 'thin' }));
    const t = sv('text', { x: -30, y: -11, class: 'glyph small' }); t.textContent = 'HOST'; g.append(t);
    const ip = sv('text', { x: 0, y: 9, class: 'glyph small', 'text-anchor': 'middle' }); ip.textContent = (n.p.ip || '').split('/')[0] || 'no address'; g.append(ip);
    for (let k = 0; k < n.p.ports; k++) g.append(sv('circle', { cx: 30 - k * 9, cy: -14, r: 2.2, class: 'led' }));
  } else if (n.type === 'oadm') {
    g.append(sv('rect', { x: -34, y: -20, width: 68, height: 40, rx: 4, class: 'body' }));
    g.append(sv('line', { x1: -34, y1: 0, x2: 34, y2: 0, class: 'thin' }));
    g.append(sv('path', { d: 'M-8,0 L-8,-20 M8,0 L8,20', class: 'thin' }));
    const t = sv('text', { x: 0, y: -6, class: 'glyph small', 'text-anchor': 'middle' }); t.textContent = 'OADM'; g.append(t);
    for (const [sd, x] of [['w', -26], ['e', 26]]) if (n.p.sides.includes(sd)) { const e = sv('text', { x, y: 14, class: 'glyph small', 'text-anchor': 'middle' }); e.textContent = sd.toUpperCase(); g.append(e); }
    if (n.p.p1310 || n.p.osc) { g.append(sv('line', { x1: 0, y1: 20, x2: 0, y2: 30, class: 'thin' }), sv('circle', { cx: 0, cy: 32, r: 2.5, class: 'led' })); const e = sv('text', { x: 8, y: 36, class: 'glyph small' }); e.textContent = n.p.osc && n.p.p1310 ? 'OSC 1310' : n.p.osc ? 'OSC' : '1310'; g.append(e); }
  } else if (n.type === 'edfa') {
    g.append(sv('path', { d: 'M-26,-26 L30,0 L-26,26 Z', class: 'body' }));
    const t = sv('text', { x: -18, y: 4, class: 'glyph small' }); t.textContent = 'EDFA'; g.append(t);
  } else if (n.type === 'roadm') {
    g.append(sv('circle', { r: 32, class: 'body' }));
    g.append(sv('path', { d: 'M-18,-8 L18,-8 M12,-14 L18,-8 L12,-2 M18,8 L-18,8 M-12,2 L-18,8 L-12,14', class: 'thin' }));
  } else if (n.type === 'dcm') {
    g.append(sv('rect', { x: -26, y: -18, width: 52, height: 36, rx: 3, class: 'body' }));
    g.append(sv('path', { d: 'M-16,8 C-8,8 -8,-8 0,-8 S8,8 16,8', class: 'thin' }));
  } else if (n.type === 'voa') {
    g.append(sv('rect', { x: -26, y: -18, width: 52, height: 36, rx: 3, class: 'body' }));
    g.append(sv('path', { d: 'M-16,12 L16,-12 M8,-12 L16,-12 L16,-4', class: 'thin' }));
  }
  if ((n.type === 'mux' || n.type === 'oadm') && n.p.bidi) { const t = sv('text', { x: 0, y: n.type === 'mux' ? -36 : -28, class: 'endtag', 'text-anchor': 'middle' }); t.textContent = 'BiDi'; g.append(t); }
  const lab = sv('text', { x: 0, y: n.type === 'roadm' ? 50 : 44, class: 'nlabel', 'text-anchor': 'middle' }); lab.textContent = n.name; g.append(lab);
  if (isEnd(n) && (S.svc.a === n.id || S.svc.z === n.id)) {
    const b = sv('text', { x: 0, y: n.type === 'mxp' ? -38 : -30, class: 'endtag', 'text-anchor': 'middle' }); b.textContent = S.svc.a === n.id ? 'A end' : 'Z end'; g.append(b);
  }
  if (n.p && n.p.fail === 'dead') { const x = sv('text', { x: 0, y: 9, class: 'failmark', 'text-anchor': 'middle' }); x.textContent = '✕'; g.append(x); }
  else if (n.p && n.p.fail === 'degraded') { const x = sv('text', { x: 0, y: -26, class: 'degmark', 'text-anchor': 'middle' }); x.textContent = '▼'; g.append(x); }
  return g;
}
let lastRes = null;
let hiChan = null; // plan entry whose route is highlighted on the canvas
let planEdit = null; // plan entry whose controls are open in the Channels table
let dir = 'fwd'; // which direction the results panel shows: forward (A to Z) or return (Z to A)
const view = () => (dir === 'rev' && lastRes && lastRes.rev && lastRes.rev.mode ? lastRes.rev : lastRes);
function renderCanvas() {
  gRoot.innerHTML = '';
  const vr = view(), onPath = new Set(vr && vr.path ? vr.path.links : []);
  const lg = sv('g'), ng = sv('g'), og = sv('g');
  const hplan = vr && vr.derived ? vr.derived.plan : S.g.plan, hc = hiChan && hplan && vr && vr.channels ? vr.channels[hplan.indexOf(hiChan)] : null, hiLinks = new Set(hc ? hc.routeLinks : []), hiNodes = new Set(hc ? hc.routeNodes : []), sb = hc && hc.protection ? (hc.protection.active === 'work' ? hc.protection.protect : hc.protection.work) : null, stbyLinks = new Set(sb ? sb.routeLinks : []);
  const pairs = new Map(); for (const l of S.links) { const k = [l.a, l.b].sort().join('|'); if (!pairs.has(k)) pairs.set(k, []); pairs.get(k).push(l); }
  for (const l of S.links) {
    const a0 = node(l.a), b0 = node(l.b); if (!a0 || !b0) continue;
    // cables between the same two devices are drawn side by side instead of on top of each other
    const grp = pairs.get([l.a, l.b].sort().join('|')), dxn = b0.x - a0.x, dyn = b0.y - a0.y, dn = Math.hypot(dxn, dyn) || 1, off = (grp.indexOf(l) - (grp.length - 1) / 2) * 16;
    const a = { ...a0, x: a0.x - dyn / dn * off, y: a0.y + dxn / dn * off }, b = { ...b0, x: b0.x - dyn / dn * off, y: b0.y + dxn / dn * off };
    const cutNow = MODEL.isCut(S, l);
    const g = sv('g', { class: 'link k-' + l.kind + (cutNow ? ' cut' : '') + (sel && sel.id === l.id ? ' sel' : ''), 'data-id': l.id, tabindex: 0, role: 'button', 'aria-pressed': sel && sel.id === l.id ? 'true' : 'false',
      'aria-label': `${l.kind === 'fiber' ? `Fiber span, ${l.p.len} km` : 'Patch cord'}: ${a0.name} to ${b0.name}${cutNow ? ', cut' : ''}` });
    g.append(sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'hit' }));
    g.append(sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'wire' }));
    if (vr && vr.restored && vr.restored.links.includes(l.id)) og.append(sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'ghost' })); // the route the service had before the cut
    if (hiLinks.has(l.id)) og.append(sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'chroute' }));
    else if (stbyLinks.has(l.id)) og.append(sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'chroute stby' }));
    if (onPath.has(l.id)) {
      const ri = vr.path.links.indexOf(l.id), from = node(vr.path.nodes[ri]);
      const rev = from.id !== a.id;
      og.append(sv('line', { x1: rev ? b.x : a.x, y1: rev ? b.y : a.y, x2: rev ? a.x : b.x, y2: rev ? a.y : b.y, class: 'lightpath ' + (vr.status || '') }));
    }
    if (l.kind === 'fiber' || cutNow) {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const fb = PHY.FIBERS[l.p.fiber];
      const t = sv('text', { x: mx, y: my - 10, class: 'llabel', 'text-anchor': 'middle' });
      const arrow = l.p.dir === 'ab' || l.p.dir === 'ba' ? (() => { const dx = b.x - a.x, dy = b.y - a.y, f = l.p.dir === 'ab' ? 1 : -1; return ' ' + (Math.abs(dx) >= Math.abs(dy) ? (dx * f > 0 ? '→' : '←') : (dy * f > 0 ? '↓' : '↑')); })() : '';
      t.textContent = (l.kind === 'fiber' ? `${l.p.len} km · ${f1(fb.att * l.p.len + +l.p.extra)} dB` + (+l.p.raman > 0 ? ` · Raman ${l.p.raman} mW` : '') + (l.p.srlg ? ` · ${l.p.srlg}` : '') + (l.p.single ? ' · single fiber' : '') : 'patch') + arrow;
      g.append(t);
      if (cutNow) { const x = sv('text', { x: mx, y: my + 7, class: 'cutmark', 'text-anchor': 'middle' }); x.textContent = '✕'; g.append(x); }
    }
    { const pl = portLink(l), labelAt = (m, o, text) => { // a small label on the cable, next to the device end
        const dx = o.x - m.x, dy = o.y - m.y, d = Math.hypot(dx, dy) || 1, t = sv('text', { x: m.x + dx / d * 52, y: m.y + dy / d * 52 - 5, class: 'llabel', 'text-anchor': 'middle' }); t.textContent = text; g.append(t); };
      if (pl && l.p.mport != null) { const sd = sideOf(l, pl.m); labelAt(pl.m, pl.t, pl.m.type === 'roadm' ? `${sd ? 'D' + sd + '·' : ''}P${l.p.mport + 1}` : `${sd ? sd.toUpperCase() : 'P'}${l.p.mport + 1} · ${sideRange(pl.m, sd)[0] + l.p.mport + 1}`); }
      for (const n of [a, b]) if ((isTri(n) || n.type === 'panel') && sideOf2(l, n)) labelAt(n, n === a ? b : a, sideOf2(l, n).toUpperCase());
      if (clientLink(l)) { const h = a.type === 'host' ? a : b, e = h === a ? b : a; labelAt(h, e, `eth${(l.p.hport ?? 0) + 1}`); if (e.type === 'mxp') labelAt(e, h, `C${(l.p.cport ?? 0) + 1}`); }
      for (const n of [a, b]) if ((n.type === 'oadm' || n.type === 'roadm') && !(pl && pl.m.id === n.id) && sideOf(l, n)) labelAt(n, n === a ? b : a, n.type === 'roadm' ? 'D' + sideOf(l, n) : SIDE[sideOf(l, n)]); }
    lg.append(g);
  }
  for (const n of S.nodes) { const sh = nodeShape(n); if (hiNodes.has(n.id)) sh.classList.add('chnode'); ng.append(sh); }
  gRoot.append(lg, og, ng);
  const rb = sv('line', { id: 'rubber', class: 'rubber', x1: 0, y1: 0, x2: 0, y2: 0, visibility: 'hidden' });
  gRoot.append(rb);
  applyView();
  $('#emptyhint').hidden = S.nodes.length > 0;
}

// pointer interactions
let drag = null;
// Two-finger pinch: zoom about the midpoint and pan with it. Cancels any one-finger drag in progress.
const ptrs = new Map();
let pinch = null;
const pinchGeom = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; };
svg.addEventListener('pointerdown', e => {
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 2) {
    drag = null; $('#rubber').setAttribute('visibility', 'hidden');
    const g = pinchGeom(); pinch = { d: g.d, k: S.view.k, w: toWorld(g.mx, g.my) };
    svg.setPointerCapture(e.pointerId); return;
  }
  if (ptrs.size > 2) return;
  const nEl = e.target.closest('.node'), lEl = e.target.closest('.link');
  const w = toWorld(e.clientX, e.clientY);
  if (nEl) {
    const n = node(nEl.dataset.id);
    if (tool === 'patch' || tool === 'fiber') { drag = { kind: 'cable', from: n, moved: false }; const rb = $('#rubber'); rb.setAttribute('x1', n.x); rb.setAttribute('y1', n.y); rb.setAttribute('x2', w.x); rb.setAttribute('y2', w.y); rb.setAttribute('visibility', 'visible'); rb.setAttribute('class', 'rubber ' + tool); }
    else { drag = { kind: 'node', n, dx: w.x - n.x, dy: w.y - n.y, moved: false }; select({ kind: 'node', id: n.id }); }
  } else if (lEl) { select({ kind: 'link', id: lEl.dataset.id }); drag = null; }
  else { drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y, moved: false }; }
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove', e => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size === 2) {
    const g = pinchGeom(), r = svg.getBoundingClientRect(), k = Math.min(2.5, Math.max(0.15, pinch.k * g.d / pinch.d));
    S.view = { k, x: pinch.w.x - (g.mx - r.left) / k, y: pinch.w.y - (g.my - r.top) / k }; applyView(); return;
  }
  if (!drag) return;
  const w = toWorld(e.clientX, e.clientY);
  drag.moved = true;
  if (drag.kind === 'node') { drag.n.x = Math.round((w.x - drag.dx) / 10) * 10; drag.n.y = Math.round((w.y - drag.dy) / 10) * 10; renderCanvas(); }
  else if (drag.kind === 'pan') { S.view.x = drag.vx - (e.clientX - drag.sx) / S.view.k; S.view.y = drag.vy - (e.clientY - drag.sy) / S.view.k; applyView(); }
  else if (drag.kind === 'cable') { const rb = $('#rubber'); rb.setAttribute('x2', w.x); rb.setAttribute('y2', w.y); }
});
const endPointer = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; };
// A drag that is cancelled (the browser takes the gesture to scroll), loses its capture, or is interrupted by switching windows ends cleanly: the node stays
// where it was dropped and the change is saved (so it can be undone), and the next tap or drag works without a reload.
function abortDrag(e) { if (e) endPointer(e); else { ptrs.clear(); pinch = null; } const d = drag; drag = null; $('#rubber').setAttribute('visibility', 'hidden'); if (d && d.kind === 'node' && d.moved) save(); }
svg.addEventListener('pointercancel', abortDrag);
svg.addEventListener('lostpointercapture', e => { if (drag) abortDrag(e); });
window.addEventListener('blur', () => abortDrag(null));
svg.addEventListener('pointerup', e => {
  const wasPinch = !!pinch; endPointer(e);
  if (wasPinch) { drag = null; return; }
  if (!drag) return;
  const d = drag; drag = null;
  if (d.kind === 'cable') {
    $('#rubber').setAttribute('visibility', 'hidden');
    const t = document.elementFromPoint(e.clientX, e.clientY), nEl = t && t.closest && t.closest('.node');
    if (nEl && nEl.dataset.id !== d.from.id) { pendingCable = null; connect(d.from, node(nEl.dataset.id), tool); }
    else if (!d.moved || !nEl) { if (!pendingCable) { pendingCable = d.from; toast(`Now click the second device to connect ${d.from.name}`); } else { const a = pendingCable; pendingCable = null; if (a.id !== d.from.id) connect(a, d.from, tool); } }
  } else if (d.kind === 'pan' && !d.moved) select(null);
  else if (d.kind === 'node' && d.moved) { save(); }
});
let pendingCable = null;
// Enter or Space on a focused device or cable selects it, like a click does; the canvas is rebuilt on every change, so focus goes back to the same item
svg.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const t = e.target.closest && e.target.closest('.node, .link'); if (!t) return;
  e.preventDefault();
  const id = t.dataset.id, kind = t.classList.contains('node') ? 'node' : 'link';
  if (tool !== 'select') { if (kind === 'node') { const n = node(id); if (!pendingCable) { pendingCable = n; toast(`Now choose the second device to connect ${n.name}`); } else { const a = pendingCable; pendingCable = null; if (a.id !== n.id) connect(a, n, tool); } } return; }
  select({ kind, id });
  const again = svg.querySelector(`[data-id="${id}"]`); if (again) again.focus();
});
svg.addEventListener('wheel', e => {
  e.preventDefault();
  const w = toWorld(e.clientX, e.clientY), k = Math.min(2.5, Math.max(0.15, S.view.k * Math.exp(-e.deltaY * 0.0015)));
  const r = svg.getBoundingClientRect();
  S.view = { k, x: w.x - (e.clientX - r.left) / k, y: w.y - (e.clientY - r.top) / k }; applyView();
}, { passive: false });
svg.addEventListener('dblclick', e => { const nEl = e.target.closest('.node'); if (nEl && isEnd(node(nEl.dataset.id))) setEnd(nEl.dataset.id); });

// a transponder or muxponder plugged into a passive mux: the cable's `mport` is the mux port it uses (port k passes slot first+k)
const clientLink = l => { const a = node(l.a), b = node(l.b); return !!a && !!b && l.kind === 'patch' && ((isEnd(a) && b.type === 'host') || (isEnd(b) && a.type === 'host')); }; // host port to transponder or muxponder client port
const clientCount = e => (e.type === 'mxp' ? e.p.clients.length : 1);
const fmtUs = us => (us < 1000 ? `${us.toFixed(0)} µs` : `${(us / 1000).toFixed(2)} ms`);
const panelSide = (n, except) => { // the next free side of a patch panel port: the other side of a half-used port first, else the rear of a new one
  const u = new Set(S.links.filter(x => x !== except && (x.a === n.id || x.b === n.id)).map(x => sideOf2(x, n)));
  for (let k = 1; k <= n.p.ports; k++) { if (u.has('r' + k) && !u.has('f' + k)) return 'f' + k; if (u.has('f' + k) && !u.has('r' + k)) return 'r' + k; }
  for (let k = 1; k <= n.p.ports; k++) if (!u.has('r' + k) && !u.has('f' + k)) return 'r' + k;
  return '';
};
const isTri = n => !!n && (n.type === 'splitter' || n.type === 'switch'); // a common port c and two ports a and b
const TRI_NAME = { c: 'Common', a: 'Port A', b: 'Port B' };
const isDev = n => !!n && (n.type === 'mux' || n.type === 'oadm' || n.type === 'roadm');
const portLink = l => { const a = node(l.a), b = node(l.b); if (!a || !b || l.kind !== 'patch') return null; return isEnd(a) && isDev(b) ? { t: a, m: b } : isEnd(b) && isDev(a) ? { t: b, m: a } : null; };
const SIDE = { e: 'East', w: 'West' };
const sideOf = (l, n) => (n.type === 'oadm' || n.type === 'roadm' ? (l.a === n.id ? l.p.sa : l.p.sb) || '' : ''); // the east/west side of an OADM, or the degree of a ROADM, that a cable end uses
const sideOf2 = (l, n) => (l.a === n.id ? l.p.sa : l.p.sb) || '';
const sideLabel = (m, s) => (m.type === 'oadm' ? SIDE[s] : s ? `Degree ${s}` : '');
const lineSides = n => (n.type === 'oadm' ? n.p.sides.split('') : Array.from({ length: n.p.degrees }, (_, k) => String(k + 1))); // the line sides (degrees) a cable can use
const colorless = m => m.type === 'roadm' && m.p.colorless;
const setSide = (l, n, s) => { if (l.a === n.id) l.p.sa = s; else l.p.sb = s; };
const deviceSides = m => (m.type === 'oadm' ? m.p.sides.split('') : m.type === 'roadm' && !m.p.directionless ? lineSides(m) : ['']); // the sides whose ports a transponder can use
const defSide = (m, other) => { const ss = deviceSides(m); return ss.length === 1 ? ss[0] : other.x < m.x ? 'w' : 'e'; };
const sideRange = (m, s) => { if (m.type === 'oadm') return MODEL.oadmRange(m, s); const f = Math.round(+m.p.first) || 0; return [f, f + (Math.round(+m.p.ports) || 0)]; };
const portsUsed = (m, except) => new Map(S.links.filter(l => l !== except && l.p.mport != null && portLink(l) && portLink(l).m === m).map(l => [sideOf(l, m) + '|' + l.p.mport, portLink(l).t]));
const portCount = (m, side) => (m.type === 'oadm' ? Math.round(+m.p[side + 'Ports']) || 0 : Math.round(+m.p.ports) || 0); // ports on a side: a BiDi side serves two bands but each port is one pair
const firstFreePort = (m, except, side) => { const u = portsUsed(m, except); for (let k = 0; k < portCount(m, side); k++) if (!u.has(side + '|' + k)) return k; return null; };
const portSlots = (m, k, side) => { // the transmit and receive slot of a BiDi (single-fiber) port: a low and a high band, the role says which way round
  if (m.type === 'roadm' || !m.p.bidi) return null; const first = sideRange(m, side)[0], n = portCount(m, side), role = m.type === 'oadm' ? m.p[side + 'Role'] : m.p.role, lo = first + k, hi = first + n + k;
  return role === 'low' ? { tx: lo, rx: hi } : { tx: hi, rx: lo };
};
const portSlotText = (m, k, side) => { const b = portSlots(m, k, side), lab = side ? sideLabel(m, side) + ' port' : 'Port'; if (b) return `${lab} ${k + 1} · transmit slot ${b.tx + 1} · receive slot ${b.rx + 1}`; return `${lab} ${k + 1}` + (colorless(m) ? ' · any slot' : ` · slot ${sideRange(m, side)[0] + k + 1} · ${PHY.slotFreqTHz(sideRange(m, side)[0] + k, +S.g.df * 1e9).toFixed(2)} THz`); };
// a slot number box that shows slots from 1 (the model counts from 0)
function slotBox(obj, key, id) { const i = el('input', { type: 'number', step: 1, min: 1, max: 64, value: (Math.round(+obj[key]) || 0) + 1, id }); i.addEventListener('input', () => { if (i.value !== '' && isFinite(+i.value)) { obj[key] = Math.min(63, Math.max(0, Math.round(+i.value) - 1)); recompute(); } }); return i; }
function connect(a, b, kind) {
  if (S.links.some(l => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id))) return toast('Those two are already connected.');
  const inst = x => x.type === 'meter' || x.type === 'otdr', test = x => x.type === 'panel' || x.type === 'splitter' || x.type === 'switch';
  if ((inst(a) || inst(b)) && !((inst(a) && test(b)) || (inst(b) && test(a)))) return toast('An instrument plugs into a test point: a patch panel port, or a splitter or switch port.');
  const cli = (isEnd(a) && b.type === 'host') || (isEnd(b) && a.type === 'host');
  if (!cli && (a.type === 'host' || b.type === 'host')) return toast('A host connects to a transponder or muxponder client port, nothing else.');
  let hp = null, cp = null;
  if (cli) {
    const h = a.type === 'host' ? a : b, e = a.type === 'host' ? b : a, mine = S.links.filter(clientLink);
    const usedH = new Set(mine.filter(x => x.a === h.id || x.b === h.id).map(x => x.p.hport)), usedC = new Set(mine.filter(x => x.a === e.id || x.b === e.id).map(x => x.p.cport));
    for (let k = 0; k < h.p.ports && hp == null; k++) if (!usedH.has(k)) hp = k;
    for (let k = 0; k < clientCount(e) && cp == null; k++) if (!usedC.has(k)) cp = k;
    if (hp == null) return toast(`${h.name} has no free port (it has ${h.p.ports}). Raise the port count in its inspector.`);
    if (cp == null) return toast(`${e.name} has no free client port.`);
  }
  else for (const n of [a, b]) if (S.links.filter(x => !clientLink(x) && (x.a === n.id || x.b === n.id)).length >= (n.type === 'panel' ? 2 * n.p.ports : TYPES[n.type].maxLinks)) return toast(`${n.name} has no free port. ${TYPES[n.type].label}s have ${isEnd(n) ? 'two line ports: the second is for dual-homing' : TYPES[n.type].maxLinks === 1 ? 'one line port' : 'an input and an output'}.`);
  for (const [n, o] of [[a, b], [b, a]]) if (n.type === 'roadm' && !isEnd(o) && S.links.filter(x => !portLink(x) && (x.a === n.id || x.b === n.id)).length >= n.p.degrees) return toast(`${n.name} has no free degree (it has ${n.p.degrees}). Raise the degree count in its inspector.`);
  const l = { id: uid('l'), a: a.id, b: b.id, kind, p: linkDefaults(kind) };
  if (cli) { l.p.hport = hp; l.p.cport = cp; }
  S.links.push(l);
  for (const n of [a, b]) {
    const o = n === a ? b : a;
    if (n.type === 'oadm') setSide(l, n, defSide(n, o)); // west is the neighbour on the left
    else if (n.type === 'panel') setSide(l, n, panelSide(n, l));
    else if (isTri(n)) { const used = new Set(S.links.filter(x => x !== l && (x.a === n.id || x.b === n.id)).map(x => sideOf2(x, n))); setSide(l, n, ['c', 'a', 'b'].find(k => !used.has(k)) || ''); } // the first free port
    else if (n.type === 'roadm' && !isEnd(o)) { const used = new Set(S.links.filter(x => x !== l && !portLink(x) && (x.a === n.id || x.b === n.id)).map(x => sideOf(x, n))); setSide(l, n, lineSides(n).find(d => !used.has(d)) || ''); } // the first free degree
    else if (n.type === 'roadm') setSide(l, n, n.p.directionless ? '' : lineSides(n)[0]);
  }
  const plug = (o, m) => { // a transponder cable takes the first free port on its side of the device, or the other side if that one is full
    if (m.type === 'mux' || (m.type === 'roadm' && m.p.directionless)) { o.p.mport = firstFreePort(m, o, ''); if (m.type === 'roadm') setSide(o, m, ''); return; }
    const pref = sideOf(o, m) || (m.type === 'roadm' ? deviceSides(m)[0] : defSide(m, portLink(o).t));
    for (const s of [pref, ...deviceSides(m).filter(x => x !== pref)]) { const k = firstFreePort(m, o, s); if (k != null) { setSide(o, m, s); o.p.mport = k; return; } }
  };
  if (portLink(l)) { // plugging a transponder into a mux or OADM takes a free port; cables already on that device get one too so every channel follows its port
    const m = portLink(l).m; plug(l, m); for (const o of S.links) if (o !== l && portLink(o) && portLink(o).m === m && o.p.mport == null) plug(o, m);
    if (l.p.mport == null) toast(`${m.name} has no free port.`);
  }
  select({ kind: 'link', id: l.id }); toast(`${kind === 'fiber' ? 'Fiber span' : 'Patch cord'}: ${a.name} ↔ ${b.name}`);
}
// A new device goes in the first free place near the middle of what you are looking at (not on top of another device), then outwards in a spiral
function freeSpot() {
  const r = svg.getBoundingClientRect(), c = toWorld(r.left + r.width / 2, r.top + r.height / 2), sx = 150, sy = 110;
  const free = (x, y) => S.nodes.every(n => Math.abs(n.x - x) >= 120 || Math.abs(n.y - y) >= 90);
  for (let ring = 0; ring < 12; ring++) for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
    const x = Math.round((c.x + dx * sx) / 10) * 10, y = Math.round((c.y + dy * sy) / 10) * 10;
    if (free(x, y)) return { x, y };
  }
  return c;
}
function addNode(type, x, y) {
  const count = S.nodes.filter(n => n.type === type).length + 1;
  let name = `${PREFIX[type]}-${count}`; while (S.nodes.some(n => n.name === name)) name += "'";
  const n = { id: uid('n'), type, name, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, p: TYPES[type].def() };
  S.nodes.push(n);
  if (type === 'trx' || type === 'mxp') { if (!node(S.svc.a)) S.svc.a = n.id; else if (!node(S.svc.z)) S.svc.z = n.id; }
  select({ kind: 'node', id: n.id });
}
function del() {
  if (!sel) return;
  const node0 = sel.kind === 'node' ? node(sel.id) : null;
  if (sel.kind === 'node') { S.nodes = S.nodes.filter(n => n.id !== sel.id); S.links = S.links.filter(l => l.a !== sel.id && l.b !== sel.id); }
  else S.links = S.links.filter(l => l.id !== sel.id);
  const what = sel.kind === 'node' ? (node0 ? node0.name : 'device') : 'cable'; sel = null; checkpoint(); renderAll(); toast('Deleted ' + what, { label: 'Undo', fn: undo });
}
function setEnd(id) {
  if (S.svc.a === id || S.svc.z === id) { [S.svc.a, S.svc.z] = [S.svc.z, S.svc.a]; }
  else { S.svc.z = S.svc.a; S.svc.a = id; }
  renderAll();
}

// palette
document.querySelectorAll('.pal-item').forEach(it => {
  it.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', it.dataset.type); e.dataTransfer.effectAllowed = 'copy'; });
  it.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); it.click(); } });
  it.addEventListener('click', () => { const w = freeSpot(); addNode(it.dataset.type, w.x, w.y); });
});
svg.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
svg.addEventListener('drop', e => { e.preventDefault(); const t = e.dataTransfer.getData('text/plain'); if (TYPES[t]) { const w = toWorld(e.clientX, e.clientY); addNode(t, w.x, w.y); } });
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
function setTool(t) { tool = t; pendingCable = null; document.querySelectorAll('.tool').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t)); svg.dataset.tool = t; }
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#toast').hidden) $('#toast').hidden = true; // a toast can be dismissed, so it never stays over what you are reading
  if (e.target.closest('input,select,textarea')) return; // a field keeps its own undo
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) { e.preventDefault(); (e.key === 'y' || e.shiftKey ? redo : undo)(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { del(); e.preventDefault(); }
  else if (e.key === 'v' || e.key === 'Escape') setTool('select');
  else if (e.key === 'p') setTool('patch');
  else if (e.key === 'f') setTool('fiber');
});

// ---------- inspector ----------
function select(s) { sel = s; renderAll(); }
function field(label, input, hint) { return el('label', { class: 'fld' }, [el('span', { text: label }), input, hint ? el('small', { text: hint }) : null]); }
function numIn(obj, key, step = 0.5, min, max, allowBlank, placeholder) {
  const i = el('input', { type: 'number', step, value: obj[key], id: 'f-' + key }); if (min != null) i.min = min; if (max != null) i.max = max; if (placeholder) i.placeholder = placeholder;
  i.addEventListener('input', () => { if (i.value === '' && allowBlank) obj[key] = ''; else if (i.value !== '' && isFinite(+i.value)) obj[key] = +i.value; else return; recompute(); });
  return i;
}
function selIn(obj, key, opts) {
  const s = el('select', { id: 'f-' + key }); for (const [v, t] of opts) s.append(el('option', { value: v, text: t }));
  s.value = String(obj[key]); s.addEventListener('change', () => { obj[key] = s.value === 'true' ? true : s.value === 'false' ? false : s.value; renderAll(); }); return s;
}
let assumeOpen, inspKey, kpiAll = false, ramanOpen;
const narrow = window.matchMedia('(max-width: 900px)');
// a new selection opens at the top (type, name, actions); an edit to the same selection keeps the scroll position
function renderInspector() {
  const box = $('#insp'), top = box.scrollTop, key = sel ? sel.kind + ':' + sel.id : '';
  if (key !== inspKey) ramanOpen = undefined;
  renderInspectorBody(); box.scrollTop = key === inspKey ? top : 0; inspKey = key;
}
function renderInspectorBody() {
  const box = $('#insp'); box.innerHTML = '';
  if (!sel) {
    box.append(el('h2', { text: 'Inspector' }), el('p', { class: 'muted', html: 'Select a device or a cable to edit it. Try cutting a fiber: select a span, then choose <b>Cut this fiber</b>. <b>Double-click</b> a transponder to make it an end of the service under test.' }));
    S.g.eolSpan ??= PHY.EOL.spanLoss; S.g.eolTrx ??= PHY.EOL.trxPen;
    S.g.neighbors ??= 'same';
    S.g.reopt = S.g.reopt === true;
    // the model-wide settings are there to look up, not to read first: collapsed on a phone, where they would push everything else a screen down
    const det = el('details', { class: 'assume' }, [el('summary', { text: 'Model assumptions' })]); det.open = assumeOpen ?? false; det.addEventListener('toggle', () => { assumeOpen = det.open; });
    det.append(el('h3', { text: 'Line loading' }), field('Launch power', selIn(S.g, 'reopt', [['false', 'Fixed: amplifier targets and the global launch'], ['true', 'Re-optimised for the load on each span']]), 'Re-optimised: every amplifier whose output target is blank sets the GN-optimal power for the span after it, given the channels actually lit there, so the setting follows channels as they are added and dropped. Amplifiers with an explicit target keep it.'), field('Neighbouring channels', selIn(S.g, 'neighbors', [['same', 'Same type as the service'], ['coh', '60 GBd coherent channels']]), 'Only matters for direct-detection optics (10G DWDM): cross-phase modulation from neighbours is stronger when they are wide coherent channels.'));
    det.append(el('h3', { text: 'End-of-life allowances' }), field('Extra loss per fiber span (dB)', numIn(S.g, 'eolSpan', 0.1, 0, 5)), field('Transceiver ageing (dB)', numIn(S.g, 'eolTrx', 0.1, 0, 3)),
      el('p', { class: 'muted small', text: 'Used for the end-of-life margin: repairs, connector wear and laser ageing. Typical planning values are 0.5 to 1.5 dB per span.' }));
    S.g.lossPct ??= PHY.TRANSIENT.lossPct; S.g.agcUs ??= PHY.TRANSIENT.agcUs; S.g.rampMs ??= 0;
    det.append(el('h3', { text: 'Transients' }), field('Channels lost at once (%)', numIn(S.g, 'lossPct', 5, 1, 95), 'The event the Transients tab analyses: this share of the channels vanishes at every amplifier together (an upstream cut, a protection switch). The service survives.'), field('Channel add ramp (ms)', numIn(S.g, 'rampMs', 0.5, 0, 10000), 'How slowly returning channels are brought up. 0 = all at once. A ramp longer than the amplifiers\' ~200 µs time constant lets their control loops follow, so the dip shrinks; the surge when channels vanish cannot be ramped.'), field('Amplifier control response (µs)', numIn(S.g, 'agcUs', 5, 0, 5000), 'How fast an amplifier\'s gain control reacts. About 10 to 50 µs is a fast AGC loop; milliseconds is slow and lets the surge through. A single amplifier can override it.'));
    S.g.cutRate ??= MODEL.RESIL.cutRate; for (const k in MODEL.RESIL) S.g[k] ??= MODEL.RESIL[k];
    det.append(el('h3', { text: 'Resilience assumptions' }), field('Fiber cuts per 1000 km per year', numIn(S.g, 'cutRate', 0.5, 0, 50)), field('Mean time to repair (h)', numIn(S.g, 'mttr', 1, 0.5, 720)),
      field('Loss detection (ms)', numIn(S.g, 'detectMs', 1, 0, 1000)), field('1+1 switch time (ms)', numIn(S.g, 'switchMs', 5, 0, 10000)), field('Shared protection turn-up (s)', numIn(S.g, 'sharedSec', 0.5, 0, 600), 'Extra time to light a dark protection route: laser turn-up, WSS configuration and amplifier settling.'), field('Restoration time (s)', numIn(S.g, 'restoreSec', 5, 0, 3600), 'How long an unprotected channel takes to re-route over another path.'), field('Device failures per year', numIn(S.g, 'devRate', 0.01, 0, 5), 'Per amplifier or ROADM on a route. A failed ROADM at the end of a channel keeps it down until repaired; one in the middle is bypassed by protection or restoration if another route avoids it.'),
      el('p', { class: 'muted small', text: 'Expectations for the Resilience tab. Typical terrestrial fiber sees 2 to 4 cuts per 1000 km per year.' }));
    box.append(det);
    box.append(el('div', { class: 'keys' }, [el('div', { html: '<kbd>V</kbd> select / move' }), el('div', { html: '<kbd>P</kbd> patch cord' }), el('div', { html: '<kbd>F</kbd> fiber span' }), el('div', { html: '<kbd>Del</kbd> delete' }), el('div', { html: '<kbd>Ctrl</kbd>+<kbd>Z</kbd> undo, <kbd>Shift</kbd> to redo' }), el('div', { html: 'Drag empty space to pan, scroll to zoom' })]));
    return;
  }
  if (sel.kind === 'node') {
    const n = node(sel.id); if (!n) return;
    const nm = el('input', { value: n.name, id: 'f-name' }); nm.addEventListener('input', () => { n.name = nm.value; renderCanvas(); renderResults(); });
    const p = n.p; p.fail ??= ''; p.degDb ??= 3;
    const head = el('div', { class: 'insp-head' }, [el('h2', { text: TYPES[n.type].label }), field('Name', nm)]); box.append(head); // type, name, condition and delete stay at the top while the fields scroll
    head.append(field('Condition', selIn(p, 'fail', [['', 'Working'], ['degraded', 'Degraded'], ['dead', 'Failed (no light passes)']])));
    // say what the chosen condition means (and for this kind of device), not all of them at once
    const condText = p.fail === 'dead' ? 'Failed: the device passes no light, so routes avoid it (restoration or protection) and a service through it is LOS.'
      : p.fail === 'degraded' ? `Degraded: ${n.type === 'edfa' ? 'its output falls and its noise figure rises (pump ageing)' : isEnd(n) ? 'its laser gets weaker and its receiver loses SNR' : 'it adds extra loss'}.` : '';
    if (condText) box.append(el('p', { class: 'muted small', text: condText }));
    if (p.fail === 'degraded') box.append(field('Degradation (dB)', numIn(p, 'degDb', 0.5, 0, 30)));
    if (n.type === 'roadm' || n.type === 'mux' || n.type === 'oadm') {
      const list = (key, max, hint, label) => {
        p[key] ??= [];
        const i = el('input', { value: p[key].map(x => x + 1).join(', '), id: 'f-' + key, placeholder: 'none' });
        i.addEventListener('input', () => { p[key] = [...new Set(i.value.split(/[\s,;]+/).map(Number).filter(x => Number.isInteger(x) && x >= 1 && x <= max).map(x => x - 1))].sort((a, b) => a - b); recompute(); });
        return field(label, i, hint);
      };
      if (n.type === 'oadm') {
        box.append(field('Single fiber (BiDi)', selIn(p, 'bidi', [['false', 'No: a pair of fibers, the same slot both ways'], ['true', 'Yes: one fiber, a different slot each way']]), 'Each port passes a pair of slots, one for each direction; a side serves a low and a high band, each as wide as its channel count.'));
        box.append(field('Line sides', selIn(p, 'sides', [['ew', 'East and West (a node in the line)'], ['e', 'East only (line terminal)'], ['w', 'West only (line terminal)']]), 'East and West: a line port each way; channels it does not serve pass straight through. One side: the line ends here, like a mux with add/drop ports.'));
        for (const sd of p.sides.split('')) box.append(field(`${SIDE[sd]} channels`, numIn(p, sd + 'Ports', 1, 0, 64), `How many channels the ${SIDE[sd].toLowerCase()} filter adds and drops: its ports.`), ...(p.bidi ? [field(`${SIDE[sd]} band this side transmits`, selIn(p, sd + 'Role', [['low', 'Low band'], ['high', 'High band']]), 'The neighbour on this side has to transmit the other band.')] : []), field(`${SIDE[sd]} first slot`, slotBox(p, sd + 'First', 'f-' + sd + 'First'), `The slot (numbered as in the Channels tab) of ${SIDE[sd].toLowerCase()} port 1; port k passes the slot k − 1 further on.`));
        box.append(field('Supervisory channel (1510 nm)', selIn(p, 'osc', [['false', 'No'], ['true', 'Yes: an OSC filter on the line']]), 'An optical supervisory channel at 1510 nm, outside the C band. Every amplifier and ROADM on the line regenerates it, so it reaches from site to site span by span; passive muxes, splitters and switches block it. The filter costs 0.6 dB on the line path. See the Reachability tab for each span.'));
        if (p.p1310) box.append(field('1310 nm client', selIn(p, 'o1310', Object.entries(PHY.CLIENT_OPTICS).filter(([, o]) => o.nm === 1310).map(([k, o]) => [k, o.name])), 'The grey optic on this port. It travels only over fiber and patch panels to the next OADM with a 1310 nm port, which must have the same optic; amplifiers, ROADMs and muxes block it.'));
        box.append(field('1310 nm port', selIn(p, 'p1310', [['false', 'No'], ['true', 'Yes: a 1310 nm coupler on the line']]), `A coupler for 1310 nm light (a legacy grey client) sits on the line path and costs 0.6 dB.`),
          field('Pass-through loss (dB)', numIn(p, 'thru', 0.1, 0, 10)), field('Add/drop loss (dB)', numIn(p, 'ad', 0.1, 0, 10)), field('Local transmitter power (dBm)', numIn(p, 'tx', 0.5, -20, 10), 'For channels a plan adds here without a transponder: they leave at this power less the add loss, with no equalisation.'));
        { const used = portsUsed(n), rows = []; for (const sd of p.sides.split('')) { for (let k = 0; k < portCount(n, sd); k++) rows.push(`${portSlotText(n, k, sd)}: ${used.has(sd + '|' + k) ? used.get(sd + '|' + k).name : '—'}`); }
          box.append(el('p', { class: 'muted small', text: 'Cable a transponder to the OADM to plug it into a port.' }), el('pre', { class: 'muted small', style: 'max-height:150px;overflow:auto;white-space:pre-wrap', text: rows.join('\n') || 'No ports.' })); }
      }
      box.append(list('badPorts', 128, 'Slot numbers (as in the Channels tab) whose add/drop port on this device has failed. Only the channels that join or leave the line here are lost; everything else keeps running.', 'Failed ports (slots)'),
        list('badCards', 16, `A card serves ${MODEL.PORTS_PER_CARD} consecutive slots: card 1 is slots 1-${MODEL.PORTS_PER_CARD}, card 2 the next ${MODEL.PORTS_PER_CARD}, and so on. A failed card takes down all of its ports at once.`, 'Failed cards'));
    }
    { const d = TYPES[n.type].def(); for (const k in d) if (p[k] === undefined) p[k] = d[k]; } // fields added since this lab was saved
    if (isEnd(n)) {
      box.append(field(n.type === 'mxp' ? 'Line port mode' : 'Mode', selIn(p, 'mode', Object.entries(PHY.MODES).map(([k, m]) => [k, m.name]))));
      { const slotsN = PHY.cBandSlots(+S.g.df * 1e9), cab = S.links.map(portLink).filter(x => x && x.t === n)[0], autoText = cab && cab.m ? 'Auto: the slot of its port' : 'Auto';
        // a slot is a number from 1 to 64, with its frequency beside it; blank means Auto
        const wi = el('input', { type: 'number', id: 'f-slot', step: 1, min: 1, max: slotsN, placeholder: 'Auto', 'aria-label': 'Wavelength slot, blank for Auto' }), ro = el('small', { class: 'muted' });
        const read = v => { ro.textContent = Number.isInteger(v) ? `Slot ${v + 1} · ${PHY.slotFreqTHz(v, +S.g.df * 1e9).toFixed(2)} THz` : autoText; };
        wi.value = Number.isInteger(p.slot) ? p.slot + 1 : ''; read(Number.isInteger(p.slot) ? p.slot : null);
        wi.addEventListener('input', () => { const v = Math.round(+wi.value); read(wi.value !== '' && v >= 1 && v <= slotsN ? v - 1 : Number.isInteger(p.slot) ? p.slot : null); });
        wi.addEventListener('change', () => { if (wi.value === '') { p.slot = null; renderAll(); return; } const v = Math.round(+wi.value); if (isFinite(v) && v >= 1 && v <= slotsN) { p.slot = v - 1; renderAll(); } else { wi.value = Number.isInteger(p.slot) ? p.slot + 1 : ''; read(Number.isInteger(p.slot) ? p.slot : null); toast(`Slots run from 1 to ${slotsN}.`); } });
        box.append(field('Wavelength', el('div', { class: 'slotfield' }, [wi, el('button', { class: 'btn quiet', type: 'button', text: 'Auto', hidden: !Number.isInteger(p.slot), onclick: () => { p.slot = null; renderAll(); } })]), ''));
        box.lastChild.append(ro); box.lastChild.append(el('small', { text: 'A tunable transponder is set to a slot. Plugged into a mux or OADM port it only gets through if it matches that port; Auto follows the port.' }));
        if (cab && cab.m.type !== 'roadm' && cab.m.p.bidi) { // on a single-fiber port it also listens on a slot of its own
          const rs = el('select', { id: 'f-rxslot', 'aria-label': 'Receive wavelength' }); rs.append(el('option', { value: '', text: 'Auto: what its port delivers' }));
          for (let k = 0; k < slotsN; k++) rs.append(el('option', { value: String(k), text: `Slot ${k + 1} · ${PHY.slotFreqTHz(k, +S.g.df * 1e9).toFixed(2)} THz` }));
          rs.value = Number.isInteger(p.rxSlot) ? String(p.rxSlot) : ''; rs.addEventListener('change', () => { p.rxSlot = rs.value === '' ? null : +rs.value; renderAll(); });
          box.append(field('Receive wavelength', rs, 'A single-fiber transponder transmits one slot and listens on another. It must listen on what its port delivers, which is what the far end transmits.')); }
        if (cab) box.append(field('Power offset (dB)', numIn(p, 'off', 0.5, -10, 10), 'Launch power relative to the other channels, for a transponder on a mux, OADM or ROADM port.'));
        const others = S.nodes.filter(x => isEnd(x) && x !== n);
        if (cab && others.length) { // which far end it talks to, when several transponders could be tuned to the same slot (a ROADM mesh reuses slots)
          const ps = el('select', { id: 'f-peer', 'aria-label': 'Connect to' }); ps.append(el('option', { value: '', text: 'Auto: the nearest on the same slot' })); others.forEach(x => ps.append(el('option', { value: x.id, text: x.name })));
          ps.value = p.peer || ''; ps.addEventListener('change', () => { const old = node(p.peer); if (old && old.p.peer === n.id) old.p.peer = ''; p.peer = ps.value; const nw = node(ps.value); if (nw && !nw.p.peer) nw.p.peer = n.id; renderAll(); });
          box.append(field('Connect to', ps, 'The far end of this channel. Leave on Auto unless several transponders share a slot (wavelength reuse in a mesh).')); }
        if (cab) { // protection and a wavelength converter for the channel this transponder makes (the pair takes either end's setting)
          box.append(field('Line protection', selIn(p, 'prot', [['', 'None: restore over what is left'], ['1+1', '1+1: a second copy on a disjoint route'], ['shared', '1:N shared: dark until the working route fails']]), 'Protection of the channel between this transponder and its partner. The protection route is planned to avoid the fibers of the working route.'));
          const rm = S.nodes.filter(x => x.type === 'roadm');
          if (rm.length) { const cs = el('select', { id: 'f-conv', 'aria-label': 'Convert at' }); cs.append(el('option', { value: '', text: 'No converter' })); rm.forEach(x => cs.append(el('option', { value: x.id, text: x.name })));
            cs.value = p.conv || ''; cs.addEventListener('change', () => { p.conv = cs.value; renderAll(); });
            box.append(field('Convert at', cs, 'Regenerate the channel at this ROADM into the slot of the partner\u2019s port. Set \u2018Connect to\u2019 as well, because the two ends are in different slots. The service channel cannot be converted.')); } } }
      const m = PHY.MODES[p.mode];
      box.append(field('Module protection', selIn(p, 'spare', [['', 'None'], ['switch', 'Spare module, optical switch (1 dB)'], ['ycable', 'Spare module, y-cable (3.5 dB)']]), 'A second transponder module shares the line port. If this one fails the spare takes over in the switch time instead of the repair time. The switch or splitter costs power in both directions. Cable a second patch cord to another ROADM to dual-home it: the protection route can then avoid the access ROADM too.'));
      box.append(field('Tx power (dBm)', numIn(p, 'tx', 0.5, -15, 3, true, String(m.tx)), `Blank = module default ${m.tx} dBm`));
      box.append(el('div', { class: 'spec' }, [
        specRow('Baud rate', `${(m.Rs / 1e9).toFixed(2)} GBd`), specRow('Modulation', (m.coh === false ? '' : 'DP-') + m.mod), specRow('FEC / limit', `${m.fec} · BER ${m.berThr.toExponential(2)}`),
        specRow('Required OSNR', `${f1(reqOsnr(p.mode))} dB / 0.1 nm`), specRow('Rx window', `${m.rxMin} to ${m.rxMax} dBm`), specRow('CD tolerance', `±${m.cdTol} ps/nm` + (m.coh === false ? ' (no DSP)' : '')), specRow('PMD tol. (mean DGD)', `${m.dgdTol} ps`)]));
      if (n.type === 'mxp') box.append(clientEditor(n));
      const b = el('div', { class: 'row' }, [
        el('button', { class: 'btn', text: S.svc.a === n.id ? 'This is the A end' : 'Set as A end', onclick: () => { if (S.svc.z === n.id) S.svc.z = S.svc.a; S.svc.a = n.id; renderAll(); } }),
        el('button', { class: 'btn', text: S.svc.z === n.id ? 'This is the Z end' : 'Set as Z end', onclick: () => { if (S.svc.a === n.id) S.svc.a = S.svc.z; S.svc.z = n.id; renderAll(); } })]);
      box.append(b);
    } else if (n.type === 'mux') {
      box.append(field('Insertion loss (dB)', numIn(p, 'il', 0.1, 0, 15), 'Typical 40/48 ch AWG or thin-film: 4–6 dB per pass'));
      box.append(field('Single fiber (BiDi)', selIn(p, 'bidi', [['false', 'No: a pair of fibers, the same slot both ways'], ['true', 'Yes: one fiber, a different slot each way']]), 'A BiDi mux passes a low and a high band of slots. A transponder on port k transmits one and listens on the other, so the two ends of a link must be on opposite bands.'));
      if (p.bidi) box.append(field('Band this end transmits', selIn(p, 'role', [['low', 'Low band (receives the high band)'], ['high', 'High band (receives the low band)']]), 'The far end has to be on the other band.'));
      box.append(field('Channel ports', numIn(p, 'ports', 1, 1, 64), 'A real mux is 8, 16, 40, 48 or 64 channels. Port 1 is the lowest slot.'), field('First slot', slotBox(p, 'first', 'f-first'), 'The slot (numbered as in the Channels tab) that port 1 passes; port k passes the slot k − 1 further on.'));
      { const used = portsUsed(n), rows = []; for (let k = 0; k < Math.min(p.ports, 64); k++) rows.push(`${portSlotText(n, k, '')}: ${used.has('|' + k) ? used.get('|' + k).name : '—'}`);
        box.append(el('p', { class: 'muted small', text: 'Cable a transponder to the mux to give it a port.' }), el('pre', { class: 'muted small', style: 'max-height:150px;overflow:auto;white-space:pre-wrap', text: rows.join('\n') })); }
    } else if (n.type === 'edfa') {
      box.append(field('Gain control', selIn(p, 'ctl', [['auto', 'Auto: hit output target'], ['fixed', 'Fixed gain']])));
      if (p.ctl === 'auto') box.append(field('Output target (dBm/ch)', numIn(p, 'target', 0.5, -10, 10, true, String(S.g.launch)), 'Blank = follow the global launch power'), field('Same, return direction (dBm/ch)', numIn(p, 'targetRev', 0.5, -10, 10, true, p.target === '' ? String(S.g.launch) : String(p.target)), 'Z to A. A line amp is really two amps, one per direction: a booster in one is a preamp in the other. Blank = same as forward.'));
      else box.append(field('Gain (dB)', numIn(p, 'gain', 0.5, 0, 40)), field('Same, return direction (dB)', numIn(p, 'gainRev', 0.5, 0, 40, true, String(p.gain)), 'Z to A. Blank = same as forward.'));
      box.append(field('Noise figure (dB)', numIn(p, 'nf', 0.1, 3, 12), 'Quantum limit is 3 dB. Real EDFAs: 4.5–6 dB'));
      box.append(field('Gain range min / max (dB)', el('div', { class: 'pair' }, [numIn(p, 'gmin', 1, 0, 40), numIn(p, 'gmax', 1, 0, 40)])));
      box.append(field('Max total output (dBm)', numIn(p, 'pmax', 0.5, 10, 30), 'Shared by every channel in the fiber'));
      box.append(field('Max total input (dBm)', numIn(p, 'pinMax', 0.5, -10, 20), 'The most total power (all channels together) the input stage takes. Above it the amplifier is overloaded: an alarm tells you, and well above it the input stage saturates and can be damaged. Typical 8 to 12 dBm.'));
      box.append(field('Return direction: noise figure (dB)', numIn(p, 'nfRev', 0.1, 3, 12, true, String(p.nf)), 'Blank = same as forward. Also below: gain range and max output for the other amplifier in this box.'));
      box.append(field('Return: gain range min / max (dB)', el('div', { class: 'pair' }, [numIn(p, 'gminRev', 1, 0, 40, true, String(p.gmin)), numIn(p, 'gmaxRev', 1, 0, 40, true, String(p.gmax))])));
      box.append(field('Return: max total output (dBm)', numIn(p, 'pmaxRev', 0.5, 10, 30, true, String(p.pmax))));
      box.append(field('Control response (µs)', numIn(p, 'agcUs', 5, 0, 5000, true, String(S.g.agcUs ?? PHY.TRANSIENT.agcUs)), 'Blank = the global setting. How fast the gain control reacts when channels vanish (Transients tab).'));
      box.append(field('Gain-tilt control', selIn(p, 'tiltCtl', [['true', 'On: re-flatten the band'], ['false', 'Off: SRS tilt accumulates']]), 'Counters Raman tilt from the span before it'));
    } else if (n.type === 'roadm') {
      box.append(field('WSS loss per pass (dB)', numIn(p, 'wss', 0.5, 0, 15)));
      box.append(field('Add/drop structure loss (dB)', numIn(p, 'ad', 0.5, 0, 15)));
      box.append(field('Integrated amplifiers', selIn(p, 'amps', [['true', 'Yes: preamp + booster'], ['false', 'No (passive)']])));
      box.append(field('Amp noise figure (dB)', numIn(p, 'nf', 0.1, 3, 12)));
      box.append(field('Degrees', numIn(p, 'degrees', 1, 1, 9), 'How many line cables (directions) it can have.'));
      box.append(field('Colorless add/drop', selIn(p, 'colorless', [['true', 'Yes: any port takes any slot'], ['false', 'No: port k passes one fixed slot']]), 'A colored (mux-based) add/drop structure ties every port to a slot; a colorless one lets a tunable transponder use any slot on any port.'),
        field('Directionless', selIn(p, 'directionless', [['true', 'Yes: any port can go out any degree'], ['false', 'No: each port belongs to one degree']]), 'Without it a transponder can only reach the degree its port is wired to.'),
        field('Contentionless', selIn(p, 'contentionless', [['true', 'Yes: the same slot on several ports'], ['false', 'No: a slot at only one port']]), 'Without it two transponders on this ROADM cannot add the same slot, even towards different degrees.'));
      box.append(field(p.directionless ? 'Add/drop ports' : 'Add/drop ports per degree', numIn(p, 'ports', 1, 1, 64)));
      if (!p.colorless) box.append(field('First slot', slotBox(p, 'first', 'f-first'), 'The slot (numbered as in the Channels tab) of port 1; port k passes the slot k − 1 further on.'));
      { const used = portsUsed(n), rows = []; for (const sd of deviceSides(n)) { for (let k = 0; k < Math.min(64, portCount(n, sd)); k++) rows.push(`${portSlotText(n, k, sd)}: ${used.has(sd + '|' + k) ? used.get(sd + '|' + k).name : '—'}`); }
        box.append(el('p', { class: 'muted small', text: 'Cable a transponder to the ROADM to plug it into a port. Typical add/drop loss: colored 4-6 dB, colorless 6-9 dB (with an amplifier), contentionless 9-12 dB.' }), el('pre', { class: 'muted small', style: 'max-height:150px;overflow:auto;white-space:pre-wrap', text: rows.join('\n') || 'No ports.' })); }
      box.append(el('p', { class: 'muted small', text: 'Express traffic passes two WSSs (route and select). Add or drop passes one WSS plus the add/drop structure. Each WSS pass narrows the passband a little.' }));
    } else if (n.type === 'panel') {
      box.append(field('Ports', numIn(p, 'ports', 1, 1, 48), 'Each port joins a rear connector to a front connector.'), field('Loss per mated pair (dB)', numIn(p, 'il', 0.1, 0, 3), 'A clean LC or SC pair is 0.3-0.75 dB.'));
      const di = el('input', { value: Object.entries(p.dirty || {}).map(([k, v]) => `${k}=${v}`).join(', '), id: 'f-dirty', placeholder: 'none' });
      di.addEventListener('input', () => { const d = {}; for (const tok of di.value.split(/[\s,;]+/).filter(Boolean)) { const [k, v] = tok.split('='), i = Math.round(+k), db = v === undefined ? 2 : +v; if (Number.isInteger(i) && i >= 1 && i <= p.ports && isFinite(db) && db > 0) d[i] = Math.min(10, db); } p.dirty = d; recompute(); });
      box.append(field('Dirty connectors', di, 'Port number and the extra loss, for example 1=1.8, 4=3. A dirty or damaged connector costs 1-3 dB (more if it is bad) and raises a warning. Leave empty for a clean panel.'),
        el('button', { class: 'btn', text: 'Clean every connector', onclick: () => { p.dirty = {}; renderAll(); } }));
      box.append(el('p', { class: 'muted small', text: 'Cable a fiber to the rear of a port and a patch cord to its front. Light cannot pass from one port to another.' }));
    } else if (n.type === 'splitter') {
      box.append(field('Split ratio (A / B)', selIn(p, 'ratio', Object.keys(MODEL.SPLIT).map(k => [k, k + (k === '99/1' ? '  (monitor tap)' : '')])), 'Power share to port A (the main branch) and port B. A 99/1 tap costs the main path 0.05 dB and gives the monitor port 1%.'));
      box.append(field('Excess loss (dB)', numIn(p, 'excess', 0.1, 0, 3), 'Insertion loss on top of the split itself.'));
      box.append(el('p', { class: 'muted small', text: `Common to A: ${f1(MODEL.splitLossDb(n, 'a'))} dB. Common to B: ${f1(MODEL.splitLossDb(n, 'b'))} dB. Cabling both branches lights both paths (a 1+1 head end); a splitter run backwards combines them.` }));
      { const h = lastRes && lastRes.hops ? lastRes.hops.find(x => x.name === n.name) : null;
        if (h) { const per = h.in.sig - MODEL.splitLossDb(n, 'b'); box.append(el('p', { html: `<b>Monitor port B</b> reads ${f1(per)} dBm per channel, ${f1(per + 10 * Math.log10(Math.max(1, h.nch || 1)))} dBm in total (${h.nch || 1} channel${(h.nch || 1) > 1 ? 's' : ''}), if nothing else is cabled to it.` })); } }
    } else if (n.type === 'switch') {
      box.append(field('Selected port', selIn(p, 'pos', [['a', 'Port A'], ['b', 'Port B']]), 'The input the common port is connected to.'));
      box.append(field('On loss of light', selIn(p, 'auto', [['true', 'Auto-switch to the other port'], ['false', 'Stay: manual switching only']]), 'Auto: if the selected port loses its light the switch moves to the other one after the switch time. Manual: it stays put and the service is down until you switch it.'));
      box.append(field('Insertion loss (dB)', numIn(p, 'il', 0.1, 0, 10)), field('Switch time (ms)', numIn(p, 'switchMs', 5, 1, 1000), 'Used for the availability estimate: a cut that the switch rides through costs the detection plus this time.'));
    } else if (n.type === 'meter') {
      const m = lastRes && lastRes.meters && lastRes.meters[n.id];
      box.append(el('p', { class: 'small', text: m ? (m.dbm != null ? `${m.status === 'over' ? 'OVER range: ' : m.status === 'low' ? 'LOW (below the floor): ' : ''}${f1(m.dbm)} dBm total, ${f1(m.perCh)} dBm per channel, ${m.why}.` : `No reading: ${m.why}.`) : 'Plug it into a test point (a patch panel port, or a splitter or switch port) and it reads the service light there.' }));
      box.append(el('p', { class: 'muted small', text: `Range ${MODEL.METER.min} to +${MODEL.METER.max} dBm. Below the floor it reads LOW; above the top it reads OVER, and a meter that sees more than that is being overloaded. Reads the C-band service light, in the service direction.` }));
    } else if (n.type === 'otdr') {
      box.append(field('Pulse width (ns)', selIn(p, 'pulse', MODEL.OTDR_PULSES.map(v => [v, `${v} ns · dynamic range ${MODEL.OTDR_DR[v]} dB · dead zone ${(1.5 * v * 0.1).toFixed(1)} m`])), 'A short pulse resolves close events but runs out of range quickly; a long pulse reaches far but blurs neighbouring events together (the dead zone).'));
      box.append(el('div', { class: 'row' }, [el('button', { class: 'btn', text: 'Show the trace', onclick: () => { otdrSel = n.id; tab = 'otdr'; renderTabBody(); } })]));
      box.append(el('p', { class: 'muted small', text: 'Plug it into a patch panel port (or a splitter or switch port). It sends a 1625 nm pulse through the test point and along the cabling: fiber loss, connectors, splitters, breaks and the end of the fiber. Amplifiers, muxes and ROADMs reflect it.' }));
    } else if (n.type === 'host') {
      const ipi = el('input', { value: p.ip || '', id: 'f-ip', placeholder: '10.0.0.1/24' }); ipi.addEventListener('input', () => { p.ip = ipi.value.trim(); recompute(); });
      box.append(field('Address / prefix', ipi, 'Optional. Two hosts can only reach each other if they are on the same subnet (there is no router between them). Leave empty to skip the check.'));
      box.append(field('Ethernet ports', numIn(p, 'ports', 1, 1, 8)), field('Port speed (Gb/s)', selIn(p, 'speed', [1, 10, 25, 40, 50, 100, 200, 400, 800].map(v => [v, `${v}G`])), 'It has to match the client optic of the muxponder port, or the rate of the transponder, it is cabled to.'));
      box.append(el('p', { class: 'muted small', text: 'Cable a port to a transponder or a muxponder client port. The Reachability tab shows whether it can reach the other hosts, and why not.' }));
    } else if (n.type === 'dcm') {
      box.append(field('Dispersion (ps/nm)', numIn(p, 'cd', 10, -8000, 8000)));
      box.append(field('Insertion loss (dB)', numIn(p, 'il', 0.5, 0, 20)));
      box.append(field('Return direction: dispersion (ps/nm)', numIn(p, 'cdRev', 10, -8000, 8000, true, String(p.cd)), 'Blank = same as forward. Set 0 for a return fiber that has no compensator.'));
      box.append(field('Return direction: insertion loss (dB)', numIn(p, 'ilRev', 0.5, 0, 20, true, String(p.il))));
      box.append(el('p', { class: 'muted small', text: 'Negative dispersion cancels the fiber\'s positive dispersion: about -1360 ps/nm for 80 km of SMF (17 ps/nm/km). A DCF module costs ~7 dB, a fiber Bragg grating ~3 dB. Put it between amplifier stages so the loss does not hurt OSNR.' }));
    } else if (n.type === 'voa') {
      box.append(field('Attenuation (dB)', numIn(p, 'att', 0.5, 0, 30)));
    }
    box.append(el('button', { class: 'btn quiet', text: 'Delete device', onclick: del })); // Undo makes it safe, so it is not the loudest control
  } else {
    const l = link(sel.id); if (!l) return;
    const seenHints = new Set(), once = (k, t) => (seenHints.has(k) ? undefined : (seenHints.add(k), t)); // the same help text for the cable's two ends is shown once
    // the type, the name and the main actions stay at the top of the panel while its fields scroll
    const head = el('div', { class: 'insp-head' }, [el('h2', { text: l.kind === 'fiber' ? 'Fiber span' : 'Patch cord' }), el('p', { class: 'muted', text: linkName(l) }),
      el('div', { class: 'row' }, [el('button', { class: 'btn ' + (l.p.cut ? '' : 'danger'), text: l.p.cut ? 'Splice it back' : l.kind === 'fiber' ? 'Cut this fiber' : 'Cut this cable', onclick: () => { l.p.cut = !l.p.cut; checkpoint(); renderAll(); toast(`${l.p.cut ? 'Cut' : 'Spliced'} ${linkName(l)}`, { label: 'Undo', fn: undo }); } }), el('button', { class: 'btn quiet', text: 'Delete cable', onclick: del })])]);
    box.append(head);
    box.append(field('Cable type', selIn(l, 'kind', [['fiber', 'Fiber span (outside plant)'], ['patch', 'Patch cord (in the rack)']])));
    if (l.p.dir == null) l.p.dir = 'both';
    { const na = node(l.a), nb = node(l.b); box.append(field('Carries light', selIn(l.p, 'dir', [['both', 'Both ways (a fiber pair)'], ['ab', `${na ? na.name : 'a'} → ${nb ? nb.name : 'b'} only`], ['ba', `${nb ? nb.name : 'b'} → ${na ? na.name : 'a'} only`]]), 'A one-way fiber lets each direction take a different route.')); }
    if (clientLink(l)) {
      const a = node(l.a), h = a.type === 'host' ? a : node(l.b), e = h === a ? node(l.b) : a, mine = S.links.filter(x => x !== l && clientLink(x));
      const usedH = new Set(mine.filter(x => x.a === h.id || x.b === h.id).map(x => x.p.hport)), usedC = new Map(mine.filter(x => x.a === e.id || x.b === e.id).map(x => [x.p.cport, (node(x.a).type === 'host' ? node(x.a) : node(x.b)).name]));
      const hs = el('select', { id: 'f-hport', 'aria-label': 'Host port' });
      for (let k = 0; k < h.p.ports; k++) hs.append(el('option', { value: String(k), text: `Port ${k + 1} (${h.p.speed}G)` + (usedH.has(k) ? ' · in use' : '') }));
      hs.value = String(l.p.hport ?? 0); hs.addEventListener('change', () => { l.p.hport = +hs.value; renderAll(); });
      box.append(field(`Port on ${h.name}`, hs));
      const cs = el('select', { id: 'f-cport', 'aria-label': 'Client port' });
      for (let k = 0; k < clientCount(e); k++) { const o = e.type === 'mxp' ? PHY.CLIENT_OPTICS[e.p.clients[k].optic] : null; cs.append(el('option', { value: String(k), text: `Client port ${k + 1}` + (o ? ` (${o.name})` : ` (${PHY.MODES[e.p.mode].rate}G)`) + (usedC.has(k) ? ` · in use by ${usedC.get(k)}` : '') })); }
      cs.value = String(l.p.cport ?? 0); cs.addEventListener('change', () => { l.p.cport = +cs.value; renderAll(); });
      box.append(field(`Client port on ${e.name}`, cs, e.type === 'mxp' ? 'A muxponder client port is carried to the same-numbered client port on the far muxponder.' : 'A transponder has one client port; it has to match the line rate.'));
    }
    if (portLink(l)) {
      const { t, m } = portLink(l), used = portsUsed(m, l), so = el('select', { id: 'f-mport', 'aria-label': 'Port' });
      so.append(el('option', { value: '', text: 'Not assigned (no port model)' }));
      for (const sd of deviceSides(m)) { for (let k = 0; k < portCount(m, sd); k++) so.append(el('option', { value: `${sd}:${k}`, text: portSlotText(m, k, sd) + (used.has(sd + '|' + k) ? ` · in use by ${used.get(sd + '|' + k).name}` : '') })); }
      so.value = l.p.mport == null ? '' : `${sideOf(l, m)}:${l.p.mport}`;
      so.addEventListener('change', () => { if (so.value === '') l.p.mport = null; else { const [sd, k] = so.value.split(':'); if (m.type !== 'mux') setSide(l, m, sd); l.p.mport = +k; } renderAll(); });
      box.append(field(`Port on ${m.name}`, so, `${t.name} is plugged into this port. The filter passes only that port's slot, so ${t.name} has to be tuned to it (Auto follows the port).${m.type === 'oadm' ? ' Its light goes out on that side of the OADM.' : m.type === 'roadm' && !m.p.directionless ? ' Its light goes out on that degree only (the ROADM is not directionless).' : ''}`));
    }
    for (const n of [node(l.a), node(l.b)]) if (n && n.type === 'panel') {
      const ps = el('select', { id: 'f-odf-' + n.id, 'aria-label': `Port on ${n.name}` }), used = new Set(S.links.filter(x => x !== l && (x.a === n.id || x.b === n.id)).map(x => sideOf2(x, n)));
      for (let k = 1; k <= n.p.ports; k++) for (const sd of ['r', 'f']) ps.append(el('option', { value: sd + k, text: `${sd === 'r' ? 'Rear' : 'Front'} of port ${k}` + (used.has(sd + k) ? ' · in use' : '') + (n.p.dirty && n.p.dirty[k] ? ' · dirty' : '') }));
      ps.value = sideOf2(l, n) || 'r1'; ps.addEventListener('change', () => { setSide(l, n, ps.value); renderAll(); });
      box.append(field(`Port on ${n.name}`, ps, once('panel', 'Light enters one side of a port and leaves the other side of the same port: the rear is usually the outside plant, the front the patch cords to equipment. Each mated connector pair costs the panel\'s connector loss.')));
    }
    for (const n of [node(l.a), node(l.b)]) if (isTri(n)) {
      const ps = el('select', { id: 'f-tri-' + n.id, 'aria-label': `Port on ${n.name}` }), used = new Map(S.links.filter(x => x !== l && (x.a === n.id || x.b === n.id)).map(x => [sideOf2(x, n), 1]));
      for (const k of ['c', 'a', 'b']) ps.append(el('option', { value: k, text: TRI_NAME[k] + (n.type === 'splitter' && k === 'b' ? ' (tap / second branch)' : '') + (used.has(k) ? ' · in use' : '') }));
      ps.value = sideOf2(l, n) || 'c'; ps.addEventListener('change', () => { setSide(l, n, ps.value); renderAll(); });
      box.append(field(`Port on ${n.name}`, ps, once('tri', n.type === 'splitter' ? 'Light goes between the common port and either branch, never between the two branches. A 99/1 tap sends 1% to port B.' : 'The common port is the one the receiver side hangs off; the switch passes port A or port B to it.')));
    }
    for (const n of [node(l.a), node(l.b)]) if (n && (n.type === 'oadm' || n.type === 'roadm') && !(portLink(l) && portLink(l).m === n) && !isEnd(n === node(l.a) ? node(l.b) : node(l.a))) { // a line cable on an OADM or ROADM: which side or degree of it
      const ss = el('select', { id: 'f-side-' + n.id, 'aria-label': `Side of ${n.name}` }), other = n === node(l.a) ? node(l.b) : node(l.a);
      for (const sd of lineSides(n)) ss.append(el('option', { value: sd, text: sideLabel(n, sd) }));
      ss.value = sideOf(l, n) || (n.type === 'roadm' ? lineSides(n)[0] : defSide(n, other)); ss.addEventListener('change', () => { setSide(l, n, ss.value); renderAll(); });
      box.append(field(n.type === 'roadm' ? `Degree on ${n.name}` : `Line side on ${n.name}`, ss, once('side', n.type === 'roadm' ? 'Each line cable is one degree of the ROADM. If the add/drop is not directionless, a transponder port belongs to one degree and its light only leaves by that one.' : 'West is where the line comes from on the left, East the right. A transponder on a West port talks to the West line only.')));
    }
    if (l.kind === 'fiber') {
      for (const k in linkDefaults('fiber')) if (l.p[k] == null) l.p[k] = linkDefaults('fiber')[k];
      box.append(field('Length (km)', numIn(l.p, 'len', 1, 0, 300)));
      box.append(field('Single fiber', selIn(l.p, 'single', [['false', 'No: one fiber each way'], ['true', 'Yes: one fiber carries both directions']]), 'On a single fiber the two directions of a channel need different slots, and no other channel can use either slot on this span.'));
      box.append(field('Fiber type', selIn(l.p, 'fiber', Object.entries(PHY.FIBERS).map(([k, f]) => [k, f.name]))));
      box.append(field('Connector + splice loss (dB)', numIn(l.p, 'extra', 0.1, 0, 20), 'Dirty connector? Add 1–3 dB here'));
      box.append(field('Same, return direction (dB)', numIn(l.p, 'extraRev', 0.1, 0, 20, true, String(l.p.extra)), 'Z to A. Blank = same as forward. Bidirectional lines have two fibers; a dirty connector on one hurts one direction.'));
      box.append(field('Channels lit on this span', numIn(l.p, 'nch', 1, 1, 96, true, String(S.g.nch)), 'Blank = global. Applies from this span until a mux or ROADM changes it. Fewer neighbours means less nonlinearity.'));
      const fb = PHY.FIBERS[l.p.fiber];
      // the Raman pump is off on most spans: its settings fold away, and open on their own when a pump is on
      const rd = el('details', { class: 'raman' }, [el('summary', { text: +l.p.raman > 0 || +l.p.ramanRev > 0 ? `Raman pump · ${l.p.raman} mW${l.p.ramanDir === 'fwd' ? ' forward' : l.p.ramanDir === 'both' ? ' both ends' : ' backward'}` : 'Raman pump · off' })]);
      rd.open = ramanOpen ?? (+l.p.raman > 0 || +l.p.ramanRev > 0); rd.addEventListener('toggle', () => { ramanOpen = rd.open; }); box.append(rd);
      rd.append(field('Raman pump, backward (mW)', numIn(l.p, 'raman', 50, 0, PHY.RAMAN.maxMw), '0 = off. Distributed gain along the fiber: better OSNR than a lumped amp at the end, but more nonlinearity and a Class 4 laser above ~1 W.'));
      rd.append(field('Raman pump direction', selIn(l.p, 'ramanDir', [['back', 'Backward (from the receive end)'], ['fwd', 'Forward (from the transmit end)'], ['both', 'Both ends, power split']]), 'Backward is quietest. Forward lifts the signal early, which helps ASE but raises nonlinearity and pump noise. Both ends flatten the gain profile.'));
      l.p.ramanFull ??= false;
      rd.append(field('Raman model', selIn(l.p, 'ramanFull', [['false', 'Closed-form approximation'], ['true', 'Coupled-wave solver']]), 'The solver integrates the power equations of every channel and pump wavelength along the span: pump-to-pump transfer, depletion by the signals, the real gain spectrum, forward and backward pumping together. The Raman tab shows the result.'));
      rd.append(field('Raman pumps (wavelengths)', selIn(l.p, 'ramanPumps', [['1', '1 pump: gain ripple across the band'], ['2', '2 pumps'], ['3', '3 pumps: flat gain']]), 'More pump wavelengths flatten the gain across C-band, which shows up as less tilt. Total pump power is shared.'));
      rd.append(field('Raman pump, return direction (mW)', numIn(l.p, 'ramanRev', 50, 0, PHY.RAMAN.maxMw, true, String(l.p.raman)), 'Blank = same as forward.'));
      const rn = el('p', { class: 'muted small' });
      const upd = () => { const gr = PHY.ramanGain(fb, +l.p.len, Math.min(PHY.RAMAN.maxMw, +l.p.raman || 0)); rn.textContent = gr > 0 ? `On-off Raman gain about ${f1(gr)} dB, net span loss ${f1(fb.att * l.p.len + +l.p.extra - gr)} dB.` : ''; rn.hidden = !(gr > 0); };
      box.querySelector('#f-raman').addEventListener('input', upd); upd(); rd.append(rn);
      box.append(el('div', { class: 'spec' }, [specRow('Attenuation', `${fb.att} dB/km`), specRow('Span loss', `${f1(fb.att * l.p.len + +l.p.extra)} dB`), specRow('Dispersion', `${fb.D} ps/nm/km → ${Math.round(fb.D * l.p.len)} ps/nm`), specRow('PMD', `${fb.pmd} ps/√km`), specRow('Nonlinear γ', `${fb.gamma} /W/km`)]));
    } else {
      if (l.p.il == null) l.p.il = linkDefaults('patch').il;
      box.append(field('Loss (dB)', numIn(l.p, 'il', 0.1, 0, 10)));
    }
    if (l.kind === 'fiber') {
      const gi = el('input', { value: l.p.srlg || '', id: 'f-srlg', placeholder: 'e.g. duct1', maxlength: 24 });
      gi.addEventListener('change', () => { l.p.srlg = gi.value.trim().replace(/[^\w-]/g, ''); renderAll(); });
      box.append(field('Shared risk group', gi, 'Fibers with the same name share a duct or a trench: cutting one cuts all of them, and protection routes are planned to avoid the whole group.'));
    }
    if (l.kind === 'fiber' && l.p.cut) box.append(field('Cut position (km from the A end)', numIn(l.p, 'cutAt', 0.5, 0, 300, true, String(+(l.p.len / 2).toFixed(1))), 'Where the break is. An OTDR sees it as a reflective break at this distance. Blank = halfway.'));
  }
}
// Client ports of a muxponder: optic type, distance to the host, connector loss, with a live budget line per port.
function clientEditor(n) {
  const wrap = el('div', { class: 'clients' }, [el('h3', { text: 'Client ports' })]);
  const summary = el('p', { class: 'small' });
  const upd = () => {
    const total = n.p.clients.reduce((a, c) => a + PHY.CLIENT_OPTICS[c.optic].rate, 0), line = PHY.MODES[n.p.mode].rate;
    summary.className = 'small ' + (total > line ? 'cs-down' : 'muted');
    summary.textContent = `${n.p.clients.length} port${n.p.clients.length === 1 ? '' : 's'}: ${total}G into a ${line}G line` + (total > line ? '. Too much for the line port.' : '.');
  };
  wrap.append(summary);
  n.p.clients.forEach((c, i) => {
    const info = el('small', { class: 'cinfo' });
    const refresh = () => { const b = PHY.clientBudget(c); info.textContent = `Rx ${f1(b.rx)} dBm, margin ${f1(b.margin)} dB${b.notes.length ? ': ' + b.notes[0] : ''}`; info.className = 'cinfo cs-' + b.status; upd(); };
    const sel = el('select', { 'aria-label': `Client ${i + 1} optic` });
    for (const k in PHY.CLIENT_OPTICS) sel.append(el('option', { value: k, text: PHY.CLIENT_OPTICS[k].name }));
    sel.value = c.optic; sel.addEventListener('change', () => { c.optic = sel.value; renderAll(); });
    const num = (key, label, step) => {
      const inp = el('input', { type: 'number', step, min: 0, value: c[key], 'aria-label': `Client ${i + 1} ${label}` });
      inp.addEventListener('input', () => { if (inp.value !== '' && isFinite(+inp.value) && +inp.value >= 0) { c[key] = +inp.value; refresh(); recompute(); } });
      return inp;
    };
    const rm = el('button', { class: 'btn', text: '×', title: 'Remove client port', 'aria-label': `Remove client ${i + 1}`, onclick: () => { n.p.clients.splice(i, 1); renderAll(); } });
    const unit = (inp, u) => el('label', { class: 'u' }, [inp, u]);
    wrap.append(el('div', { class: 'crow' }, [sel, unit(num('len', 'length in km', 0.1), 'km'), unit(num('extra', 'connector loss in dB', 0.5), 'dB conn.'), rm]), info);
    refresh();
  });
  const add = el('button', { class: 'btn', text: '+ Add client port', onclick: () => { const last = n.p.clients[n.p.clients.length - 1]; n.p.clients.push(MODEL.newClient(last ? last.optic : undefined)); renderAll(); } });
  if (n.p.clients.length >= 8) add.disabled = true;
  wrap.append(add);
  return wrap;
}
function specRow(k, v) { return el('div', {}, [el('span', { text: k }), el('b', { text: v })]); }

// ---------- globals bar ----------
function bindGlobals() {
  const nch = $('#g-nch'), df = $('#g-df'), la = $('#g-launch');
  nch.value = S.g.nch; df.value = S.g.df; la.value = S.g.launch;
  $('#labsum').textContent = `Line settings · ${S.g.nch} ch · ${S.g.df} GHz · ${S.g.launch > 0 ? '+' : ''}${S.g.launch} dBm`;
  $('#g-nch-v').textContent = S.g.nch; $('#g-launch-v').textContent = (S.g.launch > 0 ? '+' : '') + S.g.launch;
}
$('#g-nch').addEventListener('input', e => { if (S.g.plan) { S.g.plan = null; toast('Channel plan reset to a uniform line'); } S.g.nch = +e.target.value; $('#g-nch-v').textContent = S.g.nch; renderAll(); });
$('#g-df').addEventListener('change', e => { const old = +S.g.df; S.g.df = +e.target.value; if (S.g.plan) { S.g.plan = MODEL.remapPlan(S.g.plan, old, S.g.df); if (S.g.plan) S.g.nch = S.g.plan.length; } renderAll(); });
$('#g-launch').addEventListener('input', e => { S.g.launch = +e.target.value; $('#g-launch-v').textContent = (S.g.launch > 0 ? '+' : '') + S.g.launch; recompute(); });
$('#preset').addEventListener('change', e => { if (e.target.value) applyPreset(e.target.value); else syncLab(); });
$('#btn-fit').addEventListener('click', () => { fitView(); applyView(); });
{ const pd = $('#paldet'), ls = $('#labset'), sync = () => { pd.open = !narrow.matches; ls.open = !narrow.matches; }; sync(); narrow.addEventListener('change', sync); $('#statusbar').addEventListener('click', () => $('#results').scrollIntoView({ block: 'start' })); } // the palette is one tap away on a phone, open on a wide screen
$('#btn-undo').addEventListener('click', undo); $('#btn-redo').addEventListener('click', redo);
$('#btn-clear').addEventListener('click', () => {
  const b = $('#btn-clear');
  if (b.dataset.armed) { S.nodes = []; S.links = []; S.svc = { a: null, z: null }; sel = null; delete b.dataset.armed; b.textContent = 'Clear canvas'; checkpoint(); renderAll(); toast('Cleared the canvas', { label: 'Undo', fn: undo }); }
  else { b.dataset.armed = '1'; b.textContent = 'Click again to clear'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Clear canvas'; }, 2500); }
});
$('#btn-export').addEventListener('click', () => { $('#io').hidden = false; $('#io-text').value = JSON.stringify({ nodes: S.nodes, links: S.links, g: S.g, svc: S.svc }, null, 1); });
$('#io-close').addEventListener('click', () => { $('#io').hidden = true; });
$('#io-copy').addEventListener('click', () => { const t = $('#io-text'); navigator.clipboard?.writeText(t.value).then(() => toast('Copied topology JSON'), () => { t.select(); toast('Select-all done; press Ctrl/Cmd+C'); }) ?? t.select(); });
$('#io-load').addEventListener('click', () => {
  try { const o = MODEL.sanitize(JSON.parse($('#io-text').value)); S = { ...S, ...o }; labKey = ''; sel = null; $('#io').hidden = true; fitView(true); checkpoint(); renderAll(); toast('Topology loaded', { label: 'Undo', fn: undo }); }
  catch (e) { toast('That text is not a topology export. Paste the JSON from Export.'); }
});

const csvMode = $('#csv-mode');
Object.entries(PHY.MODES).forEach(([k, m]) => csvMode.append(el('option', { value: k, text: m.short })));
csvMode.value = 'zrp400';
$('#csv-build').addEventListener('click', () => {
  const r = MODEL.fromSpans($('#csv-text').value, csvMode.value);
  if (!r.topo) return toast(r.errors[0]);
  S = { ...S, ...MODEL.sanitize(r.topo) }; labKey = ''; sel = null; $('#io').hidden = true; fitView(true); checkpoint(); renderAll();
  toast(`Built ${r.spans.length} span${r.spans.length === 1 ? '' : 's'}` + (r.errors.length ? `. ${r.errors.length} row${r.errors.length === 1 ? '' : 's'} skipped: ${r.errors[0]}` : ''));
});

// ---------- results ----------
const STATUS = { up: 'UP', degraded: 'DEGRADED', down: 'DOWN', los: 'LOS', none: '—', nopath: 'NO PATH', blocked: 'BLOCKED', standby: 'STANDBY' };
let tab = 'power';
function tile(label, val, unit, topic, cls = '') {
  return el('button', { class: 'kpi ' + cls, onclick: () => learn(topic), title: 'Explain ' + label }, [el('span', { class: 'kl', text: label }), el('span', { class: 'kv' }, [document.createTextNode(val), el('small', { text: unit })])]);
}
// A remedy offered by an alarm: plain data from the model (splice a cable, set a device back to Working, clean a patch panel port)
function applyFix(f) {
  if (!f) return;
  let what = '';
  if (f.type === 'splice') { const l = link(f.id); if (l) { l.p.cut = false; what = 'Spliced the fiber back'; } }
  else if (f.type === 'work') { const n = node(f.id); if (n) { n.p.fail = ''; what = `${n.name} is working again`; } }
  else if (f.type === 'clean') { const n = node(f.id); if (n && n.p.dirty) { delete n.p.dirty[f.port]; what = `Cleaned ${n.name} port ${f.port}`; } }
  if (!what) return;
  checkpoint(); renderAll(); toast(what, { label: 'Undo', fn: undo });
}
const sameFix = (a, b) => !!a && !!b && a.type === b.type && a.id === b.id && a.port === b.port;
function renderAlarms(r) {
  const al = $('#alarms'); al.innerHTML = '';
  const hf = lastRes.headlineFix, hb = $('#headfix');
  hb.hidden = !hf; if (hf) { hb.textContent = hf.label; hb.onclick = () => applyFix(hf); }
  // the headline already says the first problem in full: do not repeat it in the list; a remedy shows once, next to the headline or on its own alarm
  (r.alarms || []).filter(a => !(lastRes.headline && lastRes.headline.includes(a.text))).slice(0, 6).forEach(a => {
    const li = el('li', { class: 'al-' + a.sev }, [a.text]);
    if (a.fix && !sameFix(a.fix, hf)) li.append(el('button', { class: 'btn alfix', text: a.fix.label, onclick: () => applyFix(a.fix) }));
    al.append(li);
  });
}
function renderResults() {
  const box = $('#results');
  const sw = $('#dirsw'); sw.innerHTML = '';
  sw.hidden = !(lastRes && lastRes.rev && lastRes.rev.mode);
  if (sw.hidden) dir = 'fwd';
  if (!sw.hidden) {
    [['fwd', lastRes.A, lastRes.Z], ['rev', lastRes.Z, lastRes.A]].forEach(([k, a, z]) => sw.append(el('button', { class: 'chip', 'aria-pressed': dir === k, text: `${a.name} → ${z.name}`, title: 'Show this direction in the results', onclick: () => { dir = k; renderCanvas(); renderResults(); } })));
  }
  const r = view();
  // service selectors
  const trx = S.nodes.filter(isEnd);
  for (const [id, key] of [['#svc-a', 'a'], ['#svc-z', 'z']]) {
    const s = $(id); s.innerHTML = ''; s.append(el('option', { value: '', text: '— pick —' }));
    trx.forEach(n => s.append(el('option', { value: n.id, text: n.name })));
    s.value = node(S.svc[key]) ? S.svc[key] : '';
  }
  $('#status').className = 'status s-' + lastRes.status; $('#status').textContent = STATUS[lastRes.status];
  $('#headline').textContent = lastRes.headline;
  $('#sb-status').className = 'status s-' + lastRes.status; $('#sb-status').textContent = STATUS[lastRes.status]; $('#sb-text').textContent = lastRes.headline;
  { const msg = `${STATUS[lastRes.status]}. ${lastRes.headline}`; if (msg !== srLast) { srLast = msg; $('#sr-live').textContent = msg; } } // announced only when it changes
  const k = $('#kpis'); k.innerHTML = ''; $('#diag').innerHTML = '';
  if (!r.mode) { $('#tabbody').innerHTML = ''; renderAlarms(r); renderTabBody(); return; }
  const m = r.mode;
  const prxCls = !isFinite(r.prx) ? 'bad' : r.prx < m.rxMin || r.prx > m.rxMax ? 'warn' : '';
  // The numbers come in three short groups: the margins (the verdict, led by Q margin), the signal that reaches the receiver, and the line it crossed
  const kg = t => el('span', { class: 'kgroup', text: t }), sg = v => (v > 0 ? '+' : '') + f1(v), lvl = (v, warnBelow) => (v < 0 ? 'bad' : v < warnBelow ? 'warn' : '');
  if (r.ber != null) {
    k.append(kg('Margins'), tile('Q margin', sg(r.qMargin), ' dB', 'margin', (r.qMargin < 0 || lastRes.status === 'down' || lastRes.status === 'los' ? 'bad' : r.qMargin < 1 || lastRes.status === 'degraded' ? 'warn' : 'good') + ' lead core'),
      tile('OSNR margin', sg(r.osnrMargin), ' dB', 'margin', lvl(r.osnrMargin, 2)), tile('Q margin, end of life', sg(r.eol.qMargin), ' dB', 'aging', lvl(r.eol.qMargin, 1)),
      tile(r.worstChannelQ != null ? 'Q margin, worst channel' : 'Q margin, worst slot', sg(r.worstChannelQ ?? r.worstQMargin), ' dB', 'srs', lvl(r.worstChannelQ ?? r.worstQMargin, 1)));
  }
  k.append(kg('Signal'), tile('Rx power', isFinite(r.prx) ? f1(r.prx) : 'LOS', isFinite(r.prx) ? ' dBm' : '', 'rx', prxCls + ' core'));
  if (r.ber != null) {
    k.append(tile('OSNR', f1(r.osnr), ' dB', 'osnr', 'core'), tile('GSNR (w/ NLI)', f1(r.gosnr), ' dB', 'gsnr', 'core'), tile('Q-factor', f1(r.q), ' dB', 'q'),
      tile('Pre-FEC BER', r.ber < 1e-15 ? '<1e-15' : r.ber.toExponential(1), '', 'ber', r.ber > m.berThr ? 'bad' : ''),
      kg('Line'), tile('Distance', Math.round(r.km), ' km', 'span', 'core'), tile('CD', Math.round(r.cd).toLocaleString(), ' ps/nm', 'cd', Math.abs(r.cd) > m.cdTol ? 'bad' : ''), tile('Mean DGD', f1(r.dgd), ' ps', 'pmd'),
      tile('SRS tilt (peak)', f1(r.tilt), ' dB', 'srs'), ...(m.coh === false ? [tile('XPM penalty', f1(r.xpmPen), ' dB', 'xpm', r.xpmPen > 1.5 ? 'warn' : '')] : []));
  }
  if (r.ber != null) k.append(el('button', { class: 'btn quiet morekpi', text: kpiAll ? 'Fewer readings' : 'More readings', 'aria-expanded': kpiAll ? 'true' : 'false', onclick: () => { kpiAll = !kpiAll; renderResults(); } })); // the first five readings are the verdict; the rest (margins, signal, line, and the noise breakdown) open with this
  k.classList.toggle('all', kpiAll);
  renderAlarms(r);
  if (r.ber != null) $('#diag').append(el('div', {}, [diagnose(r)]));
  renderTabBody();
}
function diagnose(r) {
  const b = r.budget, tot = b.ase + b.nli + b.trx + b.rx + (b.mpi || 0);
  const parts = [['ase', 'ASE (amplifier noise)', b.ase], ['nli', 'Fiber nonlinearity', b.nli], ['trx', 'Transceiver limit', b.trx], ['rx', 'Receiver noise', b.rx], ...(b.mpi > 0 ? [['mpi', 'Raman double Rayleigh', b.mpi]] : [])];
  const wrap = el('div', { class: 'budget' });
  const bar = el('div', { class: 'bbar', role: 'img', 'aria-label': 'Noise budget' });
  parts.forEach(([k, n, v]) => { if (v / tot > 0.005) bar.append(el('span', { class: 'b-' + k, style: `width:${(v / tot * 100).toFixed(1)}%`, title: `${n}: ${(v / tot * 100).toFixed(0)}%` })); });
  const leg = el('div', { class: 'blegend' }); parts.forEach(([k, n, v]) => leg.append(el('span', {}, [el('i', { class: 'b-' + k }), `${n} ${(v / tot * 100).toFixed(0)}%`])));
  const top = parts.slice().sort((x, y) => y[2] - x[2])[0][0];
  const tips = {
    ase: b.nli < b.ase / 2 ? 'Noise is mostly ASE and nonlinearity is small, so raising launch power (or cutting span loss / NF) buys SNR.' : 'ASE leads, but nonlinearity is close. You are near the optimum launch power.',
    nli: 'Nonlinearity dominates: you are launching too hot. Lowering launch power will improve GSNR until ASE takes over.',
    trx: 'Noise from the line is small. The transceiver itself is the limit, so changing launch power or amplifiers will not help much.' + (lastRes && lastRes.alarms && lastRes.alarms.some(x => x.sev !== 'info') ? ' The warnings are about power and loss, not noise: they are not in this bar.' : ''),
    rx: 'Too little light reaches the receiver. Add or re-target an amplifier before the Rx, or remove a pad.',
    mpi: 'Double Rayleigh scattering from the Raman pump dominates. Lower the pump power (it grows with the square of the gain) or split the gain with an EDFA.',
  };
  const pen = r.filt + r.over + r.pmdPen;
  wrap.append(el('b', { text: 'What is eating the SNR' }), bar, leg, el('span', { text: tips[top] + (pen > 0.3 ? ` Plus ${f1(pen)} dB of penalties (${[r.filt > 0.05 ? `filtering ${f1(r.filt)}` : '', r.over > 0 ? `Rx overload ${f1(r.over)}` : '', r.pmdPen > 0.05 ? `PMD ${f1(r.pmdPen)}` : ''].filter(Boolean).join(', ')}).` : '') }));
  return wrap;
}
// bring a tab into view by moving the strip sideways only: scrollIntoView would also scroll the page (and a render must never move the page)
const revealTab = t => { const c = $('#tabs'); if (c.scrollWidth > c.clientWidth) c.scrollLeft = t.offsetLeft - (c.clientWidth - t.offsetWidth) / 2; };
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { tab = t.dataset.tab; renderTabBody(); revealTab(t); }));
$('#tabs').addEventListener('keydown', e => { // arrow keys move between tabs (only the selected one is a Tab stop)
  const all = [...document.querySelectorAll('.tab')], i = all.findIndex(t => t.dataset.tab === tab);
  const j = e.key === 'ArrowRight' ? (i + 1) % all.length : e.key === 'ArrowLeft' ? (i + all.length - 1) % all.length : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : -1;
  if (j < 0) return; e.preventDefault(); tab = all[j].dataset.tab; renderTabBody(); all[j].focus({ preventScroll: true }); revealTab(all[j]);
});
$('#svc-a').addEventListener('change', e => { S.svc.a = e.target.value || null; renderAll(); });
$('#svc-z').addEventListener('change', e => { S.svc.z = e.target.value || null; renderAll(); });
$('#svc-swap').addEventListener('click', () => { [S.svc.a, S.svc.z] = [S.svc.z, S.svc.a]; renderAll(); });

function renderTabBody() {
  document.querySelectorAll('.tab').forEach(t => { const on = t.dataset.tab === tab; t.setAttribute('aria-selected', on); t.id = 'tab-' + t.dataset.tab; t.setAttribute('aria-controls', 'tabbody'); t.tabIndex = on ? 0 : -1; });
  const b = $('#tabbody'); b.innerHTML = ''; b.setAttribute('role', 'tabpanel'); b.setAttribute('aria-labelledby', 'tab-' + tab);
  const r = view();
  if (tab === 'learn') return b.append(learnView());
  if (tab === 'plan') return b.append(planView(r));
  if (tab === 'resil') return b.append(resilView());
  if (tab === 'planner') return b.append(plannerView());
  if (tab === 'reach') return b.append(reachView());
  if (tab === 'otdr') return b.append(otdrView());
  if (!r || !r.hops) return b.append(el('p', { class: 'muted pad', text: r ? r.headline : '' }));
  if (tab === 'power') b.append(powerChart(r));
  else if (tab === 'hops') b.append(hopTable(r));
  else if (tab === 'clients') b.append(clientsView(r));
  else if (tab === 'spectrum') b.append(spectrumView(r));
  else if (tab === 'const') b.append(constView(r));
  else if (tab === 'sweep') b.append(sweepChart(r));
  else if (tab === 'trans') b.append(transView(r));
  else if (tab === 'raman') b.append(ramanView(r));
}

// demand-driven planner: a traffic list in, routes and slots out, with blocking
let plannerOpts = { minMargin: 1, K: 6, order: 'given' };
function plannerView() {
  S.demands ??= [];
  const wrap = el('div', { class: 'planwrap pad' }), nodes = S.nodes.filter(n => n.type === 'roadm' || isEnd(n)), modes = Object.entries(PHY.MODES).map(([k, m]) => [k, m.short]);
  if (nodes.length < 2) return el('p', { class: 'muted pad', text: 'Add at least two ROADMs or transponders to plan traffic between them.' });
  const redo = () => { renderTabBody(); save(); };
  const optRow = el('div', { class: 'planbar' }, []);
  const kSel = el('select', { 'aria-label': 'Alternative routes' }); [[1, 'Shortest route only'], [2, 'Up to 2 routes'], [4, 'Up to 4 routes'], [6, 'Up to 6 routes']].forEach(([v, t]) => kSel.append(el('option', { value: v, text: t }))); kSel.value = plannerOpts.K; kSel.addEventListener('change', () => { plannerOpts.K = +kSel.value; redo(); });
  const oSel = el('select', { 'aria-label': 'Order' }); [['given', 'In the order listed'], ['longest', 'Longest routes first']].forEach(([v, t]) => oSel.append(el('option', { value: v, text: t }))); oSel.value = plannerOpts.order; oSel.addEventListener('change', () => { plannerOpts.order = oSel.value; redo(); });
  const mm = el('input', { type: 'number', step: 0.5, min: -5, max: 10, value: plannerOpts.minMargin, 'aria-label': 'Minimum margin (dB)', class: 'slotin' }); mm.addEventListener('change', () => { if (isFinite(+mm.value)) { plannerOpts.minMargin = +mm.value; redo(); } });
  optRow.append(el('b', { text: 'Traffic' }), kSel, oSel, el('span', { class: 'muted small', text: 'Minimum Q margin' }), mm, el('span', { class: 'muted small', text: 'dB' }));
  const tbl = el('table', { class: 'tbl' }), th = el('tr'); ['From', 'To', 'Mode', 'Channels', ''].forEach(h => th.append(el('th', { text: h })));
  tbl.append(el('thead', {}, [th]));
  const tb = el('tbody');
  const nodeSel = (d, key) => { const s = el('select', { 'aria-label': key === 'a' ? 'From' : 'To' }); nodes.forEach(n => s.append(el('option', { value: n.id, text: n.name }))); s.value = d[key]; s.addEventListener('change', () => { d[key] = s.value; if (d.a === d.z) d[key === 'a' ? 'z' : 'a'] = nodes.find(n => n.id !== d[key]).id; redo(); }); return s; };
  S.demands.forEach(d => {
    const ms = el('select', { 'aria-label': 'Mode' }); modes.forEach(([k, t]) => ms.append(el('option', { value: k, text: t }))); ms.value = d.mode; ms.addEventListener('change', () => { d.mode = ms.value; redo(); });
    const cnt = el('input', { type: 'number', step: 1, min: 1, max: 96, value: d.count, class: 'slotin', 'aria-label': 'Channels' }); cnt.addEventListener('change', () => { d.count = Math.max(1, Math.min(96, Math.round(+cnt.value) || 1)); redo(); });
    tb.append(el('tr', {}, [nodeSel(d, 'a'), nodeSel(d, 'z'), ms, cnt, el('button', { class: 'btn', text: '×', title: 'Remove', 'aria-label': `Remove the demand from ${(node(d.a) || {}).name || 'A'} to ${(node(d.z) || {}).name || 'Z'}`, onclick: () => { S.demands.splice(S.demands.indexOf(d), 1); redo(); } })].map(x => el('td', {}, [x]))));
  });
  tbl.append(tb);
  const addBtn = el('button', { class: 'btn', text: 'Add demand', onclick: () => { S.demands.push({ a: nodes[0].id, z: nodes[1].id, mode: nodes.find(n => isEnd(n)) ? nodes.find(n => isEnd(n)).p.mode : 'zrp400', count: 4 }); redo(); } });
  const meshBtn = el('button', { class: 'btn', text: 'Every pair of ROADMs × 4', title: 'Replace the list with 4 channels between each pair of ROADMs', onclick: () => { const rs = S.nodes.filter(n => n.type === 'roadm'); const mode = (S.nodes.find(isEnd) || { p: { mode: 'zrp400' } }).p.mode; S.demands = []; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) S.demands.push({ a: rs[i].id, z: rs[j].id, mode, count: 4 }); redo(); } });
  wrap.append(optRow, el('div', { style: 'overflow:auto;max-height:240px' }, [tbl]), el('div', { class: 'planbar' }, [addBtn, meshBtn]));
  if (!S.demands.length) return (wrap.append(el('p', { class: 'muted', text: 'List the traffic you want to carry: who talks to whom, at what rate, how many channels. The planner routes each channel (shortest route first, then detours through other ROADMs when a fiber is full or too long), gives it the first free slot, checks the estimated margin and reports what is blocked.' })), wrap);
  const r = MODEL.planDemands(S, S.demands, { minMargin: plannerOpts.minMargin, K: plannerOpts.K, order: plannerOpts.order }), st = r.stats;
  wrap.append(el('p', { html: `<b>${st.placed}</b> of ${st.demands} placed, <b class="${st.blocked ? 'st-down' : 'st-up'}">${st.blocked}</b> blocked (${(100 * st.blocking).toFixed(1)}%), ${st.unreachable ? `<b class="st-degraded">${st.unreachable}</b> out of reach, ` : ''}${st.slotsUsed} of ${st.slots} slots used, busiest fiber ${(100 * st.maxUtil).toFixed(0)}% full.` }));
  wrap.append(el('div', { class: 'planbar' }, [el('button', { class: 'btn primary', text: 'Apply to the bench', title: 'Replace the channel plan with the service plus these channels; the Channels tab then shows the full simulation', onclick: () => {
    const svc = (S.g.plan && S.g.plan.find(c => c.svc)) || { slot: st.svcSlot, mode: (node(S.svc.a) || { p: { mode: 'zrp400' } }).p.mode, off: 0, svc: true, from: '', to: '', via: '', conv: '', slot2: st.svcSlot, prot: '' };
    S.g.plan = MODEL.sanitizePlan([{ ...svc, slot: st.svcSlot }, ...r.entries], +S.g.df); S.g.nch = S.g.plan.length; tab = 'plan'; renderAll(); toast(`${r.entries.length} channels added to the plan`); } })]));
  const rt = el('table', { class: 'tbl' }), rth = el('tr'); ['', 'Demand', 'Status', 'Slot', 'Route', 'km', 'Est. margin'].forEach(h => rth.append(el('th', { text: h })));
  rt.append(el('thead', {}, [rth]));
  const rb = el('tbody'), nm = id => (node(id) || {}).name;
  r.results.forEach((x, i) => rb.append(el('tr', {}, [i + 1, `${nm(x.a)} → ${nm(x.z)} (${PHY.MODES[x.mode].short})`, el('span', { class: x.status === 'placed' ? (x.detour ? 'st-degraded' : 'st-up') : 'st-down', text: x.status === 'placed' ? (x.detour ? 'PLACED, DETOUR' : 'PLACED') : x.status.toUpperCase() }), x.slot != null ? x.slot + 1 : '', x.route ? x.route.join(' → ') : '', x.km != null ? Math.round(x.km) : '', x.margin != null ? f1(x.margin) : ''].map(v => (v instanceof Node ? el('td', {}, [v]) : el('td', { text: String(v) }))))));
  rt.append(rb);
  wrap.append(el('div', { style: 'overflow:auto;max-height:300px' }, [rt]));
  // blocking against offered load, with and without detours
  const loadsList = [10, 20, 40, 60, 80, 100, 140, 180], md = S.demands[0].mode;
  const c1 = MODEL.blockingCurve(S, md, loadsList, 8, 3, { K: 1, minMargin: plannerOpts.minMargin }), cK = MODEL.blockingCurve(S, md, loadsList, 8, 3, { K: Math.max(2, plannerOpts.K), minMargin: plannerOpts.minMargin });
  if (c1.length) {
    const W = 900, H = 240, ml = 46, mr = 16, mt = 16, mb = 40, lo = loadsList[0], hi = loadsList[loadsList.length - 1], ymax = Math.max(10, Math.ceil(Math.max(...c1.map(p => p.p), ...cK.map(p => p.p)) * 10) * 10);
    const X = v => ml + (v - lo) / (hi - lo) * (W - ml - mr), Y = v => mt + (1 - v / ymax) * (H - mt - mb);
    const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Blocking probability versus offered channels' });
    for (let v = 0; v <= ymax + 1e-9; v += ymax / 5) { s.append(sv("line", { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), class: "grid" })); const t = sv('text', { x: ml - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = Math.round(v) + '%'; s.append(t); }
    loadsList.forEach(n => { const t = sv('text', { x: X(n), y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); t.textContent = n; s.append(t); });
    const xl = sv('text', { x: (ml + W - mr) / 2, y: H - 6, class: 'ax', 'text-anchor': 'middle' }); xl.textContent = 'Channels offered (random pairs of ROADMs)'; s.append(xl);
    s.append(sv('path', { d: c1.map((p, i) => `${i ? 'L' : 'M'}${X(p.n)},${Y(p.p * 100)}`).join(' '), class: 'pl l-ase dashed' }));
    s.append(sv('path', { d: cK.map((p, i) => `${i ? 'L' : 'M'}${X(p.n)},${Y(p.p * 100)}`).join(' '), class: 'pl l-sig' }));
    wrap.append(el('h3', { text: 'Blocking against load' }), s, el('div', { class: 'legend' }, [lg('l-ase dashed', 'Shortest route only'), lg('l-sig', `Up to ${Math.max(2, plannerOpts.K)} routes`), el('span', { class: 'muted', text: 'Random traffic between ROADM pairs on this network, first-fit slots, averaged over 8 draws. The service keeps its slot. Detours let the network carry more before it blocks, at the price of longer routes with less margin.' })]));
  }
  return wrap;
}

// Raman spans: power along the fiber and the gain spectrum, from the coupled-wave solver
function ramanView(r) {
  const wrap = el('div', { class: 'planwrap pad' }), views = r.raman || [];
  if (!views.length) return el('p', { class: 'muted pad', text: r.reverse ? 'Raman profiles are shown for the forward direction.' : 'No fiber span on the service path has a Raman pump. Set a pump power in the cable inspector, then switch the Raman model to the coupled-wave solver to see the profile of every pump and channel along the fiber.' });
  for (const v of views) {
    const W = 900, H = 230, ml = 50, mr = 16, mt = 14, mb = 36, dbm = w => 10 * Math.log10(Math.max(w, 1e-12) * 1000), zs = v.profile.z, L = zs[zs.length - 1];
    const pick = [0, Math.floor((v.samples.length - 1) / 2), v.samples.length - 1].filter((x, i, a) => a.indexOf(x) === i);
    const series = [...pick.map(i => ({ y: v.profile.sig[i].map(dbm), cls: 'l-sig', name: `${v.samples[i].toFixed(1)} THz` })), ...pick.map(i => ({ y: v.profile.off[i].map(dbm), cls: 'l-ase dashed', name: 'without pump' })).slice(0, 1), ...v.profile.pump.map((p, j) => ({ y: p.map(dbm), cls: 'l-nli', name: `pump ${v.pumps[j].fTHz.toFixed(1)} THz ${v.pumps[j].dir === 'fwd' ? '→' : '←'}` }))];
    const all = series.flatMap(s => s.y), ymax = Math.ceil((Math.max(...all) + 1) / 5) * 5, ymin = Math.floor((Math.min(...all) - 1) / 5) * 5, X = x => ml + x / L * (W - ml - mr), Y = y => mt + (ymax - y) / (ymax - ymin) * (H - mt - mb);
    const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Power along the Raman span' });
    for (let y = ymin; y <= ymax; y += 5) { s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(y), y2: Y(y), class: 'grid' })); const t = sv('text', { x: ml - 6, y: Y(y) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = y; s.append(t); }
    for (let x = 0; x <= L + 1e-9; x += L / 4) { const t = sv('text', { x: X(x), y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); t.textContent = Math.round(x) + ' km'; s.append(t); }
    series.forEach(sr => s.append(sv('path', { d: sr.y.map((y, i) => `${i ? 'L' : 'M'}${X(zs[i])},${Y(y)}`).join(' '), class: 'pl ' + sr.cls })));
    const yl = sv('text', { x: 12, y: mt + (H - mt - mb) / 2, class: 'ax', transform: `rotate(-90 12 ${mt + (H - mt - mb) / 2})`, 'text-anchor': 'middle' }); yl.textContent = 'dBm'; s.append(yl);
    // gain spectrum
    const GH = 170, gmax = Math.ceil(Math.max(...v.gainDb) + 1), gmin = Math.max(0, Math.floor(Math.min(...v.gainDb) - 1)), fl = v.samples[0], fh = v.samples[v.samples.length - 1], fspan = Math.max(0.5, fh - fl);
    const GX = f => ml + (f - fl) / fspan * (W - ml - mr), GY = g => 14 + (gmax - g) / Math.max(1, gmax - gmin) * (GH - 14 - 34);
    const g = sv('svg', { viewBox: `0 0 ${W} ${GH}`, class: 'chart', role: 'img', 'aria-label': 'Raman gain spectrum' });
    for (let y = gmin; y <= gmax; y++) { g.append(sv('line', { x1: ml, x2: W - mr, y1: GY(y), y2: GY(y), class: 'grid' })); const t = sv('text', { x: ml - 6, y: GY(y) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = y; g.append(t); }
    v.samples.forEach(f => { const t = sv('text', { x: GX(f), y: GH - 18, class: 'ax', 'text-anchor': 'middle' }); t.textContent = f.toFixed(1); g.append(t); });
    g.append(sv('path', { d: v.gainDb.map((y, i) => `${i ? 'L' : 'M'}${GX(v.samples[i])},${GY(y)}`).join(' '), class: 'pl l-sig' }));
    if (v.approxDb != null) g.append(sv('circle', { cx: GX(v.svcTHz), cy: GY(v.approxDb), r: 5, class: 'dot-best' }));
    const gl = sv('text', { x: (ml + W - mr) / 2, y: GH - 2, class: 'ax', 'text-anchor': 'middle' }); gl.textContent = 'Channel frequency (THz): on-off gain (dB)'; g.append(gl);
    wrap.append(el('h3', { text: `${v.name} · ${Math.round(v.km)} km · ${v.pumps.map(p => `${p.fTHz.toFixed(1)} THz ${p.mW.toFixed(0)} mW ${p.dir === 'fwd' ? 'forward' : 'backward'}`).join(', ')}` }),
      el('p', { class: 'small', html: `${v.solver ? '<b>Coupled-wave solver</b> in use for this fiber.' : 'This fiber uses the <b>closed-form approximation</b> (the solver is shown for comparison; switch it on in the cable inspector).'} Gain at the service channel <b>${f1(v.gainSvcDb)} dB</b>${v.approxDb != null ? `, approximation <b>${f1(v.approxDb)} dB</b> (dot)` : ''}, gain spectrum spread <b>${f1(v.ripple)} dB</b>, pump depletion by the signals <b>${Math.round(100 * v.depletion)}%</b>.` }), s,
      el('div', { class: 'legend' }, [lg('l-sig', 'Channels (lowest, middle, highest frequency)'), lg('l-ase dashed', 'The same channel without the pump'), lg('l-nli', 'Pumps (→ forward, ← backward)')]), el('h3', { text: 'Gain spectrum' }), g);
  }
  return wrap;
}

// expected outages from the planned routes
function fmtDur(s) { return s < 1 ? `${(s * 1000).toFixed(s < 0.1 ? 1 : 0)} ms` : s < 120 ? `${s.toFixed(1)} s` : s < 7200 ? `${(s / 60).toFixed(1)} min` : `${(s / 3600).toFixed(1)} h`; }
function resilView() {
  const wrap = el('div', { class: 'planwrap pad' }), rs = MODEL.resilience(S), plan = MODEL.effective(S).g.plan;
  const tbl = el('table', { class: 'tbl' }), th = el('tr'); ['Channel', 'Protection', 'Route km', 'Protect km', 'Cuts / yr', 'Outage per cut', 'Downtime / yr', 'Availability'].forEach(h => th.append(el('th', { text: h })));
  tbl.append(el('thead', {}, [th]));
  const tb = el('tbody');
  rs.forEach((x, i) => {
    const c = plan ? plan[i] : null, name = c ? `Slot ${c.slot + 1}${c.conv ? ' → ' + (c.slot2 + 1) : ''}${c.svc ? ' (service)' : ''}` : 'Service';
    const nines = x.availability > 0 && x.availability < 1 ? -Math.log10(1 - x.availability) : x.availability >= 1 ? Infinity : 0;
    tb.append(el('tr', { class: x.svc ? 'selrow' : '', title: x.note || '' }, [name, x.kind, x.km ? Math.round(x.km) : '', x.protKm ? Math.round(x.protKm) : '', x.failures ? x.failures.toFixed(2) : '', x.kind === 'no route' ? '' : fmtDur(x.outageSec), fmtDur(x.downSec),
      `${(100 * x.availability).toFixed(x.availability > 0.99999 ? 6 : 4)} % (${isFinite(nines) ? nines.toFixed(1) : '∞'} nines)`].map(v => el('td', { text: String(v) }))));
  });
  tbl.append(tb);
  wrap.append(el('div', { style: 'overflow:auto;max-height:460px' }, [tbl]), el('p', { class: 'muted small', text: 'Expected values from the planned routes on the intact network, not a simulation of events. Unprotected channels restore over another route if one exists (restoration time) and otherwise wait for the repair. 1+1 costs loss detection plus switch time per cut on the working route; shared protection adds the turn-up of the dark route. Both add the small chance that both routes are down at the same time. Cut rate, repair, detection, switch and restoration times are in the inspector (nothing selected).' }));
  return wrap;
}
// Rx power of a surviving channel against time after the event: the surge when channels vanish, the dip when they come back
function traceChart(r) {
  const tr = r.transientTrace, t = r.transient; if (!tr) return el('span');
  const W = 900, H = 240, ml = 52, mr = 16, mt = 16, mb = 40, tEnd = tr.t[tr.t.length - 1], mode = r.mode;
  const up = tr.surge.map(v => r.prx + v), dn = tr.dip.map(v => r.prx + v * 1);
  const lo = Math.min(...dn, mode.rxMin) - 2, hi = Math.max(...up, mode.rxMax) + 2;
  const X = v => ml + v / tEnd * (W - ml - mr), Y = v => mt + (hi - v) / (hi - lo) * (H - mt - mb);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Receiver power against time after the event' });
  const step = Math.max(1, Math.round((hi - lo) / 6));
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), class: 'grid' })); const x = sv('text', { x: ml - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end' }); x.textContent = v; s.append(x); }
  const tick = Math.pow(10, Math.floor(Math.log10(tEnd / 4))) * (tEnd / 4 / Math.pow(10, Math.floor(Math.log10(tEnd / 4))) > 5 ? 5 : tEnd / 4 / Math.pow(10, Math.floor(Math.log10(tEnd / 4))) > 2 ? 2 : 1);
  for (let v = 0; v <= tEnd; v += tick) { const x = sv('text', { x: X(v), y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); x.textContent = v >= 1000 ? (v / 1000) + ' ms' : v + ' µs'; s.append(x); }
  s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(mode.rxMax), y2: Y(mode.rxMax), class: 'pl l-ase dashed' }), sv('line', { x1: ml, x2: W - mr, y1: Y(mode.rxMin), y2: Y(mode.rxMin), class: 'pl l-ase dashed' }), sv('line', { x1: ml, x2: W - mr, y1: Y(r.prx), y2: Y(r.prx), class: 'nowline' }));
  const lab = (y, txt) => { const x = sv('text', { x: W - mr - 4, y: Y(y) - 4, class: 'ax bad', 'text-anchor': 'end' }); x.textContent = txt; s.append(x); };
  lab(mode.rxMax, `overload ${mode.rxMax} dBm`); lab(mode.rxMin, `sensitivity ${mode.rxMin} dBm`);
  s.append(sv('path', { d: tr.t.map((v, i) => `${i ? 'L' : 'M'}${X(v)},${Y(up[i])}`).join(' '), class: 'pl l-sig' }), sv('path', { d: tr.t.map((v, i) => `${i ? 'L' : 'M'}${X(v)},${Y(dn[i])}`).join(' '), class: 'pl l-nli' }));
  const xl = sv('text', { x: (ml + W - mr) / 2, y: H - 6, class: 'ax', 'text-anchor': 'middle' }); xl.textContent = 'Time after the event'; s.append(xl);
  return el('div', { class: 'chartwrap' }, [el('h3', { text: 'Receiver power through the event' }), s, el('div', { class: 'legend' }, [lg('l-sig', `Channels vanish: peak +${f1(tr.peakDb)} dB`), lg('l-nli', `Channels return${t.rampF < 1 ? ` over ${tr.rampMs} ms` : ' at once'}: dip −${f1(-Math.min(...tr.dip))} dB`), el('span', { class: 'muted', text: 'A surviving channel at the receiver. All amplifiers\' excursions line up in time (the event travels with the signal) and add; each is pulled back once its control loop engages.' })])]);
}
// what happens to the surviving channels when many vanish at once
function transView(r) {
  const wrap = el('div', { class: 'planwrap pad' }), t = r.transient;
  if (!t) return el('p', { class: 'muted pad', text: 'Needs at least two channels on an amplifier: with a single channel there is nothing that can surge.' });
  const tbl = el('table', { class: 'tbl' }), th = el('tr'); ['Amplifier', 'Channels', 'Lost', 'Surge if uncontrolled', 'Control µs', 'Lets through', 'Accumulated', ''].forEach(h => th.append(el('th', { text: h })));
  tbl.append(el('thead', {}, [th]));
  const tb = el('tbody'), top = Math.max(0.1, t.surgeDb);
  for (const x of t.rows) tb.append(el('tr', {}, [x.name, x.n, x.lost, `${f1(x.rawDb)} dB`, x.agcUs, `${f1(x.peakDb)} dB`, `${f1(x.cumDb)} dB`, el('span', { class: 'transbar', style: `width:${Math.max(2, 100 * x.cumDb / top)}%` })].map(v => (v instanceof Node ? el('td', { class: 'barcell' }, [v]) : el('td', { text: String(v) })))));
  tbl.append(tb);
  const mode = r.mode, ok = v => (v >= 0 ? 'st-up' : 'st-down');
  wrap.append(el('p', { text: `Losing ${t.lossPct}% of the channels at once (an upstream cut, a protection switch) lifts the surviving channels by up to ${f1(t.surgeDb)} dB by the receiver.` }),
    el('div', { style: 'overflow:auto;max-height:340px' }, [tbl]),
    el('div', { class: 'transsum' }, [
      el('span', {}, ['Rx power at the surge: ', el('b', { class: t.overload ? 'st-down' : 'st-up', text: `${f1(t.prxSurge)} dBm` }), ` (overload at ${mode.rxMax} dBm)`]),
      el('span', {}, ['Q margin during the surge: ', el('b', { class: ok(t.qMarginSurge), text: `${f1(t.qMarginSurge)} dB` })]),
      el('span', {}, ['Rx power when they return: ', el('b', { text: `${f1(t.prxDip)} dBm` }), ` (sensitivity ${mode.rxMin} dBm)`]),
      el('span', {}, ['Q margin during that dip: ', el('b', { class: ok(t.qMarginDip), text: `${f1(t.qMarginDip)} dB` })])]),
    traceChart(r),
    el('p', { class: 'muted small', text: `A gain-controlled EDFA would raise the survivors by 10·log10(channels / survivors) if it did not react; its control loop holds off all but a fraction 1 − exp(−response / ${t.tauUs} µs) of that. The excursions of a cascade add. Raman pumps and ROADM wavelength blockers are not modelled. The event size and amplifier response are in the inspector (nothing selected); an amplifier can override the response.` }));
  return wrap;
}

// client ports (muxponders)
function clientsView(r) {
  const wrap = el('div', { class: 'tablewrap' });
  if (!r.clients || !r.clients.length) return el('p', { class: 'muted pad', text: 'Neither end of this service is a muxponder. Drag a Muxponder onto the bench to add client ports (100G, 400G and other grey optics) in front of the coherent line port.' });
  for (const c of r.clients) {
    const over = c.total > c.lineRate;
    wrap.append(el('h3', { text: `${c.node.name}: ${c.ports.length} client port${c.ports.length === 1 ? '' : 's'} into ${PHY.MODES[c.node.p.mode].short}` }),
      el('p', { class: 'small ' + (over ? 'cs-down' : 'muted'), text: `${c.total}G of clients on a ${c.lineRate}G line (${Math.round(100 * c.total / c.lineRate)}% full).${over ? ' The line port cannot carry this.' : ''}` }));
    const t = el('table', { class: 'hops' });
    t.append(el('thead', {}, el('tr', {}, ['Port', 'Optic', 'Rate', 'Rated reach', 'Length', 'Tx dBm', 'Loss dB', 'Rx dBm', 'Margin dB', 'Status'].map(h => el('th', { text: h })))));
    const tb = el('tbody');
    c.ports.forEach(p => tb.append(el('tr', {}, [p.idx, p.optic.name, p.optic.rate + 'G', p.optic.reach + ' km', p.len + ' km', f1(p.optic.tx), f1(p.loss), f1(p.rx), f1(p.margin),
      p.status === 'ok' ? 'OK' : p.status === 'warn' ? 'WARN: ' + p.notes[0] : 'DOWN: ' + p.notes[0]].map((x, i) => el('td', { text: String(x), class: i === 9 ? 'cs-' + p.status : '' })))));
    t.append(tb); wrap.append(t);
  }
  wrap.append(el('p', { class: 'muted small', text: 'Client optics are grey (non-DWDM) modules cabled to the host router or switch, so each port has its own short fiber budget, separate from the line system. Values are representative IEEE/MSA numbers; check your module datasheet.' }));
  return wrap;
}

// power map
function powerChart(r) {
  const W = 900, H = 300, ml = 46, mr = 16, mt = 16;
  let mb = 54;
  const hops = r.hops, total = Math.max(1, r.km), nodeW = Math.max(4, total * 0.05);
  let x = 0; const xs = hops.map(h => { const x0 = x; x += h.kind === 'span' ? h.len : h.kind === 'patch' ? nodeW * 0.25 : nodeW; return [x0, x]; });
  const X = v => ml + v / x * (W - ml - mr);
  // Device labels: first row that is free at this x, so neighbours on a busy path never overprint.
  const rowEnd = [], rowOf = {};
  hops.forEach((h, i) => {
    if (h.kind === 'span' || h.kind === 'patch') return;
    const cx = (X(xs[i][0]) + X(xs[i][1])) / 2, half = h.name.length * 3.3 + 3;
    let row = 0; while (rowEnd[row] != null && rowEnd[row] > cx - half) row++;
    rowEnd[row] = cx + half; rowOf[i] = row;
  });
  mb = 38 + Math.max(3, rowEnd.length) * 13;
  const vals = hops.flatMap(h => [h.in.sig, h.out.sig, h.in.ase, h.out.ase, h.in.nli, h.out.nli]).filter(v => v > -90);
  const ymax = Math.ceil((Math.max(...vals) + 3) / 5) * 5, ymin = Math.floor((Math.min(...vals) - 3) / 10) * 10;
  const Y = v => mt + (ymax - Math.max(v, ymin)) / (ymax - ymin) * (H - mt - mb);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Power level diagram' });
  for (let v = ymin; v <= ymax; v += 10) { s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), class: 'grid' })); const t = sv('text', { x: ml - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = v; s.append(t); }
  const yl = sv('text', { x: 12, y: mt + (H - mt - mb) / 2, class: 'ax', transform: `rotate(-90 12 ${mt + (H - mt - mb) / 2})`, 'text-anchor': 'middle' }); yl.textContent = 'dBm (per channel)'; s.append(yl);
  // osnr gap shading
  let area = ''; hops.forEach((h, i) => { area += `${i ? 'L' : 'M'}${X(xs[i][0])},${Y(h.in.sig)} L${X(xs[i][1])},${Y(h.out.sig)} `; });
  for (let i = hops.length - 1; i >= 0; i--) area += `L${X(xs[i][1])},${Y(hops[i].out.ase)} L${X(xs[i][0])},${Y(hops[i].in.ase)} `;
  s.append(sv('path', { d: area + 'Z', class: 'gap' }));
  for (const [key, cls] of [['nli', 'l-nli'], ['ase', 'l-ase'], ['sig', 'l-sig']]) {
    let d = ''; hops.forEach((h, i) => { if (h.in[key] < -90 && h.out[key] < -90) return; let a = h.in[key]; if (a < -90) { a = h.out[key] - (h.gain || 0); d = ''; } d += `${d ? 'L' : 'M'}${X(xs[i][0])},${Y(a)} L${X(xs[i][1])},${Y(h.out[key])} `; });
    if (d) s.append(sv('path', { d, class: 'pl ' + cls }));
  }
  hops.forEach((h, i) => {
    if (h.kind === 'span' || h.kind === 'patch') {
      if (h.kind === 'span' && X(xs[i][1]) - X(xs[i][0]) > String(h.len).length * 6.5 + 28) { const t = sv('text', { x: (X(xs[i][0]) + X(xs[i][1])) / 2, y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); t.textContent = `${h.len} km`; s.append(t); }
      return;
    }
    const cx = (X(xs[i][0]) + X(xs[i][1])) / 2;
    s.append(sv('line', { x1: cx, x2: cx, y1: mt, y2: H - mb, class: 'tick' }));
    const t = sv('text', { x: cx, y: H - mb + 30 + rowOf[i] * 13, class: 'ax node-ax', 'text-anchor': 'middle' }); t.textContent = h.name.replace(/ (pre|boost|express|add|drop)$/, m => m); s.append(t);
  });
  if (isFinite(r.prx)) { const t = sv('text', { x: W - mr, y: mt - 4, class: 'ax strong', 'text-anchor': 'end' }); t.textContent = `Rx ${f1(r.prx)} dBm`; s.append(t); }
  const wrap = el('div', { class: 'chartwrap' }, [s]);
  wrap.append(el('div', { class: 'legend' }, [lg('l-sig', 'Signal power'), lg('l-ase', 'ASE noise in 0.1 nm'), lg('l-nli', 'NLI noise in 0.1 nm'), el('span', { class: 'muted', text: 'Shaded gap between signal and ASE = OSNR. Spans slope down (fiber loss), amplifiers step up.' })]));
  return wrap;
}
const lg = (c, t) => el('span', {}, [el('i', { class: c }), t]);

function hopTable(r) {
  const t = el('table', { class: 'hops' });
  t.append(el('thead', {}, el('tr', {}, ['Element', 'Type', 'km', 'In dBm/ch', 'Out dBm/ch', 'Gain / loss', 'Total out', 'OSNR', 'GSNR', 'Notes'].map(h => el('th', { text: h })))));
  const tb = el('tbody');
  r.hops.forEach(h => {
    const tot = h.out.sig > -90 ? f1(h.out.sig + db(h.nch)) : '—';
    tb.append(el('tr', { class: h.kind === 'cut' || h.over ? 'cutrow' : h.warn ? 'warnrow' : '' }, [h.name, h.kind, Math.round(h.km), h.kind === 'tx' ? '' : f1(h.in.sig), h.out.sig > -90 ? f1(h.out.sig) : 'LOS', h.gain != null ? (h.gain > 0 ? '+' : '') + f1(h.gain) : '', tot + (h.nch > 1 ? ` (${h.nch}ch)` : ''), h.osnr != null ? f1(h.osnr) : '', h.gosnr != null ? f1(h.gosnr) : '',
      [h.nf ? `NF ${f1(h.nf)}` : '', h.launch != null ? `launch ${f1(h.launch)}` : '', (h.over || h.warn ? '⚠ ' : '') + (h.note || '')].filter(Boolean).join(' · ')].map(c => el('td', { text: String(c) }))));
  });
  t.append(tb);
  return el('div', { class: 'tablewrap' }, [el('p', { class: 'muted small', text: 'What the PM counters would read along the path, per channel. OSNR / GSNR in 0.1 nm measured after each element.' }), t]);
}

// spectrum (OSA-style view at any point along the path)
let specHop = null; // name of the chosen measurement point; null = busiest point on the path
function spectrumView(r) {
  const wrap = el('div', { class: 'chartwrap' });
  const hops = r.hops.filter(h => h.kind !== 'cut');
  if (!hops.length) return wrap;
  const maxN = Math.max(...hops.map(x => x.nch));
  const keys = hops.map((x, i) => `${x.name}#${hops.slice(0, i).filter(y => y.name === x.name).length}`); // names repeat (every patch cord), so add an occurrence number
  let hi = specHop == null ? -1 : keys.indexOf(specHop);
  if (hi < 0) hi = hops.map(x => x.nch).lastIndexOf(maxN);
  const h = hops[hi], df = +r.g.df * 1e9, slots = PHY.cBandSlots(df);
  let lit = Math.min(h.nch, slots);
  const sel = el('select', { id: 'spec-hop', 'aria-label': 'Measurement point' });
  hops.forEach((x, i) => sel.append(el('option', { value: i, text: `After ${x.name}${x.kind === 'patch' ? ` (${keys[i].split('#')[1] * 1 + 1})` : ''}` })));
  sel.value = hi; sel.addEventListener('change', () => { specHop = keys[+sel.value]; renderTabBody(); });
  wrap.append(el('div', { class: 'sp-sel' }, [el('label', { for: 'spec-hop', text: 'Measure at' }), sel]));

  const W = 900, H = 300, ml = 46, mr = 16, mt = 16, mb = 40, f0 = PHY.CBAND.f0 / 1e12, f1v = (PHY.CBAND.f0 + PHY.CBAND.width) / 1e12;
  const Rs = r.mode.Rs, dens = 10 * Math.log10(Rs / PHY.BREF); // channel power -> level seen in a 0.1 nm slice
  const plan = r.segments && h.lit ? r.segments.filter((_, k) => h.lit[k]) : null; // a custom channel plan draws every channel lit at this point as itself
  const lvl = c => h.out.sig + c.off - 10 * Math.log10(PHY.MODES[c.modeKey].Rs / PHY.BREF);
  const sigD = h.out.sig - dens, aseD = h.out.ase, nliD = h.out.nli;
  const sigTop = plan ? Math.max(...plan.map(lvl)) : sigD;
  const top = Math.max(sigTop, aseD) + 8, ymax = Math.ceil(top / 10) * 10, ymin = Math.floor((Math.min(aseD, nliD > -90 ? nliD : aseD) - 14) / 10) * 10;
  const X = f => ml + (f - f0) / (f1v - f0) * (W - ml - mr), Y = v => mt + (ymax - Math.min(ymax, Math.max(ymin, v))) / (ymax - ymin) * (H - mt - mb);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Optical spectrum at the selected point' });
  for (let v = ymin; v <= ymax; v += 10) { s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), class: 'grid' })); const t = sv('text', { x: ml - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = v; s.append(t); }
  for (let f = Math.ceil(f0 * 2) / 2; f <= f1v + 1e-9; f += 0.5) { const t = sv('text', { x: X(f), y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); t.textContent = f.toFixed(1); s.append(t); }
  const xl = sv('text', { x: (ml + W - mr) / 2, y: H - 6, class: 'ax', 'text-anchor': 'middle' }); xl.textContent = 'Frequency (THz)'; s.append(xl);
  const yl = sv('text', { x: 12, y: mt + (H - mt - mb) / 2, class: 'ax', transform: `rotate(-90 12 ${mt + (H - mt - mb) / 2})`, 'text-anchor': 'middle' }); yl.textContent = 'dBm in 0.1 nm'; s.append(yl);
  // ASE fills the whole band (amplifiers amplify noise in unlit slots too)
  if (h.out.ase > -90) s.append(sv('rect', { x: X(f0), y: Y(aseD), width: X(f1v) - X(f0), height: Math.max(0, Y(ymin) - Y(aseD)), class: 'sp-ase' }));
  s.append(sv('line', { x1: X(f0), x2: X(f1v), y1: Y(aseD), y2: Y(aseD), class: 'pl l-ase' }));
  let first;
  if (plan) {
    lit = plan.length; first = Math.min(...plan.map(c => c.slot));
    const lo = first, hi = Math.max(...plan.map(c => c.slot));
    for (const c of plan) {
      const m = PHY.MODES[c.modeKey], fc = c.fTHz, half = Math.min(m.Rs, df * 0.98) / 2e12;
      const sk = lvl(c) + (hi > lo && h.tilt ? h.tilt * (0.5 - (c.slot - lo) / (hi - lo)) : 0);
      const rect = sv('rect', { x: X(fc - half), y: Y(sk), width: Math.max(1.5, X(fc + half) - X(fc - half)), height: Math.max(0, Y(ymin) - Y(sk)), class: c.svc ? 'sp-me' : m.coh === false ? 'sp-nrz' : 'sp-ch' });
      const tt = sv('title', {}); tt.textContent = `Slot ${c.slot + 1}: ${m.short}, ${fc.toFixed(2)} THz`; rect.append(tt); s.append(rect);
    }
  } else {
    // lit block centred in the band; the service channel sits in its middle
    first = Math.floor((slots - lit) / 2);
    const me = first + Math.floor(lit / 2);
    for (let k = first; k < first + lit; k++) {
      const fc = f0 + (k + 0.5) * df / 1e12, half = Math.min(Rs, df * 0.92) / 2e12;
      const sk = sigD + (lit > 1 && h.tilt ? h.tilt * (0.5 - (k - first) / (lit - 1)) : 0); // SRS: low-frequency channels gain, high-frequency lose
      s.append(sv('rect', { x: X(fc - half), y: Y(sk), width: Math.max(1.5, X(fc + half) - X(fc - half)), height: Math.max(0, Y(ymin) - Y(sk)), class: k === me ? 'sp-me' : 'sp-ch' }));
    }
  }
  if (nliD > -90 && lit > 0) { // NLI is noise-like and sits under the lit channels
    const hiSlot = plan ? Math.max(...plan.map(c => c.slot)) + 1 : first + lit;
    const a = f0 + first * df / 1e12, b = f0 + hiSlot * df / 1e12;
    s.append(sv('line', { x1: X(a), x2: X(b), y1: Y(nliD), y2: Y(nliD), class: 'pl l-nli' }));
  }
  const tn = sv('text', { x: W - mr, y: mt + 10, class: 'ax strong', 'text-anchor': 'end' }); tn.textContent = `${lit} ch lit of ${slots} slots (${r.g.df} GHz grid)`; s.append(tn);
  wrap.append(s, el('div', { class: 'legend' }, [lg('l-sig', 'Neighbouring channels'), el('span', {}, [el('i', { style: 'background:var(--accent)' }), 'Service channel']), lg('l-ase', 'ASE floor'), lg('l-nli', 'NLI under the lit channels'),
    el('span', { class: 'muted', text: `Channel power here is ${f1(h.out.sig)} dBm (reads ${f1(sigD)} dBm in a 0.1 nm slice, since a ${(Rs / 1e9).toFixed(0)} GBd signal is ${f1(dens)} dB wider). OSNR = channel power − ASE floor = ${f1(h.out.sig - aseD)} dB. All channels launch at equal power.${h.tilt > 0.05 ? ` SRS has tilted them by ${f1(h.tilt)} dB, lowest to highest frequency.` : ''}` })]));
  return wrap;
}

// constellation
let constSeed = 1;
function rand() { constSeed = (constSeed * 16807) % 2147483647; return constSeed / 2147483647; }
function gauss() { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); }
function constView(r) {
  const wrap = el('div', { class: 'constwrap' });
  const c = el('canvas', { width: 640, height: 640, class: 'const', 'aria-label': 'Constellation diagram' });
  const m = PHY.MODS[r.mode.mod], M = m.M, side = Math.sqrt(M);
  const ook = M === 2; // NRZ: two levels on one axis
  const pts = []; if (ook) pts.push([-1, 0], [1, 0]); else for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) pts.push([(2 * i - side + 1), (2 * j - side + 1)]);
  const Es = pts.reduce((a, p) => a + p[0] ** 2 + p[1] ** 2, 0) / M;
  const snr = r.effDb != null ? lin(r.effDb) : 0.5, sigma = Math.sqrt(Es / snr / (ook ? 1 : 2));
  const ctx = c.getContext('2d'), cs = getComputedStyle(document.documentElement);
  const fg = cs.getPropertyValue('--ink').trim(), acc = cs.getPropertyValue('--sig').trim(), mut = cs.getPropertyValue('--line').trim();
  const sc = ook ? 150 : 290 / side, cx = 320;
  ctx.strokeStyle = mut; ctx.lineWidth = 1;
  if (ook) { ctx.beginPath(); ctx.moveTo(cx, 20); ctx.lineTo(cx, 620); ctx.stroke(); }
  else for (let i = 1; i < side; i++) { const v = (2 * i - side) * sc; /* decision boundaries */ ctx.beginPath(); ctx.moveTo(cx + v, 20); ctx.lineTo(cx + v, 620); ctx.moveTo(20, cx + v); ctx.lineTo(620, cx + v); ctx.stroke(); }
  constSeed = 7;
  ctx.fillStyle = acc; ctx.globalAlpha = 0.45;
  const n = 4000;
  for (let k = 0; k < n; k++) { const p = pts[Math.floor(rand() * M)]; const x = cx + (p[0] + sigma * gauss()) * sc, y = ook ? cx + (rand() - 0.5) * 420 : cx - (p[1] + sigma * gauss()) * sc; ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2); }
  ctx.globalAlpha = 1; ctx.fillStyle = fg;
  if (!ook) pts.forEach(p => { ctx.beginPath(); ctx.arc(cx + p[0] * sc, cx - p[1] * sc, 6, 0, 7); ctx.fill(); });
  else pts.forEach(p => ctx.fillRect(cx + p[0] * sc - 2, 20, 4, 600));
  const evm = 100 / Math.sqrt(snr);
  wrap.append(c, el('div', { class: 'constinfo' }, [
    el('h3', { text: r.mode.coh === false ? `${r.mode.mod}: received level histogram (1 / 0)` : `DP-${r.mode.mod}, one polarization` }),
    specRow('Effective SNR', `${f1(r.effDb)} dB`), specRow('EVM (rms)', `${f1(evm)} %`), specRow('Pre-FEC BER', r.ber < 1e-15 ? '<1e-15' : r.ber.toExponential(2)), specRow('Needed at FEC limit', `${f1(PHY.requiredEffSnrDb(r.mode))} dB SNR`),
    el('p', { class: 'muted small', text: 'Each dot is a received symbol. Noise smears dots away from the ideal points (black). A dot that lands across a grid line is decoded as the wrong symbol: that is a bit error. FEC can fix errors up to its BER limit. Try raising the span length and watch the clouds merge.' })]));
  return wrap;
}

// can the hosts reach each other, and what is the first thing in the way if not; plus offered traffic over the channels
let reachSel = null;
// OTDR: the trace of a fiber from a test point, with its events
let otdrSel = null;
function otdrView() {
  const wrap = el('div', { class: 'pad' }), ots = S.nodes.filter(n => n.type === 'otdr');
  if (!ots.length) return el('p', { class: 'muted pad', text: 'Add an OTDR (in the palette), plug it into a patch panel port, and this tab shows the trace: fiber loss, connectors, breaks and the end of the fiber. Try the "OTDR and power meter" scenario.' });
  if (!ots.some(n => n.id === otdrSel)) otdrSel = ots[0].id;
  const sel = el('select', { id: 'otdr-sel', 'aria-label': 'OTDR' }); ots.forEach(n => sel.append(el('option', { value: n.id, text: n.name }))); sel.value = otdrSel; sel.addEventListener('change', () => { otdrSel = sel.value; renderTabBody(); });
  const t = MODEL.otdrTrace(S, otdrSel), W = 760, H = 300, ml = 52, mr = 16, mt = 16, mb = 38, maxKm = Math.max(0.1, t.endKm * 1.05), minDb = Math.min(-5, ...t.points.map(q => q.db)) - 3, topDb = 28;
  const X = km => ml + (W - ml - mr) * km / maxKm, Y = db => mt + (H - mt - mb) * (topDb - db) / (topDb - minDb);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'OTDR trace', style: 'width:100%;max-width:760px;height:auto' });
  for (let d = Math.ceil(minDb / 5) * 5; d <= 25; d += 5) { svg.append(sv('line', { x1: ml, x2: W - mr, y1: Y(d), y2: Y(d), class: 'pl grid' })); const e = sv('text', { x: ml - 6, y: Y(d) + 4, class: 'glyph small', 'text-anchor': 'end' }); e.textContent = d; svg.append(e); }
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].find(v => maxKm / v <= 10) || 100;
  for (let k = 0; k <= maxKm; k += step) { const e = sv('text', { x: X(k), y: H - mb + 14, class: 'glyph small', 'text-anchor': 'middle' }); e.textContent = +k.toFixed(2); svg.append(e); }
  const ax = sv('text', { x: ml + (W - ml - mr) / 2, y: H - 6, class: 'glyph small', 'text-anchor': 'middle' }); ax.textContent = 'distance from the OTDR (km)'; svg.append(ax);
  const ay = sv('text', { x: 12, y: mt + 10, class: 'glyph small' }); ay.textContent = 'dB'; svg.append(ay);
  svg.append(sv('path', { d: t.points.map((q, i) => (i ? 'L' : 'M') + X(q.km).toFixed(1) + ',' + Y(q.db).toFixed(1)).join(' '), class: 'pl l-sig', fill: 'none', 'stroke-width': 2 }));
  t.events.forEach((e, i) => { // a reflective event is a spike above the trace; its height follows the reflectance
    const h = Math.max(0, 0.5 * (60 + e.refl)), lvl = t.points.filter(q => Math.abs(q.km - e.km) < 1e-9)[0];
    const bdb = lvl ? lvl.db : 0; svg.append(sv('line', { x1: X(e.km), x2: X(e.km), y1: Y(bdb), y2: Y(bdb + h), class: 'pl l-ase', 'stroke-width': 1.5 }));
    const lab = sv('text', { x: X(e.km) + 3, y: Y(bdb + h) - 3, class: 'glyph small' }); lab.textContent = i + 1; svg.append(lab);
  });
  wrap.append(el('div', { class: 'planbar' }, [el('b', { text: 'OTDR trace' }), sel, el('span', { class: 'muted small', text: `${t.pulse} ns pulse · dynamic range ${t.dr} dB · dead zone ${(t.dz * 1000).toFixed(1)} m` })]));
  wrap.append(svg, el('p', { class: 'small', text: `${t.endWhy ? 'The trace ends: ' + t.endWhy + '.' : ''} Distance ${f1(t.endKm)} km, ${f1(t.loss)} dB of loss along the trace (one way).` }));
  const tbl = el('table', { class: 'tbl' }), th = el('tr'); ['#', 'km', 'Event', 'Loss dB', 'Reflectance dB', 'Note'].forEach(h => th.append(el('th', { text: h }))); tbl.append(el('thead', {}, [th]));
  const tb = el('tbody'); t.events.forEach((e, i) => tb.append(el('tr', {}, [i + 1, e.km.toFixed(3), e.name, e.loss ? f1(e.loss) : '', e.refl > -80 ? Math.round(e.refl) : '', e.note || ''].map(x => el('td', { text: String(x) }))))); tbl.append(tb);
  wrap.append(el('div', { style: 'overflow:auto' }, [tbl]));
  return wrap;
}
// 1310 nm ports: what each OADM's 1310 nm port carries and whether the light gets across
function b1310View() {
  const B = lastRes && lastRes.b1310, O = lastRes && lastRes.osc; if (!(B && B.links.length) && !(O && O.links.length)) return null;
  const wrap = el('div', { class: 'pad' }), stt = r => el('span', { class: r.status === 'up' ? 'st-up' : r.status === 'warn' ? 'st-degraded' : 'st-down', text: (r.status === 'up' ? 'UP' : r.status === 'warn' ? 'WARN' : r.status === 'blocked' ? 'BLOCKED' : 'DOWN') + (r.why ? ': ' + r.why : '') });
  const table = (title, rows, carries) => {
    const tbl = el('table', { class: 'tbl' }), th = el('tr'); ['From', 'To', ...(carries ? ['Carries'] : []), 'Fiber km', 'Loss dB', 'Rx dBm', 'Margin dB', 'Status'].forEach(h => th.append(el('th', { text: h })));
    tbl.append(el('thead', {}, [th]));
    const tb = el('tbody');
    for (const r of rows) tb.append(el('tr', {}, [r.aName, r.bName || 'stops', ...(carries ? [r.opticName || ''] : []), r.km != null ? f1(r.km) : '', r.loss != null ? f1(r.loss) : '', r.rx != null ? f1(r.rx) : '', r.margin != null ? f1(r.margin) : '', stt(r)].map(x => (x instanceof Node ? el('td', {}, [x]) : el('td', { text: String(x) })))));
    tbl.append(tb); wrap.append(el('h3', { text: title }), el('div', { style: 'overflow:auto' }, [tbl]));
  };
  if (O && O.links.length) { table('Supervisory channel (1510 nm), span by span', O.links, false); wrap.append(el('p', { class: 'small', text: 'Management domains: ' + (O.domains.map(d => d.join(' + ')).join('; ') || 'none') })); }
  if (B && B.links.length) table('1310 nm ports', B.links, true);
  return wrap;
}
function reachView() {
  const b = b1310View(), v = reachHosts();
  if (!b) return v; const w = el('div', {}); w.append(b, v); return w;
}
function reachHosts() {
  const hosts = S.nodes.filter(n => n.type === 'host'), wrap = el('div', { class: 'planwrap pad' });
  if (hosts.length < 2) return el('p', { class: 'muted pad', text: 'Add two or more hosts (Host / router in the palette) and cable each to a transponder or a muxponder client port. This tab then shows whether they can reach each other over the optical network, how long it takes, and what is wrong when they cannot.' });
  const R = MODEL.reach(S, lastRes), T = MODEL.traffic(S, lastRes), name = id => (node(id) || {}).name, hplan = lastRes && lastRes.derived ? lastRes.derived.plan : S.g.plan;
  const key = r => r.a + '|' + r.z; if (!R.some(r => key(r) === reachSel)) reachSel = (R.find(r => !r.ok) || R[0]) ? key(R.find(r => !r.ok) || R[0]) : null;
  const tbl = el('table', { class: 'tbl reachtbl' }), th = el('tr'); ['Between', 'Reachable', 'One-way latency', 'Rate', 'First problem'].forEach(h => th.append(el('th', { text: h })));
  tbl.append(el('thead', {}, [th]));
  const tb = el('tbody');
  for (const r of R) tb.append(el('tr', { class: key(r) === reachSel ? 'selrow' : '', onclick: () => { reachSel = key(r); hiChan = r.entry && r.entry.i >= 0 && hplan ? hplan[r.entry.i] || null : null; renderCanvas(); renderTabBody(); } },
    [`${name(r.a)} ↔ ${name(r.z)}`, el('span', { class: r.ok ? (r.degraded ? 'st-degraded' : 'st-up') : 'st-down', text: r.ok ? (r.degraded ? 'YES (degraded)' : 'YES') : 'NO' }), r.ok ? fmtUs(r.latencyUs) : '', r.ok ? `${r.rate}G` : '', r.ok ? '' : r.why].map(x => (x instanceof Node ? el('td', {}, [x]) : el('td', { text: x })))));
  tbl.append(tb);
  wrap.append(el('div', { class: 'planbar' }, [el('b', { text: 'Can they reach each other?' }), el('span', { class: 'muted small', text: `${R.filter(r => r.ok).length} of ${R.length} host pairs` })]), el('div', { style: 'overflow:auto;max-height:200px' }, [tbl]));
  const cur = R.find(r => key(r) === reachSel);
  if (cur) {
    const ol = el('ol', { class: 'steps' }, cur.steps.map(st => el('li', { class: st.ok ? 'ok' : 'bad', text: st.text })));
    wrap.append(el('h3', { text: `Trace: ${name(cur.a)} → ${name(cur.z)}` }), ol);
    if (cur.ok) wrap.append(el('p', { class: 'muted small', text: `One way ${fmtUs(cur.latencyUs)} (${Math.round(cur.km)} km of fiber at 4.9 µs/km plus the transceivers), round trip ${fmtUs(2 * cur.latencyUs)}. Rate ${cur.rate}G.` }));
  }
  // offered traffic
  S.flows ??= [];
  const flowBar = el('div', { class: 'planbar' }, [el('b', { text: 'Traffic' }), el('button', { class: 'btn', text: 'Add flow', onclick: () => { S.flows.push({ a: hosts[0].id, z: hosts[1].id, gbps: 10 }); renderTabBody(); save(); } })]);
  wrap.append(flowBar);
  if (S.flows.length) {
    const ft = el('table', { class: 'tbl' }), fh = el('tr'); ['From', 'To', 'Offered (Gb/s)', 'Delivered', 'Loss', 'Slot', 'Latency', ''].forEach(h => fh.append(el('th', { text: h })));
    ft.append(el('thead', {}, [fh]));
    const ftb = el('tbody');
    S.flows.forEach((f, i) => {
      const o = T.flows[i], hs = k => { const sl = el('select', { 'aria-label': k === 'a' ? 'From' : 'To' }); hosts.forEach(h => sl.append(el('option', { value: h.id, text: h.name }))); sl.value = f[k]; sl.addEventListener('change', () => { f[k] = sl.value; if (f.a === f.z) f[k === 'a' ? 'z' : 'a'] = hosts.find(h => h.id !== f[k]).id; renderTabBody(); save(); }); return sl; };
      const g = el('input', { type: 'number', step: 1, min: 0, max: 1600, value: f.gbps, class: 'slotin', 'aria-label': 'Offered Gb/s' }); g.addEventListener('change', () => { if (isFinite(+g.value)) { f.gbps = Math.max(0, +g.value); renderTabBody(); save(); } });
      ftb.append(el('tr', {}, [hs('a'), hs('z'), g, o && o.ok ? `${f1(o.delivered)}` : '0', el('span', { class: o && o.ok ? (o.lossPct > 0.05 ? 'st-degraded' : 'st-up') : 'st-down', text: o && o.ok ? `${f1(o.lossPct)} %` : '100 %' }), o && o.slot != null ? String(o.slot + 1) : '', o && o.ok ? fmtUs(o.latencyUs) : (o ? o.why : ''),
        el('button', { class: 'btn', text: '×', title: 'Remove', 'aria-label': `Remove the flow from ${name(f.a)} to ${name(f.z)}`, onclick: () => { S.flows.splice(i, 1); renderTabBody(); save(); } })].map(x => (x instanceof Node ? el('td', {}, [x]) : el('td', { text: x })))));
    });
    ft.append(ftb); wrap.append(el('div', { style: 'overflow:auto;max-height:200px' }, [ft]));
    if (T.channels.length) wrap.append(el('div', {}, T.channels.map(c => el('div', { class: 'small', style: 'display:flex;gap:10px;align-items:center;margin:3px 0' }, [el('span', { text: `${c.slot != null ? 'Slot ' + (c.slot + 1) : 'Service channel'} ${name(c.a)} → ${name(c.z)}: ${f1(c.load)} of ${c.cap}G` }), el('div', { class: 'ubar' + (c.over ? ' over' : ''), style: 'flex:0 0 140px' }, [el('i', { style: `width:${Math.round(100 * c.util)}%` })]), el('span', { class: 'muted', text: `${Math.round(100 * c.util)} %` })]))));
  }
  wrap.append(el('p', { class: 'muted small', text: 'Latency is propagation in glass (4.9 µs per km), any dispersion-compensating fiber, and about 10 µs of DSP and FEC at each coherent transceiver (1 µs for a 10G direct-detect one): representative figures. A flow is capped by its host port and client optic, and flows sharing a channel in one direction are scaled down together when they exceed the line rate. There is no packet network: this checks that the optical layer can carry the traffic, not how routing behaves.' }));
  return wrap;
}

// channels defined by the cabling: transponders on numbered mux ports pair up by slot (see MODEL.derive); the table only shows them
function derivedPlanView(r, D) {
  const wrap = el('div', { class: 'planwrap pad' }), res = r && r.channels ? r.channels : [];
  const toTable = () => {
    S.g.plan = MODEL.sanitizePlan(D.plan.map(c => ({ slot: c.slot, mode: c.mode, off: c.off, svc: c.svc, from: c.filler || c.svc ? '' : c.from, to: c.filler || c.svc ? '' : c.to, via: '', conv: c.filler || c.svc ? '' : c.conv || '', slot2: c.slot2 ?? c.slot, prot: c.prot || '', slotRev: c.slotRev })), +S.g.df);
    S.g.nch = S.g.plan.length; S.links.forEach(l => { if (l.p.mport != null) l.p.mport = null; }); hiChan = null; renderAll(); toast('The channels are now a plain table; the mux ports are cleared.');
  };
  wrap.append(el('div', { class: 'planbar' }, [el('b', { text: `${D.plan.length} channels` }), el('span', { class: 'muted small', text: `${D.paired} from the cabling${D.fillers ? `, ${D.fillers} background (to reach the channel count)` : ''}` }),
    el('button', { class: 'btn', text: 'Edit as a table', title: 'Turn the derived channels into an editable plan and clear the mux ports', onclick: toTable })]));
  wrap.append(el('p', { class: 'muted small', text: 'These channels follow the cabling. Plug a transponder into a port of a mux, tune it (or leave it on Auto), and plug its partner into the port for the same slot on the far mux. Click a row to light its route on the canvas.' }));
  const tbl = el('table', { class: 'tbl plantbl' }), th = el('tr'); ['Slot (there / back)', 'THz', 'Mode', 'From', 'To', 'Protect / convert', 'Offset dB', 'Rx dBm', 'GSNR', 'Q margin', 'Status'].forEach(h => th.append(el('th', { text: h })));
  tbl.append(el('thead', {}, [th]));
  const tb = el('tbody');
  D.plan.forEach((c, i) => {
    const o = res[i], m = PHY.MODES[c.mode], fromN = c.filler ? 'background' : (node(c.from) || {}).name || '', toN = c.filler ? '' : (node(c.to) || {}).name || '';
    const off = el('input', { type: 'number', step: 0.5, min: -10, max: 10, value: c.off, class: 'slotin', 'aria-label': `Power offset for slot ${c.slot + 1}`, disabled: !!c.filler });
    off.addEventListener('change', () => { const t = node(c.tx); if (t && isFinite(+off.value)) { t.p.off = Math.max(-10, Math.min(10, +off.value)); renderAll(); } });
    tb.append(el('tr', { class: (c.svc ? 'selrow' : '') + (hiChan === c ? ' hirow' : ''), onclick: ev => { if (ev.target.closest('select,input,button')) return; hiChan = hiChan === c ? null : c; renderCanvas(); renderTabBody(); } },
      [String(c.slot + 1) + (c.slotRev != null ? ` / ${c.slotRev + 1}` : ''), PHY.slotFreqTHz(c.slot, +S.g.df * 1e9).toFixed(2), m.short, fromN, toN, c.filler ? '' : [c.prot === '1+1' ? '1+1' : c.prot === 'shared' ? '1:N' : '', c.conv ? `convert at ${(node(c.conv) || {}).name}, slot ${c.slot + 1} → ${c.slot2 + 1}` : ''].filter(Boolean).join(', '), c.filler ? '' : off,
        o && o.prx != null ? f1(o.prx) : '', o && o.gosnr != null ? f1(o.gosnr) : '', o && o.qMargin != null ? (o.qMargin > 0 ? '+' : '') + f1(o.qMargin) : '',
        o ? el('span', { class: 'st-' + o.status, text: STATUS[o.status] + (o.notes && o.notes.length ? ': ' + o.notes[0] : '') }) : ''].map(x => (x instanceof Node ? el('td', {}, [x]) : el('td', { text: x })))));
  });
  tbl.append(tb);
  wrap.append(el('div', { style: 'overflow:auto;max-height:380px' }, [tbl]));
  (D.notes || []).forEach(t => wrap.append(el('p', { class: 'muted small', text: t })));
  if (D.dark.length) wrap.append(el('h3', { text: 'Dark transponders' }), el('ul', { class: 'small' }, D.dark.map(x => el('li', { text: x.why }))));
  return wrap;
}

// channel plan: which channels share the line (mode, grid slot, power offset) and how each one is doing
function planView(r) {
  { const D = (r && r.derived) || MODEL.derive(S); if (D) return derivedPlanView(r, D); }
  const wrap = el('div', { class: 'planwrap pad' });
  const svcNode = node(S.svc.a), svcMode = svcNode && isEnd(svcNode) ? svcNode.p.mode : 'zrp400';
  const slots = PHY.cBandSlots(+S.g.df * 1e9), modes = Object.entries(PHY.MODES).map(([k, m]) => [k, m.short]);
  if (!S.g.plan) {
    wrap.append(el('p', { class: 'muted', text: `The line carries ${S.g.nch} identical ${PHY.MODES[svcMode].short} channels in the middle of the C-band. Customise the plan to mix 10G, 100G and 400G channels, put them anywhere on the ${S.g.df} GHz grid and give each a power offset. Every channel then gets its own Rx power, GSNR and margin, nonlinear noise depends on its real neighbours, and 10G channels feel cross-phase modulation from the channels around them.` }));
    wrap.append(el('button', { class: 'btn', text: 'Customise channel plan', onclick: () => { S.g.plan = MODEL.planFromUniform(S.g, svcMode); S.g.nch = S.g.plan.length; renderAll(); } }));
    return wrap;
  }
  const plan = S.g.plan, bySlot = new Map();
  plan.forEach(c => bySlot.set(c.slot, [...(bySlot.get(c.slot) || []), c]));
  const commit = () => { plan.sort((a, b) => a.slot - b.slot); S.g.nch = plan.length; renderAll(); };
  let brush = 'zrp400';
  const brushSel = el('select', { 'aria-label': 'Mode for new channels' }); modes.forEach(([k, t]) => brushSel.append(el('option', { value: k, text: t }))); brushSel.value = brush; brushSel.addEventListener('change', () => { brush = brushSel.value; });
  wrap.append(el('div', { class: 'planbar' }, [
    el('b', { text: `${plan.length} channels on ${slots} slots` }), el('span', { class: 'muted small', text: 'New channels use' }), brushSel,
    el('button', { class: 'btn', text: 'Assign slots (first fit)', title: 'Give every channel except the service the lowest slot that is free on all the fibers of its route. Channels with no fiber in common end up sharing slots.', onclick: () => {
      const np = MODEL.assignSlots(S); if (!np) return toast('Nothing to assign: pick a service between two transponders first.');
      S.g.plan = np; S.g.nch = np.length; hiChan = null; renderAll(); toast(`${np.length} channels in ${new Set(np.map(c => c.slot)).size} slots`); } }),
    el('button', { class: 'btn', text: 'Optimise power offsets', title: 'Search the power offsets of the other channels for the best worst-channel margin (the service stays at 0 dB)', onclick: () => {
      const o = MODEL.optimiseOffsets(S); if (!o) return toast('Needs a channel plan with at least two channels.');
      plan.forEach((c, i) => { c.off = o.offsets[i]; }); renderAll(); toast(`Worst channel margin ${f1(o.before.min)} → ${f1(o.after.min)} dB`); } }),
    el('button', { class: 'btn', text: 'Add channel', title: 'Add a channel in the first empty slot', onclick: () => { const free = [...Array(slots).keys()].find(k => !bySlot.has(k)); if (free == null) return toast('Every slot is taken: change a slot number to reuse one.'); plan.push({ slot: free, mode: brush, off: 0, svc: false, from: '', to: '', via: '', conv: '', slot2: free, prot: '' }); commit(); } }),
    el('button', { class: 'btn', text: 'Reset to uniform', onclick: () => { S.g.plan = null; hiChan = null; renderAll(); } })]));
  const strip = el('div', { class: 'planstrip', role: 'group', 'aria-label': 'C-band slots' });
  for (let k = 0; k < slots; k++) {
    const cs = bySlot.get(k) || [], c = cs.find(x => x.svc) || cs[0], m = c && PHY.MODES[c.mode];
    strip.append(el('button', { class: 'pcell' + (c ? (m.coh === false ? ' nrz' : ' coh') + (c.svc ? ' me' : '') + (cs.length > 1 ? ' multi' : '') : ''), title: cs.length > 1 ? `Slot ${k + 1}: ${cs.length} channels reuse this slot on different routes. Change their slot numbers in the table` : c ? `Slot ${k + 1}: ${m.short}${c.svc ? ' (service)' : ''}. Click to remove` : `Slot ${k + 1}: empty. Click to add a ${PHY.MODES[brush].short} channel`, 'aria-label': `Slot ${k + 1}`, text: '',
      onclick: () => { if (cs.length > 1) return toast(`${cs.length} channels share slot ${k + 1}. Change their slot numbers in the table or remove them there.`); if (c) { if (c.svc) return toast('The service channel cannot be removed. Make another channel the service first.'); plan.splice(plan.indexOf(c), 1); } else plan.push({ slot: k, mode: brush, off: 0, svc: false, from: '', to: '', via: '', conv: '', slot2: k, prot: '' }); commit(); } }));
  }
  wrap.append(strip, el('p', { class: 'muted small', text: 'Teal = coherent, amber = direct-detection (10G), outlined = the service channel. Click an empty slot to add a channel, an occupied one to remove it. A slot with a double edge is reused by several channels on routes that share no fiber.' }));
  // Any ROADM or transponder can be where a channel is added or dropped: the channel is routed between them over the cabled network
  const pathRoadms = S.nodes.filter(n => n.type === 'roadm' || n.type === 'oadm' || isEnd(n));
  const anySingle = S.links.some(l => l.kind === 'fiber' && l.p.single); // a single fiber carries both directions, so a channel has a slot each way
  const tbl = el('table', { class: 'tbl plantbl' }), th = el('tr'); ['', 'Slot', ...(anySingle ? ['Slot back'] : []), 'THz', 'Mode', 'Route', 'Offset dB', 'Rx dBm', 'GSNR', 'Q margin', 'XPM', 'Status', '', ''].forEach(h => th.append(el('th', { text: h })));
  tbl.append(el('thead', {}, [th]));
  const tb = el('tbody');
  for (const c of plan) {
    const o = r && r.channels ? r.channels[plan.indexOf(c)] : null, m = PHY.MODES[c.mode];
    const radio = el('input', { type: 'radio', name: 'svcch', 'aria-label': `Make slot ${c.slot + 1} the service channel` }); radio.checked = c.svc; radio.addEventListener('change', () => { plan.forEach(x => (x.svc = x === c)); commit(); });
    const ms = el('select', {}); modes.forEach(([k, t]) => ms.append(el('option', { value: k, text: t }))); ms.value = svcNode && c.svc ? svcMode : c.mode; ms.disabled = !!c.svc; ms.title = c.svc ? 'The service channel always uses the transponder mode' : '';
    ms.addEventListener('change', () => { c.mode = ms.value; commit(); });
    const slotIn = el('input', { type: 'number', step: 1, min: 1, max: slots, value: c.slot + 1, 'aria-label': 'Slot number', class: 'slotin' });
    slotIn.addEventListener('change', () => { const v = Math.round(+slotIn.value); if (isFinite(v) && v >= 1 && v <= slots) { c.slot = v - 1; commit(); } else { slotIn.value = c.slot + 1; toast(`Slots run from 1 to ${slots}.`); } });
    const revIn = el('input', { type: 'number', step: 1, min: 1, max: slots, value: c.slotRev != null ? c.slotRev + 1 : '', placeholder: 'same', 'aria-label': `Slot on the way back for slot ${c.slot + 1}`, class: 'slotin', title: 'On a single fiber the way back needs its own slot. Blank = the same slot, which a single fiber cannot carry.' });
    revIn.addEventListener('change', () => { const v = Math.round(+revIn.value); if (revIn.value === '') { c.slotRev = null; commit(); } else if (isFinite(v) && v >= 1 && v <= slots && v - 1 !== c.slot) { c.slotRev = v - 1; commit(); } else { revIn.value = c.slotRev != null ? c.slotRev + 1 : ''; toast('The way back needs a different slot from the way there.'); } });
    const nodeSel = (key, ends, label) => {
      const sel = el('select', { 'aria-label': `${label} for slot ${c.slot + 1}` }); sel.append(el('option', { value: '', text: ends }));
      (key === 'via' || key === 'conv' ? pathRoadms.filter(n => n.type === 'roadm') : pathRoadms).forEach(n => sel.append(el('option', { value: n.id, text: n.name })));
      if (c[key] && !pathRoadms.some(n => n.id === c[key])) sel.append(el('option', { value: c[key], text: '(missing device)' }));
      sel.value = c[key] || ''; sel.disabled = !!c.svc || (key === 'via' && !!c.conv); sel.title = c.svc ? 'The service channel runs end to end' : '';
      sel.addEventListener('change', () => { c[key] = sel.value; if (c.from && c.from === c.to) c[key === 'from' ? 'to' : 'from'] = ''; if (c.conv && (c.conv === c.from || c.conv === c.to)) c.conv = ''; if (c.conv) { c.via = ''; if (!Number.isFinite(c.slot2)) c.slot2 = c.slot; } commit(); });
      if (key === 'via') sel.title = c.svc ? 'The service channel takes the shortest route' : c.conv ? 'A converted channel takes the shortest route on each side of the converter' : 'Force the route through this ROADM instead of taking the shortest path';
      if (key === 'conv') sel.title = c.svc ? 'The service channel is not converted' : 'Regenerate the channel at this ROADM into another slot: clears accumulated noise and lets the two sides use different slots';
      return sel;
    };
    const slot2In = el('input', { type: 'number', step: 1, min: 1, max: slots, value: (Number.isFinite(c.slot2) ? c.slot2 : c.slot) + 1, 'aria-label': `Slot after the converter for slot ${c.slot + 1}`, class: 'slotin', title: 'Slot after the converter' });
    slot2In.addEventListener('change', () => { const v = Math.round(+slot2In.value); if (isFinite(v) && v >= 1 && v <= slots) { c.slot2 = v - 1; commit(); } else { slot2In.value = (Number.isFinite(c.slot2) ? c.slot2 : c.slot) + 1; toast(`Slots run from 1 to ${slots}.`); } });
    slot2In.hidden = !c.conv;
    const convCell = el('div', { class: 'pair' }, [nodeSel('conv', 'None', 'Convert at'), slot2In]);
    const protSel = el('select', { 'aria-label': `Protection for slot ${c.slot + 1}` }); [['', 'None'], ['1+1', '1+1 dedicated'], ['shared', '1:N shared']].forEach(([v, t]) => protSel.append(el('option', { value: v, text: t })));
    protSel.value = c.prot === '1+1' || c.prot === 'shared' ? c.prot : ''; protSel.disabled = false;
    protSel.title = c.conv ? '1+1 on each side of the converter, separately (the converter ROADM itself is shared). ' + '1+1:' : '1+1: a second copy runs on the shortest route that shares no fiber with the working one. Both are lit; the receiver takes the working copy until it fails. 1:N shared: the protection route is dark until the working one fails, so it loads nothing and its slot may be shared with other channels\' protection routes; its margin is predicted by simulating the failure.';
    protSel.addEventListener('change', () => { c.prot = protSel.value; commit(); });
    const off = el('input', { type: 'number', step: 0.5, min: -10, max: 10, value: c.off, 'aria-label': `Power offset for slot ${c.slot + 1}` }); off.addEventListener('change', () => { if (isFinite(+off.value)) { c.off = Math.max(-10, Math.min(10, +off.value)); commit(); } });
    const del = el('button', { class: 'btn', text: '×', title: 'Remove channel', 'aria-label': `Remove the channel in slot ${c.slot + 1}`, disabled: c.svc, onclick: () => { plan.splice(plan.indexOf(c), 1); if (planEdit === c) planEdit = null; commit(); } });
    // the routing of a channel is a sentence, and its controls open only when asked for: most rows keep the defaults (shortest route, no converter, no protection)
    const nm = id => (node(id) || {}).name || '(missing device)', editing = planEdit === c;
    const extras = [c.via && !c.conv ? `via ${nm(c.via)}` : '', c.conv && !c.svc ? `converts at ${nm(c.conv)}, slot ${c.slot + 1} → ${(Number.isFinite(c.slot2) ? c.slot2 : c.slot) + 1}` : '', c.prot === '1+1' ? '1+1 dedicated' : c.prot === 'shared' ? '1:N shared' : ''].filter(Boolean).join(' · ');
    const routeCell = el('span', {}, [c.svc ? 'A end → Z end (the service)' : `${c.from ? nm(c.from) : 'A end'} → ${c.to ? nm(c.to) : 'Z end'}`, extras ? el('span', { class: 'muted', text: ' · ' + extras }) : null]);
    const modeText = PHY.MODES[svcNode && c.svc ? svcMode : c.mode].short, offText = c.off ? (c.off > 0 ? '+' : '') + c.off : '0';
    const editBtn = el('button', { class: 'btn', text: editing ? 'Done' : 'Edit', 'aria-expanded': editing ? 'true' : 'false', title: 'Mode, route, converter, protection and power offset for this channel', 'aria-label': `${editing ? 'Close the editor for' : 'Edit'} the channel in slot ${c.slot + 1}`, onclick: () => { planEdit = editing ? null : c; renderTabBody(); if (!editing) { const f = document.querySelector('.editrow select'); if (f) f.focus(); } } }); // opening the editor moves focus into it
    const row = el('tr', { class: (c.svc ? 'selrow' : '') + (hiChan === c ? ' hirow' : ''), onclick: ev => { if (ev.target.closest('select,input,button')) return; hiChan = hiChan === c ? null : c; renderCanvas(); renderTabBody(); }, title: o && o.route && o.route.length ? 'Route: ' + o.route.join(' → ') + (o.protection ? '\n' + ((o.protection.active === 'work' ? o.protection.protect : o.protection.work).predicted ? 'Shared protection, predicted by failing the working route (' : 'Standby (') + (o.protection.active === 'work' ? 'protection' : 'working') + ' copy): ' + ((o.protection.active === 'work' ? o.protection.protect : o.protection.work).route.join(' → ') || (o.protection.active === 'work' ? o.protection.protect : o.protection.work).notes[0]) : '') + (o.converted ? '\nConverted at ' + (o.segments[0].toName || '') + ': slot ' + (o.slot + 1) + ' then slot ' + (o.slot2 + 1) : '') : '' }, [radio, slotIn, ...(anySingle ? [revIn] : []), (PHY.CBAND.f0 / 1e12 + (c.slot + 0.5) * +S.g.df / 1000).toFixed(2), modeText, routeCell, offText,
      o && o.prx != null ? f1(o.prx) : '', o && o.gosnr != null ? f1(o.gosnr) : '', o && o.qMargin != null ? (o.qMargin > 0 ? '+' : '') + f1(o.qMargin) : '', o && m.coh === false ? f1(o.xpmPen) : '',
      o ? el('span', { class: 'st-' + o.status, text: STATUS[o.status] + (o.notes.length ? ': ' + o.notes[0] : '') }) : '', editBtn, del].map(x => (x instanceof Node ? el('td', {}, [x]) : el('td', { text: x }))));
    tb.append(row);
    if (editing) { // the controls, with labels, directly under the channel
      const fld = (label, ...ctl) => el('label', { class: 'fld' }, [el('span', { text: label }), ...ctl]);
      tb.append(el('tr', { class: 'editrow' }, [el('td', { colspan: 15 + (anySingle ? 1 : 0) }, [el('div', { class: 'editgrid' }, [
        fld('Mode', ms), fld('Add at', nodeSel('from', 'A end', 'Add at')), fld('Drop at', nodeSel('to', 'Z end', 'Drop at')), fld('Route via', nodeSel('via', 'Shortest', 'Route via')),
        fld('Convert at', convCell), fld('Protection', protSel), fld('Power offset (dB)', off)])])]));
    }
  }
  tbl.append(tb);
  wrap.append(el('div', { style: 'overflow:auto;max-height:420px' }, [tbl]));
  if (r && r.linkLoad && r.linkLoad.length > 1) wrap.append(el('p', { class: 'muted small', text: 'Channels per fiber: ' + r.linkLoad.filter(l => node(S.links.find(x => x.id === l.id).a) && S.links.find(x => x.id === l.id).kind === 'fiber').map(l => `${l.name} ${l.n}`).join(', ') + '.' }));
  wrap.append(el('p', { class: 'muted small', text: 'Slot numbers are editable: channels on routes with no fiber in common may share a slot (wavelength reuse), but two channels in one slot on a shared fiber cannot both be lit and the later one is BLOCKED. "Assign slots" does a first-fit assignment for you. Offset = this channel\'s power relative to the service channel, set at the line mux (a 10G optic beside 400G usually wants a few dB less). The service channel (radio button) takes its mode from the transponder. "Add at" and "Drop at" pick the ROADMs or transponders between which a channel runs (blank = the A and Z ends of the service; the service channel always runs end to end). Each channel takes the shortest route over the cabled network unless \"Via\" forces it through a ROADM (a diverse or protection route), loads only the fibers on it and accumulates noise only along it; click a row to highlight its route on the canvas. Per-span channel counts on the fibers are ignored in plan mode.' }));
  return wrap;
}

// launch sweep
function sweepChart(r) {
  const W = 900, H = 300, ml = 46, mr = 16, mt = 16, mb = 40, lo = -8, hi = 8;
  const pts = []; for (let p = lo; p <= hi + 1e-9; p += 0.25) { const q = simulate(p, { single: true, reverse: dir === 'rev' }); if (q.gosnr != null) pts.push({ p, g: q.gosnr, o: q.osnr, qm: q.qMargin }); }
  const wrap = el('div', { class: 'chartwrap' });
  if (pts.length < 3) { wrap.append(el('p', { class: 'muted pad', text: 'No signal at the receiver, so there is nothing to sweep.' })); return wrap; }
  const ys = pts.flatMap(p => [p.g, Math.min(p.o, p.g + 12)]).concat([r.req]);
  const ymax = Math.ceil((Math.max(...ys) + 1) / 5) * 5, ymin = Math.floor((Math.min(...ys) - 1) / 5) * 5;
  const X = v => ml + (v - lo) / (hi - lo) * (W - ml - mr), Y = v => mt + (ymax - Math.min(ymax, Math.max(ymin, v))) / (ymax - ymin) * (H - mt - mb);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'GSNR versus launch power' });
  for (let v = ymin; v <= ymax; v += 5) { s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), class: 'grid' })); const t = sv('text', { x: ml - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = v; s.append(t); }
  for (let v = lo; v <= hi; v += 2) { const t = sv('text', { x: X(v), y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); t.textContent = (v > 0 ? '+' : '') + v; s.append(t); }
  const xl = sv('text', { x: (ml + W - mr) / 2, y: H - 6, class: 'ax', 'text-anchor': 'middle' }); xl.textContent = 'Launch power per channel (dBm)'; s.append(xl);
  s.append(sv('rect', { x: ml, y: Y(r.req), width: W - ml - mr, height: Math.max(0, Y(ymin) - Y(r.req)), class: 'failzone' }));
  const rl = sv('text', { x: W - mr - 4, y: Y(r.req) + 14, class: 'ax bad', 'text-anchor': 'end' }); rl.textContent = `Required OSNR ${f1(r.req)} dB: below this line the link fails`; s.append(rl);
  s.append(sv('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.p)},${Y(p.o)}`).join(' '), class: 'pl l-ase dashed' }));
  s.append(sv('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.p)},${Y(p.g)}`).join(' '), class: 'pl l-sig' }));
  const best = pts.reduce((a, b) => (b.g > a.g ? b : a));
  s.append(sv('circle', { cx: X(best.p), cy: Y(best.g), r: 5, class: 'dot-best' }));
  const bt = sv('text', { x: X(best.p), y: Y(best.g) - 12, class: 'ax strong', 'text-anchor': 'middle' }); bt.textContent = `optimum ${best.p > 0 ? '+' : ''}${best.p} dBm`; s.append(bt);
  if (r.gosnr != null && S.g.launch >= lo && S.g.launch <= hi) { s.append(sv('line', { x1: X(S.g.launch), x2: X(S.g.launch), y1: mt, y2: H - mb, class: 'nowline' })); s.append(sv('circle', { cx: X(S.g.launch), cy: Y(r.gosnr), r: 5, class: 'dot-now' })); }
  wrap.append(s, el('div', { class: 'legend' }, [lg('l-sig', 'GSNR (ASE + nonlinearity)'), lg('l-ase dashed', 'OSNR (ASE only, what an OSA shows)'), lg('dot-now-i', 'Current global launch power'),
    el('span', { class: 'muted', text: 'Too little power and amplifier noise wins. Too much and fiber nonlinearity wins. The top of the curve is the optimum. Only amplifiers in Auto mode follow the global launch power.' })]));
  wrap.append(loadChart(r));
  return wrap;
}
// Q margin against the number of channels lit (a uniform line), with the launch power fixed or re-optimised for each load
function loadChart(r) {
  const W = 900, H = 260, ml = 46, mr = 16, mt = 16, mb = 40, ns = [4, 8, 16, 24, 32, 48, 64, 80, 96].filter(n => n <= PHY.cBandSlots(+S.g.df * 1e9));
  const run = (n, re) => { const q = MODEL.simulate({ ...S, g: { ...S.g, plan: null, nch: n, reopt: re } }, undefined, { single: true, reverse: dir === 'rev' }); return q.qMargin; };
  const a = ns.map(n => run(n, false)), b = ns.map(n => run(n, true));
  const wrap = el('div', { class: 'chartwrap' });
  if (a.some(v => v == null) || ns.length < 3) return wrap;
  const all = a.concat(b), ymax = Math.ceil(Math.max(...all) + 0.5), ymin = Math.floor(Math.min(...all, 0) - 0.5), lo = ns[0], hi = ns[ns.length - 1];
  const X = v => ml + (v - lo) / (hi - lo) * (W - ml - mr), Y = v => mt + (ymax - Math.min(ymax, Math.max(ymin, v))) / (ymax - ymin) * (H - mt - mb);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Q margin versus number of channels, fixed and re-optimised launch power' });
  for (let v = Math.ceil(ymin); v <= ymax; v += Math.max(1, Math.round((ymax - ymin) / 6))) { s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), class: 'grid' })); const t = sv('text', { x: ml - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = v; s.append(t); }
  ns.forEach(n => { const t = sv('text', { x: X(n), y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); t.textContent = n; s.append(t); });
  const xl = sv('text', { x: (ml + W - mr) / 2, y: H - 6, class: 'ax', 'text-anchor': 'middle' }); xl.textContent = 'Channels lit (uniform line)'; s.append(xl);
  const yl = sv('text', { x: 12, y: mt + (H - mt - mb) / 2, class: 'ax', transform: `rotate(-90 12 ${mt + (H - mt - mb) / 2})`, 'text-anchor': 'middle' }); yl.textContent = 'Q margin (dB)'; s.append(yl);
  s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(0), y2: Y(0), class: 'nowline' }));
  s.append(sv('path', { d: a.map((v, i) => `${i ? 'L' : 'M'}${X(ns[i])},${Y(v)}`).join(' '), class: 'pl l-ase dashed' }));
  s.append(sv('path', { d: b.map((v, i) => `${i ? 'L' : 'M'}${X(ns[i])},${Y(v)}`).join(' '), class: 'pl l-sig' }));
  wrap.append(el('h3', { class: 'pad', text: 'As channels come and go' }), s, el('div', { class: 'legend' }, [lg('l-ase dashed', `Fixed launch (${f1(+S.g.launch)} dBm and amplifier targets)`), lg('l-sig', 'Re-optimised for the load on each span'),
    el('span', { class: 'muted', text: 'The fixed line is tuned for one load. The re-optimised line moves every amplifier to the GN optimum for the channels actually on the next span, so a lightly loaded line runs hotter and a full one cooler. Plans and per-span loads are ignored here: it is a uniform line with that many channels.' })]));
  return wrap;
}

// ---------- learn ----------
const LEARN = {
  osnr: ['OSNR', `<p><b>Optical signal-to-noise ratio</b> is signal power divided by the ASE noise power that sits in a 0.1 nm (12.5 GHz) slice next to it. It is what an optical spectrum analyzer or an OPM with OSNR shows.</p><p>Every amplifier adds noise. A useful rule of thumb for one EDFA, per channel: <code>OSNR ≈ 58 + P<sub>in</sub> − NF</code> (dB, P<sub>in</sub> in dBm per channel at the amp input). That is why a span with high loss hurts: the next amp sees a low input power. Noise from several amps adds in linear terms, so 10 identical amps cost 10 dB of OSNR versus one.</p><p>The 0.1 nm bandwidth is a convention, not the signal width. A 60 GBd signal is about 4.8× wider, so its in-band SNR is ~6.8 dB lower than its OSNR.</p>`],
  gsnr: ['GSNR', `<p><b>Generalized SNR</b> adds nonlinear interference (NLI) to ASE: <code>1/GSNR = 1/OSNR<sub>ASE</sub> + 1/OSNR<sub>NLI</sub></code>. NLI is noise-like distortion created in the fiber itself by the Kerr effect, it is invisible on an OSA because it sits under the signal.</p><p>This simulator uses the closed-form <b>GN model</b> (Poggiolini), the same family of physics used in TIP's open-source GNPy planning tool. NLI power grows with the cube of launch power, so doubling power (+3 dB) adds +9 dB of NLI.</p>`],
  q: ['Q-factor', `<p>The <b>Q-factor</b> is BER re-expressed on a dB scale that behaves linearly with SNR: <code>Q = 20·log<sub>10</sub>(√2 · erfc<sup>−1</sup>(2·BER))</code>. Coherent modules report it as a PM counter because it is much easier to trend than a BER.</p><p>BER 1e-2 ≈ Q 7.3 dB, BER 2e-2 ≈ Q 6.3 dB, BER 1e-3 ≈ Q 9.8 dB. One dB of extra SNR is roughly one dB of extra Q.</p>`],
  ber: ['Pre-FEC BER', `<p>The bit error rate <b>before</b> forward error correction. Coherent links run with a lot of errors on purpose, around 1 bit in 50–100 wrong, and the FEC cleans it up to essentially zero.</p><p>The FEC has a cliff. Below its threshold (CFEC for 400ZR: 1.22e-2; oFEC for ZR+: 2.0e-2) output is error-free. Above it, errors explode and the link drops. That is why you watch pre-FEC BER trending upward, not post-FEC.</p>`],
  margin: ['Margin', `<p><b>Q margin</b> = current Q − Q at the FEC threshold. It includes every impairment in the model: ASE, NLI, transceiver limits, filtering, Rx noise, overload and PMD.</p><p><b>OSNR margin</b> = current GSNR (0.1 nm) − the module's required OSNR (back-to-back). It is the classic planning number but ignores penalties added after the line.</p><p>Planners usually keep 2–3 dB for aging, repairs (each splice after a cut adds ~0.1–0.5 dB), and amplifier drift.</p>`],
  edfa: ['EDFA gain and noise figure', `<p>An EDFA gives gain but adds amplified spontaneous emission (ASE). <b>Noise figure</b> is how much it degrades the SNR passing through; 3 dB is the physical floor and 5 dB is typical.</p><p>Real amps have a gain range. At low gain the NF gets worse (modelled here), and if the span is shorter than the minimum gain the output runs hot: field fix is a pad (VOA) before the amp. Total output power is shared by every channel, so adding channels lowers per-channel power once you hit the limit.</p>`],
  span: ['Span loss and power budget', `<p>Span loss = length × attenuation (≈0.2 dB/km on SMF at 1550 nm) + connectors and splices. An 80 km span is ~17 dB.</p><p>An unamplified link only works if <code>Tx power − all losses ≥ Rx sensitivity</code>. 400ZR launches −10 dBm and needs about −12 dBm, so a passive mux pair plus fiber eats the budget fast. Amplified links trade the power budget for an OSNR budget.</p>`],
  nli: ['Nonlinear effects', `<p>Glass's refractive index shifts slightly with light intensity (Kerr effect). Channels modulate each other's phase: self-phase modulation, cross-phase modulation, four-wave mixing. Coherent DSP cannot undo most of it, so it acts like noise.</p><p>It grows with launch power cubed, with more channels, and with low dispersion (old NZ-DSF is worse than SMF). Large-core fiber (G.654.E) lowers γ and helps.</p><p><b>Dispersion map:</b> normally each span's nonlinear noise adds up as independent noise, because the signal has dispersed hugely between spans. When dispersion is cancelled between spans (an inline DCM) or is tiny (NZ-DSF), the noise from successive spans stays correlated and adds partly coherently, so it grows faster than the number of spans. That is why coherent links use uncompensated fiber. The model blends between the two with the dispersion accumulated before each span (fully coherent at 0, independent beyond about 400 ps/nm).</p>`],
  cd: ['Chromatic dispersion', `<p>Different wavelengths inside one channel travel at slightly different speeds (17 ps/nm/km on SMF). Coherent DSP undoes it digitally, so it costs no margin until you exceed the module's range: 400ZR handles ±2,400 ps/nm (~140 km SMF), ZR+ about 20,000.</p><p>Past that range the receiver cannot lock: link down, regardless of OSNR.</p><p><b>Direct-detection optics</b> (a 10G tunable SFP+ in a switch) have no DSP. Dispersion closes the eye gradually, so it costs SNR long before the rated limit (about 1600 ps/nm, ~95 km of SMF) and the link drops past it. Beyond about 80 km you need a dispersion compensation module (DCF or fiber Bragg grating, which add loss) or a coherent optic.</p>`],
  pmd: ['PMD / DGD', `<p>The two polarizations travel at slightly different speeds because fiber is not perfectly round. Mean differential group delay grows with √length. New fiber is ~0.05 ps/√km; some 1990s fiber is 0.5 or worse.</p><p>Coherent DSP tracks it, with a penalty that grows as you approach the tolerance.</p>`],
  filter: ['Filter narrowing', `<p>Every WSS pass rounds off the edges of the passband. A 60 GBd signal in a 75 GHz slot loses a little each pass; through many ROADMs it adds up. Squeezing a 64 GBd signal into a 50 GHz grid is a big penalty.</p>`],
  rx: ['Receiver power window', `<p><b>Overload is modelled everywhere light is received.</b> An amplifier has a <i>max total input</i> (all channels together, 10 dBm by default): above it an alarm names the amplifier and the Path hops table marks its row in red with a warning sign; well above it (3 dB) the alarm turns severe, because the input stage saturates and can be damaged. The OSC and 1310 nm receivers have overload points too: past it the link is warned, and 3 dB past it the link is down. The fix is the same everywhere: add a pad (VOA) in front of the receiver. </p><p>Coherent receivers mix the signal with a local oscillator laser. Too little light and receiver electronics noise takes over (Rx LOW). Too much and the photodiodes and ADCs saturate (Rx HIGH, overload). Far too little is LOS.</p><p>For amplified links the usual target is the middle of the window, set with the preamp or a pad.</p>`],
  client: ['Client ports and muxponders', `<p>A <b>transponder</b> carries one client signal over one coherent line port. A <b>muxponder</b> aggregates several client ports (for example 4 × 100GbE) into one line port (for example 400G ZR+). The line port is what the DWDM system sees. Everything upstream of it (host router, client optics) is a separate, short, grey-optics link.</p><p>Each client port has its own power budget: Tx power minus fiber and connector loss must land inside the module's Rx window. Too little and the client link is down. Too much (a long-reach optic on a short jumper) overloads the receiver and needs a pad. Running past rated reach adds dispersion penalty the model only flags.</p><p>The clients must also fit the line rate. 400ZR itself carries a single 400GbE client; OpenZR+ and OTN-based line modes can multiplex 100G and 200G clients.</p>`],
  plan: ['Channel plan', `<p>A real line carries a <b>mix</b>: 10G legacy channels, 100G and 400G coherent channels at different baud rates, on different grid slots and at slightly different powers. The Channels tab lets you place each one. Everything then follows from who sits where:</p><ul><li><b>Nonlinear noise</b> on a channel comes from itself and from every other channel, weighted by their power spectral densities and how far away they are. Edge channels see fewer neighbours than the centre; a narrow 10G channel next to wide 400G ones sees a different mix than the rest.</li><li><b>XPM on 10G channels</b> counts the neighbours within about 400 GHz and what they are (coherent neighbours hurt more).</li><li><b>Raman gain</b> depends on frequency, so the channels at the edge of the band get more or less than the one in the middle.</li><li><b>Rx power and margin</b> are evaluated against each channel's own receiver, so a 10G channel can be past its overload point on a line where the 400G channels are fine. A power offset fixes that.</li></ul><p>The service channel (the one the headline describes) always uses the transponder mode. Everything else uses the mode you choose.</p><p><b>Add/drop and mesh routing:</b> in a real ROADM network few channels ride the same path. Pick \"Add at\" and \"Drop at\" for a channel (any ROADM or transponder) and it is routed over the cabled network between them, so channels in one plan can take different routes. Each fiber carries only the channels whose routes cross it, so the amplifiers there carry fewer channels and the others see less nonlinear noise. A channel picks up ASE, nonlinear noise, dispersion and WSS passes only along its own route, so a one-span channel has a much better GSNR than an end-to-end one. At its drop ROADM it takes the drop port (one WSS pass instead of an express two, plus the drop structure and a drop amplifier); added channels start at the ROADM level with their own transmitter noise. Normally a channel takes the shortest route; \"Via\" forces it through a chosen ROADM, which is how a diverse or protection route gets planned (longer, so worse GSNR, but on different fibers). Cut a fiber and every channel reroutes, piling load onto the detour. <b>Wavelength assignment:</b> a slot can carry one channel per fiber, so two channels with no fiber in common may reuse the same slot (the slot number is editable), while two on a shared fiber collide: the later one is BLOCKED and stays dark. \"Assign slots\" runs first-fit: the service keeps its slot and every other channel, longest route first, takes the lowest slot free along its whole route. Reuse is what lets a mesh carry far more channels than the 64 slots of one fiber. <b>Converters:</b> \"Convert at\" picks a ROADM where the channel is regenerated into another slot (an O-E-O pair, or a wavelength converter). It splits the channel in two: each half has its own slot and route, starts clean at the converter (noise, dispersion and filter passes are reset) and is judged at its own receiver, so a long channel that would fail end to end can pass in two halves, and two halves can use slots that no single slot could offer along the whole route. The channel's status is its worst half. <b>Protection:</b> \"Protect 1+1\" lights a second copy of the channel on the shortest route that shares no fiber with the working one. Both copies load their fibers and need their slot free; the receiver uses the working copy until it fails. On a cut fiber (or, for the service, when the working route is down) traffic switches to the protection route at once, with no re-routing, and the channel runs unprotected (degraded) until repair. The protection route is longer and so has less margin: the tool tells you when it would not carry the service. Both sit beside restoration: an unprotected channel simply re-routes over whatever fibers are left. Try the \"Mesh\" and \"ROADM line with add/drop\" scenarios.</p>`],
  srs: ['SRS tilt', `<p><b>Stimulated Raman scattering</b>: light in the fiber acts as a weak Raman pump, so high-frequency (short-wavelength) channels give power to low-frequency ones. With a full C-band load at +1 dBm per channel it is worth roughly 1 dB of tilt per 80 km span, growing with total power, span length and occupied bandwidth.</p><p>Amplifiers with gain-tilt control (and ROADM WSSs) re-flatten the band, so tilt does not pile up. Switch tilt control off on the long-haul scenario to watch it accumulate. The service channel sits mid-band and barely moves, so the <i>worst channel</i> Q margin tracks the highest-frequency channel, which ends up weakest. The model is a first-order approximation, not a measurement.</p>`],
  raman: ['Raman amplification', `<p>A <b>Raman pump</b> at the receiving end (about 1450 nm, backward) transfers power to the signal along the fiber itself. Unlike an EDFA, the gain is <i>distributed</i>: the signal is boosted before it has fallen as far, so less ASE-limited OSNR is lost. A 1 W pump gives roughly 15 dB of on-off gain on 80-110 km of SMF.</p><p>The trade-off: the signal stays stronger for longer, which raises nonlinear noise, and above ~1 W the pump is a Class 4 laser (eye safety, fiber fuse on a dirty connector). Here the benefit is modelled as a lumped amplifier sitting late in the span (about 40% of the on-off gain counts as OSNR benefit) with a 4.5 dB equivalent noise figure. The model includes pump depletion (small on lossy spans, where the signal near the pump is weak), a gain spectrum (a triangular Raman gain curve against pump detuning, so channels at different frequencies get different gain; the ripple falls from 1 to 2 to 3 pump wavelengths), double Rayleigh scattering (noise that grows with the square of the gain, so it only bites above roughly 15 to 18 dB), and forward or bidirectional pumping: a forward pump lifts the signal over the first ~20 km, so ASE improves but nonlinearity gets much worse, and bidirectional is usually best. Pump-to-pump power transfer and a full coupled-wave solver are not modelled.</p><p>Set it on a fiber span in the inspector. Try 110 km with 0, 500 and 1000 mW and watch ASE and NLI move in opposite directions in the "What is eating the SNR" bar.</p>`],
  bidi: ['Two directions', `<p>A DWDM line is really <b>two</b> fibers (or two wavelength bands on one) carrying traffic in opposite directions, with <b>one amplifier per direction</b>. A box labelled "BST-A" holds the booster for A to Z and the preamp for Z to A. The results panel shows both: pick the direction with the buttons by the status pill. The service status is the worse of the two.</p><p>Directions differ when one fiber has a dirtier connector, a different loss, a different Raman pump, or an amplifier that is set up for the other direction. Cable-wise a transmitter's launch and a receiver's input both depend on which role the amplifier plays, so an amp tuned as a booster is often wrong as a preamp: use the "return direction" fields on amplifiers and fibers.</p><p>A fiber can also be set to carry one direction only (inspector, "Carries light"). Then each direction routes separately: A to Z can take the short way round a ring while Z to A takes the long way, and a one-way fiber with no return path takes the service down. A DCM and an amplifier's gain range, noise figure and output limit also have return-direction fields.</p><p>Counter-propagating signals barely interact nonlinearly because they walk through each other too fast, so each direction is simulated independently.</p>`],
  xpm: ['Cross-phase modulation', `<p><b>XPM</b> is the nonlinear effect where the intensity of one channel changes the phase of its neighbours. A coherent receiver sorts out phase, but a <b>direct-detection</b> receiver (a 10G NRZ optic) turns phase wobble into amplitude errors after dispersion, so legacy 10G channels are the ones that suffer, especially beside wide, high-power coherent channels.</p><p>The penalty here grows with the number of neighbours inside about 400 GHz, with launch power and with effective fiber length, summed over spans. The "Neighbouring channels" setting (inspector, nothing selected) chooses between same-type and coherent neighbours. Real fixes: lower the launch power, leave a gap of empty slots around the 10G channels, or give them their own band. The numbers are representative, not a full XPM model.</p>`],
  resil: ['Protection, switching time and availability', `<p>A fiber cut takes every channel on it down. What happens next depends on how the channel is protected.</p><ul><li><b>Unprotected:</b> the control plane notices, finds another route, and the ROADMs and amplifiers are reconfigured: tens of seconds to minutes. If there is no other route it stays down until the splice is repaired (hours).</li><li><b>1+1 dedicated:</b> a second copy of the signal is lit on a route that shares no fiber with the first; the receiver just picks the survivor after loss detection and a switch (tens of milliseconds). It costs the second route's wavelength and amplifier power all the time.</li><li><b>1:N shared:</b> the protection route is dark and may be shared by several channels whose working routes cannot fail together, so it costs nothing in normal operation, but it has to be lit after the failure: a second or more. Its margin is predicted by simulating the failure.</li><li><b>Wavelength converters:</b> regenerate a channel into another slot, resetting its noise; a protected converted channel is protected on each side of the converter separately.</li></ul><p>The Resilience tab turns cut rate, repair time and these switching times into expected downtime per year: each cut on the route happens at the cut rate times its length, then costs the switching or restoration time, plus the chance that both routes are down at once (the product of their unavailabilities, which is why a longer protection route matters less than its existence).</p>`],
  fail: ['Failures other than fiber cuts', `<p>Fibers are not the only thing that breaks. Select any device and set its <b>Condition</b>.</p><ul><li><b>Failed:</b> the device passes no light (a dead amplifier pump absorbs the signal, a ROADM loses power, a transponder goes dark). Routes avoid it: an unprotected channel restores around it if the network has another way, a 1+1 or shared protected channel switches to its protection route, and a service with no way round shows LOS and names the device. Channels that start or end at a failed ROADM are lost.</li><li><b>Degraded:</b> still lit but worse. An amplifier's output falls below its setting and its noise figure rises (pump ageing); a laser is weaker; a receiver loses SNR; a ROADM, mux, VOA or DCM adds loss (a partly stuck WSS or a dirty connector). Amplifiers downstream re-level the power, so what you see is mostly extra noise.</li></ul><p><b>Shared risk link groups:</b> two fibers in the same duct or trench do not fail independently. Give them the same group name on the cable inspector and cutting one cuts all of them. Protection planning then looks for a route that avoids the whole group, which is often a lot longer than the fiber-disjoint route that happens to share a trench. Try the \"Shared duct\" scenario.</p><p><b>Passive OADMs:</b> an optical add/drop multiplexer is a fixed filter with add/drop ports. Give it sides: <b>East and West</b> is a node in the middle of a line with a line port each way, <b>East only</b> or <b>West only</b> is a line terminal. Each side serves a block of channels (its ports, starting at a slot you choose), and a transponder is plugged into one of those ports like on a mux: it talks to that side's line only and has to be tuned to its port's slot. Every other slot passes straight through at a small loss, with no WSS, no equalisation and no amplifier, but a slot a side serves cannot pass the OADM (the filter drops it, or it would collide with the channel added there). A channel added at an OADM leaves at the transponder's power less the add loss, so it can sit above or below the channels already on the line. An optional <b>1310 nm port</b> puts a coupler on the line path (a little extra loss) for management, an optical supervisory channel or a legacy client. Try the \"Passive OADM bus\" scenario.</p><p><b>Ports and cards:</b> a ROADM or a passive mux can also lose a single add/drop port, or a whole card of 8 ports. Only the channels that join or leave the line through those ports go dark; the other channels, the amplifiers and the device itself carry on. A 1+1 service whose protection route avoids the failed device switches over. Try the \"Two muxponders per side\" scenario: fail a port on MUX-B and only that wave is lost.</p><p>The Resilience tab includes device failures (a rate per amplifier or ROADM): a device that has to be passed (the access ROADM of a single-homed transponder) costs the full repair time, an interior one costs only the switch or restoration time if another route avoids it.</p>`],
  odf: ['Patch panels and dirty connectors', `<p>A <b>patch panel</b> (ODF) is where fibers end and patch cords begin. Every port joins a <b>rear</b> connector (usually the outside plant) to a <b>front</b> connector (the patch cord to equipment). Light enters one side of a port and leaves the other side of the <i>same</i> port; it cannot cross from one port to another.</p><p>Each mated connector pair costs a little loss, about 0.3 to 0.75 dB, so a line with several panels spends a real part of its budget on them. The loss is in the hop-by-hop table as the panel's gain.</p><p>The classic fault is a <b>dirty or damaged connector</b>: it can cost 1 to 3 dB or more, and it is the first thing to check when a link is short of margin. Mark ports as dirty in the panel's inspector (for example 1=1.8) and the extra loss shows up on that hop with a warning; clear it with \"Clean every connector\" and watch the margin come back. Try the \"Patch panels\" scenario.</p>`],
  olp: ['Splitter, tap and optical switch', `<p>A <b>splitter</b> has a common port and two branches (A and B). Light goes between the common port and either branch, never straight from one branch to the other, and each branch gets its share of the power: a 50/50 costs about 3.3 dB per branch, a <b>99/1 tap</b> costs the main branch 0.3 dB and gives the monitor port 1% (about -20 dB). The inspector shows what the monitor port would read.</p><p>An <b>optical switch</b> also has a common port and two ports (A and B) but passes only the <i>selected</i> one, for about 1 dB. Set it to <b>auto-switch</b> and it moves to the other port when the selected one loses its light; set it to manual and it stays where it is until you move it.</p><p>Put a splitter at one end and a switch at the other and you have <b>optical line protection</b>: the splitter lights two fibers, the switch picks one. Cut the fiber the switch is on: auto rides through it (the availability estimate uses the detection plus the switch time instead of the control plane's restoration time), manual goes dark. The route is chosen with the splitter and switch rules, so a path can only use the selected port (or either, if auto). Limits: the branch the switch is not on is lit but is not counted as load on its fibers, and there is no revertive switching.</p><p>Try the \"Optical line protection\" scenario: cut the 60 km fiber, then set the switch to manual.</p>`],
  bidi: ['Single fiber (BiDi)', `<p>Normally a link is a pair of fibers: one for each direction, so both ends can use the <b>same wavelength</b>. On a <b>single fiber</b> both directions share one glass, so each direction needs <b>its own wavelength</b> or they would interfere.</p><p>Mark a fiber span <b>Single fiber</b> and a channel needs a slot there and another on the way back (the \"Slot back\" column). A <b>BiDi mux or OADM</b> does it with bands: every port passes a pair of slots, one in a low band and one in a high band. The device's <b>role</b> says which band its transponders transmit; the far end has to be the opposite. A transponder on such a port transmits one slot and listens on another (<b>Receive wavelength</b>, normally Auto).</p><p>Pairing then needs each end to transmit what the other listens on. If both ends are on the same band the Channels tab says so (\"both transmit on slot 31 ... each end needs its own wavelength\"); a wrong receive slot, or a far end that is not BiDi, is reported too. Single-fiber systems are usually unamplified, with 10G BiDi optics over short distances. Try the \"Single-fiber bus\" scenario, then flip the role of one end.</p>`],
  reach: ['Hosts and reachability', `<p>A <b>Host / router</b> is where traffic starts and ends. Give it an address (for example 10.0.0.1/24), a port speed, and cable a port to a <b>transponder</b> or to a <b>muxponder client port</b>. The <b>Reachability</b> tab then asks, for every pair of hosts, whether a packet could get across the optical network, and shows the trace step by step so the first thing that fails is obvious.</p><ul><li><b>Client side:</b> the host port speed has to match the transponder's rate or the muxponder client optic, and the client link has to have optical margin.</li><li><b>Line side:</b> the two transponders must be lit and paired (right port, right slot, same mode), the channel between them must be up, and a muxponder client port is carried to the <i>same-numbered</i> client port on the far muxponder.</li><li><b>Addresses:</b> hosts on different subnets cannot reach each other, because there is no router, and two hosts cannot share an address.</li></ul><p>Latency is propagation in glass (about 4.9 µs per km) plus the DSP and FEC delay of the transceivers (about 10 µs each for a coherent one). The traffic table offers Gb/s between hosts; a flow is capped by its host port and client optic, and flows that share a channel are scaled down together when they exceed the line rate. Try the \"Hosts reaching each other\" scenario and break it: change a host's port speed, cut the fiber, mistune a transponder, or give two hosts different subnets.</p>`],
  otdr: ['Power meter and OTDR', `<p>Two instruments plug into a <b>test point</b>: a port of a patch panel (the rear or front of a numbered port, picked in the cable inspector), or a port of a splitter or switch.</p><p>The <b>power meter</b> reads the C-band service light at that port, as total power and per channel, against a range of -50 to +10 dBm. Below the floor it reads <b>LOW</b>; above the top it reads <b>OVER</b>, which is what a meter does when it is plugged into a booster's output: a real meter can be damaged by that. A tap port reads the input less its split loss. A port the service light does not pass reads nothing.</p><p>The <b>OTDR</b> sends a pulse at 1625 nm through the test point and plots the backscatter against distance (the OTDR tab). The slope is the fiber loss (about 10% more than at 1550 nm); each step is an event: a connector or splice, a dirty connector (more loss and a bigger reflection), a splitter, a switch. A <b>break</b> is a reflective end at the cut position (set it in the cable inspector); an open connector is a reflective end too. Amplifiers, muxes and ROADMs do not pass the pulse, so it is reflected there.</p><p>The <b>pulse width</b> trades range against resolution. A short pulse sees events a metre apart but its dynamic range is small (12 dB at 10 ns, so the trace sinks into the noise after about 45 km); a long pulse reaches further but events closer than its <b>dead zone</b> merge into one. Try the OTDR scenario: at 300 ns the dirty connector, the joint and the patch cord at 60 km are one event; the meter on the same port reads the loss they add.</p>`],
  b1310: ['Supervisory channel and 1310 nm ports', `<p>Two kinds of out-of-band light can ride an OADM.</p><p>The <b>optical supervisory channel (OSC)</b> sits at <b>1510 nm</b>, outside the C band, and carries management traffic between sites. Every amplifier and ROADM on the line has a filter that drops it, regenerates it and adds it again, so the OSC is judged <b>span by span</b>: fiber at about 0.25 dB/km, a patch panel port or two, and a 1 dB filter at each end, against a receiver that needs about -28 dBm. A chain of working spans is one <b>management domain</b>. A passive mux, splitter or switch has no OSC filter and ends the chain. A dead amplifier breaks it, and so does a cut.</p><p>The <b>1310 nm port</b> is for a legacy grey client optic (10GBASE-LR and the like). Nothing regenerates it, so it sees only fiber at 0.35 dB/km, patch panels (and their dirty connectors) and the 0.6 dB couplers; amplifiers, ROADMs and muxes block it, and both ends must carry the same optic.</p><p>The Reachability tab lists every span and link. Try the \"Supervisory channel\" scenario: the amplifier regenerates the OSC but blocks the 1310 nm client, and the dirty connector eats the margin of the 1310 nm link.</p>`],
  ports: ['Mux ports and wavelengths', `<p>A passive mux or demux has a numbered <b>port for every channel</b>. Cable a transponder to the mux and the cable takes the first free port; the cable inspector lets you move it to another. Port <i>k</i> passes slot <i>first + k − 1</i> (set \"First slot\" and the port count on the mux).</p><p>The transponder has a <b>Wavelength</b> setting. <b>Auto</b> follows the port it is plugged into. Choose a slot and the transponder is tuned there instead. A mux filter only passes its own port's slot, so a transponder tuned to a different slot is <b>dark</b>: its light is blocked and the Channels tab says why.</p><p>The channels are then whatever the cabling makes. A transmitter that gets through its port reaches the receiver plugged into the port for the same slot on a mux at the other end, and the pair is one channel. Both ends need the same mode. A transponder with nobody at the far end of its slot is dark too. The channel count on the left still fills the rest of the line with background channels, in the free slots nearest the lit ones, so the amplifiers see a realistic load.</p><p>A <b>ROADM</b> has ports too, with three settings: <i>colorless</i> (any port takes any slot), <i>directionless</i> (any port can reach any degree) and <i>contentionless</i> (the same slot on more than one port). Switch them off one at a time to see what each buys you: a colored port passes one slot, a port on a non-directionless ROADM belongs to one degree, and two transponders on a non-contentionless ROADM cannot use the same slot. When several transponders share a slot (wavelength reuse in a mesh), set a transponder's <b>Connect to</b> to say which far end it talks to. Per-channel results appear on the Channels tab (read-only here; \"Edit as a table\" turns them into a normal plan). A transponder can also set <b>Line protection</b> (1+1 or 1:N shared) and a <b>Convert at</b> ROADM for its channel; with a converter the two ends are in different slots, so name the partner with Connect to. Try the \"Transponders on mux ports\" scenario, then change the wavelength of one transponder.</p>`],
  raman2: ['Raman solver', `<p>The <b>coupled-wave solver</b> treats every pump wavelength and a sample of the channels as waves in the fiber, each with its own attenuation, and lets higher-frequency waves feed lower-frequency ones through the Raman gain curve: <code>±dP<sub>i</sub>/dz = −α<sub>i</sub>P<sub>i</sub> + P<sub>i</sub> Σ<sub>j above</sub> c(Δf) P<sub>j</sub> − P<sub>i</sub> Σ<sub>j below</sub> (f<sub>i</sub>/f<sub>j</sub>) c(Δf) P<sub>j</sub></code>. Forward waves are integrated from the start of the span and backward ones from the end, alternately, until the profiles settle. Photon number is conserved. This gives what the closed-form approximation cannot: <b>pump-to-pump transfer</b> (the short-wave pump of a multi-wavelength pump feeds the long-wave one), <b>depletion</b> as the signals grow, the real <b>gain spectrum</b> and the <b>power profile along the span</b> for forward, backward and bidirectional pumping, and signal-to-signal transfer (SRS tilt) in the span.</p><p>Turn it on per fiber in the cable inspector (Raman model). The gain at the service channel, the stage split between forward and backward pumps, the pump depletion and the per-channel gain differences then come from the solver; the noise is still modelled as the equivalent lumped amplifier and double Rayleigh scattering from the gain. The Raman tab plots the profile and the gain spectrum for each pumped span.</p>`],
  trans: ['Power transients', `<p>An EDFA amplifies all channels from one pool of inverted erbium ions. If many channels vanish suddenly (an upstream fiber cut, a protection switch, a failed transponder), the pool no longer has to feed them, so the gain per surviving channel jumps toward <code>10·log<sub>10</sub>(N / survivors)</code> within about a hundred microseconds. A fast gain-control loop (AGC) cancels most of it; a slow one does not. In a cascade of amplifiers each one adds its excursion, so the surviving channels can surge by many dB by the end of the line, into receiver overload and into nonlinearity (3 dB of nonlinear noise for each dB of power), and dip equally when the channels come back.</p><p>That is why added channels are ramped up slowly and why long amplified systems need fast gain control on every amplifier. The Transients tab evaluates a sudden loss of a share of the channels along the service path with the response time of each amplifier. Raman pumps and WSS blocking are not modelled.</p>`],
  aging: ['End-of-life margin', `<p>Links are planned for the day they are worst, not the day they are lit. <b>End of life</b> here adds extra loss on every fiber span (splices from repairs, connector wear, fiber ageing; 1.0 dB by default) and a transceiver ageing penalty (0.5 dB by default). Both are editable in the inspector when nothing is selected. It then re-runs the whole simulation.</p><p>A link with a few dB of margin today can have none left at end of life. The "works today but fails at end of life" alarm is the early warning. Typical planning margin is 2-3 dB.</p>`],
  launch: ['Launch power', `<p>The per-channel power put into each span. Too low: amplifier noise dominates. Too high: nonlinearity dominates. Somewhere in between (often 0 to +2 dBm/ch for 60 GBd on SMF) GSNR peaks. Open the Launch sweep tab to see your link's curve.</p><p><b>Re-optimisation:</b> the optimum is not one number for the whole line. It depends on each span's loss and on how many channels are lit on it, so when channels are added or dropped it moves. Switch "Launch power" to re-optimised in the inspector (nothing selected) and every amplifier with a blank output target sets <code>P = (A / 2η)^(1/3)</code>, the GN optimum for the span after it, where A is the amplifier noise and η the nonlinear coefficient of that span at its current load. The sweep tab shows margin against channels lit for a fixed and a re-optimised line. The total-output limit of the amplifier still applies, and Raman gain is not included in the optimum.</p>`],
};
let learnTopic = 'osnr';
function learn(t) { learnTopic = t; tab = 'learn'; renderTabBody(); $('#tabs').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
// The topics in five groups, with a filter box that matches the title or the text of an article
const LEARN_GROUPS = [['Basics', ['osnr', 'gsnr', 'q', 'ber', 'margin', 'rx', 'span', 'launch', 'aging']], ['Impairments', ['edfa', 'nli', 'cd', 'pmd', 'filter', 'srs', 'xpm', 'raman', 'raman2', 'trans']],
  ['Channels and clients', ['plan', 'client', 'ports', 'reach']], ['Cabling and instruments', ['odf', 'olp', 'bidi', 'b1310', 'otdr']], ['Protection and failures', ['resil', 'fail']]];
let learnFilter = '';
function learnView() {
  const keys = Object.keys(LEARN), grouped = new Set(LEARN_GROUPS.flatMap(g => g[1])), groups = [...LEARN_GROUPS.map(([n, ks]) => [n, ks.filter(k => LEARN[k])]), ['More', keys.filter(k => !grouped.has(k))]].filter(g => g[1].length);
  const text = {}; for (const k of keys) text[k] = (LEARN[k][0] + ' ' + LEARN[k][1].replace(/<[^>]+>/g, ' ')).toLowerCase();
  const nav = el('nav', { class: 'lnav', 'aria-label': 'Learn topics' }), chips = [];
  const find = el('input', { type: 'search', class: 'lfind', placeholder: 'Filter topics', 'aria-label': 'Filter the Learn topics', value: learnFilter });
  const none = el('p', { class: 'muted small', text: 'No topic matches.', hidden: true });
  nav.append(find);
  for (const [gname, ks] of groups) {
    const head = el('div', { class: 'lgroup', text: gname }), body = [];
    nav.append(head);
    for (const k of ks) {
      const chip = el('button', { class: 'chip', 'aria-pressed': k === learnTopic, onclick: () => { learnTopic = k; renderTabBody(); } }, [LEARN[k][0], k === 'osnr' ? el('small', { class: 'muted', text: ' · start here' }) : null]);
      nav.append(chip); body.push(chip); chips.push([k, chip, head, body]);
    }
  }
  nav.append(none);
  const apply = () => { // hide the topics that do not match, and a group with none left
    const q = learnFilter.trim().toLowerCase(), shown = new Map();
    for (const [k, chip, head] of chips) { const ok = !q || text[k].includes(q); chip.hidden = !ok; shown.set(head, (shown.get(head) || 0) + (ok ? 1 : 0)); }
    for (const [head, n] of shown) head.hidden = n === 0;
    none.hidden = !q || [...shown.values()].some(n => n > 0);
  };
  find.addEventListener('input', () => { learnFilter = find.value; apply(); }); apply();
  const pick = el('select', { class: 'lpick', 'aria-label': 'Learn topic' });
  for (const [gname, ks] of groups) { const og = el('optgroup', { label: gname }); for (const k of ks) og.append(el('option', { value: k, text: LEARN[k][0] })); pick.append(og); }
  pick.value = learnTopic;
  pick.addEventListener('change', () => { learnTopic = pick.value; renderTabBody(); });
  return el('div', { class: 'learn' }, [pick, nav, el('article', {}, [el('h3', { text: LEARN[learnTopic][0] }), el('div', { html: LEARN[learnTopic][1] })])]);
}

// ---------- misc ----------
let toastT, srLast = '';
function toast(t, action) { // an action ({label, fn}) stays longer so there is time to use it
  const e = $('#toast'); e.textContent = t; e.hidden = false;
  if (action) e.append(el('button', { class: 'toast-act', text: action.label, onclick: () => { e.hidden = true; action.fn(); } }));
  clearTimeout(toastT); toastT = setTimeout(() => (e.hidden = true), action ? 7000 : 2600);
}
function recompute() { MODEL.assignSides(S); lastRes = simulate(); refreshHostFaults(); renderCanvas(); renderResults(); save(); }
function renderAll() { MODEL.assignSides(S); lastRes = simulate(); refreshHostFaults(); bindGlobals(); renderCanvas(); renderInspector(); renderResults(); save(); }
window.addEventListener('resize', applyView);

load();
setTool('select');
requestAnimationFrame(() => { fitView(true); renderAll(); });
})();
