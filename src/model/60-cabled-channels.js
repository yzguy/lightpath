  // ---------- channels defined by the cabling ----------
  // A transponder plugged into a numbered port of a passive mux (link.p.mport) is tuned to a slot (p.slot, or the port's own when auto). Port k of a
  // mux passes slot first+k. The channels are then what the cabling makes: a transmitter whose tuning matches its port reaches the receiver plugged into
  // the port of the same slot on another mux; anything else is dark, with a reason. Returns null for a topology that does not use mux ports.
  function derive(S) {
    useGrid(S);
    const { node, link } = mkGraph(S), g = S.g || {}, slotsN = PHY_.cBandSlots(+g.df * 1e9), atts = [], dev = x => x.type === 'mux' || x.type === 'oadm' || x.type === 'roadm';
    for (const l of S.links) {
      if (l.kind !== 'patch' || !Number.isInteger(l.p.mport)) continue;
      const a = node(l.a), b = node(l.b); if (!a || !b) continue;
      const t = isEnd(a) ? a : isEnd(b) ? b : null, m = t && dev(a) ? a : t && dev(b) ? b : null;
      if (t && m) atts.push({ t, m, l, port: l.p.mport, side: m.type === 'oadm' ? oadmSide(l, m.id) || 'e' : m.type === 'roadm' && !m.p.directionless ? oadmSide(l, m.id) || '1' : '' });
    }
    if (!atts.length) return null;
    const dirText = a => (a.m.type === 'oadm' ? sideName(a.side) + ' ' : a.m.type === 'roadm' && a.side ? `degree ${a.side} ` : '');
    const portName = a => `${a.m.name} ${dirText(a)}port ${a.port + 1}`;
    const colored = a => a.m.type !== 'roadm' || !a.m.p.colorless; // a colorless ROADM port passes any slot
    const firstOf = a => (a.m.type === 'oadm' ? oadmRange(a.m, a.side)[0] : Math.round(+a.m.p.first) || 0), capOf = a => (a.m.type === 'oadm' ? Math.round(+a.m.p[a.side + 'Ports']) || 0 : Math.round(+a.m.p.ports));
    const isBidi = a => a.m.type !== 'roadm' && a.m.p.bidi === true;
    const dark = new Map(), mark = (id, why) => { if (!dark.has(id)) dark.set(id, why); }, ok = [], byPort = new Map(), seenT = new Set(), bySlot = new Map();
    for (const a of atts) {
      if (seenT.has(a.t.id)) continue; seenT.add(a.t.id);
      const key = a.m.id + '|' + a.side + '|' + a.port, other = byPort.get(key);
      if (other) { mark(a.t.id, `${a.t.name} is plugged into ${portName(a)}, which ${other.t.name} already uses`); continue; }
      byPort.set(key, a); const pslot = firstOf(a) + a.port;
      // a BiDi (single-fiber) port passes a pair of slots: the low band and the high band, one for each direction; the role says which is transmit
      a.bidi = isBidi(a);
      if (a.bidi) { const n = capOf(a), role = a.m.type === 'oadm' ? a.m.p[a.side + 'Role'] : a.m.p.role, low = firstOf(a) + a.port, high = firstOf(a) + n + a.port; a.ptx = role === 'low' ? low : high; a.prx = role === 'low' ? high : low; } else a.ptx = a.prx = pslot;
      if (a.port >= capOf(a) || (colored(a) && Math.max(a.ptx, a.prx) >= slotsN)) { mark(a.t.id, `${a.m.name} has no ${dirText(a)}port ${a.port + 1} on this grid (it has ${capOf(a)}${colored(a) ? ` from ${slotLbl(firstOf(a))}${a.bidi ? ' in each of its two bands' : ''}, the grid has ${slotsN} slots` : ''})`); continue; }
      a.tuned = Number.isInteger(a.t.p.slot) ? a.t.p.slot : a.ptx;
      a.slot = colored(a) ? a.ptx : a.tuned; // a colored port passes its own slot; a colorless one passes whatever the transponder is tuned to
      if (a.tuned !== a.slot || a.slot >= slotsN) { mark(a.t.id, a.slot >= slotsN ? `${a.t.name} is tuned to ${slotLbl(a.tuned)}, which is not on this grid` : `${a.t.name} is tuned to ${slotLbl(a.tuned)} but plugged into ${portName(a)}, which ${a.bidi ? 'transmits' : 'passes'} ${slotLbl(a.slot)}: the filter blocks it`); continue; }
      a.tx = a.slot; a.rx = a.bidi ? (Number.isInteger(a.t.p.rxSlot) ? a.t.p.rxSlot : a.prx) : a.slot;
      if (a.bidi && a.rx !== a.prx) { mark(a.t.id, `${a.t.name} listens on ${slotLbl(a.rx)} but ${portName(a)} delivers ${slotLbl(a.prx)} to it: it would hear nothing`); continue; }
      // a ROADM that is not contentionless can add a slot at only one port, whichever degree it leaves by
      if (a.m.type === 'roadm' && !a.m.p.contentionless) { const k = a.m.id + '|' + a.slot, o = bySlot.get(k); if (o) { mark(a.t.id, `${a.t.name} and ${o.t.name} are both tuned to ${slotLbl(a.slot)} on ${a.m.name}, which is not contentionless: only one can be added`); continue; } bySlot.set(k, a); }
      ok.push(a);
    }
    // a transponder on a side of an OADM, or a port of a ROADM that is not directionless, talks to that side's (degree's) line only: the route may not leave or arrive by another one
    const wrongSide = a => (a.m.type === 'oadm' || (a.m.type === 'roadm' && !a.m.p.directionless) ? S.links.filter(l => (l.a === a.m.id || l.b === a.m.id) && oadmSide(l, a.m.id) !== a.side).map(l => l.id) : []);
    const kmOf = r => r.links.reduce((t, id) => t + (link(id).kind === 'fiber' ? +link(id).p.len : 0), 0), used = new Set(), pairs = [];
    for (const a of ok) {
      if (used.has(a.t.id)) continue;
      let best = null, bestKm = Infinity;
      for (const b of ok) {
        // each end transmits what the other receives; with a converter set on either end the two slots may differ, but the partner must then be named
        const cv = a.t.p.conv || b.t.p.conv, named = a.t.p.peer === b.t.id || b.t.p.peer === a.t.id;
        if (b === a || used.has(b.t.id) || b.m === a.m || b.bidi !== a.bidi || (cv ? !named || a.bidi : b.tx !== a.rx || b.rx !== a.tx)) continue;
        if (a.t.p.peer ? a.t.p.peer !== b.t.id : b.t.p.peer && b.t.p.peer !== a.t.id) continue; // a far end named by 'Connect to' is reserved for its partner
        const r = route(S, a.t.id, b.t.id, true, { ignoreCut: true, exclude: new Set([...wrongSide(a), ...wrongSide(b)]) }); if (!r) continue;
        const km = kmOf(r); if (km < bestKm) { best = b; bestKm = km; }
      }
      if (!best && a.bidi) {
        const twin = ok.find(b => b !== a && b.m !== a.m && b.bidi && b.tx === a.tx), half = ok.find(b => b !== a && b.m !== a.m && b.bidi && b.rx === a.tx);
        mark(a.t.id, twin ? `${a.t.name} and ${twin.t.name} both transmit on ${slotLbl(a.tx)}: on a single fiber each end needs its own wavelength (one end on the low band, the other on the high band)`
          : half ? `${a.t.name} transmits ${slotLbl(a.tx)} and listens on ${slotLbl(a.rx)}, but ${half.t.name} transmits ${slotLbl(half.tx)}: each end must transmit the slot the other listens on`
          : `${a.t.name} has no partner: a single-fiber port transmits ${slotLbl(a.tx)} and listens on ${slotLbl(a.rx)}, so the far end has to be a single-fiber port that transmits ${slotLbl(a.rx)} and listens on ${slotLbl(a.tx)}`);
        continue;
      }
      if (!best && a.t.p.conv && !a.t.p.peer) { mark(a.t.id, `${a.t.name} converts at ${(node(a.t.p.conv) || {}).name}, which puts its partner in a different slot: set \u2018Connect to\u2019 to name the far end`); continue; }
      if (!best) { mark(a.t.id, a.t.p.peer && !ok.some(b => b.t.id === a.t.p.peer && b.slot === a.slot) ? `${a.t.name} is set to connect to ${(node(a.t.p.peer) || {}).name}, which is not on a port for ${slotLbl(a.slot)}` : `${a.t.name} has no partner: nothing is plugged into a port for ${slotLbl(a.slot)} on a mux, OADM or ROADM it can reach${a.side ? ` from ${a.m.name}'s ${a.m.type === 'oadm' ? sideName(a.side) + ' side' : 'degree ' + a.side}` : ''}`); continue; }
      if (a.t.p.mode !== best.t.p.mode) { const why = `${a.t.name} is ${PHY_.MODES[a.t.p.mode].short} but ${best.t.name} is ${PHY_.MODES[best.t.p.mode].short}: the ends will never lock`; mark(a.t.id, why); mark(best.t.id, why); continue; }
      used.add(a.t.id); used.add(best.t.id); pairs.push([a, best]);
    }
    const sa = S.svc && S.svc.a, sz = S.svc && S.svc.z;
    // amplifiers are set for the service direction, so every channel runs from the end nearer the service's A end to the one further away
    const dist = t => { const r = sa && sa !== t.id ? route(S, sa, t.id, true, { ignoreCut: true }) : null; return r ? kmOf(r) : sa === t.id ? 0 : Infinity; };
    pairs.forEach(pr => { if (dist(pr[1].t) < dist(pr[0].t)) pr.reverse(); });
    const notes = [], plan = pairs.sort((x, y) => x[0].tx - y[0].tx).map(([a, b]) => {
      const svc = (a.t.id === sa && b.t.id === sz) || (a.t.id === sz && b.t.id === sa), from = svc ? sa : a.t.id, to = svc ? sz : b.t.id, f = from === a.t.id ? a : b, o = f === a ? b : a;
      const cv = f.t.p.conv || o.t.p.conv, pt = f.t.p.prot || o.t.p.prot; // the transponders' settings: a converter on the way and the protection of the pair
      if (svc && cv) notes.push(`${a.t.name} and ${b.t.name} are the service: the service channel cannot change wavelength, so its converter is ignored.`);
      return { slot: f.tx, slotRev: !cv && o.tx !== f.tx ? o.tx : null, mode: a.t.p.mode, off: f.t.p.off || 0, svc, from, to, via: '', conv: svc ? '' : cv, slot2: cv && !svc ? o.tx : f.tx, prot: pt, derived: true, tx: from, rx: to };
    });
    let svcWhy = '';
    if (!plan.some(c => c.svc) && node(sa) && node(sz) && isEnd(node(sa)) && isEnd(node(sz))) svcWhy = dark.get(sa) || dark.get(sz) || 'The service transponders are not paired through the muxes: plug both into the port for the same slot.';
    // background channels fill the line up to the channel count, in the free slots nearest the lit ones
    const want = Math.max(0, Math.round(+g.nch || 0) - plan.length), lit = new Set(plan.flatMap(c => [c.slot, c.slotRev, c.conv ? c.slot2 : null]).filter(x => x != null)), fillers = [], single = S.links.some(l => l.kind === 'fiber' && l.p.single);
    if (want && plan.length) {
      const centre = plan.reduce((t, c) => t + c.slot, 0) / plan.length, mode = (plan.find(c => c.svc) || plan[0]).mode;
      // a filler runs the service's route, so it has to obey the filters on it: not in a slot an OADM there serves in passing, and in one it serves at the ends
      const rs = route(S, sa, sz, true, { ignoreCut: true }), okFor = (sl, back) => !rs || !oadmWhy(rs.nodes.map(id => node(id)), sl, rs.links.map(id => link(id)), back);
      const free = [...Array(slotsN).keys()].filter(k => !lit.has(k) && okFor(k, null)).sort((x, y) => Math.abs(x - centre) - Math.abs(y - centre) || x - y);
      for (let k = 0; k < want && free.length >= (single ? 2 : 1); k++) { const sl = free.shift(), back = single ? free.shift() : null; fillers.push({ slot: sl, slotRev: back, mode, off: 0, svc: false, from: '', to: '', via: '', conv: '', slot2: sl, prot: '', derived: true, filler: true }); } // on a single fiber a background channel takes a slot each way
    }
    const all = [...plan, ...fillers].sort((x, y) => x.slot - y.slot);
    return { plan: all, notes, dark: [...dark].map(([id, why]) => ({ id, name: (node(id) || {}).name, why })), svcWhy, paired: pairs.length, fillers: fillers.length };
  }
  // the topology with the channel plan the cabling defines (or S itself when it does not use mux ports)
  function effective(S) {
    if (S._derived) return S;
    const d = derive(S); if (!d) return S;
    return { ...S, g: { ...S.g, plan: d.plan, nch: d.plan.length }, _derived: d };
  }

  // A slot named in a message: its number (as the tables show it) and its ITU channel. The spacing is the lab's, set at the start of each entry point below.
  let AMB_DF = 75e9;
  const useGrid = S => { const d = +(S && S.g && S.g.df) * 1e9; if (d > 0) AMB_DF = d; };
  const slotLbl = k => 'slot ' + (k + 1) + ' (CH' + PHY_.slotChannel(k, AMB_DF).ch + ')';

  // ---------- one-tap remedies ----------
  // An alarm can carry a `fix` the UI offers as a button: plain data (what to change), applied by the app, so the model stays DOM-free.
  const fixSplice = (l, label = 'Splice it back') => ({ type: 'splice', id: l.id, label });
  const fixWork = n => ({ type: 'work', id: n.id, label: `Set ${n.name} back to Working` });
  // where an amplifier helps most: the longest fiber span on the route
  const ampSpot = (S, path) => (path ? path.links.map(id => S.links.find(l => l.id === id)).filter(l => l && l.kind === 'fiber').sort((a, b) => +b.p.len - +a.p.len)[0] : null);
  const fixBidi = n => ({ type: 'makeBidi', id: n.id, label: `Make ${n.name} a bidirectional (BiDi) amplifier` });
  const fixAmp = (S, l) => ({ type: 'insertAmp', id: l.id, label: `Add an amplifier halfway along ${S.nodes.find(n => n.id === l.a).name}–${S.nodes.find(n => n.id === l.b).name}` });
  const fixRepairPort = (n, slot) => ({ type: 'repairPort', id: n.id, slot, label: `Replace ${n.name} port for slot ${slot + 1}` });
  const fixClean = (n, port) => ({ type: 'clean', id: n.id, port, label: `Clean ${n.name} port ${port}` });

  // Carry out a remedy on S (in place); returns a sentence saying what was done, or '' if it no longer applies.
  function applyFix(S, f) {
    if (!f) return '';
    const link = id => S.links.find(l => l.id === id), node = id => S.nodes.find(n => n.id === id);
    if (f.type === 'splice') { const l = link(f.id); if (l && l.p.cut) { l.p.cut = false; return 'Spliced the fiber back'; } }
    else if (f.type === 'work') { const n = node(f.id); if (n && n.p.fail) { n.p.fail = ''; return `${n.name} is working again`; } }
    else if (f.type === 'clean') { const n = node(f.id); if (n && n.p.dirty && n.p.dirty[f.port] != null) { delete n.p.dirty[f.port]; return `Cleaned ${n.name} port ${f.port}`; } }
    else if (f.type === 'makeBidi') { const n = node(f.id); if (n && n.type === 'edfa') { n.p.bidi = true; return `${n.name} is now a BiDi amplifier`; } }
    else if (f.type === 'repairPort') { const n = node(f.id); if (n && n.p.degPorts && n.p.degPorts[f.slot] != null) { delete n.p.degPorts[f.slot]; return `Replaced the ${n.name} port for slot ${f.slot + 1}`; } }
    else if (f.type === 'insertAmp') { // split a fiber span in two with an amplifier in the middle
      const l = link(f.id), a = l && node(l.a), b = l && node(l.b); if (!l || l.kind !== 'fiber' || !a || !b) return '';
      let name = `${PREFIX.edfa}-${S.nodes.filter(n => n.type === 'edfa').length + 1}`; while (S.nodes.some(n => n.name === name)) name += "'";
      const amp = { id: uid('n'), type: 'edfa', name, x: Math.round((a.x + b.x) / 20) * 10, y: Math.round((a.y + b.y) / 20) * 10, p: { ...TYPES.edfa.def(), bidi: !!l.p.single } }, half = +(+l.p.len / 2).toFixed(2); // on a single fiber the amplifier has to pass both directions
      const tail = { id: uid('l'), a: amp.id, b: b.id, kind: 'fiber', p: { ...l.p, len: half, sa: '', sb: l.p.sb ?? '', cut: false } };
      l.b = amp.id; l.p = { ...l.p, len: half, sb: '' }; S.nodes.push(amp); S.links.push(tail);
      return `Added ${name} halfway along ${a.name}–${b.name}`;
    }
    return '';
  }

  // ---------- copy and paste ----------
  // A selection of devices is copied with the cables that join two of them (a cable to a device outside the selection is left behind). Pasting makes new
  // devices with new names and ids, moved a little so they do not sit on the originals; links between transponders (peer, converter) follow the copies.
  function copySelection(S, ids) {
    const set = new Set(ids), copy = o => JSON.parse(JSON.stringify(o));
    return { nodes: S.nodes.filter(n => set.has(n.id)).map(copy), links: S.links.filter(l => set.has(l.a) && set.has(l.b)).map(copy) };
  }
  function pasteSelection(S, clip, dx = 40, dy = 40) {
    const map = {}, snap = v => Math.round(v / 10) * 10, copy = o => JSON.parse(JSON.stringify(o)), nodes = [], links = [];
    for (const n of clip.nodes) {
      const type = TYPES[n.type] ? n.type : null; if (!type) continue;
      let name = `${PREFIX[type]}-${S.nodes.filter(x => x.type === type).length + nodes.filter(x => x.type === type).length + 1}`;
      while (S.nodes.some(x => x.name === name) || nodes.some(x => x.name === name)) name += "'";
      const c = { id: uid('n'), type, name, x: snap(n.x + dx), y: snap(n.y + dy), p: copy(n.p || {}) }; map[n.id] = c.id; nodes.push(c);
    }
    for (const c of nodes) for (const k of ['peer', 'conv']) if (typeof c.p[k] === 'string' && c.p[k]) c.p[k] = map[c.p[k]] || '';
    for (const l of clip.links) if (map[l.a] && map[l.b]) links.push({ id: uid('l'), a: map[l.a], b: map[l.b], kind: l.kind, p: copy(l.p || {}) });
    S.nodes.push(...nodes); S.links.push(...links);
    return { nodeIds: nodes.map(n => n.id), linkIds: links.map(l => l.id) };
  }
  function removeNodes(S, ids) {
    const set = new Set(ids); S.nodes = S.nodes.filter(n => !set.has(n.id)); S.links = S.links.filter(l => !set.has(l.a) && !set.has(l.b));
    for (const k of ['a', 'z']) if (S.svc && set.has(S.svc[k])) S.svc[k] = null;
  }

  // Line up or space out a set of devices by position. mode: left|center|right|top|middle|bottom align to the
  // extreme or the middle; hspace|vspace spread the devices so the gaps between neighbours are equal (3 or more).
  function alignNodes(S, ids, mode) {
    const ns = ids.map(id => S.nodes.find(n => n.id === id)).filter(Boolean);
    if (ns.length < 2) return 0;
    const ax = ['left', 'center', 'right', 'hspace'].includes(mode) ? 'x' : ['top', 'middle', 'bottom', 'vspace'].includes(mode) ? 'y' : null;
    if (!ax) return 0;
    const v = ns.map(n => n[ax]), lo = Math.min(...v), hi = Math.max(...v);
    if (mode === 'left' || mode === 'top') ns.forEach(n => { n[ax] = lo; });
    else if (mode === 'right' || mode === 'bottom') ns.forEach(n => { n[ax] = hi; });
    else if (mode === 'center' || mode === 'middle') ns.forEach(n => { n[ax] = Math.round((lo + hi) / 2); });
    else { if (ns.length < 3) return 0; const o = [...ns].sort((a, b) => a[ax] - b[ax]); o.forEach((n, i) => { n[ax] = Math.round(lo + (hi - lo) * i / (o.length - 1)); }); }
    return ns.length;
  }

