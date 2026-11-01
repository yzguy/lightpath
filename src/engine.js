// ===== Physics engine =====
const PHY = (() => {
  const H = 6.62607e-34, NU = 193.4e12, BREF = 12.5e9, C = 299792458, LAMBDA = C / NU;
  const db = x => 10 * Math.log10(x), lin = x => Math.pow(10, x / 10);

  function erfc(x) { // Numerical Recipes erfcc, rel err < 1.2e-7
    const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
    const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
      t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? r : 2 - r;
  }
  function erfcinv(y) { // bisection, y in (0,2)
    let lo = -6, hi = 10;
    for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (erfc(m) > y) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  const MODS = {
    NRZ: { bits: 1, ber: s => 0.5 * erfc(Math.sqrt(s / 2)), M: 2 }, // OOK, direct detection: Q = sqrt(electrical SNR)
    QPSK: { bits: 2, ber: s => 0.5 * erfc(Math.sqrt(s / 2)), M: 4 },
    '16QAM': { bits: 4, ber: s => 0.375 * erfc(Math.sqrt(s / 10)), M: 16 },
    '64QAM': { bits: 6, ber: s => (7 / 24) * erfc(Math.sqrt(s / 42)), M: 64 },
  };

  const FIBERS = {
    smf: { name: 'SMF-28 (G.652.D)', att: 0.20, D: 17, gamma: 1.3, pmd: 0.06 },
    leaf: { name: 'NZ-DSF / LEAF (G.655)', att: 0.21, D: 4.2, gamma: 1.5, pmd: 0.04 },
    ull: { name: 'Ultra-low-loss (G.654.E)', att: 0.16, D: 21, gamma: 0.85, pmd: 0.05 },
    legacy: { name: 'Legacy 1990s SMF', att: 0.25, D: 17, gamma: 1.3, pmd: 0.5 },
  };

  // Transceiver modes. snrTrx = transceiver back-to-back SNR ceiling, pen = implementation penalty.
  const MODES = {
    zr400: { name: '400ZR (DP-16QAM, 60 GBd, CFEC)', short: '400ZR', rate: 400, Rs: 59.84e9, mod: '16QAM', fec: 'CFEC', berThr: 1.22e-2,
      tx: -10, txOsnr: 34, rxMin: -12, rxMax: 0, cdTol: 2400, dgdTol: 10, snrTrx: 21, pen: 1.5 },
    zrp400: { name: '400G ZR+ (DP-16QAM, 60 GBd, oFEC)', short: '400G ZR+', rate: 400, Rs: 60.14e9, mod: '16QAM', fec: 'oFEC', berThr: 2.0e-2,
      tx: 0, txOsnr: 36, rxMin: -18, rxMax: 0, cdTol: 20000, dgdTol: 20, snrTrx: 21, pen: 1.5 },
    zrp200: { name: '200G ZR+ (DP-QPSK, 60 GBd, oFEC)', short: '200G ZR+', rate: 200, Rs: 60.14e9, mod: 'QPSK', fec: 'oFEC', berThr: 2.0e-2,
      tx: 0, txOsnr: 36, rxMin: -20, rxMax: 0, cdTol: 50000, dgdTol: 25, snrTrx: 20, pen: 1.0 },
    c100: { name: '100G coherent (DP-QPSK, 32 GBd, SD-FEC)', short: '100G', rate: 100, Rs: 31.6e9, mod: 'QPSK', fec: 'SD-FEC', berThr: 1.9e-2,
      tx: 0, txOsnr: 38, rxMin: -18, rxMax: 0, cdTol: 50000, dgdTol: 30, snrTrx: 20, pen: 1.0 },
    m800: { name: '800G (DP-16QAM, 118 GBd, oFEC)', short: '800G', rate: 800, Rs: 118.2e9, mod: '16QAM', fec: 'oFEC', berThr: 2.0e-2,
      tx: -8, txOsnr: 34, rxMin: -12, rxMax: 0, cdTol: 20000, dgdTol: 10, snrTrx: 20, pen: 1.8 },
    // Non-coherent line optic as plugged into a switch (tunable DWDM SFP+ ZR, 80 km). Direct detection with an APD: no DSP,
    // so chromatic dispersion eats margin gradually (coh:false) and there is usually no FEC (the host may add one).
    dwdm10: { name: '10G DWDM (NRZ, 10.3 GBd, no FEC, tunable SFP+)', short: '10G DWDM', rate: 10, Rs: 10.3125e9, mod: 'NRZ', fec: 'none', berThr: 1e-12, coh: false,
      tx: 1, txOsnr: 35, rxMin: -23, rxMax: -7, cdTol: 1600, dgdTol: 20, snrTrx: 25, pen: 2.0 },
    dwdm10f: { name: '10G DWDM + host FEC (NRZ, 11.1 GBd, EFEC)', short: '10G+FEC', rate: 10, Rs: 11.1e9, mod: 'NRZ', fec: 'EFEC (host)', berThr: 4e-3, coh: false,
      tx: 1, txOsnr: 35, rxMin: -23, rxMax: -7, cdTol: 1600, dgdTol: 20, snrTrx: 25, pen: 2.0 },
  };

  // Client-side (grey) optics for muxponder client ports. Representative IEEE / MSA values: per-lane average launch and
  // Rx sensitivity in dBm, rated reach in km, fiber loss at the optic's wavelength. Check the module datasheet for real designs.
  const CLIENT_OPTICS = {
    '10g-lr':    { name: '10GBASE-LR',        rate: 10,  reach: 10, nm: 1310, att: 0.35, tx: -3,  rxMin: -14.4, rxMax: 0.5 },
    '10g-er':    { name: '10GBASE-ER',        rate: 10,  reach: 40, nm: 1550, att: 0.22, tx: 0,   rxMin: -15.8, rxMax: -1 },
    '25g-lr':    { name: '25GBASE-LR',        rate: 25,  reach: 10, nm: 1310, att: 0.35, tx: -2.5, rxMin: -13,  rxMax: 2 },
    '25g-er':    { name: '25GBASE-ER',        rate: 25,  reach: 40, nm: 1310, att: 0.35, tx: 0,   rxMin: -16,   rxMax: -3 },
    '100g-dr':   { name: '100GBASE-DR (1 lane)', rate: 100, reach: 0.5, nm: 1310, att: 0.35, tx: 0, rxMin: -6,  rxMax: 4 },
    '100g-fr':   { name: '100G-FR (1 lane)',  rate: 100, reach: 2,  nm: 1310, att: 0.35, tx: 1,   rxMin: -8,    rxMax: 4 },
    '100g-lr4':  { name: '100GBASE-LR4',      rate: 100, reach: 10, nm: 1310, att: 0.35, tx: 0,   rxMin: -10,   rxMax: 4.5 },
    '400g-dr4':  { name: '400GBASE-DR4',      rate: 400, reach: 0.5, nm: 1310, att: 0.35, tx: 0,  rxMin: -6,    rxMax: 4 },
    '400g-fr4':  { name: '400GBASE-FR4',      rate: 400, reach: 2,  nm: 1310, att: 0.35, tx: 1,   rxMin: -8,    rxMax: 4 },
    '400g-lr4':  { name: '400GBASE-LR4-10',   rate: 400, reach: 10, nm: 1310, att: 0.35, tx: 1,   rxMin: -9.5,  rxMax: 4 },
    '800g-dr8':  { name: '800GBASE-DR8',      rate: 800, reach: 0.5, nm: 1310, att: 0.35, tx: 0,  rxMin: -6,    rxMax: 4 },
    '800g-2fr4': { name: '800G 2xFR4',        rate: 800, reach: 2,  nm: 1310, att: 0.35, tx: 1,   rxMin: -8,    rxMax: 4 },
  };
  // One client port: Tx power - (fiber + connector loss) vs the module's Rx window and rated reach.
  function clientBudget(port) {
    const o = CLIENT_OPTICS[port.optic];
    const loss = o.att * port.len + port.extra, rx = o.tx - loss, margin = rx - o.rxMin;
    const notes = [];
    let status = 'ok';
    if (margin < 0) { status = 'down'; notes.push(`Rx ${rx.toFixed(1)} dBm is below the ${o.rxMin} dBm sensitivity: client link down`); }
    else if (rx > o.rxMax) { status = 'warn'; notes.push(`Rx ${rx.toFixed(1)} dBm is above the ${o.rxMax} dBm overload point: add a ${Math.ceil(rx - o.rxMax + 1)} dB pad`); }
    else if (margin < 1.5) { status = 'warn'; notes.push(`Only ${margin.toFixed(1)} dB of margin`); }
    if (port.len > o.reach) { if (status === 'ok') status = 'warn'; notes.push(`${port.len} km is beyond the ${o.reach} km rated reach`); }
    return { optic: o, loss, rx, margin, status, notes };
  }

  function beta2(D) { // D ps/nm/km -> |beta2| s^2/km
    return Math.abs(D * 1e-6 * LAMBDA * LAMBDA / (2 * Math.PI * C)) * 1e3;
  }
  // GN-model closed form (incoherent), P_NLI = eta * P^3 within the channel bandwidth Rs
  function etaNLI(fiber, Lkm, Rs, nch, df) {
    const ap = fiber.att / (10 * Math.LOG10E), Leff = (1 - Math.exp(-ap * Lkm)) / ap, Leffa = 1 / ap;
    const b2 = beta2(fiber.D), g = fiber.gamma;
    const n = Math.max(1, nch), ex = 2 * Math.min(1, Rs / df);
    const arg = (Math.PI ** 2 / 2) * b2 * Leffa * Rs * Rs * Math.pow(n, ex);
    return (8 / 27) * g * g * Leff * Leff * Math.asinh(arg) / (Math.PI * b2 * Leffa * Rs * Rs);
  }
  function filterPenaltyPerPass(Rs, df) {
    const r = Rs / df;
    return r < 0.7 ? 0.03 : 0.03 + 0.5 * (r - 0.7) + 2.5 * Math.max(0, r - 0.9) ** 2 + (r > 1 ? 4 * (r - 1) : 0);
  }
  // C-band plan: 191.3-196.1 THz (4.8 THz). How many fixed-grid slots of width df (Hz) fit.
  const CBAND = { f0: 191.3e12, width: 4.8e12 };
  const cBandSlots = df => Math.floor(CBAND.width / df + 1e-9);
  // End-of-life allowances (ageing, repairs, dirty connectors): extra loss per fiber span, extra transceiver penalty.
  const EOL = { spanLoss: 1.0, trxPen: 0.5 };
  // Power transients: after channels vanish, the surviving channels of a gain-controlled EDFA rise toward the uncontrolled surge with this time
  // constant (hundreds of microseconds); a control loop that reacts within a fraction of it holds most of the surge off. Representative.
  const TRANSIENT = { tauUs: 200, lossPct: 50, agcUs: 20 };
  // Stimulated Raman scattering tilt. Power moves from high- to low-frequency channels. Returns dB between the
  // lowest and highest channel added by one span (Zirngibl-style approximation: tilt ~ 4.34 * slope * Ptot * Leff * bandwidth).
  // Raman gain slope ~0.028 /W/km/THz on SMF at 80 um^2; scaled by gamma as a stand-in for 1/Aeff.
  function srsTilt(fiber, Lkm, PchW, nch, df) {
    if (nch < 2) return 0;
    const ap = fiber.att / (10 * Math.LOG10E), Leff = (1 - Math.exp(-ap * Lkm)) / ap;
    return 4.343 * 0.028 * (fiber.gamma / 1.3) * (PchW * nch) * Leff * ((nch - 1) * df / 1e12);
  }
  // Nonlinear noise from successive spans adds incoherently when the signal has dispersed a lot between them (the GN model's
  // assumption), but coherently when dispersion is cancelled (inline DCM) or tiny (NZ-DSF). Returns the correlation 0..1 between
  // the new span's NLI and what has built up, as a function of the dispersion (ps/nm) accumulated before the span.
  const NLI_COH_CD = 400;
  const nliCorrelation = cdAcc => Math.max(0, 1 - Math.abs(cdAcc) / NLI_COH_CD);
  // ---- Channel plan helpers ----
  const slotFreqTHz = (slot, dfHz) => (CBAND.f0 + (slot + 0.5) * dfHz) / 1e12;
  // Per-channel NLI relative to a reference: the same channel inside a contiguous, identical full band of refN channels at spacing df.
  // Pairwise GN terms: self-channel asinh term plus an XPM log kernel from every other channel (PSD-weighted). chans: [{f (Hz), Rs, P (W)}].
  // Normalising to the reference keeps the uniform case identical to etaNLI().
  function nliPlanFactor(fiber, chans, i, df, refN) {
    const ap = fiber.att / (10 * Math.LOG10E), Leffa = 1 / ap, b2 = beta2(fiber.D), ci = chans[i];
    const self = Math.asinh((Math.PI ** 2 / 2) * b2 * Leffa * ci.Rs * ci.Rs);
    const kern = (d, Rsj) => { const a = Math.abs(d), h = Rsj / 2; return Math.log((a + h) / Math.max(a - h, 0.1 * Rsj)); };
    const Gi = ci.P / ci.Rs;
    let num = self * Gi * Gi;
    for (let j = 0; j < chans.length; j++) if (j !== i) { const Gj = chans[j].P / chans[j].Rs; num += Gj * Gj * kern(chans[j].f - ci.f, chans[j].Rs); }
    let den = self * Gi * Gi;
    const n = Math.max(1, refN) - 1, hi = Math.ceil(n / 2), lo = n - hi;
    for (let k = 1; k <= hi; k++) den += Gi * Gi * kern(k * df, ci.Rs);
    for (let k = 1; k <= lo; k++) den += Gi * Gi * kern(k * df, ci.Rs);
    return num / den;
  }
  // Raman gain spectrum. Pump wavelengths (THz) for 1, 2 or 3 pumps; the gain coefficient vs pump-signal detuning is a triangle that
  // peaks at 13.2 THz and falls to 20% at 25 THz. Gain of a channel relative to the service channel at the same pump power.
  const RAMAN_PUMPS = { 1: [206.8], 2: [208.0, 204.8], 3: [209.6, 207.2, 204.4] };
  const ramanShape = d => (d <= 0 ? 0 : d <= 13.2 ? d / 13.2 : d <= 25 ? 1 - ((d - 13.2) / 11.8) * 0.8 : Math.max(0, 0.2 * (1 - (d - 25) / 10)));
  const ramanGainAt = (npump, fTHz) => RAMAN_PUMPS[npump].reduce((a, p) => a + ramanShape(p - fTHz), 0) / npump;
  const ramanRel = (npump, fTHz, fSvcTHz) => ramanGainAt(npump, fTHz) / Math.max(1e-6, ramanGainAt(npump, fSvcTHz));
  // Double Rayleigh scattering (multipath interference) as a noise-to-signal ratio, grows with the square of the on-off gain.
  const drsRatio = (grDb, fiber, Lkm) => { const ap = fiber.att / 4.343, Leff = (1 - Math.exp(-ap * Lkm)) / ap; return lin(2 * grDb - 64 + 20 * Math.log10(Leff / 21.7)); };
  // Direct-detection optics have no DSP: dispersion closes the eye gradually (dB of SNR penalty, ~2 dB at the rated tolerance).
  const cdPenalty = (mode, cd) => (mode.coh === false ? 2 * (Math.abs(cd) / mode.cdTol) ** 2 : 0);
  // Backward-pumped distributed Raman. Effective gain coefficient (unpolarised pump, averaged over the C-band) scaled by gamma ~ 1/Aeff.
  // On-off gain = 4.343 * CR * Ppump * Leff_pump. For noise the span is treated as a lumped amplifier of that gain placed
  // closer to the span end, so only (1 - NOISE_FRAC) of the on-off gain is not "seen" by the noise: OSNR benefit ~ NOISE_FRAC * gain.
  // Refinements: pump depletion (signal photons are paid for by pump photons), gain ripple across the band falls with more pumps,
  // forward pumping puts the gain at the start of the span where the signal is strong (noisier, more nonlinear, less OSNR benefit).
  const RAMAN = { cr: 0.2, pumpAtt: 0.25, noiseFrac: 0.4, nf: 4.5, maxMw: 1500, warnMw: 1000,
    photon: 0.935, ripple: { 1: 0.35, 2: 0.15, 3: 0.06 }, fwdNf: 7, fwdPreLoss: 3 };
  // A forward pump lifts the signal power over the first ~20 km: peak rise ~ 0.45 * gain - 1 dB. NLI goes as power cubed over about
  // half the effective length, so the span's NLI is scaled by 10^(1.5 * rise / 10).
  const ramanFwdNliFactor = gfDb => lin(1.5 * Math.max(0, 0.45 * gfDb - 1));
  // Coupled-wave solver. Every wave (signal samples and pumps, forward or backward) obeys
  //   +-dP_i/dz = -a_i P_i + P_i * sum_{j above i} c(f_j - f_i) P_j - P_i * sum_{j below i} (f_i / f_j) c(f_i - f_j) P_j
  // with c the Raman gain per watt and km (the triangular shape of ramanShape times RAMAN.cr scaled by the fiber's gamma). Higher-frequency waves feed
  // lower ones: pump to signal, pump to pump (the long-wave pump gains from the short-wave one), signal to signal (SRS tilt). The photon-energy ratio
  // f_i / f_j conserves photon number. Forward waves are integrated from z = 0, backward ones from z = L, alternately until the profiles settle.
  // pumps: [{ fTHz, mW, dir: 'fwd' | 'back' }]; sigs: [{ fTHz, mW }] at z = 0. Returns powers out (W), the on-off gain (dB) of each signal against the
  // same signals without pumps, the pump depletion and sampled profiles. opts.att0 removes the attenuation (for conservation checks).
  function ramanSolve(fiber, Lkm, pumps, sigs, opts = {}) {
    const N = opts.steps || 160, dz = Lkm / N, cr = RAMAN.cr * (fiber.gamma / 1.3);
    const att = f => (opts.att0 ? 0 : (fiber.att + (RAMAN.pumpAtt - fiber.att) * Math.min(1, Math.max(0, (f - 194) / 13))) / 4.343);
    const run = (pumpScale, sigScale) => {
      const W = [...sigs.map(s => ({ f: s.fTHz, p0: s.mW / 1000 * sigScale, dir: 1, sig: true })), ...pumps.map(p => ({ f: p.fTHz, p0: p.mW / 1000 * pumpScale, dir: p.dir === 'fwd' ? 1 : -1, sig: false }))];
      const M = W.length, a = W.map(w => att(w.f));
      const C = Array.from({ length: M }, (_, i) => W.map((w, j) => (w.f > W[i].f ? cr * ramanShape(w.f - W[i].f) : 0))), R = W.map((w, i) => W.map((x, j) => (x.f < w.f ? w.f / x.f : 0)));
      const P = W.map(w => { const row = new Float64Array(N + 1); for (let k = 0; k <= N; k++) row[k] = w.p0 * Math.exp(-a[W.indexOf(w)] * (w.dir > 0 ? k * dz : (N - k) * dz)); return row; });
      const rhs = (i, col) => { // d ln P_i / dz without the direction sign, from the powers at one z
        let g = -a[i];
        for (let j = 0; j < M; j++) { if (j === i) continue; if (C[i][j]) g += C[i][j] * col[j]; else if (R[i][j]) g -= R[i][j] * C[j][i] * col[j]; }
        return g;
      };
      const fwd = W.map((w, i) => (w.dir > 0 ? i : -1)).filter(i => i >= 0), bwd = W.map((w, i) => (w.dir < 0 ? i : -1)).filter(i => i >= 0);
      // Gauss-Seidel with under-relaxation: the forward waves are integrated against the current backward profile, then the backward waves
      // against the new forward one; blending the old and new profiles keeps a strongly saturated span from flipping between two states.
      for (let it = 0; it < 120; it++) {
        const Tf = P.map((row, i) => (W[i].dir > 0 ? Float64Array.from(row) : row));
        const colF = k => P.map((row, i) => (W[i].dir > 0 ? Tf[i][k] : row[k]));
        for (let k = 0; k < N; k++) {
          const c0 = colF(k), c1 = colF(k + 1); // the frozen (backward) waves at the far end of the step: second order
          fwd.forEach(i => { c1[i] = c0[i] * Math.exp(rhs(i, c0) * dz); });
          fwd.forEach(i => { Tf[i][k + 1] = c0[i] * Math.exp(0.5 * (rhs(i, c0) + rhs(i, c1)) * dz); });
        }
        let change = 0;
        const w = it < 4 ? 0.5 : 0.6;
        fwd.forEach(i => { for (let k = 1; k <= N; k++) { const v = (1 - w) * P[i][k] + w * Tf[i][k]; change = Math.max(change, Math.abs(v - P[i][k]) / (P[i][k] + 1e-30)); P[i][k] = v; } });
        if (bwd.length) {
          const Tb = P.map((row, i) => (W[i].dir < 0 ? Float64Array.from(row) : row));
          const colB = k => P.map((row, i) => (W[i].dir < 0 ? Tb[i][k] : row[k]));
          for (let k = N; k > 0; k--) {
            const c0 = colB(k), c1 = colB(k - 1);
            bwd.forEach(i => { c1[i] = c0[i] * Math.exp(rhs(i, c0) * dz); });
            bwd.forEach(i => { Tb[i][k - 1] = c0[i] * Math.exp(0.5 * (rhs(i, c0) + rhs(i, c1)) * dz); });
          }
          bwd.forEach(i => { for (let k = 0; k < N; k++) { const v = (1 - w) * P[i][k] + w * Tb[i][k]; change = Math.max(change, Math.abs(v - P[i][k]) / (P[i][k] + 1e-30)); P[i][k] = v; } });
        } else if (it > 0) break;
        if (change < 1e-5) break;
      }
      return { W, P };
    };
    const on = run(1, 1), nS = sigs.length, small = opts.noSmall ? null : run(1, 1e-4);
    const passive = (i, z) => sigs[i].mW / 1000 * Math.exp(-att(sigs[i].fTHz) * z); // the same signal with the pumps off
    const out = on.P.map(row => row[N]), outOff = sigs.map((s, i) => passive(i, Lkm));
    const gain = sigs.map((s, i) => db(out[i] / outOff[i])), gain0 = small ? sigs.map((s, i) => db(small.P[i][N] / 1e-4 / outOff[i])) : gain;
    const pOut = pumps.map((p, j) => (pumps[j].dir === 'fwd' ? on.P[nS + j][N] : on.P[nS + j][0])), pFree = small ? pumps.map((p, j) => (pumps[j].dir === 'fwd' ? small.P[nS + j][N] : small.P[nS + j][0])) : pOut;
    const depletion = pumps.length && small ? Math.max(0, ...pumps.map((p, j) => 1 - pOut[j] / Math.max(1e-30, pFree[j]))) : 0;
    const zs = Array.from({ length: 61 }, (_, i) => Lkm * i / 60), pick = k => Math.round(k * N / 60);
    return { gainDb: gain, gain0Db: gain0, depletion, sigOutW: out.slice(0, nS), pumpOutW: pOut,
      profile: { z: zs, sig: sigs.map((s, i) => zs.map((_, k) => on.P[i][pick(k)])), pump: pumps.map((p, j) => zs.map((_, k) => on.P[nS + j][pick(k)])), off: sigs.map((s, i) => zs.map(z => passive(i, z))) }, N };
  }
  function ramanGain(fiber, Lkm, pumpMw) {
    if (!(pumpMw > 0)) return 0;
    const ap = RAMAN.pumpAtt / 4.343, Leffp = (1 - Math.exp(-ap * Lkm)) / ap;
    return 4.343 * RAMAN.cr * (fiber.gamma / 1.3) * (pumpMw / 1000) * Leffp;
  }
  // Gain with pump depletion. sigW = total signal power (all channels) at the pumped end of the span, slDb = span loss.
  // Fixed point: gain shrinks as the signal takes power from the pump.
  function ramanGainSat(fiber, Lkm, pumpMw, sigW, slDb) {
    const g0 = ramanGain(fiber, Lkm, pumpMw);
    if (g0 <= 0) return { gain: 0, g0: 0, depletion: 0 };
    let g = g0, d = 0;
    for (let i = 0; i < 40; i++) {
      d = Math.min(0.9, RAMAN.photon * sigW * lin(g - slDb) / (pumpMw / 1000));
      g = g0 * (1 - d / 2);
    }
    return { gain: g, g0, depletion: d };
  }
  // Cross-phase modulation penalty (dB of SNR) one span adds to a direct-detection channel from n neighbours. w is dB per neighbour
  // per 80 km at 0 dBm/ch; scales with launch power and effective length. Representative, not derived from a full XPM model.
  const XPM = { same: 0.02, coh: 0.06, reachGHz: 400, cap: 5, rxBw: 7e9 };
  // Walk-off: a neighbour's intensity pattern slides past the channel by tau = D * Leff * dLambda while it travels, which low-passes the XPM
  // it causes. For a direct-detection receiver of bandwidth B the noise it makes scales as atan(2 pi B tau) / (2 pi tau), falling as 1/spacing,
  // and rising as the dispersion falls. Relative to a neighbour 75 GHz away on 80 km of standard fiber, where the constants above apply.
  const xpmFilt = tau => (tau < 1e-15 ? XPM.rxBw : Math.atan(2 * Math.PI * XPM.rxBw * tau) / (2 * Math.PI * tau));
  function xpmWalk(fiber, Lkm, dfHz) {
    const leff = f => { const ap = f.att / 4.343; return (1 - Math.exp(-ap * Lkm)) / ap; };
    const tau = (f, d) => Math.abs(f.D) * leff(f) * 0.00801 * (d / 1e9) * 1e-12, ref = FIBERS.smf;
    const refTau = Math.abs(ref.D) * ((1 - Math.exp(-ref.att / 4.343 * 80)) / (ref.att / 4.343)) * 0.00801 * 75 * 1e-12;
    return Math.min(8, xpmFilt(tau(fiber, dfHz)) / xpmFilt(refTau));
  }
  function xpmSpanPenalty(fiber, Lkm, nNeigh, pchW, w) {
    const ap = fiber.att / 4.343, Leff = (1 - Math.exp(-ap * Lkm)) / ap;
    return w * nNeigh * lin(db(pchW * 1000)) * (Leff / 21.7);
  }
  // GN-model optimum launch power per channel (dBm) for one span: minimise ASE/P + eta*P^2, so P = (A / 2 eta)^(1/3) with A the
  // amplifier noise in the signal bandwidth. Depends on the channel count (more channels, more nonlinearity, lower optimum).
  function optLaunch(fiber, Lkm, Rs, nch, df, nfDb, lossDb) {
    const eta = etaNLI(fiber, Lkm, Rs, nch, df), A = lin(ampNfEff(nfDb, lossDb)) * H * NU * lin(lossDb) * Rs;
    return Math.min(8, Math.max(-8, db((A / (2 * eta)) ** (1 / 3) * 1000)));
  }
  function ampNfEff(nf, g) { return nf + (g < 14 ? 0.35 * (14 - g) : 0) + (g > 30 ? 0.2 * (g - 30) : 0); }

  function qFromBer(b) { b = Math.max(b, 1e-300); return 20 * Math.log10(Math.SQRT2 * erfcinv(2 * Math.min(b, 0.4999))); }

  // SNR (linear, in Rs) -> effective after trx terms
  function effSnr(mode, snrLine, extraPenDb) {
    const inv = 1 / snrLine + 1 / lin(mode.snrTrx);
    return lin(db(1 / inv) - mode.pen - (extraPenDb || 0));
  }
  function requiredOsnr(mode) {
    // OSNR (0.1nm, ASE-only) at which BER hits FEC threshold, back-to-back
    let lo = 0, hi = 45;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2, snr = lin(m) * BREF / mode.Rs;
      const ber = MODS[mode.mod].ber(effSnr(mode, snr, 0));
      if (ber > mode.berThr) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  }
  // required SNR (effective) at threshold
  function requiredEffSnrDb(mode) {
    let lo = -5, hi = 30; const f = MODS[mode.mod].ber;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(lin(m)) > mode.berThr) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  return { H, NU, BREF, db, lin, erfc, erfcinv, MODS, FIBERS, MODES, beta2, etaNLI, optLaunch, TRANSIENT, filterPenaltyPerPass, CBAND, cBandSlots, EOL, slotFreqTHz, nliPlanFactor, RAMAN_PUMPS, ramanRel, drsRatio, NLI_COH_CD, ramanFwdNliFactor, XPM, xpmWalk, xpmSpanPenalty, ramanGainSat, ramanSolve, ramanShape, nliCorrelation, RAMAN, ramanGain, srsTilt, CLIENT_OPTICS, clientBudget, ampNfEff, cdPenalty, qFromBer, effSnr, requiredOsnr, requiredEffSnrDb };
})();
if (typeof module !== 'undefined') module.exports = PHY;
