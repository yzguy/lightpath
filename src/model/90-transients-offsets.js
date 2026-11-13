  // ---------- per-channel transients ----------
  // Cut one fiber and see what each surviving channel gets. A channel is lost if its route crosses the fiber; at every amplifier on a survivor's route the
  // lost channels that were upstream of it stop loading it, so the amplifier lifts what remains by 10log10(N / (N - lost)), of which its control loop lets
  // through 1 - exp(-agc / tau). Two spectral effects, both representative figures (TRANSIENT.tiltPerDb, TRANSIENT.shb): an inversion-shift tilt, so the
  // blue end of the band is lifted more than the red end, and a hole-burning share, so a survivor within a few slots of a lost channel is lifted a little more.
  function channelTransients(S, opts = {}) {
    const T = PHY_.TRANSIENT, r = simulate(S), chans = (r.channels || []).filter(c => c.routeLinks && c.routeNodes && (c.status === 'up' || c.status === 'degraded' || c.status === 'warn'));
    const { link, node } = mkGraph(S), fibers = new Map();
    for (const c of chans) for (const id of c.routeLinks) if ((link(id) || {}).kind === 'fiber') fibers.set(id, (fibers.get(id) || 0) + 1);
    if (!fibers.size) return { cut: null, fibers: [], rows: [], lost: [] };
    const cut = opts.cut && fibers.has(opts.cut) ? opts.cut : [...fibers].sort((a, b) => b[1] - a[1])[0][0];
    const agcG = Number.isFinite(+S.g.agcUs) && S.g.agcUs !== '' ? +S.g.agcUs : T.agcUs, fc = 193.1, bw = 4.4; // THz: the middle and width of the C band
    const lost = chans.filter(c => c.routeLinks.includes(cut)).map(c => c.slot), surv = chans.filter(c => !c.routeLinks.includes(cut));
    const near = 3 * (+S.g.df / 1000) * 1.0001; // within three slots
    const rows = surv.map(c => {
      const hits = []; let cum = 0;
      c.routeNodes.forEach((id, i) => {
        const n = node(id); if (!n) return;
        const last = c.routeNodes.length - 1, stages = n.type === 'edfa' ? (i > 0 && i < last ? ['amplifier'] : []) : n.type === 'roadm' && n.p.amps ? [...(i > 0 ? ['preamp'] : []), ...(i < last ? ['booster'] : [])] : [];
        if (!stages.length) return;
        // the channels through this node before the event, and the ones whose cut is upstream of it (they stop loading it)
        const there = chans.filter(x => x.routeNodes.includes(id)), nn = there.length;
        const gone = there.filter(x => { const ic = x.routeLinks.indexOf(cut); return ic >= 0 && ic < x.routeNodes.indexOf(id); });
        if (!gone.length || nn - gone.length < 1) return;
        const raw = db(nn / (nn - gone.length)), agc = Number.isFinite(+n.p.agcUs) && n.p.agcUs !== '' && n.p.agcUs !== null ? +n.p.agcUs : agcG;
        const nearN = gone.filter(x => Math.abs(x.fTHz - c.fTHz) <= near).length, w = (1 + T.tiltPerDb * (c.fTHz - fc) / (bw / 2)) * (1 + T.shb * nearN / gone.length), peak = raw * (1 - Math.exp(-agc / T.tauUs)) * w;
        for (const st of stages) { cum += peak; hits.push({ name: n.type === 'edfa' ? n.name : `${n.name} ${st}`, n: nn, lost: gone.length, rawDb: raw, peakDb: peak, near: nearN }); }
      });
      const md = PHY_.MODES[c.modeKey] || null, rxMax = md ? md.rxMax : null, prxSurge = c.prx + cum;
      return { slot: c.slot, fTHz: c.fTHz, svc: !!c.svc, modeShort: c.short, prx: c.prx, surgeDb: cum, prxSurge, overloadDb: rxMax != null ? Math.max(0, prxSurge - rxMax) : 0, rxMax, hits, route: c.route };
    });
    const worst = rows.reduce((a, x) => (!a || x.surgeDb > a.surgeDb ? x : a), null), nameOf = id => { const l = link(id); return `${node(l.a).name}–${node(l.b).name}`; };
    return { cut, cutName: nameOf(cut), fibers: [...fibers].map(([id, n]) => ({ id, n, name: nameOf(id) })), rows, lost, worst };
  }

  // Per-channel power offsets (dB against the service) that maximise the worst channel's Q margin, then its average: coordinate descent over
  // the offsets with shrinking steps, each trial a full forward simulation of the plan. The service stays at 0 dB.
  function optimiseOffsets(S, opts = {}) {
    const plan = S.g && S.g.plan; if (!Array.isArray(plan) || plan.length < 2) return null;
    const lo = opts.min ?? -6, hi = opts.max ?? 3, offs = plan.map(c => (c.svc ? 0 : Math.max(lo, Math.min(hi, Number.isFinite(+c.off) ? +c.off : 0))));
    const evalOffs = o => {
      const r = simulate({ ...S, g: { ...S.g, plan: plan.map((c, i) => ({ ...c, off: o[i] })) } }, undefined, { single: true }), ms = (r.channels || []).filter(c => c.qMargin != null).map(c => c.qMargin);
      return ms.length ? { min: Math.min(...ms), mean: ms.reduce((a, b) => a + b, 0) / ms.length } : { min: -Infinity, mean: -Infinity };
    };
    const better = (a, b) => a.min > b.min + 1e-6 || (Math.abs(a.min - b.min) <= 1e-6 && a.mean > b.mean + 1e-6);
    const start = evalOffs(offs); let cur = start;
    for (const step of [2, 1, 0.5, 0.25]) {
      for (let pass = 0, improved = true; improved && pass < 6; pass++) {
        improved = false;
        plan.forEach((c, i) => {
          if (c.svc) return;
          for (const d of [step, -step]) {
            const v = Math.round((offs[i] + d) * 4) / 4; if (v < lo || v > hi) continue;
            const old = offs[i]; offs[i] = v; const t = evalOffs(offs);
            if (better(t, cur)) { cur = t; improved = true; } else offs[i] = old;
          }
        });
      }
    }
    return { offsets: offs, before: start, after: cur };
  }

  // opts.eol: evaluate with end-of-life allowances (see PHY.EOL). The normal result carries the EoL outcome in res.eol.
  // opts.reverse: simulate Z -> A. Per-direction overrides (extraRev, ramanRev, targetRev, gainRev) apply; blank means "same as forward".
  // The forward result carries the reverse one in res.rev and its status is the worse of the two. opts.single skips the reverse run.
