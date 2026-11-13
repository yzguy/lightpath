// ---------- inspector ----------
function select(s) { group.clear(); sel = s; if (s && s.kind === 'node') followService(node(s.id)); renderAll(); }
// Selecting several devices: Shift-click toggles one, Shift-drag on empty space boxes them, Ctrl+A takes all. Copy, paste and duplicate work on the selection.
function setGroup(ids) { group.clear(); if (ids.length === 1) { select({ kind: 'node', id: ids[0] }); return; } ids.forEach(id => group.add(id)); sel = null; renderAll(); }
function toggleGroup(id) {
  const cur = group.size ? [...group] : sel && sel.kind === 'node' ? [sel.id] : [], i = cur.indexOf(id);
  if (i >= 0) cur.splice(i, 1); else cur.push(id);
  setGroup(cur);
}
const selIds = () => (group.size > 1 ? [...group] : sel && sel.kind === 'node' && node(sel.id) ? [sel.id] : []);
function alignSel(mode) { if (MODEL.alignNodes(S, [...group], mode)) { checkpoint(); renderAll(); } }
function cutSel() { if (!copySel()) return; del(); }
function copySel() { const ids = selIds(); if (!ids.length) return false; clip = MODEL.copySelection(S, ids); pasteN = 0; toast(`Copied ${ids.length} device${ids.length > 1 ? 's' : ''}. Ctrl+V pastes.`); return true; }
function pasteClip() {
  if (!clip || !clip.nodes.length) { toast('Nothing copied yet: select devices and press Ctrl+C'); return; }
  pasteN++; const r = MODEL.pasteSelection(S, clip, 60 * pasteN, 60 * pasteN), k = r.nodeIds.length; checkpoint();
  setGroup(r.nodeIds); toast(`Pasted ${k} device${k > 1 ? 's' : ''}`, { label: 'Undo', fn: undo });
}
// the explanation under a field is one click away (the ? beside the label, or hover it); 'Show help text' in the inspector opens them all
function field(label, input, hint) {
  const lab = el('label', { class: 'fld' }), q = hint ? el('button', { type: 'button', class: 'qhelp', text: '?', title: hint, 'aria-label': 'What is ' + label + '?', onclick: e => { e.preventDefault(); e.stopPropagation(); lab.classList.toggle('open'); } }) : null;
  lab.append(el('span', { class: 'flab' }, [label, q].filter(Boolean)), input); if (hint) lab.append(el('small', { text: hint })); return lab;
}
let helpAll = false; try { helpAll = localStorage.getItem('lightpath-help') === '1'; } catch (e) { /* no storage */ }
function numIn(obj, key, step = 0.5, min, max, allowBlank, placeholder) {
  const i = el('input', { type: 'number', step, value: obj[key], id: 'f-' + key }); if (min != null) i.min = min; if (max != null) i.max = max; if (placeholder) i.placeholder = placeholder;
  const out = v => (min != null && v < +min) || (max != null && v > +max);
  i.addEventListener('input', () => {
    i.removeAttribute('aria-invalid');
    if (i.value === '' && allowBlank) obj[key] = '';
    else if (i.value !== '' && isFinite(+i.value)) { if (out(+i.value)) { i.setAttribute('aria-invalid', 'true'); return; } obj[key] = +i.value; }
    else return;
    recompute();
  });
  i.addEventListener('change', () => { // a value typed outside the range is pulled to the nearest limit when the field is left, not while typing
    if (i.value === '' || !isFinite(+i.value) || !out(+i.value)) return;
    const v = Math.min(max != null ? +max : Infinity, Math.max(min != null ? +min : -Infinity, +i.value));
    i.value = v; obj[key] = v; i.removeAttribute('aria-invalid'); toast(`Out of range (${min ?? '−∞'} to ${max ?? '∞'}): set to ${v}`); recompute();
  });
  return i;
}
function selIn(obj, key, opts) {
  const s = el('select', { id: 'f-' + key }); for (const [v, t] of opts) s.append(el('option', { value: v, text: t }));
  s.value = String(obj[key]); s.addEventListener('change', () => { obj[key] = s.value === 'true' ? true : s.value === 'false' ? false : s.value; renderAll(); }); return s;
}
let assumeOpen, inspKey, kpiAll = false, ramanOpen;
// The add/drop ports of a mux, OADM or ROADM, one row each: what it passes and what is plugged in. Hover a channel for the full detail; click a used row to select its transponder.
function portTable(n) {
  const used = portsUsed(n), tb = el('tbody'), ch = s => PHY.slotChannel(s, +S.g.df * 1e9).ch;
  for (const sd of deviceSides(n)) for (let k = 0; k < Math.min(64, portCount(n, sd)); k++) {
    const t = used.get(sd + '|' + k), b = portSlots(n, k, sd);
    const name = n.type === 'oadm' ? `${sd.toUpperCase()}${k + 1}` : n.type === 'roadm' && sd ? `D${sd}·P${k + 1}` : `P${k + 1}`;
    const pass = colorless(n) ? 'any slot' : b ? `CH${ch(b.tx)} / CH${ch(b.rx)}` : chText(sideRange(n, sd)[0] + k, true);
    tb.append(el('tr', t ? { class: 'on', title: `Select ${t.name}`, onclick: () => select({ kind: 'node', id: t.id }) } : {}, [el('td', { text: name }), el('td', { text: pass, title: portSlotText(n, k, sd) }), el('td', { text: t ? t.name : 'free' })]));
  }
  if (!tb.children.length) return el('p', { class: 'muted small', text: 'No ports.' });
  return el('div', { class: 'ptable' }, [el('table', {}, [el('thead', {}, [el('tr', {}, [el('th', { text: 'Port' }), el('th', { text: b0(n) }), el('th', { text: 'Plugged in' })])]), tb])]);
}
const b0 = n => (colorless(n) ? 'Passes' : (n.type !== 'roadm' && n.p.bidi) ? 'Tx / Rx channel' : 'Channel · THz');
// The ports a cable's two ends use, one select per choice. Shared by the cable inspector and the picker that opens when a new cable has a port to choose.
// A change applies at once, then after() runs. An option in use by another cable is marked (data-used) so the picker can refuse it.
function portControls(l, after = renderAll) {
  const out = [], seenHints = new Set(), once = (k, t) => (seenHints.has(k) ? undefined : (seenHints.add(k), t));
  const opt = (value, text, used) => { const o = el('option', { value, text: text + (used ? ` · in use${used === true ? '' : ' by ' + used}` : '') }); if (used) o.dataset.used = '1'; return o; };
  if (clientLink(l)) {
    const a = node(l.a), h = a.type === 'host' ? a : node(l.b), e = h === a ? node(l.b) : a, mine = S.links.filter(x => x !== l && clientLink(x));
    const usedH = new Set(mine.filter(x => x.a === h.id || x.b === h.id).map(x => x.p.hport)), usedC = new Map(mine.filter(x => x.a === e.id || x.b === e.id).map(x => [x.p.cport, (node(x.a).type === 'host' ? node(x.a) : node(x.b)).name]));
    const hs = el('select', { id: 'f-hport', 'aria-label': 'Host port' });
    for (let k = 0; k < h.p.ports; k++) hs.append(opt(String(k), `Port ${k + 1} (${h.p.speed}G)`, usedH.has(k)));
    hs.value = String(l.p.hport ?? 0); hs.addEventListener('change', () => { l.p.hport = +hs.value; after(); });
    out.push({ label: `Port on ${h.name}`, sel: hs });
    const cs = el('select', { id: 'f-cport', 'aria-label': 'Client port' });
    for (let k = 0; k < clientCount(e); k++) { const o = e.type === 'mxp' ? PHY.CLIENT_OPTICS[e.p.clients[k].optic] : null; cs.append(opt(String(k), `Client port ${k + 1}` + (o ? ` (${o.name})` : ` (${PHY.MODES[e.p.mode].rate}G)`), usedC.get(k))); }
    cs.value = String(l.p.cport ?? 0); cs.addEventListener('change', () => { l.p.cport = +cs.value; after(); });
    out.push({ label: `Client port on ${e.name}`, sel: cs, hint: e.type === 'mxp' ? 'A muxponder client port is carried to the same-numbered client port on the far muxponder.' : 'A transponder has one client port; it has to match the line rate.' });
  }
  if (portLink(l)) {
    const { t, m } = portLink(l), used = portsUsed(m, l), so = el('select', { id: 'f-mport', 'aria-label': 'Port' });
    so.append(el('option', { value: '', text: 'Not assigned (no port model)' }));
    for (const sd of deviceSides(m)) { for (let k = 0; k < portCount(m, sd); k++) so.append(opt(`${sd}:${k}`, portSlotText(m, k, sd), used.has(sd + '|' + k) && used.get(sd + '|' + k).name)); }
    so.value = l.p.mport == null ? '' : `${sideOf(l, m)}:${l.p.mport}`;
    so.addEventListener('change', () => { if (so.value === '') l.p.mport = null; else { const [sd, k] = so.value.split(':'); if (m.type !== 'mux') setSide(l, m, sd); l.p.mport = +k; } after(); });
    out.push({ label: `Port on ${m.name}`, sel: so, hint: `${t.name} is plugged into this port. The filter passes only that port's slot, so ${t.name} has to be tuned to it (Auto follows the port).${m.type === 'oadm' ? ' Its light goes out on that side of the OADM.' : m.type === 'roadm' && !m.p.directionless ? ' Its light goes out on that degree only (the ROADM is not directionless).' : ''}` });
  }
  for (const n of [node(l.a), node(l.b)]) if (n && n.type === 'panel') {
    const ps = el('select', { id: 'f-odf-' + n.id, 'aria-label': `Port on ${n.name}` }), used = new Set(S.links.filter(x => x !== l && (x.a === n.id || x.b === n.id)).map(x => sideOf2(x, n)));
    for (let k = 1; k <= n.p.ports; k++) for (const sd of ['r', 'f']) ps.append(opt(sd + k, `${sd === 'r' ? 'Rear' : 'Front'} of port ${k}` + (n.p.dirty && n.p.dirty[k] ? ' · dirty' : ''), used.has(sd + k)));
    ps.value = sideOf2(l, n) || 'r1'; ps.addEventListener('change', () => { setSide(l, n, ps.value); after(); });
    out.push({ label: `Port on ${n.name}`, sel: ps, hint: once('panel', 'Light enters one side of a port and leaves the other side of the same port: the rear is usually the outside plant, the front the patch cords to equipment. Each mated connector pair costs the panel\'s connector loss.') });
  }
  for (const n of [node(l.a), node(l.b)]) if (isTri(n)) {
    const ps = el('select', { id: 'f-tri-' + n.id, 'aria-label': `Port on ${n.name}` }), used = new Map(S.links.filter(x => x !== l && (x.a === n.id || x.b === n.id)).map(x => [sideOf2(x, n), 1]));
    for (const k of ['c', 'a', 'b']) ps.append(opt(k, TRI_NAME[k] + (n.type === 'splitter' && k === 'b' ? ' (tap / second branch)' : ''), used.has(k)));
    ps.value = sideOf2(l, n) || 'c'; ps.addEventListener('change', () => { setSide(l, n, ps.value); after(); });
    out.push({ label: `Port on ${n.name}`, sel: ps, hint: once('tri', n.type === 'splitter' ? 'Light goes between the common port and either branch, never between the two branches. A 99/1 tap sends 1% to port B.' : 'The common port is the one the receiver side hangs off; the switch passes port A or port B to it.') });
  }
  for (const n of [node(l.a), node(l.b)]) if (n && (n.type === 'oadm' || n.type === 'roadm') && !(portLink(l) && portLink(l).m === n) && !isEnd(n === node(l.a) ? node(l.b) : node(l.a))) { // a line cable on an OADM or ROADM: which side or degree of it
    const ss = el('select', { id: 'f-side-' + n.id, 'aria-label': `Side of ${n.name}` }), other = n === node(l.a) ? node(l.b) : node(l.a);
    const usedS = new Set(n.type === 'roadm' ? S.links.filter(x => x !== l && !portLink(x) && (x.a === n.id || x.b === n.id)).map(x => sideOf(x, n)) : []);
    for (const sd of lineSides(n)) ss.append(opt(sd, sideLabel(n, sd), usedS.has(sd)));
    ss.value = sideOf(l, n) || (n.type === 'roadm' ? lineSides(n)[0] : defSide(n, other)); ss.addEventListener('change', () => { setSide(l, n, ss.value); after(); });
    out.push({ label: n.type === 'roadm' ? `Degree on ${n.name}` : `Line side on ${n.name}`, sel: ss, hint: once('side', n.type === 'roadm' ? 'Each line cable is one degree of the ROADM. If the add/drop is not directionless, a transponder port belongs to one degree and its light only leaves by that one.' : 'West is where the line comes from on the left, East the right. A transponder on a West port talks to the West line only.') });
  }
  return out;
}
// a new selection opens at the top (type, name, actions); an edit to the same selection keeps the scroll position
function renderInspector() {
  const box = $('#insp'), top = box.scrollTop, key = sel ? sel.kind + ':' + sel.id : '';
  if (key !== inspKey) ramanOpen = undefined;
  renderInspectorBody(); box.scrollTop = key === inspKey ? top : 0; inspKey = key;
  box.classList.toggle('showhelp', helpAll);
  const h = box.querySelector('h2');
  if (h && box.querySelector('.qhelp')) h.after(el('button', { type: 'button', class: 'btn quiet helpsw', text: helpAll ? 'Hide help text' : 'Show help text', onclick: () => { helpAll = !helpAll; try { localStorage.setItem('lightpath-help', helpAll ? '1' : '0'); } catch (e) { /* no storage */ } renderInspector(); } }));
}
function renderInspectorBody() {
  const box = $('#insp'); box.innerHTML = '';
  if (group.size > 1) {
    const ns = [...group].map(id => node(id)).filter(Boolean), cables = S.links.filter(l => group.has(l.a) && group.has(l.b)).length;
    box.append(el('h2', { text: `${ns.length} devices selected` }),
      el('p', { class: 'muted', text: `${cables} cable${cables === 1 ? '' : 's'} between them. Drag one of them to move all, Shift-click to add or remove one, Esc to clear.` }),
      el('div', { class: 'row' }, [el('button', { class: 'btn', text: 'Cut', title: 'Ctrl+X', onclick: cutSel }), el('button', { class: 'btn', text: 'Copy', title: 'Ctrl+C', onclick: copySel }), el('button', { class: 'btn', text: 'Duplicate', title: 'Ctrl+D', onclick: () => { copySel(); pasteClip(); } }), el('button', { class: 'btn quiet', text: 'Delete', title: 'Del', onclick: del }), el('button', { class: 'btn quiet', text: 'Clear selection', onclick: () => setGroup([]) })]),
      el('div', { class: 'row' }, [['left', 'Align left'], ['center', 'Align centres'], ['right', 'Align right'], ['top', 'Align top'], ['middle', 'Align middles'], ['bottom', 'Align bottom'], ['hspace', 'Space evenly across'], ['vspace', 'Space evenly down']]
        .map(([m, t]) => el('button', { class: 'btn quiet', text: t, disabled: (m === 'hspace' || m === 'vspace') && ns.length < 3, onclick: () => alignSel(m) }))),
      el('ul', { class: 'muted small' }, ns.map(n => el('li', { text: `${n.name} · ${TYPES[n.type].label}` }))));
    return;
  }
  if (!sel) {
    box.append(el('h2', { text: 'Inspector' }), ...[introCard(labKey)].filter(Boolean), el('p', { class: 'muted', html: 'Select a device or a cable to edit it. Drag the <b>+</b> beside a device onto another to cable them. Try cutting a fiber: select a span, then choose <b>Cut this fiber</b>. Click a transponder to show its channel in the results; hover anything for its power and OSNR.' }));
    S.g.eolSpan ??= PHY.EOL.spanLoss; S.g.eolTrx ??= PHY.EOL.trxPen;
    S.g.neighbors ??= 'same';
    S.g.reopt = S.g.reopt === true;
    // the model-wide settings are there to look up, not to read first: collapsed until opened
    const det = el('details', { class: 'assume' }, [el('summary', { text: 'Model assumptions' })]); det.open = assumeOpen ?? false; det.addEventListener('toggle', () => { assumeOpen = det.open; });
    det.append(el('h3', { text: 'Line loading' }), field('Launch power', selIn(S.g, 'reopt', [['false', 'Fixed: amplifier targets and Amp output in the header'], ['true', 'Re-optimised for the load on each span']]), 'Re-optimised: every amplifier whose output target is blank sets the GN-optimal power for the span after it, given the channels actually lit there, so the setting follows channels as they are added and dropped. Amplifiers with an explicit target keep it.'), ...(lastRes && lastRes.derived ? [] : [field('Neighbouring channels', selIn(S.g, 'neighbors', [['same', 'Same type as the service'], ['coh', '60 GBd coherent channels']]), 'Only matters for direct-detection optics (10G DWDM): cross-phase modulation from neighbours is stronger when they are wide coherent channels.')])); // with cabled channels the neighbours are the transponders actually plugged in
    S.g.tempC ??= 27;
    const advBox = (...kids) => el('div', { class: 'assume adv' }, kids);
    det.append(advBox(el('h3', { text: 'Raman noise' }), field('Fiber temperature (°C)', numIn(S.g, 'tempC', 1, -40, 85), 'Spontaneous Raman scattering adds noise along a pumped span, and a warmer fiber adds more. Used by the coupled-wave solver (the Raman model on a span); the closed-form approximation ignores it.')));
    det.append(el('h3', { text: 'End-of-life allowances' }), field('Extra loss per fiber span (dB)', numIn(S.g, 'eolSpan', 0.1, 0, 5)), field('Transceiver ageing (dB)', numIn(S.g, 'eolTrx', 0.1, 0, 3)),
      el('p', { class: 'muted small', text: 'Used for the end-of-life margin: repairs, connector wear and laser ageing. Typical planning values are 0.5 to 1.5 dB per span.' }));
    S.g.lossPct ??= PHY.TRANSIENT.lossPct; S.g.agcUs ??= PHY.TRANSIENT.agcUs; S.g.rampMs ??= 0;
    det.append(advBox(el('h3', { text: 'Transients' }), field('Channels lost at once (%)', numIn(S.g, 'lossPct', 5, 1, 95), 'The event the Transients tab analyses: this share of the channels vanishes at every amplifier together (an upstream cut, a protection switch). The service survives.'), field('Channel add ramp (ms)', numIn(S.g, 'rampMs', 0.5, 0, 10000), 'How slowly returning channels are brought up. 0 = all at once. A ramp longer than the amplifiers\' ~200 µs time constant lets their control loops follow, so the dip shrinks; the surge when channels vanish cannot be ramped.'), field('Amplifier control response (µs)', numIn(S.g, 'agcUs', 5, 0, 5000), 'How fast an amplifier\'s gain control reacts. About 10 to 50 µs is a fast AGC loop; milliseconds is slow and lets the surge through. A single amplifier can override it.')));
    S.g.cutRate ??= MODEL.RESIL.cutRate; for (const k in MODEL.RESIL) S.g[k] ??= MODEL.RESIL[k];
    det.append(advBox(el('h3', { text: 'Resilience assumptions' }), field('Fiber cuts per 1000 km per year', numIn(S.g, 'cutRate', 0.5, 0, 50)), field('Mean time to repair (h)', numIn(S.g, 'mttr', 1, 0.5, 720)),
      field('Loss detection (ms)', numIn(S.g, 'detectMs', 1, 0, 1000)), field('1+1 switch time (ms)', numIn(S.g, 'switchMs', 5, 0, 10000)), field('Shared protection turn-up (s)', numIn(S.g, 'sharedSec', 0.5, 0, 600), 'Extra time to light a dark protection route: laser turn-up, WSS configuration and amplifier settling.'), field('Restoration time (s)', numIn(S.g, 'restoreSec', 5, 0, 3600), 'How long an unprotected channel takes to re-route over another path.'), field('Device failures per year', numIn(S.g, 'devRate', 0.01, 0, 5), 'Per amplifier or ROADM on a route. A failed ROADM at the end of a channel keeps it down until repaired; one in the middle is bypassed by protection or restoration if another route avoids it.'),
      el('p', { class: 'muted small', text: 'Expectations for the Resilience tab. Typical terrestrial fiber sees 2 to 4 cuts per 1000 km per year.' })));
    box.append(det);
    box.append(el('div', { class: 'keys' }, [el('div', { html: '<kbd>V</kbd> select / move' }), el('div', { html: '<kbd>P</kbd> patch cord' }), el('div', { html: '<kbd>F</kbd> fiber span' }), el('div', { html: '<kbd>Del</kbd> delete' }), el('div', { html: '<kbd>Ctrl</kbd>+<kbd>Z</kbd> undo, <kbd>Shift</kbd> to redo' }), el('div', { html: '<kbd>Shift</kbd>-click or drag a box to select several' }), el('div', { html: '<kbd>Ctrl</kbd>+<kbd>C</kbd> copy, <kbd>V</kbd> paste, <kbd>D</kbd> duplicate' }), el('div', { html: 'Drag empty space to pan, scroll to zoom' })]));
    return;
  }
  if (sel.kind === 'node') {
    const n = node(sel.id); if (!n) return;
    const nm = el('input', { value: n.name, id: 'f-name' }); nm.addEventListener('input', () => { n.name = nm.value; renderCanvas(); renderResults(); });
    const p = n.p; p.fail ??= ''; p.degDb ??= 3;
    const head = el('div', { class: 'insp-head' }, [el('h2', { text: TYPES[n.type].label }), field('Name', nm)]); box.append(head); // type, name, condition and delete stay at the top while the fields scroll
    const condSel = selIn(p, 'fail', [['', 'Working'], ['degraded', 'Degraded'], ['dead', 'Failed (no light passes)']]);
    condSel.addEventListener('change', () => toast(`${n.name} is ${p.fail === 'dead' ? 'failed' : p.fail === 'degraded' ? 'degraded' : 'working'}`, { label: 'Undo', fn: undo })); // like a cut, it can be undone from the toast
    head.append(field('Condition', condSel));
    // say what the chosen condition means (and for this kind of device), not all of them at once
    const condText = p.fail === 'dead' ? 'Failed: the device passes no light, so routes avoid it (restoration or protection) and a service through it is LOS.'
      : p.fail === 'degraded' ? `Degraded: ${n.type === 'edfa' ? 'its output falls and its noise figure rises (pump ageing)' : isEnd(n) ? 'its laser gets weaker and its receiver loses SNR' : 'it adds extra loss'}.` : '';
    if (condText) box.append(el('p', { class: 'muted small', text: condText }));
    if (p.fail === 'degraded') box.append(field('Degradation (dB)', numIn(p, 'degDb', 0.5, 0, 30)));
    // partial faults (ports, cards, connectors) are for breaking the lab on purpose: folded below the settings, open when one is set
    const faults = [], faultBits = [];
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
        box.append(el('p', { class: 'muted small', text: 'Cable a transponder to the OADM to plug it into a port.' }), portTable(n));
      }
      faults.push(list('badPorts', 128, 'Slot numbers (as in the Channels tab) whose add/drop port on this device has failed. Only the channels that join or leave the line here are lost; everything else keeps running.', 'Failed ports (slots)'),
        list('badCards', 16, `A card serves ${MODEL.PORTS_PER_CARD} consecutive slots: card 1 is slots 1-${MODEL.PORTS_PER_CARD}, card 2 the next ${MODEL.PORTS_PER_CARD}, and so on. A failed card takes down all of its ports at once.`, 'Failed cards'));
      if (p.badPorts.length) faultBits.push(`${p.badPorts.length} failed port${p.badPorts.length > 1 ? 's' : ''}`);
      if (p.badCards.length) faultBits.push(`${p.badCards.length} failed card${p.badCards.length > 1 ? 's' : ''}`);
      { p.degPorts ??= {};
        const nd = Object.keys(p.degPorts).length; if (nd) faultBits.push(`${nd} weak port${nd > 1 ? 's' : ''}`);
        const di = el('input', { value: Object.entries(p.degPorts).map(([k, v]) => `${+k + 1}=${v}`).join(', '), id: 'f-degPorts', placeholder: 'none' });
        di.addEventListener('input', () => { const d = {}; for (const tok of di.value.split(/[\s,;]+/).filter(Boolean)) { const [k, v] = tok.split('='), i = Math.round(+k), db = v === undefined ? 3 : +v; if (Number.isInteger(i) && i >= 1 && i <= 128 && isFinite(db) && db > 0) d[i - 1] = Math.min(30, db); } p.degPorts = d; recompute(); });
        faults.push(field('Degraded ports (slot=dB)', di, 'A weak port rather than a dead one, for example 4=3 for 3 dB extra loss on the port for slot 4. Only the channel that uses it is hurt: on the add side its power and OSNR fall, on the drop side only its power does. An alarm offers to replace the port.')); }
    }
    { const d = TYPES[n.type].def(); for (const k in d) if (p[k] === undefined) p[k] = d[k]; } // fields added since this lab was saved
    if (isEnd(n)) {
      box.append(field(n.type === 'mxp' ? 'Line port mode' : 'Mode', selIn(p, 'mode', Object.entries(PHY.MODES).map(([k, m]) => [k, m.name]))));
      { const slotsN = PHY.cBandSlots(+S.g.df * 1e9), cab = S.links.map(portLink).filter(x => x && x.t === n)[0], autoText = cab && cab.m ? 'Auto: the slot of its port' : 'Auto';
        // type a slot number (1 to 64), a channel (CH31), a frequency (193.1 THz) or a wavelength (1552.52 nm); blank is Auto. The channel, frequency and wavelength show beside it.
        const dfHz = +S.g.df * 1e9, wi = el('input', { type: 'text', id: 'f-slot', placeholder: 'Auto', autocomplete: 'off', spellcheck: 'false', 'aria-label': `Wavelength: a slot (1 to ${slotsN}), a channel like CH31, a frequency like 193.1 THz or a wavelength like 1552.52 nm. Blank for Auto.`, title: 'A slot number, CH31, 193.1 THz or 1552.52 nm' }), ro = el('small', { class: 'muted ro' });
        const read = v => { ro.textContent = Number.isInteger(v) ? `${chText(v)} (slot ${v + 1})` : autoText; };
        wi.value = Number.isInteger(p.slot) ? String(p.slot + 1) : ''; read(Number.isInteger(p.slot) ? p.slot : null);
        wi.addEventListener('input', () => { const r = PHY.slotFromText(wi.value, dfHz); if (r.error) ro.textContent = r.error; else read(r.auto ? null : r.slot); });
        wi.addEventListener('change', () => { const r = PHY.slotFromText(wi.value, dfHz); if (r.auto) { p.slot = null; renderAll(); } else if (r.error) { wi.value = Number.isInteger(p.slot) ? String(p.slot + 1) : ''; read(Number.isInteger(p.slot) ? p.slot : null); toast(r.error); } else { p.slot = r.slot; renderAll(); } });
        box.append(field('Wavelength', el('div', { class: 'slotfield' }, [wi, el('button', { class: 'btn quiet', type: 'button', text: 'Auto', hidden: !Number.isInteger(p.slot), onclick: () => { p.slot = null; renderAll(); } })]), 'A tunable transponder is set to a slot. Plugged into a mux or OADM port it only gets through if it matches that port; Auto follows the port.'));
        box.lastChild.querySelector('small').before(ro);
        if (cab && cab.m.type !== 'roadm' && cab.m.p.bidi) { // on a single-fiber port it also listens on a slot of its own
          const rs = el('select', { id: 'f-rxslot', 'aria-label': 'Receive wavelength' }); rs.append(el('option', { value: '', text: 'Auto: what its port delivers' }));
          for (let k = 0; k < slotsN; k++) rs.append(el('option', { value: String(k), text: `Slot ${k + 1} · ${chText(k)}` }));
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
      box.append(el('p', { class: 'muted small', text: 'Cable a transponder to the mux to give it a port.' }), portTable(n));
    } else if (n.type === 'edfa') {
      box.append(field('Direction', selIn(p, 'bidi', [['false', 'One-way: the direction the line runs'], ['true', 'BiDi: both directions, for a single fiber']]), 'An ordinary EDFA has isolators, so on a single fiber (both directions in one glass) it passes one direction only and the reverse is lost. A BiDi amplifier has circulators and band filters around two amplifier paths (the return direction uses the settings marked return) and costs the filter loss below in each direction.'));
      if (p.bidi) box.append(field('Filter loss (dB each way)', numIn(p, 'bidiLoss', 0.1, 0, 6), 'Circulators and band filters around the amplifier. It counts only where the amplifier sits on a single fiber.'));
      box.append(field('Gain control', selIn(p, 'ctl', [['auto', 'Auto: hit output target'], ['fixed', 'Fixed gain']])));
      if (p.ctl === 'auto') box.append(field('Output target (dBm/ch)', numIn(p, 'target', 0.5, -10, 10, true, String(S.g.launch)), 'Blank = follow Amp output in the header'), adv(field('Same, return direction (dBm/ch)', numIn(p, 'targetRev', 0.5, -10, 10, true, p.target === '' ? String(S.g.launch) : String(p.target)), 'Z to A. A line amp is really two amps, one per direction: a booster in one is a preamp in the other. Blank = same as forward.'), isSet(p.targetRev)));
      else box.append(field('Gain (dB)', numIn(p, 'gain', 0.5, 0, 40)), adv(field('Same, return direction (dB)', numIn(p, 'gainRev', 0.5, 0, 40, true, String(p.gain)), 'Z to A. Blank = same as forward.'), isSet(p.gainRev)));
      box.append(field('Noise figure (dB)', numIn(p, 'nf', 0.1, 3, 12), 'Quantum limit is 3 dB. Real EDFAs: 4.5–6 dB'));
      box.append(field('Gain range min / max (dB)', el('div', { class: 'pair' }, [numIn(p, 'gmin', 1, 0, 40), numIn(p, 'gmax', 1, 0, 40)])));
      box.append(field('Max total output (dBm)', numIn(p, 'pmax', 0.5, 10, 30), 'Shared by every channel in the fiber'));
      box.append(adv(field('Max total input (dBm)', numIn(p, 'pinMax', 0.5, -10, 20), 'The most total power (all channels together) the input stage takes. Above it the amplifier is overloaded: an alarm tells you, and well above it the input stage saturates and can be damaged. Typical 8 to 12 dBm.'), +p.pinMax !== 10));
      box.append(adv(field('Return direction: noise figure (dB)', numIn(p, 'nfRev', 0.1, 3, 12, true, String(p.nf)), 'Blank = same as forward. Also below: gain range and max output for the other amplifier in this box.'), isSet(p.nfRev)));
      box.append(adv(field('Return: gain range min / max (dB)', el('div', { class: 'pair' }, [numIn(p, 'gminRev', 1, 0, 40, true, String(p.gmin)), numIn(p, 'gmaxRev', 1, 0, 40, true, String(p.gmax))])), isSet(p.gminRev) || isSet(p.gmaxRev)));
      box.append(adv(field('Return: max total output (dBm)', numIn(p, 'pmaxRev', 0.5, 10, 30, true, String(p.pmax))), isSet(p.pmaxRev)));
      box.append(adv(field('Control response (µs)', numIn(p, 'agcUs', 5, 0, 5000, true, String(S.g.agcUs ?? PHY.TRANSIENT.agcUs)), 'Blank = the global setting. How fast the gain control reacts when channels vanish (Transients tab).'), isSet(p.agcUs)));
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
      box.append(el('p', { class: 'muted small', text: 'Cable a transponder to the ROADM to plug it into a port. Typical add/drop loss: colored 4-6 dB, colorless 6-9 dB (with an amplifier), contentionless 9-12 dB.' }), portTable(n));
      box.append(el('p', { class: 'muted small', text: 'Express traffic passes two WSSs (route and select). Add or drop passes one WSS plus the add/drop structure. Each WSS pass narrows the passband a little.' }));
    } else if (n.type === 'panel') {
      box.append(field('Ports', numIn(p, 'ports', 1, 1, 48), 'Each port joins a rear connector to a front connector.'), adv(field('Return loss (dB)', numIn(p, 'rl', 1, 20, 70), 'How well a mated connector pair keeps light from reflecting back: about 50 dB for a UPC polish, 65 for APC. A dirty or damaged port is taken as 30 dB at best. Two reflectors with gain between them add multipath noise that grows with that gain.'), +p.rl !== 50), field('Loss per mated pair (dB)', numIn(p, 'il', 0.1, 0, 3), 'A clean LC or SC pair is 0.3-0.75 dB.'));
      const di = el('input', { value: Object.entries(p.dirty || {}).map(([k, v]) => `${k}=${v}`).join(', '), id: 'f-dirty', placeholder: 'none' });
      di.addEventListener('input', () => { const d = {}; for (const tok of di.value.split(/[\s,;]+/).filter(Boolean)) { const [k, v] = tok.split('='), i = Math.round(+k), db = v === undefined ? 2 : +v; if (Number.isInteger(i) && i >= 1 && i <= p.ports && isFinite(db) && db > 0) d[i] = Math.min(10, db); } p.dirty = d; recompute(); });
      const dirtyN = Object.keys(p.dirty || {}).length; if (dirtyN) faultBits.push(`${dirtyN} dirty connector${dirtyN > 1 ? 's' : ''}`);
      faults.push(field('Dirty connectors', di, 'Port number and the extra loss, for example 1=1.8, 4=3. A dirty or damaged connector costs 1-3 dB (more if it is bad) and raises a warning. Leave empty for a clean panel.'));
      if (dirtyN) faults.push(el('button', { class: 'btn', text: 'Clean every connector', onclick: () => { p.dirty = {}; checkpoint(); renderAll(); toast('Cleaned every connector', { label: 'Undo', fn: undo }); } }));
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
      box.append(field('After a repair', selIn(p, 'revertive', [['true', 'Revertive: go back to the selected port'], ['false', 'Non-revertive: stay on the protection port']]), 'Revertive: once the selected port has had stable light for the wait-to-restore time the switch moves back, which is a second short hit. Non-revertive: it stays where it went, and the repaired port becomes the standby.'));
      if (p.revertive) box.append(field('Wait-to-restore (min)', numIn(p, 'wtrMin', 1, 0, 120), 'How long the selected port must carry good light before the switch trusts it again. It keeps a flapping line from making the switch bounce.'));
      box.append(field('Insertion loss (dB)', numIn(p, 'il', 0.1, 0, 10)), field('Switch time (ms)', numIn(p, 'switchMs', 5, 1, 1000), 'Used for the availability estimate: a cut that the switch rides through costs the detection plus this time (and the same again to revert, if it is revertive).'));
      { const det = +S.g.detectMs || 5, mttr = +S.g.mttr || 12, sm = +p.switchMs || 20, other = p.pos === 'b' ? 'A' : 'B', main = p.pos === 'b' ? 'B' : 'A';
        box.append(el('p', { class: 'muted small', text: `A cut on port ${main}: the light is lost for about ${det} ms to detect it plus ${sm} ms to switch, ${det + sm} ms in all, and then rides port ${other}. ` + (p.revertive ? `After the repair (about ${mttr} h on average) it waits ${p.wtrMin} min for stable light and moves back to port ${main}: another ${sm} ms hit.` : `After the repair it stays on port ${other}, so there is no second hit, but the traffic keeps using the protection path.`) })); }
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
      box.append(adv(field('Return direction: dispersion (ps/nm)', numIn(p, 'cdRev', 10, -8000, 8000, true, String(p.cd)), 'Blank = same as forward. Set 0 for a return fiber that has no compensator.'), isSet(p.cdRev)));
      box.append(adv(field('Return direction: insertion loss (dB)', numIn(p, 'ilRev', 0.5, 0, 20, true, String(p.il))), isSet(p.ilRev)));
      box.append(el('p', { class: 'muted small', text: 'Negative dispersion cancels the fiber\'s positive dispersion: about -1360 ps/nm for 80 km of SMF (17 ps/nm/km). A DCF module costs ~7 dB, a fiber Bragg grating ~3 dB. Put it between amplifier stages so the loss does not hurt OSNR.' }));
    } else if (n.type === 'voa') {
      box.append(field('Attenuation (dB)', numIn(p, 'att', 0.5, 0, 30)));
    }
    if (faults.length) {
      const fd = el('details', { class: 'assume faults' }, [el('summary', { text: `Faults · ${faultBits.join(', ') || 'none'}` }), ...faults]);
      fd.open = faultBits.length > 0; box.append(fd);
    }
    box.append(el('button', { class: 'btn quiet delbtn', text: 'Delete device', onclick: del })); // Undo makes it safe, so it is not the loudest control
  } else {
    const l = link(sel.id); if (!l) return;
    const seenHints = new Set(), once = (k, t) => (seenHints.has(k) ? undefined : (seenHints.add(k), t)); // the same help text for the cable's two ends is shown once
    // the type, the name and the main actions stay at the top of the panel while its fields scroll
    const head = el('div', { class: 'insp-head' }, [el('h2', { text: l.kind === 'fiber' ? 'Fiber span' : 'Patch cord' }), el('p', { class: 'muted', text: linkName(l) }),
      el('div', { class: 'row' }, [el('button', { class: 'btn ' + (l.p.cut ? '' : 'danger'), text: l.p.cut ? 'Splice it back' : l.kind === 'fiber' ? 'Cut this fiber' : 'Cut this cable', onclick: () => { l.p.cut = !l.p.cut; checkpoint(); renderAll(); toast(`${l.p.cut ? 'Cut' : 'Spliced'} ${linkName(l)}`, { label: 'Undo', fn: undo }); } }), el('button', { class: 'btn quiet delbtn', text: 'Delete cable', onclick: del })])]);
    box.append(head);
    box.append(field('Cable type', selIn(l, 'kind', [['fiber', 'Fiber span (outside plant)'], ['patch', 'Patch cord (in the rack)']])));
    if (l.p.dir == null) l.p.dir = 'both';
    { const na = node(l.a), nb = node(l.b); box.append(field('Carries light', selIn(l.p, 'dir', [['both', 'Both ways (a fiber pair)'], ['ab', `${na ? na.name : 'a'} → ${nb ? nb.name : 'b'} only`], ['ba', `${nb ? nb.name : 'b'} → ${na ? na.name : 'a'} only`]]), 'A one-way fiber lets each direction take a different route.')); }
    for (const c of portControls(l)) box.append(field(c.label, c.sel, c.hint));
    if (l.kind === 'fiber') {
      for (const k in linkDefaults('fiber')) if (l.p[k] == null) l.p[k] = linkDefaults('fiber')[k];
      box.append(field('Length (km)', numIn(l.p, 'len', 1, 0, 300)));
      box.append(field('Single fiber', selIn(l.p, 'single', [['false', 'No: one fiber each way'], ['true', 'Yes: one fiber carries both directions']]), 'On a single fiber the two directions of a channel need different slots, and no other channel can use either slot on this span.'));
      box.append(field('Fiber type', selIn(l.p, 'fiber', Object.entries(PHY.FIBERS).map(([k, f]) => [k, f.name]))));
      box.append(field('Connector + splice loss (dB)', numIn(l.p, 'extra', 0.1, 0, 20), 'Dirty connector? Add 1–3 dB here'));
      box.append(adv(field('Same, return direction (dB)', numIn(l.p, 'extraRev', 0.1, 0, 20, true, String(l.p.extra)), 'Z to A. Blank = same as forward. Bidirectional lines have two fibers; a dirty connector on one hurts one direction.'), isSet(l.p.extraRev)));
      if (!(lastRes && lastRes.derived)) box.append(adv(field('Channels lit on this span', numIn(l.p, 'nch', 1, 1, PHY.cBandSlots(+S.g.df * 1e9), true, String(S.g.nch)), 'Blank = global. Applies from this span until a mux or ROADM changes it. Fewer neighbours means less nonlinearity.'), isSet(l.p.nch)));
      const fb = PHY.FIBERS[l.p.fiber];
      // the Raman pump is off on most spans: its settings fold away, and open on their own when a pump is on
      const rd = el('details', { class: 'raman' }, [el('summary', { text: +l.p.raman > 0 || +l.p.ramanRev > 0 ? `Raman pump · ${l.p.raman} mW${l.p.ramanDir === 'fwd' ? ' forward' : l.p.ramanDir === 'both' ? ' both ends' : ' backward'}` : 'Raman pump · off' })]);
      rd.open = ramanOpen ?? (+l.p.raman > 0 || +l.p.ramanRev > 0); rd.addEventListener('toggle', () => { ramanOpen = rd.open; }); box.append(rd);
      rd.append(field('Raman pump, backward (mW)', numIn(l.p, 'raman', 50, 0, PHY.RAMAN.maxMw), '0 = off. Distributed gain along the fiber: better OSNR than a lumped amp at the end, but more nonlinearity and a Class 4 laser above ~1 W.'));
      rd.append(field('Raman pump direction', selIn(l.p, 'ramanDir', [['back', 'Backward (from the receive end)'], ['fwd', 'Forward (from the transmit end)'], ['both', 'Both ends, power split']]), 'Backward is quietest. Forward lifts the signal early, which helps ASE but raises nonlinearity and pump noise. Both ends flatten the gain profile.'));
      l.p.ramanFull ??= false;
      rd.append(adv(field('Raman model', selIn(l.p, 'ramanFull', [['false', 'Closed-form approximation'], ['true', 'Coupled-wave solver']]), 'The solver integrates the power equations of every channel and pump wavelength along the span: pump-to-pump transfer, depletion by the signals, the real gain spectrum, forward and backward pumping together. The Raman tab shows the result.'), l.p.ramanFull === true));
      rd.append(field('Raman pumps (wavelengths)', selIn(l.p, 'ramanPumps', [['1', '1 pump: gain ripple across the band'], ['2', '2 pumps'], ['3', '3 pumps: flat gain']]), 'More pump wavelengths flatten the gain across C-band, which shows up as less tilt. Total pump power is shared.'));
      rd.append(adv(field('Raman pump, return direction (mW)', numIn(l.p, 'ramanRev', 50, 0, PHY.RAMAN.maxMw, true, String(l.p.raman)), 'Blank = same as forward.'), isSet(l.p.ramanRev)));
      const rn = el('p', { class: 'muted small' });
      const upd = () => { const gr = PHY.ramanGain(fb, +l.p.len, Math.min(PHY.RAMAN.maxMw, +l.p.raman || 0)); rn.textContent = gr > 0 ? `On-off Raman gain about ${f1(gr)} dB, net span loss ${f1(fb.att * l.p.len + +l.p.extra - gr)} dB.` : ''; rn.hidden = !(gr > 0); };
      box.querySelector('#f-raman').addEventListener('input', upd); upd(); rd.append(rn);
      box.append(el('div', { class: 'spec' }, [specRow('Attenuation', `${fb.att} dB/km`), specRow('Span loss', `${f1(fb.att * l.p.len + +l.p.extra)} dB`), specRow('Dispersion', `${fb.D} ps/nm/km → ${Math.round(fb.D * l.p.len)} ps/nm`), specRow('PMD', `${fb.pmd} ps/√km`), specRow('Nonlinear γ', `${fb.gamma} /W/km`)]));
    } else {
      if (l.p.il == null) l.p.il = linkDefaults('patch').il;
      if (l.p.len == null) l.p.len = linkDefaults('patch').len;
      box.append(field('Loss (dB)', numIn(l.p, 'il', 0.1, 0, 10)), field('Length (m)', numIn(l.p, 'len', 1, 0, 2000), 'A patch cord is 1 to 10 m in a rack. Its glass adds 0.25 dB/km (negligible until it is hundreds of metres), 4.9 µs of latency per km, and its length places the connector events on the OTDR trace; events closer than the dead zone merge.'));
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

