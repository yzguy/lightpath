  // ---------- graph helpers ----------
  const mkGraph = S => {
    const node = id => S.nodes.find(n => n.id === id);
    const link = id => S.links.find(l => l.id === id);
    const linksOf = id => S.links.filter(l => l.a === id || l.b === id);
    const other = (l, id) => (l.a === id ? l.b : l.a);
    const linkName = l => { const a = node(l.a), b = node(l.b); return `${a ? a.name : '?'}–${b ? b.name : '?'}`; };
    return { node, link, linksOf, other, linkName };
  };

  // Failures. A fiber is cut if it is flagged cut or shares a risk group (p.srlg, a shared duct) with a fiber that is. A device (p.fail) is
  // 'dead' (passes no light) or 'degraded' (p.degDb of extra loss, lower output or a worse receiver, by type).
  const isCut = (S, l) => !!l.p.cut || (!!l.p.srlg && S.links.some(o => o !== l && o.p.srlg === l.p.srlg && o.p.cut));
  // A transponder with a spare module (optical switch or y-cable) keeps carrying light when its primary fails.
  const SPARE_LOSS = { switch: 1, ycable: 3.5 };
  const onSpare = n => !!n && isEnd(n) && !!n.p && n.p.fail === 'dead' && !!SPARE_LOSS[n.p.spare];
  // Port and card failures on a ROADM or passive mux: p.badPorts lists failed channel slots (0-based), p.badCards failed cards of PORTS_PER_CARD
  // slots each. Only the channels that join or leave the line at that device are lost; everything else keeps running.
  const PORTS_PER_CARD = 8;
  const portDown = (n, slot) => !!n && !!n.p && ((Array.isArray(n.p.badPorts) && n.p.badPorts.includes(slot)) || (Array.isArray(n.p.badCards) && n.p.badCards.includes(Math.floor(slot / PORTS_PER_CARD))));
  // A degraded port (p.degPorts: slot -> extra dB) costs only the channel that joins or leaves through it. A degraded port on the add side (the first half of the route)
  // weakens the signal before the amplifiers, so the OSNR falls by the same amount; one on the drop side only lowers the power at the receiver.
  // A mated connector pair reflects a little of the light back: 50 dB return loss for a UPC polish, 65 for APC, about 30 once it is dirty or damaged.
  const connRL = (n, dirty) => Math.min(+n.p.rl || 50, dirty > 0.3 ? 30 : 99);
  const degDb = (n, slot) => (n && n.p && n.p.degPorts && +n.p.degPorts[slot] > 0 ? +n.p.degPorts[slot] : 0);
  function portDeg(ns, slot, lks) {
    let add = 0, drop = 0; const hits = [];
    for (let k = 0; k < ns.length; k++) { const d = degDb(ns[k], slot); if (d > 0 && usesPort(ns, k, lks)) { const side = k < ns.length / 2 ? 'add' : 'drop'; if (side === 'add') add += d; else drop += d; hits.push({ node: ns[k], db: d, side }); } }
    return { add, drop, hits };
  }
  // A passive OADM serves a block of slots on each side: east (eFirst, ePorts) and west (wFirst, wPorts). A transponder is plugged into a port of
  // one side and talks to that side's line; a channel entering from a side in one of that side's slots is dropped. A channel can also not pass
  // through in a slot either side serves (dropped at the input, or in the way of the added channel at the output).
  const P1310_LOSS = 0.6; // the 1310 nm coupler on the line path
  // ---------- instruments: power meter and OTDR ----------
  // Both plug into a test point: a port of a patch panel (the rear or front of a numbered port), a port of a splitter (the tap) or of a switch.
  // The power meter reads the C-band service light at that port against a range of -50 to +10 dBm: below the floor it reads LOW, above the top OVER,
  // which is what happens when you plug a meter into a booster's output. The OTDR launches a pulse at 1625 nm through the test point and traces the fiber:
  // it sees fiber loss, connector and splitter events, breaks and the end of the fiber, until its dynamic range runs out.
  const OTDR_PULSES = [10, 30, 100, 300, 1000, 3000];
  const OTDR_DR = { 10: 12, 30: 16, 100: 22, 300: 27, 1000: 32, 3000: 36 }; // dynamic range in dB of one-way loss, by pulse width (ns): representative
  const METER = { min: -50, max: 10 };
  const PATCH_ATT = 0.25; // dB/km of the glass in a patch cord (C band, 1310 nm is higher); only matters for a long run of cord
  const patchKm = l => (Number.isFinite(+l.p.len) ? +l.p.len : 3) / 1000; // a patch cord's length in km (the cable has it in metres; 3 m by default)
  function meterRead(S, hops, n) {
    const { node } = mkGraph(S), l = S.links.find(x => x.a === n.id || x.b === n.id);
    if (!l) return { status: 'none', why: 'not plugged into anything' };
    const dev = node(l.a === n.id ? l.b : l.a), side = oadmSide(l, dev.id);
    const h = hops.find(x => x.name === dev.name && x.kind === dev.type);
    if (!h) return { status: 'none', why: `no service light passes ${dev.name}`, at: dev.name };
    const dbn = 10 * Math.log10(Math.max(1, h.nch || 1)), T = x => x.sig + dbn;
    const mk = (v, why) => ({ dbm: v, perCh: v - dbn, status: v > METER.max ? 'over' : v < METER.min ? 'low' : 'ok', why, at: dev.name });
    if (dev.type === 'panel') {
      const m = /^([rf])(\d+)$/.exec(side || ''); if (!m) return { status: 'none', why: 'the cable does not name a port', at: dev.name };
      if (+m[2] !== h.port) return { status: 'none', why: `the service light goes through port ${h.port}, not port ${m[2]}`, at: dev.name };
      return side === h.inSide ? mk(T(h.in), `the light arriving at ${dev.name} port ${m[2]}`) : mk(T(h.out), `the light leaving ${dev.name} port ${m[2]}, after the connector pair`);
    }
    if (side === h.inP) return mk(T(h.in), `the light arriving at port ${side.toUpperCase()}`);
    if (side === h.outP) return mk(T(h.out), `the light leaving port ${side.toUpperCase()}`);
    if (dev.type === 'splitter') return mk(T(h.in) - splitLossDb(dev, side), `the tap: ${f1(splitLossDb(dev, side))} dB below the input of the ${dev.p.ratio} splitter`);
    return { status: 'none', why: `the switch is not passing light to port ${side.toUpperCase()}`, at: dev.name };
  }
  function otdrTrace(S, id) {
    const { node } = mkGraph(S), o = node(id); if (!o || o.type !== 'otdr') return null;
    const pulse = OTDR_PULSES.includes(+o.p.pulse) ? +o.p.pulse : 100, DR = OTDR_DR[pulse], dz = 1.5 * pulse * 0.0001, att1625 = 1.1; // dead zone in km; 1625 nm loses a little more than 1550
    const out = { id, name: o.name, pulse, dr: DR, dz, points: [{ km: 0, db: 0 }], events: [], endKm: 0, loss: 0, endWhy: '' };
    const l0 = S.links.find(x => x.a === id || x.b === id); if (!l0) { out.endWhy = 'The OTDR is not plugged into anything.'; return out; }
    let km = 0, loss = 0, cur = l0.a === id ? l0.b : l0.a, arr = oadmSide(l0, cur), prev = l0;
    const sideOf = (l, nid) => (l.a === nid ? l.p.sa : l.p.sb);
    const ev = (kind, name, dl, refl, note) => { // an event at km, merged into the last one when it falls inside the dead zone
      const last = out.events[out.events.length - 1];
      if (last && km - last.km < dz && kind !== 'end' && kind !== 'break') { last.loss += dl; last.refl = Math.max(last.refl, refl); last.name += ' + ' + name; last.note = /merged/.test(last.note || '') ? last.note : (last.note ? last.note + '; ' : '') + 'merged: inside the dead zone'; }
      else out.events.push({ km, kind, name, loss: dl, refl, note });
      loss += dl; out.points.push({ km, db: -(loss - dl) }, { km, db: -loss });
    };
    const finish = why => { out.endKm = km; out.loss = loss; out.endWhy = why; };
    const far = () => loss > DR - 1.5;
    for (let guard = 0; guard < 80; guard++) {
      const n = node(cur); let outSide = null;
      if (isDead(n)) { ev('end', n.name, 0, -30, 'has failed'); return finish(`${n.name} has failed`), out; }
      if (n.type === 'panel') {
        const m = /^([rf])(\d+)$/.exec(arr || ''); if (!m) { ev('end', n.name, 0, -14, 'the cable does not name a port'); return finish(`${n.name}: the cable does not name a port`), out; }
        const dirty = (n.p.dirty && +n.p.dirty[+m[2]]) || 0; ev('connector', `${n.name} port ${m[2]}`, +n.p.il + dirty, -connRL(n, dirty), dirty > 0.3 ? `dirty or damaged connector (${f1(dirty)} dB extra)` : 'connector pair');
        outSide = (m[1] === 'r' ? 'f' : 'r') + m[2];
      } else if (n.type === 'splitter') {
        const to = arr === 'c' ? 'a' : 'c'; ev('splitter', n.name, splitLossDb(n, arr === 'c' ? 'a' : arr), -60, arr === 'c' ? 'the trace follows branch A; branch B is lit too' : 'combiner direction'); outSide = to;
      } else if (n.type === 'switch') {
        if (arr !== 'c' && arr !== n.p.pos) { ev('end', n.name, 0, -30, 'the switch is on the other port'); return finish(`${n.name} is switched to port ${n.p.pos.toUpperCase()}`), out; }
        ev('switch', n.name, +n.p.il, -55, `passing port ${(arr === 'c' ? n.p.pos : arr).toUpperCase()}`); outSide = arr === 'c' ? n.p.pos : 'c';
      } else { ev('end', n.name, 0, -30, `${(TYPES[n.type] || {}).label || n.type} does not pass 1625 nm light`); return finish(`the pulse is reflected at ${n.name}, which does not pass 1625 nm light`), out; }
      if (far()) { ev('noise', 'noise floor', 0, -90, `the trace sinks into the noise (dynamic range ${DR} dB): use a longer pulse`); return finish('the trace sinks into the noise: use a longer pulse'), out; }
      const nx = S.links.find(x => x !== prev && (x.a === cur || x.b === cur) && sideOf(x, cur) === outSide && !['meter', 'otdr'].includes((node(x.a === cur ? x.b : x.a) || {}).type));
      if (!nx) { ev('end', 'end of fiber', 0, -14, `nothing is cabled to ${n.name} ${outSide.toUpperCase()}: an open connector reflects`); return finish(`nothing is cabled to ${n.name} ${outSide.toUpperCase()}`), out; }
      const nid = nx.a === cur ? nx.b : nx.a;
      if (nx.kind === 'fiber') {
        const len = +nx.p.len || 0, a = (PHY_.FIBERS[nx.p.fiber] || PHY_.FIBERS.smf).att * att1625;
        if (isCut(S, nx)) {
          const at = nx.p.cutAt !== '' && Number.isFinite(+nx.p.cutAt) ? Math.min(len, +nx.p.cutAt) : len / 2, d = nx.a === cur ? at : len - at;
          km += d; loss += a * d; out.points.push({ km, db: -loss }); ev('break', `fiber ${node(nx.a).name}–${node(nx.b).name}`, 0, -14, `a break ${f1(d)} km into the span`); return finish(`the fiber is cut ${f1(d)} km into ${node(nx.a).name}–${node(nx.b).name}`), out;
        }
        const room = DR - 1.5 - loss; // loss the trace can still take before it sinks into the noise
        if (a * len > room) { const d = Math.max(0, room / a); km += d; loss += a * d; out.points.push({ km, db: -loss }); ev('noise', 'noise floor', 0, -90, `the trace sinks into the noise (dynamic range ${DR} dB): use a longer pulse`); return finish('the trace sinks into the noise: use a longer pulse'), out; }
        km += len; loss += a * len; out.points.push({ km, db: -loss });
        if (far()) { ev('noise', 'noise floor', 0, -90, `the trace sinks into the noise (dynamic range ${DR} dB): use a longer pulse`); return finish('the trace sinks into the noise: use a longer pulse'), out; }
        if (+nx.p.extra > 0.05) ev('connector', 'connector / splice', +nx.p.extra, +nx.p.extra > 1 ? -32 : -48, +nx.p.extra > 1 ? 'a lossy joint: dirty connector or poor splice' : 'connector or splice');
      } else {
        km += patchKm(nx); if (isCut(S, nx)) { ev('break', 'patch cord', 0, -14, 'a cut patch cord'); return finish('a patch cord is cut'), out; }
        if (+nx.p.il > 0.01) ev('connector', 'patch cord', +nx.p.il, -50, 'connector');
      }
      prev = nx; cur = nid; arr = sideOf(nx, nid);
      if (guard === 79) return finish('stopped: the path loops'), out;
    }
    return out;
  }

  // ---------- 1310 nm ports and the 1510 nm supervisory channel ----------
  // An OADM's 1310 nm port carries a legacy grey client optic. That light bypasses the C-band filters, so it only sees fiber (about 0.35 dB/km), patch
  // panel ports and the couplers of the OADMs at both ends; amplifiers, ROADMs, muxes and every other active or filtered device block it.
  // The optical supervisory channel (OSC) is different: it sits at 1510 nm, outside the C band, and every amplifier and ROADM on the line has a filter that
  // drops it, regenerates it and adds it again, so it is judged span by span and the chain of sites carries management traffic end to end. Passive muxes,
  // splitters and switches have no such filter and block it.
  const OSC = { name: 'Supervisory channel (1510 nm, 1.25 Gb/s)', nm: 1510, att: 0.25, tx: -3, rxMin: -28, rxMax: -8, filter: 1.0 };
  const optic1310 = k => PHY_.CLIENT_OPTICS[k];
  function band1310(S) {
    const { node, link } = mkGraph(S), out = [], seen = new Set(), ends = S.nodes.filter(n => n.type === 'oadm' && n.p.p1310);
    const sideOf = (l, id) => (l.a === id ? l.p.sa : l.p.sb);
    for (const a of ends) {
      if (isDead(a)) continue;
      for (const l0 of S.links) {
        if (l0.kind !== 'fiber' || (l0.a !== a.id && l0.b !== a.id)) continue;
        let l = l0, cur = a.id, km = 0, extra = P1310_LOSS, why = '', hops = [a.name], b = null;
        for (let guard = 0; guard < 40; guard++) {
          if (isCut(S, l)) { why = `the fiber ${link(l.id) ? node(l.a).name + '–' + node(l.b).name : ''} is cut`; break; }
          km += l.kind === 'fiber' ? +l.p.len : patchKm(l);
          const nid = l.a === cur ? l.b : l.a, n = node(nid), arr = sideOf(l, nid); hops.push(n.name);
          if (isDead(n)) { why = `${n.name} has failed`; break; }
          if (n.type === 'oadm' && n.p.p1310) { b = n; extra += P1310_LOSS; break; }
          if (n.type === 'panel') {
            const m = /^([rf])(\d+)$/.exec(arr || ''); if (!m) { why = `${n.name}: the cable does not name a port`; break; }
            const outSide = (m[1] === 'r' ? 'f' : 'r') + m[2], nx = S.links.find(x => x !== l && (x.a === nid || x.b === nid) && sideOf(x, nid) === outSide);
            extra += (+n.p.il || 0) + ((n.p.dirty && +n.p.dirty[+m[2]]) || 0);
            if (!nx) { why = `nothing is cabled to ${n.name} ${outSide.toUpperCase()}`; break; }
            cur = nid; l = nx; continue;
          }
          why = n.type === 'oadm' ? `${n.name} has no 1310 nm port` : `${n.name} (${(TYPES[n.type] || {}).label || n.type}) does not pass 1310 nm light`; break;
        }
        if (b) {
          const key = [a.id, b.id].sort().join('|') + '|' + [l0.id, l.id].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
          const oa = optic1310(a.p.o1310), ob = optic1310(b.p.o1310);
          if (a.p.o1310 !== b.p.o1310) { out.push({ a: a.id, b: b.id, aName: a.name, bName: b.name, status: 'down', why: `${a.name} has ${oa.name} and ${b.name} has ${ob.name}: the ends do not match`, km, loss: null, hops }); continue; }
          const loss = oa.att * km + extra, rx = oa.tx - loss, margin = rx - oa.rxMin; let status = 'up', w = '';
          if (margin < 0) { status = 'down'; w = `Rx ${f1(rx)} dBm is below the ${oa.rxMin} dBm sensitivity`; }
          else if (rx > oa.rxMax + 3) { status = 'down'; w = `Rx ${f1(rx)} dBm overloads the receiver (limit ${oa.rxMax} dBm): add a ${Math.ceil(rx - oa.rxMax)} dB pad`; }
          else if (rx > oa.rxMax) { status = 'warn'; w = `Rx ${f1(rx)} dBm is above the ${oa.rxMax} dBm overload point: add a ${Math.ceil(rx - oa.rxMax)} dB pad`; }
          else if (margin < 3) { status = 'warn'; w = `only ${f1(margin)} dB of margin`; }
          out.push({ a: a.id, b: b.id, aName: a.name, bName: b.name, optic: a.p.o1310, opticName: oa.name, km, loss, tx: oa.tx, rx, margin, rxMin: oa.rxMin, status, why: w, hops });
        } else if (why) {
          const key = a.id + '|' + l0.id; if (seen.has(key)) continue; seen.add(key);
          out.push({ a: a.id, b: null, aName: a.name, bName: '', status: 'blocked', why, km, hops, optic: a.p.o1310, opticName: optic1310(a.p.o1310).name });
        }
      }
    }
    return { links: out };
  }
  // The supervisory channel: sites are the OADMs with the OSC enabled plus every amplifier and ROADM on the line (they all regenerate it). A span runs between two
  // neighbouring sites over fiber and patch panel ports; anything else on the way blocks it. Each span has its own budget; spans that are up join the sites into a domain.
  function oscSpans(S) {
    const { node, link } = mkGraph(S), enabled = S.nodes.filter(n => n.type === 'oadm' && n.p.osc);
    if (!enabled.length) return null;
    const site = n => (n.type === 'oadm' && n.p.osc) || n.type === 'edfa' || n.type === 'roadm', sideOf = (l, id) => (l.a === id ? l.p.sa : l.p.sb), out = [], seen = new Set();
    for (const a of S.nodes.filter(site)) {
      if (isDead(a)) continue;
      for (const l0 of S.links) {
        if (l0.kind !== 'fiber' && l0.kind !== 'patch' || (l0.a !== a.id && l0.b !== a.id)) continue;
        let l = l0, cur = a.id, km = 0, extra = 2 * OSC.filter, why = '', b = null;
        for (let guard = 0; guard < 40; guard++) {
          if (isCut(S, l)) { why = `the fiber ${node(l.a).name}–${node(l.b).name} is cut`; break; }
          km += l.kind === 'fiber' ? +l.p.len : patchKm(l);
          const nid = l.a === cur ? l.b : l.a, n = node(nid), arr = sideOf(l, nid);
          if (isDead(n)) { why = `${n.name} has failed`; break; }
          if (site(n)) { b = n; break; }
          if (n.type === 'panel') {
            const m = /^([rf])(\d+)$/.exec(arr || ''); if (!m) { why = `${n.name}: the cable does not name a port`; break; }
            const outSide = (m[1] === 'r' ? 'f' : 'r') + m[2], nx = S.links.find(x => x !== l && (x.a === nid || x.b === nid) && sideOf(x, nid) === outSide);
            extra += (+n.p.il || 0) + ((n.p.dirty && +n.p.dirty[+m[2]]) || 0);
            if (!nx) { why = `nothing is cabled to ${n.name} ${outSide.toUpperCase()}`; break; }
            cur = nid; l = nx; continue;
          }
          if (n.type === 'oadm') { why = `${n.name} has no supervisory channel port`; break; }
          why = `${n.name} (${(TYPES[n.type] || {}).label || n.type}) has no filter for 1510 nm light`; break;
        }
        if (b) {
          const key = [a.id, b.id].sort().join('|') + '|' + [l0.id, l.id].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
          const loss = OSC.att * km + extra, rx = OSC.tx - loss, margin = rx - OSC.rxMin; let status = 'up', w = '';
          if (margin < 0) { status = 'down'; w = `Rx ${f1(rx)} dBm is below the ${OSC.rxMin} dBm sensitivity`; }
          else if (rx > OSC.rxMax + 3) { status = 'down'; w = `Rx ${f1(rx)} dBm overloads the receiver (limit ${OSC.rxMax} dBm): add a ${Math.ceil(rx - OSC.rxMax)} dB pad`; }
          else if (rx > OSC.rxMax) { status = 'warn'; w = `Rx ${f1(rx)} dBm is above the ${OSC.rxMax} dBm overload point: add a ${Math.ceil(rx - OSC.rxMax)} dB pad`; }
          else if (margin < 3) { status = 'warn'; w = `only ${f1(margin)} dB of margin`; }
          out.push({ a: a.id, b: b.id, aName: a.name, bName: b.name, km, loss, tx: OSC.tx, rx, margin, rxMin: OSC.rxMin, status, why: w });
        } else if (why) { const key = a.id + '|' + l0.id; if (!seen.has(key)) { seen.add(key); out.push({ a: a.id, b: null, aName: a.name, bName: '', km, status: 'blocked', why }); } }
      }
    }
    // sites joined by a span that is up form a management domain; only domains that hold an OADM with the OSC enabled are reported
    const par = new Map(S.nodes.filter(site).map(n => [n.id, n.id])), find = x => (par.get(x) === x ? x : (par.set(x, find(par.get(x))), par.get(x)));
    out.forEach(r => { if (r.b && r.status !== 'down' && par.has(r.a) && par.has(r.b)) par.set(find(r.a), find(r.b)); });
    const groups = new Map(); S.nodes.filter(n => site(n) && !isDead(n)).forEach(n => { const k = find(n.id); (groups.get(k) || groups.set(k, []).get(k)).push(n); });
    const domains = [...groups.values()].filter(g => g.some(n => n.type === 'oadm')).map(g => g.map(n => n.name));
    return { links: out, domains };
  }
  const oadmSide = (l, id) => (l ? (l.a === id ? l.p.sa : l.b === id ? l.p.sb : '') : '');
  const oadmRange = (n, side) => { if (!((n.p.sides || 'ew').includes(side))) return [0, 0]; const f = Math.round(+n.p[side + 'First']) || 0; const w = Math.round(+n.p[side + 'Ports']) || 0; return [f, f + (n.p.bidi ? 2 * w : w)]; }; // a BiDi side serves a low and a high band of that many slots each
  const oadmServes = (n, side, slot) => { const [a, b] = oadmRange(n, side); return slot >= a && slot < b; };
  const sideName = s => (s === 'e' ? 'east' : 'west');
  const oadmServed = n => ['e', 'w'].filter(s => oadmRange(n, s)[1] > oadmRange(n, s)[0]).map(s => { const [a, b] = oadmRange(n, s); return `${sideName(s)} slots ${a + 1}${b - a > 1 ? '-' + b : ''}`; }).join(', ') || 'no slots';
  // nodes and the links between them (links[j] joins nodes[j] and nodes[j+1]); returns why a route cannot carry a slot, or ''
  const oadmWhy = (nodes, slot, links, slotRev) => {
    const last = nodes.length - 1;
    for (let k = 0; k <= last; k++) {
      const n = nodes[k]; if (!n || n.type !== 'oadm') continue;
      const sideAt = j => (links && links[j] ? oadmSide(links[j], n.id) : '');
      if (k === 0 || k === last) { const s = k === 0 ? sideAt(0) : sideAt(last - 1); if (!oadmServes(n, s, slot)) return `${n.name} cannot add or drop ${slotLbl(slot)} on its ${sideName(s)} side (it serves ${oadmServed(n)})`; continue; }
      const joins = k === 1 && isEnd(nodes[0]), drops = k === last - 1 && isEnd(nodes[last]);
      if (joins || drops) { // a transponder plugged into a port: its port side must be the side the route uses
        const ps = joins ? sideAt(0) : sideAt(k), ls = joins ? sideAt(1) : sideAt(k - 1);
        if (!oadmServes(n, ps, slot)) return `${n.name} has no ${sideName(ps)} port for ${slotLbl(slot)} (it serves ${oadmServed(n)})`;
        if (ls && ls !== ps) return `the transponder is on ${n.name}'s ${sideName(ps)} port but the route uses its ${sideName(ls)} line`;
        continue;
      }
      for (const sl of slotRev != null ? [slot, slotRev] : [slot]) if (oadmServes(n, 'e', sl) || oadmServes(n, 'w', sl)) return `${slotLbl(sl)} is dropped by the filter at ${n.name} and cannot pass it`;
    }
    return '';
  };
  // does a route use a port of its device number k (a mux, an end ROADM or OADM, an OADM a transponder is plugged into)
  const usesPort = (nodes, k, links) => {
    const n = nodes[k]; if (!n) return false; const last = nodes.length - 1;
    if (n.type === 'mux') return true;
    if (n.type !== 'oadm' && n.type !== 'roadm') return false;
    const plugged = j => !links || !links[j] || links[j].p.mport != null; // a transponder cable counts as a port only if it is plugged into a numbered one
    return k === 0 || k === last || (k === 1 && isEnd(nodes[0]) && plugged(0)) || (k === last - 1 && isEnd(nodes[last]) && plugged(last - 1));
  };
  const isDead = n => !!n && !!n.p && n.p.fail === 'dead' && !onSpare(n);
  const spareLoss = n => (n && isEnd(n) && n.p && SPARE_LOSS[n.p.spare]) || 0;
  const degOf = n => (n && n.p && n.p.fail === 'degraded' ? (Number.isFinite(+n.p.degDb) ? Math.min(30, Math.max(0, +n.p.degDb)) : 3) : 0);

  // Shortest path (km) from A to Z. Light never passes *through* a transponder. Cut fibers are only used if allowCut.
  // x.ignoreCut: plan on the intact network (cut flags are failures, not topology). x.exclude: link ids the route may not use.
  function route(S, aId, zId, allowCut, x = {}) {
    const { node, linksOf, other } = mkGraph(S);
    // The search state is a device, or for a splitter or switch the device plus the port the light came in by: a common port feeds the two branches,
    // a branch only feeds the common port (never the other branch), and a switch passes its selected branch (the other too, if it is set to auto-switch).
    const dist = { [aId]: 0 }, prev = {}, done = new Set(), plan = x.ignoreCut, idOf = k => k.split('#')[0];
    if (isDead(node(aId)) && !allowCut && !plan) return null;
    let end = null;
    while (true) {
      let u = null, best = Infinity;
      for (const k in dist) if (!done.has(k) && dist[k] < best) { best = dist[k]; u = k; }
      if (u == null) return null;
      const me = idOf(u);
      if (me === zId) { end = u; break; }
      done.add(u);
      const un = node(me), arr = u.includes('#') ? u.split('#')[1] : '';
      if (me !== aId && isEnd(un)) continue;
      for (const l of linksOf(me)) {
        if (prev[u] && prev[u].l === l.id) continue; // light does not turn round on the cable it arrived by
        const cut = isCut(S, l);
        if (cut && !allowCut && !plan) continue;
        if (x.exclude && x.exclude.has(l.id)) continue;
        if ((l.p.dir === 'ab' && l.a !== me) || (l.p.dir === 'ba' && l.b !== me)) continue; // one-way fiber: light only travels the carried way
        const v = other(l, me); if (node(v).type === 'host' || node(v).type === 'meter' || node(v).type === 'otdr') continue; // an instrument or a host hangs off a transponder; light never goes through it
        let extra = 0;
        if (un.type === 'panel' && arr) { const m = /^([rf])(\d+)$/.exec(arr); if (!m || oadmSide(l, me) !== (m[1] === 'r' ? 'f' : 'r') + m[2]) continue; } // in at the rear of a port, out at the front of the same port
        if (isTriPort(un) && arr) {
          const out = oadmSide(l, me); if (arr === 'c' ? out === 'c' : out !== 'c') continue;
          if (un.type === 'switch') { const branch = arr === 'c' ? out : arr; if (branch !== (un.p.pos === 'b' ? 'b' : 'a')) { if (!un.p.auto) continue; extra = 1e4; } } // the other port is used only when the selected one cannot carry the light
        }
        const dead = isDead(node(v));
        if (dead && !allowCut && !plan) continue;
        if (x.excludeNodes && x.excludeNodes.has(v) && v !== zId) continue;
        const w = (l.kind === 'fiber' ? +l.p.len : 0.01 + patchKm(l)) + 0.01 + extra + (cut && !plan ? 1e6 : 0) + (dead && !plan ? 1e6 : 0), vk = isTriPort(node(v)) || node(v).type === 'panel' ? v + '#' + oadmSide(l, v) : v;
        if (dist[vk] == null || dist[u] + w < dist[vk]) { dist[vk] = dist[u] + w; prev[vk] = { u, l: l.id }; }
      }
    }
    const nodes = [idOf(end)], links = [];
    let c = end;
    while (c !== aId) { links.unshift(prev[c].l); c = prev[c].u; nodes.unshift(idOf(c)); }
    return { nodes, links };
  }

