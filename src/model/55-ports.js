
  // ---------- ports: what a cable end plugs into, and how many of each a device has ----------
  // Each cable end takes one physical port. A transponder or muxponder has one line port (a Tx/Rx pair, or one fiber for a BiDi optic):
  // it goes to one mux, OADM or ROADM add/drop port, or straight to the far end over dark fiber. With line protection set, an optical
  // line protection (OLP) module in front of it splits the line into a working and a protection port, so it can be dual-homed.
  const isAddDropDev = n => !!n && (n.type === 'mux' || n.type === 'oadm' || n.type === 'roadm');
  // the role of the port that cable l uses at node n: 'client' (host to transponder client port), 'grey' (host to a 1310 nm port),
  // 'adddrop' (a transponder in a mux/OADM/ROADM channel port; at the transponder this is its line port), or 'line'
  function portRole(S, l, n) {
    const o = S.nodes.find(x => x.id === (l.a === n.id ? l.b : l.a)); if (!o) return 'line';
    if (l.kind === 'patch' && ((isEnd(n) && o.type === 'host') || (n.type === 'host' && isEnd(o)))) return 'client';
    if (l.kind === 'patch' && greyEnds(n, o)) return 'grey';
    if (l.kind === 'patch' && isAddDropDev(n) && isEnd(o)) return 'adddrop';
    return 'line';
  }
  // A transponder whose channel is protected (its own line protection, or the protected service channel of a plan) has an OLP: two line ports
  function lineProtected(S, n) {
    if (!isEnd(n)) return false;
    if (n.p.prot === '1+1' || n.p.prot === 'shared') return true;
    const plan = S.g && S.g.plan, svcEnd = S.svc && (S.svc.a === n.id || S.svc.z === n.id);
    return !!(svcEnd && Array.isArray(plan) && plan.some(c => c.svc && (c.prot === '1+1' || c.prot === 'shared')));
  }
  // How many line-side cables a device takes, and a sentence that says why
  function linePorts(S, n) {
    const T = TYPES[n.type];
    switch (n.type) {
      case 'trx': case 'mxp': return lineProtected(S, n) ? { max: 2, why: `${T.label}s have one line port. With line protection, an OLP module gives it a working and a protection port, so it takes two` }
        : { max: 1, why: `${T.label}s have one line port: one cable to a mux, OADM or ROADM port, or to the far end over dark fiber. To dual-home it, set line protection (1+1 or 1:N) on it first: that adds an optical line protection module with a second line port` };
      case 'mux': return { max: 1, why: 'A mux has one common (line) port; transponders go in its channel ports' };
      case 'oadm': { const k = String(n.p.sides || '').length; return { max: k, why: k === 1 ? 'This OADM has one line side, so one line port' : 'An OADM has two line ports, east and west' }; }
      case 'roadm': return { max: Math.round(+n.p.degrees) || 1, why: `This ROADM has ${Math.round(+n.p.degrees) || 1} degree${+n.p.degrees === 1 ? '' : 's'}, one line port each. Raise the degree count in its inspector` };
      case 'host': return { max: 0, why: 'A host connects to a transponder or muxponder client port, or with a grey optic to the 1310 nm port of a mux or OADM' };
      case 'panel': return { max: 2 * (Math.round(+n.p.ports) || 1), why: `This panel has ${n.p.ports} ports, each with a rear and a front connector` };
      case 'splitter': case 'switch': return { max: 3, why: `A ${n.type === 'switch' ? 'optical switch' : 'splitter'} has three ports: common, A and B` };
      case 'meter': case 'otdr': return { max: 1, why: `${n.type === 'otdr' ? 'An OTDR' : 'A power meter'} has one port` };
      default: return { max: T.maxLinks, why: `${({ edfa: 'An EDFA', dcm: 'A dispersion compensator', voa: 'A VOA or pad' })[n.type] || 'It'} has ${T.maxLinks === 1 ? 'one port' : 'an input and an output'}` };
    }
  }
  // add/drop (channel) ports on a mux, OADM or ROADM
  const addDropPorts = n => (n.type === 'oadm' ? String(n.p.sides || '').split('').reduce((t, s) => t + (Math.round(+n.p[s + 'Ports']) || 0), 0) : n.type === 'roadm' && !n.p.directionless ? (Math.round(+n.p.ports) || 0) * (Math.round(+n.p.degrees) || 1) : Math.round(+n.p.ports) || 0);
  // Cables at n beyond what its ports allow: [{ role, used, max, why }]
  function portUse(S, n, extra) {
    const mine = S.links.filter(l => l.a === n.id || l.b === n.id).concat(extra ? [extra] : []), by = { line: 0, adddrop: 0, client: 0, grey: 0 };
    for (const l of mine) by[portRole(S, l, n)]++;
    const lp = linePorts(S, n), out = [];
    const lineUsed = by.line + (isEnd(n) ? by.adddrop : 0); // at a transponder the cable into a mux port is its line cable
    out.push({ role: 'line', used: lineUsed, max: lp.max, why: lp.why });
    if (isAddDropDev(n)) out.push({ role: 'adddrop', used: by.adddrop, max: addDropPorts(n), why: '' });
    if (n.type === 'mux' || n.type === 'oadm') out.push({ role: 'grey', used: by.grey, max: 1, why: '' });
    if (n.type === 'host') out.push({ role: 'client', used: by.client + by.grey, max: Math.round(+n.p.ports) || 1, why: 'Raise the port count in its inspector' });
    if (isEnd(n)) { const k = n.type === 'mxp' ? n.p.clients.length : 1; out.push({ role: 'client', used: by.client, max: k, why: n.type === 'mxp' ? 'Add client ports in its inspector' : 'Use a muxponder for several clients' }); }
    return out;
  }
  const PORT_NAME = { line: 'line', adddrop: 'add/drop', grey: '1310 nm', client: 'client' };
  // Would a new cable between a and b fit? '' if so, else the reason (for the toast). The cable is tested as a patch cord or a fiber span.
  function cableFits(S, a, b, kind) {
    const l = { id: '_new', a: a.id, b: b.id, kind, p: {} };
    for (const n of [a, b]) {
      const role = portRole(S, l, n), over = portUse(S, n, l).find(u => u.used > u.max && (u.role === role || (u.role === 'line' && role === 'adddrop' && isEnd(n)) || (u.role === 'client' && role === 'grey' && n.type === 'host')));
      if (over) return over.max === 0 ? `${over.why}.` : over.role === 'line' ? `${n.name} has no free line port. ${over.why}.` : `${n.name} has no free ${PORT_NAME[over.role]} port (it has ${over.max}).${over.why ? ' ' + over.why + '.' : ''}`;
    }
    return '';
  }
  // Devices with more cables than ports, for an imported or older topology (or one whose line protection was turned off afterwards)
  function overCabled(S) {
    const out = [];
    for (const n of S.nodes) for (const u of portUse(S, n)) if (u.used > u.max) out.push({ id: n.id, name: n.name, role: u.role, used: u.used, max: u.max, why: u.why });
    return out;
  }
