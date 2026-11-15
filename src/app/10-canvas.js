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
// Half the width and height of each device's body (a ROADM is a circle), so a port label can sit just outside it whatever the cable's angle.
const HALF = { trx: [46, 22], mxp: [52, 30], mux: [30, 30], panel: [40, 16], splitter: [34, 20], switch: [34, 20], meter: [34, 18], otdr: [34, 18], host: [38, 20], oadm: [34, 20], edfa: [28, 26], roadm: [32, 32], dcm: [26, 18], voa: [26, 18] };
const edgeDist = (n, ux, uy) => { const [w, h] = HALF[n.type] || [34, 20]; return n.type === 'roadm' ? w : Math.min(Math.abs(ux) > 1e-6 ? w / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-6 ? h / Math.abs(uy) : Infinity); };
// Each label sits beside its wire (above it, or right of a vertical one), far enough out that its own size (it grows when zoomed out) clears the device, then
// tries the other side and slides along the cable (up to the middle) until it covers no device, name, fiber label or port label placed before it. Chosen ports go first, then the
// fixed port names (LINE, IN/OUT); a label with no clear spot is hidden until zooming in makes room.
let placedLf = null;
function placePortLabels(lf) {
  placedLf = lf;
  const fs = 11 * lf, hh = fs * 0.6, boxes = [], box = (bb, e = 0, f = 0) => boxes.push([bb.x + e + bb.width / 2, bb.y + f + bb.height / 2, bb.width / 2, bb.height / 2]);
  for (const g of gRoot.querySelectorAll('.node')) { const m = g.transform.baseVal.consolidate(), e = m ? m.matrix.e : 0, f = m ? m.matrix.f : 0; for (const c of g.querySelectorAll('.body, .nlabel, .endtag')) box(c.getBBox(), e, f); }
  for (const t of gRoot.querySelectorAll('.link .llabel:not(.plabel)')) if (t.textContent) box(t.getBBox());
  const wires = [...gRoot.querySelectorAll('.link .wire')].map(w => [w.parentNode, ...['x1', 'y1', 'x2', 'y2'].map(k => +w.getAttribute(k))]);
  const crosses = ([x0, y0, x1, y1], cx, cy, hx, hy) => { // Liang-Barsky: does the segment enter the box?
    let lo = 0, hi = 1; const dx = x1 - x0, dy = y1 - y0;
    for (const [p, q] of [[-dx, x0 - (cx - hx)], [dx, cx + hx - x0], [-dy, y0 - (cy - hy)], [dy, cy + hy - y0]]) {
      if (p === 0) { if (q < 0) return false; } else { const r = q / p; if (p < 0) lo = Math.max(lo, r); else hi = Math.min(hi, r); if (lo > hi) return false; }
    }
    return true; };
  const labels = [...gRoot.querySelectorAll('.plabel')].sort((p, q) => p.classList.contains('pfixed') - q.classList.contains('pfixed'));
  for (const t of labels) {
    const d = t.dataset, ux = +d.ux, uy = +d.uy, hw = +d.n * fs * 0.31, ext = Math.abs(ux) * hw + Math.abs(uy) * hh, r0 = +d.edge + 5 + ext, half = +d.len / 2;
    const side = (Math.abs(uy) * hw + Math.abs(ux) * hh + 2) * -Math.sign((Math.abs(ux) >= Math.abs(uy) ? ux : uy) || 1), at = (r, o) => [+d.x0 + ux * r - uy * o, +d.y0 + uy * r + ux * o];
    const clear = ([x, y]) => boxes.every(b => Math.abs(x - b[0]) >= hw + b[2] + 2 || Math.abs(y - b[1]) >= hh + b[3] + 1) && wires.every(([g, ...w]) => g === t.parentNode || !crosses(w, x, y, hw, hh));
    const tries = []; for (let r = r0; r <= Math.max(r0, half - ext); r += 4) tries.push(at(r, side), at(r, -side));
    const p = tries.find(clear), show = !!p, q = p || tries[0];
    t.setAttribute('x', q[0]); t.setAttribute('y', q[1]); t.setAttribute('visibility', show ? 'visible' : 'hidden');
    if (show) boxes.push([q[0], q[1], hw, hh]);
  }
}
function applyView() {
  const k = S.view.k;
  gRoot.setAttribute('transform', `scale(${k}) translate(${-S.view.x},${-S.view.y})`);
  const lf2 = floorScale(9, k * 11);
  gRoot.style.setProperty('--lf1', floorScale(11, k * 11.5)); gRoot.style.setProperty('--lf2', lf2);
  if (lf2 !== placedLf || gRoot.querySelector('.plabel:not([x])')) placePortLabels(lf2); gRoot.style.setProperty('--lf3', floorScale(9, k * 10));
  gRoot.querySelectorAll('.faultg').forEach(g => g.setAttribute('transform', `translate(${g.dataset.x},${g.dataset.y}) scale(${floorScale(9, k * 8)})`));
}
function toWorld(cx, cy) { const r = svg.getBoundingClientRect(); return { x: (cx - r.left) / S.view.k + S.view.x, y: (cy - r.top) / S.view.k + S.view.y }; }

// a host whose traffic cannot get through is outlined on the canvas, like any other faulty device (computed once per change, not per drag)
let hostFaults = new Set(), greyRoutes = [];
function refreshHostFaults() {
  // the 1310 nm links between routers (or units) are drawn on the canvas like a service: the simulation reports them unless it stopped early (no service, say)
  greyRoutes = (lastRes && lastRes.b1310) ? lastRes.b1310.links : S.links.some(l => MODEL.cableRole(S, l).role === 'grey') || S.nodes.some(n => (n.type === 'mux' || n.type === 'oadm') && n.p.p1310) ? MODEL.band1310(S).links : [];
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
// The status light on a transponder or muxponder shows its own line, not the service's: the channel it is paired on, or why it has none.
// Returns [light, text] with light one of good, warn, bad, off.
const LAMP = { up: 'good', degraded: 'warn', standby: 'off', none: 'off' };
function endState(n) {
  const r = lastRes, lamp = (st, why) => { why = (why || '').replace(/^Up, but (with a warning: )?/, ''); return [LAMP[st] || 'bad', `line ${(STATUS[st] || st).toLowerCase()}${why ? ': ' + why : ''}`]; };
  if (n.p.fail === 'dead') return ['bad', 'failed'];
  const OFF = ['off', 'not carrying a channel']; if (!r) return OFF;
  const L = lampData(), D = L.D, dk = D && D.dark.find(d => d.id === n.id); if (dk) return ['bad', 'no line: ' + dk.why];
  const margin = q => Number.isFinite(q) ? `${f1(q)} dB margin` : '';
  const chLamp = c => lamp(c.status, c.status === 'up' ? chText(c.slot, true) + ' THz, ' + margin(c.qMargin) : (c.notes || [])[0]);
  const svcLamp = r => lamp(r.status, r.status === 'up' ? margin(r.qMargin) : r.headline);
  const c = (r.channels || []).find(c => c.from === n.id || c.to === n.id); if (c) return chLamp(c);
  if (S.svc.a === n.id || S.svc.z === n.id) return svcLamp(r);
  // a lost service ends the simulation before the other channels are worked out, so a pair without a result is simulated as if it were the service
  const own = (D ? D.plan : S.g.plan || []).find(c => !c.filler && [c.from, c.to].includes(n.id));
  if (own) {
    const k = own.from + '|' + own.to;
    if (!L.pairs.has(k)) L.pairs.set(k, MODEL.simulate({ ...S, svc: { a: own.from, z: own.to }, g: D ? S.g : { ...S.g, plan: S.g.plan.map(e => ({ ...e, svc: e === own })) } }));
    const p = L.pairs.get(k), pc = (p.channels || []).find(c => c.svc);
    return pc ? chLamp(pc) : svcLamp(p); // its own channel: the pair's headline also counts the channels that are failing around it
  }
  return uniformSide(n) ? svcLamp(r) : OFF; // one of the identical channels of a uniform line
}
// Kept while the lab is unchanged, so selecting and hovering reuse it: the channel plan (a failed service end stops the simulation before it reports one)
// and the pairs simulated on their own.
let lampCtx = { res: null, key: '' };
function lampData() {
  if (lampCtx.res === lastRes) return lampCtx;
  const key = strHash(snapshot());
  if (key !== lampCtx.key) lampCtx = { key, D: lastRes.derived || MODEL.effective(S)._derived, pairs: new Map() };
  lampCtx.res = lastRes; return lampCtx;
}
// a muxponder client port passes traffic only if its own optic works and the line does; returns [light, the optic's problem or '']
const RANK = ['off', 'good', 'warn', 'bad'];
function clientLamp(n, i, line) {
  const cl = lastRes && (lastRes.clients || []).find(c => c.node.id === n.id), p = cl && cl.ports[i];
  if (!p || line === 'off') return [line, ''];
  const own = p.status === 'ok' ? 'good' : p.status === 'down' ? 'bad' : 'warn';
  return [RANK[Math.max(RANK.indexOf(line), RANK.indexOf(own))], p.status === 'ok' ? '' : `Client ${i + 1} (${p.optic.name}): ${p.notes.join('; ')}`];
}
// An amplifier card has a stage each way. A booster + pre-amp card: the booster amplifies COM to LINE, the pre-amp LINE to COM. An in-line amplifier:
// Line A to Line B and back. fwd is the first stage (into its first port), rev the second; right: the first stage points right on the canvas.
const ROLE_ABBR = { Booster: 'BST', 'Pre-amp': 'PRE', 'A→B': 'ILA', 'B→A': 'ILA' };
function ampRoles(n) {
  const term = n.p.role !== 'ila', far = id => { const l = S.links.find(x => (x.a === n.id || x.b === n.id) && MODEL.endPort(S, x, n) === id); return l ? node(l.a === n.id ? l.b : l.a) : null; };
  const i = far('IN'), o = far('OUT'), right = i && o ? o.x >= i.x : i ? i.x <= n.x : o ? o.x >= n.x : true;
  return { fwd: term ? 'Booster' : 'A→B', rev: term ? 'Pre-amp' : 'B→A', right };
}
const stageOf = (n, h) => { const R = ampRoles(n); return h && h.port === 'OUT' ? R.rev : R.fwd; }; // the stage a hop's light went through
const oneWayAmp = n => !n.p.bidi && S.links.some(l => (l.a === n.id || l.b === n.id) && l.p.single); // isolators pass one direction of a single fiber
const panelDirty = n => n.type === 'panel' && !!n.p.dirty && Object.values(n.p.dirty).some(v => +v > 0.3);
const weakPorts = n => !!n.p && !!n.p.degPorts && Object.values(n.p.degPorts).some(v => +v > 0);
function nodeShape(n) {
  const g = sv('g', { class: 'node t-' + n.type + (panelDirty(n) || weakPorts(n) || hostFaults.has(n.id) ? ' faulty' : '') + (n.p && n.p.fail === 'dead' ? ' failed' : n.p && n.p.fail === 'degraded' ? ' degraded' : '') + (sel && sel.id === n.id ? ' sel' : group.has(n.id) ? ' sel msel' : ''), 'data-id': n.id, transform: `translate(${n.x},${n.y})`, tabindex: 0, role: 'button', 'aria-pressed': (sel && sel.id === n.id) || group.has(n.id) ? 'true' : 'false',
    'aria-label': `${n.name}, ${(TYPES[n.type] || {}).label || n.type}${S.svc && S.svc.a === n.id ? ', service A end' : S.svc && S.svc.z === n.id ? ', service Z end' : ''}${n.p && n.p.fail === 'dead' ? ', failed' : n.p && n.p.fail === 'degraded' ? ', degraded' : ''}${panelDirty(n) ? ', dirty connector on port ' + Object.entries(n.p.dirty).filter(([, v]) => +v > 0.3).map(([k]) => k).join(', ') : ''}` });
  const st = n.type === 'trx' || n.type === 'mxp' ? endState(n) : null;
  if (st) g.setAttribute('aria-label', g.getAttribute('aria-label') + ', ' + st[1]);
  const linePort = () => sv('rect', { x: 30, y: -6, width: 10, height: 12, rx: 1, class: 'port ' + st[0] }); // the line port doubles as its status light
  if (n.type === 'trx') {
    g.append(sv('rect', { x: -46, y: -22, width: 92, height: 44, rx: 4, class: 'body' }));
    g.append(linePort());
    const t = sv('text', { x: -38, y: 4, class: 'glyph' }); t.textContent = PHY.MODES[n.p.mode].short; g.append(t);
  } else if (n.type === 'mxp') {
    g.append(sv('rect', { x: -46, y: -30, width: 92, height: 60, rx: 4, class: 'body' }));
    const nc = n.p.clients.length;
    n.p.clients.forEach((c, i) => { const y = nc > 1 ? -22 + i * (44 / (nc - 1)) : 0, [cl] = clientLamp(n, i, st[0]); g.append(sv('line', { x1: -56, y1: y, x2: -46, y2: y, class: 'thin' })); g.append(sv('circle', { cx: -56, cy: y, r: 2.6, class: 'led ' + cl })); });
    g.append(linePort());
    const t = sv('text', { x: -38, y: -6, class: 'glyph' }); t.textContent = PHY.MODES[n.p.mode].short; g.append(t);
    const t2 = sv('text', { x: -38, y: 10, class: 'glyph small' }); t2.textContent = `${nc} client${nc === 1 ? '' : 's'}`; g.append(t2);
  } else if (n.type === 'mux') {
    g.append(sv('path', { d: 'M-30,-30 L30,-14 L30,14 L-30,30 Z', class: 'body' }));
    for (let i = -2; i <= 2; i++) g.append(sv('line', { x1: -30, y1: i * 10, x2: -14, y2: i * 4, class: 'thin' }));
    g.append(sv('line', { x1: 0, y1: 0, x2: 30, y2: 0, class: 'thin' }));
    if (n.p.p1310) { g.append(sv('line', { x1: 14, y1: 0, x2: 14, y2: 30, class: 'thin' }), sv('circle', { cx: 14, cy: 32, r: 2.5, class: 'led' })); const e = sv('text', { x: 20, y: 36, class: 'glyph small' }); e.textContent = '1310'; g.append(e); }
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
    if (oneWayAmp(n)) { g.append(sv('path', { d: 'M-26,-26 L30,0 L-26,26 Z', class: 'body' })); const t = sv('text', { x: -18, y: 4, class: 'glyph small' }); t.textContent = 'EDFA'; g.append(t); }
    else { // two amplifiers, one per direction: the top one points right, each named by its role in the direction it points
      const R = ampRoles(n), [rt, lt] = !R ? ['', ''] : R.right ? [R.fwd, R.rev] : [R.rev, R.fwd];
      g.append(sv('path', { d: 'M-26,-26 L30,-14 L-26,-2 Z', class: 'body' }), sv('path', { d: 'M30,2 L-26,14 L30,26 Z', class: 'body' }));
      for (const [txt, x, y, anchor] of [[ROLE_ABBR[rt], -22, -10, 'start'], [ROLE_ABBR[lt], 26, 18, 'end']]) if (txt) { const t = sv('text', { x, y, class: 'glyph small', 'text-anchor': anchor }); t.textContent = txt; g.append(t); }
    }
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
  // each cable a 1310 nm link runs over, with the device the light leaves from and the link's state (a link that stops short is drawn down as far as it gets)
  const grey = new Map(); for (const r of greyRoutes) (r.routeLinks || []).forEach((id, i) => { if (!grey.has(id)) grey.set(id, []); grey.get(id).push({ from: r.routeNodes[i], cls: !r.b || r.status === 'down' ? 'down' : r.status === 'warn' ? 'degraded' : 'up' }); });
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
    for (const [k, gr] of (grey.get(l.id) || []).entries()) {
      // beside the DWDM service when both ride the same fiber; the return direction flows the other way
      const rev = (gr.from !== a.id) !== (dir === 'rev'), o = onPath.has(l.id) || k ? 5 * (k + 1) : 0, ox = -dyn / dn * o, oy = dxn / dn * o;
      const p = rev ? [b, a] : [a, b];
      og.append(sv('line', { x1: p[0].x + ox, y1: p[0].y + oy, x2: p[1].x + ox, y2: p[1].y + oy, class: 'lightpath l1310 ' + gr.cls }));
    }
    if (l.kind === 'fiber' || cutNow) {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const fb = PHY.FIBERS[l.p.fiber];
      const t = sv('text', { x: mx, y: my - 10, class: 'llabel', 'text-anchor': 'middle' });
      const arrow = l.p.dir === 'ab' || l.p.dir === 'ba' ? (() => { const dx = b.x - a.x, dy = b.y - a.y, f = l.p.dir === 'ab' ? 1 : -1; return ' ' + (Math.abs(dx) >= Math.abs(dy) ? (dx * f > 0 ? '→' : '←') : (dy * f > 0 ? '↓' : '↑')); })() : '';
      t.textContent = (l.kind === 'fiber' ? `${l.p.len} km · ${f1(fb.att * l.p.len + +l.p.extra)} dB` + (+l.p.raman > 0 ? ` · Raman ${l.p.raman} mW` : '') + (l.p.srlg ? ` · ${l.p.srlg}` : '') + (l.p.single ? ' · single fiber' : '') : 'patch') + arrow;
      g.append(t);
      const bg = l.kind === 'fiber' && !cutNow ? bgOn(l) : 0;
      if (bg) { const u = sv('text', { x: mx, y: my + 16, class: 'llabel lbg', 'text-anchor': 'middle' }); u.textContent = `+${bg} background ch`; g.append(u); }
      if (cutNow) { const x = sv('text', { x: mx, y: my + 7, class: 'cutmark', 'text-anchor': 'middle' }); x.textContent = '✕'; g.append(x); }
    }
    { const pl = portLink(l), labelAt = (m, o, text, fixedPort) => { // a port label on the cable just outside the device it names (applyView places it)
        const dx = o.x - m.x, dy = o.y - m.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
        const t = sv('text', { class: 'llabel plabel' + (fixedPort ? ' pfixed' : ''), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'data-x0': m.x, 'data-y0': m.y, 'data-ux': ux, 'data-uy': uy, 'data-edge': edgeDist(m, ux, uy), 'data-len': d, 'data-n': text.length });
        t.textContent = text; g.append(t); };
      // every cable end is labelled with its port
      for (const [n, o] of [[a, b], [b, a]]) {
        if (n.type === 'meter' || n.type === 'otdr') { labelAt(n, o, n.type === 'meter' ? 'IN' : 'OTDR', true); continue; }
        const id = MODEL.endPort(S, l, n), k = MODEL.portKind(n, id);
        const t = pl && pl.m === n && l.p.mport != null ? portChText(n, l.p.mport, sideOf(l, n), pl.t) : MODEL.shortLabel(S, n, id);
        if (t) labelAt(n, o, t, k !== 'ad');
      } }
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
// The Line load tops the line up with background channels: on top of the cabled ones (channels from the cabling) or of the service (one uniform line).
// They follow the service's route, so a fiber on it carries all of them.
function bgSplit(n) { const D = lastRes && lastRes.derived; if (D) return Math.min(D.fillers || 0, n); return !S.g.plan && n > 1 ? n - 1 : 0; }
function bgOn(l) { const hs = hopsOfLink(lastRes, l); return hs.length ? bgSplit(Math.max(...hs.map(h => h.nch || 0))) : 0; }
const loadText = n => { const bg = bgSplit(n); return !bg ? String(n) : lastRes.derived ? `${n} · ${n - bg} cabled + ${bg} background` : `${n} · yours + ${bg} background`; };
function chanOf(r, id) { // the channel a transponder sends or receives, and its result
  const D = (r && r.derived) || (lastRes && lampData().D), plan = (D && D.plan) || S.g.plan || [];
  const i = plan.findIndex(c => !c.filler && (c.tx === id || c.rx === id || c.from === id || c.to === id));
  return i < 0 ? null : { c: plan[i], o: r && r.channels ? r.channels[i] : null };
}
function tipFor(kind, id) {
  // one vocabulary per kind of thing, as a power meter or a vendor's PM would label it: Tx and Rx on transponders, input and output on amplifiers and passive
  // devices, and on a cable the power where it leaves one device and where it reaches the next (in the direction the results show)
  const r = view(), head = [], rows = [], notes = [];
  const row = (k, v, words) => rows.push(el('span', { class: 'tk', text: k }), el('span', { class: words ? 'hv words' : 'hv', text: v }));
  const note = t => notes.push(el('span', { class: 'muted', text: t }));
  const z0 = x => (Math.abs(x) < 0.05 ? 0 : x), pw = x => (x > -90 ? `${f1(z0(x))} dBm/ch` : 'no light'), sgn = x => (x > 0 ? '+' : '') + f1(z0(x));
  const lossRow = (a, z) => { if (a > -90 && z > -90) { const d = z - a; row(d > 0.05 ? 'Gain' : 'Loss', `${f1(Math.abs(d))} dB`); } };
  const tail = z => { if (z.osnr != null) row('OSNR / GSNR', `${f1(z.osnr)} / ${f1(z.gosnr)} dB`); if (z.nch > 1) row('Channels', loadText(z.nch), true); };
  if (kind === 'node') {
    const n = node(id); if (!n) return null;
    head.push(el('b', { text: n.name }), el('span', { class: 'tsub', text: ' · ' + TYPES[n.type].label }));
    const hs = hopsOfNode(r, n);
    if (isEnd(n)) {
      // both directions: it transmits on its own and receives what the far end sent, which the forward result reports at Z and the return result at A
      const F = lastRes, R = F && F.rev && F.rev.mode ? F.rev : null, svc = F && F.mode && (n.id === S.svc.a || n.id === S.svc.z), ch = chanOf(F, n.id), [lt, why] = endState(n);
      const rx = svc ? (n.id === S.svc.z ? F : R) : ch && ch.o ? (n.id === ch.c.to ? ch.o : R && R.channels && R.channels[F.channels.indexOf(ch.o)]) : null;
      if (ch) row('Channel', `${chText(ch.c.slot, true)} THz`);
      row('Tx power', n.p.fail === 'dead' ? 'off' : `${f1(MODEL.txPower(n))} dBm`);
      if (rx) { row('Rx power', rx.prx > -90 ? `${f1(rx.prx)} dBm` : 'no light'); if (Number.isFinite(rx.qMargin)) row('Q margin', `${sgn(rx.qMargin)} dB`); row('Status', STATUS[rx.status], true); }
      else if ((svc || ch) && lt === 'bad') row('Rx power', 'no light'); // a lost service ends the simulation before the return direction is worked out
      if (uniformSide(n) && !svc) note(`One of the ${S.g.nch} identical channels on this line. Click it to show its results.`);
      else if (!svc && !ch) note('Not carrying a channel. Cable it to a mux or ROADM port with a partner on the far side.');
      else if (!svc) note('Click it to show its results.');
      if (lt === 'warn' || lt === 'bad') note(why.charAt(0).toUpperCase() + why.slice(1)); // why its status light is amber or red
      if (n.type === 'mxp') n.p.clients.forEach((c, i) => { const bad = clientLamp(n, i, lt)[1]; if (bad) note(bad); });
    }
    else if (n.type === 'edfa' && !oneWayAmp(n) && hopsOfNode(lastRes, n).length) { // both amplifiers of the unit, each with its role
      for (const [res, d] of [[lastRes, 'A→Z'], [lastRes.rev && lastRes.rev.mode ? lastRes.rev : null, 'Z→A']]) {
        const h = hopsOfNode(res, n); if (!h.length) continue; const a = h[0].in.sig, z = h[h.length - 1].out.sig, role = stageOf(n, h[0]);
        row(d + (role ? ' · ' + (n.p.role === 'ila' ? 'stage ' : '') + role : ''), a > -90 && z > -90 ? `${f1(a)} → ${f1(z)} dBm/ch, gain ${sgn(z - a)} dB` : 'no light', true);
      }
      if (hs.length) tail(hs[hs.length - 1]); // OSNR and load: the direction the results show
    }
    else if (hs.length) { const a = hs[0], z = hs[hs.length - 1]; row('Input', pw(a.in.sig)); row('Output', pw(z.out.sig)); lossRow(a.in.sig, z.out.sig); tail(z); }
    else note(r && r.mode ? 'Not on the service path.' : 'No service to measure yet.');
    { const ps = portSummary(n); if (ps) row('Ports', ps, true); }
  } else {
    const l = link(id); if (!l) return null;
    const fb = PHY.FIBERS[l.p.fiber];
    head.push(el('b', { text: l.kind === 'fiber' ? 'Fiber span' : 'Patch cord' }), el('span', { class: 'tsub', text: l.kind === 'fiber' ? ` · ${l.p.len} km ${fb.name.split(' (')[0]}` : '' }));
    if (MODEL.isCut(S, l)) note('Cut. Right-click it and choose Splice it back.');
    const hs = hopsOfLink(r, l), k = r && r.path ? r.path.links.indexOf(l.id) : -1;
    if (hs.length) { const a = hs[0], z = hs[hs.length - 1], up = node(r.path.nodes[k]), dn = node(r.path.nodes[k + 1]); row(`Leaves ${up.name}`, pw(a.in.sig)); row(`Reaches ${dn.name}`, pw(z.out.sig)); lossRow(a.in.sig, z.out.sig); tail(z); }
    else { if (l.kind === 'fiber') row('Span loss', `${f1(fb.att * l.p.len + +l.p.extra)} dB`); note('Not on the service path.'); }
  }
  return [el('div', { class: 'thead' }, head), rows.length ? el('div', { class: 'tgrid' }, rows) : null, ...notes].filter(Boolean);
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
  if (S.g.plan || (lastRes && lampData().D) || !node(S.svc.a) || !node(S.svc.z)) return null;
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
// Empty canvas: a drag pans (so does a middle-button drag or Space + drag anywhere); Shift + drag draws a selection
// box, and Shift + Ctrl/Cmd + drag adds the box to what is already selected. The wheel zooms.
let drag = null, spaceHeld = false, overCanvas = false;
const panning = on => svg.classList.toggle('space', on);
svg.addEventListener('pointerenter', () => { overCanvas = true; });
svg.addEventListener('pointerleave', () => { overCanvas = false; });
document.addEventListener('keydown', e => {
  if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || !overCanvas) return;
  if (e.target.closest && e.target.closest('input,select,textarea,button,.node,.link,[contenteditable]')) return; // Space still presses a focused control or selects a focused device
  e.preventDefault(); if (!spaceHeld) { spaceHeld = true; panning(true); }
});
document.addEventListener('keyup', e => { if (e.key === ' ' && spaceHeld) { spaceHeld = false; panning(false); } });
window.addEventListener('blur', () => { spaceHeld = false; panning(false); });
svg.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); }); // no browser autoscroll on a middle-button pan
const startPan = e => ({ kind: 'pan', sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y, moved: false, quiet: e.button === 1 || spaceHeld });
// Devices whose centre is inside the box from (x0,y0) to (x1,y1), in world coordinates
const inBox = (ax, ay, bx, by) => { const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by); return S.nodes.filter(n => n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1).map(n => n.id); };
svg.addEventListener('pointerdown', e => {
  if (!e.isPrimary || e.button === 2) return; // the right button opens the menu below
  if (e.button === 1 || spaceHeld) { hideTip(); drag = startPan(e); svg.classList.add('grabbing'); svg.setPointerCapture(e.pointerId); e.preventDefault(); return; }
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
  else if (e.shiftKey) { const add = e.ctrlKey || e.metaKey; drag = { kind: 'marquee', x0: w.x, y0: w.y, sx: e.clientX, sy: e.clientY, moved: false, add, base: add ? selIds() : [] }; }
  else { drag = startPan(e); }
  svg.setPointerCapture(e.pointerId);
});
svg.addEventListener('pointermove', e => {
  if (!drag) return;
  const w = toWorld(e.clientX, e.clientY);
  if (drag.kind === 'marquee' && !drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return; // a slightly shaky click is still a click
  drag.moved = true;
  if (drag.kind === 'node') {
    const nx = Math.round((w.x - drag.dx) / 10) * 10, ny = Math.round((w.y - drag.dy) / 10) * 10;
    if (drag.all) for (const m of drag.all) { m.n.x = m.ox + nx - drag.sx; m.n.y = m.oy + ny - drag.sy; } else { drag.n.x = nx; drag.n.y = ny; }
    renderCanvas();
  }
  else if (drag.kind === 'marquee') {
    let r = gRoot.querySelector('#marq'); if (!r) { r = sv('rect', { id: 'marq', class: 'marq' }); gRoot.append(r); }
    r.setAttribute('x', Math.min(drag.x0, w.x)); r.setAttribute('y', Math.min(drag.y0, w.y)); r.setAttribute('width', Math.abs(w.x - drag.x0)); r.setAttribute('height', Math.abs(w.y - drag.y0));
    const hit = new Set([...drag.base, ...inBox(drag.x0, drag.y0, w.x, w.y)]); // preview what the box will take
    for (const g of gRoot.querySelectorAll('.node')) g.classList.toggle('mhit', hit.has(g.dataset.id));
  }
  else if (drag.kind === 'pan') { S.view.x = drag.vx - (e.clientX - drag.sx) / S.view.k; S.view.y = drag.vy - (e.clientY - drag.sy) / S.view.k; applyView(); }
  else if (drag.kind === 'cable') { const rb = $('#rubber'); rb.setAttribute('x2', w.x); rb.setAttribute('y2', w.y); }
});
// A drag that is cancelled, loses its capture, or is interrupted by switching windows ends cleanly: the node stays
// where it was dropped and the change is saved (so it can be undone), and the next tap or drag works without a reload.
function abortDrag() { const d = drag; drag = null; svg.classList.remove('grabbing'); for (const g of gRoot.querySelectorAll('.node.mhit')) g.classList.remove('mhit'); $('#rubber').setAttribute('visibility', 'hidden'); const m = gRoot.querySelector('#marq'); if (m) m.remove(); if (d && d.kind === 'node' && d.moved) save(); }
svg.addEventListener('pointercancel', () => abortDrag());
svg.addEventListener('lostpointercapture', () => { if (drag) abortDrag(); });
window.addEventListener('blur', () => abortDrag());
svg.addEventListener('pointerup', e => {
  if (!drag) return;
  const d = drag; drag = null; svg.classList.remove('grabbing');
  if (d.kind === 'cable') {
    $('#rubber').setAttribute('visibility', 'hidden');
    const t = document.elementFromPoint(e.clientX, e.clientY), nEl = t && t.closest && t.closest('.node');
    if (d.auto) { if (nEl && nEl.dataset.id !== d.from.id) { const to = node(nEl.dataset.id); connect(d.from, to, cableKind(d.from, to)); } return; }
    if (nEl && nEl.dataset.id !== d.from.id) { pendingCable = null; connect(d.from, node(nEl.dataset.id), tool); }
    else if (!d.moved || !nEl) { if (!pendingCable) { pendingCable = d.from; toast(`Now click the second device to connect ${d.from.name}`); } else { const a = pendingCable; pendingCable = null; if (a.id !== d.from.id) connect(a, d.from, tool); } }
  } else if (d.kind === 'pan' && !d.moved && !d.quiet) select(null);
  else if (d.kind === 'marquee') {
    const m = gRoot.querySelector('#marq'); if (m) m.remove();
    if (!d.moved) { if (!d.add) select(null); } // a click on empty space clears the selection
    else { const w = toWorld(e.clientX, e.clientY); setGroup([...new Set([...d.base, ...inBox(d.x0, d.y0, w.x, w.y)])]); }
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

// Right-click: the actions for what is under the pointer, so breaking and repairing things does not need a trip to the inspector
const ctx = $('#ctx');
const closeCtx = () => { ctx.hidden = true; };
function openCtx(e, items) {
  ctx.replaceChildren(...items.filter(Boolean).map(it => it === '-' ? el('div', { class: 'msep', role: 'separator' }) : it.head ? el('div', { class: 'mhead', text: it.head })
    : el('button', { type: 'button', role: 'menuitem', class: 'mi' + (it.danger ? ' danger' : ''), text: it.label, onclick: () => { closeCtx(); it.fn(); } })));
  while (ctx.lastChild && ctx.lastChild.classList.contains('msep')) ctx.lastChild.remove();
  ctx.hidden = false;
  ctx.style.left = Math.max(6, Math.min(e.clientX, innerWidth - ctx.offsetWidth - 6)) + 'px'; ctx.style.top = Math.max(6, Math.min(e.clientY, innerHeight - ctx.offsetHeight - 6)) + 'px';
  ctx.querySelector('.mi')?.focus();
}
const act = (fn, msg) => () => { fn(); checkpoint(); renderAll(); toast(msg, { label: 'Undo', fn: undo }); };
const pick = s => { group.clear(); sel = s; };
function nodeMenu(n) {
  const p = n.p, end = isEnd(n);
  return [{ head: `${n.name} · ${TYPES[n.type].label}` },
    end && S.svc.a !== n.id && { label: 'Make it the A end', fn: act(() => { if (S.svc.z === n.id) S.svc.z = S.svc.a; S.svc.a = n.id; }, `${n.name} is the A end`) },
    end && S.svc.z !== n.id && { label: 'Make it the Z end', fn: act(() => { if (S.svc.a === n.id) S.svc.a = S.svc.z; S.svc.z = n.id; }, `${n.name} is the Z end`) },
    end && '-',
    p.fail !== 'dead' && { label: 'Fail it (no light passes)', danger: true, fn: act(() => { p.fail = 'dead'; }, `${n.name} has failed`) },
    !p.fail && { label: 'Degrade it', fn: act(() => { p.fail = 'degraded'; }, `${n.name} is degraded`) },
    p.fail && { label: 'Repair it', fn: act(() => { p.fail = ''; }, `${n.name} is working again`) },
    p.dirty && Object.keys(p.dirty).length && { label: 'Clean its connectors', fn: act(() => { p.dirty = {}; }, `Cleaned the connectors on ${n.name}`) },
    '-',
    { label: 'Duplicate', fn: () => { pick({ kind: 'node', id: n.id }); copySel(); pasteClip(); } },
    { label: 'Delete', danger: true, fn: () => { pick({ kind: 'node', id: n.id }); del(); } }];
}
function linkMenu(l) {
  const cut = !!l.p.cut, name = linkName(l);
  return [{ head: name },
    { label: cut ? 'Splice it back' : l.kind === 'fiber' ? 'Cut this fiber' : 'Cut this cable', danger: !cut, fn: act(() => { l.p.cut = !cut; }, `${cut ? 'Spliced' : 'Cut'} ${name}`) },
    l.kind === 'fiber' && !cut && { label: 'Add an amplifier halfway', fn: () => applyFix({ type: 'insertAmp', id: l.id }) },
    '-',
    { label: 'Delete cable', danger: true, fn: () => { pick({ kind: 'link', id: l.id }); del(); } }];
}
function canvasMenu(w) {
  return [clip && { label: 'Paste', fn: pasteClip }, clip && '-',
    ...[['trx', 'a transponder'], ['edfa', 'an EDFA'], ['roadm', 'a ROADM'], ['mux', 'a mux'], ['panel', 'a patch panel'], ['voa', 'an attenuator']].map(([t, what]) => ({ label: `Add ${what} here`, fn: () => addNode(t, w.x, w.y) })),
    '-', { label: 'Fit the view', fn: () => { fitView(); applyView(); } }];
}
svg.addEventListener('contextmenu', e => {
  e.preventDefault(); hideTip(); abortDrag();
  const nEl = e.target.closest('.node'), lEl = e.target.closest('.link');
  const n = nEl && node(nEl.dataset.id), l = !n && lEl && link(lEl.dataset.id);
  if (n || l) { const s = { kind: n ? 'node' : 'link', id: (n || l).id }; if (!sel || sel.id !== s.id || group.size) { pick(s); renderAll(); } } // shows what the menu acts on, without making the results follow it
  openCtx(e, n ? nodeMenu(n) : l ? linkMenu(l) : canvasMenu(toWorld(e.clientX, e.clientY)));
});
document.addEventListener('pointerdown', e => { if (!ctx.hidden && !ctx.contains(e.target)) closeCtx(); }, true);
document.addEventListener('keydown', e => {
  if (ctx.hidden) return;
  if (e.key === 'Escape') { closeCtx(); e.stopPropagation(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { const it = [...ctx.querySelectorAll('.mi')], i = it.indexOf(document.activeElement); it[(i + (e.key === 'ArrowDown' ? 1 : -1) + it.length) % it.length].focus(); e.preventDefault(); }
  if (e.key.length === 1 || e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation(); // the canvas shortcuts must not act behind an open menu
}, true);
window.addEventListener('blur', closeCtx); window.addEventListener('scroll', closeCtx);

// a transponder or muxponder plugged into a passive mux: the cable's `mport` is the mux port it uses (port k passes slot first+k)
const roleOf = l => (node(l.a) && node(l.b) ? MODEL.cableRole(S, l) : null);
const greyLink = l => { const r = roleOf(l); return !!r && r.role === 'grey'; }; // a host's grey optic in the 1310 nm port of a mux or OADM
const clientLink = l => { const r = roleOf(l); return !!r && r.role === 'client'; }; // a host port to a transponder or muxponder client port
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
const portLink = l => { const r = roleOf(l); return r && r.role === 'port' ? { t: r.t, m: r.m } : null; }; // a transponder's line port in an add/drop port of a mux, OADM or ROADM
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
// the channel a port passes, as its cable is labeled: a BiDi port's transmit/receive pair; a colorless port passes what its transponder is tuned to
const portChText = (m, k, side, t) => {
  const ch = s => 'CH' + PHY.slotChannel(s, +S.g.df * 1e9).ch, b = portSlots(m, k, side);
  if (m.type === 'oadm') { const c = s => PHY.slotChannel(s, +S.g.df * 1e9).ch, sd = side.toUpperCase(); return b ? `${c(b.tx)}/${c(b.rx)}${sd}` : `${c(sideRange(m, side)[0] + k)}${sd}`; } // an OADM channel port is named by channel and side: 34W, 35E
  if (b) return `${ch(b.tx)}/${ch(b.rx)}`;
  if (!colorless(m)) return ch(sideRange(m, side)[0] + k);
  const c = chanOf(lastRes, t.id); return c ? ch(c.c.slot) : `${side ? 'D' + side + '·' : ''}P${k + 1}`;
};
const portSlotText = (m, k, side) => { const b = portSlots(m, k, side), lab = side ? sideLabel(m, side) + ' port' : 'Port'; if (b) return `${lab} ${k + 1} · transmit ${slotLbl(b.tx)} · receive ${slotLbl(b.rx)}`; return `${lab} ${k + 1}` + (colorless(m) ? ' · any slot' : ` · slot ${sideRange(m, side)[0] + k + 1} · ${chText(sideRange(m, side)[0] + k)}`); };
// a slot number box that shows slots from 1 (the model counts from 0)
function slotBox(obj, key, id) { const i = el('input', { type: 'number', step: 1, min: 1, max: 64, value: (Math.round(+obj[key]) || 0) + 1, id }); i.addEventListener('input', () => { if (i.value !== '' && isFinite(+i.value)) { obj[key] = Math.min(63, Math.max(0, Math.round(+i.value) - 1)); recompute(); } }); return i; }
// Cabling asks which port at each end, like EVE-NG asks for the interfaces. Any free port will do, even a wrong one: the simulation then shows what that does.
function connect(a, b, kind) {
  const inst = x => x.type === 'meter' || x.type === 'otdr', test = (x, i) => x.type === 'panel' || x.type === 'splitter' || x.type === 'switch' || (x.type === 'edfa' && i.type === 'meter');
  if ((inst(a) || inst(b)) && !((inst(a) && test(b, a)) || (inst(b) && test(a, b)))) return toast('An instrument plugs into a test point: a patch panel port, a splitter or switch port, or (a power meter) an amplifier\'s monitor port.');
  if (!inst(a) && !inst(b)) { const why = MODEL.cableFits(S, a, b); if (why) return toast(why); } // one cable per port: a full device takes no more
  pickPorts(a, b, kind);
}
const portUser = (n, except) => { const m = new Map(); for (const l of S.links) if (l !== except && (l.a === n.id || l.b === n.id) && ![node(l.a), node(l.b)].some(x => x && (x.type === 'meter' || x.type === 'otdr'))) m.set(MODEL.endPort(S, l, n), node(l.a === n.id ? l.b : l.a)); return m; };
// a select of a device's ports; a port in use by another cable is shown and cannot be picked (an instrument clips onto any port)
function portSelect(n, value, except, probe, id) {
  const s = el('select', { id, 'aria-label': `Port on ${n.name}` }), u = portUser(n, except), list = MODEL.portsOf(S, n);
  if (!value && list.length > 1) s.append(el('option', { value: '', text: 'Choose a port…' }));
  for (const p of list) { const o = u.get(p.id), opt = el('option', { value: p.id, text: p.label + (o ? ` · in use by ${o.name}` : '') }); if (o && !probe && p.id !== value) opt.disabled = true; s.append(opt); }
  if (value && !list.some(p => p.id === value)) s.append(el('option', { value, text: `${MODEL.portLabel(S, n, value)} · not on this device` })); // a port the device no longer has
  s.value = value || (list.length === 1 ? list[0].id : ''); return s;
}
// after a port changes: a transponder newly in an add/drop port takes the lab off its channel table, a host in a 1310 nm port turns that module on
function afterPorts(l) {
  const r = roleOf(l);
  if (r && r.role === 'port' && S.g.table) S.g.table = false;
  if (r && r.role === 'grey' && !r.u.p.p1310) { r.u.p.p1310 = true; toast(`${r.u.name}: 1310 nm module turned on`); }
  MODEL.assignSides(S);
}
// The port picker for a new cable: one select per end, nothing chosen until you choose (a one-port instrument excepted). Connect makes the cable;
// Cancel, Esc or a click elsewhere makes nothing.
const picker = $('#portpick');
function pickPorts(a, b, kind) {
  const probe = [a, b].some(x => x.type === 'meter' || x.type === 'otdr');
  const sa = portSelect(a, '', null, probe, 'pp-a'), sb = portSelect(b, '', null, probe, 'pp-b');
  const go = el('button', { class: 'btn primary', type: 'button', text: 'Connect' });
  const ready = () => { go.disabled = !sa.value || !sb.value; }; sa.addEventListener('change', ready); sb.addEventListener('change', ready); ready();
  const done = keep => {
    picker.hidden = true; document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', away, true);
    if (!keep) { toast('Cable not made'); return; }
    const l = { id: uid('l'), a: a.id, b: b.id, kind, p: { ...linkDefaults(kind), pa: sa.value, pb: sb.value } };
    S.links.push(l); afterPorts(l); checkpoint(); select({ kind: 'link', id: l.id });
    toast(`${kind === 'fiber' ? 'Fiber span' : 'Patch cord'}: ${a.name} ${MODEL.portLabel(S, a, sa.value)} ↔ ${b.name} ${MODEL.portLabel(S, b, sb.value)}`);
  };
  go.addEventListener('click', () => { if (!go.disabled) done(true); });
  const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); if (!go.disabled) done(true); } else e.stopPropagation(); }; // no canvas shortcut (Delete, undo) acts behind it
  const away = e => { if (!picker.contains(e.target)) done(false); };
  picker.replaceChildren(el('div', { class: 'mhead', text: `${a.name} ↔ ${b.name}` }), el('label', { class: 'pp-row' }, [el('span', { text: a.name }), sa]), el('label', { class: 'pp-row' }, [el('span', { text: b.name }), sb]),
    el('div', { class: 'row pp-btns' }, [go, el('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: () => done(false) })]));
  picker.hidden = false;
  const r = svg.getBoundingClientRect(), k = S.view.k, x = r.left + ((a.x + b.x) / 2 - S.view.x) * k, y = r.top + ((a.y + b.y) / 2 - S.view.y) * k;
  picker.style.left = Math.max(6, Math.min(x - picker.offsetWidth / 2, innerWidth - picker.offsetWidth - 6)) + 'px';
  picker.style.top = Math.max(6, Math.min(y + 18, innerHeight - picker.offsetHeight - 6)) + 'px';
  document.addEventListener('keydown', key, true); setTimeout(() => document.addEventListener('pointerdown', away, true));
  (sa.value ? sb : sa).focus();
}
// what a device's ports are doing, for the hover readout
function portSummary(n) {
  const list = MODEL.portsOf(S, n), u = portUser(n);
  if (n.type === 'meter' || n.type === 'otdr') return '';
  return `ports ${list.filter(p => u.has(p.id)).length} of ${list.length} in use`;
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
  if (e.key === 'Escape' && (group.size || (sel && tool === 'select'))) { pendingCable = null; select(null); return; } // Esc clears the selection, then (pressed again) leaves a cable tool
  if (e.key === 'Delete' || e.key === 'Backspace') { del(); e.preventDefault(); }
  else if (e.key === 'v' || e.key === 'Escape') setTool('select');
  else if (e.key === 'p') setTool('patch');
  else if (e.key === 'f') setTool('fiber');
});

