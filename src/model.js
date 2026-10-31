// ===== Topology model, routing and path simulation =====
// DOM-free (like engine.js) so it can be tested in Node. Depends on the global PHY from engine.js.
const MODEL = (() => {
  const PHY_ = typeof PHY !== 'undefined' ? PHY : require('./engine.js');
  const { db, lin } = PHY_;
  const f1 = x => (isFinite(x) ? x.toFixed(1) : '—');
  const uid = p => p + Math.random().toString(36).slice(2, 7);

  const TYPES = {
    trx: { label: 'Transponder', hint: 'Coherent line card / pluggable', maxLinks: 1, def: () => ({ mode: 'zr400', tx: null }) },
    mux: { label: 'Mux / Demux', hint: 'Passive DWDM filter', maxLinks: 99, def: () => ({ il: 5 }) },
    edfa: { label: 'EDFA', hint: 'Booster, in-line or preamp', maxLinks: 2, def: () => ({ ctl: 'auto', target: '', gain: 20, nf: 5, gmin: 10, gmax: 30, pmax: 23 }) },
    roadm: { label: 'ROADM', hint: 'WSS node, any degree', maxLinks: 99, def: () => ({ wss: 6, ad: 4, amps: true, nf: 5.5 }) },
    voa: { label: 'VOA / pad', hint: 'Fixed attenuator', maxLinks: 2, def: () => ({ att: 5 }) },
  };
  const PREFIX = { trx: 'TRX', mux: 'MUX', edfa: 'AMP', roadm: 'ROADM', voa: 'VOA' };
  const linkDefaults = kind => (kind === 'fiber' ? { len: 80, fiber: 'smf', extra: 1, nch: '', cut: false } : { il: 0.5, cut: false });

  // ---------- presets ----------
  function N(type, name, x, y, p = {}) { return { id: uid('n'), type, name, x, y, p: { ...TYPES[type].def(), ...p } }; }
  function L(a, b, kind, p = {}) { return { id: uid('l'), a: a.id, b: b.id, kind, p: { ...linkDefaults(kind), ...p } }; }
  const PRESETS = {
    dci: {
      name: 'DCI: 400ZR over 80 km', build() {
        const a1 = N('trx', 'TRX-A1', 80, 120), a2 = N('trx', 'TRX-A2', 80, 220), a3 = N('trx', 'TRX-A3', 80, 320);
        const ma = N('mux', 'MUX-A', 230, 220), ba = N('edfa', 'BST-A', 370, 220, { gmin: 5 });
        const pb = N('edfa', 'PRE-B', 640, 220), mb = N('mux', 'MUX-B', 780, 220);
        const b1 = N('trx', 'TRX-B1', 930, 120), b2 = N('trx', 'TRX-B2', 930, 220), b3 = N('trx', 'TRX-B3', 930, 320);
        return { nodes: [a1, a2, a3, ma, ba, pb, mb, b1, b2, b3], links: [L(a1, ma, 'patch'), L(a2, ma, 'patch'), L(a3, ma, 'patch'), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 80 }), L(pb, mb, 'patch'), L(mb, b1, 'patch'), L(mb, b2, 'patch'), L(mb, b3, 'patch')],
          g: { nch: 16, df: 75, launch: 0 }, svc: { a: a1.id, z: b1.id } };
      }
    },
    lh: {
      name: 'Long haul: 5 spans with ILAs', build() {
        const a = N('trx', 'TRX-A', 60, 120, { mode: 'zrp400' }), ma = N('mux', 'MUX-A', 60, 250), ba = N('edfa', 'BST-A', 220, 250, { gmin: 5 });
        const i1 = N('edfa', 'ILA-1', 400, 250), i2 = N('edfa', 'ILA-2', 580, 250), i3 = N('edfa', 'ILA-3', 760, 250), i4 = N('edfa', 'ILA-4', 940, 250);
        const pb = N('edfa', 'PRE-B', 1120, 250), mb = N('mux', 'MUX-B', 1260, 250), z = N('trx', 'TRX-Z', 1260, 120, { mode: 'zrp400' });
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
    dark: {
      name: 'Dark fiber: unamplified ZR', build() {
        const a = N('trx', 'TRX-A', 150, 220), z = N('trx', 'TRX-Z', 800, 220);
        return { nodes: [a, z], links: [L(a, z, 'fiber', { len: 25, extra: 1.5 })], g: { nch: 1, df: 75, launch: 0 }, svc: { a: a.id, z: z.id } };
      }
    },
  };

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
      if (n.type === 'trx' && !PHY_.MODES[p.mode]) p.mode = 'zr400';
      if (n.type === 'edfa' && p.ctl !== 'auto' && p.ctl !== 'fixed') p.ctl = 'auto';
      if (n.type === 'trx' && !(p.tx === null || p.tx === '' || Number.isFinite(+p.tx))) p.tx = null;
      if (n.type === 'edfa' && !(p.target === '' || p.target === null || Number.isFinite(+p.target))) p.target = '';
      seen.add(n.id);
      nodes.push({ id: n.id, type: n.type, name: String(n.name ?? n.id), x: Number.isFinite(+n.x) ? +n.x : 0, y: Number.isFinite(+n.y) ? +n.y : 0, p });
    }
    const lseen = new Set(), links = [];
    for (const l of o.links) {
      if (!l || typeof l.id !== 'string' || lseen.has(l.id) || !seen.has(l.a) || !seen.has(l.b) || l.a === l.b) continue;
      const kind = l.kind === 'fiber' ? 'fiber' : 'patch', p = fill(linkDefaults(kind), l.p);
      if (kind === 'fiber' && !PHY_.FIBERS[p.fiber]) p.fiber = 'smf';
      if (kind === 'fiber' && !(p.nch === '' || (Number.isFinite(+p.nch) && +p.nch >= 1))) p.nch = '';
      lseen.add(l.id);
      links.push({ id: l.id, a: l.a, b: l.b, kind, p });
    }
    const gi = o.g && typeof o.g === 'object' ? o.g : {};
    const num = (v, d) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : d);
    const g = { nch: Math.min(96, Math.max(1, Math.round(num(gi.nch, 16)))), df: [50, 75, 100, 150].includes(+gi.df) ? +gi.df : 75, launch: num(gi.launch, 0) };
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
      if (u !== aId && node(u).type === 'trx') continue;
      for (const l of linksOf(u)) {
        if (l.p.cut && !allowCut) continue;
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

  function simulate(S, launchOverride) {
    const { node, link, linkName } = mkGraph(S);
    const g = { ...S.g }; if (launchOverride != null) g.launch = launchOverride;
    const A = node(S.svc.a), Z = node(S.svc.z);
    if (!A || !Z || A.type !== 'trx' || Z.type !== 'trx' || A === Z) return { status: 'none', headline: 'Pick two transponders as the A and Z ends of a service.' };
    const mode = PHY_.MODES[A.p.mode];
    let path = route(S, A.id, Z.id, false), rerouteCut = false;
    if (!path) { path = route(S, A.id, Z.id, true); rerouteCut = true; }
    if (!path) return { status: 'nopath', headline: `No physical path from ${A.name} to ${Z.name}. Cable them together.` };

    const nchLine = Math.max(1, +g.nch), df = +g.df * 1e9, Rs = mode.Rs;
    const txDbm = A.p.tx === '' || A.p.tx == null ? mode.tx : +A.p.tx;
    let P = lin(txDbm) / 1000, Pase = P / lin(mode.txOsnr), Pnli = 0, cd = 0, dgd2 = 0, km = 0, passes = 0, nch = 1, maxNch = 1;
    const hops = [], alarms = [];
    const snap = () => ({ sig: db(P * 1000), ase: db(Pase * 1000), nli: Pnli > 0 ? db(Pnli * 1000 * PHY_.BREF / Rs) : -99 });
    const osnrNow = () => db(P / Pase);
    const gosnrNow = () => db(1 / (Pase / P + (Pnli / P) * Rs / PHY_.BREF));
    function rec(name, kind, before, extra = {}) {
      hops.push({ name, kind, in: before, out: snap(), km, nch, osnr: osnrNow(), gosnr: gosnrNow(), ...extra });
    }
    const loss = d => { const f = lin(-d); P *= f; Pase *= f; Pnli *= f; };
    function amp(name, nf, ctl, target, gFixed, gmin, gmax, pmax) {
      const before = snap(), pin = before.sig;
      let G = ctl === 'auto' ? target - pin : +gFixed, note = '';
      if (G < gmin) { note = `Needs ${f1(G)} dB but min gain is ${gmin} dB: output runs hot`; G = gmin; }
      if (G > gmax) { note = `Needs ${f1(G)} dB but max gain is ${gmax} dB: output runs low`; G = gmax; }
      const tot = pin + G + db(nch);
      if (tot > pmax) { G -= tot - pmax; note = `Hit total output limit ${pmax} dBm (${nch} ch): per-channel power capped`; }
      const nfe = PHY_.ampNfEff(+nf, G);
      P *= lin(G); Pnli *= lin(G);
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
        Pnli += PHY_.etaNLI(fb, Lk, Rs, nch, df) * P ** 3;
        const sl = fb.att * Lk + +l.p.extra;
        loss(sl); cd += fb.D * Lk; dgd2 += fb.pmd ** 2 * Lk; km += Lk;
        rec(`${Lk} km ${fb.name.split(' ')[0]}`, 'span', b, { gain: -sl, len: Lk, launch: b.sig });
      }
      if (i + 1 === path.links.length) break;
      const t = nxt.type, nnext = node(path.nodes[i + 2]);
      const target = nxt.p.target === '' || nxt.p.target == null ? +g.launch : +nxt.p.target;
      if (t === 'mux') {
        const joins = prv.type === 'trx', drops = nnext.type === 'trx';
        const b = snap(); loss(+nxt.p.il);
        if (joins) nch = nchLine;
        if (drops) nch = 1;
        rec(nxt.name, 'mux', b, { gain: -nxt.p.il, note: joins ? 'mux: channel joins the line' : drops ? 'demux: channel dropped' : '' });
      } else if (t === 'voa') { const b = snap(); loss(+nxt.p.att); rec(nxt.name, 'voa', b, { gain: -nxt.p.att }); }
      else if (t === 'edfa') { amp(nxt.name, nxt.p.nf, nxt.p.ctl, target, nxt.p.gain, +nxt.p.gmin, +nxt.p.gmax, +nxt.p.pmax); }
      else if (t === 'roadm') {
        const add = prv.type === 'trx' || prv.type === 'mux', drop = nnext.type === 'trx' || nnext.type === 'mux';
        const p = nxt.p, np = add || drop ? 1 : 2;
        if (add) nch = nchLine;
        if (p.amps && !add) amp(nxt.name + ' pre', p.nf, 'auto', +g.launch + (drop ? 4 : 0), 0, 0, 35, 24);
        const b = snap(); const lo = np * +p.wss + (add || drop ? +p.ad : 0); loss(lo); passes += np;
        rec(nxt.name + (add ? ' add' : drop ? ' drop' : ' express'), 'roadm', b, { gain: -lo, note: `${np} WSS pass${np > 1 ? 'es' : ''}` });
        if (p.amps && !drop) amp(nxt.name + ' boost', p.nf + 0.5, 'auto', +g.launch, 0, 0, 35, 24);
        if (drop) nch = 1;
      }
      // a transponder in the middle of a path is never traversed (route() forbids it)
    }

    const res = { mode, modeKey: A.p.mode, A, Z, path, hops, alarms, km, cd, dgd: Math.sqrt(dgd2), passes, g, rerouteCut, txDbm };
    if (losAt) { res.status = 'los'; res.headline = `LOS at ${Z.name}: fiber cut on ${linkName(losAt)}.`; res.prx = -Infinity; return res; }
    const prx = db(P * 1000); res.prx = prx;
    if (prx < mode.rxMin - 12) {
      res.status = 'los'; res.headline = `LOS at ${Z.name}: ${f1(prx)} dBm is below what the receiver can detect.`;
      alarms.unshift({ sev: 'bad', text: `Rx power ${f1(prx)} dBm is far below the ${f1(mode.rxMin)} dBm sensitivity.` });
      return res;
    }
    const snrAse = (P / Pase) * PHY_.BREF / Rs, snrNli = Pnli > 0 ? P / Pnli : Infinity;
    const snrRx = lin(prx - mode.rxMin + 25), snrTrx = lin(mode.snrTrx);
    const line = 1 / (1 / snrAse + 1 / snrNli + 1 / snrRx);
    const filt = passes * PHY_.filterPenaltyPerPass(Rs, df);
    const over = Math.max(0, prx - mode.rxMax) * 1.5;
    const pmdPen = (res.dgd / mode.dgdTol) ** 2;
    const eff = PHY_.effSnr(mode, line, filt + over + pmdPen);
    const ber = PHY_.MODS[mode.mod].ber(eff);
    Object.assign(res, {
      osnr: db(P / Pase), gosnr: db(1 / (1 / snrAse + 1 / snrNli) * Rs / PHY_.BREF), snrAse, snrNli, snrRx, snrTrx, effDb: db(eff),
      ber, q: PHY_.qFromBer(ber), qThr: PHY_.qFromBer(mode.berThr), filt, over, pmdPen, req: reqOsnr(A.p.mode),
      budget: { ase: 1 / snrAse, nli: 1 / snrNli, trx: 1 / snrTrx, rx: 1 / snrRx },
    });
    res.qMargin = res.q - res.qThr; res.osnrMargin = res.gosnr - res.req;
    // alarms & status
    const bad = [];
    if (Z.p.mode !== A.p.mode) bad.push(`Mode mismatch: ${A.name} is ${mode.short}, ${Z.name} is ${PHY_.MODES[Z.p.mode].short}. The ends will never lock.`);
    if (Math.abs(cd) > mode.cdTol) bad.push(`Chromatic dispersion ${Math.round(cd)} ps/nm exceeds the ${mode.short} DSP range of ${mode.cdTol} ps/nm.`);
    if (ber > mode.berThr) bad.push(`Pre-FEC BER ${ber.toExponential(2)} is above the ${mode.fec} limit ${mode.berThr.toExponential(2)}: uncorrectable errors, link down.`);
    bad.forEach(t => alarms.unshift({ sev: 'bad', text: t }));
    if (prx < mode.rxMin) alarms.push({ sev: 'warn', text: `Rx power ${f1(prx)} dBm is below the ${mode.rxMin} dBm sensitivity spec (Rx LOW alarm). Receiver noise is now eating SNR.` });
    if (prx > mode.rxMax) alarms.push({ sev: prx > mode.rxMax + 5 ? 'bad' : 'warn', text: `Rx power ${f1(prx)} dBm is above the ${mode.rxMax} dBm overload point (Rx HIGH alarm). Add a pad.` });
    if (res.dgd > mode.dgdTol * 0.7) alarms.push({ sev: 'warn', text: `Mean DGD ${f1(res.dgd)} ps is close to or over the ${mode.dgdTol} ps PMD tolerance.` });
    const slots = PHY_.cBandSlots(df);
    if (Math.max(maxNch, nchLine) > slots) alarms.push({ sev: 'warn', text: `${Math.max(maxNch, nchLine)} channels do not fit the C-band on a ${g.df} GHz grid (${slots} slots). Reduce channels or use a finer grid.` });
    if (Rs > df) alarms.push({ sev: 'warn', text: `${mode.short} occupies ~${Math.round(Rs / 1e9 * 1.1)} GHz but the grid slot is ${g.df} GHz. Filters clip it and neighbours overlap.` });
    if (rerouteCut) alarms.push({ sev: 'warn', text: 'Every path crosses a cut fiber.' });
    if (bad.length) { res.status = 'down'; res.headline = bad[0]; }
    else if (res.qMargin < 1 || alarms.some(a => a.sev !== 'info')) { res.status = 'degraded'; res.headline = res.qMargin < 1 ? `Up, but only ${f1(res.qMargin)} dB of Q margin. Aging or a dirty connector will take it down.` : 'Up, with alarms to look at.'; }
    else { res.status = 'up'; res.headline = `Up with ${f1(res.qMargin)} dB Q margin.`; }
    return res;
  }

  return { TYPES, PREFIX, PRESETS, uid, linkDefaults, sanitize, mkGraph, route, simulate, reqOsnr };
})();
if (typeof module !== 'undefined') module.exports = MODEL;
