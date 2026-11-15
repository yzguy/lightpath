  // ---------- hosts: reachability and traffic over the optical network ----------
  const HOST_SPEEDS = [1, 10, 25, 40, 50, 100, 200, 400, 800];
  const LAT = { fiberUsPerKm: 4.9, coherentUs: 10, directUs: 1 }; // propagation in glass, and the DSP/FEC delay of one coherent (or one direct-detect) transceiver; representative
  // the lit channels that could carry host traffic: one entry per plan channel (or the service alone), with the two transponders at its ends
  function channelTable(S, res) {
    const E = effective(S), plan = E.g.plan, a = S.svc && S.svc.a, z = S.svc && S.svc.z, out = [];
    if (Array.isArray(plan) && plan.length && res && res.channels) plan.forEach((c, i) => { const ch = res.channels[i]; if (c.filler || !ch) return; out.push({ i, slot: c.slot, a: c.svc || !c.from ? a : c.from, z: c.svc || !c.to ? z : c.to, ch, mode: PHY_.MODES[c.mode] || res.mode }); });
    else if (res && res.mode) out.push({ i: -1, slot: null, a, z, ch: { status: res.status, notes: res.status === 'up' ? [] : [res.headline], routeLinks: res.path ? res.path.links : [], routeNodes: res.path ? res.path.nodes : [], qMargin: res.qMargin, rate: res.mode.rate }, mode: res.mode });
    return out;
  }
  // One-way latency in microseconds along a channel: fiber, any dispersion-compensating fiber, and the two transceivers
  function latencyUs(S, entry) {
    const { link, node } = mkGraph(S); let us = 0, km = 0;
    for (const id of entry.ch.routeLinks || []) { const l = link(id); if (!l) continue; const d = l.kind === 'fiber' ? +l.p.len : patchKm(l); km += d; us += d * LAT.fiberUsPerKm; }
    for (const id of entry.ch.routeNodes || []) { const n = node(id); if (n && n.type === 'dcm') us += Math.abs(+n.p.cd) / 17 * LAT.fiberUsPerKm; }
    us += 2 * (entry.mode && entry.mode.coh === false ? LAT.directUs : LAT.coherentUs);
    return { us, km };
  }
  // Can host A reach host Z? Every step the packet needs is checked in order, so the first one that fails says what is wrong:
  // the client cable and optic at each end, the transponders, the channel between them, and its optical status. Only the links matter: there are no IP addresses.
  function reach(S, res) {
    useGrid(S);
    const { node } = mkGraph(S), hosts = S.nodes.filter(n => n.type === 'host'), tbl = channelTable(S, res), out = [];
    const dark = new Map(((res && res.derived && res.derived.dark) || []).map(d => [d.id, d.why]));
    // hosts patched into the 1310 nm port of a mux or OADM reach each other over the grey 1310 nm link between the two units, with no transponder
    const greyOf = h => S.links.some(l => (l.a === h.id || l.b === h.id) && cableRole(S, l).role === 'grey');
    const G = S.links.some(l => cableRole(S, l).role === 'grey') ? ((res && res.b1310) || band1310(S)).links : [];
    const viaGrey = (A, Z) => {
      const steps = [], fail = text => { steps.push({ ok: false, text }); return { steps, ok: false }; };
      const r = G.find(x => x.b && ((x.hostA === A.id && x.hostB === Z.id) || (x.hostA === Z.id && x.hostB === A.id)));
      if (!r) { const bl = G.find(x => x.hostA === A.id || x.hostA === Z.id || x.hostB === A.id || x.hostB === Z.id); return fail(bl ? `the 1310 nm link from ${bl.hostA === Z.id || bl.hostB === Z.id ? Z.name : A.name} goes nowhere: ${bl.why}` : `${greyOf(A) ? Z.name : A.name} is not patched into a 1310 nm port that ${greyOf(A) ? A.name : Z.name}'s reaches`); }
      steps.push({ ok: true, text: `${A.name} and ${Z.name} are patched into the 1310 nm ports of ${r.aName} and ${r.bName}${r.opticName ? ` (${r.opticName})` : ''}` });
      if (r.status === 'down') return fail(`the 1310 nm link is DOWN: ${r.why}`);
      steps.push({ ok: true, text: `The 1310 nm link ${r.aName}–${r.bName} is ${r.status === 'warn' ? 'up with a warning' : 'UP'}: ${f1(r.margin)} dB of margin${r.why ? ' (' + r.why + ')' : ''}` });
      return { steps, ok: true, entry: { i: 'g:' + [r.a, r.b].sort().join('-'), slot: null, label: `1310 nm link ${r.aName}–${r.bName}`, ch: { status: r.status === 'warn' ? 'degraded' : 'up', rate: r.rate } }, rate: r.rate, latencyUs: r.km * LAT.fiberUsPerKm + 2 * LAT.directUs, km: r.km, degraded: r.status === 'warn', cp: 0 };
    };
    const cables = h => S.links.filter(l => l.kind === 'patch' && (l.a === h.id || l.b === h.id)).map(l => ({ l, end: node(l.a === h.id ? l.b : l.a) })).filter(x => x.end && isEnd(x.end) && cableRole(S, x.l).role === 'client'); // a host cable into a transponder's line port is not a client connection: the fault list says why
    // the client side of one host cable: does the host port match the transponder's client port, and is that port itself healthy
    const side = (h, c, steps) => {
      const e = c.end, hp = c.l.p.hport == null ? 0 : c.l.p.hport, cp = c.l.p.cport == null ? 0 : c.l.p.cport;
      steps.push({ ok: true, text: `${h.name} port ${hp + 1} is cabled to ${e.name}${e.type === 'mxp' ? ` client port ${cp + 1}` : ''}` });
      const m = PHY_.MODES[e.p.mode];
      if (e.type === 'trx') {
        if (+h.p.speed !== m.rate) { steps.push({ ok: false, text: `${e.name} is a ${m.rate}G transponder (${m.short}) but ${h.name}'s port is ${h.p.speed}G: the client link cannot come up` }); return null; }
        steps.push({ ok: true, text: `${h.name}'s ${h.p.speed}G port matches the ${m.rate}G ${e.name}` });
        return { e, rate: m.rate, cp: 0 };
      }
      const cl = e.p.clients[cp]; if (!cl) { steps.push({ ok: false, text: `${e.name} has no client port ${cp + 1}` }); return null; }
      const b = PHY_.clientBudget(cl);
      if (+h.p.speed !== b.optic.rate) { steps.push({ ok: false, text: `${e.name} client port ${cp + 1} is a ${b.optic.name} (${b.optic.rate}G) but ${h.name}'s port is ${h.p.speed}G` }); return null; }
      if (b.status === 'down') { steps.push({ ok: false, text: `${e.name} client port ${cp + 1}: ${b.notes[0]}` }); return null; }
      const total = e.p.clients.reduce((t, c) => t + PHY_.CLIENT_OPTICS[c.optic].rate, 0);
      if (total > m.rate) { steps.push({ ok: false, text: `${e.name}'s client ports add up to ${total}G, more than the ${m.short} line port carries (${m.rate}G)` }); return null; }
      steps.push({ ok: true, text: `Client port ${cp + 1} (${b.optic.name}) has ${b.margin.toFixed(1)} dB of margin${b.status === 'warn' ? ': ' + b.notes[0] : ''}` });
      return { e, rate: b.optic.rate, cp };
    };
    for (let i = 0; i < hosts.length; i++) for (let j = i + 1; j < hosts.length; j++) {
      const A = hosts[i], Z = hosts[j], ca = cables(A), cz = cables(Z); let best = null;
      const attempts = ca.length && cz.length ? ca.flatMap(x => cz.map(y => [x, y])) : [[null, null]];
      for (const [x, y] of attempts) {
        const steps = [], fail = text => { steps.push({ ok: false, text }); return { steps, ok: false }; };
        let r;
        if (!x) r = fail(!ca.length ? `${A.name} is not cabled to a transponder or muxponder` : `${Z.name} is not cabled to a transponder or muxponder`);
        else {
          const sa = side(A, x, steps), sz = sa ? side(Z, y, steps) : null;
          if (!sa || !sz) r = { steps, ok: false };
          else if (dark.get(sa.e.id)) r = fail(`${sa.e.name} is dark: ${dark.get(sa.e.id)}`);
          else if (dark.get(sz.e.id)) r = fail(`${sz.e.name} is dark: ${dark.get(sz.e.id)}`);
          else if (sa.e === sz.e) r = fail(`${A.name} and ${Z.name} hang off the same ${sa.e.type === 'mxp' ? 'muxponder' : 'transponder'}, ${sa.e.name}: it does not switch between its own ports, so this traffic never reaches the line`);
          else if (sa.e.type !== sz.e.type) r = fail(`${sa.e.name} is a ${sa.e.type === 'mxp' ? 'muxponder' : 'transponder'} and ${sz.e.name} a ${sz.e.type === 'mxp' ? 'muxponder' : 'transponder'}: their client sides do not map onto each other`);
          else if (sa.e.type === 'mxp' && sa.cp !== sz.cp) r = fail(`${sa.e.name} client port ${sa.cp + 1} is carried to client port ${sa.cp + 1} on the far muxponder, but ${Z.name} is on ${sz.e.name} client port ${sz.cp + 1}`);
          else {
            const en = tbl.find(t => (t.a === sa.e.id && t.z === sz.e.id) || (t.a === sz.e.id && t.z === sa.e.id));
            if (!en) r = fail(`no channel connects ${sa.e.name} and ${sz.e.name}${res && res.derived ? ': plug each into the port for the same slot, with the same tuning, on a mux, OADM or ROADM on the way' : ': add a channel between them in the Channels tab'}`);
            else if (sa.e.p.mode !== sz.e.p.mode) r = fail(`${sa.e.name} is ${PHY_.MODES[sa.e.p.mode].short} but ${sz.e.name} is ${PHY_.MODES[sz.e.p.mode].short}: the line ports will never lock`);
            else if (['down', 'los', 'blocked', 'nopath', 'standby', 'unreachable'].includes(en.ch.status)) { steps.push({ ok: true, text: `Channel ${en.slot != null ? 'in slot ' + (en.slot + 1) : 'of the service'} joins ${sa.e.name} and ${sz.e.name}` }); r = fail(`the channel is ${en.ch.status.toUpperCase()}: ${(en.ch.notes && en.ch.notes[0]) || 'no light reaches the far end'}`); }
            else {
              steps.push({ ok: true, text: `Channel ${en.slot != null ? 'in slot ' + (en.slot + 1) : 'of the service'} joins ${sa.e.name} and ${sz.e.name} and is ${en.ch.status.toUpperCase()}${en.ch.qMargin != null ? ` (${en.ch.qMargin.toFixed(1)} dB Q margin)` : ''}` });
              const lt = latencyUs(S, en);
              r = { steps, ok: true, entry: en, rate: Math.min(sa.rate, sz.rate), latencyUs: lt.us, km: lt.km, degraded: en.ch.status === 'degraded', cp: sa.cp };
            }
          }
        }
        if (!best || (r.ok && !best.ok) || (!r.ok && !best.ok && r.steps.length > best.steps.length)) best = r;
        if (best.ok) break;
      }
      if (!best.ok && (greyOf(A) || greyOf(Z))) { const g = viaGrey(A, Z); if (g.ok || !ca.length || !cz.length) best = g; }
      out.push({ a: A.id, z: Z.id, ok: best.ok, degraded: !!best.degraded, steps: best.steps, why: best.ok ? '' : best.steps[best.steps.length - 1].text, latencyUs: best.latencyUs, km: best.km, rate: best.rate, entry: best.entry || null, cp: best.cp });
    }
    return out;
  }
  // The offered traffic (S.flows, Gb/s from one host to another) over the channels the hosts can use. A flow is capped by its host ports and client
  // optics; the flows that share a channel in one direction are scaled down together when they add up to more than the line rate.
  function traffic(S, res) {
    const R = reach(S, res), { node } = mkGraph(S), flows = S.flows || [], chan = new Map(), out = [];
    const find = (a, z) => R.find(r => (r.a === a && r.z === z) || (r.a === z && r.z === a));
    for (const f of flows) {
      const r = find(f.a, f.z), A = node(f.a), Z = node(f.z), cap = A && Z ? Math.min(+A.p.speed, +Z.p.speed) : 0, o = { a: f.a, z: f.z, offered: f.gbps, ok: !!(r && r.ok), why: r ? r.why : 'unknown hosts', delivered: 0, lossPct: 100, latencyUs: r ? r.latencyUs : null, slot: r && r.entry ? r.entry.slot : null };
      if (r && r.ok) {
        const want = Math.min(f.gbps, cap, r.rate), key = (r.entry.i) + '|' + (r.a === f.a ? 'ab' : 'ba');
        if (!chan.has(key)) chan.set(key, { slot: r.entry.slot, label: r.entry.label || '', dir: key.split('|')[1], cap: r.entry.ch.rate || (r.entry.mode && r.entry.mode.rate), load: 0, flows: [], a: r.a === f.a ? r.a : r.z, z: r.a === f.a ? r.z : r.a });
        const c = chan.get(key); c.load += want; c.flows.push(o); o.want = want;
      }
      out.push(o);
    }
    for (const c of chan.values()) { const k = c.cap ? Math.min(1, c.cap / c.load) : 1; c.util = c.cap ? Math.min(1, c.load / c.cap) : 0; c.over = c.load > c.cap; for (const o of c.flows) { o.delivered = o.want * k; o.lossPct = o.offered > 0 ? 100 * (1 - o.delivered / o.offered) : 0; } }
    return { flows: out, channels: [...chan.values()] };
  }

