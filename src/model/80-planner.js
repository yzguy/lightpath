  // ---------- demand-driven planner ----------
  // Candidate routes between two nodes: the shortest, then the shortest through each other ROADM (the same routes a plan entry's `via` gives).
  function candidateRoutes(S, a, z, K = 6) {
    const { link } = mkGraph(S), out = [], seen = new Set(), km = r => r.links.reduce((t, id) => t + (link(id).kind === 'fiber' ? +link(id).p.len : 0), 0);
    const add = (r, via) => { if (!r) return; const key = r.links.join('|'); if (seen.has(key) || new Set(r.nodes).size !== r.nodes.length || new Set(r.links).size !== r.links.length) return; seen.add(key); out.push({ ...r, via, km: km(r) }); };
    add(route(S, a, z, false), '');
    for (const n of S.nodes) if (n.type === 'roadm' && n.id !== a && n.id !== z) { const r1 = route(S, a, n.id, false), r2 = route(S, n.id, z, false); if (r1 && r2) add({ nodes: [...r1.nodes, ...r2.nodes.slice(1)], links: [...r1.links, ...r2.links] }, n.id); }
    return out.sort((p, q) => p.km - q.km).slice(0, K);
  }
  // A quick physical-layer estimate for planning: one amplifier per span at the global launch power, the nonlinear noise of the channels already
  // on each fiber, ROADM filtering and dispersion. The Channels tab gives the full simulation once the plan is applied.
  // o is the channel's own launch offset (dB) and pw2 the sum of lin(2 x offset) of the channels on each fiber (the cross terms go with the neighbours' power
  // squared); `counted` says the channel is already in `loads`. Self and cross terms are weighted 1/n and (n-1)/n, so with no offsets it is the plain estimate.
  function estimateRoute(S, r, mode, loads, df, o = 0, pw2 = null, counted = false) {
    const { link, node } = mkGraph(S), Rs = mode.Rs, P0 = lin(+S.g.launch || 0) / 1000, P = P0 * lin(o);
    let ase = 0, nli = 0, cd = 0, passes = 0;
    for (const id of r.links) {
      const l = link(id); if (l.kind !== 'fiber') continue;
      const fb = PHY_.FIBERS[l.p.fiber], L = +l.p.len, sl = fb.att * L + +l.p.extra, k = loads.get(id) || 0, n = Math.max(1, counted ? k : k + 1), ones = n - 1;
      const avg = !pw2 || !ones ? 1 : Math.max(0, (pw2.get(id) || 0) - (counted ? lin(2 * o) : 0)) / ones;
      ase += lin(PHY_.ampNfEff(5.5, sl)) * PHY_.H * PHY_.NU * lin(sl) * PHY_.BREF; nli += PHY_.etaNLI(fb, L, Rs, n, df) * P * (P * P / n + P0 * P0 * avg * ones / n); cd += fb.D * L;
    }
    r.nodes.forEach((id, i) => { if ((node(id) || {}).type === 'roadm') passes += i === 0 || i === r.nodes.length - 1 ? 1 : 2; });
    const line = 1 / (ase / P * Rs / PHY_.BREF + (nli > 0 ? nli / P : 0)), eff = PHY_.effSnr(mode, line, passes * PHY_.filterPenaltyPerPass(Rs, df) + PHY_.cdPenalty(mode, cd));
    return { margin: PHY_.qFromBer(PHY_.MODS[mode.mod].ber(eff)) - PHY_.qFromBer(mode.berThr), cd };
  }
  // Allocate demands one by one: the first candidate route (shortest first) whose estimated margin clears opts.minMargin and that has a slot free on
  // every fiber (first fit). The service occupies its route and slot first. Returns plan entries for the placed demands and the statistics.
  function planDemands(S, demands, opts = {}) {
    useGrid(S);
    const g = S.g, df = +g.df * 1e9, slotsN = PHY_.cBandSlots(df), minM = opts.minMargin ?? 1, K = opts.K ?? 6, cache = opts.cache || new Map();
    const { node, link } = mkGraph(S), used = Array.from({ length: slotsN }, () => new Set()), loads = new Map();
    const pw2 = new Map(), placedList = []; // pw2: per fiber, the sum of lin(2 x launch offset) of what is on it; placedList: the routes and offsets already given out
    const take = (slot, links, o = 0) => links.forEach(id => { used[slot].add(id); loads.set(id, (loads.get(id) || 0) + 1); pw2.set(id, (pw2.get(id) || 0) + lin(2 * o)); });
    const OFFS = [0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5, 3, -3];
    const sp = S.svc && node(S.svc.a) && node(S.svc.z) ? route(S, S.svc.a, S.svc.z, false) || route(S, S.svc.a, S.svc.z, true) : null;
    const svcEntry = Array.isArray(g.plan) ? g.plan.find(c => c.svc) : null, svcSlot = svcEntry ? +svcEntry.slot : Math.floor(slotsN / 2);
    if (sp) take(svcSlot, sp.links);
    if (sp && svcEntry && PHY_.MODES[svcEntry.mode]) placedList.push({ r: sp, mode: PHY_.MODES[svcEntry.mode], o: 0 });
    const list = []; demands.forEach(d => { for (let i = 0; i < d.count && list.length < 96; i++) list.push(d); });
    const rank = d => { const c = cands(d); return c.length ? c[0].km : 0; };
    function cands(d) { const key = d.a + '>' + d.z; if (!cache.has(key)) cache.set(key, candidateRoutes(S, d.a, d.z, K)); return cache.get(key); }
    if (opts.order === 'longest') list.sort((p, q) => rank(q) - rank(p));
    // The smallest launch offset (dB) at which every given route clears the margin and no channel already on a shared fiber falls below it (its own
    // offset stays; the new channel adds load and cross-channel noise). Offset 0 is the plain estimate.
    function withOffset(routes, mode) {
      const ok0 = (e) => Math.abs(e.cd) <= mode.cdTol && e.margin >= minM;
      for (const o of opts.launch ? [0, ...OFFS] : [0]) {
        const ests = routes.map(r => estimateRoute(S, r, mode, loads, df, o, pw2)); if (!ests.every(ok0)) continue;
        if (o !== 0) {
          const loads2 = new Map(loads), pw22 = new Map(pw2), ids = new Set(); for (const r of routes) for (const id of r.links) { ids.add(id); loads2.set(id, (loads2.get(id) || 0) + 1); pw22.set(id, (pw22.get(id) || 0) + lin(2 * o)); }
          if (!placedList.every(p => !p.r.links.some(id => ids.has(id)) || ok0(estimateRoute(S, p.r, p.mode, loads2, df, p.o, pw22, true)))) continue;
        }
        return { o, ests };
      }
      return null;
    }
    // availability of one routed demand from the Resilience model (it depends on the route and its protection, not on slots)
    const availCache = new Map();
    const availOf = (d, prot, via, convAt) => {
      const key = [d.a, d.z, prot, via || '', convAt || ''].join('|');
      if (!availCache.has(key)) {
        const ent = { slot: 0, mode: d.mode, off: 0, svc: false, from: d.a, to: d.z, via: via || '', conv: convAt || '', slot2: 1, prot: prot || '' };
        let a = null; try { const r = resilience({ ...S, g: { ...S.g, plan: [ent] } })[0]; a = r && r.kind !== 'no route' ? r.availability : null; } catch (e) { a = null; }
        availCache.set(key, a);
      }
      return availCache.get(key);
    };
    const results = [], entries = [];
    for (const d of list) {
      const mode = PHY_.MODES[d.mode] || PHY_.MODES.zrp400, cs = cands(d), tgt = d.target ? +d.target / 100 : 0;
      // a target availability decides the protection: unprotected if the route already meets it (restoration counts), 1+1 if not
      let wantProt = d.prot === '1+1', auto = false;
      if (!wantProt && tgt && cs.length) { const a0 = availOf(d, '', cs[0].via); if (a0 != null && a0 < tgt) { wantProt = true; auto = true; } }
      const out = { a: d.a, z: d.z, mode: d.mode, prot: wantProt, target: tgt ? +d.target : undefined, autoProt: auto || undefined };
      if (!cs.length) { results.push({ ...out, status: 'no route' }); continue; }
      const ok = e => Math.abs(e.cd) <= mode.cdTol && e.margin >= minM, freeOn = links => used.findIndex(u => links.every(id => !u.has(id)));
      const nm = id => (node(id) || {}).name;
      let reach = false, placed = null, fallback = null, why = '';
      for (const r of cs) {
        const w1 = withOffset([r], mode); if (!w1) continue; // out of reach, even with a launch offset when that is allowed
        reach = true;
        if (!wantProt) {
          const slot = freeOn(r.links);
          if (slot >= 0) { placed = { slot, r, est: w1.ests[0], links: r.links, o: w1.o }; break; }
          continue;
        }
        // 1+1: a fiber-disjoint second route lit with the same copy in the same slot, both routes loading their fibers
        const pp = plannedPair(S, d.a, d.z, r.via);
        if (!pp.P0) { const s = freeOn(r.links); if (s >= 0 && !fallback) fallback = { slot: s, r, est: w1.ests[0], o: w1.o }; why = 'no fiber-disjoint route'; continue; }
        const P = { ...pp.P0, km: pp.P0.links.reduce((t, id) => t + (link(id).kind === 'fiber' ? +link(id).p.len : 0), 0) }, w2 = withOffset([r, P], mode);
        if (!w2) { why = 'protection route out of reach'; continue; }
        const links = [...new Set([...r.links, ...P.links])], slot = freeOn(links);
        if (slot >= 0) { placed = { slot, r, est: w2.ests[0], links, P, pe: w2.ests[1], o: w2.o }; break; }
      }
      let conv = null;
      if (!placed && !fallback && opts.converters && !wantProt) { // a converter at a ROADM on the way gives each half its own slot (wavelength continuity no longer ties them), each half judged on its own
        for (const r of cs) {
          for (let i = 1; i < r.nodes.length - 1 && !conv; i++) {
            if ((node(r.nodes[i]) || {}).type !== 'roadm') continue;
            const h1 = { nodes: r.nodes.slice(0, i + 1), links: r.links.slice(0, i) }, h2 = { nodes: r.nodes.slice(i), links: r.links.slice(i) }, e1 = estimateRoute(S, h1, mode, loads, df), e2 = estimateRoute(S, h2, mode, loads, df);
            if (!ok(e1) || !ok(e2)) continue;
            const s1 = freeOn(h1.links), s2 = freeOn(h2.links);
            if (s1 >= 0 && s2 >= 0) conv = { s1, s2, at: r.nodes[i], r, h1, h2, margin: Math.min(e1.margin, e2.margin) };
          }
          if (conv) break;
        }
      }
      const route = r => r.nodes.map(nm);
      if (placed) {
        take(placed.slot, placed.links, placed.o); placedList.push({ r: placed.r, mode, o: placed.o }); if (placed.P) placedList.push({ r: placed.P, mode, o: placed.o });
        entries.push({ slot: placed.slot, mode: d.mode, off: placed.o, svc: false, from: d.a, to: d.z, via: placed.r.via, conv: '', slot2: placed.slot, prot: wantProt ? '1+1' : '' });
        results.push({ ...out, status: 'placed', launchOff: placed.o || undefined, slot: placed.slot, km: placed.r.km, hops: placed.r.nodes.length - 1, margin: placed.P ? Math.min(placed.est.margin, placed.pe.margin) : placed.est.margin, via: placed.r.via, detour: placed.r !== cs[0], route: route(placed.r), protRoute: placed.P ? route(placed.P) : undefined, protKm: placed.P ? placed.P.km : undefined });
      } else if (fallback) { // wanted protection, but nothing is disjoint: carry it unprotected and say so
        take(fallback.slot, fallback.r.links, fallback.o); placedList.push({ r: fallback.r, mode, o: fallback.o });
        entries.push({ slot: fallback.slot, mode: d.mode, off: fallback.o, svc: false, from: d.a, to: d.z, via: fallback.r.via, conv: '', slot2: fallback.slot, prot: '' });
        results.push({ ...out, status: 'placed', unprotected: true, launchOff: fallback.o || undefined, slot: fallback.slot, km: fallback.r.km, hops: fallback.r.nodes.length - 1, margin: fallback.est.margin, via: fallback.r.via, detour: fallback.r !== cs[0], route: route(fallback.r) });
      } else if (conv) {
        take(conv.s1, conv.h1.links); take(conv.s2, conv.h2.links); placedList.push({ r: conv.h1, mode, o: 0 }, { r: conv.h2, mode, o: 0 });
        entries.push({ slot: conv.s1, mode: d.mode, off: 0, svc: false, from: d.a, to: d.z, via: conv.r.via, conv: conv.at, slot2: conv.s2, prot: '' });
        results.push({ ...out, status: 'placed', converted: nm(conv.at), slot: conv.s1, slot2: conv.s2, km: conv.r.km, hops: conv.r.nodes.length - 1, margin: conv.margin, via: conv.r.via, detour: conv.r !== cs[0], route: route(conv.r) });
      } else results.push({ ...out, status: reach ? 'blocked' : 'unreachable', why: reach ? why : '' });
      { const last = results[results.length - 1], ent = entries[entries.length - 1];
        if (tgt && last && last.status === 'placed' && ent) { last.availability = availOf(d, ent.prot, ent.via, ent.conv); last.meetsTarget = last.availability != null && last.availability >= tgt - 1e-12; } }
    }
    const n = k => results.filter(r => r.status === k).length, placed = n('placed'), blocked = n('blocked'), protectedN = results.filter(r => r.status === 'placed' && r.protRoute).length, unprotectedN = results.filter(r => r.unprotected).length, convertedN = results.filter(r => r.converted).length;
    const fibers = [...loads].filter(([id]) => link(id).kind === 'fiber').map(([id, c]) => ({ id, name: `${node(link(id).a).name}–${node(link(id).b).name}`, n: c, util: c / slotsN }));
    return { entries, results, stats: { demands: results.length, placed, blocked, protected: protectedN, unprotected: unprotectedN, converted: convertedN, unreachable: n('unreachable') + n('no route'), missed: results.filter(r => r.status === 'placed' && r.target && r.meetsTarget === false).length, autoProt: results.filter(r => r.autoProt && r.protRoute).length, blocking: placed + blocked ? blocked / (placed + blocked) : 0,
      maxUtil: Math.max(0, ...fibers.map(f => f.util)), slotsUsed: used.filter(u => u.size).length, slots: slotsN, fibers, svcSlot } };
  }
  // Blocking probability against offered load: random demands between random pairs of ROADMs (or ends), a fixed seed so it is repeatable.
  function blockingCurve(S, mode, loadsList, trials = 12, seed = 1, opts = {}) {
    const pool = S.nodes.filter(n => n.type === 'roadm'), nodes = pool.length >= 2 ? pool : S.nodes.filter(isEnd);
    if (nodes.length < 2) return [];
    let st = seed >>> 0; const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const cache = new Map();
    return loadsList.map(n => {
      let sum = 0, cnt = 0;
      for (let t = 0; t < trials; t++) {
        const ds = []; for (let i = 0; i < n; i++) { const a = nodes[Math.floor(rnd() * nodes.length)]; let z; do { z = nodes[Math.floor(rnd() * nodes.length)]; } while (z === a); ds.push({ a: a.id, z: z.id, mode, count: 1 }); }
        const r = planDemands(S, ds, { ...opts, cache }).stats; if (r.placed + r.blocked) { sum += r.blocking; cnt++; }
      }
      return { n, p: cnt ? sum / cnt : 0 };
    });
  }

