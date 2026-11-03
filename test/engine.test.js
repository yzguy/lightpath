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

test('Raman gain: zero when off, grows with pump, smaller on large-core fiber', () => {
  assert.equal(P.ramanGain(P.FIBERS.smf, 80, 0), 0);
  const g1 = P.ramanGain(P.FIBERS.smf, 80, 500), g2 = P.ramanGain(P.FIBERS.smf, 80, 1000);
  assert.ok(g1 > 5 && g1 < 12, `500 mW ${g1}`);
  assert.ok(g2 > g1 && g2 > 10 && g2 < 22, `1 W ${g2}`);
  assert.ok(P.ramanGain(P.FIBERS.ull, 80, 1000) < g2);
});

test('NLI correlation is full for a flat dispersion map and gone once dispersion has built up', () => {
  assert.equal(P.nliCorrelation(0), 1);
  assert.ok(P.nliCorrelation(200) > 0 && P.nliCorrelation(200) < 1);
  assert.equal(P.nliCorrelation(P.NLI_COH_CD), 0);
  assert.equal(P.nliCorrelation(-5000), 0);
});

test('Raman pump depletion: negligible for a weak signal, real for a heavy one', () => {
  const light = P.ramanGainSat(P.FIBERS.smf, 80, 1000, 0.001, 17), heavy = P.ramanGainSat(P.FIBERS.smf, 80, 1000, 0.3, 17);
  assert.ok(light.gain > light.g0 * 0.99);
  assert.ok(heavy.gain < light.gain - 1, `${light.gain} vs ${heavy.gain}`);
  assert.ok(heavy.depletion > light.depletion);
  assert.equal(P.ramanGainSat(P.FIBERS.smf, 80, 0, 0.1, 17).gain, 0);
});

test('XPM penalty grows with neighbours and launch power', () => {
  const f = P.FIBERS.smf, a = P.xpmSpanPenalty(f, 80, 4, 0.001, P.XPM.same);
  assert.ok(P.xpmSpanPenalty(f, 80, 8, 0.001, P.XPM.same) > a);
  assert.ok(P.xpmSpanPenalty(f, 80, 4, 0.002, P.XPM.same) > a);
  assert.ok(P.xpmSpanPenalty(f, 80, 4, 0.001, P.XPM.coh) > a);
});

// ---- coupled-wave Raman solver ----
const sigs = (fs, mw) => fs.map(f => ({ fTHz: f, mW: mw }));
test('raman solver: a 1 W backward pump gives about 12 to 15 dB on 80 km of SMF, more power gives more gain', () => {
  const smf = P.FIBERS.smf, r1 = P.ramanSolve(smf, 80, [{ fTHz: 206.8, mW: 1000, dir: 'back' }], sigs([192.5, 194.5, 196], 0.05));
  r1.gainDb.forEach(g => assert.ok(g > 11 && g < 16, `gain ${g}`));
  assert.ok(Math.abs(r1.gain0Db[1] - r1.gainDb[1]) < 0.2, 'small signals do not deplete the pump');
  const r2 = P.ramanSolve(smf, 80, [{ fTHz: 206.8, mW: 500, dir: 'back' }], sigs([194.5], 0.05));
  assert.ok(r1.gainDb[1] > r2.gainDb[0] * 1.7, 'gain grows about linearly with pump power');
  assert.ok(Math.abs(r2.gainDb[0] / r1.gainDb[1] - 0.5) < 0.06);
  // the gain curve peaks about 13 THz below the pump: the 196 THz channel is nearer the pump and past the peak? no: lower frequencies are further, so ripple is a few dB
  assert.ok(Math.max(...r1.gainDb) - Math.min(...r1.gainDb) > 0.5 && Math.max(...r1.gainDb) - Math.min(...r1.gainDb) < 4);
});

test('raman solver: strong signals deplete the pump and lose gain', () => {
  const smf = P.FIBERS.smf, pump = [{ fTHz: 206.8, mW: 1000, dir: 'back' }];
  const weak = P.ramanSolve(smf, 80, pump, sigs([194.5], 0.05)), strong = P.ramanSolve(smf, 80, pump, sigs([194.5], 100));
  assert.ok(weak.depletion < 0.02 && strong.depletion > 0.2, `${weak.depletion} ${strong.depletion}`);
  assert.ok(strong.gainDb[0] < weak.gainDb[0] - 0.7, `${strong.gainDb[0]} vs ${weak.gainDb[0]}`);
  assert.ok(Math.abs(strong.gain0Db[0] - weak.gain0Db[0]) < 0.2, 'the small-signal gain does not depend on the signal power');
});

test('raman solver: photons are conserved without loss, and the long-wave pump gains from the short-wave one', () => {
  const lossless = { ...P.FIBERS.smf }, pumps = [{ fTHz: 208.0, mW: 600, dir: 'back' }, { fTHz: 204.8, mW: 400, dir: 'fwd' }, { fTHz: 207.0, mW: 300, dir: 'back' }], s = sigs([193, 195, 196], 5);
  const r = P.ramanSolve(lossless, 60, pumps, s, { att0: true });
  const flux = (i0, i1) => i0 - i1;
  const fIn = [...s.map(x => [x.fTHz, x.mW / 1000]), ...pumps.filter(p => p.dir === 'fwd').map(p => [p.fTHz, p.mW / 1000])], bIn = pumps.filter(p => p.dir === 'back').map(p => [p.fTHz, p.mW / 1000]);
  const fOut = [...s.map((x, i) => [x.fTHz, r.sigOutW[i]]), ...pumps.map((p, j) => [p, r.pumpOutW[j]]).filter(([p]) => p.dir === 'fwd').map(([p, w]) => [p.fTHz, w])], bOut = pumps.map((p, j) => [p, r.pumpOutW[j]]).filter(([p]) => p.dir === 'back').map(([p, w]) => [p.fTHz, w]);
  const sum = a => a.reduce((t, [f, w]) => t + w / f, 0);
  const net0 = sum(fIn) - sum(bOut), netL = sum(fOut) - sum(bIn);
  assert.ok(Math.abs(net0 - netL) / Math.abs(net0) < 2e-3, `photon flux in ${net0} vs out ${netL}`);
  assert.ok(flux(0, 0) === 0);
  // pump-to-pump transfer: with no signals, the 204.8 THz pump ends up stronger than its attenuation-free launch
  const pp = P.ramanSolve(lossless, 80, [{ fTHz: 208, mW: 800, dir: 'fwd' }, { fTHz: 204.8, mW: 100, dir: 'fwd' }], [], { att0: true });
  assert.ok(pp.pumpOutW[1] > 0.1 * 1.5, `the weaker, longer-wavelength pump grew: ${pp.pumpOutW[1]}`);
  assert.ok(pp.pumpOutW[0] < 0.8);
});

test('raman solver: forward and backward pumping give about the same gain, and the profiles have the right shape', () => {
  const smf = P.FIBERS.smf, s = sigs([194.5], 0.05);
  const b = P.ramanSolve(smf, 80, [{ fTHz: 206.8, mW: 800, dir: 'back' }], s), f = P.ramanSolve(smf, 80, [{ fTHz: 206.8, mW: 800, dir: 'fwd' }], s);
  assert.ok(Math.abs(b.gainDb[0] - f.gainDb[0]) < 1.5);
  const pf = f.profile.pump[0], pb = b.profile.pump[0];
  assert.ok(pf[0] > pf[pf.length - 1] * 10, 'a forward pump decays along the span');
  assert.ok(pb[pb.length - 1] > pb[0] * 10, 'a backward pump is strongest at the far end');
  const sg = b.profile.sig[0], off = b.profile.off[0];
  assert.ok(sg[sg.length - 1] > off[off.length - 1] * 10, 'the signal arrives well above its passive level');
  assert.ok(b.profile.z.length === 61 && b.profile.z[60] === 80);
  // a bidirectional pair and three pump wavelengths solve too
  const t = P.ramanSolve(smf, 80, [{ fTHz: 209.6, mW: 150, dir: 'back' }, { fTHz: 207.2, mW: 150, dir: 'back' }, { fTHz: 204.4, mW: 150, dir: 'back' }, { fTHz: 209.6, mW: 150, dir: 'fwd' }, { fTHz: 207.2, mW: 150, dir: 'fwd' }, { fTHz: 204.4, mW: 150, dir: 'fwd' }], sigs([192, 193, 194, 195, 196], 0.05));
  assert.ok(Math.max(...t.gainDb) - Math.min(...t.gainDb) < Math.max(...b.gainDb) * 0.5, 'more pump wavelengths flatten the gain');
  assert.ok(t.gainDb.every(g => g > 5));
});

test('slots sit on the ITU grid and are named by their channel number', () => {
  const P = require('../src/engine.js');
  assert.equal(P.ituChannel(193.1), 31); assert.equal(P.ituChannel(192.1), 21); assert.equal(P.ituChannel(196.0), 60); assert.equal(P.ituChannel(193.15), 31.5);
  assert.ok(Math.abs(P.wavelengthNm(193.1) - 1552.52) < 0.005, '193.1 THz is 1552.52 nm');
  for (const gHz of [50, 75, 100, 150]) {
    const df = gHz * 1e9, n = P.cBandSlots(df);
    for (let k = 0; k < n; k++) { const f = P.slotFreqTHz(k, df), idx = (f - 193.1) / (gHz / 1000); assert.ok(Math.abs(idx - Math.round(idx)) < 1e-6, `${gHz} GHz slot ${k + 1} is a whole number of spacings from 193.1 THz`); }
    const first = P.slotFreqTHz(0, df) * 1e12;
    assert.ok(first - df / 2 >= P.CBAND.f0 - 1, 'the first slot lies inside the band'); assert.ok(first - df - df / 2 < P.CBAND.f0, 'and is the first that does');
    assert.ok(P.slotFreqTHz(n - 1, df) <= 196.1 + 1e-9, 'the last slot centre is at or below 196.1 THz');
    assert.ok(Math.abs(P.slotFreqTHz(1, df) - P.slotFreqTHz(0, df) - gHz / 1000) < 1e-9, 'neighbouring slots are one spacing apart');
  }
  // 193.1 THz is CH31 at every spacing, and the label carries channel, frequency and wavelength
  const c = P.slotChannel(17, 100e9); assert.equal(c.ch, 31); assert.match(c.text, /^CH31 · 193\.10 THz · 1552\.52 nm$/);
  assert.match(P.slotChannel(0, 50e9).text, /^CH13\.5 · 191\.35 THz/);
});
