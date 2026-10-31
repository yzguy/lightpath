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
const { TYPES, PREFIX, PRESETS, uid, linkDefaults } = MODEL;

// ---------- state ----------
let S;
let sel = null, tool = 'select';
const KEY = 'optical-lab-v1';
function load() {
  try {
    const t = localStorage.getItem(KEY);
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
const simulate = launchOverride => MODEL.simulate(S, launchOverride);
const reqOsnr = MODEL.reqOsnr;

// ---------- canvas ----------
const svg = $('#cv'), gRoot = $('#world');
function fitView() {
  if (!S.nodes.length) return;
  const xs = S.nodes.map(n => n.x), ys = S.nodes.map(n => n.y);
  const r = svg.getBoundingClientRect();
  const w = Math.max(...xs) - Math.min(...xs) + 220, h = Math.max(...ys) - Math.min(...ys) + 200;
  const k = Math.min(1.4, Math.max(0.35, Math.min(r.width / w, r.height / h)));
  S.view = { k, x: (Math.min(...xs) + Math.max(...xs)) / 2 - r.width / 2 / k, y: (Math.min(...ys) + Math.max(...ys)) / 2 - r.height / 2 / k };
}
function applyView() { gRoot.setAttribute('transform', `scale(${S.view.k}) translate(${-S.view.x},${-S.view.y})`); }
function toWorld(cx, cy) { const r = svg.getBoundingClientRect(); return { x: (cx - r.left) / S.view.k + S.view.x, y: (cy - r.top) / S.view.k + S.view.y }; }

function nodeShape(n) {
  const g = sv('g', { class: 'node t-' + n.type + (sel && sel.id === n.id ? ' sel' : ''), 'data-id': n.id, transform: `translate(${n.x},${n.y})`, tabindex: 0 });
  if (n.type === 'trx') {
    g.append(sv('rect', { x: -46, y: -22, width: 92, height: 44, rx: 4, class: 'body' }));
    g.append(sv('rect', { x: 30, y: -6, width: 10, height: 12, rx: 1, class: 'port' }));
    const t = sv('text', { x: -38, y: 4, class: 'glyph' }); t.textContent = PHY.MODES[n.p.mode].short; g.append(t);
    g.append(sv('circle', { cx: -36, cy: -12, r: 3, class: 'led' }));
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
  } else if (n.type === 'voa') {
    g.append(sv('rect', { x: -26, y: -18, width: 52, height: 36, rx: 3, class: 'body' }));
    g.append(sv('path', { d: 'M-16,12 L16,-12 M8,-12 L16,-12 L16,-4', class: 'thin' }));
  }
  const lab = sv('text', { x: 0, y: n.type === 'roadm' ? 50 : 44, class: 'nlabel', 'text-anchor': 'middle' }); lab.textContent = n.name; g.append(lab);
  if (n.type === 'trx' && (S.svc.a === n.id || S.svc.z === n.id)) {
    const b = sv('text', { x: 0, y: -30, class: 'endtag', 'text-anchor': 'middle' }); b.textContent = S.svc.a === n.id ? 'A end' : 'Z end'; g.append(b);
  }
  return g;
}
let lastRes = null;
function renderCanvas() {
  gRoot.innerHTML = '';
  const onPath = new Set(lastRes && lastRes.path ? lastRes.path.links : []);
  const lg = sv('g'), ng = sv('g'), og = sv('g');
  for (const l of S.links) {
    const a = node(l.a), b = node(l.b); if (!a || !b) continue;
    const g = sv('g', { class: 'link k-' + l.kind + (l.p.cut ? ' cut' : '') + (sel && sel.id === l.id ? ' sel' : ''), 'data-id': l.id });
    g.append(sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'hit' }));
    g.append(sv('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'wire' }));
    if (onPath.has(l.id)) {
      const ri = lastRes.path.links.indexOf(l.id), from = node(lastRes.path.nodes[ri]);
      const rev = from.id !== a.id;
      og.append(sv('line', { x1: rev ? b.x : a.x, y1: rev ? b.y : a.y, x2: rev ? a.x : b.x, y2: rev ? a.y : b.y, class: 'lightpath ' + (lastRes.status || '') }));
    }
    if (l.kind === 'fiber' || l.p.cut) {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const fb = PHY.FIBERS[l.p.fiber];
      const t = sv('text', { x: mx, y: my - 10, class: 'llabel', 'text-anchor': 'middle' });
      t.textContent = l.kind === 'fiber' ? `${l.p.len} km · ${f1(fb.att * l.p.len + +l.p.extra)} dB` : 'patch';
      g.append(t);
      if (l.p.cut) { const x = sv('text', { x: mx, y: my + 7, class: 'cutmark', 'text-anchor': 'middle' }); x.textContent = '✕'; g.append(x); }
    }
    lg.append(g);
  }
  for (const n of S.nodes) ng.append(nodeShape(n));
  gRoot.append(lg, og, ng);
  const rb = sv('line', { id: 'rubber', class: 'rubber', x1: 0, y1: 0, x2: 0, y2: 0, visibility: 'hidden' });
  gRoot.append(rb);
  applyView();
  $('#emptyhint').hidden = S.nodes.length > 0;
}

// pointer interactions
let drag = null;
svg.addEventListener('pointerdown', e => {
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
  if (!drag) return;
  const w = toWorld(e.clientX, e.clientY);
  drag.moved = true;
  if (drag.kind === 'node') { drag.n.x = Math.round((w.x - drag.dx) / 10) * 10; drag.n.y = Math.round((w.y - drag.dy) / 10) * 10; renderCanvas(); }
  else if (drag.kind === 'pan') { S.view.x = drag.vx - (e.clientX - drag.sx) / S.view.k; S.view.y = drag.vy - (e.clientY - drag.sy) / S.view.k; applyView(); }
  else if (drag.kind === 'cable') { const rb = $('#rubber'); rb.setAttribute('x2', w.x); rb.setAttribute('y2', w.y); }
});
svg.addEventListener('pointerup', e => {
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
  const w = toWorld(e.clientX, e.clientY), k = Math.min(2.5, Math.max(0.25, S.view.k * Math.exp(-e.deltaY * 0.0015)));
  const r = svg.getBoundingClientRect();
  S.view = { k, x: w.x - (e.clientX - r.left) / k, y: w.y - (e.clientY - r.top) / k }; applyView();
}, { passive: false });
svg.addEventListener('dblclick', e => { const nEl = e.target.closest('.node'); if (nEl && node(nEl.dataset.id).type === 'trx') setEnd(nEl.dataset.id); });

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
  if (type === 'trx') { if (!node(S.svc.a)) S.svc.a = n.id; else if (!node(S.svc.z)) S.svc.z = n.id; }
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
    box.append(el('div', { class: 'keys' }, [el('div', { html: '<kbd>V</kbd> select / move' }), el('div', { html: '<kbd>P</kbd> patch cord' }), el('div', { html: '<kbd>F</kbd> fiber span' }), el('div', { html: '<kbd>Del</kbd> delete' }), el('div', { html: 'Drag empty space to pan, scroll to zoom' })]));
    return;
  }
  if (sel.kind === 'node') {
    const n = node(sel.id); if (!n) return;
    const nm = el('input', { value: n.name, id: 'f-name' }); nm.addEventListener('input', () => { n.name = nm.value; renderCanvas(); renderResults(); });
    box.append(el('h3', { text: TYPES[n.type].label }), field('Name', nm));
    const p = n.p;
    if (n.type === 'trx') {
      box.append(field('Mode', selIn(p, 'mode', Object.entries(PHY.MODES).map(([k, m]) => [k, m.name]))));
      const m = PHY.MODES[p.mode];
      box.append(field('Tx power (dBm)', numIn(p, 'tx', 0.5, -15, 3, true, String(m.tx)), `Blank = module default ${m.tx} dBm`));
      box.append(el('div', { class: 'spec' }, [
        specRow('Baud rate', `${(m.Rs / 1e9).toFixed(2)} GBd`), specRow('Modulation', 'DP-' + m.mod), specRow('FEC / limit', `${m.fec} · BER ${m.berThr.toExponential(2)}`),
        specRow('Required OSNR', `${f1(reqOsnr(p.mode))} dB / 0.1 nm`), specRow('Rx window', `${m.rxMin} to ${m.rxMax} dBm`), specRow('CD tolerance', `±${m.cdTol} ps/nm`), specRow('PMD tol. (mean DGD)', `${m.dgdTol} ps`)]));
      const b = el('div', { class: 'row' }, [
        el('button', { class: 'btn', text: S.svc.a === n.id ? 'This is the A end' : 'Set as A end', onclick: () => { if (S.svc.z === n.id) S.svc.z = S.svc.a; S.svc.a = n.id; renderAll(); } }),
        el('button', { class: 'btn', text: S.svc.z === n.id ? 'This is the Z end' : 'Set as Z end', onclick: () => { if (S.svc.a === n.id) S.svc.a = S.svc.z; S.svc.z = n.id; renderAll(); } })]);
      box.append(b);
    } else if (n.type === 'mux') {
      box.append(field('Insertion loss (dB)', numIn(p, 'il', 0.1, 0, 15), 'Typical 40/48 ch AWG or thin-film: 4–6 dB per pass'));
    } else if (n.type === 'edfa') {
      box.append(field('Gain control', selIn(p, 'ctl', [['auto', 'Auto: hit output target'], ['fixed', 'Fixed gain']])));
      if (p.ctl === 'auto') box.append(field('Output target (dBm/ch)', numIn(p, 'target', 0.5, -10, 10, true, String(S.g.launch)), 'Blank = follow the global launch power'));
      else box.append(field('Gain (dB)', numIn(p, 'gain', 0.5, 0, 40)));
      box.append(field('Noise figure (dB)', numIn(p, 'nf', 0.1, 3, 12), 'Quantum limit is 3 dB. Real EDFAs: 4.5–6 dB'));
      box.append(field('Gain range min / max (dB)', el('div', { class: 'pair' }, [numIn(p, 'gmin', 1, 0, 40), numIn(p, 'gmax', 1, 0, 40)])));
      box.append(field('Max total output (dBm)', numIn(p, 'pmax', 0.5, 10, 30), 'Shared by every channel in the fiber'));
    } else if (n.type === 'roadm') {
      box.append(field('WSS loss per pass (dB)', numIn(p, 'wss', 0.5, 0, 15)));
      box.append(field('Add/drop structure loss (dB)', numIn(p, 'ad', 0.5, 0, 15)));
      box.append(field('Integrated amplifiers', selIn(p, 'amps', [['true', 'Yes: preamp + booster'], ['false', 'No (passive)']])));
      box.append(field('Amp noise figure (dB)', numIn(p, 'nf', 0.1, 3, 12)));
      box.append(el('p', { class: 'muted small', text: 'Express traffic passes two WSSs (route and select). Add or drop passes one WSS plus the add/drop structure. Each WSS pass narrows the passband a little.' }));
    } else if (n.type === 'voa') {
      box.append(field('Attenuation (dB)', numIn(p, 'att', 0.5, 0, 30)));
    }
    box.append(el('button', { class: 'btn danger', text: 'Delete device', onclick: del }));
  } else {
    const l = link(sel.id); if (!l) return;
    box.append(el('h3', { text: l.kind === 'fiber' ? 'Fiber span' : 'Patch cord' }), el('p', { class: 'muted', text: linkName(l) }));
    box.append(field('Cable type', selIn(l, 'kind', [['fiber', 'Fiber span (outside plant)'], ['patch', 'Patch cord (in the rack)']])));
    if (l.kind === 'fiber') {
      for (const k in linkDefaults('fiber')) if (l.p[k] == null) l.p[k] = linkDefaults('fiber')[k];
      box.append(field('Length (km)', numIn(l.p, 'len', 1, 0, 300)));
      box.append(field('Fiber type', selIn(l.p, 'fiber', Object.entries(PHY.FIBERS).map(([k, f]) => [k, f.name]))));
      box.append(field('Connector + splice loss (dB)', numIn(l.p, 'extra', 0.1, 0, 20), 'Dirty connector? Add 1–3 dB here'));
      box.append(field('Channels lit on this span', numIn(l.p, 'nch', 1, 1, 96, true, String(S.g.nch)), 'Blank = global. Applies from this span until a mux or ROADM changes it. Fewer neighbours means less nonlinearity.'));
      const fb = PHY.FIBERS[l.p.fiber];
      box.append(el('div', { class: 'spec' }, [specRow('Attenuation', `${fb.att} dB/km`), specRow('Span loss', `${f1(fb.att * l.p.len + +l.p.extra)} dB`), specRow('Dispersion', `${fb.D} ps/nm/km → ${Math.round(fb.D * l.p.len)} ps/nm`), specRow('PMD', `${fb.pmd} ps/√km`), specRow('Nonlinear γ', `${fb.gamma} /W/km`)]));
    } else {
      if (l.p.il == null) l.p.il = linkDefaults('patch').il;
      box.append(field('Loss (dB)', numIn(l.p, 'il', 0.1, 0, 10)));
    }
    box.append(el('div', { class: 'row' }, [
      el('button', { class: 'btn ' + (l.p.cut ? '' : 'danger'), text: l.p.cut ? 'Splice it back' : 'Cut this fiber', onclick: () => { l.p.cut = !l.p.cut; renderAll(); } }),
      el('button', { class: 'btn', text: 'Delete cable', onclick: del })]));
  }
}
function specRow(k, v) { return el('div', {}, [el('span', { text: k }), el('b', { text: v })]); }

// ---------- globals bar ----------
function bindGlobals() {
  const nch = $('#g-nch'), df = $('#g-df'), la = $('#g-launch');
  nch.value = S.g.nch; df.value = S.g.df; la.value = S.g.launch;
  $('#g-nch-v').textContent = S.g.nch; $('#g-launch-v').textContent = (S.g.launch > 0 ? '+' : '') + S.g.launch;
}
$('#g-nch').addEventListener('input', e => { S.g.nch = +e.target.value; $('#g-nch-v').textContent = S.g.nch; recompute(); });
$('#g-df').addEventListener('change', e => { S.g.df = +e.target.value; recompute(); });
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

// ---------- results ----------
const STATUS = { up: 'UP', degraded: 'DEGRADED', down: 'DOWN', los: 'LOS', none: '—', nopath: 'NO PATH' };
let tab = 'power';
function tile(label, val, unit, topic, cls = '') {
  return el('button', { class: 'kpi ' + cls, onclick: () => learn(topic), title: 'Explain ' + label }, [el('span', { class: 'kl', text: label }), el('span', { class: 'kv' }, [document.createTextNode(val), el('small', { text: unit })])]);
}
function renderResults() {
  const r = lastRes; const box = $('#results');
  // service selectors
  const trx = S.nodes.filter(n => n.type === 'trx');
  for (const [id, key] of [['#svc-a', 'a'], ['#svc-z', 'z']]) {
    const s = $(id); s.innerHTML = ''; s.append(el('option', { value: '', text: '— pick —' }));
    trx.forEach(n => s.append(el('option', { value: n.id, text: n.name })));
    s.value = node(S.svc[key]) ? S.svc[key] : '';
  }
  $('#status').className = 'status s-' + r.status; $('#status').textContent = STATUS[r.status];
  $('#headline').textContent = r.headline;
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
      tile('CD', Math.round(r.cd).toLocaleString(), ' ps/nm', 'cd', Math.abs(r.cd) > m.cdTol ? 'bad' : ''), tile('Mean DGD', f1(r.dgd), ' ps', 'pmd'), tile('Distance', Math.round(r.km), ' km', 'span'));
  }
  const al = $('#alarms'); al.innerHTML = '';
  r.alarms.slice(0, 6).forEach(a => al.append(el('li', { class: 'al-' + a.sev, text: a.text })));
  if (r.ber != null) al.append(el('li', { class: 'al-info' }, [diagnose(r)]));
  renderTabBody();
}
function diagnose(r) {
  const b = r.budget, tot = b.ase + b.nli + b.trx + b.rx;
  const parts = [['ase', 'ASE (amplifier noise)', b.ase], ['nli', 'Fiber nonlinearity', b.nli], ['trx', 'Transceiver limit', b.trx], ['rx', 'Receiver noise', b.rx]];
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
  const r = lastRes;
  if (tab === 'learn') return b.append(learnView());
  if (!r || !r.hops) return b.append(el('p', { class: 'muted pad', text: r ? r.headline : '' }));
  if (tab === 'power') b.append(powerChart(r));
  else if (tab === 'hops') b.append(hopTable(r));
  else if (tab === 'spectrum') b.append(spectrumView(r));
  else if (tab === 'const') b.append(constView(r));
  else if (tab === 'sweep') b.append(sweepChart(r));
}

// power map
function powerChart(r) {
  const W = 900, H = 300, ml = 46, mr = 16, mt = 16, mb = 54;
  const hops = r.hops, total = Math.max(1, r.km), nodeW = Math.max(4, total * 0.05);
  let x = 0; const xs = hops.map(h => { const x0 = x; x += h.kind === 'span' ? h.len : h.kind === 'patch' ? nodeW * 0.25 : nodeW; return [x0, x]; });
  const X = v => ml + v / x * (W - ml - mr);
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
      if (h.kind === 'span') { const t = sv('text', { x: (X(xs[i][0]) + X(xs[i][1])) / 2, y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); t.textContent = `${h.len} km`; s.append(t); }
      return;
    }
    const cx = (X(xs[i][0]) + X(xs[i][1])) / 2;
    s.append(sv('line', { x1: cx, x2: cx, y1: mt, y2: H - mb, class: 'tick' }));
    const t = sv('text', { x: cx, y: H - mb + 30 + (i % 3) * 11, class: 'ax node-ax', 'text-anchor': 'middle' }); t.textContent = h.name.replace(/ (pre|boost|express|add|drop)$/, m => m); s.append(t);
  });
  if (isFinite(r.prx)) { const t = sv('text', { x: W - mr, y: Y(r.prx) + 18, class: 'ax strong', 'text-anchor': 'end' }); t.textContent = `Rx ${f1(r.prx)} dBm`; s.append(t); }
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
let specHop = -1;
function spectrumView(r) {
  const wrap = el('div', { class: 'chartwrap' });
  const hops = r.hops.filter(h => h.kind !== 'cut');
  if (!hops.length) return wrap;
  if (specHop < 0 || specHop >= hops.length) specHop = hops.length - 1;
  const h = hops[specHop], df = +r.g.df * 1e9, slots = PHY.cBandSlots(df), lit = Math.min(h.nch, slots);
  const sel = el('select', { id: 'spec-hop', 'aria-label': 'Measurement point' });
  hops.forEach((x, i) => sel.append(el('option', { value: i, text: `After ${x.name}` })));
  sel.value = specHop; sel.addEventListener('change', () => { specHop = +sel.value; renderTabBody(); });
  wrap.append(el('div', { class: 'sp-sel' }, [el('label', { for: 'spec-hop', text: 'Measure at' }), sel]));

  const W = 900, H = 300, ml = 46, mr = 16, mt = 16, mb = 40, f0 = PHY.CBAND.f0 / 1e12, f1v = (PHY.CBAND.f0 + PHY.CBAND.width) / 1e12;
  const Rs = r.mode.Rs, dens = 10 * Math.log10(Rs / PHY.BREF); // channel power -> level seen in a 0.1 nm slice
  const sigD = h.out.sig - dens, aseD = h.out.ase, nliD = h.out.nli;
  const top = Math.max(sigD, aseD) + 8, ymax = Math.ceil(top / 10) * 10, ymin = Math.floor((Math.min(aseD, nliD > -90 ? nliD : aseD) - 14) / 10) * 10;
  const X = f => ml + (f - f0) / (f1v - f0) * (W - ml - mr), Y = v => mt + (ymax - Math.min(ymax, Math.max(ymin, v))) / (ymax - ymin) * (H - mt - mb);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Optical spectrum at the selected point' });
  for (let v = ymin; v <= ymax; v += 10) { s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), class: 'grid' })); const t = sv('text', { x: ml - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = v; s.append(t); }
  for (let f = Math.ceil(f0 * 2) / 2; f <= f1v + 1e-9; f += 0.5) { const t = sv('text', { x: X(f), y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); t.textContent = f.toFixed(1); s.append(t); }
  const xl = sv('text', { x: (ml + W - mr) / 2, y: H - 6, class: 'ax', 'text-anchor': 'middle' }); xl.textContent = 'Frequency (THz)'; s.append(xl);
  const yl = sv('text', { x: 12, y: mt + (H - mt - mb) / 2, class: 'ax', transform: `rotate(-90 12 ${mt + (H - mt - mb) / 2})`, 'text-anchor': 'middle' }); yl.textContent = 'dBm in 0.1 nm'; s.append(yl);
  // ASE fills the whole band (amplifiers amplify noise in unlit slots too)
  if (h.out.ase > -90) s.append(sv('rect', { x: X(f0), y: Y(aseD), width: X(f1v) - X(f0), height: Math.max(0, Y(ymin) - Y(aseD)), class: 'sp-ase' }));
  s.append(sv('line', { x1: X(f0), x2: X(f1v), y1: Y(aseD), y2: Y(aseD), class: 'pl l-ase' }));
  // lit block centred in the band; the service channel sits in its middle
  const first = Math.floor((slots - lit) / 2), me = first + Math.floor(lit / 2);
  for (let k = first; k < first + lit; k++) {
    const fc = f0 + (k + 0.5) * df / 1e12, half = Math.min(Rs, df * 0.92) / 2e12;
    s.append(sv('rect', { x: X(fc - half), y: Y(sigD), width: Math.max(1.5, X(fc + half) - X(fc - half)), height: Math.max(0, Y(ymin) - Y(sigD)), class: k === me ? 'sp-me' : 'sp-ch' }));
  }
  if (nliD > -90 && lit > 0) { // NLI is noise-like and sits under the lit channels
    const a = f0 + first * df / 1e12, b = f0 + (first + lit) * df / 1e12;
    s.append(sv('line', { x1: X(a), x2: X(b), y1: Y(nliD), y2: Y(nliD), class: 'pl l-nli' }));
  }
  const tn = sv('text', { x: W - mr, y: mt + 10, class: 'ax strong', 'text-anchor': 'end' }); tn.textContent = `${lit} ch lit of ${slots} slots (${r.g.df} GHz grid)`; s.append(tn);
  wrap.append(s, el('div', { class: 'legend' }, [lg('l-sig', 'Neighbouring channels'), el('span', {}, [el('i', { style: 'background:var(--accent)' }), 'Service channel']), lg('l-ase', 'ASE floor'), lg('l-nli', 'NLI under the lit channels'),
    el('span', { class: 'muted', text: `Channel power here is ${f1(h.out.sig)} dBm (reads ${f1(sigD)} dBm in a 0.1 nm slice, since a ${(Rs / 1e9).toFixed(0)} GBd signal is ${f1(dens)} dB wider). OSNR = channel power − ASE floor = ${f1(h.out.sig - aseD)} dB. All channels are assumed equal power.` })]));
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
  const pts = []; for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) pts.push([(2 * i - side + 1), (2 * j - side + 1)]);
  const Es = pts.reduce((a, p) => a + p[0] ** 2 + p[1] ** 2, 0) / M;
  const snr = r.effDb != null ? lin(r.effDb) : 0.5, sigma = Math.sqrt(Es / snr / 2);
  const ctx = c.getContext('2d'), cs = getComputedStyle(document.documentElement);
  const fg = cs.getPropertyValue('--ink').trim(), acc = cs.getPropertyValue('--sig').trim(), mut = cs.getPropertyValue('--line').trim();
  const sc = 290 / side, cx = 320;
  ctx.strokeStyle = mut; ctx.lineWidth = 1;
  for (let i = 1; i < side; i++) { const v = (2 * i - side) * sc; /* decision boundaries */ ctx.beginPath(); ctx.moveTo(cx + v, 20); ctx.lineTo(cx + v, 620); ctx.moveTo(20, cx + v); ctx.lineTo(620, cx + v); ctx.stroke(); }
  constSeed = 7;
  ctx.fillStyle = acc; ctx.globalAlpha = 0.45;
  const n = 4000;
  for (let k = 0; k < n; k++) { const p = pts[Math.floor(rand() * M)]; const x = cx + (p[0] + sigma * gauss()) * sc, y = cx - (p[1] + sigma * gauss()) * sc; ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2); }
  ctx.globalAlpha = 1; ctx.fillStyle = fg;
  pts.forEach(p => { ctx.beginPath(); ctx.arc(cx + p[0] * sc, cx - p[1] * sc, 6, 0, 7); ctx.fill(); });
  const evm = 100 / Math.sqrt(snr);
  wrap.append(c, el('div', { class: 'constinfo' }, [
    el('h4', { text: `DP-${r.mode.mod}, one polarization` }),
    specRow('Effective SNR', `${f1(r.effDb)} dB`), specRow('EVM (rms)', `${f1(evm)} %`), specRow('Pre-FEC BER', r.ber < 1e-15 ? '<1e-15' : r.ber.toExponential(2)), specRow('Needed at FEC limit', `${f1(PHY.requiredEffSnrDb(r.mode))} dB SNR`),
    el('p', { class: 'muted small', text: 'Each dot is a received symbol. Noise smears dots away from the ideal points (black). A dot that lands across a grid line is decoded as the wrong symbol: that is a bit error. FEC can fix errors up to its BER limit. Try raising the span length and watch the clouds merge.' })]));
  return wrap;
}

// launch sweep
function sweepChart(r) {
  const W = 900, H = 300, ml = 46, mr = 16, mt = 16, mb = 40, lo = -8, hi = 8;
  const pts = []; for (let p = lo; p <= hi + 1e-9; p += 0.25) { const q = simulate(p); if (q.gosnr != null) pts.push({ p, g: q.gosnr, o: q.osnr, qm: q.qMargin }); }
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
  nli: ['Nonlinear effects', `<p>Glass's refractive index shifts slightly with light intensity (Kerr effect). Channels modulate each other's phase: self-phase modulation, cross-phase modulation, four-wave mixing. Coherent DSP cannot undo most of it, so it acts like noise.</p><p>It grows with launch power cubed, with more channels, and with low dispersion (old NZ-DSF is worse than SMF). Large-core fiber (G.654.E) lowers γ and helps.</p>`],
  cd: ['Chromatic dispersion', `<p>Different wavelengths inside one channel travel at slightly different speeds (17 ps/nm/km on SMF). Coherent DSP undoes it digitally, so it costs no margin until you exceed the module's range: 400ZR handles ±2,400 ps/nm (~140 km SMF), ZR+ about 20,000.</p><p>Past that range the receiver cannot lock: link down, regardless of OSNR.</p>`],
  pmd: ['PMD / DGD', `<p>The two polarizations travel at slightly different speeds because fiber is not perfectly round. Mean differential group delay grows with √length. New fiber is ~0.05 ps/√km; some 1990s fiber is 0.5 or worse.</p><p>Coherent DSP tracks it, with a penalty that grows as you approach the tolerance.</p>`],
  filter: ['Filter narrowing', `<p>Every WSS pass rounds off the edges of the passband. A 60 GBd signal in a 75 GHz slot loses a little each pass; through many ROADMs it adds up. Squeezing a 64 GBd signal into a 50 GHz grid is a big penalty.</p>`],
  rx: ['Receiver power window', `<p>Coherent receivers mix the signal with a local oscillator laser. Too little light and receiver electronics noise takes over (Rx LOW). Too much and the photodiodes and ADCs saturate (Rx HIGH, overload). Far too little is LOS.</p><p>For amplified links the usual target is the middle of the window, set with the preamp or a pad.</p>`],
  launch: ['Launch power', `<p>The per-channel power put into each span. Too low: amplifier noise dominates. Too high: nonlinearity dominates. Somewhere in between (often 0 to +2 dBm/ch for 60 GBd on SMF) GSNR peaks. Open the Launch sweep tab to see your link's curve.</p>`],
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
