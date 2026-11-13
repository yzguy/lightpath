  const STATUS_RANK = { up: 0, degraded: 1, down: 2, nopath: 2, los: 3 };
  function simulate(S, launchOverride, opts = {}) {
    useGrid(S);
    S = effective(S);
    if (S._derived && S._derived.svcWhy && !opts.walk) return { status: 'los', headline: S._derived.svcWhy, derived: S._derived };
    const eol = !!opts.eol, rv = !!opts.reverse, W = opts.walk || null; // W: a mesh walk, the simulation of a route other than the service's (see planMesh)
    const pd = (p, k) => (rv && p[k + 'Rev'] !== '' && p[k + 'Rev'] != null && Number.isFinite(+p[k + 'Rev']) ? p[k + 'Rev'] : p[k]);
    const { node, link, linkName } = mkGraph(S);
    const g = { ...S.g }; if (launchOverride != null) g.launch = launchOverride;
    const A = node(W ? W.a : rv ? S.svc.z : S.svc.a), Z = node(W ? W.z : rv ? S.svc.a : S.svc.z);
    if (!W && (!isEnd(A) || !isEnd(Z) || A === Z)) return { status: 'none', headline: 'Pick two transponders or muxponders as the A and Z ends of a service.' };
    const endDown = (n, what) => { const t = `${n.name} has failed: ${what}.`; return { status: 'los', headline: t, headlineFix: fixWork(n), alarms: [{ sev: 'bad', text: t, fix: fixWork(n) }] }; };
    if (!W && isDead(A)) return endDown(A, 'nothing is transmitted');
    if (!W && isDead(Z)) return endDown(Z, 'nothing receives the signal');
    if (W && (isDead(A) || isDead(Z))) return { status: 'los', headline: 'A device at the end of this route has failed.' }; // its channels report LOS
    const modeKey = W ? W.svcMode : A.p.mode, mode = PHY_.MODES[modeKey];
    // A 1+1 protected service runs on its planned working route, and on the planned fiber-disjoint protection route once the working one
    // has a cut fiber (or, see below, when it is down). Otherwise the shortest route over the fibers that are not cut, with a fallback across a cut.
    const svcEntry = !W && Array.isArray(g.plan) ? g.plan.find(c => c.svc) : null, svcProt = !!svcEntry && (svcEntry.prot === '1+1' || svcEntry.prot === 'shared');
    let path, rerouteCut = false, svcOnProt = W ? !!W.svcOnProt : false, protWhy = '';
    if (W) path = W.path;
    else if (svcProt) {
      const pp = plannedPair(S, A.id, Z.id, ''), ok = r => r && !routeCut(S, r);
      if (ok(pp.W0) && !opts.useProtect) path = pp.W0;
      else if (ok(pp.P0)) { path = pp.P0; svcOnProt = true; protWhy = pp.W0 && routeCut(S, pp.W0) ? 'cut' : 'forced'; }
      else { path = pp.W0 || route(S, A.id, Z.id, true); rerouteCut = routeCut(S, path); }
    } else { path = route(S, A.id, Z.id, false); if (!path) { path = route(S, A.id, Z.id, true); rerouteCut = true; } }
    if (!path) return { status: 'nopath', headline: `No physical path from ${A.name} to ${Z.name}. Cable them together.` };

    const eolSpan = Number.isFinite(+g.eolSpan) && g.eolSpan !== '' && g.eolSpan != null ? +g.eolSpan : PHY_.EOL.spanLoss;
    const eolTrx = Number.isFinite(+g.eolTrx) && g.eolTrx !== '' && g.eolTrx != null ? +g.eolTrx : PHY_.EOL.trxPen;
    // Channel table: the custom plan if there is one, else a contiguous block of identical channels centred in the band.
    const df = +g.df * 1e9, planOn = Array.isArray(g.plan) && g.plan.length > 0, slotsN = PHY_.cBandSlots(df);
    const chans = buildChans(g, modeKey, planOn, slotsN, df, svcOnProt, rv);
    if (planOn) g.nch = g.plan.length;
    const svcIdx = Math.max(0, chans.findIndex(c => c.svc)), nChan = chans.length;
    // Mesh: every channel has its own route; this walk follows `path`. Members are the channels that ride (a stretch of) this path,
    // with lo/hi the node positions where they are added and dropped. Link loads count every channel on a fiber, member or not.
    const lastPos = path.nodes.length - 1;
    // The first device on a route whose port for this slot has failed: any passive mux the channel joins or leaves through, or the add/drop ROADM at an end.
    const filterWhy = (ids, slot, lids, slotRev) => oadmWhy(ids.map(id => node(id)), slot, (lids || []).map(id => link(id)), slotRev);
    const portFaultOn = (ids, slot, lids) => { const ns = ids.map(id => node(id)), lks = (lids || []).map(id => link(id)); for (let k = 0; k < ns.length; k++) if (usesPort(ns, k, lks) && portDown(ns[k], slot)) return ns[k]; return null; };
    const mesh = planOn ? (W ? W.mesh : planMesh(S, chans, path, rv)) : null, members = planOn ? (W ? W.members : mesh.hosts[0].members) : [];
    const lohi = chans.map(() => null); members.forEach(m => (lohi[m.k] = m));
    const maskAt = j => { const set = mesh.loads.get(path.links[j]); return chans.map((_, k) => !!set && set.has(k)); }, litCount = j => maskAt(j).filter(Boolean).length;
    const nchLine = Math.max(1, +g.nch), Rs = mode.Rs;
    const reachHz = PHY_.XPM.reachGHz * 1e9, nbWeight = c => (planOn ? (c.m.coh === false ? PHY_.XPM.same : PHY_.XPM.coh) : (g.neighbors === 'coh' ? PHY_.XPM.coh : PHY_.XPM.same));
    // XPM neighbours within reach, weighted by who they are, their power and how far they walk off over this span (fb, Lk)
    const xpmWFor = (i, act, fb, Lk) => (chans[i].m.coh === false ? chans.reduce((a, cj, j) => a + (j !== i && (!act || act[j]) && Math.abs(cj.f - chans[i].f) <= reachHz ? nbWeight(cj) * lin(cj.off - chans[i].off) * PHY_.xpmWalk(fb, Lk, Math.abs(cj.f - chans[i].f)) : 0), 0) : 0);
    const ev = []; // event log replayed per channel after the loop (plan mode only)
    let curAct = planOn ? maskAt(0) : null; // channels lit at the current point of the path (plan mode)
    const txDbm = W && A.type === 'oadm' ? +A.p.tx - +A.p.ad : W && A.type === 'roadm' ? +g.launch : txPower(A, mode); // a channel added at a ROADM starts at the launch level; a degraded laser is weaker
    let mpi = 0, refl = [], xpmPen = 0, P = lin(txDbm) / 1000, Pase = P / lin(mode.txOsnr), Pnli = 0, cd = 0, dgd2 = 0, km = 0, passes = 0, nch = 1, maxNch = 1, tilt = 0;
    const tiltSeen = []; // tilt (dB, low- minus high-frequency channel) at every amplifier input and at the receiver
    const hops = [], alarms = [], failovers = []; // a protection switch that is passing its other port because the selected one cannot carry the light
    const snap = () => ({ sig: db(P * 1000), ase: db(Pase * 1000), nli: Pnli > 0 ? db(Pnli * 1000 * PHY_.BREF / Rs) : -99 });
    const osnrNow = () => db(P / Pase);
    const gosnrNow = () => db(1 / (Pase / P + (Pnli / P) * Rs / PHY_.BREF));
    function rec(name, kind, before, extra = {}) {
      hops.push({ name, kind, in: before, out: snap(), km, nch, tilt, osnr: osnrNow(), gosnr: gosnrNow(), ...(curAct ? { lit: curAct.slice() } : {}), ...extra });
    }
    const loss = d => { const f = lin(-d); P *= f; Pase *= f; Pnli *= f; if (planOn) ev.push({ k: 'L', f }); };
    const ramanViews = [];
    // Solve one Raman span with the coupled-wave solver: the lit channels (binned to at most 12 samples) enter at the launch power, the pump
    // wavelengths split the pump power equally, and the gain at any frequency is interpolated between the samples.
    function ramanSpanSolve(fb, Lk, pb, pf, npump, act) {
      let list = planOn ? chans.map((c, k) => (act[k] ? { f: c.fTHz, w: lin(c.off) } : null)).filter(Boolean) : Array.from({ length: Math.max(1, nch) }, (_, i) => ({ f: PHY_.slotFreqTHz(Math.floor(Math.max(0, slotsN - Math.max(1, nch)) / 2) + i, df), w: 1 }));
      list.sort((a, b) => a.f - b.f);
      if (list.length > 12) { const bins = []; for (let b = 0; b < 12; b++) { const part = list.slice(Math.floor(b * list.length / 12), Math.floor((b + 1) * list.length / 12)), w = part.reduce((t, x) => t + x.w, 0); bins.push({ f: part.reduce((t, x) => t + x.f * x.w, 0) / w, w }); } list = bins; }
      const sigs = list.map(x => ({ fTHz: x.f, mW: 1000 * P * x.w })), freqs = PHY_.RAMAN_PUMPS[npump];
      const mk = (mw, dir) => (mw > 0 ? freqs.map(f => ({ fTHz: f, mW: mw / npump, dir })) : []);
      const pumps = [...mk(pb, 'back'), ...mk(pf, 'fwd')], r = PHY_.ramanSolve(fb, Lk, pumps, sigs);
      const interp = (arr, f) => { if (f <= sigs[0].fTHz) return arr[0]; for (let i = 1; i < sigs.length; i++) if (f <= sigs[i].fTHz) { const t = (f - sigs[i - 1].fTHz) / (sigs[i].fTHz - sigs[i - 1].fTHz); return arr[i - 1] + t * (arr[i] - arr[i - 1]); } return arr[sigs.length - 1]; };
      const fS = chans[svcIdx].fTHz, gS = interp(r.gainDb, fS), g0S = interp(r.gain0Db, fS);
      let fracF = pf > 0 && pb > 0 ? 0.5 : pf > 0 ? 1 : 0; // split of the gain between the forward and backward pumps
      if (pf > 0 && pb > 0) { const gF = interp(PHY_.ramanSolve(fb, Lk, mk(pf, 'fwd'), sigs, { noSmall: true }).gainDb, fS), gB = interp(PHY_.ramanSolve(fb, Lk, mk(pb, 'back'), sigs, { noSmall: true }).gainDb, fS); fracF = gF / Math.max(1e-9, gF + gB); }
      // distributed ASE (units of h nu B at the fiber end) for every sampled frequency, from the signal power profiles
      const shiftAt = f => (pumps.length ? pumps.reduce((t, p) => t + p.fTHz, 0) / pumps.length : 206) - f, Tk = (Number.isFinite(+g.tempC) ? +g.tempC : 27) + 273.15, aseArr = sigs.map((sg, i) => PHY_.ramanAseN(fb, sg.fTHz, r.profile, i, shiftAt(sg.fTHz), Tk));
      return { aseFn: f => interp(aseArr, f), gb: gS * (1 - fracF), gf: gS * fracF, g0b: g0S * (1 - fracF), g0f: g0S * fracF, gS, depl: r.depletion, relFn: f => interp(r.gainDb, f) / Math.max(1e-9, gS), spread: Math.max(...r.gainDb) - Math.min(...r.gainDb),
        pumps, samples: sigs.map(s => s.fTHz), gainDb: r.gainDb, profile: { z: r.profile.z, sig: r.profile.sig, off: r.profile.off, pump: r.profile.pump } };
    }
    // Launch re-optimisation (g.reopt): an amplifier whose output target is left blank sets the GN-optimal per-channel power for the span
    // after it, given the channels actually lit there, so the setting follows the load as channels come and go. `look` = path link index.
    function optFor(look, nf) {
      for (let j = look; j < path.links.length; j++) {
        const l = link(path.links[j]);
        if (l.kind === 'fiber') {
          const fb = PHY_.FIBERS[l.p.fiber], Lk = +l.p.len, n = planOn ? litCount(j) : l.p.nch !== '' && l.p.nch != null ? Math.min(96, Math.max(1, Math.round(+l.p.nch))) : Math.max(1, nch);
          return { dbm: PHY_.optLaunch(fb, Lk, Rs, n, df, +nf, fb.att * Lk + +pd(l.p, 'extra')), n };
        }
        if (!['mux', 'voa', 'dcm'].includes((node(path.nodes[j + 1]) || {}).type)) return null; // another amplifier, ROADM or end sits between
      }
      return null;
    }
    function amp(name, nf, ctl, target, gFixed, gmin, gmax, pmax, tiltCtl, look = -1, agc = '', deg = 0, pinMax = null) {
      const before = snap(), pin = before.sig;
      const pinTot = pin + db(nch), over = pinMax != null && pinTot > pinMax ? pinTot - pinMax : 0; // total power at the input against the amplifier's input limit
      let info = '';
      if (g.reopt && look >= 0 && ctl === 'auto') { const o = optFor(look, nf); if (o) { target = o.dbm; info = `Launch re-optimised for ${o.n} channel${o.n > 1 ? 's' : ''}: ${f1(o.dbm)} dBm/ch`; } }
      let G = ctl === 'auto' ? target - pin : +gFixed, note = '';
      if (G < gmin) { note = `Needs ${f1(G)} dB but min gain is ${gmin} dB: output runs hot`; G = gmin; }
      if (G > gmax) { note = `Needs ${f1(G)} dB but max gain is ${gmax} dB: output runs low`; G = gmax; }
      const tot = pin + G + db(nch);
      if (tot > pmax) { G -= tot - pmax; note = `Hit total output limit ${pmax} dBm (${nch} ch): per-channel power capped`; }
      if (deg > 0) { G -= deg; note = `Degraded: output ${f1(deg)} dB below the setting`; } // pump ageing: less output and a worse noise figure
      const nfe = PHY_.ampNfEff(+nf + 0.4 * deg, G);
      P *= lin(G); Pnli *= lin(G);
      tiltSeen.push(tilt);
      if (planOn) { ev.push({ k: 'A', G: lin(G), nfe }); if (tiltCtl) ev.push({ k: 'Z' }); }
      if (tiltCtl) tilt = 0; // gain-tilt control re-flattens the band at the amp output
      Pase = Pase * lin(G) + lin(nfe) * PHY_.H * PHY_.NU * lin(G) * PHY_.BREF;
      if (over > 0) { const t = `Input overload: ${f1(pinTot)} dBm total at the input, ${f1(over)} dB above the ${f1(pinMax)} dBm limit`; note = note ? note + '; ' + t.toLowerCase() : t; alarms.push({ sev: over > 3 ? 'bad' : 'warn', text: `${name}: ${t}${over > 3 ? ': the input stage saturates and can be damaged' : ''}. Add a pad in front of it.` }); }
      rec(name, 'amp', before, { gain: G, nf: nfe, over: over > 0 ? over : undefined, note: note || info, agcUs: agc === '' || agc == null || !Number.isFinite(+agc) ? null : +agc });
      if (note && over <= 0) alarms.push({ sev: 'warn', text: `${name}: ${note}.` });
    }

    rec(A.name, 'tx', snap(), { note: `Tx ${f1(txDbm)} dBm, Tx OSNR ${mode.txOsnr} dB` });
    // degraded add/drop ports on the service channel's route: the add side costs the signal before the line, the drop side after it
    const sdeg = !W ? portDeg(path.nodes.map(id => node(id)), chans[svcIdx].slot, path.links.map(id => link(id))) : { add: 0, drop: 0, hits: [] };
    // The add side is an offset for this channel alone: the amplifiers go on following the other channels, so it stays low at every span. Its transmitter noise passes the port with it.
    if (sdeg.add > 0) Pase *= lin(-sdeg.add);
    let losAt = null;
    for (let i = 0; i < path.links.length; i++) {
      const l = link(path.links[i]), nxt = node(path.nodes[i + 1]), prv = node(path.nodes[i]);
      if (isCut(S, l)) { losAt = l; hops.push({ name: linkName(l), kind: 'cut', in: snap(), out: { sig: -99, ase: -99, nli: -99 }, km, nch, note: l.p.cut ? 'Fiber cut' : `Fiber cut (shared risk group ${l.p.srlg})` }); break; }
      if (l.kind === 'patch') { const b = snap(), lo = +l.p.il + PATCH_ATT * patchKm(l); loss(lo); rec('patch', 'patch', b, { gain: -lo, note: patchKm(l) >= 0.0095 ? `${+(patchKm(l) * 1000).toPrecision(3)} m of cord` : undefined }); }
      else {
        const fb = PHY_.FIBERS[l.p.fiber], Lk = +l.p.len, b = snap();
        // Per-span loading: from this fiber onward (until a mux or ROADM changes it) only this many channels are lit.
        if (planOn) { curAct = maskAt(i); nch = curAct.filter(Boolean).length; } // the plan decides which channels ride this span
        else if (l.p.nch !== '' && l.p.nch != null) nch = Math.min(96, Math.max(1, Math.round(+l.p.nch)));
        maxNch = Math.max(maxNch, nch);
        const sl = fb.att * Lk + +pd(l.p, 'extra') + (eol ? eolSpan : 0);
        let nfDist = null; // the span's effective noise figure when the solver's distributed noise is used
        const pump = Math.min(PHY_.RAMAN.maxMw, Math.max(0, +pd(l.p, 'raman') || 0));
        const rdir = ['back', 'fwd', 'both'].includes(l.p.ramanDir) ? l.p.ramanDir : 'back', npump = Math.min(3, Math.max(1, Math.round(+l.p.ramanPumps || 1)));
        const pb = rdir === 'fwd' ? 0 : rdir === 'both' ? pump / 2 : pump, pf = rdir === 'back' ? 0 : rdir === 'both' ? pump / 2 : pump;
        const sigW = nch * P; // total signal power entering the span; the backward pump sees the signal after the span loss
        // The coupled-wave solver (per fiber, "ramanFull") replaces the closed-form gain, depletion and gain-spectrum approximations.
        const act0 = planOn ? curAct : null, wantView = pump > 0 && !eol && !rv && !W && !opts.single;
        const solved = pump > 0 && (l.p.ramanFull || wantView) ? ramanSpanSolve(fb, Lk, pb, pf, npump, act0) : null, useSolver = !!(solved && l.p.ramanFull);
        const sb = useSolver ? { gain: solved.gb, g0: solved.g0b, depletion: solved.depl } : PHY_.ramanGainSat(fb, Lk, pb, sigW, sl), sf = useSolver ? { gain: solved.gf, g0: solved.g0f, depletion: solved.depl } : PHY_.ramanGainSat(fb, Lk, pf, sigW, sl);
        const gb = sb.gain, gf = sf.gain, gr = gb + gf, depl = Math.max(sb.depletion, sf.depletion);
        if (wantView && solved) ramanViews.push({ id: l.id, name: linkName(l), km: Lk, solver: useSolver, npump, pumps: solved.pumps, gainSvcDb: solved.gS, approxDb: useSolver ? null : gr, depletion: solved.depl, samples: solved.samples, gainDb: solved.gainDb, profile: solved.profile, svcTHz: chans[svcIdx].fTHz, ripple: solved.spread });
        // Raman lifts the power profile along the span, so the fiber looks less lossy to the nonlinearity (more so when pumped forward).
        const fbNl = gr > 0 ? { ...fb, att: Math.max(0.05, (fb.att * Lk - gr) / Lk) } : fb;
        const act = planOn ? curAct : null, full = planOn || nch === nChan, fwdF = PHY_.ramanFwdNliFactor(gf);
        // Plan mode: this channel's nonlinear noise depends on who its neighbours are (baud rate, power, distance).
        const actList = planOn ? chans.map((c, k) => (act[k] ? { f: c.f, Rs: c.Rs, P: lin(c.off), k } : null)).filter(Boolean) : null;
        const si = planOn ? actList.findIndex(c => c.k === svcIdx) : -1, nF = si >= 0 ? PHY_.nliPlanFactor(fbNl, actList, si, df, actList.length) : 1;
        const nNew = PHY_.etaNLI(fbNl, Lk, Rs, nch, df) * P ** 3 * fwdF * nF;
        if (mode.coh === false && nch > 1) { // cross-phase modulation from the other channels hits a direct-detection receiver
          xpmPen = Math.min(PHY_.XPM.cap, xpmPen + PHY_.xpmSpanPenalty(fbNl, Lk, 1, P, xpmWFor(svcIdx, act, fbNl, Lk)));
        }
        const rho = PHY_.nliCorrelation(cd);
        Pnli += nNew + 2 * rho * Math.sqrt(Pnli * nNew); // coherent cross term when the dispersion map is flat
        // Raman gain spectrum: channels at different frequencies see different gain, relative to the service channel.
        const rel = gr > 0 && full ? (useSolver ? chans.map(c => solved.relFn(c.fTHz)) : chans.map(c => PHY_.ramanRel(npump, c.fTHz, chans[svcIdx].fTHz))) : null;
        const relAct = rel && act ? rel.filter((_, k) => act[k]) : rel;
        const ripplePP = relAct ? gr * (Math.max(...relAct) - Math.min(...relAct)) : 0;
        if (planOn) ev.push({ k: 'S', fbNl, Lk, nch, act: act.slice(), fwdF, rho, dcd: fb.D * Lk, dg2: fb.pmd ** 2 * Lk, xpm: nch > 1 });
        if (gr > 0) mpi += PHY_.drsRatio(gr, fb, Lk);
        tilt += PHY_.srsTilt(fb, Lk, P, nch, df) + ripplePP;
        if (gr > 0 && useSolver && solved.aseFn) {
          // Distributed Raman noise from the coupled-wave solver: the noise generated all along the span, in place of the equivalent lumped amplifiers below.
          const exDb = sl - fb.att * Lk, aseS = solved.aseFn(chans[svcIdx].fTHz), gNet = lin(gr - fb.att * Lk);
          loss(sl); P *= lin(gr); Pnli *= lin(gr);
          Pase = Pase * lin(gr) + PHY_.H * PHY_.NU * PHY_.BREF * aseS * lin(-exDb);
          nfDist = db((aseS + 1) / gNet);
          if (planOn) ev.push({ k: 'RD', gain: gr, ex: lin(-exDb), aseFn: solved.aseFn, rel });
        } else if (gr > 0) {
          // Equivalent lumped amplifiers. Backward pump: gain late in the span (noiseFrac * gain dB of loss still ahead of the signal),
          // so most of the span loss is paid before the noise enters. Forward pump: gain early, noisier (pump RIN) and no OSNR benefit.
          let c = 0;
          const stage = (pos, gain, nf) => { loss(pos - c); c = pos; P *= lin(gain); Pnli *= lin(gain); Pase = Pase * lin(gain) + lin(nf) * PHY_.H * PHY_.NU * lin(gain) * PHY_.BREF; if (planOn) ev.push({ k: 'R', gain, nf, rel }); };
          if (gf > 0) stage(Math.min(sl, PHY_.RAMAN.fwdPreLoss), gf, PHY_.RAMAN.fwdNf);
          if (gb > 0) stage(Math.max(c, sl - PHY_.RAMAN.noiseFrac * gb), gb, PHY_.RAMAN.nf);
          loss(sl - c);
        } else loss(sl);
        cd += fb.D * Lk; dgd2 += fb.pmd ** 2 * Lk; km += Lk;
        rec(`${Lk} km ${fb.name.split(' ')[0]}`, 'span', b, { gain: gr - sl, len: Lk, launch: b.sig, ...(gr > 0 ? { raman: gr, note: `Raman ${rdir === 'both' ? 'bidirectional' : rdir === 'fwd' ? 'forward' : 'backward'} pump ${pump} mW (${npump}): +${gr.toFixed(1)} dB on-off gain` + (depl > 0.05 ? `, pump depletion cost ${(sb.g0 + sf.g0 - gr).toFixed(1)} dB` : '') + (nfDist != null ? `; distributed noise: the span's effective noise figure is ${nfDist.toFixed(1)} dB` : '') } : {}) });
        if (depl > 0.15 && !eol && !rv) alarms.push({ sev: 'info', text: `${linkName(l)}: signal power is depleting the Raman pump (${Math.round(depl * 100)}% of its photons): about ${f1(sb.g0 + sf.g0 - gr)} dB of gain lost. Add pump power or reduce channels.` });
        if (pump > PHY_.RAMAN.warnMw) alarms.push({ sev: 'warn', text: `${linkName(l)}: ${pump} mW Raman pump is a Class 4 laser. Check connector cleanliness (fiber-fuse risk) and eye safety.` });
        if (gr > 0 && !eol && !rv && +l.p.raman > PHY_.RAMAN.maxMw) alarms.push({ sev: 'info', text: `${linkName(l)}: pump limited to ${PHY_.RAMAN.maxMw} mW.` });
      }
      if (i + 1 === path.links.length) break;
      if (isDead(nxt)) { losAt = { node: nxt }; hops.push({ name: nxt.name, kind: 'cut', in: snap(), out: { sig: -99, ase: -99, nli: -99 }, km, nch, note: 'Device failed' }); break; }
      const t = nxt.type, nnext = node(path.nodes[i + 2]);
      // an EDFA next to a single fiber (both directions in one glass): a one-way amplifier has isolators, so only the direction it faces gets through;
      // a BiDi one has band filters and circulators around two amplifier paths, which cost a little loss in each direction
      const onSingle = t === 'edfa' && [path.links[i], path.links[i + 1]].some(id => { const q = link(id); return q && q.kind === 'fiber' && q.p.single; });
      if (onSingle && rv && !nxt.p.bidi) { losAt = { node: nxt, oneWay: true }; hops.push({ name: nxt.name, kind: 'cut', in: snap(), out: { sig: -99, ase: -99, nli: -99 }, km, nch, note: 'One-way amplifier on a single fiber' }); break; }
      if (onSingle && nxt.p.bidi) { const lo = +nxt.p.bidiLoss || 0; if (lo > 0) { const b0 = snap(); loss(lo); rec(nxt.name + ' band filters', 'bidi', b0, { gain: -lo, note: `BiDi amplifier: circulators and band filters, ${f1(lo)} dB each way` }); } }
      const tv = pd(nxt.p, 'target'), target = tv === '' || tv == null ? +g.launch : +tv;
      if (t === 'mux') {
        const joins = isEnd(prv), drops = isEnd(nnext);
        const b = snap(); loss(+nxt.p.il + degOf(nxt));
        if (joins) nch = nchLine;
        if (drops) nch = 1;
        if (planOn) { if (!drops) nch = litCount(i + 1); curAct = maskAt(i + 1); }
        rec(nxt.name, 'mux', b, { gain: -nxt.p.il, note: joins ? 'mux: channel joins the line' : drops ? 'demux: channel dropped' : '' });
      } else if (t === 'oadm') {
        // Passive add/drop filter: through channels take the small pass-through loss with no equalisation; channels added or dropped take the add/drop
        // loss (a transponder plugged into a port, or a plan channel that starts or ends here); added ones join at their own transmit power less the
        // add loss, so they can sit above or below the line channels. A 1310 nm coupler adds a little loss to the line path.
        const p = nxt.p, k = i + 1, leaving = members.filter(m => m.hi === k && k < lastPos).map(m => m.k), joining = members.filter(m => m.lo === k).map(m => m.k);
        const joinsX = isEnd(prv), dropsX = isEnd(nnext);
        if (leaving.length) ev.push({ k: 'D', idx: leaving, G: 1, nfe: 0, f: lin(-(+p.ad)) });
        const b = snap(), lo = (joinsX || dropsX ? +p.ad : +p.thru) + (p.p1310 || p.osc ? P1310_LOSS : 0) + degOf(nxt); loss(lo);
        if (joinsX && !planOn) nch = nchLine;
        if (dropsX) nch = 1;
        if (planOn) { if (joining.length) ev.push({ k: 'J', idx: joining, padd: lin(+p.tx - +p.ad) / 1000 }); if (!dropsX) nch = litCount(k); curAct = maskAt(k); }
        rec(nxt.name, 'oadm', b, { gain: -lo, note: (joinsX ? 'add port' : dropsX ? 'drop port' : 'passive filter') + (leaving.length ? `, ${leaving.length} channel${leaving.length > 1 ? 's' : ''} dropped (${+p.ad} dB)` : '') + (joining.length ? `, ${joining.length} added (${+p.ad} dB)` : '') });
      } else if (t === 'panel') {
        // A patch panel passes the light from one side of a port to the other: the loss of the connector pair, plus whatever a dirty or damaged connector adds on that port.
        const pn = +(/\d+/.exec(oadmSide(link(path.links[i]), nxt.id)) || [0])[0], dirty = +(nxt.p.dirty && nxt.p.dirty[pn]) || 0, b = snap(), lo = +nxt.p.il + dirty + degOf(nxt); refl.push({ name: `${nxt.name} port ${pn}`, rl: connRL(nxt, dirty), lvl: db(P * 1000) }); loss(lo);
        if (planOn) { nch = litCount(i + 1); curAct = maskAt(i + 1); }
        if (dirty > 0.3 && !eol && !rv && !W) alarms.push({ sev: 'warn', text: `${nxt.name} port ${pn}: a dirty or damaged connector costs ${f1(dirty)} dB extra. Clean it.`, fix: fixClean(nxt, pn) });
        rec(nxt.name, 'panel', b, { warn: dirty > 0.3 ? true : undefined, port: pn, inSide: oadmSide(link(path.links[i]), nxt.id), gain: -lo, note: `port ${pn}: ${f1(+nxt.p.il)} dB` + (dirty ? ` + ${f1(dirty)} dB dirty connector` : '') });
      } else if (t === 'splitter' || t === 'switch') {
        // A splitter sends the light to both branches: the branch the route takes gets its share of the power (a 99/1 tap costs 0.05 dB on the main
        // branch and 20 dB on the tap). A switch passes one branch for about 1 dB. Which branch is the route's cable on that side of the device.
        const inP = oadmSide(link(path.links[i]), nxt.id), branch = inP !== 'c' ? inP : oadmSide(link(path.links[i + 1]), nxt.id);
        if (t === 'switch' && !W && !eol && !rv && branch !== (nxt.p.pos === 'b' ? 'b' : 'a')) failovers.push({ id: nxt.id, name: nxt.name, from: nxt.p.pos === 'b' ? 'b' : 'a', to: branch, revertive: !!nxt.p.revertive, wtrMin: +nxt.p.wtrMin || 0 });
        const b = snap(), lo = (t === 'splitter' ? splitLossDb(nxt, branch) : +nxt.p.il) + degOf(nxt); loss(lo);
        if (planOn) { nch = litCount(i + 1); curAct = maskAt(i + 1); }
        rec(nxt.name, t, b, { inP, outP: inP === 'c' ? branch : 'c', gain: -lo, note: t === 'splitter' ? `${nxt.p.ratio} splitter, port ${branch.toUpperCase()}: ${f1(lo)} dB` : `switch passing port ${branch.toUpperCase()}${nxt.p.pos === branch ? '' : ' (it switched away from the selected port)'}` });
      } else if (t === 'dcm') { const b = snap(); const dil = +pd(nxt.p, 'il') + degOf(nxt), dcd = +pd(nxt.p, 'cd'); loss(dil); cd += dcd; dgd2 += 1; if (planOn) ev.push({ k: 'C', dcd, dg2: 1 }); rec(nxt.name, 'dcm', b, { gain: -dil, note: `${dcd} ps/nm` }); }
      else if (t === 'voa') { const b = snap(), att = +nxt.p.att + degOf(nxt); loss(att); rec(nxt.name, 'voa', b, { gain: -att }); }
      else if (t === 'edfa') { amp(nxt.name, pd(nxt.p, 'nf'), nxt.p.ctl, target, pd(nxt.p, 'gain'), +pd(nxt.p, 'gmin'), +pd(nxt.p, 'gmax'), +pd(nxt.p, 'pmax'), nxt.p.tiltCtl !== false, tv === '' || tv == null ? i + 1 : -1, nxt.p.agcUs, degOf(nxt), +pd(nxt.p, 'pinMax')); }
      else if (t === 'roadm') {
        const add = isEnd(prv) || prv.type === 'mux', drop = isEnd(nnext) || nnext.type === 'mux';
        const p = nxt.p, np = add || drop ? 1 : 2;
        if (add) nch = planOn ? litCount(i + 1) : nchLine;
        if (p.amps && !add) amp(nxt.name + ' pre', p.nf, 'auto', +g.launch + (drop ? 4 : 0), 0, 0, 35, 24, true);
        const k = i + 1, leaving = members.filter(m => m.hi === k && k < lastPos).map(m => m.k), joining = members.filter(m => m.lo === k).map(m => m.k);
        // Channels that leave here take the drop port (one WSS pass, the drop structure and a drop amplifier) instead of expressing through.
        if (leaving.length) { const dg = p.amps ? 4 : 0; ev.push({ k: 'D', idx: leaving, G: lin(dg), nfe: PHY_.ampNfEff(+p.nf, dg), f: lin(-(+p.wss + +p.ad)) }); }
        const b = snap(); const lo = np * +p.wss + (add || drop ? +p.ad : 0) + degOf(nxt); loss(lo); passes += np; tiltSeen.push(tilt); tilt = 0;
        if (planOn) { ev.push({ k: 'W', n: np }); ev.push({ k: 'Z', wss: true }); if (joining.length) ev.push({ k: 'J', idx: joining }); curAct = maskAt(k); } // the WSS equalises every channel, added ones join at the same level
        rec(nxt.name + (add ? ' add' : drop ? ' drop' : ' express'), 'roadm', b, { gain: -lo, note: `${np} WSS pass${np > 1 ? 'es' : ''}` + (leaving.length ? `, ${leaving.length} channel${leaving.length > 1 ? 's' : ''} dropped` : '') + (joining.length ? `, ${joining.length} added` : '') });
        if (planOn && !drop) nch = litCount(k);
        if (p.amps && !drop) amp(nxt.name + ' boost', p.nf + 0.5, 'auto', +g.launch, 0, 0, 35, 24, true, i + 1);
        if (drop) nch = 1;
      }
      // a transponder in the middle of a path is never traversed (route() forbids it)
    }

    if (planOn && Z.type === 'roadm' && !losAt) { // the walk ends at a ROADM: the channels that arrive here take its drop port
      const p = Z.p, b = snap();
      if (p.amps) amp(Z.name + ' pre', p.nf, 'auto', +g.launch + 4, 0, 0, 35, 24, true);
      ev.push({ k: 'D', idx: members.filter(m => m.hi === lastPos).map(m => m.k), G: 1, nfe: 0, f: lin(-(+p.wss + +p.ad)) });
      rec(Z.name + ' drop', 'roadm', b, { gain: -(+p.wss + +p.ad), note: 'drop port' });
    }
    if (planOn && Z.type === 'oadm' && !losAt) { // the walk ends at a passive OADM: arriving channels take its drop port
      const b = snap(), l = +Z.p.ad + degOf(Z);
      ev.push({ k: 'D', idx: members.filter(m => m.hi === lastPos).map(m => m.k), G: 1, nfe: 0, f: lin(-l) });
      rec(Z.name + ' drop', 'oadm', b, { gain: -l, note: 'drop port' });
    }
    // 1+1 protection on signal fail: if the working route is down (not just cut) and the protection route carries the service, switch to it.
    const switchIfBetter = r0 => {
      if (!svcProt || svcOnProt || opts.useProtect || eol || W || !(r0.status === 'down' || r0.status === 'los')) return r0;
      const r2 = simulate(S, launchOverride, { ...opts, useProtect: true });
      if (!r2.mode || (STATUS_RANK[r2.status] ?? 0) >= (STATUS_RANK[r0.status] ?? 0)) return r0;
      r2.alarms.unshift({ sev: 'warn', text: `The working route is down (${r0.headline}): traffic switched to the protection route. There is no protection left.` });
      r2.switched = true; return r2;
    };
    if (isEnd(Z) && spareLoss(Z)) loss(spareLoss(Z)); // the switch or y-cable in front of the receiver
    for (const f of failovers) alarms.push({ sev: 'info', text: `${f.name} moved from port ${f.from.toUpperCase()} to port ${f.to.toUpperCase()}: the light is on the protection path. ${f.revertive ? `It goes back to port ${f.from.toUpperCase()} after the repair and ${f.wtrMin} min of stable light (wait-to-restore), with a second short hit.` : `It stays on port ${f.to.toUpperCase()} after the repair (non-revertive), and port ${f.from.toUpperCase()} becomes the standby.`}` });
    const res = { failovers, mode, modeKey, A, Z, path, raman: ramanViews, hops, alarms, km, cd, dgd: Math.sqrt(dgd2), passes, g, rerouteCut, txDbm };
    if (!eol && !rv && !W && S.nodes.some(n => n.type === 'oadm' && (n.p.p1310 || n.p.osc))) {
      res.b1310 = band1310(S); res.osc = oscSpans(S);
      for (const r of res.b1310.links) if (r.status === 'down' || (r.status === 'warn' && /overload/.test(r.why))) alarms.push({ sev: 'warn', text: `The 1310 nm link ${r.aName} to ${r.bName} ${r.status === 'down' ? 'is down' : 'is overloaded'}: ${r.why}.` });
      if (res.osc) {
        for (const r of res.osc.links) if (r.status === 'down' || (r.status === 'warn' && /overload/.test(r.why))) alarms.push({ sev: 'warn', text: `The supervisory channel span ${r.aName} to ${r.bName} ${r.status === 'down' ? 'is down' : 'is overloaded'}: ${r.why}.` });
        res.osc.domains.length > 1 && alarms.push({ sev: 'warn', text: `The supervisory channel is split into ${res.osc.domains.length} management domains: ${res.osc.domains.map(d => d.join(' + ')).join('; ')}.` });
      }
    }
    if (!eol && !rv && !W) { const ms = S.nodes.filter(n => n.type === 'meter'); if (ms.length) { res.meters = {}; ms.forEach(n => { res.meters[n.id] = meterRead(S, hops, n); }); } }
    if (S._derived) { res.derived = S._derived; if (!eol && !rv && !W) for (const dk of S._derived.dark) alarms.push({ sev: 'warn', text: dk.why }); }
    // Muxponder client ports: per-port optical budget plus rate aggregation into the line port.
    const clientFatal = [];
    res.clients = [];
    if (!eol && !rv && !W) {
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
    if (losAt) {
      res.status = 'los'; res.prx = -Infinity;
      // say what is wrong and what to do about it, in the headline and as an alarm (the KPIs are empty when there is no light)
      if (losAt.oneWay) { res.headline = `LOS at ${Z.name}: ${losAt.node.name} is a one-way amplifier on a single fiber, so the reverse direction cannot pass it. Make it a BiDi amplifier.`; if (!W) { res.headlineFix = fixBidi(losAt.node); alarms.push({ sev: 'bad', text: `${losAt.node.name} sits on a single fiber but amplifies one direction only (its isolators block the other). A single fiber carries both directions, so the reverse path is lost: use a bidirectional (BiDi) amplifier, which has circulators and band filters around two amplifier paths.`, fix: fixBidi(losAt.node) }); } }
      else if (losAt.node) { res.headline = `LOS at ${Z.name}: ${losAt.node.name} has failed. Replace it, or give the service a route around it.`; if (!W) { res.headlineFix = fixWork(losAt.node); alarms.push({ sev: 'bad', text: `${losAt.node.name} has failed and passes no light, so nothing reaches ${Z.name}. Set it back to Working, or add a route that avoids it.`, fix: fixWork(losAt.node) }); } }
      else { res.headline = `LOS at ${Z.name}: fiber cut on ${linkName(losAt)}. Splice it back, or add a second route.`; if (!W) { res.headlineFix = fixSplice(losAt); alarms.push({ sev: 'bad', text: `${linkName(losAt)} is cut, so no light reaches ${Z.name}. Splice it back, or give the service a second fiber route (Protect, in the Channels tab).`, fix: fixSplice(losAt) }); } }
      return res;
    }
    if (sdeg.add > 0) P *= lin(-sdeg.add); // the offset it has carried the whole way
    if (sdeg.drop > 0) { const f = lin(-sdeg.drop); P *= f; Pase *= f; Pnli *= f; }
    const prx = db(P * 1000); res.prx = prx;
    if (prx < mode.rxMin - 12 && !W) {
      res.status = 'los'; res.headline = `LOS at ${Z.name}: ${f1(prx)} dBm is below what the receiver can detect.`;
      { const sp = ampSpot(S, path), fx = sp && !W ? fixAmp(S, sp) : null; if (fx) res.headlineFix = fx;
        alarms.unshift({ sev: 'bad', text: `Rx power ${f1(prx)} dBm is far below the ${f1(mode.rxMin)} dBm sensitivity. Add gain before the receiver or remove loss: the hop table shows where the power goes.`, fix: fx }); }
      return switchIfBetter(res);
    }
    // Two reflectors with gain between them make a double-reflected copy: its power relative to the signal is -RL1 - RL2 + 2 x (net gain between them).
    // Fiber loss between them shrinks it; an amplifier between them grows it, and at 0 dB or more the pair is a laser cavity.
    let worstRefl = null;
    for (let a = 0; a < refl.length; a++) for (let b = a + 1; b < refl.length; b++) {
      const x = -refl[a].rl - refl[b].rl + 2 * (refl[b].lvl - refl[a].lvl); mpi += lin(x);
      if (!worstRefl || x > worstRefl.x) worstRefl = { x, a: refl[a].name, b: refl[b].name };
    }
    res.reflection = worstRefl;
    if (worstRefl && worstRefl.x > -30 && !eol && !rv && !W) alarms.push({ sev: worstRefl.x > -15 ? 'bad' : 'warn', text: `Reflections between ${worstRefl.a} and ${worstRefl.b}: the double-reflected copy is ${f1(worstRefl.x)} dB below the signal${worstRefl.x > -15 ? ', close enough to an amplifier lasing or a service-killing ripple' : ', which adds multipath noise'}. Clean the dirty connector, use an APC polish (65 dB return loss) or cut the gain between them.` });
    const snrAse = (P / Pase) * PHY_.BREF / Rs, snrNli = Pnli > 0 ? P / Pnli : Infinity;
    const snrRx = lin(prx - mode.rxMin + 25), snrTrx = lin(mode.snrTrx);
    const line = 1 / (1 / snrAse + 1 / snrNli + 1 / snrRx + mpi);
    const filt = passes * PHY_.filterPenaltyPerPass(Rs, df);
    const over = Math.max(0, prx - mode.rxMax) * 1.5;
    const pmdPen = (res.dgd / mode.dgdTol) ** 2;
    tiltSeen.push(tilt);
    const peakTilt = Math.max(...tiltSeen), edgeTilt = tiltSeen.reduce((a, b) => a + b, 0) / tiltSeen.length;
    const agePen = eol ? eolTrx : 0, cdPen = PHY_.cdPenalty(mode, cd), tiltPos = planOn ? tiltPenaltyFor(chans, svcIdx, edgeTilt) : 0, rxDeg = degOf(Z), basePen = filt + over + pmdPen + cdPen + xpmPen + tiltPos + agePen + rxDeg;
    const eff = PHY_.effSnr(mode, line, basePen);
    const ber = PHY_.MODS[mode.mod].ber(eff);
    // The service channel sits mid-band. The highest-frequency channel gives up half the SRS tilt to the lowest, so it is the worst one.
    const effEdge = PHY_.effSnr(mode, line, basePen + edgeTilt / 2), berEdge = PHY_.MODS[mode.mod].ber(effEdge);
    Object.assign(res, {
      osnr: db(P / Pase), gosnr: db(1 / (1 / snrAse + 1 / snrNli + mpi) * Rs / PHY_.BREF), snrAse, snrNli, snrRx, snrTrx, effDb: db(eff),
      ber, q: PHY_.qFromBer(ber), qThr: PHY_.qFromBer(mode.berThr), filt, over, pmdPen, cdPen, xpmPen, req: reqOsnr(modeKey),
      budget: { ase: 1 / snrAse, nli: 1 / snrNli, trx: 1 / snrTrx, rx: 1 / snrRx, mpi },
    });
    res.qMargin = res.q - res.qThr; res.osnrMargin = res.gosnr - res.req;
    // Power transient: lose lossPct of the channels at every amplifier at once. A gain-controlled EDFA would raise the survivors by
    // 10log10(N / survivors) if it did not react; its control loop (agcUs) holds off all but a fraction 1 - exp(-agcUs / tau) of that, and the
    // excursions of a cascade add. The same amount of dip follows when the channels come back.
    if (!eol && !W) {
      const T = PHY_.TRANSIENT, frac = Math.min(95, Math.max(1, Number.isFinite(+g.lossPct) && g.lossPct !== '' ? +g.lossPct : T.lossPct)) / 100, agcG = Number.isFinite(+g.agcUs) && g.agcUs !== '' ? +g.agcUs : T.agcUs;
      let cum = 0; const rows = [];
      for (const h of hops) {
        if (h.kind !== 'amp' || !(h.nch >= 2)) continue;
        const n = Math.round(h.nch), lost = Math.max(1, Math.round(frac * (n - 1))), raw = db(n / (n - lost)), agc = h.agcUs ?? agcG, peak = raw * (1 - Math.exp(-agc / T.tauUs));
        cum += peak; rows.push({ name: h.name, n, lost, rawDb: raw, agcUs: agc, peakDb: peak, cumDb: cum });
      }
      if (rows.length) {
        // Time domain at the receiver: each amplifier's excursion rises as 1 - exp(-t/tau) until its control engages at agcUs, then the loop pulls
        // it back (recovery about twice the response time). The event, and every excursion it causes, travel with the signal, so all amplifiers'
        // curves line up in time at the receiver and add. Channels returning can be ramped (rampMs): a ramp slower than tau lets the loop follow.
        const tc = k => Math.max(k, 5) * 2, xr = (r, t) => { const td = r.agcUs; if (td <= 0) return 0; if (t <= td) return r.rawDb * (1 - Math.exp(-t / T.tauUs)); return r.rawDb * (1 - Math.exp(-td / T.tauUs)) * Math.exp(-(t - td) / tc(td)); };
        const tEnd = Math.max(1000, ...rows.map(r => r.agcUs * 6 + 4 * T.tauUs)), tt = Array.from({ length: 121 }, (_, i) => tEnd * (i / 120) ** 2), surge = tt.map(t => rows.reduce((a, r) => a + xr(r, t), 0));
        const rampUs = Math.max(0, Number.isFinite(+g.rampMs) && g.rampMs !== '' ? +g.rampMs : 0) * 1000, rampF = rampUs > T.tauUs ? (T.tauUs / rampUs) * (1 - Math.exp(-rampUs / T.tauUs)) : 1;
        res.transientTrace = { t: tt, surge, dip: surge.map(v => -v * rampF), rampF, rampMs: rampUs / 1000, peakDb: Math.max(...surge) };
        const avg = rows.reduce((a, r) => a + r.cumDb, 0) / rows.length;
        // average excursion over the spans for the nonlinear and noise terms, end-of-line excursion for the receiver
        const qAt = s => { const ln = 1 / (1 / snrAse * lin(-s) + 1 / snrNli * lin(2 * s) + 1 / snrRx * lin(-s) + mpi), ov = Math.max(0, prx + s - mode.rxMax) * 1.5;
          return PHY_.qFromBer(PHY_.MODS[mode.mod].ber(PHY_.effSnr(mode, ln, basePen - over + ov))) - res.qThr; };
        const s = cum, prxSurge = prx + s, rf = res.transientTrace.rampF, prxDip = prx - cum * rf;
        res.transient = { lossPct: Math.round(frac * 100), tauUs: T.tauUs, rows, surgeDb: s, peakDb: res.transientTrace.peakDb, prxSurge, prxDip, rampF: rf, overload: prxSurge > mode.rxMax, qMarginSurge: qAt(avg), qMarginDip: qAt(-avg * rf), avgDb: avg };
        const t = res.transient;
        if (t.overload) alarms.push({ sev: 'info', text: `Losing ${t.lossPct}% of the channels at once would lift the surviving channels by up to ${f1(s)} dB at the receiver (${f1(prxSurge)} dBm, past the ${mode.rxMax} dBm overload point) with these amplifier control speeds.` });
        else if (t.qMarginSurge < 0) alarms.push({ sev: 'info', text: `Losing ${t.lossPct}% of the channels at once would push the service below the FEC threshold for a moment (${f1(t.qMarginSurge)} dB Q margin during the surge).` });
        if (t.qMarginDip < 0 && !t.overload) alarms.push({ sev: 'info', text: `Restoring those channels at once would dip the service below the FEC threshold for a moment (${f1(t.qMarginDip)} dB Q margin).` });
      }
    }
    res.tilt = peakTilt; res.worstQMargin = PHY_.qFromBer(berEdge) - res.qThr;
    // Plan mode: replay the event log for every channel with its own mode, baud rate, power offset, frequency and neighbours.
    // A channel exists from the node where it is added to the node where it is dropped; its state is frozen (fin) when it leaves.
    if (planOn && !eol) {
      const N = nChan, hnb = PHY_.H * PHY_.NU * PHY_.BREF, P0 = lin(txDbm) / 1000;
      const Pc = new Array(N).fill(0), Pa = new Array(N).fill(0), Pn = new Array(N).fill(0), xp = new Array(N).fill(0), cdc = new Array(N).fill(0), dg2 = new Array(N).fill(0), psc = new Array(N).fill(0);
      const alive = chans.map((_, i) => !!lohi[i] && lohi[i].lo === 0), fin = new Array(N).fill(null);
      // each channel's own degraded ports: the add side before it reaches the line, the drop side after
      const dgf = new Array(N).fill(1); // the level a degraded add port keeps a channel below the others until a WSS levels it
      const dgs = chans.map((c, i) => (lohi[i] ? portDeg(path.nodes.slice(lohi[i].lo, lohi[i].hi + 1).map(id => node(id)), c.slot, path.links.slice(lohi[i].lo, lohi[i].hi).map(id => link(id))) : { add: 0, drop: 0, hits: [] }));
      chans.forEach((c, i) => { if (alive[i]) { dgf[i] = lin(-dgs[i].add); Pc[i] = P0 * lin(c.off) * dgf[i]; Pa[i] = Pc[i] / lin(c.m.txOsnr); } });
      let sP = P0;
      const each = fn => { for (let i = 0; i < N; i++) if (alive[i]) fn(i); };
      const freeze = i => { const fd = lin(-dgs[i].drop); fin[i] = { Pc: Pc[i] * fd, Pa: Pa[i] * fd, Pn: Pn[i] * fd, xp: xp[i], cd: cdc[i], dg2: dg2[i], ps: psc[i] }; alive[i] = false; };
      for (const e of ev) {
        if (e.k === 'L') { sP *= e.f; each(i => { Pc[i] *= e.f; Pa[i] *= e.f; Pn[i] *= e.f; }); }
        else if (e.k === 'A') { sP *= e.G; each(i => { Pc[i] *= e.G; Pn[i] *= e.G; Pa[i] = Pa[i] * e.G + lin(e.nfe) * hnb * e.G; }); }
        else if (e.k === 'RD') { sP *= lin(e.gain); each(i => { const gi = lin(e.gain * (e.rel ? e.rel[i] : 1)); Pc[i] *= gi; Pn[i] *= gi; Pa[i] = Pa[i] * gi + hnb * e.aseFn(chans[i].fTHz) * e.ex; }); }
        else if (e.k === 'R') { sP *= lin(e.gain); each(i => { const gi = lin(e.gain * (e.rel ? e.rel[i] : 1)); Pc[i] *= gi; Pn[i] *= gi; Pa[i] = Pa[i] * gi + lin(e.nf) * hnb * gi; }); }
        else if (e.k === 'Z') each(i => { if (e.wss) dgf[i] = 1; const c = sP * lin(chans[i].off) * dgf[i] / Pc[i]; Pc[i] *= c; Pn[i] *= c; Pa[i] *= c; }); // tilt control keeps a channel's own offset and weak port; a WSS levels everything
        else if (e.k === 'C') each(i => { cdc[i] += e.dcd; dg2[i] += e.dg2; });
        else if (e.k === 'W') each(i => { psc[i] += e.n; });
        else if (e.k === 'D') for (const i of e.idx) {
          if (!alive[i]) continue;
          Pc[i] *= e.G * e.f; Pn[i] *= e.G * e.f; Pa[i] = (Pa[i] * e.G + (e.G > 1 ? lin(e.nfe) * hnb * e.G : 0)) * e.f; psc[i] += 1;
          freeze(i);
        }
        else if (e.k === 'J') for (const i of e.idx) { // added at this ROADM: level with the express channels, own transmitter noise, nothing accumulated yet
          dgf[i] = lin(-dgs[i].add); Pc[i] = (e.padd != null ? e.padd : sP) * lin(chans[i].off) * dgf[i]; Pa[i] = Pc[i] / lin(chans[i].m.txOsnr); Pn[i] = 0; xp[i] = 0; cdc[i] = 0; dg2[i] = 0; psc[i] = 1; alive[i] = true;
        }
        else if (e.k === 'S') {
          const pl = chans.map((c, j) => ({ f: c.f, Rs: c.Rs, P: lin(c.off) })).filter((_, j) => e.act[j]), at = chans.map((_, j) => j).filter(j => e.act[j]);
          for (const i of at) {
            if (!alive[i]) continue;
            const nNew = PHY_.etaNLI(e.fbNl, e.Lk, chans[i].Rs, e.nch, df) * Pc[i] ** 3 * e.fwdF * PHY_.nliPlanFactor(e.fbNl, pl, at.indexOf(i), df, at.length);
            Pn[i] += nNew + 2 * PHY_.nliCorrelation(cdc[i]) * Math.sqrt(Pn[i] * nNew);
            if (chans[i].m.coh === false && e.xpm) xp[i] = Math.min(PHY_.XPM.cap, xp[i] + PHY_.xpmSpanPenalty(e.fbNl, e.Lk, 1, Pc[i], xpmWFor(i, e.act, e.fbNl, e.Lk)));
            cdc[i] += e.dcd; dg2[i] += e.dg2;
          }
        }
      }
      for (let i = 0; i < N; i++) if (alive[i]) freeze(i);
      res.segments = chans.map((c, i) => {
        const m = c.m, f = fin[i]; if (!f || !lohi[i]) return null; // a member of another walk: filled in below
        const prx = db(f.Pc * 1000), snrA = (f.Pc / f.Pa) * PHY_.BREF / m.Rs, snrN = f.Pn > 0 ? f.Pc / f.Pn : Infinity, snrR = lin(prx - m.rxMin + 25);
        const ln = 1 / (1 / snrA + 1 / snrN + 1 / snrR + mpi);
        const dgdC = Math.sqrt(f.dg2);
        const pen = f.ps * PHY_.filterPenaltyPerPass(m.Rs, df) + Math.max(0, prx - m.rxMax) * 1.5 + (dgdC / m.dgdTol) ** 2 + PHY_.cdPenalty(m, f.cd) + f.xp + tiltPenaltyFor(chans, i, edgeTilt) + agePen + (!W && lohi[i].hi === lastPos ? rxDeg : 0);
        const bER = PHY_.MODS[m.mod].ber(PHY_.effSnr(m, ln, pen)), q = PHY_.qFromBer(bER), qThr = PHY_.qFromBer(m.berThr), qm = q - qThr;
        const notes = [];
        let status = 'up';
        if (prx < m.rxMin - 12) { status = 'los'; notes.push('Rx power far below the receiver sensitivity'); }
        else if (Math.abs(f.cd) > m.cdTol) { status = 'down'; notes.push(`dispersion ${Math.round(f.cd)} ps/nm is past the ${m.cdTol} ps/nm tolerance`); }
        else if (bER > m.berThr) { status = 'down'; notes.push('pre-FEC BER above the FEC limit'); }
        else if (qm < 1 || prx < m.rxMin || prx > m.rxMax) { status = 'degraded'; notes.push(qm < 1 ? `only ${f1(qm)} dB of Q margin` : prx < m.rxMin ? 'Rx below the sensitivity spec' : 'Rx above the overload point'); }
        if (f.xp > 1.5) notes.push(`XPM costs ${f1(f.xp)} dB`);
        for (const h of dgs[i].hits) notes.push(`its port on ${h.node.name} is degraded (+${f1(h.db)} dB, ${h.side} side)`);
        { const pf = portFaultOn(path.nodes.slice(lohi[i].lo, lohi[i].hi + 1), c.slot, path.links.slice(lohi[i].lo, lohi[i].hi)); if (pf) { status = 'los'; notes.unshift(`its port on ${pf.name} has failed (${slotLbl(c.slot)})`); } const fw = filterWhy(path.nodes.slice(lohi[i].lo, lohi[i].hi + 1), c.slot, path.links.slice(lohi[i].lo, lohi[i].hi), c.slotRev); if (fw) { status = 'los'; notes.unshift(fw); } }
        const lh = lohi[i], nm = k => (node(path.nodes[k]) || {}).name, route = path.nodes.slice(lh.lo, lh.hi + 1).map(id => (node(id) || {}).name);
        return { idx: i, lg: c.lg, role: c.role, slot: c.slot, fTHz: c.fTHz, modeKey: c.mode, short: m.short, rate: m.rate, svc: c.svc, off: c.off, prx, osnr: db(f.Pc / f.Pa), gosnr: db(1 / (1 / snrA + 1 / snrN + mpi) * m.Rs / PHY_.BREF), ber: bER, q, qMargin: qm, xpmPen: f.xp, status, notes,
          from: c.from, to: c.to, via: c.via, fromName: nm(lh.lo), toName: nm(lh.hi), route, routeLinks: path.links.slice(lh.lo, lh.hi), routeNodes: path.nodes.slice(lh.lo, lh.hi + 1), partial: !!W || lh.lo > 0 || lh.hi < lastPos };
      });
      if (W) return res; // a mesh walk only reports its own segments
      res.sP = sP; res.Pend = fin[svcIdx].Pc;
      // Channels on other routes get their own walk over the same link loads.
      for (const h of mesh.hosts.slice(1)) {
        const w = simulate(S, launchOverride, { single: true, reverse: rv, walk: { a: h.path.nodes[0], z: h.path.nodes[h.path.nodes.length - 1], path: h.path, members: h.members, mesh, svcMode: modeKey, svcOnProt } });
        for (const m of h.members) res.segments[m.k] = w.segments ? w.segments[m.k] : null;
      }
      res.segments = res.segments.map((c, i) => c || { idx: i, lg: chans[i].lg, role: chans[i].role, slot: chans[i].slot, fTHz: chans[i].fTHz, modeKey: chans[i].mode, short: chans[i].m.short, rate: chans[i].m.rate, svc: chans[i].svc, off: chans[i].off, prx: null, osnr: null, gosnr: null, ber: null, q: null, qMargin: null, xpmPen: 0,
        status: mesh.blocked[i] ? 'blocked' : mesh.dark[i] ? 'standby' : mesh.routes[i] || mesh.cutOff[i] ? 'los' : 'nopath', notes: [mesh.blocked[i] ? mesh.why[i] : mesh.dark[i] ? 'shared protection: dark until the working route fails' : mesh.routes[i] || mesh.cutOff[i] ? 'the route crosses a cut fiber or a failed device' : mesh.why[i] || 'no route between its add and drop nodes'], from: chans[i].from, to: chans[i].to, via: chans[i].via, route: [], routeLinks: [], routeNodes: [], partial: true });
      res.channels = logicalChannels(g.plan, chans, res.segments);
      { const qs = res.channels.filter(c => (c.status === 'up' || c.status === 'degraded') && Number.isFinite(c.qMargin)).map(c => c.qMargin); if (qs.length) res.worstChannelQ = Math.min(...qs); } // the worst lit channel in the plan, as the Channels table shows it
      // Shared protection is dark, so its margin is predicted by failing the first fiber of the working route and reading the protection copy.
      if (!opts.predict && !opts.single && mesh.dark.some(Boolean)) {
        const isFiber = id => (link(id) || {}).kind === 'fiber', groups = new Map();
        res.channels.forEach((e, i) => {
          const ids = [...new Set(chans.map((x, k) => (x.lg === i && mesh.dark[k] && !mesh.blocked[k] ? chans.findIndex(y => y.lg === i && y.sec === x.sec && y.pc === 'w') : -1)).filter(w => w >= 0).map(w => mesh.routes0[w].links.find(isFiber)).filter(Boolean))].sort();
          if (ids.length) { const key = ids.join('+'); if (!groups.has(key)) groups.set(key, { ids, lgs: [] }); groups.get(key).lgs.push(i); }
        });
        for (const gr of groups.values()) {
          const Sf = { ...S, links: S.links.map(l => (gr.ids.includes(l.id) ? { ...l, p: { ...l.p, cut: true } } : l)) };
          const r2 = simulate(Sf, launchOverride, { single: true, reverse: rv, predict: true });
          for (const i of gr.lgs) {
            const e = res.channels[i], pe = r2.channels && r2.channels[i] && r2.channels[i].protection ? r2.channels[i].protection.protect : null;
            if (!pe) continue;
            e.protection = { ...e.protection, protect: { ...pe, predicted: true } };
            if ((SEG_RANK[pe.status] ?? 0) >= 2) { e.notes = [...e.notes, `shared protection would not carry it: ${pe.notes[0] || pe.status}`]; if (e.status === 'up') e.status = 'degraded'; }
          }
        }
      }
      res.linkLoad = [...mesh.loads].map(([id, set]) => ({ id, name: linkName(link(id)), n: new Set([...set].map(k => chans[k].lg + ':' + chans[k].sec)).size }));
      const failing = res.channels.filter(c => !c.svc && (c.status === 'down' || c.status === 'los' || c.status === 'nopath' || c.status === 'blocked'));
      const unprot = res.channels.filter(c => c.protection && !c.svc && c.protection.active === 'work' && STATUS_RANK[c.protection.protect.status] >= 2 && c.protection.protect.status !== 'standby');
      if (unprot.length) alarms.push({ sev: 'warn', text: `${unprot.length} protected channel${unprot.length > 1 ? 's have' : ' has'} no usable protection route (slot ${unprot.slice(0, 3).map(c => c.slot + 1).join(', ')}${unprot.length > 3 ? '…' : ''}): ${unprot[0].protection.protect.notes[0] || 'it is down'}.` });
      const sp = res.channels.find(c => c.svc && c.protection);
      if (sp && !svcOnProt && STATUS_RANK[sp.protection.protect.status] >= 2) alarms.push({ sev: 'warn', text: `The service is 1+1 protected but its protection route is unusable: ${sp.protection.protect.notes[0] || 'it is down'}.` });
      if (sp && sp.protection.protect.qMargin != null && sp.protection.protect.qMargin < 0 && !svcOnProt) alarms.push({ sev: 'warn', text: `The service's protection route would not carry it: Q margin ${f1(sp.protection.protect.qMargin)} dB on the protection route.` });
      if (failing.length) alarms.push({ sev: 'warn', text: `${failing.length} other channel${failing.length > 1 ? 's' : ''} failing: ${failing.slice(0, 3).map(c => `${slotLbl(c.slot)} (${c.short}): ${c.notes[0]}`).join('; ')}${failing.length > 3 ? '…' : ''}.` });
    }
    if (!eol && !W) { const e = simulate(S, launchOverride, { eol: true, reverse: rv, useProtect: svcOnProt }); res.eol = { qMargin: e.qMargin ?? -Infinity, worstQMargin: e.worstQMargin ?? -Infinity, status: e.status }; }
    // alarms & status
    const bad = [];
    if (mesh && mesh.svcClash && !eol && !rv && !W) bad.push(`The service channel cannot work: ${mesh.svcClash}.`);
    if (!eol && !rv && !W) { const fw = filterWhy(path.nodes, chans[svcIdx].slot, path.links, chans[svcIdx].slotRev); if (fw) bad.push(`The service channel is lost: ${fw}.`); }
    if (!eol && !rv && !W) { // a degraded port: on the service channel's route it costs that channel; elsewhere it is only noted
      for (const h of sdeg.hits) alarms.push({ sev: 'warn', text: `${h.node.name}: the port for ${slotLbl(chans[svcIdx].slot)} is degraded, ${f1(h.db)} dB of extra loss on the ${h.side} side of the service channel${h.side === 'add' ? ' (it enters the line weaker, so OSNR falls by the same amount)' : ' (it lowers the received power)'}. Only this channel is affected.`, fix: fixRepairPort(h.node, chans[svcIdx].slot) });
      const seen = new Set(sdeg.hits.map(h => h.node.id + '|' + chans[svcIdx].slot)); let extra = 0;
      for (const n of S.nodes) for (const [k, db] of Object.entries(n.p.degPorts || {})) if (!seen.has(n.id + '|' + k) && extra++ < 3) alarms.push({ sev: 'info', text: `${n.name}: the port for ${slotLbl(+k)} is degraded (${f1(+db)} dB extra loss). It affects only the channel that uses that port.`, fix: fixRepairPort(n, +k) });
    }
    if (!eol && !rv && !W) { const pf = portFaultOn(path.nodes, chans[svcIdx].slot, path.links); if (pf) bad.push(`The port for ${slotLbl(chans[svcIdx].slot)} on ${pf.name} has failed: the service channel is lost.`); }
    if (Z.p.mode !== modeKey) bad.push(`Mode mismatch: ${A.name} is ${mode.short}, ${Z.name} is ${PHY_.MODES[Z.p.mode].short}. The ends will never lock.`);
    if (Math.abs(cd) > mode.cdTol) bad.push(`Chromatic dispersion ${Math.round(cd)} ps/nm exceeds the ${mode.short} ${mode.coh === false ? 'dispersion tolerance' : 'DSP range'} of ${mode.cdTol} ps/nm.`);
    if (ber > mode.berThr) bad.push(`Pre-FEC BER ${ber.toExponential(2)} is above the ${mode.fec} limit ${mode.berThr.toExponential(2)}: uncorrectable errors, link down.`);
    bad.push(...clientFatal);
    bad.forEach(t => alarms.unshift({ sev: 'bad', text: t }));
    if (prx < mode.rxMin) { const sp = ampSpot(S, path); alarms.push({ sev: 'warn', text: `Rx power ${f1(prx)} dBm is below the ${mode.rxMin} dBm sensitivity spec (Rx LOW alarm). Receiver noise is now eating SNR.`, fix: sp && !W ? fixAmp(S, sp) : null }); }
    if (prx > mode.rxMax) alarms.push({ sev: prx > mode.rxMax + 5 ? 'bad' : 'warn', text: `Rx power ${f1(prx)} dBm is above the ${mode.rxMax} dBm overload point (Rx HIGH alarm). Add a pad.` });
    if (res.dgd > mode.dgdTol * 0.7) alarms.push({ sev: 'warn', text: `Mean DGD ${f1(res.dgd)} ps is close to or over the ${mode.dgdTol} ps PMD tolerance.` });
    const slots = PHY_.cBandSlots(df);
    if (Math.max(maxNch, planOn ? 0 : nchLine) > slots) alarms.push({ sev: 'warn', text: `${Math.max(maxNch, planOn ? 0 : nchLine)} channels do not fit the C-band on a ${g.df} GHz grid (${slots} slots). Reduce channels or use a finer grid.` });
    if (Rs > df) alarms.push({ sev: 'warn', text: `${mode.short} occupies ~${Math.round(Rs / 1e9 * 1.1)} GHz but the grid slot is ${g.df} GHz. Filters clip it and neighbours overlap.` });
    if (!eol && res.qMargin >= 0 && res.eol.qMargin < 0) alarms.push({ sev: 'warn', text: `Works today but fails at end of life: Q margin falls to ${f1(res.eol.qMargin)} dB with ${eolSpan} dB of extra loss per span and ${eolTrx} dB of transceiver ageing.` });
    if (res.qMargin >= 0 && res.worstQMargin < 0) alarms.push({ sev: 'warn', text: `SRS tilt of up to ${f1(peakTilt)} dB leaves the highest-frequency channel with ${f1(res.worstQMargin)} dB of Q margin while the middle channel still passes. Turn on amplifier tilt control or add a ROADM to re-equalise.` });
    if (xpmPen > 1.5) alarms.push({ sev: 'warn', text: `Cross-phase modulation from neighbouring channels costs ${f1(xpmPen)} dB. Lower the launch power, space the ${mode.short} channels apart or move them away from the ${g.neighbors === 'coh' ? 'coherent ' : ''}neighbours.` });
    if (rerouteCut) alarms.push({ sev: 'warn', text: 'Every path crosses a cut fiber or a failed device.' });
    let restAlarm = null;
    // The service survived a cut or a failed device by taking another route: say so, with what the detour cost (the same lab, healed, is the comparison)
    if (!rerouteCut && !svcOnProt && !eol && !rv && !W && !opts.single && (S.links.some(l => isCut(S, l)) || S.nodes.some(n => isDead(n) && !onSpare(n)))) {
      const intact = route(S, A.id, Z.id, true, { ignoreCut: true });
      if (intact && path && intact.links.join() !== path.links.join()) {
        const heal = { ...S, links: S.links.map(l => (l.p.cut ? { ...l, p: { ...l.p, cut: false } } : l)), nodes: S.nodes.map(n => (isDead(n) ? { ...n, p: { ...n.p, fail: '' } } : n)) };
        const r0 = simulate(heal, launchOverride, { single: true }), sg = (v, u) => `${v >= 0 ? '+' : '−'}${f1(Math.abs(v))} ${u}`;
        const broke = [...intact.links.filter(id => isCut(S, link(id))).map(id => `${linkName(link(id))} is cut`), ...intact.nodes.filter(id => isDead(node(id))).map(id => `${node(id).name} has failed`)];
        const via = path.nodes.filter(id => !intact.nodes.includes(id)).map(id => node(id).name), dkm = km - r0.km, dq = Number.isFinite(r0.qMargin) ? res.qMargin - r0.qMargin : null;
        const over = via.length ? `over ${via.join(' and ')}` : 'over another route';
        res.restored = { links: intact.links, short: `restored ${over} after ${broke.join(' and ')}: ${sg(dkm, 'km')}${dq != null ? `, ${sg(dq, 'dB')} margin` : ''}` };
        restAlarm = { sev: 'info', fix: (() => { const l = link(intact.links.find(id => isCut(S, link(id))) || ''); return l ? fixSplice(l, 'Splice it back to restore the original route') : null; })(), text: `The service restored itself ${over}: ${broke.join(' and ')}. The detour is ${f1(Math.abs(dkm))} km ${dkm >= 0 ? 'longer' : 'shorter'}${dq != null ? ` and the Q margin ${dq >= 0 ? 'rises' : 'falls'} by ${f1(Math.abs(dq))} dB (${f1(r0.qMargin)} to ${f1(res.qMargin)} dB)` : ''}. Splice the fiber back to return to the original route.` };
        alarms.unshift(restAlarm);
      }
    }
    if (!eol && !W) for (const n of [A, Z]) if (onSpare(n)) alarms.push({ sev: 'warn', text: `${n.name}'s primary module has failed: traffic is on the spare (${n.p.spare === 'ycable' ? 'y-cable' : 'optical switch'}). There is no module protection left.` });
    if (!eol && !rv && !W) for (const id of path.nodes) {
      const n = node(id), d = degOf(n);
      if (d > 0) alarms.push({ sev: 'warn', text: `${n.name} is degraded: ${n.type === 'edfa' ? `its output is ${f1(d)} dB below the setting and its noise figure is worse` : isEnd(n) ? (id === A.id ? `its laser is ${f1(d)} dB weaker` : `its receiver loses ${f1(d)} dB of SNR`) : `${f1(d)} dB of extra loss`}.` , fix: fixWork(n) });
    }
    if (svcOnProt && !W) alarms.push({ sev: 'warn', text: protWhy === 'cut' ? `The working route has failed (a cut fiber or a failed device): traffic switched to the protection route (${Math.round(km)} km). There is no protection left until it is repaired.` : 'The working route is down: traffic switched to the protection route. There is no protection left.' });
    if (bad.length) { res.status = 'down'; res.headline = bad[0]; }
    else if (res.qMargin < 1 || alarms.some(a => a.sev !== 'info')) { res.status = 'degraded'; const top = alarms.find(a => a.sev === 'bad') || alarms.find(a => a.sev === 'warn'), more = alarms.filter(a => a.sev !== 'info').length - 1; // the headline names the first problem, not just that there is one
      res.headlineFix = top && top.fix || null; res.headline = res.qMargin < 1 ? `Up, but only ${f1(res.qMargin)} dB of Q margin. ${top ? top.text : 'Aging or a dirty connector will take it down.'}` : `Up, but ${top ? top.text.charAt(0).toLowerCase() === top.text.charAt(0) ? top.text : 'with a warning: ' + top.text : 'with alarms to look at.'}${top && more > 0 ? ` (${more} more below)` : ''}`; }
    else { res.status = 'up'; res.headline = `Up with ${f1(res.qMargin)} dB Q margin${res.restored ? ', ' + res.restored.short : ''}.`; if (restAlarm) { restAlarm.text = 'Splice the fiber back to return to the original route; the dotted line on the canvas shows it.'; res.headlineFix = restAlarm.fix; } } // the headline already says what happened and what it cost
    if (res.status === 'down') { const sw = switchIfBetter(res); if (sw !== res) return sw; }
    if (!eol && !rv && !opts.single) {
      const r2 = simulate(S, launchOverride, { reverse: true, useProtect: !!opts.useProtect });
      res.rev = r2;
      if (r2.status === 'nopath') { res.status = 'down'; res.headline = `${Z.name} to ${A.name}: no path for the return direction. A one-way fiber may be missing its pair.`; }
      else if (r2.mode) {
        const seen = new Set(res.alarms.map(a => a.text));
        r2.alarms.filter(a => a.sev !== 'info' && !seen.has(a.text)).forEach(a => res.alarms.push({ ...a, text: `${Z.name} to ${A.name}: ${a.text}` }));
        if ((STATUS_RANK[r2.status] ?? 0) > (STATUS_RANK[res.status] ?? 0)) { res.status = r2.status; res.headline = `${Z.name} to ${A.name}: ${r2.headline}`;  res.headlineFix = r2.headlineFix || null; }
        else if (res.status === 'up' && r2.status === 'degraded') { res.status = 'degraded'; res.headline = `${Z.name} to ${A.name}: ${r2.headline}`;  res.headlineFix = r2.headlineFix || null; }
      }
    }
    res.reverse = rv;
    return res;
  }

  return { TYPES, PREFIX, cableKind, PORTS_PER_CARD, SPLIT, splitLossDb, otdrTrace, meterRead, OTDR_PULSES, OTDR_DR, METER, band1310, oscSpans, optic1310, parseIp, reach, traffic, assignSides, oadmWhy, oadmRange, oadmSide, derive, effective, txPower, applyFix, PRESETS, CHALLENGES, challengeStatus, copySelection, pasteSelection, removeNodes, alignNodes, isEnd, newClient, uid, linkDefaults, sanitize, sanitizePlan, planFromUniform, remapPlan, assignSlots, resilience, RESIL, isCut, candidateRoutes, estimateRoute, planDemands, blockingCurve, optimiseOffsets, channelTransients, fromSpans, mkGraph, route, simulate, reqOsnr };
})();
if (typeof module !== 'undefined') module.exports = MODEL;
