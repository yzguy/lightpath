// ===== Topology model, routing and path simulation =====
// DOM-free (like engine.js) so it can be tested in Node. Depends on the global PHY from engine.js.
const MODEL = (() => {
  const PHY_ = typeof PHY !== 'undefined' ? PHY : require('./engine.js');
  const { db, lin } = PHY_;
  const f1 = x => (isFinite(x) ? x.toFixed(1) : '—');
  const uid = p => p + Math.random().toString(36).slice(2, 7);

  const TYPES = {
    trx: { label: 'Transponder', hint: 'Coherent pluggable, or a 10G DWDM SFP+', maxLinks: 1, def: () => ({ mode: 'zr400', tx: null }) },
    mxp: { label: 'Muxponder', hint: 'Client ports into one coherent line port', maxLinks: 1, def: () => ({ mode: 'zrp400', tx: null, clients: defaultClients() }) },
    mux: { label: 'Mux / Demux', hint: 'Passive DWDM filter', maxLinks: 99, def: () => ({ il: 5 }) },
    edfa: { label: 'EDFA', hint: 'Booster, in-line or preamp', maxLinks: 2, def: () => ({ ctl: 'auto', target: '', targetRev: '', gain: 20, gainRev: '', nf: 5, nfRev: '', gmin: 10, gminRev: '', gmax: 30, gmaxRev: '', pmax: 23, pmaxRev: '', tiltCtl: true }) },
    roadm: { label: 'ROADM', hint: 'WSS node, any degree', maxLinks: 99, def: () => ({ wss: 6, ad: 4, amps: true, nf: 5.5 }) },
    dcm: { label: 'Dispersion comp.', hint: 'DCF module or FBG, cancels CD', maxLinks: 2, def: () => ({ cd: -1360, cdRev: '', il: 7, ilRev: '' }) },
    voa: { label: 'VOA / pad', hint: 'Fixed attenuator', maxLinks: 2, def: () => ({ att: 5 }) },
  };
  const defaultClients = () => Array.from({ length: 4 }, () => newClient());
  const newClient = (optic = '100g-lr4') => ({ optic, len: 0.1, extra: 1 });
  const isEnd = n => !!n && (n.type === 'trx' || n.type === 'mxp'); // service end: a coherent line port that light never passes through
  const PREFIX = { dcm: 'DCM', mxp: 'MXP', trx: 'TRX', mux: 'MUX', edfa: 'AMP', roadm: 'ROADM', voa: 'VOA' };
  const linkDefaults = kind => (kind === 'fiber' ? { len: 80, fiber: 'smf', extra: 1, extraRev: '', nch: '', raman: 0, ramanRev: '', ramanDir: 'back', ramanPumps: 1, dir: 'both', cut: false } : { il: 0.5, dir: 'both', cut: false });

  // ---------- presets ----------
  function N(type, name, x, y, p = {}) { return { id: uid('n'), type, name, x, y, p: { ...TYPES[type].def(), ...p } }; }
  function L(a, b, kind, p = {}) { return { id: uid('l'), a: a.id, b: b.id, kind, p: { ...linkDefaults(kind), ...p } }; }
  const PRESETS = {
    dci: {
      name: 'DCI: 400ZR over 80 km', build() {
        const a1 = N('trx', 'TRX-A1', 80, 120), a2 = N('trx', 'TRX-A2', 80, 220), a3 = N('trx', 'TRX-A3', 80, 320);
        const ma = N('mux', 'MUX-A', 230, 220), ba = N('edfa', 'BST-A', 370, 220, { gmin: 5 });
        const pb = N('edfa', 'PRE-B', 640, 220, { gmin: 5 }), mb = N('mux', 'MUX-B', 780, 220);
        const b1 = N('trx', 'TRX-B1', 930, 120), b2 = N('trx', 'TRX-B2', 930, 220), b3 = N('trx', 'TRX-B3', 930, 320);
        return { nodes: [a1, a2, a3, ma, ba, pb, mb, b1, b2, b3], links: [L(a1, ma, 'patch'), L(a2, ma, 'patch'), L(a3, ma, 'patch'), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 80 }), L(pb, mb, 'patch'), L(mb, b1, 'patch'), L(mb, b2, 'patch'), L(mb, b3, 'patch')],
          g: { nch: 16, df: 75, launch: 0 }, svc: { a: a1.id, z: b1.id } };
      }
    },
    lh: {
      name: 'Long haul: 5 spans with ILAs', build() {
        const a = N('trx', 'TRX-A', 60, 120, { mode: 'zrp400' }), ma = N('mux', 'MUX-A', 60, 250), ba = N('edfa', 'BST-A', 220, 250, { gmin: 5 });
        const i1 = N('edfa', 'ILA-1', 400, 250), i2 = N('edfa', 'ILA-2', 580, 250), i3 = N('edfa', 'ILA-3', 760, 250), i4 = N('edfa', 'ILA-4', 940, 250);
        const pb = N('edfa', 'PRE-B', 1120, 250, { gmin: 5 }), mb = N('mux', 'MUX-B', 1260, 250), z = N('trx', 'TRX-Z', 1260, 120, { mode: 'zrp400' });
        return { nodes: [a, ma, ba, i1, i2, i3, i4, pb, mb, z], links: [L(a, ma, 'patch'), L(ma, ba, 'patch'), L(ba, i1, 'fiber', { len: 80 }), L(i1, i2, 'fiber', { len: 95 }), L(i2, i3, 'fiber', { len: 80 }), L(i3, i4, 'fiber', { len: 100 }), L(i4, pb, 'fiber', { len: 85 }), L(pb, mb, 'patch'), L(mb, z, 'patch')],
          g: { nch: 64, df: 75, launch: 1 }, svc: { a: a.id, z: z.id } };
      }
    },
    ring: {
      name: 'ROADM triangle with restoration', build() {
        const ra = N('roadm', 'ROADM-A', 200, 300), rb = N('roadm', 'ROADM-B', 520, 110), rc = N('roadm', 'ROADM-C', 840, 300);
        const ta = N('trx', 'TRX-A', 200, 440, { mode: 'zrp400' }), tc = N('trx', 'TRX-C', 840, 440, { mode: 'zrp400' }), tb = N('trx', 'TRX-B', 520, 0, { mode: 'zrp400' });
        return { nodes: [ra, rb, rc, ta, tb, tc], links: [L(ra, rc, 'fiber', { len: 70 }), L(ra, rb, 'fiber', { len: 100 }), L(rb, rc, 'fiber', { len: 110 }), L(ta, ra, 'patch'), L(tc, rc, 'patch'), L(tb, rb, 'patch')],
          g: { nch: 48, df: 75, launch: 0 }, svc: { a: ta.id, z: tc.id } };
      }
    },
    mxp: {
      name: 'Muxponder: 4x100G over 400G ZR+', build() {
        const a = N('mxp', 'MXP-A', 80, 220), ma = N('mux', 'MUX-A', 260, 220), ba = N('edfa', 'BST-A', 400, 220, { gmin: 5 });
        const pb = N('edfa', 'PRE-B', 670, 220, { gmin: 5 }), mb = N('mux', 'MUX-B', 810, 220), z = N('mxp', 'MXP-B', 960, 220);
        return { nodes: [a, ma, ba, pb, mb, z], links: [L(a, ma, 'patch'), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 80 }), L(pb, mb, 'patch'), L(mb, z, 'patch')],
          g: { nch: 16, df: 75, launch: 0 }, svc: { a: a.id, z: z.id } };
      }
    },
    sfp10: {
      name: 'Switch 10G DWDM optics over 60 km', build() {
        const a1 = N('trx', 'SW-A1', 80, 150, { mode: 'dwdm10' }), a2 = N('trx', 'SW-A2', 80, 290, { mode: 'dwdm10' });
        const ma = N('mux', 'MUX-A', 240, 220), ba = N('edfa', 'BST-A', 380, 220, { gmin: 3, targetRev: -4 });
        const pb = N('edfa', 'PRE-B', 650, 220, { target: -4, targetRev: 0, gmin: 0 }), mb = N('mux', 'MUX-B', 790, 220);
        const b1 = N('trx', 'SW-B1', 940, 150, { mode: 'dwdm10' }), b2 = N('trx', 'SW-B2', 940, 290, { mode: 'dwdm10' });
        return { nodes: [a1, a2, ma, ba, pb, mb, b1, b2], links: [L(a1, ma, 'patch'), L(a2, ma, 'patch'), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 60 }), L(pb, mb, 'patch'), L(mb, b1, 'patch'), L(mb, b2, 'patch')],
          g: { nch: 8, df: 100, launch: 0 }, svc: { a: a1.id, z: b1.id } };
      }
    },
    sfp10dcm: {
      name: 'Switch 10G over 120 km with a DCM', build() {
        const a1 = N('trx', 'SW-A1', 80, 220, { mode: 'dwdm10f' }), ma = N('mux', 'MUX-A', 230, 220), ba = N('edfa', 'BST-A', 370, 220, { gmin: 3, targetRev: -4 });
        const pb = N('edfa', 'PRE-B', 640, 220, { target: 2, targetRev: 0, gmin: 0 }), dc = N('dcm', 'DCM-B', 780, 220, { cd: -1360, il: 7 }), mb = N('mux', 'MUX-B', 920, 220), b1 = N('trx', 'SW-B1', 1060, 220, { mode: 'dwdm10f' });
        return { nodes: [a1, ma, ba, pb, dc, mb, b1], links: [L(a1, ma, 'patch'), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 120 }), L(pb, dc, 'patch'), L(dc, mb, 'patch'), L(mb, b1, 'patch')],
          g: { nch: 8, df: 100, launch: 0 }, svc: { a: a1.id, z: b1.id } };
      }
    },
    mix: {
      name: 'Mixed line: 10G beside 400G', build() {
        const a = N('trx', 'SW-A', 80, 220, { mode: 'dwdm10f' }), ma = N('mux', 'MUX-A', 230, 220), ba = N('edfa', 'BST-A', 370, 220, { gmin: 3, targetRev: -3 });
        const pb = N('edfa', 'PRE-B', 640, 220, { target: -3, gmin: 0, targetRev: 0 }), mb = N('mux', 'MUX-B', 790, 220), z = N('trx', 'SW-B', 940, 220, { mode: 'dwdm10f' });
        const plan = [];
        for (let s = 24; s < 40; s++) plan.push({ slot: s, mode: s === 30 || s === 32 ? 'dwdm10f' : 'zrp400', off: s === 30 || s === 32 ? -3 : 0, svc: s === 31 });
        plan[7].mode = 'dwdm10f'; plan[7].off = -3; // slot 31 is the service: the 10G channel in the middle
        return { nodes: [a, ma, ba, pb, mb, z], links: [L(a, ma, 'patch'), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 60 }), L(pb, mb, 'patch'), L(mb, z, 'patch')],
          g: { nch: plan.length, df: 75, launch: 0, plan }, svc: { a: a.id, z: z.id } };
      }
    },
    dark: {
      name: 'Dark fiber: unamplified ZR', build() {
        const a = N('trx', 'TRX-A', 150, 220), z = N('trx', 'TRX-Z', 800, 220);
        return { nodes: [a, z], links: [L(a, z, 'fiber', { len: 25, extra: 1.5 })], g: { nch: 1, df: 75, launch: 0 }, svc: { a: a.id, z: z.id } };
      }
    },
  };

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

  // ---------- channel plan ----------
  // g.plan = null (identical channels, g.nch of them) or [{ slot, mode, off (dB vs the service), svc }]. Slots index the C-band grid.
  function sanitizePlan(p, df) {
    if (!Array.isArray(p) || !p.length) return null;
    const slots = PHY_.cBandSlots(df * 1e9), seen = new Set(), out = [];
    for (const c of p) {
      if (!c || typeof c !== 'object') continue;
      const slot = Math.round(+c.slot);
      if (!Number.isFinite(slot) || slot < 0 || slot >= slots || seen.has(slot)) continue;
      seen.add(slot);
      out.push({ slot, mode: PHY_.MODES[c.mode] ? c.mode : 'zrp400', off: Math.min(10, Math.max(-10, Number.isFinite(+c.off) && c.off !== '' && c.off !== null ? +c.off : 0)), svc: !!c.svc });
      if (out.length >= 96) break;
    }
    if (!out.length) return null;
    out.sort((a, b) => a.slot - b.slot);
    const first = out.findIndex(c => c.svc);
    out.forEach((c, i) => { c.svc = i === (first >= 0 ? first : Math.floor(out.length / 2)); });
    return out;
  }
  // Turn the uniform line into an editable plan: the same block of channels, service in the middle.
  function planFromUniform(g, svcMode) {
    const df = +g.df * 1e9, ch = buildChans(g, svcMode, false, PHY_.cBandSlots(df), df);
    return ch.map(c => ({ slot: c.slot, mode: c.mode, off: 0, svc: c.svc }));
  }
  // The same plan on a different grid: each channel keeps its frequency, collisions drop.
  function remapPlan(plan, oldDf, newDf) {
    if (!plan) return plan;
    const slots = PHY_.cBandSlots(newDf * 1e9), seen = new Set(), out = [];
    for (const c of plan) { const s = Math.floor((c.slot + 0.5) * oldDf / newDf); if (s >= slots || seen.has(s)) continue; seen.add(s); out.push({ ...c, slot: s }); }
    return sanitizePlan(out, newDf);
  }

  // ---------- validation ----------
  // Takes untrusted topology JSON (localStorage or pasted import) and returns a clean {nodes, links, g, svc}.
  // Unknown device types and links to missing devices are dropped; missing or non-numeric parameters get defaults.
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
      if (n.type === 'edfa' && p.ctl !== 'auto' && p.ctl !== 'fixed') p.ctl = 'auto';
      if (isEnd(n) && !(p.tx === null || p.tx === '' || Number.isFinite(+p.tx))) p.tx = null;
      if (n.type === 'edfa') for (const k of ['target', 'targetRev', 'gainRev', 'nfRev', 'gminRev', 'gmaxRev', 'pmaxRev']) if (!(p[k] === '' || (p[k] !== null && typeof p[k] !== 'boolean' && Number.isFinite(+p[k])))) p[k] = '';
      if (n.type === 'dcm') for (const k of ['cdRev', 'ilRev']) if (!(p[k] === '' || (p[k] !== null && typeof p[k] !== 'boolean' && Number.isFinite(+p[k])))) p[k] = '';
      seen.add(n.id);
      nodes.push({ id: n.id, type: n.type, name: String(n.name ?? n.id), x: Number.isFinite(+n.x) ? +n.x : 0, y: Number.isFinite(+n.y) ? +n.y : 0, p });
    }
    const lseen = new Set(), links = [];
    for (const l of o.links) {
      if (!l || typeof l.id !== 'string' || lseen.has(l.id) || !seen.has(l.a) || !seen.has(l.b) || l.a === l.b) continue;
      const kind = l.kind === 'fiber' ? 'fiber' : 'patch', p = fill(linkDefaults(kind), l.p);
      if (kind === 'fiber' && !PHY_.FIBERS[p.fiber]) p.fiber = 'smf';
      if (!['both', 'ab', 'ba'].includes(p.dir)) p.dir = 'both';
      if (kind === 'fiber') for (const k of ['extraRev', 'ramanRev']) if (!(p[k] === '' || (Number.isFinite(+p[k]) && p[k] !== null && +p[k] >= 0))) p[k] = '';
      if (kind === 'fiber') { if (!['back', 'fwd', 'both'].includes(p.ramanDir)) p.ramanDir = 'back'; p.ramanPumps = Math.min(3, Math.max(1, Math.round(+p.ramanPumps || 1))); }
      if (kind === 'fiber') p.raman = Math.min(PHY_.RAMAN.maxMw, Math.max(0, +p.raman || 0));
      if (kind === 'fiber' && !(p.nch === '' || (Number.isFinite(+p.nch) && +p.nch >= 1))) p.nch = '';
      lseen.add(l.id);
      links.push({ id: l.id, a: l.a, b: l.b, kind, p });
    }
    const gi = o.g && typeof o.g === 'object' ? o.g : {};
    const num = (v, d) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : d);
    const g = { nch: Math.min(96, Math.max(1, Math.round(num(gi.nch, 16)))), df: [50, 75, 100, 150].includes(+gi.df) ? +gi.df : 75, launch: num(gi.launch, 0), neighbors: gi.neighbors === 'coh' ? 'coh' : 'same', plan: null,
      eolSpan: Math.min(5, Math.max(0, num(gi.eolSpan, PHY_.EOL.spanLoss))), eolTrx: Math.min(3, Math.max(0, num(gi.eolTrx, PHY_.EOL.trxPen))) };
    g.plan = sanitizePlan(gi.plan, g.df);
    const si = o.svc && typeof o.svc === 'object' ? o.svc : {};
    const svc = { a: seen.has(si.a) ? si.a : null, z: seen.has(si.z) ? si.z : null };
    return { nodes, links, g, svc };
  }

  // ---------- graph helpers ----------
  const mkGraph = S => {
    const node = id => S.nodes.find(n => n.id === id);
    const link = id => S.links.find(l => l.id === id);
    const linksOf = id => S.links.filter(l => l.a === id || l.b === id);
    const other = (l, id) => (l.a === id ? l.b : l.a);
    const linkName = l => { const a = node(l.a), b = node(l.b); return `${a ? a.name : '?'}–${b ? b.name : '?'}`; };
    return { node, link, linksOf, other, linkName };
  };

  // Shortest path (km) from A to Z. Light never passes *through* a transponder. Cut fibers are only used if allowCut.
  function route(S, aId, zId, allowCut) {
    const { node, linksOf, other } = mkGraph(S);
    const dist = { [aId]: 0 }, prev = {}, done = new Set();
    while (true) {
      let u = null, best = Infinity;
      for (const k in dist) if (!done.has(k) && dist[k] < best) { best = dist[k]; u = k; }
      if (u == null) return null;
      if (u === zId) break;
      done.add(u);
      if (u !== aId && isEnd(node(u))) continue;
      for (const l of linksOf(u)) {
        if (l.p.cut && !allowCut) continue;
        if ((l.p.dir === 'ab' && l.a !== u) || (l.p.dir === 'ba' && l.b !== u)) continue; // one-way fiber: light only travels the carried way
        const v = other(l, u);
        const w = (l.kind === 'fiber' ? +l.p.len : 0.01) + 0.01 + (l.p.cut ? 1e6 : 0);
        if (dist[v] == null || dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = { u, l: l.id }; }
      }
    }
    const nodes = [zId], links = [];
    let c = zId;
    while (c !== aId) { links.unshift(prev[c].l); c = prev[c].u; nodes.unshift(c); }
    return { nodes, links };
  }

  // ---------- simulation ----------
  const reqCache = {};
  const reqOsnr = k => (reqCache[k] ??= PHY_.requiredOsnr(PHY_.MODES[k]));

  // Channel table for a service. Plan mode: the stored plan, with the service channel forced to the service's own mode.
  // Otherwise: g.nch identical channels in a contiguous block centred in the C-band, service in the middle.
  function buildChans(g, svcKey, planOn, slotsN, df) {
    let list;
    if (planOn) {
      list = g.plan.map(c => ({ slot: +c.slot, mode: c.svc ? svcKey : c.mode, off: Number.isFinite(+c.off) ? +c.off : 0, svc: !!c.svc }));
      if (!list.some(c => c.svc)) list[Math.floor(list.length / 2)].svc = true;
    } else {
      const n = Math.max(1, Math.round(+g.nch)), start = Math.floor(Math.max(0, slotsN - n) / 2), mid = Math.floor(n / 2);
      list = Array.from({ length: n }, (_, i) => ({ slot: start + i, mode: svcKey, off: 0, svc: i === mid }));
    }
    return list.map((c, i) => { const m = PHY_.MODES[c.mode] || PHY_.MODES[svcKey], fTHz = PHY_.slotFreqTHz(c.slot, df); return { ...c, idx: i, m, mode: PHY_.MODES[c.mode] ? c.mode : svcKey, Rs: m.Rs, fTHz, f: fTHz * 1e12 }; });
  }
  // Tilt costs the channel that loses power: those in the upper half of the lit band, up to half the (mean) tilt at the top edge.
  function tiltPenaltyFor(chans, i, edgeTilt) {
    const sl = chans.map(c => c.slot), lo = Math.min(...sl), hi = Math.max(...sl);
    const u = hi > lo ? (chans[i].slot - lo) / (hi - lo) : 0.5;
    return Math.max(0, 2 * u - 1) * edgeTilt / 2;
  }

  // opts.eol: evaluate with end-of-life allowances (see PHY.EOL). The normal result carries the EoL outcome in res.eol.
  // opts.reverse: simulate Z -> A. Per-direction overrides (extraRev, ramanRev, targetRev, gainRev) apply; blank means "same as forward".
  // The forward result carries the reverse one in res.rev and its status is the worse of the two. opts.single skips the reverse run.
  const STATUS_RANK = { up: 0, degraded: 1, down: 2, nopath: 2, los: 3 };
  function simulate(S, launchOverride, opts = {}) {
    const eol = !!opts.eol, rv = !!opts.reverse;
    const pd = (p, k) => (rv && p[k + 'Rev'] !== '' && p[k + 'Rev'] != null && Number.isFinite(+p[k + 'Rev']) ? p[k + 'Rev'] : p[k]);
    const { node, link, linkName } = mkGraph(S);
    const g = { ...S.g }; if (launchOverride != null) g.launch = launchOverride;
    const A = node(rv ? S.svc.z : S.svc.a), Z = node(rv ? S.svc.a : S.svc.z);
    if (!isEnd(A) || !isEnd(Z) || A === Z) return { status: 'none', headline: 'Pick two transponders or muxponders as the A and Z ends of a service.' };
    const mode = PHY_.MODES[A.p.mode];
    let path = route(S, A.id, Z.id, false), rerouteCut = false;
    if (!path) { path = route(S, A.id, Z.id, true); rerouteCut = true; }
    if (!path) return { status: 'nopath', headline: `No physical path from ${A.name} to ${Z.name}. Cable them together.` };

    const eolSpan = Number.isFinite(+g.eolSpan) && g.eolSpan !== '' && g.eolSpan != null ? +g.eolSpan : PHY_.EOL.spanLoss;
    const eolTrx = Number.isFinite(+g.eolTrx) && g.eolTrx !== '' && g.eolTrx != null ? +g.eolTrx : PHY_.EOL.trxPen;
    // Channel table: the custom plan if there is one, else a contiguous block of identical channels centred in the band.
    const df = +g.df * 1e9, planOn = Array.isArray(g.plan) && g.plan.length > 0, slotsN = PHY_.cBandSlots(df);
    const chans = buildChans(g, A.p.mode, planOn, slotsN, df);
    if (planOn) g.nch = chans.length;
    const svcIdx = Math.max(0, chans.findIndex(c => c.svc)), nChan = chans.length;
    const nchLine = Math.max(1, +g.nch), Rs = mode.Rs;
    const reachHz = PHY_.XPM.reachGHz * 1e9, nbWeight = c => (planOn ? (c.m.coh === false ? PHY_.XPM.same : PHY_.XPM.coh) : (g.neighbors === 'coh' ? PHY_.XPM.coh : PHY_.XPM.same));
    const xpmW = chans.map((ci, i) => (ci.m.coh === false ? chans.reduce((a, cj, j) => a + (j !== i && Math.abs(cj.f - ci.f) <= reachHz ? nbWeight(cj) * lin(cj.off - ci.off) : 0), 0) : 0));
    const ev = []; // event log replayed per channel after the loop (plan mode only)
    const txDbm = A.p.tx === '' || A.p.tx == null ? mode.tx : +A.p.tx;
    let mpi = 0, xpmPen = 0, P = lin(txDbm) / 1000, Pase = P / lin(mode.txOsnr), Pnli = 0, cd = 0, dgd2 = 0, km = 0, passes = 0, nch = 1, maxNch = 1, tilt = 0;
    const tiltSeen = []; // tilt (dB, low- minus high-frequency channel) at every amplifier input and at the receiver
    const hops = [], alarms = [];
    const snap = () => ({ sig: db(P * 1000), ase: db(Pase * 1000), nli: Pnli > 0 ? db(Pnli * 1000 * PHY_.BREF / Rs) : -99 });
    const osnrNow = () => db(P / Pase);
    const gosnrNow = () => db(1 / (Pase / P + (Pnli / P) * Rs / PHY_.BREF));
    function rec(name, kind, before, extra = {}) {
      hops.push({ name, kind, in: before, out: snap(), km, nch, tilt, osnr: osnrNow(), gosnr: gosnrNow(), ...extra });
    }
    const loss = d => { const f = lin(-d); P *= f; Pase *= f; Pnli *= f; if (planOn) ev.push({ k: 'L', f }); };
    function amp(name, nf, ctl, target, gFixed, gmin, gmax, pmax, tiltCtl) {
      const before = snap(), pin = before.sig;
      let G = ctl === 'auto' ? target - pin : +gFixed, note = '';
      if (G < gmin) { note = `Needs ${f1(G)} dB but min gain is ${gmin} dB: output runs hot`; G = gmin; }
      if (G > gmax) { note = `Needs ${f1(G)} dB but max gain is ${gmax} dB: output runs low`; G = gmax; }
      const tot = pin + G + db(nch);
      if (tot > pmax) { G -= tot - pmax; note = `Hit total output limit ${pmax} dBm (${nch} ch): per-channel power capped`; }
      const nfe = PHY_.ampNfEff(+nf, G);
      P *= lin(G); Pnli *= lin(G);
      tiltSeen.push(tilt);
      if (planOn) { ev.push({ k: 'A', G: lin(G), nfe }); if (tiltCtl) ev.push({ k: 'Z' }); }
      if (tiltCtl) tilt = 0; // gain-tilt control re-flattens the band at the amp output
      Pase = Pase * lin(G) + lin(nfe) * PHY_.H * PHY_.NU * lin(G) * PHY_.BREF;
      rec(name, 'amp', before, { gain: G, nf: nfe, note });
      if (note) alarms.push({ sev: 'warn', text: `${name}: ${note}.` });
    }

    rec(A.name, 'tx', snap(), { note: `Tx ${f1(txDbm)} dBm, Tx OSNR ${mode.txOsnr} dB` });
    let losAt = null;
    for (let i = 0; i < path.links.length; i++) {
      const l = link(path.links[i]), nxt = node(path.nodes[i + 1]), prv = node(path.nodes[i]);
      if (l.p.cut) { losAt = l; hops.push({ name: linkName(l), kind: 'cut', in: snap(), out: { sig: -99, ase: -99, nli: -99 }, km, nch, note: 'Fiber cut' }); break; }
      if (l.kind === 'patch') { const b = snap(); loss(+l.p.il); rec('patch', 'patch', b, { gain: -l.p.il }); }
      else {
        const fb = PHY_.FIBERS[l.p.fiber], Lk = +l.p.len, b = snap();
        // Per-span loading: from this fiber onward (until a mux or ROADM changes it) only this many channels are lit.
        if (l.p.nch !== '' && l.p.nch != null) nch = Math.min(96, Math.max(1, Math.round(+l.p.nch)));
        maxNch = Math.max(maxNch, nch);
        const sl = fb.att * Lk + +pd(l.p, 'extra') + (eol ? eolSpan : 0);
        const pump = Math.min(PHY_.RAMAN.maxMw, Math.max(0, +pd(l.p, 'raman') || 0));
        const rdir = ['back', 'fwd', 'both'].includes(l.p.ramanDir) ? l.p.ramanDir : 'back', npump = Math.min(3, Math.max(1, Math.round(+l.p.ramanPumps || 1)));
        const pb = rdir === 'fwd' ? 0 : rdir === 'both' ? pump / 2 : pump, pf = rdir === 'back' ? 0 : rdir === 'both' ? pump / 2 : pump;
        const sigW = nch * P; // total signal power entering the span; the backward pump sees the signal after the span loss
        const sb = PHY_.ramanGainSat(fb, Lk, pb, sigW, sl), sf = PHY_.ramanGainSat(fb, Lk, pf, sigW, sl);
        const gb = sb.gain, gf = sf.gain, gr = gb + gf, depl = Math.max(sb.depletion, sf.depletion);
        // Raman lifts the power profile along the span, so the fiber looks less lossy to the nonlinearity (more so when pumped forward).
        const fbNl = gr > 0 ? { ...fb, att: Math.max(0.05, (fb.att * Lk - gr) / Lk) } : fb;
        const full = nch === nChan, fwdF = PHY_.ramanFwdNliFactor(gf);
        // Plan mode: this channel's nonlinear noise depends on who its neighbours are (baud rate, power, distance).
        const nF = planOn && full ? PHY_.nliPlanFactor(fbNl, chans.map(c => ({ f: c.f, Rs: c.Rs, P: lin(c.off) })), svcIdx, df, nChan) : 1;
        const nNew = PHY_.etaNLI(fbNl, Lk, Rs, nch, df) * P ** 3 * fwdF * nF;
        if (mode.coh === false && nch > 1) { // cross-phase modulation from the other channels hits a direct-detection receiver
          xpmPen = Math.min(PHY_.XPM.cap, xpmPen + PHY_.xpmSpanPenalty(fbNl, Lk, 1, P, xpmW[svcIdx]));
        }
        const rho = PHY_.nliCorrelation(cd);
        Pnli += nNew + 2 * rho * Math.sqrt(Pnli * nNew); // coherent cross term when the dispersion map is flat
        // Raman gain spectrum: channels at different frequencies see different gain, relative to the service channel.
        const rel = gr > 0 && full ? chans.map(c => PHY_.ramanRel(npump, c.fTHz, chans[svcIdx].fTHz)) : null;
        const ripplePP = rel ? gr * (Math.max(...rel) - Math.min(...rel)) : 0;
        if (planOn) ev.push({ k: 'S', fbNl, Lk, nch, full, fwdF, rho, cd, P, xpm: nch > 1 });
        if (gr > 0) mpi += PHY_.drsRatio(gr, fb, Lk);
        tilt += PHY_.srsTilt(fb, Lk, P, nch, df) + ripplePP;
        if (gr > 0) {
          // Equivalent lumped amplifiers. Backward pump: gain late in the span (noiseFrac * gain dB of loss still ahead of the signal),
          // so most of the span loss is paid before the noise enters. Forward pump: gain early, noisier (pump RIN) and no OSNR benefit.
          let c = 0;
          const stage = (pos, gain, nf) => { loss(pos - c); c = pos; P *= lin(gain); Pnli *= lin(gain); Pase = Pase * lin(gain) + lin(nf) * PHY_.H * PHY_.NU * lin(gain) * PHY_.BREF; if (planOn) ev.push({ k: 'R', gain, nf, rel }); };
          if (gf > 0) stage(Math.min(sl, PHY_.RAMAN.fwdPreLoss), gf, PHY_.RAMAN.fwdNf);
          if (gb > 0) stage(Math.max(c, sl - PHY_.RAMAN.noiseFrac * gb), gb, PHY_.RAMAN.nf);
          loss(sl - c);
        } else loss(sl);
        cd += fb.D * Lk; dgd2 += fb.pmd ** 2 * Lk; km += Lk;
        rec(`${Lk} km ${fb.name.split(' ')[0]}`, 'span', b, { gain: gr - sl, len: Lk, launch: b.sig, ...(gr > 0 ? { raman: gr, note: `Raman ${rdir === 'both' ? 'bidirectional' : rdir === 'fwd' ? 'forward' : 'backward'} pump ${pump} mW (${npump}): +${gr.toFixed(1)} dB on-off gain` + (depl > 0.05 ? `, pump depletion cost ${(sb.g0 + sf.g0 - gr).toFixed(1)} dB` : '') } : {}) });
        if (depl > 0.15 && !eol && !rv) alarms.push({ sev: 'info', text: `${linkName(l)}: signal power is depleting the Raman pump (${Math.round(depl * 100)}% of its photons): about ${f1(sb.g0 + sf.g0 - gr)} dB of gain lost. Add pump power or reduce channels.` });
        if (pump > PHY_.RAMAN.warnMw) alarms.push({ sev: 'warn', text: `${linkName(l)}: ${pump} mW Raman pump is a Class 4 laser. Check connector cleanliness (fiber-fuse risk) and eye safety.` });
        if (gr > 0 && !eol && !rv && +l.p.raman > PHY_.RAMAN.maxMw) alarms.push({ sev: 'info', text: `${linkName(l)}: pump limited to ${PHY_.RAMAN.maxMw} mW.` });
      }
      if (i + 1 === path.links.length) break;
      const t = nxt.type, nnext = node(path.nodes[i + 2]);
      const tv = pd(nxt.p, 'target'), target = tv === '' || tv == null ? +g.launch : +tv;
      if (t === 'mux') {
        const joins = isEnd(prv), drops = isEnd(nnext);
        const b = snap(); loss(+nxt.p.il);
        if (joins) nch = nchLine;
        if (drops) nch = 1;
        rec(nxt.name, 'mux', b, { gain: -nxt.p.il, note: joins ? 'mux: channel joins the line' : drops ? 'demux: channel dropped' : '' });
      } else if (t === 'dcm') { const b = snap(); const dil = +pd(nxt.p, 'il'), dcd = +pd(nxt.p, 'cd'); loss(dil); cd += dcd; dgd2 += 1; rec(nxt.name, 'dcm', b, { gain: -dil, note: `${dcd} ps/nm` }); }
      else if (t === 'voa') { const b = snap(); loss(+nxt.p.att); rec(nxt.name, 'voa', b, { gain: -nxt.p.att }); }
      else if (t === 'edfa') { amp(nxt.name, pd(nxt.p, 'nf'), nxt.p.ctl, target, pd(nxt.p, 'gain'), +pd(nxt.p, 'gmin'), +pd(nxt.p, 'gmax'), +pd(nxt.p, 'pmax'), nxt.p.tiltCtl !== false); }
      else if (t === 'roadm') {
        const add = isEnd(prv) || prv.type === 'mux', drop = isEnd(nnext) || nnext.type === 'mux';
        const p = nxt.p, np = add || drop ? 1 : 2;
        if (add) nch = nchLine;
        if (p.amps && !add) amp(nxt.name + ' pre', p.nf, 'auto', +g.launch + (drop ? 4 : 0), 0, 0, 35, 24, true);
        const b = snap(); const lo = np * +p.wss + (add || drop ? +p.ad : 0); loss(lo); passes += np; tiltSeen.push(tilt); tilt = 0; if (planOn) ev.push({ k: 'Z' }); // the WSS equalises every channel
        rec(nxt.name + (add ? ' add' : drop ? ' drop' : ' express'), 'roadm', b, { gain: -lo, note: `${np} WSS pass${np > 1 ? 'es' : ''}` });
        if (p.amps && !drop) amp(nxt.name + ' boost', p.nf + 0.5, 'auto', +g.launch, 0, 0, 35, 24, true);
        if (drop) nch = 1;
      }
      // a transponder in the middle of a path is never traversed (route() forbids it)
    }

    const res = { mode, modeKey: A.p.mode, A, Z, path, hops, alarms, km, cd, dgd: Math.sqrt(dgd2), passes, g, rerouteCut, txDbm };
    // Muxponder client ports: per-port optical budget plus rate aggregation into the line port.
    const clientFatal = [];
    res.clients = [];
    if (!eol && !rv) {
      for (const n of [A, Z].filter(x => x.type === 'mxp')) {
        const lm = PHY_.MODES[n.p.mode], ports = n.p.clients.map((c, i) => ({ idx: i + 1, ...c, ...PHY_.clientBudget(c) }));
        const total = ports.reduce((a, p) => a + p.optic.rate, 0);
        res.clients.push({ node: n, ports, total, lineRate: lm.rate });
        if (!ports.length) alarms.push({ sev: 'warn', text: `${n.name} has no client ports configured.` });
        if (total > lm.rate) clientFatal.push(`${n.name}: client ports add up to ${total}G, more than the ${lm.short} line port can carry (${lm.rate}G).`);
        else if (ports.length && total < lm.rate) alarms.push({ sev: 'info', text: `${n.name}: clients fill ${total}G of the ${lm.rate}G line (${Math.round(100 * total / lm.rate)}%).` });
        if (n.p.mode === 'zr400' && ports.length && (ports.length > 1 || total !== 400)) alarms.push({ sev: 'warn', text: `${n.name}: 400ZR carries a single 400GbE client. Use an OpenZR+ or OTN line mode to multiplex sub-rate clients.` });
        for (const p of ports) {
          if (p.status === 'ok') continue;
          alarms.push({ sev: p.status === 'down' ? 'bad' : 'warn', text: `${n.name} client ${p.idx} (${p.optic.name}): ${p.notes.join('; ')}.` });
        }
      }
      if (res.clients.length === 2 && res.clients[0].total !== res.clients[1].total) alarms.push({ sev: 'warn', text: `Client rates differ between the ends: ${A.name} carries ${res.clients[0].total}G, ${Z.name} carries ${res.clients[1].total}G.` });
    }
    if (losAt) { res.status = 'los'; res.headline = `LOS at ${Z.name}: fiber cut on ${linkName(losAt)}.`; res.prx = -Infinity; return res; }
    const prx = db(P * 1000); res.prx = prx;
    if (prx < mode.rxMin - 12) {
      res.status = 'los'; res.headline = `LOS at ${Z.name}: ${f1(prx)} dBm is below what the receiver can detect.`;
      alarms.unshift({ sev: 'bad', text: `Rx power ${f1(prx)} dBm is far below the ${f1(mode.rxMin)} dBm sensitivity.` });
      return res;
    }
    const snrAse = (P / Pase) * PHY_.BREF / Rs, snrNli = Pnli > 0 ? P / Pnli : Infinity;
    const snrRx = lin(prx - mode.rxMin + 25), snrTrx = lin(mode.snrTrx);
    const line = 1 / (1 / snrAse + 1 / snrNli + 1 / snrRx + mpi);
    const filt = passes * PHY_.filterPenaltyPerPass(Rs, df);
    const over = Math.max(0, prx - mode.rxMax) * 1.5;
    const pmdPen = (res.dgd / mode.dgdTol) ** 2;
    tiltSeen.push(tilt);
    const peakTilt = Math.max(...tiltSeen), edgeTilt = tiltSeen.reduce((a, b) => a + b, 0) / tiltSeen.length;
    const agePen = eol ? eolTrx : 0, cdPen = PHY_.cdPenalty(mode, cd), tiltPos = planOn ? tiltPenaltyFor(chans, svcIdx, edgeTilt) : 0, basePen = filt + over + pmdPen + cdPen + xpmPen + tiltPos + agePen;
    const eff = PHY_.effSnr(mode, line, basePen);
    const ber = PHY_.MODS[mode.mod].ber(eff);
    // The service channel sits mid-band. The highest-frequency channel gives up half the SRS tilt to the lowest, so it is the worst one.
    const effEdge = PHY_.effSnr(mode, line, basePen + edgeTilt / 2), berEdge = PHY_.MODS[mode.mod].ber(effEdge);
    Object.assign(res, {
      osnr: db(P / Pase), gosnr: db(1 / (1 / snrAse + 1 / snrNli + mpi) * Rs / PHY_.BREF), snrAse, snrNli, snrRx, snrTrx, effDb: db(eff),
      ber, q: PHY_.qFromBer(ber), qThr: PHY_.qFromBer(mode.berThr), filt, over, pmdPen, cdPen, xpmPen, req: reqOsnr(A.p.mode),
      budget: { ase: 1 / snrAse, nli: 1 / snrNli, trx: 1 / snrTrx, rx: 1 / snrRx, mpi },
    });
    res.qMargin = res.q - res.qThr; res.osnrMargin = res.gosnr - res.req;
    res.tilt = peakTilt; res.worstQMargin = PHY_.qFromBer(berEdge) - res.qThr;
    // Plan mode: replay the event log for every channel with its own mode, baud rate, power offset, frequency and neighbours.
    if (planOn && !eol) {
      const N = nChan, hnb = PHY_.H * PHY_.NU * PHY_.BREF, P0 = lin(txDbm) / 1000;
      const Pc = chans.map(c => P0 * lin(c.off)), Pa = chans.map((c, i) => Pc[i] / lin(c.m.txOsnr)), Pn = new Array(N).fill(0), xp = new Array(N).fill(0);
      let sP = P0;
      for (const e of ev) {
        if (e.k === 'L') { sP *= e.f; for (let i = 0; i < N; i++) { Pc[i] *= e.f; Pa[i] *= e.f; Pn[i] *= e.f; } }
        else if (e.k === 'A') { sP *= e.G; for (let i = 0; i < N; i++) { Pc[i] *= e.G; Pn[i] *= e.G; Pa[i] = Pa[i] * e.G + lin(e.nfe) * hnb * e.G; } }
        else if (e.k === 'R') { sP *= lin(e.gain); for (let i = 0; i < N; i++) { const gi = lin(e.gain * (e.rel ? e.rel[i] : 1)); Pc[i] *= gi; Pn[i] *= gi; Pa[i] = Pa[i] * gi + lin(e.nf) * hnb * gi; } }
        else if (e.k === 'Z') { for (let i = 0; i < N; i++) { const c = sP * lin(chans[i].off) / Pc[i]; Pc[i] *= c; Pn[i] *= c; Pa[i] *= c; } }
        else if (e.k === 'S') {
          const pl = e.full ? chans.map((c, j) => ({ f: c.f, Rs: c.Rs, P: lin(c.off) })) : null;
          for (let i = 0; i < N; i++) {
            if (!e.full && i !== svcIdx) continue;
            const nNew = PHY_.etaNLI(e.fbNl, e.Lk, chans[i].Rs, e.nch, df) * Pc[i] ** 3 * e.fwdF * (e.full ? PHY_.nliPlanFactor(e.fbNl, pl, i, df, N) : 1);
            Pn[i] += nNew + 2 * e.rho * Math.sqrt(Pn[i] * nNew);
            if (chans[i].m.coh === false && e.xpm) xp[i] = Math.min(PHY_.XPM.cap, xp[i] + PHY_.xpmSpanPenalty(e.fbNl, e.Lk, 1, Pc[i], xpmW[i]));
          }
        }
      }
      res.channels = chans.map((c, i) => {
        const m = c.m, prx = db(Pc[i] * 1000), snrA = (Pc[i] / Pa[i]) * PHY_.BREF / m.Rs, snrN = Pn[i] > 0 ? Pc[i] / Pn[i] : Infinity, snrR = lin(prx - m.rxMin + 25);
        const ln = 1 / (1 / snrA + 1 / snrN + 1 / snrR + mpi);
        const pen = passes * PHY_.filterPenaltyPerPass(m.Rs, df) + Math.max(0, prx - m.rxMax) * 1.5 + (res.dgd / m.dgdTol) ** 2 + PHY_.cdPenalty(m, cd) + xp[i] + tiltPenaltyFor(chans, i, edgeTilt) + agePen;
        const bER = PHY_.MODS[m.mod].ber(PHY_.effSnr(m, ln, pen)), q = PHY_.qFromBer(bER), qThr = PHY_.qFromBer(m.berThr), qm = q - qThr;
        const notes = [];
        let status = 'up';
        if (prx < m.rxMin - 12) { status = 'los'; notes.push('Rx power far below the receiver sensitivity'); }
        else if (Math.abs(cd) > m.cdTol) { status = 'down'; notes.push(`dispersion ${Math.round(cd)} ps/nm is past the ${m.cdTol} ps/nm tolerance`); }
        else if (bER > m.berThr) { status = 'down'; notes.push('pre-FEC BER above the FEC limit'); }
        else if (qm < 1 || prx < m.rxMin || prx > m.rxMax) { status = 'degraded'; notes.push(qm < 1 ? `only ${f1(qm)} dB of Q margin` : prx < m.rxMin ? 'Rx below the sensitivity spec' : 'Rx above the overload point'); }
        if (xp[i] > 1.5) notes.push(`XPM costs ${f1(xp[i])} dB`);
        return { idx: i, slot: c.slot, fTHz: c.fTHz, modeKey: c.mode, short: m.short, rate: m.rate, svc: c.svc, off: c.off, prx, osnr: db(Pc[i] / Pa[i]), gosnr: db(1 / (1 / snrA + 1 / snrN + mpi) * m.Rs / PHY_.BREF), ber: bER, q, qMargin: qm, xpmPen: xp[i], status, notes };
      });
      res.sP = sP; res.Pend = Pc[svcIdx];
      const failing = res.channels.filter(c => !c.svc && (c.status === 'down' || c.status === 'los'));
      if (failing.length) alarms.push({ sev: 'warn', text: `${failing.length} other channel${failing.length > 1 ? 's' : ''} failing: ${failing.slice(0, 3).map(c => `slot ${c.slot + 1} (${c.short}): ${c.notes[0]}`).join('; ')}${failing.length > 3 ? '…' : ''}.` });
    }
    if (!eol) { const e = simulate(S, launchOverride, { eol: true, reverse: rv }); res.eol = { qMargin: e.qMargin ?? -Infinity, worstQMargin: e.worstQMargin ?? -Infinity, status: e.status }; }
    // alarms & status
    const bad = [];
    if (Z.p.mode !== A.p.mode) bad.push(`Mode mismatch: ${A.name} is ${mode.short}, ${Z.name} is ${PHY_.MODES[Z.p.mode].short}. The ends will never lock.`);
    if (Math.abs(cd) > mode.cdTol) bad.push(`Chromatic dispersion ${Math.round(cd)} ps/nm exceeds the ${mode.short} ${mode.coh === false ? 'dispersion tolerance' : 'DSP range'} of ${mode.cdTol} ps/nm.`);
    if (ber > mode.berThr) bad.push(`Pre-FEC BER ${ber.toExponential(2)} is above the ${mode.fec} limit ${mode.berThr.toExponential(2)}: uncorrectable errors, link down.`);
    bad.push(...clientFatal);
    bad.forEach(t => alarms.unshift({ sev: 'bad', text: t }));
    if (prx < mode.rxMin) alarms.push({ sev: 'warn', text: `Rx power ${f1(prx)} dBm is below the ${mode.rxMin} dBm sensitivity spec (Rx LOW alarm). Receiver noise is now eating SNR.` });
    if (prx > mode.rxMax) alarms.push({ sev: prx > mode.rxMax + 5 ? 'bad' : 'warn', text: `Rx power ${f1(prx)} dBm is above the ${mode.rxMax} dBm overload point (Rx HIGH alarm). Add a pad.` });
    if (res.dgd > mode.dgdTol * 0.7) alarms.push({ sev: 'warn', text: `Mean DGD ${f1(res.dgd)} ps is close to or over the ${mode.dgdTol} ps PMD tolerance.` });
    const slots = PHY_.cBandSlots(df);
    if (Math.max(maxNch, nchLine) > slots) alarms.push({ sev: 'warn', text: `${Math.max(maxNch, nchLine)} channels do not fit the C-band on a ${g.df} GHz grid (${slots} slots). Reduce channels or use a finer grid.` });
    if (Rs > df) alarms.push({ sev: 'warn', text: `${mode.short} occupies ~${Math.round(Rs / 1e9 * 1.1)} GHz but the grid slot is ${g.df} GHz. Filters clip it and neighbours overlap.` });
    if (!eol && res.qMargin >= 0 && res.eol.qMargin < 0) alarms.push({ sev: 'warn', text: `Works today but fails at end of life: Q margin falls to ${f1(res.eol.qMargin)} dB with ${eolSpan} dB of extra loss per span and ${eolTrx} dB of transceiver ageing.` });
    if (res.qMargin >= 0 && res.worstQMargin < 0) alarms.push({ sev: 'warn', text: `SRS tilt of up to ${f1(peakTilt)} dB leaves the highest-frequency channel with ${f1(res.worstQMargin)} dB of Q margin while the middle channel still passes. Turn on amplifier tilt control or add a ROADM to re-equalise.` });
    if (xpmPen > 1.5) alarms.push({ sev: 'warn', text: `Cross-phase modulation from neighbouring channels costs ${f1(xpmPen)} dB. Lower the launch power, space the ${mode.short} channels apart or move them away from the ${g.neighbors === 'coh' ? 'coherent ' : ''}neighbours.` });
    if (rerouteCut) alarms.push({ sev: 'warn', text: 'Every path crosses a cut fiber.' });
    if (bad.length) { res.status = 'down'; res.headline = bad[0]; }
    else if (res.qMargin < 1 || alarms.some(a => a.sev !== 'info')) { res.status = 'degraded'; res.headline = res.qMargin < 1 ? `Up, but only ${f1(res.qMargin)} dB of Q margin. Aging or a dirty connector will take it down.` : 'Up, with alarms to look at.'; }
    else { res.status = 'up'; res.headline = `Up with ${f1(res.qMargin)} dB Q margin.`; }
    if (!eol && !rv && !opts.single) {
      const r2 = simulate(S, launchOverride, { reverse: true });
      res.rev = r2;
      if (r2.status === 'nopath') { res.status = 'down'; res.headline = `${Z.name} to ${A.name}: no path for the return direction. A one-way fiber may be missing its pair.`; }
      else if (r2.mode) {
        const seen = new Set(res.alarms.map(a => a.text));
        r2.alarms.filter(a => a.sev !== 'info' && !seen.has(a.text)).forEach(a => res.alarms.push({ ...a, text: `${Z.name} to ${A.name}: ${a.text}` }));
        if ((STATUS_RANK[r2.status] ?? 0) > (STATUS_RANK[res.status] ?? 0)) { res.status = r2.status; res.headline = `${Z.name} to ${A.name}: ${r2.headline}`; }
        else if (res.status === 'up' && r2.status === 'degraded') { res.status = 'degraded'; res.headline = `${Z.name} to ${A.name}: ${r2.headline}`; }
      }
    }
    res.reverse = rv;
    return res;
  }

  return { TYPES, PREFIX, PRESETS, isEnd, newClient, uid, linkDefaults, sanitize, sanitizePlan, planFromUniform, remapPlan, fromSpans, mkGraph, route, simulate, reqOsnr };
})();
if (typeof module !== 'undefined') module.exports = MODEL;
