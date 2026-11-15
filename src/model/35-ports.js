
  // ---------- physical ports ----------
  // Every device has a fixed list of duplex LC ports, and every cable end sits in one of them (link.p.pa at end a, link.p.pb at end b). One cable per port,
  // but any cable can go in any free port: plugging a transponder's line into a 1310 nm port, or a client port into a mux channel, is allowed and the
  // simulation shows what that does (no route, no light, an alarm that says why). The older per-cable fields (sa/sb side or degree, mport, cport, hport)
  // are derived from the ports by syncPorts, so the rest of the model keeps reading them. A cable with no port recorded (an older save, a preset, a test
  // topology) gets the port its older fields imply (inferPort), which is what the model did before ports existed.
  //
  // Kinds: line (transponder line), client (transponder client), eth (host), com (mux common), ad (an add/drop channel port of a mux, OADM or ROADM),
  // oline (OADM line side), deg (ROADM degree), 1310 (the 1310 nm port of a mux or OADM), amp (either side of an EDFA, DCM or VOA), panel, tri, test.
  const isAddDropDev = n => !!n && (n.type === 'mux' || n.type === 'oadm' || n.type === 'roadm');
  const range1 = n => Array.from({ length: Math.max(0, n) }, (_, i) => i + 1);
  const iOf = (v, d) => { const x = Math.round(+v); return Number.isFinite(x) ? x : d; };
  const chNum = (S, slot) => PHY_.slotChannel(slot, (+(S && S.g && S.g.df) || 100) * 1e9).ch;
  // the channel label of add/drop port k (0-based) on a side of a mux, OADM or ROADM
  function adLabel(S, n, side, k) {
    if (n.type === 'roadm') return n.p.colorless ? (side ? `D${side} A/D ${k + 1}` : `A/D ${k + 1}`) : (side ? `D${side} ` : '') + 'CH' + chNum(S, (iOf(n.p.first, 0)) + k);
    const first = n.type === 'oadm' ? iOf(n.p[side + 'First'], 0) : iOf(n.p.first, 0), cnt = n.type === 'oadm' ? iOf(n.p[side + 'Ports'], 0) : iOf(n.p.ports, 0);
    const role = n.type === 'oadm' ? n.p[side + 'Role'] : n.p.role, lo = first + k, hi = first + cnt + k;
    const ch = n.p.bidi ? (role === 'low' ? `${chNum(S, lo)}/${chNum(S, hi)}` : `${chNum(S, hi)}/${chNum(S, lo)}`) : String(chNum(S, lo));
    return n.type === 'oadm' ? ch + side.toUpperCase() : 'CH' + ch.replace('/', '/CH');
  }
  // A transponder whose channel is protected (its own line protection, or the protected service channel of a plan) has an OLP: a second line port
  function lineProtected(S, n) {
    if (!isEnd(n)) return false;
    if (n.p.prot === '1+1' || n.p.prot === 'shared') return true;
    const plan = S && S.g && S.g.plan, svcEnd = S && S.svc && (S.svc.a === n.id || S.svc.z === n.id);
    return !!(svcEnd && Array.isArray(plan) && plan.some(c => c.svc && (c.prot === '1+1' || c.prot === 'shared')));
  }
  // the ports a device has, in the order a picker lists them
  function portsOf(S, n) {
    const P = (id, label, kind, x = {}) => ({ id, label, kind, ...x });
    switch (n.type) {
      case 'trx': case 'mxp': {
        const out = [P('L', 'Line', 'line')]; if (lineProtected(S, n)) out.push(P('L2', 'Line 2 (OLP protection)', 'line'));
        if (n.type === 'trx') out.push(P('C1', 'Client', 'client')); else range1((n.p.clients || []).length).forEach(i => out.push(P('C' + i, 'Client ' + i, 'client')));
        return out;
      }
      case 'host': return range1(iOf(n.p.ports, 1)).map(i => P('eth' + i, 'eth' + i, 'eth'));
      case 'mux': return [P('COM', 'COM (line)', 'com'), ...range1(iOf(n.p.ports, 0)).map(i => P('P' + i, adLabel(S, n, '', i - 1), 'ad', { side: '', k: i - 1 })), P('1310', '1310 nm' + (n.p.p1310 ? '' : ' (module off)'), '1310')];
      case 'oadm': {
        // both line ports are always there (traffic it does not add or drop passes Line W to Line E); `sides` says which way its add/drop filters face
        const sides = String(n.p.sides || '').split('').filter(s => s === 'e' || s === 'w').sort().reverse(), out = ['w', 'e'].map(s => P('L' + s.toUpperCase(), 'Line ' + s.toUpperCase(), 'oline', { side: s }));
        for (const s of sides) range1(iOf(n.p[s + 'Ports'], 0)).forEach(i => out.push(P(s.toUpperCase() + i, adLabel(S, n, s, i - 1), 'ad', { side: s, k: i - 1 })));
        for (const q of ports1310(n)) out.push(P(q.id, `1310 nm ${q.side.toUpperCase()}` + (q.fitted ? ` (to Line ${q.side.toUpperCase()})` : n.p.p1310 ? ' (not fitted)' : ' (module off)'), '1310', { side: q.side }));
        return out;
      }
      case 'roadm': {
        const d = Math.max(1, iOf(n.p.degrees, 1)), np = iOf(n.p.ports, 0), out = range1(d).map(i => P('D' + i, 'Degree ' + i, 'deg', { side: String(i) }));
        if (n.p.directionless) range1(np).forEach(i => out.push(P('A' + i, adLabel(S, n, '', i - 1), 'ad', { side: '', k: i - 1 })));
        else for (const j of range1(d)) range1(np).forEach(i => out.push(P(`D${j}A${i}`, adLabel(S, n, String(j), i - 1), 'ad', { side: String(j), k: i - 1 })));
        return out;
      }
      case 'edfa': { // a dual-stage card, a duplex LC port each side: a booster + pre-amp card (COM to the mux, LINE to the span; the booster amplifies COM to LINE,
        // the pre-amp LINE to COM), or an in-line amplifier (Line A, Line B; a stage each way)
        const t = n.p.role !== 'ila'; return [P('IN', t ? 'COM' : 'Line A', 'amp'), P('OUT', t ? 'LINE' : 'Line B', 'amp'), P('MON', 'Monitor (1% tap)', 'mon')]; }
      case 'dcm': case 'voa': return [P('IN', 'In', 'amp'), P('OUT', 'Out', 'amp')];
      case 'panel': { const out = []; range1(iOf(n.p.ports, 1)).forEach(i => out.push(P('r' + i, `Rear ${i}`, 'panel'), P('f' + i, `Front ${i}`, 'panel'))); return out; }
      case 'splitter': case 'switch': return [P('c', 'Common', 'tri'), P('a', 'Port A', 'tri'), P('b', 'Port B', 'tri')];
      default: return [P('P', 'Port', 'test')];
    }
  }
  // the kind of a port from its id alone (a port that no longer exists, after a device shrank, still has one); 'AD' is an unnumbered add/drop port of an older save
  function portKind(n, id) {
    if (!n || !id) return '';
    if (id === 'AD') return 'ad';
    switch (n.type) {
      case 'trx': case 'mxp': return /^L2?$/.test(id) ? 'line' : /^C\d+$/.test(id) ? 'client' : '';
      case 'host': return /^eth\d+$/.test(id) ? 'eth' : '';
      case 'mux': return id === 'COM' ? 'com' : id === '1310' ? '1310' : /^P\d+$/.test(id) ? 'ad' : '';
      case 'oadm': return /^L[EW]$/.test(id) ? 'oline' : id === '1310W' || (id === '1310E' && n.p.sides === 'ew') ? '1310' : /^[EW]\d+$/.test(id) ? 'ad' : '';
      case 'roadm': return /^D\d$/.test(id) ? 'deg' : /^(D\dA|A)\d+$/.test(id) ? 'ad' : '';
      case 'edfa': return /^(IN|OUT)$/.test(id) ? 'amp' : id === 'MON' ? 'mon' : '';
      case 'dcm': case 'voa': return /^(IN|OUT)$/.test(id) ? 'amp' : '';
      case 'panel': return /^[rf]\d+$/.test(id) ? 'panel' : '';
      case 'splitter': case 'switch': return /^[cab]$/.test(id) ? 'tri' : '';
      default: return id === 'P' ? 'test' : '';
    }
  }
  const portLabel = (S, n, id) => { if (id === 'AD') return 'A/D'; const p = portsOf(S, n).find(x => x.id === id); return p ? p.label : id === 'L2' ? 'Line 2' : id; };
  const shortLabel = (S, n, id) => { // the label printed on the cable next to the device
    const k = portKind(n, id), p = portsOf(S, n).find(x => x.id === id);
    if (k === 'line') return id === 'L2' ? 'LINE 2' : 'LINE';
    if (k === 'client') return n.type === 'trx' ? 'CLIENT' : id;
    if (k === 'com') return 'COM'; if (k === '1310') return id.length > 4 ? '1310 ' + id[4] : '1310'; if (k === 'oline') return 'Line ' + id[1];
    if (k === 'amp') return p ? p.label.toUpperCase() : id; if (k === 'deg' || k === 'mon') return id; if (k === 'panel' || k === 'tri') return id.toUpperCase(); if (k === 'test') return '';
    if (k === 'ad') return id === 'AD' ? 'A/D' : p ? p.label.replace(/^D(\d) A\/D /, 'D$1·').replace(/^A\/D /, 'A/D') : id;
    return p ? p.label : id;
  };
  // the cable by which the service's A-to-Z light reaches an amplifier (its first port, COM or Line A), from the service's own route; null if there is none
  function feedOf(S, n) {
    const a = S.svc && S.svc.a; if (!a || a === n.id) return null;
    const r = route(S, a, n.id, true, { ignoreCut: true, anyPort: true });
    return r && r.links.length ? r.links[r.links.length - 1] : null;
  }
  // the port a cable end is in: the recorded one, or the one its older fields imply
  const endPort = (S, l, n) => { const v = l.a === n.id ? l.p.pa : l.p.pb; return v && portKind(n, v) ? v : inferPort(S, l, n); }; // a port id that is not one of this device's (a cable moved to another device) counts as none
  function inferPort(S, l, n) {
    const o = S.nodes.find(x => x.id === (l.a === n.id ? l.b : l.a)); if (!o) return '';
    const sd = (l.a === n.id ? l.p.sa : l.p.sb) || '', mp = Number.isInteger(l.p.mport) ? l.p.mport : null;
    const mine = S.links.filter(x => x.a === n.id || x.b === n.id);
    switch (n.type) {
      case 'trx': case 'mxp': return o.type === 'host' ? 'C' + ((Number.isInteger(l.p.cport) ? l.p.cport : 0) + 1) : mine.filter(x => { const y = S.nodes.find(q => q.id === (x.a === n.id ? x.b : x.a)); return y && y.type !== 'host'; }).indexOf(l) > 0 ? 'L2' : 'L';
      case 'host': return 'eth' + ((Number.isInteger(l.p.hport) ? l.p.hport : Math.max(0, mine.indexOf(l))) + 1);
      case 'mux': return isEnd(o) ? (mp == null ? 'AD' : 'P' + (mp + 1)) : o.type === 'host' ? '1310' : 'COM';
      case 'oadm': { const s = (sd || (isEnd(o) && String(n.p.sides || 'w').length === 1 ? n.p.sides : o.x < n.x ? 'w' : 'e')).toUpperCase(); return isEnd(o) ? (mp == null ? 'AD' : s + (mp + 1)) : o.type === 'host' ? '1310' + (ports1310(n).find(q => q.fitted && q.side === s.toLowerCase()) || ports1310(n).find(q => q.fitted) || { id: '1310W' }).id.slice(4) : 'L' + s; }
      case 'roadm': return isEnd(o) ? (mp == null ? 'AD' : n.p.directionless ? 'A' + (mp + 1) : `D${sd || 1}A${mp + 1}`) : 'D' + (sd || (mine.filter(x => { const y = S.nodes.find(q => q.id === (x.a === n.id ? x.b : x.a)); return y && !isEnd(y); }).indexOf(l) + 1));
      case 'edfa': case 'dcm': case 'voa': { const taken = new Set(mine.filter(x => x !== l).map(x => (x.a === n.id ? x.p.pa : x.p.pb)).filter(Boolean)); if (taken.has('IN')) return 'OUT'; if (taken.has('OUT')) return 'IN'; const f = feedOf(S, n); return f ? (f === l.id ? 'IN' : 'OUT') : mine.indexOf(l) > 0 ? 'OUT' : 'IN'; }
      case 'panel': case 'splitter': case 'switch': return sd;
      default: return 'P';
    }
  }
  // what a cable is, by the kinds of the ports at its two ends
  function cableRole(S, l) {
    const A = S.nodes.find(n => n.id === l.a), B = S.nodes.find(n => n.id === l.b); if (!A || !B) return null;
    const ka = portKind(A, endPort(S, l, A)), kb = portKind(B, endPort(S, l, B)), two = (x, y) => (ka === x && kb === y ? [A, B] : ka === y && kb === x ? [B, A] : null);
    let p;
    if ((p = two('eth', 'client'))) return { role: 'client', h: p[0], e: p[1] };
    if ((p = two('eth', '1310'))) return { role: 'grey', h: p[0], u: p[1] };
    if ((p = two('line', 'ad'))) return { role: 'port', t: p[0], m: p[1] };
    return { role: 'other', ka, kb };
  }
  // the add/drop index and side of an add/drop port id
  const adOf = (n, id) => { let m; if (n.type === 'mux' && (m = /^P(\d+)$/.exec(id))) return { side: '', k: +m[1] - 1 }; if (n.type === 'oadm' && (m = /^([EW])(\d+)$/.exec(id))) return { side: m[1].toLowerCase(), k: +m[2] - 1 };
    if (n.type === 'roadm' && (m = /^D(\d)A(\d+)$/.exec(id))) return { side: m[1], k: +m[2] - 1 }; if (n.type === 'roadm' && (m = /^A(\d+)$/.exec(id))) return { side: '', k: +m[1] - 1 }; return null; };
  // the side (OADM e/w), degree (ROADM) or port (panel, splitter, switch) the older code reads as sa/sb
  const sideOfPort = (n, id) => { if (!id) return ''; if (n.type === 'panel' || n.type === 'splitter' || n.type === 'switch') return id;
    if (n.type === 'oadm') return /^L[EW]$/.test(id) ? id[1].toLowerCase() : /^[EW]\d+$/.test(id) ? id[0].toLowerCase() : '';
    if (n.type === 'roadm') { const m = /^D(\d)/.exec(id); return m ? m[1] : ''; } return ''; };
  // Give every cable end a port: the one its older fields imply if that is free and real, else the first free port that fits. Then derive the older fields.
  function ensurePorts(S) {
    const by = id => S.nodes.find(n => n.id === id), used = new Map(), key = (n, id) => n.id + '|' + id;
    // an older lab with transponders on mux or ROADM ports but none numbered ran on a channel table: keep it that way
    if (S.g && S.g.table == null && S.links.some(l => !l.p.pa && !l.p.pb && l.p.mport == null && (() => { const a = by(l.a), b = by(l.b); return a && b && ((isEnd(a) && isAddDropDev(b)) || (isEnd(b) && isAddDropDev(a))); })()) && !S.links.some(l => Number.isInteger(l.p.mport))) S.g.table = true;
    const probe = l => [by(l.a), by(l.b)].some(n => n && (n.type === 'meter' || n.type === 'otdr')); // an instrument is a test probe on a port that stays cabled
    for (const l of S.links) for (const [n, f] of [[by(l.a), 'pa'], [by(l.b), 'pb']]) { if (!n) continue; if (probe(l)) { if (l.p[f] && !portKind(n, l.p[f])) l.p[f] = ''; continue; } if (l.p[f] && !portKind(n, l.p[f])) l.p[f] = ''; remapRoadm(l, n, f); const v = l.p[f]; if (v && !used.has(key(n, v))) used.set(key(n, v), l.id); else if (v) l.p[f] = ''; } // a second cable on a port loses it
    for (const l of S.links) {
      const A = by(l.a), B = by(l.b); if (!A || !B) continue;
      for (const [n, o, f] of [[A, B, 'pa'], [B, A, 'pb']]) {
        if (l.p[f]) continue;
        const list = portsOf(S, n), free = p => !used.has(key(n, p.id));
        let id = inferPort(S, l, n);
        if (probe(l) && list.some(p => p.id === id)) { l.p[f] = id; continue; }
        if (id === 'AD' || !portKind(n, id) || used.has(key(n, id))) { // a port the device no longer has stays (its channel or the fault list says so)
          const want = isEnd(o) && isAddDropDev(n) ? ['ad'] : o.type === 'host' && isEnd(n) ? ['client'] : o.type === 'host' ? ['1310', 'eth'] : isEnd(n) ? ['line'] : ['com', 'oline', 'deg', 'amp', 'eth', 'panel', 'tri', 'test'];
          const side = n.type === 'oadm' ? (l.a === n.id ? l.p.sa : l.p.sb) : '';
          const pick = list.find(p => free(p) && want.includes(p.kind) && (!side || p.side === side)) || list.find(p => free(p) && want.includes(p.kind)) || list.find(free);
          id = pick ? pick.id : id; // a device with every port taken keeps the implied one: the fault list reports it
        }
        l.p[f] = id; used.set(key(n, id), l.id);
      }
    }
    syncPorts(S);
  }
  // Which way an amplifier port faces: 'line' (a fiber span, or another amplifier), 'com' (the terminal: a mux, OADM, ROADM, transponder or host),
  // following patch cords through panels, splitters, switches, DCMs and attenuators; '' if it cannot tell
  function ampFaces(S, n, l) {
    const by = id => S.nodes.find(x => x.id === id), TERM = ['mux', 'oadm', 'roadm', 'trx', 'mxp', 'host'], PASS = ['panel', 'splitter', 'switch', 'dcm', 'voa'];
    for (let k = 0, c = l, at = n; k < 8 && c; k++) {
      if (c.kind === 'fiber') return 'line';
      const o = by(c.a === at.id ? c.b : c.a); if (!o) return ''; if (TERM.includes(o.type)) return 'com'; if (!PASS.includes(o.type)) return o.type === 'edfa' ? 'line' : '';
      const pc = endPort(S, c, o), others = S.links.filter(x => x !== c && (x.a === o.id || x.b === o.id) && ![by(x.a), by(x.b)].some(y => y && (y.type === 'meter' || y.type === 'otdr')));
      const m = o.type === 'panel' ? /^([rf])(\d+)$/.exec(pc || '') : null;
      c = o.type === 'panel' ? (m ? others.find(x => endPort(S, x, o) === (m[1] === 'r' ? 'f' : 'r') + m[2]) : null) : o.type === 'splitter' || o.type === 'switch' ? others.find(x => (endPort(S, x, o) === 'c') !== (pc === 'c')) : others[0];
      at = o;
    }
    return '';
  }
  const ampCable = (S, n, id) => S.links.find(l => (l.a === n.id || l.b === n.id) && endPort(S, l, n) === id);
  const AMP_KEYS = ['target', 'gain', 'nf', 'gmin', 'gmax', 'pmax'];
  // An older lab's amplifier had no type, and its settings were "A to Z" and "Z to A". It becomes an in-line amplifier if both sides face line fiber, else a
  // booster + pre-amp card; one whose first port faced the line (a pre-amp on the A-to-Z path) is turned round, so COM faces the mux, and its two stages swap.
  function settleAmps(S) {
    let moved = false;
    for (const n of S.nodes) {
      if (n.type !== 'edfa' || n.p.role) continue;
      const ci = ampCable(S, n, 'IN'), co = ampCable(S, n, 'OUT'), fi = ci ? ampFaces(S, n, ci) : '', fo = co ? ampFaces(S, n, co) : '';
      n.p.role = fi === 'line' && fo === 'line' ? 'ila' : 'term';
      if (n.p.role !== 'term' || fi !== 'line' || fo === 'line') continue;
      for (const [l, id] of [[ci, 'OUT'], [co, 'IN']]) if (l) l.p[l.a === n.id ? 'pa' : 'pb'] = id;
      for (const k of AMP_KEYS) { // the A-to-Z stage was its pre-amp: a blank return setting copied it
        const f = n.p[k], r = n.p[k + 'Rev'] === '' || n.p[k + 'Rev'] == null ? f : n.p[k + 'Rev'];
        n.p[k] = r; n.p[k + 'Rev'] = String(f) === String(r) ? '' : f === '' ? +S.g.launch : f; // a blank target followed the line launch power
      }
      moved = true;
    }
    return moved;
  }
  // A booster + pre-amp card cabled the wrong way round: COM toward the span and LINE toward the mux
  function ampTurned(S, n) { if (n.type !== 'edfa' || n.p.role !== 'term') return false; const ci = ampCable(S, n, 'IN'), co = ampCable(S, n, 'OUT'); return !!ci && !!co && ampFaces(S, n, ci) === 'line' && ampFaces(S, n, co) === 'com'; }
  // A ROADM's add/drop going directionless (or back) renumbers its ports: A3 is degree-free, D2A3 belongs to degree 2. Keep the cable on the same port number.
  function remapRoadm(l, n, f) {
    if (n.type !== 'roadm' || !l.p[f]) return; let m;
    if (!n.p.directionless && (m = /^A(\d+)$/.exec(l.p[f]))) { const d = (f === 'pa' ? l.p.sa : l.p.sb) || '1'; l.p[f] = `D${+d >= 1 && +d <= (+n.p.degrees || 1) ? d : 1}A${m[1]}`; }
    else if (n.p.directionless && (m = /^D\dA(\d+)$/.exec(l.p[f]))) l.p[f] = 'A' + m[1];
  }
  // the older per-cable fields, from the ports
  function syncPorts(S) {
    const by = id => S.nodes.find(n => n.id === id);
    for (const l of S.links) {
      const A = by(l.a), B = by(l.b); if (!A || !B || !l.p.pa || !l.p.pb) continue;
      l.p.sa = sideOfPort(A, l.p.pa); l.p.sb = sideOfPort(B, l.p.pb);
      const r = cableRole(S, l);
      if (r.role === 'port' && l.kind === 'patch') { const ad = adOf(r.m, endPort(S, l, r.m)); l.p.mport = ad && !(S.g && S.g.table) ? ad.k : null; if (r.m.type === 'roadm' && r.m.p.directionless) { if (l.a === r.m.id) l.p.sa = ''; else l.p.sb = ''; } }
      else l.p.mport = null;
      l.p.cport = r.role === 'client' ? +/\d+/.exec(endPort(S, l, r.e))[0] - 1 : null;
      l.p.hport = r.role === 'client' || r.role === 'grey' ? +/\d+/.exec(endPort(S, l, r.h))[0] - 1 : null;
      l.p.optic = r.role === 'grey' ? (PHY_.CLIENT_OPTICS[l.p.optic] && PHY_.CLIENT_OPTICS[l.p.optic].nm === 1310 ? l.p.optic : greyFor(r.h.p.speed)) : ''; // a grey cable carries the host's 1310 nm optic
    }
  }
  // which ports of a device are taken, by which cable
  const portsUsed2 = (S, n, except) => new Map(S.links.filter(l => l !== except && (l.a === n.id || l.b === n.id) && ![l.a, l.b].some(id => { const x = S.nodes.find(q => q.id === id); return x && (x.type === 'meter' || x.type === 'otdr'); })).map(l => [endPort(S, l, n), l]));
  // Can a new cable go between a and b? '' if both have a free port, else why not
  function cableFits(S, a, b) {
    for (const n of [a, b]) { const u = portsUsed2(S, n); if (!portsOf(S, n).some(p => !u.has(p.id))) { const k = portsOf(S, n).length; return `${n.name} has no free port: ${k === 1 ? 'its one port is' : `all ${k} are`} in use.`; } }
    return '';
  }
  // Cabling that cannot work, each with the reason, for the alarms: a port that does not exist, two cables in one port, and plugs of the wrong kind
  function cablingFaults(S) {
    const by = id => S.nodes.find(n => n.id === id), out = [], seen = new Map();
    const pn = (n, id) => `${n.name} ${portLabel(S, n, id).replace(/ \((module off|line|west|east)\)$/, '')}`;
    for (const l of S.links) {
      const A = by(l.a), B = by(l.b); if (!A || !B) continue;
      const ends = [[A, endPort(S, l, A), B], [B, endPort(S, l, B), A]], add = text => out.push({ link: l.id, nodes: [A.id, B.id], text });
      let bad = false;
      if ([A, B].some(n => n.type === 'meter' || n.type === 'otdr')) continue; // an instrument clips onto a test point, beside the cable already there
      if ([A, B].some((n, i) => ['panel', 'tri'].includes(portKind(n, ends[i][1])))) { for (const [n, id] of ends) { const k = n.id + '|' + id; if (seen.has(k)) add(`${pn(n, id)} has two cables in it: one port takes one cable.`); seen.set(k, l.id); } continue; } // a patch panel or splitter port passes whatever is plugged in
      for (const [n, id] of ends) {
        if (id !== 'AD' && !portsOf(S, n).some(p => p.id === id)) { bad = true; if (!(portKind(n, id) === 'ad' && isAddDropDev(n))) add(`${n.name} has no port ${portLabel(S, n, id)} any more: the cable to ${(n === A ? B : A).name} goes nowhere.${id === 'L2' ? ' Its second line port came with line protection, which is off.' : ''}`); } // a missing add/drop port shows on its channel
        const k = n.id + '|' + id; if (id !== 'AD' && (n === A ? l.p.pa : l.p.pb) && seen.has(k)) { bad = true; add(`${pn(n, id)} has two cables in it: one port takes one cable.`); } seen.set(k, l.id);
      }
      if (bad) continue;
      const [[, ia], [, ib]] = ends, ka = portKind(A, ia), kb = portKind(B, ib), K = new Set([ka, kb]), end = (kind, i = 0) => (ka === kind && (i === 0 || kb !== kind) ? [A, ia, B, ib] : [B, ib, A, ia]);
      if (K.has('line') && K.has('1310')) { const [t, ti, u, ui] = end('line'); add(`${pn(t, ti)} is cabled into ${pn(u, ui)}: the 1310 nm port only passes 1310 nm light, so the DWDM signal goes nowhere. Move it to a channel port.`); }
      else if (K.has('line') && K.has('com')) { const [t, ti, u, ui] = end('line'); add(`${pn(t, ti)} is cabled into ${pn(u, ui)}, the line side of the mux: its light is demultiplexed back into the channel ports, not sent down the line. A transponder goes in a channel port.`); }
      else if (K.has('line') && K.has('eth')) { const [t, ti, h, hi] = end('line'); add(`${pn(h, hi)} is cabled into ${pn(t, ti)}: a grey client optic and a coherent DWDM line optic do not talk to each other. A host goes in the client port.`); }
      else if (K.has('client') && !K.has('eth')) { const [t, ti, o, oi] = end('client'); add(`${pn(t, ti)} is cabled to ${pn(o, oi)}: a client port carries the grey client signal to a host or router, not to the optical line. Use the line port.`); }
      else if (K.has('eth') && K.has('ad')) { const [h, hi, m, mi] = end('eth'); add(`${pn(h, hi)} is cabled into ${pn(m, mi)}: that filter port passes one DWDM channel near 1550 nm, so a 1310 nm grey optic is blocked. Use the 1310 nm port or a transponder.`); }
      else if (K.has('eth') && !K.has('client') && !K.has('1310') && !K.has('eth')) { const [h, hi, o, oi] = end('eth'); add(`${pn(h, hi)} is cabled to ${pn(o, oi)}: a host's grey optic connects to a transponder client port, or to the 1310 nm port of a mux or OADM.`); }
      else if (K.has('eth') && ka === 'eth' && kb === 'eth') add(`${pn(A, ia)} is cabled straight to ${pn(B, ib)}: that works as a short grey link, but the optical network is not in it.`);
      else if (K.has('1310') && !K.has('eth')) { const [u, ui, o, oi] = end('1310'); add(`${pn(o, oi)} is cabled into ${pn(u, ui)}: the 1310 nm port only passes 1310 nm light, so nothing in the C-band gets through.`); }
      else if (K.has('mon')) { const [m, mi, o, oi] = end('mon'); add(`${pn(o, oi)} is cabled into ${pn(m, mi)}: the monitor port is a 1% tap of the amplifier's output for a power meter or channel monitor, and passes nothing on.`); }
      else if (K.has('ad') && ka === 'ad' && kb === 'ad' && A.id === B.id) add(`${A.name}: two of its channel ports are cabled to each other, which loops a channel back.`);
      else if (K.has('ad') && !K.has('line') && !(ka === 'ad' && kb === 'ad')) { const [m, mi, o, oi] = end('ad'); add(`${pn(o, oi)} is cabled into ${pn(m, mi)}, a channel port: only that one channel gets through. The line goes on ${m.type === 'mux' ? 'COM' : m.type === 'oadm' ? 'a Line port' : 'a degree port'}.`); }
    }
    for (const n of S.nodes) if (ampTurned(S, n)) { const l = ampCable(S, n, 'IN'); out.push({ link: l.id, nodes: [l.a, l.b], text: `${n.name} is cabled the wrong way round: COM faces the span and LINE the mux, so the pre-amp stage drives the fiber and the booster feeds the mux. Swap its two cables.` }); }
    return out;
  }
  // Light through a device: may it enter by one port and leave by another? (a transponder only starts or ends a route, by a line port)
  function passes(n, inK, inId, outK, outId) {
    switch (n.type) {
      case 'mux': return (inK === 'com' && outK === 'ad') || (inK === 'ad' && outK === 'com');
      case 'oadm': return (inK === 'oline' && outK === 'oline' && inId !== outId) || (inK === 'oline' && outK === 'ad') || (inK === 'ad' && outK === 'oline');
      case 'roadm': return (inK === 'deg' && outK === 'deg' && inId !== outId) || (inK === 'deg' && outK === 'ad') || (inK === 'ad' && outK === 'deg');
      case 'edfa': case 'dcm': case 'voa': return inK === 'amp' && outK === 'amp' && inId !== outId; // a monitor tap passes nothing on
      default: return true;
    }
  }
