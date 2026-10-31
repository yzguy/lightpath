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
  };

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

  return { H, NU, BREF, db, lin, erfc, erfcinv, MODS, FIBERS, MODES, beta2, etaNLI, filterPenaltyPerPass, ampNfEff, qFromBer, effSnr, requiredOsnr, requiredEffSnrDb };
})();
if (typeof module !== 'undefined') module.exports = PHY;
