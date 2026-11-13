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
const group = new Set(); // several devices selected at once (Shift-click, Shift-drag a box, Ctrl+A); a single selection is `sel`
let clip = null, pasteN = 0; // the copied devices and cables, and how many times they have been pasted since
let expert = false; try { expert = localStorage.getItem('lightpath-expert') === '1'; } catch (e) { /* no storage */ }
// an advanced field shows only in Expert mode, unless it holds a value of its own (a hidden setting must never change the result unseen)
const adv = (f, set) => { if (!set) f.classList.add('adv'); return f; };
const isSet = v => v !== '' && v != null;
const KEY = 'lightpath-v1', OLD_KEY = 'optical-lab-v1'; // the app was called Optical Line Lab: still read its saved lab
let firstRun = false;
function load() {
  try {
    const t = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (t) { const o = JSON.parse(t), v = o && o.view; S = { ...MODEL.sanitize(o), view: v && isFinite(v.k) && isFinite(v.x) && isFinite(v.y) && v.k > 0 ? { x: v.x, y: v.y, k: v.k } : { x: -40, y: -60, k: 1 } };
      try { const l = JSON.parse(localStorage.getItem(LAB_KEY)); if (l && PRESETS[l.key]) { labKey = l.key; labHash = l.hash; } } catch (e) {} // which scenario it started as
      return; }
  } catch (e) { /* corrupt or outdated save: fall through to the default scenario */ }
  firstRun = true;
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
  labKey = k; labHash = null; sel = null; if (chal.active) { chal.active = ''; saveChal(); } if (!quiet) { fitView(); checkpoint(); renderAll(); toast('Loaded: ' + PRESETS[k].name, { label: 'Undo', fn: undo }); }
}
const node = id => S.nodes.find(n => n.id === id);
const link = id => S.links.find(l => l.id === id);
const linksOf = id => S.links.filter(l => l.a === id || l.b === id);
const linkName = l => MODEL.mkGraph(S).linkName(l);
const simulate = (launchOverride, opts) => MODEL.simulate(S, launchOverride, opts);
const reqOsnr = MODEL.reqOsnr;

