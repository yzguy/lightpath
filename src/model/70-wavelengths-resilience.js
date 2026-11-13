  // ---------- simulation ----------
  const reqCache = {};
  const reqOsnr = k => (reqCache[k] ??= PHY_.requiredOsnr(PHY_.MODES[k]));

  // Working and protection routes for a 1+1 protected channel, planned on the intact network: the shortest route (through `via` if given)
  // and the shortest route that shares no fiber with it. x, y are in the direction of the run.
  function plannedPair(S, x, y, via) {
    const leg = (p, q, ex) => route(S, p, q, true, { ignoreCut: true, exclude: ex });
    let W0 = null;
    if (x === y) return { W0, P0: null, why: 'its add and drop nodes are the same' };
    if (!via || via === x || via === y) W0 = leg(x, y);
    else { const r1 = leg(x, via), r2 = leg(via, y); if (r1 && r2) W0 = { nodes: [...r1.nodes, ...r2.nodes.slice(1)], links: [...r1.links, ...r2.links] }; }
    if (W0 && (new Set(W0.nodes).size !== W0.nodes.length || new Set(W0.links).size !== W0.links.length)) return { W0: null, P0: null, why: 'a route through that waypoint would revisit a node or fiber' };
    if (!W0) return { W0, P0: null, why: via ? 'no route through that waypoint' : 'no route between its add and drop nodes' };
    // the protection route avoids the fibers of the working route; the patch cords at a single-homed transponder are shared by necessity
    const fibers = new Set(W0.links.filter(id => (S.links.find(l => l.id === id) || {}).kind === 'fiber'));
    for (const id of [...fibers]) { const grp = S.links.find(l => l.id === id).p.srlg; if (grp) S.links.forEach(o => { if (o.p.srlg === grp) fibers.add(o.id); }); } // fibers in the same duct fail together
    // a dual-homed transponder lets the protection route avoid the access cords too; otherwise they are shared by necessity
    const all = new Set([...fibers, ...W0.links.filter(id => (S.links.find(l => l.id === id) || {}).kind !== 'fiber')]);
    return { W0, P0: leg(x, y, all) || leg(x, y, fibers), why: '' };
  }
  // a route is unusable if it crosses a cut fiber (or one in the same risk group) or a dead device
  const routeCut = (S, r) => !!r && (r.links.some(id => { const l = S.links.find(o => o.id === id); return l && isCut(S, l); }) || r.nodes.some(id => isDead(S.nodes.find(n => n.id === id))));

  // Channel table for a service. Plan mode: the stored plan, with the service channel forced to the service's own mode.
  // Otherwise: g.nch identical channels in a contiguous block centred in the C-band, service in the middle.
  // A plan entry becomes one or two routed channels (segments): a wavelength converter splits it in two in series (before and after the
  // converter ROADM, each in its own slot, each regenerated), and 1+1 protection makes a working and a protection copy in parallel.
  // lg is the plan entry a segment belongs to, role says which part it is. svcOnProt: the service runs on its protection copy.
  function buildChans(g, svcKey, planOn, slotsN, df, svcOnProt = false, rv = false) {
    let list;
    if (planOn) {
      list = [];
      g.plan.forEach((c, lg) => {
        const svc = !!c.svc, base = { mode: svc ? svcKey : c.mode, off: Number.isFinite(+c.off) ? +c.off : 0, lg };
        const from = svc ? '' : c.from || '', to = svc ? '' : c.to || '', via = svc ? '' : c.via || '', conv = svc ? '' : c.conv || '', slot = +c.slot;
        const prot = c.prot === '1+1' || c.prot === 'shared', shared = c.prot === 'shared';
        // pc: '' unprotected, 'w' working copy, 'p' protection copy; sec: which side of the converter (0 before, 1 after)
        const mk = (sec, sl, f, t, v, pc, svcFlag) => ({ ...base, slot: sl, slotRev: !conv && Number.isInteger(c.slotRev) ? c.slotRev : null, svc: svcFlag, from: f, to: t, via: v, sec, pc, shared: shared && pc === 'p', hasConv: !!conv, role: pc === 'w' ? 'work' : pc === 'p' ? 'prot' : 'only' });
        if (conv) {
          const s2 = Number.isFinite(+c.slot2) && c.slot2 !== '' && c.slot2 !== null ? +c.slot2 : slot;
          [[slot, from, conv], [s2, conv, to]].forEach(([sl, f, t], sec) => { if (prot) { list.push(mk(sec, sl, f, t, '', 'w', false)); list.push(mk(sec, sl, f, t, '', 'p', false)); } else list.push(mk(sec, sl, f, t, '', '', false)); });
        } else if (prot) { list.push(mk(0, slot, from, to, via, 'w', svc && !svcOnProt)); list.push(mk(0, slot, from, to, via, 'p', svc && svcOnProt)); }
        else list.push(mk(0, slot, from, to, via, '', svc));
      });
      if (!list.some(c => c.svc)) list[Math.floor(list.length / 2)].svc = true;
    } else {
      const n = Math.max(1, Math.round(+g.nch)), start = Math.floor(Math.max(0, slotsN - n) / 2), mid = Math.floor(n / 2);
      list = Array.from({ length: n }, (_, i) => ({ slot: start + i, mode: svcKey, off: 0, svc: i === mid, from: '', to: '', via: '', lg: i, sec: 0, pc: '', shared: false, hasConv: false, role: 'only' }));
    }
    return list.map((c, i) => { const sw = rv && c.slotRev != null, slot = sw ? c.slotRev : c.slot, m = PHY_.MODES[c.mode] || PHY_.MODES[svcKey], fTHz = PHY_.slotFreqTHz(slot, df); return { ...c, slot, slotRev: c.slotRev == null ? null : sw ? c.slot : c.slotRev, idx: i, m, mode: PHY_.MODES[c.mode] ? c.mode : svcKey, Rs: m.Rs, fTHz, f: fTHz * 1e12 }; }); // a channel on a single fiber has another slot on the way back
  }
  // Tilt costs the channel that loses power: those in the upper half of the lit band, up to half the (mean) tilt at the top edge.
  function tiltPenaltyFor(chans, i, edgeTilt) {
    const sl = chans.map(c => c.slot), lo = Math.min(...sl), hi = Math.max(...sl);
    const u = hi > lo ? (chans[i].slot - lo) / (hi - lo) : 0.5;
    return Math.max(0, 2 * u - 1) * edgeTilt / 2;
  }

  // Mesh routing for a channel plan. Every channel runs between its own add and drop nodes ('' = the service's A / Z), routed over the
  // cabled graph. loads: link id -> set of channel indices on it (the same channels light the link in both directions). hosts: the walks
  // that have to be simulated: the service path first, then every route that is not a stretch of an earlier one. Each channel is a member
  // of one host, with lo/hi the node positions along that host where it is added and dropped.
  function planMesh(S, chans, path, rv, noBlock) {
    useGrid(S);
    const svcA = S.svc.a, svcZ = S.svc.z, memo = new Map(), { link, linkName, node } = mkGraph(S);
    const routeFor = c => {
      const ea = c.from || svcA, ez = c.to || svcZ, via = c.svc ? '' : c.via || '';
      if (c.pc) { // 1+1: the planned working route and the planned fiber-disjoint protection route
        const key = 'P' + ea + '>' + via + '>' + ez;
        if (!memo.has(key)) memo.set(key, plannedPair(S, ...(rv ? [ez, ea] : [ea, ez]), via));
        const pp = memo.get(key);
        if (c.svc) return path; // the service's own copy is the walk's path (chosen by the caller)
        const r = c.pc === 'w' ? pp.W0 : pp.P0;
        if (!r) { why[c.idx] = c.pc === 'w' || !pp.W0 ? pp.why : 'no route that shares no fiber with the working route'; return null; }
        if (routeCut(S, r)) { why[c.idx] = 'the route crosses a cut fiber or a failed device'; cutOff[c.idx] = true; return null; }
        return r;
      }
      if (c.svc || (ea === svcA && ez === svcZ && !via)) return path;
      const key = ea + '>' + via + '>' + ez;
      if (!memo.has(key)) {
        const [x, y] = rv ? [ez, ea] : [ea, ez], leg = (p, q) => route(S, p, q, false) || route(S, p, q, true);
        let r = null, why = ea === ez ? 'its add and drop nodes are the same' : '';
        if (!why) {
          if (!via) r = leg(x, y);
          else if (via === x || via === y) r = leg(x, y);
          else { const r1 = leg(x, via), r2 = leg(via, y); if (r1 && r2) r = { nodes: [...r1.nodes, ...r2.nodes.slice(1)], links: [...r1.links, ...r2.links] }; }
          if (r && (new Set(r.nodes).size !== r.nodes.length || new Set(r.links).size !== r.links.length)) { why = 'a route through that waypoint would revisit a node or fiber'; r = null; }
          else if (!r) why = via ? 'no route through that waypoint' : 'no route between its add and drop nodes';
        }
        memo.set(key, { r, why });
      }
      const m = memo.get(key); why[c.idx] = m.why; return m.r;
    };
    const why = [], cutOff = [];
    const routes0 = chans.map(routeFor), routes = routes0.slice(), loads = new Map(), blocked = [], dark = [];
    // Shared (1:N) protection: the protection copy is dark while its working copy is up, so it does not load the line and it may use a slot
    // that other channels' protection copies also use (their working routes cannot be lit in that slot together, so one failure never needs both).
    chans.forEach((c, k) => { if (c.shared && !c.svc && routes0[chans.findIndex(x => x.lg === c.lg && x.sec === c.sec && x.pc === 'w')]) dark[k] = true; });
    // A passive OADM: the filter terminates the slots it serves, so those cannot pass, and only they can be added or dropped there.
    chans.forEach((c, k) => { const r = routes0[k]; if (!r || c.svc) return; const w = oadmWhy(r.nodes.map(id => node(id)), c.slot, r.links.map(id => link(id)), c.slotRev); if (w) { routes[k] = null; blocked[k] = true; why[k] = w; } });
    // Wavelength continuity: a slot can carry one channel per fiber. The service has priority, then plan order; a channel that meets a lit slot is blocked.
    // On a single fiber (both directions in one glass) the two directions of a channel need different slots, and no other channel may use either slot there.
    const singles = new Set(S.links.filter(l => l.kind === 'fiber' && l.p.single).map(l => l.id));
    let svcClash = '';
    if (!noBlock) {
      const used = new Map(), both = c => (c.slotRev != null ? [c.slot, c.slotRev] : [c.slot, c.slot]), slotsOn = (c, id) => (singles.has(id) ? both(c) : [c.slot]);
      chans.map((_, k) => k).sort((a, b) => (chans[b].svc ? 1 : 0) - (chans[a].svc ? 1 : 0) || a - b).forEach(k => {
        const r = routes0[k]; if (!r || dark[k] || blocked[k]) return;
        const c = chans[k], one = r.links.find(id => singles.has(id));
        if (one && both(c)[0] === both(c)[1]) {
          const w = `${slotLbl(c.slot)} is used in both directions on ${linkName(link(one))}, a single fiber: each direction needs its own wavelength`;
          if (c.svc) svcClash = w; else { routes[k] = null; blocked[k] = true; why[k] = w; return; }
        }
        let clash = null;
        const hit = r.links.find(id => slotsOn(c, id).some(x => { const o = used.get(x + '|' + id); if (o != null && chans[o].lg !== c.lg) { clash = x; return true; } return false; })); // the two copies of a 1+1 channel are one signal
        if (hit) { routes[k] = null; blocked[k] = true; why[k] = `${slotLbl(clash)} is already lit on ${linkName(link(hit))} by another channel${singles.has(hit) ? ' (in the other direction too: it is a single fiber)' : ''}`; }
        else r.links.forEach(id => slotsOn(c, id).forEach(x => used.set(x + '|' + id, k)));
      });
    }
    if (!noBlock) chans.forEach((c, k) => { // a dark protection route must still be free of lit channels in its slot
      const r = routes0[k]; if (!dark[k] || !r) return;
      const hit = r.links.find(id => { const o = chans.findIndex((x, j) => !dark[j] && routes[j] && x.slot === c.slot && x.lg !== c.lg && routes[j].links.includes(id)); return o >= 0; });
      if (hit) { blocked[k] = true; why[k] = `shared protection: ${slotLbl(c.slot)} is lit on ${linkName(link(hit))} by another channel`; }
    });
    dark.forEach((d, k) => { if (d) routes[k] = null; });
    routes.forEach((r, k) => { if (r) for (const id of r.links) { if (!loads.has(id)) loads.set(id, new Set()); loads.get(id).add(k); } });
    const hosts = [{ path, members: [] }];
    const place = (h, k) => {
      const W = h.path.links, R = routes[k].links, find = L => { for (let t = 0; t + L.length <= W.length; t++) if (L.every((id, j) => W[t + j] === id)) return t; return -1; };
      let t = find(R); if (t < 0) t = find(R.slice().reverse());
      if (t < 0) return false;
      h.members.push({ k, lo: t, hi: t + R.length }); return true;
    };
    routes.forEach((r, k) => { if (r === path) hosts[0].members.push({ k, lo: 0, hi: path.links.length }); });
    routes.map((r, k) => k).filter(k => routes[k] && routes[k] !== path).sort((a, b) => routes[b].links.length - routes[a].links.length).forEach(k => {
      if (!hosts.some(h => place(h, k))) { const h = { path: routes[k], members: [] }; hosts.push(h); place(h, k); }
    });
    return { routes, routes0, loads, hosts, why, blocked, cutOff, dark, svcClash };
  }

  // First-fit wavelength assignment: the service keeps its slot; the other channels, longest route first, each take the lowest slot that is
  // free on every fiber of their route. Channels on routes with no fiber in common end up sharing slots. Returns the new plan (or null).
  function assignSlots(S) {
    useGrid(S);
    const g = S.g, sa = S.nodes.find(n => n.id === S.svc.a);
    if (!g || !Array.isArray(g.plan) || !g.plan.length || !isEnd(sa)) return null;
    const df = +g.df * 1e9, slotsN = PHY_.cBandSlots(df), chans = buildChans(g, sa.p.mode, true, slotsN, df);
    const path = route(S, S.svc.a, S.svc.z, false) || route(S, S.svc.a, S.svc.z, true);
    if (!path) return null;
    const mesh = planMesh(S, chans, path, false, true);
    // A unit is what must share one slot: a plain channel, or a 1+1 pair (both copies use the same slot). A converter's two segments are separate units.
    const units = [];
    chans.forEach((c, k) => { const u = c.pc === 'p' ? units.find(x => x.lg === c.lg && x.sec === c.sec) : null; if (u) u.ks.push(k); else units.push({ lg: c.lg, sec: c.sec, ks: [k], svc: c.svc }); });
    // Lit copies need their slot free on their route; a shared (dark) protection copy only needs it free of lit channels, and may reuse a slot
    // that other protection copies use. The two copies of a pair always take the same slot.
    const rt = k => (mesh.routes0[k] ? mesh.routes0[k].links : []);
    units.forEach(u => { u.links = new Set(u.ks.filter(k => !chans[k].shared || chans[k].svc).flatMap(rt)); u.dlinks = new Set(u.ks.filter(k => chans[k].shared && !chans[k].svc).flatMap(rt)); u.svc = u.ks.some(k => chans[k].svc); });
    const prim = Array.from({ length: slotsN }, () => new Set()), dk = Array.from({ length: slotsN }, () => new Set()), slot = chans.map(c => c.slot);
    units.map((u, i) => i).sort((a, b) => (units[b].svc ? 1 : 0) - (units[a].svc ? 1 : 0) || units[b].links.size - units[a].links.size || a - b).forEach(i => {
      const u = units[i]; if (!u.links.size && !u.dlinks.size) return;
      let s = slot[u.ks[0]];
      if (!u.svc) { const f = prim.findIndex((_, x) => [...u.links].every(id => !prim[x].has(id) && !dk[x].has(id)) && [...u.dlinks].every(id => !prim[x].has(id))); if (f >= 0) s = f; }
      u.ks.forEach(k => (slot[k] = s)); u.links.forEach(id => prim[s].add(id)); u.dlinks.forEach(id => dk[s].add(id));
    });
    const plan = g.plan.map((c, lg) => { const ks = chans.map((x, k) => (x.lg === lg ? k : -1)).filter(k => k >= 0), k2 = ks.find(k => chans[k].sec === 1); return { ...c, slot: slot[ks[0]], slot2: c.conv && k2 != null ? slot[k2] : slot[ks[0]] }; });
    return sanitizePlan(plan, +g.df);
  }

  // Plan-entry results from segment results. A converted channel is judged on its worst half; a 1+1 copy pair on the copy that carries it
  // (the service's own copy for the service; otherwise the working copy unless it is unusable and the protection copy is not). A protected
  // converted channel is protected on each side of the converter separately.
  const SEG_RANK = { up: 0, degraded: 1, blocked: 2, nopath: 2, down: 2, los: 3 };
  function logicalChannels(plan, chans, seg) {
    const worse = (a, b) => (SEG_RANK[b.status] > SEG_RANK[a.status] || (SEG_RANK[b.status] === SEG_RANK[a.status] && (b.qMargin ?? -1e9) < (a.qMargin ?? -1e9)) ? b : a);
    // two halves of a converted channel as one entry: worst half, joined route
    const joinHalves = (e1, e2, notes) => {
      const w = worse(e1, e2);
      return { ...w, converted: true, segments: [e1, e2], slot: e1.slot, slot2: e2.slot, svc: false, from: e1.from, to: e2.to, fromName: e1.fromName, toName: e2.toName,
        route: [...e1.route, ...e2.route.slice(1)], routeLinks: [...e1.routeLinks, ...e2.routeLinks], routeNodes: [...e1.routeNodes, ...e2.routeNodes.slice(1)],
        notes: notes || (w.status !== 'up' ? [`${w === e1 ? 'before' : 'after'} the converter: ${w.notes[0] || w.status}`] : []) };
    };
    return plan.map((c, i) => {
      const ks = []; chans.forEach((x, k) => { if (x.lg === i) ks.push(k); });
      const secs = [0, 1].map(s => ks.filter(k => chans[k].sec === s)).filter(g => g.length);
      const res = secs.map(group => {
        if (group.length === 1) return { act: seg[group[0]] };
        const [wk, pr] = [seg[group[0]], seg[group[1]]], act = wk.svc || pr.svc ? (wk.svc ? wk : pr) : SEG_RANK[wk.status] >= 2 && SEG_RANK[pr.status] <= 1 ? pr : wk;
        const stby = act === wk ? pr : wk, onP = act === pr, out = { ...act, notes: [...act.notes] };
        if (onP) { out.notes.unshift('on the protection route'); if (out.status === 'up') out.status = 'degraded'; }
        else if (SEG_RANK[stby.status] >= 2 && !c.svc && stby.status !== 'standby') { out.notes.push(`no protection: ${stby.notes[0] || stby.status}`); if (out.status === 'up') out.status = 'degraded'; }
        return { act: out, wk, pr, onP };
      });
      if (res.length === 1) {
        const r = res[0];
        return r.wk ? { ...r.act, idx: i, lg: i, svc: !!c.svc, protection: { active: r.onP ? 'protect' : 'work', work: r.wk, protect: r.pr } } : { ...r.act, idx: i, lg: i };
      }
      const joined = joinHalves(res[0].act, res[1].act, null);
      joined.idx = i; joined.lg = i;
      if (res[0].wk) joined.protection = { active: res.some(r => r.onP) ? 'protect' : 'work', work: joinHalves(res[0].wk, res[1].wk), protect: joinHalves(res[0].pr, res[1].pr), sections: res };
      if (joined.status !== 'up' && !joined.notes.length) joined.notes = [res.find(r => r.act === worse(res[0].act, res[1].act)).act.notes[0] || joined.status];
      return joined;
    });
  }

  // Expected outages from the planned routes (intact network), one result per plan entry (or one for the service without a plan).
  // Unprotected: each fiber cut restores over another route if one exists (restoreSec), else lasts the repair time. 1+1: a cut on the working
  // route costs detect + switch; shared protection adds the turn-up time of the dark route; both add the chance that both routes are down together.
  // A converted channel is the sum of its halves. These are expectations from cut rates, not a simulation of events.
  function resilience(S) {
    useGrid(S);
    S = effective(S);
    const g = S.g || {}, num = (v, d) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : d);
    const P = {}; for (const k in RESIL) P[k] = num(g[k], RESIL[k]);
    const { link, node } = mkGraph(S), YEAR = 8760 * 3600, svc = S.svc || {};
    const len = id => { const l = link(id); return l && l.kind === 'fiber' ? +l.p.len : 0; }, km = ids => ids.reduce((a, id) => a + len(id), 0);
    // restoring over a route through an auto-switching optical switch takes the detection plus the switch time, not the control plane's restoration time
    // A revertive switch moves back after the repair and the wait-to-restore time: a second hit of the switch time per cut (a non-revertive one stays where it went).
    const restoreOf = alt => { const sw = alt.nodes.map(id => node(id)).filter(n => n && n.type === 'switch' && n.p.auto); return sw.length ? (P.detectMs + Math.max(...sw.map(n => (+n.p.switchMs || 20) * (n.p.revertive ? 2 : 1)))) / 1000 : P.restoreSec; };
    const lam = k => P.cutRate * k / 1000, Uf = k => lam(k) * P.mttr / 8760;
    const plan = Array.isArray(g.plan) && g.plan.length ? g.plan : [{ svc: true, from: '', to: '', via: '', conv: '', prot: '' }];
    const section = (x, y, via, prot) => { // one routed stretch, optionally protected
      const pp = plannedPair(S, x, y, via), W = pp.W0;
      if (!W) return { none: true, why: pp.why };
      const wk = km(W.links), lw = lam(wk);
      // line devices on the route (amplifiers, ROADMs): a failed add/drop ROADM keeps its channel down until repaired; an interior device is
      // bypassed by protection if the protection route avoids it, otherwise by restoration if some route does, else it waits for repair
      const sw = (P.detectMs + P.switchMs) / 1000 + (prot === 'shared' ? P.sharedSec : 0), isProt = !!(prot && pp.P0);
      let devDown = 0, devFail = 0, devWorst = 0;
      for (const d of W.nodes) {
        const n = node(d); if (!n || !(n.type === 'edfa' || n.type === 'roadm') || !P.devRate) continue;
        let t;
        if (d === x || d === y) t = P.mttr * 3600;
        else if (isProt && !pp.P0.nodes.includes(d)) t = sw;
        else { const alt = route(S, x, y, true, { ignoreCut: true, excludeNodes: new Set([d]) }); t = alt ? restoreOf(alt) : P.mttr * 3600; }
        devDown += P.devRate * t; devFail += P.devRate; devWorst = Math.max(devWorst, t);
      }
      for (const d of [x, y]) { // the transponders at the ends: a spare module takes over in the switch time, otherwise the repair time
        const n = node(d); if (!n || !isEnd(n) || !P.devRate) continue;
        const t = SPARE_LOSS[n.p.spare] ? (P.detectMs + P.switchMs) / 1000 : P.mttr * 3600;
        devDown += 1.5 * P.devRate * t; devFail += 1.5 * P.devRate; devWorst = Math.max(devWorst, t);
      }
      { const wn = W.nodes.map(id => node(id)); wn.forEach((n, k) => { // the port this channel uses on a mux, an end ROADM or an OADM: one slot's port fails far less often than the whole device
        if (!n || !P.devRate || !usesPort(wn, k, W.links.map(id => link(id)))) return;
        const r = 0.25 * P.devRate, t = isProt && !pp.P0.nodes.includes(n.id) ? sw : P.mttr * 3600;
        devDown += r * t; devFail += r; devWorst = Math.max(devWorst, t);
      }); }
      if (isProt) {
        const pk = km(pp.P0.links);
        return { kind: prot === 'shared' ? 'shared' : '1+1', km: wk, protKm: pk, failures: lw + devFail, outageSec: Math.max(sw, devWorst), downSec: lw * sw + Uf(wk) * Uf(pk) * YEAR + devDown };
      }
      let down = 0, worst = 0, restorable = 0, fibers = 0;
      for (const id of W.links) {
        if (!len(id)) continue; fibers++;
        const grp = (link(id).p || {}).srlg, mates = grp ? S.links.filter(o => o.p.srlg === grp).map(o => o.id) : [id];
        const alt = route(S, x, y, true, { ignoreCut: true, exclude: new Set([id, ...mates]) }), t = alt ? restoreOf(alt) : P.mttr * 3600;
        if (alt) restorable++; down += lam(len(id)) * t; worst = Math.max(worst, t);
      }
      const kind = prot && !pp.P0 ? 'unprotected (no disjoint route)' : restorable === fibers ? 'restoration' : restorable ? 'partial restoration' : 'unprotected';
      return { kind, km: wk, protKm: 0, failures: lw + devFail, outageSec: Math.max(worst, devWorst), downSec: down + devDown };
    };
    return plan.map(c => {
      const ea = c.svc || !c.from ? svc.a : c.from, ez = c.svc || !c.to ? svc.z : c.to, conv = c.svc ? '' : c.conv || '';
      const parts = conv ? [section(ea, conv, '', c.prot), section(conv, ez, '', c.prot)] : [section(ea, ez, c.svc ? '' : c.via || '', c.prot)];
      if (parts.some(p => p.none)) return { svc: !!c.svc, kind: 'no route', note: (parts.find(p => p.none) || {}).why, km: 0, protKm: 0, failures: 0, outageSec: 0, downSec: YEAR, availability: 0 };
      const downSec = parts.reduce((a, p) => a + p.downSec, 0), kinds = [...new Set(parts.map(p => p.kind))];
      return { svc: !!c.svc, kind: kinds.join(' + '), km: parts.reduce((a, p) => a + p.km, 0), protKm: parts.reduce((a, p) => a + p.protKm, 0), failures: parts.reduce((a, p) => a + p.failures, 0),
        outageSec: Math.max(...parts.map(p => p.outageSec)), downSec, availability: 1 - downSec / YEAR };
    });
  }

