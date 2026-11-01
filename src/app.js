// ===== App =====
(() => {
const { db, lin } = PHY;
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, kids = []) => {
  const e = document.createElement(tag);
  for (const k in attrs) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }
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
    if (t) { const o = JSON.parse(t), v = o && o.view; S = { ...MODEL.sanitize(o), view: v && isFinite(v.k) && isFinite(v.x) && isFinite(v.y) && v.k > 0 ? { x: v.x, y: v.y, k: v.k } : { x: -40, y: -60, k: 1 } }; return; }
  } catch (e) { /* corrupt or outdated save: fall through to the default scenario */ }
  applyPreset('dci', true);
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
function applyPreset(k, quiet) {
  const p = PRESETS[k].build();
  S = { nodes: p.nodes, links: p.links, g: p.g, svc: p.svc, view: { x: -40, y: -60, k: 1 } };
  sel = null; if (!quiet) { fitView(); renderAll(); toast('Loaded: ' + PRESETS[k].name); }
}
const node = id => S.nodes.find(n => n.id === id);
const link = id => S.links.find(l => l.id === id);
const linksOf = id => S.links.filter(l => l.a === id || l.b === id);
const linkName = l => MODEL.mkGraph(S).linkName(l);
const simulate = (launchOverride, opts) => MODEL.simulate(S, launchOverride, opts);
const reqOsnr = MODEL.reqOsnr;

// ---------- canvas ----------
const svg = $('#cv'), gRoot = $('#world');
function fitView() {
  if (!S.nodes.length) return;
  const xs = S.nodes.map(n => n.x), ys = S.nodes.map(n => n.y);
  const r = svg.getBoundingClientRect();
  const w = Math.max(...xs) - Math.min(...xs) + 220, h = Math.max(...ys) - Math.min(...ys) + 200;
  const k = Math.min(1.4, Math.max(0.15, Math.min(r.width / w, r.height / h)));
  S.view = { k, x: (Math.min(...xs) + Math.max(...xs)) / 2 - r.width / 2 / k, y: (Math.min(...ys) + Math.max(...ys)) / 2 - r.height / 2 / k };
}
function applyView() { gRoot.setAttribute('transform', `scale(${S.view.k}) translate(${-S.view.x},${-S.view.y})`); }
function toWorld(cx, cy) { const r = svg.getBoundingClientRect(); return { x: (cx - r.left) / S.view.k + S.view.x, y: (cy - r.top) / S.view.k + S.view.y }; }

function nodeShape(n) {
  const g = sv('g', { class: 'node t-' + n.type + (n.p && n.p.fail === 'dead' ? ' failed' : n.p && n.p.fail === 'degraded' ? ' degraded' : '') + (sel && sel.id === n.id ? ' sel' : ''), 'data-id': n.id, transform: `translate(${n.x},${n.y})`, tabindex: 0 });
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
let dir = 'fwd'; // which direction the results panel shows: forward (A to Z) or return (Z to A)
const view = () => (dir === 'rev' && lastRes && lastRes.rev && lastRes.rev.mode ? lastRes.rev : lastRes);
function renderCanvas() {
  gRoot.innerHTML = '';
  const vr = view(), onPath = new Set(vr && vr.path ? vr.path.links : []);
  const lg = sv('g'), ng = sv('g'), og = sv('g');
  const hc = hiChan && S.g.plan && vr && vr.channels ? vr.channels[S.g.plan.indexOf(hiChan)] : null, hiLinks = new Set(hc ? hc.routeLinks : []), hiNodes = new Set(hc ? hc.routeNodes : []), sb = hc && hc.protection ? (hc.protection.active === 'work' ? hc.protection.protect : hc.protection.work) : null, stbyLinks = new Set(sb ? sb.routeLinks : []);
  for (const l of S.links) {
    const a = node(l.a), b = node(l.b); if (!a || !b) continue;
    const cutNow = MODEL.isCut(S, l);
    const g = sv('g', { class: 'link k-' + l.kind + (cutNow ? ' cut' : '') + (sel && sel.id === l.id ? ' sel' : ''), 'data-id': l.id });
    g.append(sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'hit' }));
    g.append(sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'wire' }));
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
      t.textContent = (l.kind === 'fiber' ? `${l.p.len} km · ${f1(fb.att * l.p.len + +l.p.extra)} dB` + (+l.p.raman > 0 ? ` · Raman ${l.p.raman} mW` : '') + (l.p.srlg ? ` · ${l.p.srlg}` : '') : 'patch') + arrow;
      g.append(t);
      if (cutNow) { const x = sv('text', { x: mx, y: my + 7, class: 'cutmark', 'text-anchor': 'middle' }); x.textContent = '✕'; g.append(x); }
    }
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
svg.addEventListener('pointercancel', e => { endPointer(e); drag = null; $('#rubber').setAttribute('visibility', 'hidden'); });
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
svg.addEventListener('wheel', e => {
  e.preventDefault();
  const w = toWorld(e.clientX, e.clientY), k = Math.min(2.5, Math.max(0.15, S.view.k * Math.exp(-e.deltaY * 0.0015)));
  const r = svg.getBoundingClientRect();
  S.view = { k, x: w.x - (e.clientX - r.left) / k, y: w.y - (e.clientY - r.top) / k }; applyView();
}, { passive: false });
svg.addEventListener('dblclick', e => { const nEl = e.target.closest('.node'); if (nEl && isEnd(node(nEl.dataset.id))) setEnd(nEl.dataset.id); });

function connect(a, b, kind) {
  if (S.links.some(l => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id))) return toast('Those two are already connected.');
  for (const n of [a, b]) if (linksOf(n.id).length >= TYPES[n.type].maxLinks) return toast(`${n.name} has no free port. ${TYPES[n.type].label}s have ${TYPES[n.type].maxLinks === 1 ? 'one line port' : 'an input and an output'}.`);
  const l = { id: uid('l'), a: a.id, b: b.id, kind, p: linkDefaults(kind) };
  S.links.push(l); select({ kind: 'link', id: l.id }); toast(`${kind === 'fiber' ? 'Fiber span' : 'Patch cord'}: ${a.name} ↔ ${b.name}`);
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
  if (sel.kind === 'node') { S.nodes = S.nodes.filter(n => n.id !== sel.id); S.links = S.links.filter(l => l.a !== sel.id && l.b !== sel.id); }
  else S.links = S.links.filter(l => l.id !== sel.id);
  sel = null; renderAll();
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
  it.addEventListener('click', () => { const r = svg.getBoundingClientRect(); const w = toWorld(r.left + r.width / 2 + (Math.random() - 0.5) * 80, r.top + r.height / 2 + (Math.random() - 0.5) * 60); addNode(it.dataset.type, w.x, w.y); });
});
svg.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
svg.addEventListener('drop', e => { e.preventDefault(); const t = e.dataTransfer.getData('text/plain'); if (TYPES[t]) { const w = toWorld(e.clientX, e.clientY); addNode(t, w.x, w.y); } });
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
function setTool(t) { tool = t; pendingCable = null; document.querySelectorAll('.tool').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t)); svg.dataset.tool = t; }
document.addEventListener('keydown', e => {
  if (e.target.closest('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
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
function renderInspector() {
  const box = $('#insp'); box.innerHTML = '';
  if (!sel) {
    box.append(el('h3', { text: 'Inspector' }), el('p', { class: 'muted', html: 'Select a device or a cable to edit it. <b>Double-click</b> a transponder to make it an end of the service under test.' }));
    S.g.eolSpan ??= PHY.EOL.spanLoss; S.g.eolTrx ??= PHY.EOL.trxPen;
    S.g.neighbors ??= 'same';
    S.g.reopt = S.g.reopt === true;
    box.append(el('h3', { text: 'Line loading' }), field('Launch power', selIn(S.g, 'reopt', [['false', 'Fixed: amplifier targets and the global launch'], ['true', 'Re-optimised for the load on each span']]), 'Re-optimised: every amplifier whose output target is blank sets the GN-optimal power for the span after it, given the channels actually lit there, so the setting follows channels as they are added and dropped. Amplifiers with an explicit target keep it.'), field('Neighbouring channels', selIn(S.g, 'neighbors', [['same', 'Same type as the service'], ['coh', '60 GBd coherent channels']]), 'Only matters for direct-detection optics (10G DWDM): cross-phase modulation from neighbours is stronger when they are wide coherent channels.'));
    box.append(el('h3', { text: 'End-of-life allowances' }), field('Extra loss per fiber span (dB)', numIn(S.g, 'eolSpan', 0.1, 0, 5)), field('Transceiver ageing (dB)', numIn(S.g, 'eolTrx', 0.1, 0, 3)),
      el('p', { class: 'muted small', text: 'Used for the end-of-life margin: repairs, connector wear and laser ageing. Typical planning values are 0.5 to 1.5 dB per span.' }));
    S.g.lossPct ??= PHY.TRANSIENT.lossPct; S.g.agcUs ??= PHY.TRANSIENT.agcUs;
    box.append(el('h3', { text: 'Transients' }), field('Channels lost at once (%)', numIn(S.g, 'lossPct', 5, 1, 95), 'The event the Transients tab analyses: this share of the channels vanishes at every amplifier together (an upstream cut, a protection switch). The service survives.'), field('Amplifier control response (µs)', numIn(S.g, 'agcUs', 5, 0, 5000), 'How fast an amplifier\'s gain control reacts. About 10 to 50 µs is a fast AGC loop; milliseconds is slow and lets the surge through. A single amplifier can override it.'));
    S.g.cutRate ??= MODEL.RESIL.cutRate; for (const k in MODEL.RESIL) S.g[k] ??= MODEL.RESIL[k];
    box.append(el('h3', { text: 'Resilience assumptions' }), field('Fiber cuts per 1000 km per year', numIn(S.g, 'cutRate', 0.5, 0, 50)), field('Mean time to repair (h)', numIn(S.g, 'mttr', 1, 0.5, 720)),
      field('Loss detection (ms)', numIn(S.g, 'detectMs', 1, 0, 1000)), field('1+1 switch time (ms)', numIn(S.g, 'switchMs', 5, 0, 10000)), field('Shared protection turn-up (s)', numIn(S.g, 'sharedSec', 0.5, 0, 600), 'Extra time to light a dark protection route: laser turn-up, WSS configuration and amplifier settling.'), field('Restoration time (s)', numIn(S.g, 'restoreSec', 5, 0, 3600), 'How long an unprotected channel takes to re-route over another path.'), field('Device failures per year', numIn(S.g, 'devRate', 0.01, 0, 5), 'Per amplifier or ROADM on a route. A failed ROADM at the end of a channel keeps it down until repaired; one in the middle is bypassed by protection or restoration if another route avoids it.'),
      el('p', { class: 'muted small', text: 'Expectations for the Resilience tab. Typical terrestrial fiber sees 2 to 4 cuts per 1000 km per year.' }));
    box.append(el('div', { class: 'keys' }, [el('div', { html: '<kbd>V</kbd> select / move' }), el('div', { html: '<kbd>P</kbd> patch cord' }), el('div', { html: '<kbd>F</kbd> fiber span' }), el('div', { html: '<kbd>Del</kbd> delete' }), el('div', { html: 'Drag empty space to pan, scroll to zoom' })]));
    return;
  }
  if (sel.kind === 'node') {
    const n = node(sel.id); if (!n) return;
    const nm = el('input', { value: n.name, id: 'f-name' }); nm.addEventListener('input', () => { n.name = nm.value; renderCanvas(); renderResults(); });
    box.append(el('h3', { text: TYPES[n.type].label }), field('Name', nm));
    const p = n.p; p.fail ??= ''; p.degDb ??= 3;
    box.append(field('Condition', selIn(p, 'fail', [['', 'Working'], ['degraded', 'Degraded'], ['dead', 'Failed (no light passes)']]), 'Failed: the device passes no light, so routes avoid it (restoration or protection) and a service through it is LOS. Degraded: an amplifier loses output (pump ageing) and gets noisier, a laser gets weaker, a receiver loses SNR, a ROADM, mux, VOA or DCM adds loss.'));
    if (p.fail === 'degraded') box.append(field('Degradation (dB)', numIn(p, 'degDb', 0.5, 0, 30)));
    { const d = TYPES[n.type].def(); for (const k in d) if (p[k] === undefined) p[k] = d[k]; } // fields added since this lab was saved
    if (isEnd(n)) {
      box.append(field(n.type === 'mxp' ? 'Line port mode' : 'Mode', selIn(p, 'mode', Object.entries(PHY.MODES).map(([k, m]) => [k, m.name]))));
      const m = PHY.MODES[p.mode];
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
    } else if (n.type === 'edfa') {
      box.append(field('Gain control', selIn(p, 'ctl', [['auto', 'Auto: hit output target'], ['fixed', 'Fixed gain']])));
      if (p.ctl === 'auto') box.append(field('Output target (dBm/ch)', numIn(p, 'target', 0.5, -10, 10, true, String(S.g.launch)), 'Blank = follow the global launch power'), field('Same, return direction (dBm/ch)', numIn(p, 'targetRev', 0.5, -10, 10, true, p.target === '' ? String(S.g.launch) : String(p.target)), 'Z to A. A line amp is really two amps, one per direction: a booster in one is a preamp in the other. Blank = same as forward.'));
      else box.append(field('Gain (dB)', numIn(p, 'gain', 0.5, 0, 40)), field('Same, return direction (dB)', numIn(p, 'gainRev', 0.5, 0, 40, true, String(p.gain)), 'Z to A. Blank = same as forward.'));
      box.append(field('Noise figure (dB)', numIn(p, 'nf', 0.1, 3, 12), 'Quantum limit is 3 dB. Real EDFAs: 4.5–6 dB'));
      box.append(field('Gain range min / max (dB)', el('div', { class: 'pair' }, [numIn(p, 'gmin', 1, 0, 40), numIn(p, 'gmax', 1, 0, 40)])));
      box.append(field('Max total output (dBm)', numIn(p, 'pmax', 0.5, 10, 30), 'Shared by every channel in the fiber'));
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
      box.append(el('p', { class: 'muted small', text: 'Express traffic passes two WSSs (route and select). Add or drop passes one WSS plus the add/drop structure. Each WSS pass narrows the passband a little.' }));
    } else if (n.type === 'dcm') {
      box.append(field('Dispersion (ps/nm)', numIn(p, 'cd', 10, -8000, 8000)));
      box.append(field('Insertion loss (dB)', numIn(p, 'il', 0.5, 0, 20)));
      box.append(field('Return direction: dispersion (ps/nm)', numIn(p, 'cdRev', 10, -8000, 8000, true, String(p.cd)), 'Blank = same as forward. Set 0 for a return fiber that has no compensator.'));
      box.append(field('Return direction: insertion loss (dB)', numIn(p, 'ilRev', 0.5, 0, 20, true, String(p.il))));
      box.append(el('p', { class: 'muted small', text: 'Negative dispersion cancels the fiber\'s positive dispersion: about -1360 ps/nm for 80 km of SMF (17 ps/nm/km). A DCF module costs ~7 dB, a fibre Bragg grating ~3 dB. Put it between amplifier stages so the loss does not hurt OSNR.' }));
    } else if (n.type === 'voa') {
      box.append(field('Attenuation (dB)', numIn(p, 'att', 0.5, 0, 30)));
    }
    box.append(el('button', { class: 'btn danger', text: 'Delete device', onclick: del }));
  } else {
    const l = link(sel.id); if (!l) return;
    box.append(el('h3', { text: l.kind === 'fiber' ? 'Fiber span' : 'Patch cord' }), el('p', { class: 'muted', text: linkName(l) }));
    box.append(field('Cable type', selIn(l, 'kind', [['fiber', 'Fiber span (outside plant)'], ['patch', 'Patch cord (in the rack)']])));
    if (l.p.dir == null) l.p.dir = 'both';
    { const na = node(l.a), nb = node(l.b); box.append(field('Carries light', selIn(l.p, 'dir', [['both', 'Both ways (a fiber pair)'], ['ab', `${na ? na.name : 'a'} → ${nb ? nb.name : 'b'} only`], ['ba', `${nb ? nb.name : 'b'} → ${na ? na.name : 'a'} only`]]), 'A one-way fiber lets each direction take a different route.')); }
    if (l.kind === 'fiber') {
      for (const k in linkDefaults('fiber')) if (l.p[k] == null) l.p[k] = linkDefaults('fiber')[k];
      box.append(field('Length (km)', numIn(l.p, 'len', 1, 0, 300)));
      box.append(field('Fiber type', selIn(l.p, 'fiber', Object.entries(PHY.FIBERS).map(([k, f]) => [k, f.name]))));
      box.append(field('Connector + splice loss (dB)', numIn(l.p, 'extra', 0.1, 0, 20), 'Dirty connector? Add 1–3 dB here'));
      box.append(field('Same, return direction (dB)', numIn(l.p, 'extraRev', 0.1, 0, 20, true, String(l.p.extra)), 'Z to A. Blank = same as forward. Bidirectional lines have two fibers; a dirty connector on one hurts one direction.'));
      box.append(field('Channels lit on this span', numIn(l.p, 'nch', 1, 1, 96, true, String(S.g.nch)), 'Blank = global. Applies from this span until a mux or ROADM changes it. Fewer neighbours means less nonlinearity.'));
      const fb = PHY.FIBERS[l.p.fiber];
      box.append(field('Raman pump, backward (mW)', numIn(l.p, 'raman', 50, 0, PHY.RAMAN.maxMw), '0 = off. Distributed gain along the fiber: better OSNR than a lumped amp at the end, but more nonlinearity and a Class 4 laser above ~1 W.'));
      box.append(field('Raman pump direction', selIn(l.p, 'ramanDir', [['back', 'Backward (from the receive end)'], ['fwd', 'Forward (from the transmit end)'], ['both', 'Both ends, power split']]), 'Backward is quietest. Forward lifts the signal early, which helps ASE but raises nonlinearity and pump noise. Both ends flatten the gain profile.'));
      box.append(field('Raman pumps (wavelengths)', selIn(l.p, 'ramanPumps', [['1', '1 pump: gain ripple across the band'], ['2', '2 pumps'], ['3', '3 pumps: flat gain']]), 'More pump wavelengths flatten the gain across C-band, which shows up as less tilt. Total pump power is shared.'));
      box.append(field('Raman pump, return direction (mW)', numIn(l.p, 'ramanRev', 50, 0, PHY.RAMAN.maxMw, true, String(l.p.raman)), 'Blank = same as forward.'));
      const rn = el('p', { class: 'muted small' });
      const upd = () => { const gr = PHY.ramanGain(fb, +l.p.len, Math.min(PHY.RAMAN.maxMw, +l.p.raman || 0)); rn.textContent = gr > 0 ? `On-off Raman gain about ${f1(gr)} dB, net span loss ${f1(fb.att * l.p.len + +l.p.extra - gr)} dB.` : ''; rn.hidden = !(gr > 0); };
      box.querySelector('#f-raman').addEventListener('input', upd); upd(); box.append(rn);
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
    box.append(el('div', { class: 'row' }, [
      el('button', { class: 'btn ' + (l.p.cut ? '' : 'danger'), text: l.p.cut ? 'Splice it back' : 'Cut this fiber', onclick: () => { l.p.cut = !l.p.cut; renderAll(); } }),
      el('button', { class: 'btn', text: 'Delete cable', onclick: del })]));
  }
}
// Client ports of a muxponder: optic type, distance to the host, connector loss, with a live budget line per port.
function clientEditor(n) {
  const wrap = el('div', { class: 'clients' }, [el('h4', { text: 'Client ports' })]);
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
  $('#g-nch-v').textContent = S.g.nch; $('#g-launch-v').textContent = (S.g.launch > 0 ? '+' : '') + S.g.launch;
}
$('#g-nch').addEventListener('input', e => { if (S.g.plan) { S.g.plan = null; toast('Channel plan reset to a uniform line'); } S.g.nch = +e.target.value; $('#g-nch-v').textContent = S.g.nch; renderAll(); });
$('#g-df').addEventListener('change', e => { const old = +S.g.df; S.g.df = +e.target.value; if (S.g.plan) { S.g.plan = MODEL.remapPlan(S.g.plan, old, S.g.df); if (S.g.plan) S.g.nch = S.g.plan.length; } renderAll(); });
$('#g-launch').addEventListener('input', e => { S.g.launch = +e.target.value; $('#g-launch-v').textContent = (S.g.launch > 0 ? '+' : '') + S.g.launch; recompute(); });
$('#preset').addEventListener('change', e => { if (e.target.value) { applyPreset(e.target.value); e.target.value = ''; } });
$('#btn-fit').addEventListener('click', () => { fitView(); applyView(); });
$('#btn-clear').addEventListener('click', () => {
  const b = $('#btn-clear');
  if (b.dataset.armed) { S.nodes = []; S.links = []; S.svc = { a: null, z: null }; sel = null; delete b.dataset.armed; b.textContent = 'Clear canvas'; renderAll(); }
  else { b.dataset.armed = '1'; b.textContent = 'Click again to clear'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Clear canvas'; }, 2500); }
});
$('#btn-export').addEventListener('click', () => { $('#io').hidden = false; $('#io-text').value = JSON.stringify({ nodes: S.nodes, links: S.links, g: S.g, svc: S.svc }, null, 1); });
$('#io-close').addEventListener('click', () => { $('#io').hidden = true; });
$('#io-copy').addEventListener('click', () => { const t = $('#io-text'); navigator.clipboard?.writeText(t.value).then(() => toast('Copied topology JSON'), () => { t.select(); toast('Select-all done; press Ctrl/Cmd+C'); }) ?? t.select(); });
$('#io-load').addEventListener('click', () => {
  try { const o = MODEL.sanitize(JSON.parse($('#io-text').value)); S = { ...S, ...o }; sel = null; $('#io').hidden = true; fitView(); renderAll(); toast('Topology loaded'); }
  catch (e) { toast('That text is not a topology export. Paste the JSON from Export.'); }
});

const csvMode = $('#csv-mode');
Object.entries(PHY.MODES).forEach(([k, m]) => csvMode.append(el('option', { value: k, text: m.short })));
csvMode.value = 'zrp400';
$('#csv-build').addEventListener('click', () => {
  const r = MODEL.fromSpans($('#csv-text').value, csvMode.value);
  if (!r.topo) return toast(r.errors[0]);
  S = { ...S, ...MODEL.sanitize(r.topo) }; sel = null; $('#io').hidden = true; fitView(); renderAll();
  toast(`Built ${r.spans.length} span${r.spans.length === 1 ? '' : 's'}` + (r.errors.length ? `. ${r.errors.length} row${r.errors.length === 1 ? '' : 's'} skipped: ${r.errors[0]}` : ''));
});

// ---------- results ----------
const STATUS = { up: 'UP', degraded: 'DEGRADED', down: 'DOWN', los: 'LOS', none: '—', nopath: 'NO PATH', blocked: 'BLOCKED', standby: 'STANDBY' };
let tab = 'power';
function tile(label, val, unit, topic, cls = '') {
  return el('button', { class: 'kpi ' + cls, onclick: () => learn(topic), title: 'Explain ' + label }, [el('span', { class: 'kl', text: label }), el('span', { class: 'kv' }, [document.createTextNode(val), el('small', { text: unit })])]);
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
  const k = $('#kpis'); k.innerHTML = '';
  if (!r.mode) { $('#tabbody').innerHTML = ''; $('#alarms').innerHTML = ''; renderTabBody(); return; }
  const m = r.mode;
  const prxCls = !isFinite(r.prx) ? 'bad' : r.prx < m.rxMin || r.prx > m.rxMax ? 'warn' : '';
  k.append(tile('Rx power', isFinite(r.prx) ? f1(r.prx) : 'LOS', ' dBm', 'rx', prxCls));
  if (r.ber != null) {
    k.append(tile('OSNR', f1(r.osnr), ' dB', 'osnr'), tile('GSNR (w/ NLI)', f1(r.gosnr), ' dB', 'gsnr'),
      tile('Pre-FEC BER', r.ber < 1e-15 ? '<1e-15' : r.ber.toExponential(1), '', 'ber', r.ber > m.berThr ? 'bad' : ''),
      tile('Q-factor', f1(r.q), ' dB', 'q'), tile('Q margin', (r.qMargin > 0 ? '+' : '') + f1(r.qMargin), ' dB', 'margin', r.qMargin < 0 ? 'bad' : r.qMargin < 1 ? 'warn' : 'good'),
      tile('OSNR margin', (r.osnrMargin > 0 ? '+' : '') + f1(r.osnrMargin), ' dB', 'margin', r.osnrMargin < 0 ? 'bad' : r.osnrMargin < 2 ? 'warn' : ''),
      tile('Q margin, end of life', (r.eol.qMargin > 0 ? '+' : '') + f1(r.eol.qMargin), ' dB', 'aging', r.eol.qMargin < 0 ? 'bad' : r.eol.qMargin < 1 ? 'warn' : ''),
      tile('Q margin, worst channel', (r.worstQMargin > 0 ? '+' : '') + f1(r.worstQMargin), ' dB', 'srs', r.worstQMargin < 0 ? 'bad' : r.worstQMargin < 1 ? 'warn' : ''),
      tile('SRS tilt (peak)', f1(r.tilt), ' dB', 'srs'),
      ...(m.coh === false ? [tile('XPM penalty', f1(r.xpmPen), ' dB', 'xpm', r.xpmPen > 1.5 ? 'warn' : '')] : []),
      tile('CD', Math.round(r.cd).toLocaleString(), ' ps/nm', 'cd', Math.abs(r.cd) > m.cdTol ? 'bad' : ''), tile('Mean DGD', f1(r.dgd), ' ps', 'pmd'), tile('Distance', Math.round(r.km), ' km', 'span'));
  }
  const al = $('#alarms'); al.innerHTML = '';
  r.alarms.slice(0, 6).forEach(a => al.append(el('li', { class: 'al-' + a.sev, text: a.text })));
  if (r.ber != null) al.append(el('li', { class: 'al-info' }, [diagnose(r)]));
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
    trx: 'The line is clean. The transceiver itself is the limit, so more line tweaking will not help much.',
    rx: 'Too little light reaches the receiver. Add or re-target an amplifier before the Rx, or remove a pad.',
    mpi: 'Double Rayleigh scattering from the Raman pump dominates. Lower the pump power (it grows with the square of the gain) or split the gain with an EDFA.',
  };
  const pen = r.filt + r.over + r.pmdPen;
  wrap.append(el('b', { text: 'What is eating the SNR' }), bar, leg, el('span', { text: tips[top] + (pen > 0.3 ? ` Plus ${f1(pen)} dB of penalties (${[r.filt > 0.05 ? `filtering ${f1(r.filt)}` : '', r.over > 0 ? `Rx overload ${f1(r.over)}` : '', r.pmdPen > 0.05 ? `PMD ${f1(r.pmdPen)}` : ''].filter(Boolean).join(', ')}).` : '') }));
  return wrap;
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { tab = t.dataset.tab; renderTabBody(); }));
$('#svc-a').addEventListener('change', e => { S.svc.a = e.target.value || null; renderAll(); });
$('#svc-z').addEventListener('change', e => { S.svc.z = e.target.value || null; renderAll(); });
$('#svc-swap').addEventListener('click', () => { [S.svc.a, S.svc.z] = [S.svc.z, S.svc.a]; renderAll(); });

function renderTabBody() {
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === tab));
  const b = $('#tabbody'); b.innerHTML = '';
  const r = view();
  if (tab === 'learn') return b.append(learnView());
  if (tab === 'plan') return b.append(planView(r));
  if (tab === 'resil') return b.append(resilView());
  if (tab === 'planner') return b.append(plannerView());
  if (!r || !r.hops) return b.append(el('p', { class: 'muted pad', text: r ? r.headline : '' }));
  if (tab === 'power') b.append(powerChart(r));
  else if (tab === 'hops') b.append(hopTable(r));
  else if (tab === 'clients') b.append(clientsView(r));
  else if (tab === 'spectrum') b.append(spectrumView(r));
  else if (tab === 'const') b.append(constView(r));
  else if (tab === 'sweep') b.append(sweepChart(r));
  else if (tab === 'trans') b.append(transView(r));
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
    tb.append(el('tr', {}, [nodeSel(d, 'a'), nodeSel(d, 'z'), ms, cnt, el('button', { class: 'btn', text: '×', title: 'Remove', onclick: () => { S.demands.splice(S.demands.indexOf(d), 1); redo(); } })].map(x => el('td', {}, [x]))));
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

// expected outages from the planned routes
function fmtDur(s) { return s < 1 ? `${(s * 1000).toFixed(s < 0.1 ? 1 : 0)} ms` : s < 120 ? `${s.toFixed(1)} s` : s < 7200 ? `${(s / 60).toFixed(1)} min` : `${(s / 3600).toFixed(1)} h`; }
function resilView() {
  const wrap = el('div', { class: 'planwrap pad' }), rs = MODEL.resilience(S), plan = S.g.plan;
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
    el('p', { class: 'muted small', text: `A gain-controlled EDFA would raise the survivors by 10·log10(channels / survivors) if it did not react; its control loop holds off all but a fraction 1 − exp(−response / ${t.tauUs} µs) of that. The excursions of a cascade add. Raman pumps and ROADM wavelength blockers are not modelled. The event size and amplifier response are in the inspector (nothing selected); an amplifier can override the response.` }));
  return wrap;
}

// client ports (muxponders)
function clientsView(r) {
  const wrap = el('div', { class: 'tablewrap' });
  if (!r.clients || !r.clients.length) return el('p', { class: 'muted pad', text: 'Neither end of this service is a muxponder. Drag a Muxponder onto the bench to add client ports (100G, 400G and other grey optics) in front of the coherent line port.' });
  for (const c of r.clients) {
    const over = c.total > c.lineRate;
    wrap.append(el('h4', { text: `${c.node.name}: ${c.ports.length} client port${c.ports.length === 1 ? '' : 's'} into ${PHY.MODES[c.node.p.mode].short}` }),
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
    tb.append(el('tr', { class: h.kind === 'cut' ? 'cutrow' : '' }, [h.name, h.kind, Math.round(h.km), h.kind === 'tx' ? '' : f1(h.in.sig), h.out.sig > -90 ? f1(h.out.sig) : 'LOS', h.gain != null ? (h.gain > 0 ? '+' : '') + f1(h.gain) : '', tot + (h.nch > 1 ? ` (${h.nch}ch)` : ''), h.osnr != null ? f1(h.osnr) : '', h.gosnr != null ? f1(h.gosnr) : '',
      [h.nf ? `NF ${f1(h.nf)}` : '', h.launch != null ? `launch ${f1(h.launch)}` : '', h.note || ''].filter(Boolean).join(' · ')].map(c => el('td', { text: String(c) }))));
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
    el('h4', { text: r.mode.coh === false ? `${r.mode.mod}: received level histogram (1 / 0)` : `DP-${r.mode.mod}, one polarization` }),
    specRow('Effective SNR', `${f1(r.effDb)} dB`), specRow('EVM (rms)', `${f1(evm)} %`), specRow('Pre-FEC BER', r.ber < 1e-15 ? '<1e-15' : r.ber.toExponential(2)), specRow('Needed at FEC limit', `${f1(PHY.requiredEffSnrDb(r.mode))} dB SNR`),
    el('p', { class: 'muted small', text: 'Each dot is a received symbol. Noise smears dots away from the ideal points (black). A dot that lands across a grid line is decoded as the wrong symbol: that is a bit error. FEC can fix errors up to its BER limit. Try raising the span length and watch the clouds merge.' })]));
  return wrap;
}

// channel plan: which channels share the line (mode, grid slot, power offset) and how each one is doing
function planView(r) {
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
  const pathRoadms = S.nodes.filter(n => n.type === 'roadm' || isEnd(n));
  const tbl = el('table', { class: 'tbl plantbl' }), th = el('tr'); ['', 'Slot', 'THz', 'Mode', 'Add at', 'Drop at', 'Via', 'Convert at', 'Protect', 'Offset dB', 'Rx dBm', 'GSNR', 'Q margin', 'XPM', 'Status', ''].forEach(h => th.append(el('th', { text: h })));
  tbl.append(el('thead', {}, [th]));
  const tb = el('tbody');
  for (const c of plan) {
    const o = r && r.channels ? r.channels[plan.indexOf(c)] : null, m = PHY.MODES[c.mode];
    const radio = el('input', { type: 'radio', name: 'svcch', 'aria-label': `Make slot ${c.slot + 1} the service channel` }); radio.checked = c.svc; radio.addEventListener('change', () => { plan.forEach(x => (x.svc = x === c)); commit(); });
    const ms = el('select', {}); modes.forEach(([k, t]) => ms.append(el('option', { value: k, text: t }))); ms.value = svcNode && c.svc ? svcMode : c.mode; ms.disabled = !!c.svc; ms.title = c.svc ? 'The service channel always uses the transponder mode' : '';
    ms.addEventListener('change', () => { c.mode = ms.value; commit(); });
    const slotIn = el('input', { type: 'number', step: 1, min: 1, max: slots, value: c.slot + 1, 'aria-label': 'Slot number', class: 'slotin' });
    slotIn.addEventListener('change', () => { const v = Math.round(+slotIn.value); if (isFinite(v) && v >= 1 && v <= slots) { c.slot = v - 1; commit(); } else { slotIn.value = c.slot + 1; toast(`Slots run from 1 to ${slots}.`); } });
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
    const del = el('button', { class: 'btn', text: '×', title: 'Remove channel', disabled: c.svc, onclick: () => { plan.splice(plan.indexOf(c), 1); commit(); } });
    tb.append(el('tr', { class: (c.svc ? 'selrow' : '') + (hiChan === c ? ' hirow' : ''), onclick: ev => { if (ev.target.closest('select,input,button')) return; hiChan = hiChan === c ? null : c; renderCanvas(); renderTabBody(); }, title: o && o.route && o.route.length ? 'Route: ' + o.route.join(' → ') + (o.protection ? '\n' + ((o.protection.active === 'work' ? o.protection.protect : o.protection.work).predicted ? 'Shared protection, predicted by failing the working route (' : 'Standby (') + (o.protection.active === 'work' ? 'protection' : 'working') + ' copy): ' + ((o.protection.active === 'work' ? o.protection.protect : o.protection.work).route.join(' → ') || (o.protection.active === 'work' ? o.protection.protect : o.protection.work).notes[0]) : '') + (o.converted ? '\nConverted at ' + (o.segments[0].toName || '') + ': slot ' + (o.slot + 1) + ' then slot ' + (o.slot2 + 1) : '') : '' }, [radio, slotIn, (PHY.CBAND.f0 / 1e12 + (c.slot + 0.5) * +S.g.df / 1000).toFixed(2), ms, nodeSel('from', 'A end', 'Add at'), nodeSel('to', 'Z end', 'Drop at'), nodeSel('via', 'Shortest', 'Route via'), convCell, protSel, off,
      o && o.prx != null ? f1(o.prx) : '', o && o.gosnr != null ? f1(o.gosnr) : '', o && o.qMargin != null ? (o.qMargin > 0 ? '+' : '') + f1(o.qMargin) : '', o && m.coh === false ? f1(o.xpmPen) : '',
      o ? el('span', { class: 'st-' + o.status, text: STATUS[o.status] + (o.notes.length ? ': ' + o.notes[0] : '') }) : '', del].map(x => (x instanceof Node ? el('td', {}, [x]) : el('td', { text: x })))));
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
  cd: ['Chromatic dispersion', `<p>Different wavelengths inside one channel travel at slightly different speeds (17 ps/nm/km on SMF). Coherent DSP undoes it digitally, so it costs no margin until you exceed the module's range: 400ZR handles ±2,400 ps/nm (~140 km SMF), ZR+ about 20,000.</p><p>Past that range the receiver cannot lock: link down, regardless of OSNR.</p><p><b>Direct-detection optics</b> (a 10G tunable SFP+ in a switch) have no DSP. Dispersion closes the eye gradually, so it costs SNR long before the rated limit (about 1600 ps/nm, ~95 km of SMF) and the link drops past it. Beyond about 80 km you need a dispersion compensation module (DCF or fibre Bragg grating, which add loss) or a coherent optic.</p>`],
  pmd: ['PMD / DGD', `<p>The two polarizations travel at slightly different speeds because fiber is not perfectly round. Mean differential group delay grows with √length. New fiber is ~0.05 ps/√km; some 1990s fiber is 0.5 or worse.</p><p>Coherent DSP tracks it, with a penalty that grows as you approach the tolerance.</p>`],
  filter: ['Filter narrowing', `<p>Every WSS pass rounds off the edges of the passband. A 60 GBd signal in a 75 GHz slot loses a little each pass; through many ROADMs it adds up. Squeezing a 64 GBd signal into a 50 GHz grid is a big penalty.</p>`],
  rx: ['Receiver power window', `<p>Coherent receivers mix the signal with a local oscillator laser. Too little light and receiver electronics noise takes over (Rx LOW). Too much and the photodiodes and ADCs saturate (Rx HIGH, overload). Far too little is LOS.</p><p>For amplified links the usual target is the middle of the window, set with the preamp or a pad.</p>`],
  client: ['Client ports and muxponders', `<p>A <b>transponder</b> carries one client signal over one coherent line port. A <b>muxponder</b> aggregates several client ports (for example 4 × 100GbE) into one line port (for example 400G ZR+). The line port is what the DWDM system sees. Everything upstream of it (host router, client optics) is a separate, short, grey-optics link.</p><p>Each client port has its own power budget: Tx power minus fiber and connector loss must land inside the module's Rx window. Too little and the client link is down. Too much (a long-reach optic on a short jumper) overloads the receiver and needs a pad. Running past rated reach adds dispersion penalty the model only flags.</p><p>The clients must also fit the line rate. 400ZR itself carries a single 400GbE client; OpenZR+ and OTN-based line modes can multiplex 100G and 200G clients.</p>`],
  plan: ['Channel plan', `<p>A real line carries a <b>mix</b>: 10G legacy channels, 100G and 400G coherent channels at different baud rates, on different grid slots and at slightly different powers. The Channels tab lets you place each one. Everything then follows from who sits where:</p><ul><li><b>Nonlinear noise</b> on a channel comes from itself and from every other channel, weighted by their power spectral densities and how far away they are. Edge channels see fewer neighbours than the centre; a narrow 10G channel next to wide 400G ones sees a different mix than the rest.</li><li><b>XPM on 10G channels</b> counts the neighbours within about 400 GHz and what they are (coherent neighbours hurt more).</li><li><b>Raman gain</b> depends on frequency, so the channels at the edge of the band get more or less than the one in the middle.</li><li><b>Rx power and margin</b> are evaluated against each channel's own receiver, so a 10G channel can be past its overload point on a line where the 400G channels are fine. A power offset fixes that.</li></ul><p>The service channel (the one the headline describes) always uses the transponder mode. Everything else uses the mode you choose.</p><p><b>Add/drop and mesh routing:</b> in a real ROADM network few channels ride the same path. Pick \"Add at\" and \"Drop at\" for a channel (any ROADM or transponder) and it is routed over the cabled network between them, so channels in one plan can take different routes. Each fiber carries only the channels whose routes cross it, so the amplifiers there carry fewer channels and the others see less nonlinear noise. A channel picks up ASE, nonlinear noise, dispersion and WSS passes only along its own route, so a one-span channel has a much better GSNR than an end-to-end one. At its drop ROADM it takes the drop port (one WSS pass instead of an express two, plus the drop structure and a drop amplifier); added channels start at the ROADM level with their own transmitter noise. Normally a channel takes the shortest route; \"Via\" forces it through a chosen ROADM, which is how a diverse or protection route gets planned (longer, so worse GSNR, but on different fibers). Cut a fiber and every channel reroutes, piling load onto the detour. <b>Wavelength assignment:</b> a slot can carry one channel per fiber, so two channels with no fiber in common may reuse the same slot (the slot number is editable), while two on a shared fiber collide: the later one is BLOCKED and stays dark. \"Assign slots\" runs first-fit: the service keeps its slot and every other channel, longest route first, takes the lowest slot free along its whole route. Reuse is what lets a mesh carry far more channels than the 64 slots of one fiber. <b>Converters:</b> \"Convert at\" picks a ROADM where the channel is regenerated into another slot (an O-E-O pair, or a wavelength converter). It splits the channel in two: each half has its own slot and route, starts clean at the converter (noise, dispersion and filter passes are reset) and is judged at its own receiver, so a long channel that would fail end to end can pass in two halves, and two halves can use slots that no single slot could offer along the whole route. The channel's status is its worst half. <b>Protection:</b> \"Protect 1+1\" lights a second copy of the channel on the shortest route that shares no fiber with the working one. Both copies load their fibers and need their slot free; the receiver uses the working copy until it fails. On a cut fiber (or, for the service, when the working route is down) traffic switches to the protection route at once, with no re-routing, and the channel runs unprotected (degraded) until repair. The protection route is longer and so has less margin: the tool tells you when it would not carry the service. Both sit beside restoration: an unprotected channel simply re-routes over whatever fibers are left. Try the \"Mesh\" and \"ROADM line with add/drop\" scenarios.</p>`],
  srs: ['SRS tilt', `<p><b>Stimulated Raman scattering</b>: light in the fiber acts as a weak Raman pump, so high-frequency (short-wavelength) channels give power to low-frequency ones. With a full C-band load at +1 dBm per channel it is worth roughly 1 dB of tilt per 80 km span, growing with total power, span length and occupied bandwidth.</p><p>Amplifiers with gain-tilt control (and ROADM WSSs) re-flatten the band, so tilt does not pile up. Switch tilt control off on the long-haul scenario to watch it accumulate. The service channel sits mid-band and barely moves, so the <i>worst channel</i> Q margin tracks the highest-frequency channel, which ends up weakest. The model is a first-order approximation, not a measurement.</p>`],
  raman: ['Raman amplification', `<p>A <b>Raman pump</b> at the receiving end (about 1450 nm, backward) transfers power to the signal along the fiber itself. Unlike an EDFA, the gain is <i>distributed</i>: the signal is boosted before it has fallen as far, so less ASE-limited OSNR is lost. A 1 W pump gives roughly 15 dB of on-off gain on 80-110 km of SMF.</p><p>The trade-off: the signal stays stronger for longer, which raises nonlinear noise, and above ~1 W the pump is a Class 4 laser (eye safety, fiber fuse on a dirty connector). Here the benefit is modelled as a lumped amplifier sitting late in the span (about 40% of the on-off gain counts as OSNR benefit) with a 4.5 dB equivalent noise figure. The model includes pump depletion (small on lossy spans, where the signal near the pump is weak), a gain spectrum (a triangular Raman gain curve against pump detuning, so channels at different frequencies get different gain; the ripple falls from 1 to 2 to 3 pump wavelengths), double Rayleigh scattering (noise that grows with the square of the gain, so it only bites above roughly 15 to 18 dB), and forward or bidirectional pumping: a forward pump lifts the signal over the first ~20 km, so ASE improves but nonlinearity gets much worse, and bidirectional is usually best. Pump-to-pump power transfer and a full coupled-wave solver are not modelled.</p><p>Set it on a fiber span in the inspector. Try 110 km with 0, 500 and 1000 mW and watch ASE and NLI move in opposite directions in the "What is eating the SNR" bar.</p>`],
  bidi: ['Two directions', `<p>A DWDM line is really <b>two</b> fibers (or two wavelength bands on one) carrying traffic in opposite directions, with <b>one amplifier per direction</b>. A box labelled "BST-A" holds the booster for A to Z and the preamp for Z to A. The results panel shows both: pick the direction with the buttons by the status pill. The service status is the worse of the two.</p><p>Directions differ when one fiber has a dirtier connector, a different loss, a different Raman pump, or an amplifier that is set up for the other direction. Cable-wise a transmitter's launch and a receiver's input both depend on which role the amplifier plays, so an amp tuned as a booster is often wrong as a preamp: use the "return direction" fields on amplifiers and fibers.</p><p>A fiber can also be set to carry one direction only (inspector, "Carries light"). Then each direction routes separately: A to Z can take the short way round a ring while Z to A takes the long way, and a one-way fiber with no return path takes the service down. A DCM and an amplifier's gain range, noise figure and output limit also have return-direction fields.</p><p>Counter-propagating signals barely interact nonlinearly because they walk through each other too fast, so each direction is simulated independently.</p>`],
  xpm: ['Cross-phase modulation', `<p><b>XPM</b> is the nonlinear effect where the intensity of one channel changes the phase of its neighbours. A coherent receiver sorts out phase, but a <b>direct-detection</b> receiver (a 10G NRZ optic) turns phase wobble into amplitude errors after dispersion, so legacy 10G channels are the ones that suffer, especially beside wide, high-power coherent channels.</p><p>The penalty here grows with the number of neighbours inside about 400 GHz, with launch power and with effective fiber length, summed over spans. The "Neighbouring channels" setting (inspector, nothing selected) chooses between same-type and coherent neighbours. Real fixes: lower the launch power, leave a gap of empty slots around the 10G channels, or give them their own band. The numbers are representative, not a full XPM model.</p>`],
  resil: ['Protection, switching time and availability', `<p>A fiber cut takes every channel on it down. What happens next depends on how the channel is protected.</p><ul><li><b>Unprotected:</b> the control plane notices, finds another route, and the ROADMs and amplifiers are reconfigured: tens of seconds to minutes. If there is no other route it stays down until the splice is repaired (hours).</li><li><b>1+1 dedicated:</b> a second copy of the signal is lit on a route that shares no fiber with the first; the receiver just picks the survivor after loss detection and a switch (tens of milliseconds). It costs the second route's wavelength and amplifier power all the time.</li><li><b>1:N shared:</b> the protection route is dark and may be shared by several channels whose working routes cannot fail together, so it costs nothing in normal operation, but it has to be lit after the failure: a second or more. Its margin is predicted by simulating the failure.</li><li><b>Wavelength converters:</b> regenerate a channel into another slot, resetting its noise; a protected converted channel is protected on each side of the converter separately.</li></ul><p>The Resilience tab turns cut rate, repair time and these switching times into expected downtime per year: each cut on the route happens at the cut rate times its length, then costs the switching or restoration time, plus the chance that both routes are down at once (the product of their unavailabilities, which is why a longer protection route matters less than its existence).</p>`],
  fail: ['Failures other than fiber cuts', `<p>Fibers are not the only thing that breaks. Select any device and set its <b>Condition</b>.</p><ul><li><b>Failed:</b> the device passes no light (a dead amplifier pump absorbs the signal, a ROADM loses power, a transponder goes dark). Routes avoid it: an unprotected channel restores around it if the network has another way, a 1+1 or shared protected channel switches to its protection route, and a service with no way round shows LOS and names the device. Channels that start or end at a failed ROADM are lost.</li><li><b>Degraded:</b> still lit but worse. An amplifier's output falls below its setting and its noise figure rises (pump ageing); a laser is weaker; a receiver loses SNR; a ROADM, mux, VOA or DCM adds loss (a partly stuck WSS or a dirty connector). Amplifiers downstream re-level the power, so what you see is mostly extra noise.</li></ul><p><b>Shared risk link groups:</b> two fibers in the same duct or trench do not fail independently. Give them the same group name on the cable inspector and cutting one cuts all of them. Protection planning then looks for a route that avoids the whole group, which is often a lot longer than the fiber-disjoint route that happens to share a trench. Try the \"Shared duct\" scenario.</p><p>The Resilience tab includes device failures (a rate per amplifier or ROADM): a device that has to be passed (the access ROADM of a single-homed transponder) costs the full repair time, an interior one costs only the switch or restoration time if another route avoids it.</p>`],
  trans: ['Power transients', `<p>An EDFA amplifies all channels from one pool of inverted erbium ions. If many channels vanish suddenly (an upstream fiber cut, a protection switch, a failed transponder), the pool no longer has to feed them, so the gain per surviving channel jumps toward <code>10·log<sub>10</sub>(N / survivors)</code> within about a hundred microseconds. A fast gain-control loop (AGC) cancels most of it; a slow one does not. In a cascade of amplifiers each one adds its excursion, so the surviving channels can surge by many dB by the end of the line, into receiver overload and into nonlinearity (3 dB of nonlinear noise for each dB of power), and dip equally when the channels come back.</p><p>That is why added channels are ramped up slowly and why long amplified systems need fast gain control on every amplifier. The Transients tab evaluates a sudden loss of a share of the channels along the service path with the response time of each amplifier. Raman pumps and WSS blocking are not modelled.</p>`],
  aging: ['End-of-life margin', `<p>Links are planned for the day they are worst, not the day they are lit. <b>End of life</b> here adds extra loss on every fiber span (splices from repairs, connector wear, fiber ageing; 1.0 dB by default) and a transceiver ageing penalty (0.5 dB by default). Both are editable in the inspector when nothing is selected. It then re-runs the whole simulation.</p><p>A link with a few dB of margin today can have none left at end of life. The "works today but fails at end of life" alarm is the early warning. Typical planning margin is 2-3 dB.</p>`],
  launch: ['Launch power', `<p>The per-channel power put into each span. Too low: amplifier noise dominates. Too high: nonlinearity dominates. Somewhere in between (often 0 to +2 dBm/ch for 60 GBd on SMF) GSNR peaks. Open the Launch sweep tab to see your link's curve.</p><p><b>Re-optimisation:</b> the optimum is not one number for the whole line. It depends on each span's loss and on how many channels are lit on it, so when channels are added or dropped it moves. Switch "Launch power" to re-optimised in the inspector (nothing selected) and every amplifier with a blank output target sets <code>P = (A / 2η)^(1/3)</code>, the GN optimum for the span after it, where A is the amplifier noise and η the nonlinear coefficient of that span at its current load. The sweep tab shows margin against channels lit for a fixed and a re-optimised line. The total-output limit of the amplifier still applies, and Raman gain is not included in the optimum.</p>`],
};
let learnTopic = 'osnr';
function learn(t) { learnTopic = t; tab = 'learn'; renderTabBody(); $('#tabs').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
function learnView() {
  const nav = el('nav', { class: 'lnav' });
  for (const k in LEARN) nav.append(el('button', { class: 'chip', 'aria-pressed': k === learnTopic, text: LEARN[k][0], onclick: () => { learnTopic = k; renderTabBody(); } }));
  return el('div', { class: 'learn' }, [nav, el('article', {}, [el('h4', { text: LEARN[learnTopic][0] }), el('div', { html: LEARN[learnTopic][1] })])]);
}

// ---------- misc ----------
let toastT;
function toast(t) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (e.hidden = true), 2600); }
function recompute() { lastRes = simulate(); renderCanvas(); renderResults(); save(); }
function renderAll() { lastRes = simulate(); bindGlobals(); renderCanvas(); renderInspector(); renderResults(); save(); }
window.addEventListener('resize', applyView);

load();
setTool('select');
requestAnimationFrame(() => { fitView(); renderAll(); });
})();
