const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/engine.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

test('required OSNR matches the calibrated reference values', () => {
  near(P.requiredOsnr(P.MODES.zr400), 23, 0.5, '400ZR');
  near(P.requiredOsnr(P.MODES.zrp400), 22, 0.5, '400G ZR+');
  near(P.requiredOsnr(P.MODES.c100), 11.6, 0.3, '100G');
});

test('higher-order formats need more OSNR at the same baud rate', () => {
  assert.ok(P.requiredOsnr(P.MODES.zrp400) > P.requiredOsnr(P.MODES.zrp200));
});

test('erfc: known values, symmetry, and inverse round trip', () => {
  near(P.erfc(0), 1, 1e-7);
  near(P.erfc(1), 0.157299207, 1e-6);
  near(P.erfc(-1) + P.erfc(1), 2, 1e-7);
  for (const y of [1e-9, 1e-4, 0.02, 0.5, 1.5]) near(P.erfc(P.erfcinv(y)) / y, 1, 1e-4, `erfcinv(${y})`);
});

test('Q-factor of BER, against textbook values', () => {
  near(P.qFromBer(1e-3), 9.8, 0.05);
  near(P.qFromBer(1e-2), 7.3, 0.1);
  near(P.qFromBer(2e-2), 6.3, 0.1);
});

test('BER decreases monotonically with SNR for every modulation', () => {
  for (const k in P.MODS) {
    let prev = 1;
    for (let d = -5; d <= 30; d += 1) { const b = P.MODS[k].ber(P.lin(d)); assert.ok(b <= prev, `${k} at ${d} dB`); prev = b; }
  }
});

test('GN model: NLI efficiency grows with channel count and shrinks with low-gamma fiber', () => {
  const Rs = P.MODES.zrp400.Rs, df = 75e9;
  assert.ok(P.etaNLI(P.FIBERS.smf, 80, Rs, 64, df) > P.etaNLI(P.FIBERS.smf, 80, Rs, 1, df));
  assert.ok(P.etaNLI(P.FIBERS.ull, 80, Rs, 32, df) < P.etaNLI(P.FIBERS.smf, 80, Rs, 32, df));
});

test('amplifier effective NF worsens outside the nominal gain window', () => {
  assert.equal(P.ampNfEff(5, 20), 5);
  assert.ok(P.ampNfEff(5, 8) > 5);
  assert.ok(P.ampNfEff(5, 36) > 5);
});

test('filter penalty is monotonic in baud-rate / slot ratio', () => {
  let prev = 0;
  for (const df of [150, 100, 75, 62.5, 50]) { const v = P.filterPenaltyPerPass(60e9, df * 1e9); assert.ok(v >= prev); prev = v; }
});

test('every mode has the fields the app reads', () => {
  for (const k in P.MODES) {
    const m = P.MODES[k];
    for (const f of ['name', 'short', 'rate', 'Rs', 'mod', 'fec', 'berThr', 'tx', 'txOsnr', 'rxMin', 'rxMax', 'cdTol', 'dgdTol', 'snrTrx', 'pen']) assert.ok(m[f] !== undefined, `${k}.${f}`);
    assert.ok(P.MODS[m.mod], `${k} modulation`);
  }
});

test('C-band slot count per grid', () => {
  assert.equal(P.cBandSlots(50e9), 96);
  assert.equal(P.cBandSlots(75e9), 64);
  assert.equal(P.cBandSlots(100e9), 48);
  assert.equal(P.cBandSlots(150e9), 32);
});

test('SRS tilt: zero for one channel, grows with power, channel count and span length', () => {
  const f = P.FIBERS.smf, W = P.lin(0) / 1000;
  assert.equal(P.srsTilt(f, 80, W, 1, 75e9), 0);
  const base = P.srsTilt(f, 80, W, 64, 75e9);
  near(base, 0.9, 0.5, 'order of magnitude: ~1 dB/span for a full C-band at 0 dBm');
  assert.ok(P.srsTilt(f, 80, W * 2, 64, 75e9) > base);
  assert.ok(P.srsTilt(f, 80, W, 32, 75e9) < base);
  assert.ok(P.srsTilt(f, 20, W, 64, 75e9) < base);
  assert.ok(P.srsTilt(P.FIBERS.ull, 80, W, 64, 75e9) < base, 'large-core fiber has less Raman tilt');
});

test('client optics: budget, overload, reach and LOS', () => {
  const ok = P.clientBudget({ optic: '100g-lr4', len: 0.1, extra: 1 });
  assert.equal(ok.status, 'ok');
  near(ok.rx, -1.035, 0.01);
  assert.equal(P.clientBudget({ optic: '100g-lr4', len: 30, extra: 1 }).status, 'down', 'LR4 over 30 km runs out of budget');
  const er = P.clientBudget({ optic: '10g-er', len: 0.05, extra: 0.5 });
  assert.equal(er.status, 'warn');
  assert.match(er.notes[0], /overload/, 'ER optic on a short jumper overloads the receiver');
  const far = P.clientBudget({ optic: '400g-dr4', len: 1.5, extra: 0.5 });
  assert.ok(far.notes.some(n => /rated reach/.test(n)), 'DR4 beyond 500 m');
  for (const k in P.CLIENT_OPTICS) for (const f of ['name', 'rate', 'reach', 'att', 'tx', 'rxMin', 'rxMax']) assert.ok(P.CLIENT_OPTICS[k][f] !== undefined, `${k}.${f}`);
});

test('10G DWDM is a direct-detection mode: sane OSNR, dispersion penalty only without a DSP', () => {
  const m = P.MODES.dwdm10, req = P.requiredOsnr(m);
  assert.ok(req > 16 && req < 24, `required OSNR ${req}`);
  assert.equal(m.coh, false);
  assert.equal(P.cdPenalty(P.MODES.zr400, 2000), 0);
  assert.ok(P.cdPenalty(m, 800) > 0 && P.cdPenalty(m, 1600) > P.cdPenalty(m, 800));
});
