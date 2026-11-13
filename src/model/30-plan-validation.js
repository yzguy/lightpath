  // ---------- span list import ----------
  // Builds a point-to-point line from CSV rows "km[, fiber[, extra_dB[, label]]]": TRX - MUX - booster - (ILA between spans) - preamp - MUX - TRX.
  // Blank lines, # comments and a header row are skipped. Returns { topo, errors, spans }; topo is null if no span parsed.
  const FIBER_ALIAS = { smf: 'smf', g652: 'smf', 'g.652': 'smf', ssmf: 'smf', leaf: 'leaf', nzdsf: 'leaf', g655: 'leaf', 'g.655': 'leaf', ull: 'ull', g654: 'ull', 'g.654': 'ull', legacy: 'legacy' };
  function fromSpans(text, mode = 'zrp400') {
    const errors = [], spans = [];
    String(text).split(/\r?\n/).forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim();
      if (!line) return;
      const c = line.split(/[,;\t]/).map(x => x.trim());
      if (!Number.isFinite(+c[0]) || c[0] === '') { if (spans.length || i > 0) errors.push(`Line ${i + 1}: "${c[0]}" is not a length in km.`); return; } // first non-numeric row = header
      const km = +c[0], fkey = (c[1] || 'smf').toLowerCase().replace(/[\s-]/g, ''), extra = c[2] === undefined || c[2] === '' ? 1 : +c[2];
      if (!(km > 0 && km <= 1000)) return errors.push(`Line ${i + 1}: length ${c[0]} km must be between 0 and 1000.`);
      if (!FIBER_ALIAS[fkey]) return errors.push(`Line ${i + 1}: unknown fiber "${c[1]}". Use smf, leaf, ull or legacy.`);
      if (!Number.isFinite(extra) || extra < 0 || extra > 30) return errors.push(`Line ${i + 1}: extra loss "${c[2]}" dB must be 0 to 30.`);
      spans.push({ km, fiber: FIBER_ALIAS[fkey], extra });
    });
    if (spans.length > 40) { errors.push('More than 40 spans: only the first 40 were used.'); spans.length = 40; }
    if (!spans.length) return { topo: null, errors: errors.length ? errors : ['No spans found. One per line: km, fiber, extra loss dB.'], spans };
    const X = 150, y = 220, nodes = [], links = [];
    const add = (type, name, p) => { const n = N(type, name, 60 + nodes.length * X, y, p); nodes.push(n); return n; };
    const a = add('trx', 'TRX-A', { mode }), ma = add('mux', 'MUX-A'), ba = add('edfa', 'BST-A', { gmin: 5 });
    let prev = ba;
    spans.forEach((sp, i) => {
      const last = i === spans.length - 1, nx = last ? add('edfa', 'PRE-B') : add('edfa', `ILA-${i + 1}`);
      links.push(L(prev, nx, 'fiber', { len: sp.km, fiber: sp.fiber, extra: sp.extra })); prev = nx;
    });
    const mb = add('mux', 'MUX-B'), z = add('trx', 'TRX-Z', { mode });
    links.unshift(L(a, ma, 'patch'), L(ma, ba, 'patch'));
    links.push(L(prev, mb, 'patch'), L(mb, z, 'patch'));
    return { topo: { nodes, links, g: { nch: 16, df: 75, launch: 0 }, svc: { a: a.id, z: z.id } }, errors, spans };
  }

  // Resilience assumptions: fiber cuts per 1000 km per year, mean time to repair (h), loss-of-signal detection and switch time (ms) for 1+1,
  // extra turn-up time for a dark shared protection route (s), and control-plane restoration time for an unprotected channel (s).
  const RESIL = { cutRate: 3, mttr: 12, detectMs: 5, switchMs: 30, sharedSec: 3, restoreSec: 60, devRate: 0.02 };

  // ---------- channel plan ----------
  // g.plan = null (identical channels, g.nch of them) or [{ slot, mode, off (dB vs the service), svc, from, to, via }]. Slots index the C-band grid.
  // A slot can be used by several channels as long as their routes share no fiber (wavelength reuse); on a shared fiber the later one is blocked.
  const nodeId = v => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : '');
  function sanitizePlan(p, df) {
    if (!Array.isArray(p) || !p.length) return null;
    const slots = PHY_.cBandSlots(df * 1e9), seen = new Set(), out = [];
    for (const c of p) {
      if (!c || typeof c !== 'object') continue;
      const slot = Math.round(+c.slot);
      const key = slot + '|' + nodeId(c.from) + '|' + nodeId(c.to) + '|' + nodeId(c.via) + '|' + nodeId(c.conv); // the same slot may repeat on different routes
      if (!Number.isFinite(slot) || slot < 0 || slot >= slots || seen.has(key)) continue;
      seen.add(key);
      out.push({ slot, mode: PHY_.MODES[c.mode] ? c.mode : 'zrp400', off: Math.min(10, Math.max(-10, Number.isFinite(+c.off) && c.off !== '' && c.off !== null ? +c.off : 0)), svc: !!c.svc, from: nodeId(c.from), to: nodeId(c.to), via: nodeId(c.via), conv: nodeId(c.conv), slot2: Number.isFinite(+c.slot2) && c.slot2 !== '' && c.slot2 !== null && +c.slot2 >= 0 && +c.slot2 < slots ? Math.round(+c.slot2) : slot, prot: c.prot === '1+1' ? '1+1' : c.prot === 'shared' ? 'shared' : '', slotRev: Number.isFinite(+c.slotRev) && c.slotRev !== '' && c.slotRev !== null && typeof c.slotRev !== 'boolean' && +c.slotRev >= 0 && +c.slotRev < slots && Math.round(+c.slotRev) !== slot ? Math.round(+c.slotRev) : null });
      if (out.length >= 96) break;
    }
    if (!out.length) return null;
    out.sort((a, b) => a.slot - b.slot);
    const first = out.findIndex(c => c.svc);
    out.forEach((c, i) => { c.svc = i === (first >= 0 ? first : Math.floor(out.length / 2)); if (c.svc || c.from === c.to) { if (c.svc) c.from = c.to = ''; else c.to = ''; } if (c.svc) { c.via = ''; c.conv = ''; } if (c.conv) c.via = ''; });
    return out;
  }
  // Turn the uniform line into an editable plan: the same block of channels, service in the middle.
  function planFromUniform(g, svcMode) {
    const df = +g.df * 1e9, ch = buildChans(g, svcMode, false, PHY_.cBandSlots(df), df);
    return ch.map(c => ({ slot: c.slot, mode: c.mode, off: 0, svc: c.svc, from: '', to: '', via: '', conv: '', slot2: c.slot, prot: '' }));
  }
  // The same plan on a different grid: each channel keeps its frequency, collisions drop.
  function remapPlan(plan, oldDf, newDf) {
    if (!plan) return plan;
    const slots = PHY_.cBandSlots(newDf * 1e9), seen = new Set(), out = [];
    for (const c of plan) { const s = Math.floor((c.slot + 0.5) * oldDf / newDf), key = s + '|' + c.from + '|' + c.to + '|' + c.via + '|' + c.conv; if (s >= slots || seen.has(key)) continue; seen.add(key); out.push({ ...c, slot: s, slot2: Math.min(slots - 1, Math.floor(((c.slot2 ?? c.slot) + 0.5) * oldDf / newDf)) }); }
    return sanitizePlan(out, newDf);
  }

  // ---------- validation ----------
  // Takes untrusted topology JSON (localStorage or pasted import) and returns a clean {nodes, links, g, svc}.
  // Unknown device types and links to missing devices are dropped; missing or non-numeric parameters get defaults.
  const SPLIT = { '50/50': [0.5, 0.5], '60/40': [0.6, 0.4], '70/30': [0.7, 0.3], '80/20': [0.8, 0.2], '90/10': [0.9, 0.1], '95/5': [0.95, 0.05], '99/1': [0.99, 0.01] }; // power share of ports a and b
  const splitLossDb = (n, port) => -10 * Math.log10((SPLIT[n.p.ratio] || SPLIT['50/50'])[port === 'b' ? 1 : 0]) + (+n.p.excess || 0); // from the common port to a branch (and back)
  const isTriPort = n => !!n && (n.type === 'splitter' || n.type === 'switch'); // a common port c and two branches a and b
  // The side of an OADM (e, w), or the degree of a ROADM ('1'..'9'), that one end of a cable uses. `given` is kept if valid; otherwise an OADM takes the side the
  // neighbour lies on, a ROADM the first degree no other line cable uses. A transponder cable on a ROADM that is not directionless belongs to a degree too.
  function sideFor(me, other, given, usedDeg) {
    if (!me) return '';
    if (me.type === 'oadm') return ['e', 'w'].includes(given) && me.p.sides.includes(given) ? given : me.p.sides.length === 1 ? me.p.sides : other.x < me.x ? 'w' : 'e';
    if (me.type === 'panel') { // a port of a patch panel: 'r3' is the rear of port 3, 'f3' its front; light enters one side and leaves the other
      const u = usedDeg.get(me.id) || new Set(), n = me.p.ports; usedDeg.set(me.id, u);
      const m = /^([rf])(\d{1,2})$/.exec(String(given || '')); if (m && +m[2] >= 1 && +m[2] <= n) { u.add(given); return given; }
      for (let k = 1; k <= n; k++) { if (u.has('r' + k) && !u.has('f' + k)) { u.add('f' + k); return 'f' + k; } if (u.has('f' + k) && !u.has('r' + k)) { u.add('r' + k); return 'r' + k; } } // the other side of a port already in use
      for (let k = 1; k <= n; k++) if (!u.has('r' + k) && !u.has('f' + k)) { u.add('r' + k); return 'r' + k; }
      return '';
    }
    if (isTriPort(me)) { const u = usedDeg.get(me.id) || new Set(); usedDeg.set(me.id, u); let d = ['c', 'a', 'b'].includes(given) ? given : ''; if (!d) d = ['c', 'a', 'b'].find(k => !u.has(k)) || ''; if (d) u.add(d); return d; }
    if (me.type !== 'roadm') return '';
    const ok = /^[1-9]$/.test(given) && +given <= me.p.degrees;
    if (isEnd(other)) return me.p.directionless ? '' : ok ? given : '1';
    const u = usedDeg.get(me.id) || new Set(); usedDeg.set(me.id, u);
    let d = ok ? given : ''; if (!d) for (let k = 1; k <= me.p.degrees; k++) if (!u.has(String(k))) { d = String(k); break; }
    if (d) u.add(d); return d;
  }
  // fill in the sides and degrees of every cable end in place (after a ROADM's add/drop type or an OADM's sides change)
  function assignSides(S) {
    const used = new Map(), by = id => S.nodes.find(n => n.id === id);
    for (const l of S.links) { const A = by(l.a), B = by(l.b); if (!A || !B) continue; l.p.sa = sideFor(A, B, l.p.sa, used); l.p.sb = sideFor(B, A, l.p.sb, used); }
  }
  function sanitize(o) {
    if (!o || typeof o !== 'object' || !Array.isArray(o.nodes) || !Array.isArray(o.links)) throw new Error('not a topology');
    const fill = (def, p) => {
      const out = { ...def }; p = p && typeof p === 'object' ? p : {};
      for (const k in def) {
        const v = p[k];
        if (typeof def[k] === 'number') out[k] = Number.isFinite(+v) && v !== '' && v !== null ? +v : def[k];
        else if (typeof def[k] === 'boolean') out[k] = typeof v === 'boolean' ? v : def[k];
        else if (v !== undefined) out[k] = v;
      }
      return out;
    };
    const seen = new Set(), nodes = [];
    for (const n of o.nodes) {
      if (!n || !TYPES[n.type] || typeof n.id !== 'string' || seen.has(n.id)) continue;
      const p = fill(TYPES[n.type].def(), n.p);
      if (isEnd(n) && !PHY_.MODES[p.mode]) p.mode = TYPES[n.type].def().mode;
      if (n.type === 'mxp') {
        const cs = Array.isArray(n.p && n.p.clients) ? n.p.clients.slice(0, 8) : defaultClients();
        p.clients = cs.map(c => { c = c && typeof c === 'object' ? c : {}; return { optic: PHY_.CLIENT_OPTICS[c.optic] ? c.optic : '100g-lr4', len: Number.isFinite(+c.len) && c.len !== '' && c.len !== null && +c.len >= 0 ? +c.len : 0.1, extra: Number.isFinite(+c.extra) && c.extra !== '' && c.extra !== null && +c.extra >= 0 ? +c.extra : 1 }; });
      }
      { const raw = n.p && typeof n.p === 'object' ? n.p : {}; p.fail = raw.fail === 'dead' || raw.fail === 'degraded' ? raw.fail : ''; p.degDb = Number.isFinite(+raw.degDb) && raw.degDb !== '' && raw.degDb !== null && typeof raw.degDb !== 'boolean' ? Math.min(30, Math.max(0, +raw.degDb)) : 3; }
      if (n.type === 'roadm' || n.type === 'mux' || n.type === 'oadm') {
        const ints = (v, max) => [...new Set((Array.isArray(v) ? v : []).filter(x => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < max))].sort((a, b) => a - b).slice(0, max);
        p.badPorts = ints(n.p && n.p.badPorts, 128); p.badCards = ints(n.p && n.p.badCards, 16);
        { const dp = {}, raw = n.p && n.p.degPorts && typeof n.p.degPorts === 'object' && !Array.isArray(n.p.degPorts) ? n.p.degPorts : {}; // a degraded (not failed) port: extra loss on the one channel that uses it
          for (const k of Object.keys(raw).slice(0, 128)) { const i = Number(k), db = raw[k]; if (Number.isInteger(i) && i >= 0 && i < 128 && typeof db !== 'boolean' && Number.isFinite(+db) && +db > 0) dp[i] = Math.min(30, Math.max(0.1, +db)); } p.degPorts = dp; }
        if (n.type === 'oadm') {
          const raw = n.p || {}, legacy = Array.isArray(raw.slots) && raw.slots.length && raw.eFirst === undefined ? ints(raw.slots, 128) : null; // an older lab: one list of slots, served from both sides
          const num = (v, d, lo, hi) => (Number.isFinite(+v) && v !== '' && v !== null && typeof v !== 'boolean' ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
          p.sides = ['ew', 'e', 'w'].includes(raw.sides) ? raw.sides : 'ew';
          if (legacy && legacy.length) { p.eFirst = p.wFirst = legacy[0]; p.ePorts = p.wPorts = Math.min(64, legacy[legacy.length - 1] - legacy[0] + 1); }
          else { p.eFirst = num(raw.eFirst, 24, 0, 127); p.ePorts = num(raw.ePorts, 4, 0, 64); p.wFirst = num(raw.wFirst, 24, 0, 127); p.wPorts = num(raw.wPorts, 4, 0, 64); }
          p.osc = raw.osc === true || (raw.p1310 === true && raw.o1310 === 'osc'); p.p1310 = raw.p1310 === true && raw.o1310 !== 'osc'; p.o1310 = PHY_.CLIENT_OPTICS[raw.o1310] && PHY_.CLIENT_OPTICS[raw.o1310].nm === 1310 ? raw.o1310 : '10g-lr'; delete p.slots;
        }
      }
      if (isEnd(n)) {
        p.slot = n.p && Number.isInteger(n.p.slot) && n.p.slot >= 0 && n.p.slot < 128 ? n.p.slot : null;
        p.rxSlot = n.p && Number.isInteger(n.p.rxSlot) && n.p.rxSlot >= 0 && n.p.rxSlot < 128 ? n.p.rxSlot : null;
        p.off = Number.isFinite(+(n.p && n.p.off)) && n.p.off !== '' && n.p.off !== null && typeof n.p.off !== 'boolean' ? Math.min(10, Math.max(-10, +n.p.off)) : 0;
      }
      if (n.type === 'panel') {
        p.ports = Math.min(48, Math.max(1, Math.round(+p.ports) || 12)); p.il = Math.min(3, Math.max(0, Number.isFinite(+p.il) && p.il !== '' && p.il !== null && typeof p.il !== 'boolean' ? +p.il : 0.5));
        p.rl = Math.min(70, Math.max(20, Number.isFinite(+p.rl) && p.rl !== '' && p.rl !== null && typeof p.rl !== 'boolean' ? +p.rl : 50));
        const raw = n.p && n.p.dirty && typeof n.p.dirty === 'object' && !Array.isArray(n.p.dirty) ? n.p.dirty : {}; p.dirty = {};
        for (const k of Object.keys(raw).slice(0, 96)) { const i = +k, v = raw[k]; if (Number.isInteger(i) && i >= 1 && i <= p.ports && Number.isFinite(+v) && v !== '' && v !== null && typeof v !== 'boolean' && +v > 0) p.dirty[i] = Math.min(10, +v); } // extra loss of a dirty or damaged connector, by port number
      }
      if (n.type === 'splitter') { p.ratio = SPLIT[p.ratio] ? p.ratio : '50/50'; p.excess = Math.min(3, Math.max(0, Number.isFinite(+p.excess) && p.excess !== '' && p.excess !== null ? +p.excess : 0.3)); }
      if (n.type === 'switch') { p.il = Math.min(10, Math.max(0, Number.isFinite(+p.il) && p.il !== '' && p.il !== null ? +p.il : 1)); p.pos = p.pos === 'b' ? 'b' : 'a'; p.auto = p.auto !== false; p.revertive = p.revertive !== false; p.wtrMin = Math.min(120, Math.max(0, Number.isFinite(+p.wtrMin) && p.wtrMin !== '' && p.wtrMin !== null ? +p.wtrMin : 5)); p.switchMs = Math.min(1000, Math.max(1, Number.isFinite(+p.switchMs) && p.switchMs !== '' && p.switchMs !== null ? +p.switchMs : 20)); }
      if (n.type === 'otdr') p.pulse = OTDR_PULSES.includes(+p.pulse) ? +p.pulse : 100;
      if (n.type === 'host') { p.ip = parseIp(p.ip) ? String(p.ip).trim() : ''; p.ports = Math.min(8, Math.max(1, Math.round(+p.ports) || 1)); p.speed = HOST_SPEEDS.includes(+p.speed) ? +p.speed : 100; }
      if (n.type === 'roadm') { p.degrees = Math.min(9, Math.max(1, Math.round(+p.degrees) || 4)); p.ports = Math.min(64, Math.max(1, Math.round(+p.ports) || 16)); p.first = Math.min(63, Math.max(0, Math.round(+p.first) || 0)); }
      if (n.type === 'mux') { p.bidi = p.bidi === true; p.role = p.role === 'high' ? 'high' : 'low'; }
      if (n.type === 'oadm') { p.bidi = p.bidi === true; p.eRole = p.eRole === 'high' ? 'high' : 'low'; p.wRole = p.wRole === 'low' ? 'low' : 'high'; }
      if (n.type === 'mux') { p.ports = Math.min(64, Math.max(1, Math.round(+p.ports) || 16)); p.first = Math.min(63, Math.max(0, Math.round(+p.first) || 0)); }
      if (isEnd(n)) p.spare = ['switch', 'ycable'].includes(n.p && n.p.spare) ? n.p.spare : '';
      if (n.type === 'edfa' && p.ctl !== 'auto' && p.ctl !== 'fixed') p.ctl = 'auto';
      if (isEnd(n) && !(p.tx === null || p.tx === '' || Number.isFinite(+p.tx))) p.tx = null;
      if (n.type === 'edfa') { p.bidi = p.bidi === true; p.bidiLoss = Number.isFinite(+p.bidiLoss) && p.bidiLoss !== '' && p.bidiLoss !== null && typeof p.bidiLoss !== 'boolean' ? Math.min(6, Math.max(0, +p.bidiLoss)) : 1.2; }
      if (n.type === 'edfa') p.pinMax = Number.isFinite(+p.pinMax) && p.pinMax !== null && typeof p.pinMax !== 'boolean' ? Math.min(20, Math.max(-10, +p.pinMax)) : 10;
      if (n.type === 'edfa') for (const k of ['target', 'targetRev', 'gainRev', 'nfRev', 'gminRev', 'gmaxRev', 'pmaxRev', 'agcUs']) if (!(p[k] === '' || (p[k] !== null && typeof p[k] !== 'boolean' && Number.isFinite(+p[k])))) p[k] = '';
      if (n.type === 'dcm') for (const k of ['cdRev', 'ilRev']) if (!(p[k] === '' || (p[k] !== null && typeof p[k] !== 'boolean' && Number.isFinite(+p[k])))) p[k] = '';
      seen.add(n.id);
      nodes.push({ id: n.id, type: n.type, name: String(n.name ?? n.id), x: Number.isFinite(+n.x) ? +n.x : 0, y: Number.isFinite(+n.y) ? +n.y : 0, p });
    }
    { const ends = new Set(nodes.filter(isEnd).map(n => n.id)); for (const n of nodes) if (isEnd(n)) n.p.peer = typeof n.p.peer === 'string' && ends.has(n.p.peer) && n.p.peer !== n.id ? n.p.peer : ''; }
    { const rd = new Set(nodes.filter(n => n.type === 'roadm').map(n => n.id)); for (const n of nodes) if (isEnd(n)) { n.p.prot = n.p.prot === '1+1' ? '1+1' : n.p.prot === 'shared' ? 'shared' : ''; n.p.conv = typeof n.p.conv === 'string' && rd.has(n.p.conv) ? n.p.conv : ''; } }
    const lseen = new Set(), links = [], usedDeg = new Map();
    for (const l of o.links) {
      if (!l || typeof l.id !== 'string' || lseen.has(l.id) || !seen.has(l.a) || !seen.has(l.b) || l.a === l.b) continue;
      const kind = l.kind === 'fiber' ? 'fiber' : 'patch', p = fill(linkDefaults(kind), l.p);
      if (kind === 'fiber' && !PHY_.FIBERS[p.fiber]) p.fiber = 'smf';
      if (kind === 'patch') { const v = l.p && l.p.len; p.len = Number.isFinite(+v) && v !== '' && v !== null && typeof v !== 'boolean' && +v >= 0 ? Math.min(+v, 2000) : 3; } // metres
      p.cutAt = kind === 'fiber' && p.cutAt !== '' && p.cutAt !== null && typeof p.cutAt !== 'boolean' && Number.isFinite(+p.cutAt) && +p.cutAt >= 0 ? Math.min(+p.cutAt, 300) : '';
      { const A0 = nodes.find(n => n.id === l.a), B0 = nodes.find(n => n.id === l.b), inst = x => x && (x.type === 'meter' || x.type === 'otdr'), test = x => x && (x.type === 'panel' || x.type === 'splitter' || x.type === 'switch');
        if ((inst(A0) || inst(B0)) && !((inst(A0) && test(B0)) || (inst(B0) && test(A0)))) continue; // an instrument plugs into a patch panel, splitter or switch port and nothing else
        if ((inst(A0) || inst(B0)) && links.some(q => [q.a, q.b].some(id => id === (inst(A0) ? A0 : B0).id))) continue; }
      if (!['both', 'ab', 'ba'].includes(p.dir)) p.dir = 'both';
      p.ramanFull = p.ramanFull === true; p.single = kind === 'fiber' && p.single === true; // one fiber carrying both directions
      p.srlg = typeof p.srlg === 'string' && /^[\w-]{0,24}$/.test(p.srlg) ? p.srlg : '';
      if (kind === 'fiber') for (const k of ['extraRev', 'ramanRev']) if (!(p[k] === '' || (Number.isFinite(+p[k]) && p[k] !== null && +p[k] >= 0))) p[k] = '';
      if (kind === 'fiber') { if (!['back', 'fwd', 'both'].includes(p.ramanDir)) p.ramanDir = 'back'; p.ramanPumps = Math.min(3, Math.max(1, Math.round(+p.ramanPumps || 1))); }
      if (kind === 'fiber') p.raman = Math.min(PHY_.RAMAN.maxMw, Math.max(0, +p.raman || 0));
      if (kind === 'fiber' && !(p.nch === '' || (Number.isFinite(+p.nch) && +p.nch >= 1))) p.nch = '';
      { const A = nodes.find(n => n.id === l.a), B = nodes.find(n => n.id === l.b), dev = x => x && (x.type === 'mux' || x.type === 'oadm' || x.type === 'roadm');
        const portable = kind === 'patch' && A && B && ((isEnd(A) && dev(B)) || (isEnd(B) && dev(A))); // the port a transponder is plugged into
        p.mport = portable && l.p && Number.isInteger(l.p.mport) && l.p.mport >= 0 && l.p.mport < 64 ? l.p.mport : null;
        // a cable end on an OADM is on its east or west side (by default the side the neighbour lies on); on a ROADM it is a degree, or for a transponder cable
        // on a ROADM whose add/drop is not directionless, the degree its port belongs to
        p.sa = sideFor(A, B, l.p && l.p.sa, usedDeg); p.sb = sideFor(B, A, l.p && l.p.sb, usedDeg);
        // a client cable joins a host port to a transponder (one client port) or a muxponder client port
        const cli = kind === 'patch' && A && B && ((isEnd(A) && B.type === 'host') || (isEnd(B) && A.type === 'host')), host = cli ? (A.type === 'host' ? A : B) : null, end = cli ? (isEnd(A) ? A : B) : null;
        const idx = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : null);
        p.cport = cli ? idx(l.p && l.p.cport, end.type === 'mxp' ? end.p.clients.length : 1) : null; p.hport = cli ? idx(l.p && l.p.hport, host.p.ports) : null; }
      lseen.add(l.id);
      links.push({ id: l.id, a: l.a, b: l.b, kind, p });
    }
    const gi = o.g && typeof o.g === 'object' ? o.g : {};
    const num = (v, d) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : d);
    const g = { nch: Math.min(96, Math.max(1, Math.round(num(gi.nch, 16)))), df: [50, 75, 100, 150].includes(+gi.df) ? +gi.df : 75, launch: num(gi.launch, 0), neighbors: gi.neighbors === 'coh' ? 'coh' : 'same', reopt: gi.reopt === true, plan: null,
      tempC: Math.min(85, Math.max(-40, num(gi.tempC, 27))), // the fiber temperature: sets the spontaneous Raman noise
      eolSpan: Math.min(5, Math.max(0, num(gi.eolSpan, PHY_.EOL.spanLoss))), eolTrx: Math.min(3, Math.max(0, num(gi.eolTrx, PHY_.EOL.trxPen))),
      rampMs: Math.min(10000, Math.max(0, num(gi.rampMs, 0))), lossPct: Math.min(95, Math.max(1, num(gi.lossPct, PHY_.TRANSIENT.lossPct))), agcUs: Math.min(5000, Math.max(0, num(gi.agcUs, PHY_.TRANSIENT.agcUs))),
      cutRate: Math.min(50, Math.max(0, num(gi.cutRate, RESIL.cutRate))), mttr: Math.min(720, Math.max(0.5, num(gi.mttr, RESIL.mttr))), detectMs: Math.min(1000, Math.max(0, num(gi.detectMs, RESIL.detectMs))),
      switchMs: Math.min(10000, Math.max(0, num(gi.switchMs, RESIL.switchMs))), sharedSec: Math.min(600, Math.max(0, num(gi.sharedSec, RESIL.sharedSec))), restoreSec: Math.min(3600, Math.max(0, num(gi.restoreSec, RESIL.restoreSec))), devRate: Math.min(5, Math.max(0, num(gi.devRate, RESIL.devRate))) };
    const slots = PHY_.cBandSlots(g.df * 1e9);
    g.nch = Math.min(g.nch, slots);
    links.forEach(l => { if (l.kind === 'fiber' && l.p.nch !== '') l.p.nch = Math.min(Math.round(+l.p.nch), slots); });
    g.plan = sanitizePlan(gi.plan, g.df);
    if (g.plan) { const ok = new Set(nodes.filter(n => n.type === 'roadm' || n.type === 'oadm' || isEnd(n)).map(n => n.id)), roadms = new Set(nodes.filter(n => n.type === 'roadm').map(n => n.id)); g.plan.forEach(c => { if (!ok.has(c.from)) c.from = ''; if (!ok.has(c.to)) c.to = ''; if (c.from && c.from === c.to) c.to = ''; if (!roadms.has(c.via)) c.via = ''; if (!roadms.has(c.conv) || c.conv === c.from || c.conv === c.to) c.conv = ''; if (c.conv) c.via = ''; }); }
    const si = o.svc && typeof o.svc === 'object' ? o.svc : {};
    const svc = { a: seen.has(si.a) ? si.a : null, z: seen.has(si.z) ? si.z : null };
    // planner demands (a traffic list for the Planner tab)
    const hostIds = new Set(nodes.filter(n => n.type === 'host').map(n => n.id));
    const flows = (Array.isArray(o.flows) ? o.flows : []).slice(0, 40).map(f => (f && typeof f === 'object' && hostIds.has(f.a) && hostIds.has(f.z) && f.a !== f.z && Number.isFinite(+f.gbps) && f.gbps !== '' && f.gbps !== null && typeof f.gbps !== 'boolean' ? { a: f.a, z: f.z, gbps: Math.min(1600, Math.max(0, +f.gbps)) } : null)).filter(Boolean);
    const demands = (Array.isArray(o.demands) ? o.demands : []).slice(0, 40).map(d => (d && typeof d === 'object' && seen.has(d.a) && seen.has(d.z) && d.a !== d.z && ['roadm', 'trx', 'mxp'].includes((nodes.find(n => n.id === d.a) || {}).type) && ['roadm', 'trx', 'mxp'].includes((nodes.find(n => n.id === d.z) || {}).type)
      ? { a: d.a, z: d.z, mode: PHY_.MODES[d.mode] ? d.mode : 'zrp400', count: Math.min(96, Math.max(1, Math.round(num(d.count, 1)))), prot: d.prot === '1+1' ? '1+1' : '', target: Number.isFinite(+d.target) && d.target !== '' && d.target !== null && typeof d.target !== 'boolean' && +d.target >= 90 && +d.target < 100 ? +d.target : '' } : null)).filter(Boolean);
    return { nodes, links, g, svc, demands, flows };
  }

