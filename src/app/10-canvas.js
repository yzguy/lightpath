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
// Text and the fault badge are drawn in canvas units, so zooming out shrinks them below what can be read. They are counter-scaled to a floor on screen (names 11px,
// cable labels and A/Z tags 9px, the badge 9px across) and only grow, never shrink, so a zoomed-in view looks as drawn.
const floorScale = (px, k, max = 2.4) => Math.min(max, Math.max(1, px / (k * 1)));
function applyView() {
  const k = S.view.k;
  gRoot.setAttribute('transform', `scale(${k}) translate(${-S.view.x},${-S.view.y})`);
  gRoot.style.setProperty('--lf1', floorScale(11, k * 11.5)); gRoot.style.setProperty('--lf2', floorScale(9, k * 11)); gRoot.style.setProperty('--lf3', floorScale(9, k * 10));
  gRoot.querySelectorAll('.faultg').forEach(g => g.setAttribute('transform', `translate(${g.dataset.x},${g.dataset.y}) scale(${floorScale(9, k * 8)})`));
}
function toWorld(cx, cy) { const r = svg.getBoundingClientRect(); return { x: (cx - r.left) / S.view.k + S.view.x, y: (cy - r.top) / S.view.k + S.view.y }; }

// a host whose traffic cannot get through is outlined on the canvas, like any other faulty device (computed once per change, not per drag)
let hostFaults = new Set();
function refreshHostFaults() {
  hostFaults = new Set(); if (!(S.flows || []).length) return;
  const R = MODEL.reach(S, lastRes);
  for (const f of S.flows) { const r = R.find(x => (x.a === f.a && x.z === f.z) || (x.a === f.z && x.z === f.a)); if (r && !r.ok) { hostFaults.add(f.a); hostFaults.add(f.z); } }
}
const slotLbl = k => 'slot ' + (k + 1) + ' (CH' + PHY.slotChannel(k, +S.g.df * 1e9).ch + ')'; // a slot in a label or message: its number and its ITU channel
const chText = (slot, short) => { const c = PHY.slotChannel(slot, +S.g.df * 1e9); return short ? `CH${c.ch} · ${c.fTHz.toFixed(2)}` : c.text; }; // a slot as its ITU channel, with the frequency and wavelength beside it
// A fault badge at the top right of a device, drawn beside it (not inside) so the device's own styling cannot fade it: a red cross for a failed device, an amber
// exclamation mark for a degraded one, a dirty connector or a host whose traffic is stuck. It keeps its size on screen when zoomed out.
function faultBadge(n, body) {
  const kind = n.p && n.p.fail === 'dead' ? 'bad' : (n.p && n.p.fail === 'degraded') || panelDirty(n) || weakPorts(n) || hostFaults.has(n.id) ? 'warn' : null; if (!kind) return null;
  const bb = body.getBBox(), g = sv('g', { class: 'faultg ' + kind, 'data-x': n.x + bb.x + bb.width, 'data-y': n.y + bb.y, 'pointer-events': 'none' });
  g.setAttribute('transform', `translate(${g.dataset.x},${g.dataset.y}) scale(${floorScale(9, S.view.k * 8)})`);
  g.append(sv('circle', { cx: 0, cy: 0, r: 8, class: 'faultbadge' }));
  if (kind === 'bad') g.append(sv('path', { d: 'M-3.2,-3.2 L3.2,3.2 M3.2,-3.2 L-3.2,3.2', class: 'faultx' }));
  else { const t = sv('text', { x: 0, y: 3.8, class: 'faultmark', 'text-anchor': 'middle' }); t.textContent = '!'; g.append(t); }
  return g;
}
const panelDirty = n => n.type === 'panel' && !!n.p.dirty && Object.values(n.p.dirty).some(v => +v > 0.3);
const weakPorts = n => !!n.p && !!n.p.degPorts && Object.values(n.p.degPorts).some(v => +v > 0);
function nodeShape(n) {
  const g = sv('g', { class: 'node t-' + n.type + (panelDirty(n) || weakPorts(n) || hostFaults.has(n.id) ? ' faulty' : '') + (n.p && n.p.fail === 'dead' ? ' failed' : n.p && n.p.fail === 'degraded' ? ' degraded' : '') + (sel && sel.id === n.id ? ' sel' : group.has(n.id) ? ' sel msel' : ''), 'data-id': n.id, transform: `translate(${n.x},${n.y})`, tabindex: 0, role: 'button', 'aria-pressed': (sel && sel.id === n.id) || group.has(n.id) ? 'true' : 'false',
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
  } else if (n.type === 'splitter') {
    g.append(sv('rect', { x: -34, y: -20, width: 68, height: 40, rx: 4, class: 'body' }));
    g.append(sv('path', { d: 'M-28,0 L-6,0 M-6,0 L26,-10 M-6,0 L26,10', class: 'thin' }));
    const t = sv('text', { x: 0, y: -26, class: 'glyph small', 'text-anchor': 'middle' }); t.textContent = n.p.ratio; g.append(t);
    for (const [pt, y] of [['A', -10], ['B', 10]]) { const e = sv('text', { x: 31, y: y + 3, class: 'glyph small' }); e.textContent = pt; g.append(e); }
  } else if (n.type === 'switch') {
    g.append(sv('rect', { x: -34, y: -20, width: 68, height: 40, rx: 4, class: 'body' }));
    g.append(sv('path', { d: 'M-28,0 L-8,0', class: 'thin' }));
    // the port in use, which is not the selected one during a failover
    const fo = lastRes && lastRes.failovers && lastRes.failovers.find(f => f.id === n.id), sel = (fo ? fo.to : n.p.pos) === 'b' ? 10 : -10; g.append(sv('path', { d: `M-8,0 L22,${sel}`, class: 'thin' })); g.append(sv('circle', { cx: 24, cy: sel, r: 2.6, class: 'led' }));
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
  const badged = []; // fault badges need the devices in the document to be measured, so they are added after
  for (const n of S.nodes) { const sh = nodeShape(n); if (hiNodes.has(n.id)) sh.classList.add('chnode'); ng.append(sh); badged.push([n, sh]); }
  gRoot.append(lg, og, ng);
  for (const [n, sh] of badged) {
    const body = sh.querySelector('.body') || sh.querySelector('path, circle, rect') || sh, fb = faultBadge(n, body); if (fb) ng.append(fb);
    const bb = body.getBBox(), h = sv('g', { class: 'chandle', transform: `translate(${bb.x + bb.width + 10},${bb.y + bb.height / 2})` }); // drag from here to another device to cable them
    h.append(sv('circle', { r: 7 }), sv('path', { d: 'M-3.5,0 H3.5 M0,-3.5 V3.5' }), sv('title', {})); h.lastChild.textContent = `Drag to another device to cable ${n.name}`;
    sh.append(h);
  }
  const rb = sv('line', { id: 'rubber', class: 'rubber', x1: 0, y1: 0, x2: 0, y2: 0, visibility: 'hidden' });
  gRoot.append(rb);
  applyView();
  $('#emptyhint').hidden = S.nodes.length > 0;
}

// hovering a device or cable shows what a power meter and an OSA would read there, for the direction shown
const dbmT = x => (x > -90 ? `${f1(x)} dBm` : 'no light');
function hopsOfNode(r, n) { return r && r.hops ? r.hops.filter(h => h.name === n.name || h.name.startsWith(n.name + ' ')) : []; }
function hopsOfLink(r, l) {
  if (!r || !r.path || !r.hops) return [];
  const i = r.path.links.indexOf(l.id); if (i < 0) return [];
  const a = node(r.path.nodes[i]), b = node(r.path.nodes[i + 1]), H = r.hops, mine = (h, n) => n && (h.name === n.name || h.name.startsWith(n.name + ' '));
  let s = -1; H.forEach((h, k) => { if (mine(h, a)) s = k; });
  let e = H.findIndex((h, k) => k > s && mine(h, b)); if (e < 0) e = H.length;
  return H.slice(s + 1, e);
}
function chanOf(r, id) { // the channel a transponder sends or receives, and its result
  const plan = (r && r.derived && r.derived.plan) || S.g.plan || [];
  const i = plan.findIndex(c => !c.filler && (c.tx === id || c.rx === id || c.from === id || c.to === id));
  return i < 0 ? null : { c: plan[i], o: r && r.channels ? r.channels[i] : null };
}
function tipFor(kind, id) {
  const r = view(), lines = [];
  const row = (k, v) => lines.push(el('div', {}, [k + ' ', el('span', { class: 'hv', text: v })]));
  const io = hs => { const a = hs[0], z = hs[hs.length - 1]; row('Power in → out:', `${dbmT(a.in.sig)} → ${dbmT(z.out.sig)} per channel`); if (z.osnr != null) row('OSNR / GSNR after:', `${f1(z.osnr)} / ${f1(z.gosnr)} dB`); if (z.nch > 1) row('Channels here:', String(z.nch)); };
  if (kind === 'node') {
    const n = node(id); if (!n) return null;
    lines.push(el('b', { text: `${n.name} · ${TYPES[n.type].label}` }));
    const hs = hopsOfNode(r, n);
    if (r && r.mode && r.Z && n.id === r.Z.id) { row('Rx power:', `${f1(r.prx)} dBm`); row('Q margin:', `${r.qMargin > 0 ? '+' : ''}${f1(r.qMargin)} dB · ${STATUS[r.status]}`); }
    else if (hs.length) { const z = hs[hs.length - 1]; if (z.kind === 'tx') row('Tx power:', `${f1(z.out.sig)} dBm`); else io(hs); if (z.gain != null && z.kind !== 'tx') row(z.gain >= 0 ? 'Gain:' : 'Loss:', `${f1(Math.abs(z.out.sig - hs[0].in.sig))} dB`); }
    else if (isEnd(n) && uniformSide(n)) lines.push(el('span', { class: 'muted', text: `One of the ${S.g.nch} identical channels on this line. Click it to show its results.` }));
    else if (isEnd(n)) { const ch = chanOf(r, n.id); if (ch && ch.o) { row('Channel:', `${chText(ch.c.slot, true)} THz`); row('Status:', `${STATUS[ch.o.status]}${ch.o.qMargin != null ? ` · Q margin ${ch.o.qMargin > 0 ? '+' : ''}${f1(ch.o.qMargin)} dB` : ''}`); lines.push(el('span', { class: 'muted', text: 'Click it to show its results.' })); } else lines.push(el('span', { class: 'muted', text: 'Not carrying a channel. Cable it to a mux or ROADM port with a partner on the far side.' })); }
    else lines.push(el('span', { class: 'muted', text: r && r.mode ? 'Not on the service path.' : 'No service to measure yet.' }));
  } else {
    const l = link(id); if (!l) return null;
    const fb = PHY.FIBERS[l.p.fiber];
    lines.push(el('b', { text: l.kind === 'fiber' ? `Fiber span · ${l.p.len} km ${fb.name.split(' (')[0]}` : 'Patch cord' }));
    if (MODEL.isCut(S, l)) lines.push(el('span', { class: 'muted', text: 'Cut. Select it and choose Splice it back.' }));
    const hs = hopsOfLink(r, l);
    if (hs.length) io(hs); else if (l.kind === 'fiber') { row('Span loss:', `${f1(fb.att * l.p.len + +l.p.extra)} dB`); lines.push(el('span', { class: 'muted', text: 'Not on the service path.' })); }
  }
  return lines;
}
function showTip(e, t) {
  const tip = $('#hovtip'), lines = tipFor(t.classList.contains('node') ? 'node' : 'link', t.dataset.id); if (!lines) return hideTip();
  tip.replaceChildren(...lines); tip.hidden = false; moveTip(e);
}
function moveTip(e) {
  const tip = $('#hovtip'); if (tip.hidden) return;
  const r = svg.parentElement.getBoundingClientRect(); let x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
  if (x + tip.offsetWidth > r.width - 6) x = e.clientX - r.left - tip.offsetWidth - 14;
  if (y + tip.offsetHeight > r.height - 6) y = e.clientY - r.top - tip.offsetHeight - 14;
  tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, y) + 'px';
}
function hideTip() { $('#hovtip').hidden = true; }
let tipOn = null;
svg.addEventListener('pointerover', e => { if (drag) return; const t = e.target.closest('.node, .link'); if (t && t !== tipOn) { tipOn = t; showTip(e, t); } });
svg.addEventListener('pointerout', e => { const t = e.target.closest('.node, .link'); if (t && !t.contains(e.relatedTarget)) { tipOn = null; hideTip(); } });
svg.addEventListener('pointerleave', () => { tipOn = null; hideTip(); });

// selecting a transponder that carries a channel makes the results describe that channel's two ends
// on a uniform line (no channel plan, no ports) every transponder is one of the identical channels: it takes the place of the service end on its side
function uniformSide(n) {
  if (S.g.plan || (lastRes && lastRes.derived) || !node(S.svc.a) || !node(S.svc.z)) return null;
  const ra = MODEL.route(S, n.id, S.svc.a, true), rz = MODEL.route(S, n.id, S.svc.z, true); if (!ra || !rz) return null;
  return ra.links.length <= rz.links.length ? 'a' : 'z';
}
function followService(n) {
  if (!n || !isEnd(n) || n.id === S.svc.a || n.id === S.svc.z || chal.active) return false; // a challenge's goals are about its own service
  let a, z;
  const side = uniformSide(n);
  if (side) ({ a, z } = { ...S.svc, [side]: n.id });
  else { const ch = chanOf(lastRes, n.id); if (!ch) return false; a = ch.c.tx ?? ch.c.from; z = ch.c.rx ?? ch.c.to; }
  if (!node(a) || !node(z) || !isEnd(node(a)) || !isEnd(node(z)) || a === z) return false;
  S.svc = { a, z }; checkpoint();
  toast(`Results now show ${node(a).name} → ${node(z).name}`, { label: 'Undo', fn: undo });
  return true;
}

// pointer interactions
let drag = null;
svg.addEventListener('pointerdown', e => {
  if (!e.isPrimary) return;
  const nEl = e.target.closest('.node'), lEl = e.target.closest('.link');
  const w = toWorld(e.clientX, e.clientY);
  hideTip();
  if (nEl && e.target.closest('.chandle')) { // the handle beside a device starts a cable whose type is chosen from the two ends
    const n = node(nEl.dataset.id); drag = { kind: 'cable', from: n, moved: false, auto: true };
    const rb = $('#rubber'); rb.setAttribute('x1', n.x); rb.setAttribute('y1', n.y); rb.setAttribute('x2', w.x); rb.setAttribute('y2', w.y); rb.setAttribute('visibility', 'visible'); rb.setAttribute('class', 'rubber');
    svg.setPointerCapture(e.pointerId); return;
  }
  if (nEl) {
    const n = node(nEl.dataset.id);
    if (tool === 'patch' || tool === 'fiber') { drag = { kind: 'cable', from: n, moved: false }; const rb = $('#rubber'); rb.setAttribute('x1', n.x); rb.setAttribute('y1', n.y); rb.setAttribute('x2', w.x); rb.setAttribute('y2', w.y); rb.setAttribute('visibility', 'visible'); rb.setAttribute('class', 'rubber ' + tool); }
    else if (e.shiftKey || e.ctrlKey || e.metaKey) { toggleGroup(n.id); drag = null; }
    else {
      const all = group.has(n.id) ? [...group].map(id => node(id)).filter(Boolean).map(m => ({ n: m, ox: m.x, oy: m.y })) : null; // dragging a member moves the whole selection
      drag = { kind: 'node', n, dx: w.x - n.x, dy: w.y - n.y, moved: false, all, sx: n.x, sy: n.y };
      if (!all) select({ kind: 'node', id: n.id });
    }
  } else if (lEl) { select({ kind: 'link', id: lEl.dataset.id }); drag = null; }
  else if (e.shiftKey) { drag = { kind: 'marquee', x0: w.x, y0: w.y, moved: false }; }
  else { drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y, moved: false }; }
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove', e => {
  if (!drag) return;
  const w = toWorld(e.clientX, e.clientY);
  drag.moved = true;
  if (drag.kind === 'node') {
    const nx = Math.round((w.x - drag.dx) / 10) * 10, ny = Math.round((w.y - drag.dy) / 10) * 10;
    if (drag.all) for (const m of drag.all) { m.n.x = m.ox + nx - drag.sx; m.n.y = m.oy + ny - drag.sy; } else { drag.n.x = nx; drag.n.y = ny; }
    renderCanvas();
  }
  else if (drag.kind === 'marquee') {
    let r = gRoot.querySelector('#marq'); if (!r) { r = sv('rect', { id: 'marq', class: 'marq' }); gRoot.append(r); }
    r.setAttribute('x', Math.min(drag.x0, w.x)); r.setAttribute('y', Math.min(drag.y0, w.y)); r.setAttribute('width', Math.abs(w.x - drag.x0)); r.setAttribute('height', Math.abs(w.y - drag.y0));
  }
  else if (drag.kind === 'pan') { S.view.x = drag.vx - (e.clientX - drag.sx) / S.view.k; S.view.y = drag.vy - (e.clientY - drag.sy) / S.view.k; applyView(); }
  else if (drag.kind === 'cable') { const rb = $('#rubber'); rb.setAttribute('x2', w.x); rb.setAttribute('y2', w.y); }
});
// A drag that is cancelled, loses its capture, or is interrupted by switching windows ends cleanly: the node stays
// where it was dropped and the change is saved (so it can be undone), and the next tap or drag works without a reload.
function abortDrag() { const d = drag; drag = null; $('#rubber').setAttribute('visibility', 'hidden'); const m = gRoot.querySelector('#marq'); if (m) m.remove(); if (d && d.kind === 'node' && d.moved) save(); }
svg.addEventListener('pointercancel', () => abortDrag());
svg.addEventListener('lostpointercapture', () => { if (drag) abortDrag(); });
window.addEventListener('blur', () => abortDrag());
svg.addEventListener('pointerup', e => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.kind === 'cable') {
    $('#rubber').setAttribute('visibility', 'hidden');
    const t = document.elementFromPoint(e.clientX, e.clientY), nEl = t && t.closest && t.closest('.node');
    if (d.auto) { if (nEl && nEl.dataset.id !== d.from.id) { const to = node(nEl.dataset.id); connect(d.from, to, cableKind(d.from, to)); } return; }
    if (nEl && nEl.dataset.id !== d.from.id) { pendingCable = null; connect(d.from, node(nEl.dataset.id), tool); }
    else if (!d.moved || !nEl) { if (!pendingCable) { pendingCable = d.from; toast(`Now click the second device to connect ${d.from.name}`); } else { const a = pendingCable; pendingCable = null; if (a.id !== d.from.id) connect(a, d.from, tool); } }
  } else if (d.kind === 'pan' && !d.moved) select(null);
  else if (d.kind === 'marquee') {
    const m = gRoot.querySelector('#marq'); if (m) m.remove();
    if (!d.moved) select(null); else { const w = toWorld(e.clientX, e.clientY), x0 = Math.min(d.x0, w.x), x1 = Math.max(d.x0, w.x), y0 = Math.min(d.y0, w.y), y1 = Math.max(d.y0, w.y); setGroup(S.nodes.filter(n => n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1).map(n => n.id)); }
  }
  else if (d.kind === 'node' && !d.moved && d.all) select({ kind: 'node', id: d.n.id }); // a click on one member of a selection narrows it to that device
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
const portSlotText = (m, k, side) => { const b = portSlots(m, k, side), lab = side ? sideLabel(m, side) + ' port' : 'Port'; if (b) return `${lab} ${k + 1} · transmit ${slotLbl(b.tx)} · receive ${slotLbl(b.rx)}`; return `${lab} ${k + 1}` + (colorless(m) ? ' · any slot' : ` · slot ${sideRange(m, side)[0] + k + 1} · ${chText(sideRange(m, side)[0] + k)}`); };
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
const cableKind = MODEL.cableKind;
// A new device goes in the first free place near the middle of what you are looking at (not on top of another device), then outwards in a spiral
function freeSpot() {
  const r = svg.getBoundingClientRect(), c = toWorld(r.left + r.width / 2, r.top + r.height / 2), sx = 150, sy = 110;
  const segDist = (x, y, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(x - a.x - t * dx, y - a.y - t * dy); };
  const clearOfCables = (x, y) => S.links.every(l => { const a = node(l.a), b = node(l.b); return !a || !b || segDist(x, y, a, b) >= 55; });
  const free = (x, y) => S.nodes.every(n => Math.abs(n.x - x) >= 120 || Math.abs(n.y - y) >= 90) && clearOfCables(x, y);
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
  if (group.size > 1) { const k = group.size; MODEL.removeNodes(S, [...group]); group.clear(); sel = null; checkpoint(); renderAll(); toast(`Deleted ${k} devices`, { label: 'Undo', fn: undo }); return; }
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
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
    const k = e.key.toLowerCase();
    if (k === 'c' && selIds().length && !String(window.getSelection())) { copySel(); e.preventDefault(); return; }
    if (k === 'x' && selIds().length && !String(window.getSelection())) { cutSel(); e.preventDefault(); return; }
    if (k === 'v' && clip) { pasteClip(); e.preventDefault(); return; }
    if (k === 'd' && selIds().length) { copySel(); pasteClip(); e.preventDefault(); return; }
    if (k === 'a' && S.nodes.length) { setGroup(S.nodes.map(n => n.id)); e.preventDefault(); return; }
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape' && group.size) { setGroup([]); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { del(); e.preventDefault(); }
  else if (e.key === 'v' || e.key === 'Escape') setTool('select');
  else if (e.key === 'p') setTool('patch');
  else if (e.key === 'f') setTool('fiber');
});

