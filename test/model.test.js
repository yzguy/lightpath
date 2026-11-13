const test = require('node:test');
const assert = require('node:assert/strict');
const PHY = require('../src/engine.js');
const M = require('../src/model.js');

const build = k => { const p = M.PRESETS[k].build(); return { nodes: p.nodes, links: p.links, g: p.g, svc: p.svc, flows: p.flows }; };
// The same lab with its transponders unplugged from the mux ports: channels come from Line load and the plan, not the cabling.
const uniform = k => { const S = build(k); S.links.forEach(l => { l.p.mport = null; }); return S; };
const clone = o => JSON.parse(JSON.stringify(o));

test('presets simulate to their intended status', () => {
  assert.equal(M.simulate(build('dci')).status, 'up');
  assert.equal(M.simulate(build('lh')).status, 'up');
  assert.equal(M.simulate(build('ring')).status, 'up');
  assert.equal(M.simulate(build('dark')).status, 'degraded'); // unamplified: Rx LOW alarm
});

test('every preset only references devices that exist', () => {
  for (const k in M.PRESETS) {
    const S = build(k), ids = new Set(S.nodes.map(n => n.id));
    for (const l of S.links) assert.ok(ids.has(l.a) && ids.has(l.b), `${k}: dangling link`);
    assert.ok(ids.has(S.svc.a) && ids.has(S.svc.z), `${k}: service ends`);
    assert.deepEqual(M.sanitize(S).nodes.length, S.nodes.length, `${k}: sanitize keeps a valid preset intact`);
  }
});

test('cutting the only fiber gives LOS', () => {
  const S = build('dci'); S.links.find(l => l.kind === 'fiber').p.cut = true;
  const r = M.simulate(S);
  assert.equal(r.status, 'los');
  assert.equal(r.rerouteCut, true);
});

test('ROADM triangle restores around a cut, with more distance', () => {
  const S = build('ring'), base = M.simulate(S);
  const direct = S.links.find(l => l.kind === 'fiber' && l.p.len === 70);
  direct.p.cut = true;
  const r = M.simulate(S);
  assert.equal(r.status, 'up');
  assert.equal(r.rerouteCut, false);
  assert.ok(r.km > base.km);
  assert.ok(r.osnr < base.osnr);
});

test('light does not route through a third transponder', () => {
  const S = uniform('dci'), ids = S.nodes.filter(n => n.type === 'trx').map(n => n.id);
  S.svc = { a: ids[0], z: ids[1] }; // two transponders on the same mux
  const r = M.simulate(S);
  assert.ok(r.path.nodes.every((id, i) => i === 0 || i === r.path.nodes.length - 1 || S.nodes.find(n => n.id === id).type !== 'trx'));
});

test('no cable between the ends gives nopath; bad service gives none', () => {
  const S = build('dark'); S.links = [];
  assert.equal(M.simulate(S).status, 'nopath');
  S.svc.z = null;
  assert.equal(M.simulate(S).status, 'none');
});

test('a very long unamplified span is LOS, and CD limit takes 400ZR down', () => {
  const S = build('dark'); S.links[0].p.len = 200;
  assert.equal(M.simulate(S).status, 'los');
  const L = build('lh'); L.nodes.filter(n => n.type === 'trx').forEach(n => (n.p.mode = 'zr400'));
  const r = M.simulate(L);
  assert.equal(r.status, 'down');
  assert.match(r.headline, /Chromatic dispersion/);
});

test('mode mismatch between ends takes the link down', () => {
  const S = uniform('dci'); S.nodes.find(n => n.id === S.svc.z).p.mode = 'c100';
  const r = M.simulate(S);
  assert.equal(r.status, 'down');
  assert.match(r.headline, /Mode mismatch/);
});

test('launch-power sweep has an interior optimum (ASE-limited low, NLI-limited high)', () => {
  const S = build('lh'), pts = [];
  for (let p = -8; p <= 8; p += 0.5) pts.push([p, M.simulate(S, p).gosnr]);
  const best = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
  assert.ok(best[0] > -8 && best[0] < 8, `optimum at ${best[0]}`);
  assert.ok(M.simulate(S, 0).gosnr > M.simulate(S, -8).gosnr);
  assert.ok(M.simulate(S, 0).gosnr > M.simulate(S, 8).gosnr);
});

test('simulate does not mutate the topology', () => {
  const S = build('lh'), before = JSON.stringify(S);
  M.simulate(S); M.simulate(S, 3);
  assert.equal(JSON.stringify(S), before);
});

test('amplifier total-output limit is enforced and flagged', () => {
  const S = uniform('lh'); S.g.df = 50; S.g.nch = 96; S.g.launch = 6; // 96 channels fit the C band at 50 GHz
  const r = M.simulate(S);
  assert.ok(r.alarms.some(a => /total output limit/.test(a.text)));
});

test('sanitize: drops junk, fills defaults, keeps valid data', () => {
  const S = build('dci');
  const dirty = clone(S);
  dirty.nodes.push({ id: 'x1', type: 'warpcore', name: 'bad', x: 0, y: 0, p: {} });   // unknown type
  dirty.nodes.push({ id: 'x2', type: 'voa', name: 7, x: 'nope', y: null, p: { att: 'abc' } });
  dirty.links.push({ id: 'lx', a: 'x2', b: 'ghost', kind: 'patch', p: {} });         // dangling
  dirty.nodes[0].p.mode = 'nonsense';
  dirty.links.find(l => l.kind === 'fiber').p.fiber = 'unobtainium';
  dirty.g = { nch: 'many', df: 33, launch: '1.5' };
  dirty.svc = { a: 'ghost', z: S.svc.z };
  const c = M.sanitize(dirty);
  assert.equal(c.nodes.length, S.nodes.length + 1);
  assert.equal(c.links.length, S.links.length);
  const v = c.nodes.find(n => n.id === 'x2');
  assert.deepEqual([v.name, v.x, v.y, v.p.att], ['7', 0, 0, 5]);
  assert.equal(c.nodes[0].p.mode, 'zr400');
  assert.equal(c.links.find(l => l.kind === 'fiber').p.fiber, 'smf');
  assert.deepEqual(c.g, { nch: 16, df: 100, launch: 1.5, neighbors: "same", reopt: false, plan: null, tempC: 27, eolSpan: 1, eolTrx: 0.5, rampMs: 0, lossPct: 50, agcUs: 20, cutRate: 3, mttr: 12, detectMs: 5, switchMs: 30, sharedSec: 3, restoreSec: 60, devRate: 0.02 });
  assert.deepEqual(c.svc, { a: null, z: S.svc.z });
  assert.ok(M.simulate(c).status); // and the cleaned topology simulates without throwing
});

test('sanitize rejects non-topologies', () => {
  for (const bad of [null, 5, 'x', {}, { nodes: [] }, { nodes: {}, links: [] }]) assert.throws(() => M.sanitize(bad));
});

test('required OSNR is cached per mode', () => {
  assert.equal(M.reqOsnr('zr400'), M.reqOsnr('zr400'));
  assert.ok(Math.abs(M.reqOsnr('zr400') - PHY.requiredOsnr(PHY.MODES.zr400)) < 1e-9);
});

test('per-span channel loading: fewer lit channels on a span means less NLI downstream', () => {
  const S = uniform('lh'); S.g.launch = 3;
  const base = M.simulate(S);
  S.links.filter(l => l.kind === 'fiber').forEach(l => (l.p.nch = 4));
  const thin = M.simulate(S);
  assert.ok(thin.snrNli > base.snrNli, 'NLI should drop');
  assert.ok(thin.hops.some(h => h.kind === 'span' && h.nch === 4));
  assert.equal(base.hops.filter(h => h.kind === 'span')[0].nch, 48);
});

test('channels that do not fit the C-band grid raise an alarm', () => {
  const S = uniform('lh'); // 48 ch at 100 GHz fits exactly
  assert.ok(!M.simulate(S).alarms.some(a => /do not fit/.test(a.text)));
  S.g.nch = 96;
  assert.ok(M.simulate(S).alarms.some(a => /do not fit/.test(a.text)));
  S.g.nch = 64;
  assert.ok(M.simulate(S).alarms.some(a => /do not fit/.test(a.text)));
  S.g.df = 75; // 64 fit a 75 GHz grid
  assert.ok(!M.simulate(S).alarms.some(a => /do not fit/.test(a.text)));
});

test('sanitize: span channel override must be blank or >= 1', () => {
  const S = build('lh'), f = S.links.find(l => l.kind === 'fiber');
  f.p.nch = 'lots';
  assert.equal(M.sanitize(S).links.find(l => l.id === f.id).p.nch, '');
  f.p.nch = 12;
  assert.equal(M.sanitize(S).links.find(l => l.id === f.id).p.nch, 12);
  f.p.nch = 0;
  assert.equal(M.sanitize(S).links.find(l => l.id === f.id).p.nch, '');
});

test('end-of-life: always worse than today, and flagged when it flips a passing link to failing', () => {
  for (const k in M.PRESETS) { const r = M.simulate(build(k)); assert.ok(r.eol.qMargin < r.qMargin, k); }
  const S = build('lh'); S.nodes.filter(n => n.type === 'edfa').forEach(n => (n.p.gmax = 30));
  S.links.filter(l => l.kind === 'fiber').forEach(l => (l.p.len += 8)); // push it to the edge
  let r = M.simulate(S);
  for (let i = 0; i < 40 && !(r.qMargin >= 0 && r.eol.qMargin < 0); i++) { S.links.filter(l => l.kind === 'fiber').forEach(l => (l.p.len += 1)); r = M.simulate(S); }
  assert.ok(r.qMargin >= 0 && r.eol.qMargin < 0, 'found a topology that works now but fails at end of life');
  assert.ok(r.alarms.some(a => /end of life/.test(a.text)));
});

test('SRS tilt: accumulates without tilt control, is reset by it, and hurts the edge channel', () => {
  const S = build('lh'), amps = S.nodes.filter(n => n.type === 'edfa');
  const on = M.simulate(S);
  amps.forEach(n => (n.p.tiltCtl = false));
  const off = M.simulate(S);
  assert.ok(off.tilt > 3 * on.tilt, `tilt ${on.tilt} -> ${off.tilt}`);
  assert.ok(off.worstQMargin < on.worstQMargin);
  assert.ok(off.worstQMargin < off.qMargin, 'worst channel is worse than the mid-band service channel');
});

test('a single lit channel has no SRS tilt', () => {
  const S = build('dark');
  const r = M.simulate(S);
  assert.equal(r.tilt, 0);
  assert.ok(Math.abs(r.worstQMargin - r.qMargin) < 1e-9);
});

test('ROADM re-equalises tilt', () => {
  const S = build('ring'); S.g.nch = 64; S.g.launch = 3;
  const r = M.simulate(S);
  assert.ok(r.hops.filter(h => h.kind === 'roadm').every(h => h.tilt === 0));
});

test('sanitize keeps the amplifier tilt-control flag a boolean', () => {
  const S = build('lh'), a = S.nodes.find(n => n.type === 'edfa');
  a.p.tiltCtl = 'maybe';
  assert.equal(M.sanitize(S).nodes.find(n => n.id === a.id).p.tiltCtl, true);
  a.p.tiltCtl = false;
  assert.equal(M.sanitize(S).nodes.find(n => n.id === a.id).p.tiltCtl, false);
});

const mxpTopo = () => build('mxp');
const mx = (S, which) => S.nodes.find(n => n.id === S.svc[which]);

test('muxponder preset: 4x100G fills a 400G ZR+ line and the service is up', () => {
  const S = mxpTopo(), r = M.simulate(S);
  assert.equal(r.status, 'up');
  assert.equal(r.clients.length, 2);
  assert.equal(r.clients[0].total, 400);
  assert.ok(r.clients[0].ports.every(p => p.status === 'ok'));
});

test('muxponder clients that exceed the line rate take the service down', () => {
  const S = mxpTopo(); mx(S, 'a').p.clients.push(M.newClient('100g-lr4'));
  const r = M.simulate(S);
  assert.equal(r.status, 'down');
  assert.match(r.headline, /500G/);
});

test('underfilled line is informational only', () => {
  const S = mxpTopo(); mx(S, 'a').p.clients.pop(); mx(S, 'z').p.clients.pop();
  const r = M.simulate(S);
  assert.equal(r.status, 'up');
  assert.ok(r.alarms.some(a => a.sev === 'info' && /300G of the 400G/.test(a.text)));
});

test('400ZR line cannot multiplex sub-rate clients; ZR+ can', () => {
  const S = mxpTopo(); S.nodes.filter(n => n.type === 'mxp').forEach(n => (n.p.mode = 'zr400'));
  assert.ok(M.simulate(S).alarms.some(a => /single 400GbE client/.test(a.text)));
  S.nodes.filter(n => n.type === 'mxp').forEach(n => { n.p.mode = 'zrp400'; });
  assert.ok(!M.simulate(S).alarms.some(a => /single 400GbE client/.test(a.text)));
});

test('a client port with a dead budget raises a bad alarm without taking the line down', () => {
  const S = mxpTopo(); mx(S, 'z').p.clients[2].len = 40;
  const r = M.simulate(S);
  assert.ok(r.alarms.some(a => a.sev === 'bad' && /client 3/.test(a.text)));
  assert.notEqual(r.status, 'down');
});

test('mismatched client totals between the ends are flagged', () => {
  const S = mxpTopo(); mx(S, 'z').p.clients.pop();
  assert.ok(M.simulate(S).alarms.some(a => /Client rates differ/.test(a.text)));
});

test('a muxponder can be one end and a transponder the other; light never passes through either', () => {
  const S = mxpTopo(), z = mx(S, 'z'); z.type = 'trx'; z.p = { mode: 'zrp400', tx: null };
  const r = M.simulate(S);
  assert.equal(r.clients.length, 1);
  assert.equal(r.status, 'up');
  const T = mxpTopo(), third = { id: 'mxp3', type: 'mxp', name: 'MXP-3', x: 0, y: 0, p: { ...M.TYPES.mxp.def() } };
  T.nodes.push(third); T.links.push({ id: 'lx3', a: third.id, b: T.nodes.find(n => n.name === 'MUX-A').id, kind: 'patch', p: { il: 0.5, cut: false } });
  assert.ok(M.simulate(T).path.nodes.every(id => id !== 'mxp3'));
});

test('sanitize: muxponder client ports are validated and capped', () => {
  const S = mxpTopo(), a = mx(S, 'a');
  a.p.clients = [{ optic: 'warp-9', len: 'far', extra: -3 }, null, { optic: '400g-fr4', len: 2, extra: 0.5 }, ...Array(10).fill({ optic: '10g-lr', len: 1, extra: 1 })];
  const c = M.sanitize(S).nodes.find(n => n.id === a.id).p.clients;
  assert.equal(c.length, 8);
  assert.deepEqual(c[0], { optic: '100g-lr4', len: 0.1, extra: 1 });
  assert.deepEqual(c[1], { optic: '100g-lr4', len: 0.1, extra: 1 });
  assert.deepEqual(c[2], { optic: '400g-fr4', len: 2, extra: 0.5 });
  delete a.p.clients;
  assert.equal(M.sanitize(S).nodes.find(n => n.id === a.id).p.clients.length, 4);
  assert.ok(M.simulate(M.sanitize(S)).status);
});

test('10G DWDM preset works at 60 km and fails once dispersion passes the limit', () => {
  const S = build('sfp10'), r = M.simulate(S);
  assert.equal(r.status, 'up');
  assert.ok(r.cdPen > 0 && r.cdPen < 1);
  const L = clone(S); L.links.find(l => l.kind === 'fiber').p.len = 110; // 110 km * 17 = 1870 ps/nm > 1600
  const r2 = M.simulate(L);
  assert.equal(r2.status, 'down');
  assert.match(r2.headline, /dispersion tolerance/);
});

test('fromSpans builds a working line from CSV and reports bad rows', () => {
  const r = M.fromSpans('km,fiber,extra_db\n80,smf,1.5\n# comment\n95,G.654\n70,ull,1\n');
  assert.deepEqual(r.errors, []);
  assert.equal(r.spans.length, 3);
  assert.deepEqual(r.spans.map(s => s.fiber), ['smf', 'ull', 'ull']);
  const S = M.sanitize(r.topo);
  assert.equal(S.links.filter(l => l.kind === 'fiber').length, 3);
  assert.equal(S.nodes.filter(n => n.type === 'edfa').length, 4); // booster, 2 ILAs, preamp
  const sim = M.simulate(S);
  assert.ok(['up', 'degraded'].includes(sim.status), sim.headline);
  assert.ok(Math.abs(sim.km - 245) < 1);
  const bad = M.fromSpans('80,smf\nabc,smf\n-5\n50,foo\n60,smf,99');
  assert.equal(bad.spans.length, 1);
  assert.equal(bad.errors.length, 4);
  assert.equal(M.fromSpans('').topo, null);
});

test('a DCM rescues a 10G optic past its dispersion limit; host FEC adds margin', () => {
  const S = build('sfp10dcm'), r = M.simulate(S);
  assert.equal(r.status, 'up', r.headline);
  assert.ok(Math.abs(r.cd - (120 * 17 - 1360)) < 1e-6);
  const nodcm = clone(S); nodcm.nodes.find(n => n.type === 'dcm').p.cd = 0;
  const r2 = M.simulate(nodcm);
  assert.equal(r2.status, 'down'); // 2040 ps/nm > 1600
  assert.match(r2.headline, /dispersion tolerance/);
  // same line, FEC-less optic needs more OSNR than the host-FEC variant
  assert.ok(PHY.requiredOsnr(PHY.MODES.dwdm10f) < PHY.requiredOsnr(PHY.MODES.dwdm10) - 3);
});

test('sanitize keeps DCM devices and defaults bad values', () => {
  const S = build('sfp10dcm'); S.nodes.find(n => n.type === 'dcm').p.cd = 'junk';
  assert.equal(M.sanitize(S).nodes.find(n => n.type === 'dcm').p.cd, -1360);
});

test('end-of-life allowances are configurable and sanitized', () => {
  const S = build('dci'), base = M.simulate(S).eol.qMargin;
  const hard = clone(S); hard.g.eolSpan = 3; hard.g.eolTrx = 1.5;
  assert.ok(M.simulate(hard).eol.qMargin < base);
  const none = clone(S); none.g.eolSpan = 0; none.g.eolTrx = 0;
  const rn = M.simulate(none);
  assert.ok(Math.abs(rn.eol.qMargin - rn.qMargin) < 1e-6); // no allowance: end of life equals today
  const bad = clone(S); bad.g.eolSpan = 99; bad.g.eolTrx = 'x';
  const g = M.sanitize(bad).g;
  assert.equal(g.eolSpan, 5); assert.equal(g.eolTrx, 0.5);
});

test('Raman pump improves a long single span: higher OSNR and less gain needed downstream', () => {
  const mk = pump => { const S = build('dci'); S.links.find(l => l.kind === 'fiber').p.len = 110; S.links.find(l => l.kind === 'fiber').p.raman = pump; return S; };
  const off = M.simulate(mk(0)), on = M.simulate(mk(800));
  assert.ok(on.osnr > off.osnr + 2, `OSNR ${off.osnr} -> ${on.osnr}`);
  assert.ok(on.osnr < off.osnr + 12, 'benefit stays realistic');
  const span = on.hops.find(h => h.kind === 'span');
  assert.ok(span.raman > 5);
  assert.ok(M.simulate(mk(1400)).alarms.some(a => /Class 4/.test(a.text)));
  assert.ok(!off.alarms.some(a => /Class 4/.test(a.text)));
  // net span loss is lower, so the preamp has less to make up
  const pre = r => r.hops.find(h => h.name === 'PRE-B').gain;
  assert.ok(pre(on) < pre(off) - 5);
  assert.ok(on.snrNli < off.snrNli, 'Raman raises the nonlinear noise');
  assert.ok(on.snrAse > off.snrAse, 'and lowers the ASE noise');
});

test('sanitize clamps the Raman pump and defaults old topologies to off', () => {
  const S = build('dci'); const f = S.links.find(l => l.kind === 'fiber');
  f.p.raman = 99999; assert.equal(M.sanitize(S).links.find(l => l.kind === 'fiber').p.raman, PHY.RAMAN.maxMw);
  delete f.p.raman; assert.equal(M.sanitize(S).links.find(l => l.kind === 'fiber').p.raman, 0);
  f.p.raman = 'junk'; assert.equal(M.sanitize(S).links.find(l => l.kind === 'fiber').p.raman, 0);
});

test('both directions are simulated; symmetric lines match, per-direction settings only move one way', () => {
  const S = build('dci'), r = M.simulate(S);
  assert.ok(r.rev && r.rev.reverse === true);
  assert.equal(r.rev.A.id, S.svc.z); // reverse transmits from Z
  assert.ok(Math.abs(r.rev.qMargin - r.qMargin) < 0.5, 'symmetric line, near-equal margin');
  assert.equal(M.simulate(S, undefined, { single: true }).rev, undefined);

  const dirty = clone(S); dirty.links.find(l => l.kind === 'fiber').p.extraRev = 14; // dirty connector on the return fiber only
  const d = M.simulate(dirty);
  assert.ok(Math.abs(d.qMargin - r.qMargin) < 1e-9, 'forward direction unchanged');
  assert.ok(d.rev.qMargin < r.rev.qMargin - 1, 'reverse direction worse');
  assert.notEqual(d.status, 'up');
  assert.match(d.headline, /to TRX-A1/); // reported as the worse direction

  const amp = clone(S); amp.nodes.find(n => n.name === 'PRE-B').p.targetRev = -8; // reverse booster launches low
  const a = M.simulate(amp);
  assert.ok(Math.abs(a.qMargin - r.qMargin) < 1e-9);
  assert.ok(a.rev.osnr < r.rev.osnr - 1);
});

test('a one-way fiber problem takes the whole service down and sanitize cleans per-direction fields', () => {
  const S = build('dci'); S.links.find(l => l.kind === 'fiber').p.extraRev = 30;
  const r = M.simulate(S);
  assert.equal(r.rev.status !== 'up', true);
  assert.ok(['down', 'los', 'degraded'].includes(r.status));
  const bad = build('dci'); const f = bad.links.find(l => l.kind === 'fiber'); f.p.extraRev = 'x'; f.p.ramanRev = -5;
  bad.nodes.find(n => n.type === 'edfa').p.targetRev = 'junk';
  const c = M.sanitize(bad);
  assert.equal(c.links.find(l => l.kind === 'fiber').p.extraRev, '');
  assert.equal(c.links.find(l => l.kind === 'fiber').p.ramanRev, '');
  assert.equal(c.nodes.find(n => n.type === 'edfa').p.targetRev, '');
});

test('one-way fibers give each direction its own route', () => {
  const S = build('ring'), base = M.simulate(S);
  assert.ok(Math.abs(base.km - 70) < 1 && Math.abs(base.rev.km - 70) < 1);
  const direct = S.links.find(l => l.kind === 'fiber' && +l.p.len === 70);
  direct.p.dir = 'ab'; // ROADM-A to ROADM-C only: the return direction must go round via B
  const r = M.simulate(S);
  assert.ok(Math.abs(r.km - 70) < 1, 'forward still direct');
  assert.ok(Math.abs(r.rev.km - 210) < 1, `return goes round: ${r.rev.km}`);
  assert.ok(r.rev.path.nodes.some(id => S.nodes.find(n => n.id === id).name === 'ROADM-B'));
  // direction is a property of the cable, so the old behaviour is untouched when it is 'both'
  direct.p.dir = 'both';
  assert.equal(M.simulate(S).rev.km, base.rev.km);
});

test('a one-way fiber with no return path takes the service down', () => {
  const S = build('dci'); S.links.find(l => l.kind === 'fiber').p.dir = 'ab';
  const r = M.simulate(S);
  assert.equal(r.status, 'down');
  assert.match(r.headline, /return direction/);
  assert.equal(r.rev.status, 'nopath');
  const bad = build('dci'); bad.links.forEach(l => (l.p.dir = 'sideways'));
  assert.ok(M.sanitize(bad).links.every(l => l.p.dir === 'both'));
});

test('per-direction amplifier limits and DCM settings apply to the return direction only', () => {
  const S = build('dci'), base = M.simulate(S);
  S.nodes.find(n => n.name === 'PRE-B').p.gminRev = 25; // as the return booster it cannot turn down far enough
  const r = M.simulate(S);
  assert.deepEqual(r.alarms.filter(a => !/ to /.test(a.text)), base.alarms.filter(a => !/ to /.test(a.text)));
  assert.ok(r.rev.alarms.some(a => /PRE-B.*min gain is 25/.test(a.text)));
  const D = build('sfp10dcm'); D.nodes.find(n => n.type === 'dcm').p.cdRev = 0; // no compensation on the return fiber
  const d = M.simulate(D);
  assert.equal(M.simulate(build('sfp10dcm')).status, 'up');
  assert.ok(Math.abs(d.cd - 680) < 1e-6 && Math.abs(d.rev.cd - 2040) < 1e-6);
  assert.equal(d.status, 'down');
  assert.match(d.headline, /dispersion tolerance/);
});

test('an inline DCM keeps dispersion low, so nonlinear noise from successive spans adds coherently', () => {
  const mk = withDcm => {
    const S = M.sanitize(M.fromSpans('80\n80\n80', 'zrp400').topo);
    if (withDcm) { // DCM after each ILA, loss-free so only the dispersion map changes
      const fibers = S.links.filter(l => l.kind === 'fiber').slice(1);
      fibers.forEach((f, i) => {
        const id = 'dcm' + i;
        S.nodes.push({ id, type: 'dcm', name: 'DCM' + i, x: 0, y: 0, p: { cd: -1360, cdRev: '', il: 0, ilRev: '' } });
        S.links.push({ id: 'lp' + i, a: f.a, b: id, kind: 'patch', p: { il: 0, dir: 'both', cut: false } });
        f.a = id;
      });
    }
    return S;
  };
  const plain = M.simulate(mk(false), undefined, { single: true }), comp = M.simulate(mk(true), undefined, { single: true });
  assert.ok(Math.abs(plain.cd - 3 * 1360) < 1e-6 && Math.abs(comp.cd - 1360) < 1e-6);
  assert.ok(comp.snrNli < plain.snrNli * 0.8, `NLI SNR ${10 * Math.log10(plain.snrNli)} -> ${10 * Math.log10(comp.snrNli)} dB`);
  // NZ-DSF (low dispersion) is worse than SMF for the same line, on top of its higher gamma
  const leaf = mk(false); leaf.links.forEach(l => { if (l.kind === 'fiber') l.p.fiber = 'leaf'; });
  assert.ok(M.simulate(leaf, undefined, { single: true }).snrNli < plain.snrNli);
});

test('Raman pump direction: forward lifts the signal early (better ASE) but pays in nonlinearity; bidirectional is best overall', () => {
  const run = (dir, pumps = 1) => {
    const S = build('dci'), f = S.links.find(l => l.kind === 'fiber'); f.p.len = 110; f.p.raman = 800; f.p.ramanDir = dir; f.p.ramanPumps = pumps;
    return M.simulate(S, undefined, { single: true });
  };
  const off = (() => { const S = build('dci'); S.links.find(l => l.kind === 'fiber').p.len = 110; return M.simulate(S, undefined, { single: true }); })();
  const back = run('back'), fwd = run('fwd'), both = run('both');
  assert.ok(fwd.snrAse > back.snrAse && both.snrAse > back.snrAse && both.snrAse < fwd.snrAse, 'ASE: back < both < forward');
  assert.ok(fwd.snrNli < both.snrNli && both.snrNli < back.snrNli && back.snrNli < off.snrNli, 'NLI: forward worst, no pump best');
  assert.ok(back.gosnr > fwd.gosnr, 'forward is nonlinearity-limited');
  assert.ok(both.gosnr >= back.gosnr - 0.05 && both.gosnr > fwd.gosnr && both.gosnr > off.gosnr);
  // more pumps flatten the gain ripple across the band
  const wide = pumps => { const S = build('dci'), f = S.links.find(l => l.kind === 'fiber'); f.p.len = 110; f.p.raman = 800; f.p.ramanPumps = pumps; S.g.nch = 64; S.g.df = 75; return M.simulate(S, undefined, { single: true }); };
  assert.ok(wide(1).tilt > wide(3).tilt + 0.5, `ripple ${wide(1).tilt} vs ${wide(3).tilt}`);
  assert.ok(wide(2).tilt < wide(1).tilt && wide(3).tilt < wide(2).tilt);
  assert.ok(wide(1).tilt > run('back', 1).tilt, 'a wider lit band sees more ripple');
});

test('Raman pump depletion: a full band on a short span with a modest pump loses gain that a few channels keep', () => {
  const gainFor = nch => {
    const S = uniform('dci'), f = S.links.find(l => l.kind === 'fiber'); f.p.len = 50; f.p.raman = 300; S.g.nch = nch; S.g.launch = 3;
    return M.simulate(S, undefined, { single: true }).hops.find(h => h.kind === 'span').raman;
  };
  assert.ok(gainFor(2) > gainFor(96) + 0.2, `${gainFor(2)} vs ${gainFor(96)}`);
});

test('cross-phase modulation penalises direct-detection channels only, more beside coherent neighbours', () => {
  const S = uniform('sfp10'); S.g.nch = 40; S.g.launch = 3;
  const same = M.simulate(S, undefined, { single: true });
  assert.ok(same.xpmPen > 0);
  const coh = clone(S); coh.g.neighbors = 'coh';
  assert.ok(M.simulate(coh, undefined, { single: true }).xpmPen > same.xpmPen);
  const one = clone(S); one.g.nch = 1;
  assert.equal(M.simulate(one, undefined, { single: true }).xpmPen, 0);
  assert.equal(M.simulate(build('dci'), undefined, { single: true }).xpmPen, 0); // coherent service: not applied
  const bad = clone(S); bad.g.neighbors = 'x'; bad.links.find(l => l.kind === 'fiber').p.ramanDir = 'sideways'; bad.links.find(l => l.kind === 'fiber').p.ramanPumps = 9;
  const c = M.sanitize(bad);
  assert.equal(c.g.neighbors, 'same');
  assert.equal(c.links.find(l => l.kind === 'fiber').p.ramanDir, 'back');
  assert.equal(c.links.find(l => l.kind === 'fiber').p.ramanPumps, 3);
});

// ---- channel plan ----
const withPlan = (S, plan) => { S.g.plan = plan; return S; };
const uniformPlan = S => M.planFromUniform(S.g, S.nodes.find(n => n.id === S.svc.a).p.mode);

test('a plan that just spells out the uniform line gives the same service result', () => {
  for (const k of ['dci', 'lh', 'ring', 'sfp10']) {
    const S = build(k), base = M.simulate(S, undefined, { single: true });
    const P2 = withPlan(clone(S), uniformPlan(S)), r = M.simulate(P2, undefined, { single: true });
    assert.ok(r.channels && r.channels.length === S.g.nch, k);
    // an even-sized block puts the service one slot off-centre, which the pairwise model sees as a few thousandths of a dB
    assert.ok(Math.abs(r.qMargin - base.qMargin) < 0.02, `${k}: ${r.qMargin} vs ${base.qMargin}`);
    assert.ok(Math.abs(r.osnr - base.osnr) < 1e-9, k);
  }
});

test('the service channel row matches the headline numbers, and every channel gets its own result', () => {
  const S = build('lh'), P2 = withPlan(clone(S), uniformPlan(S)), r = M.simulate(P2, undefined, { single: true });
  const row = r.channels.find(c => c.svc);
  assert.ok(Math.abs(row.qMargin - r.qMargin) < 1e-6, `${row.qMargin} vs ${r.qMargin}`);
  assert.ok(Math.abs(row.prx - r.prx) < 1e-6);
  assert.ok(Math.abs(row.osnr - r.osnr) < 1e-6 && Math.abs(row.gosnr - r.gosnr) < 1e-6);
  // edge channels see less nonlinear noise than the centre, so margin is not identical across the band
  assert.ok(r.channels.some(c => Math.abs(c.qMargin - row.qMargin) > 1e-3));
});

test('a mixed line: each channel has its own mode, and a 10G channel beside 400G gets an XPM penalty', () => {
  const S = uniform('dci');
  S.nodes.filter(isTrx => isTrx.type === 'trx').forEach(n => (n.p.mode = 'dwdm10f'));
  S.g.df = 75;
  const plan = [];
  for (let s = 20; s < 32; s++) plan.push({ slot: s, mode: s === 25 || s === 27 ? 'dwdm10f' : 'zrp400', off: 0, svc: s === 26 });
  const r = M.simulate(withPlan(S, plan), undefined, { single: true });
  const by = s => r.channels.find(c => c.slot === s);
  assert.equal(by(26).svc, true);
  assert.equal(by(26).short, '10G+FEC');
  assert.equal(by(30).short, '400G ZR+');
  assert.ok(by(25).xpmPen > 0 && by(30).xpmPen === 0, 'only direct-detection channels carry XPM');
  assert.ok(by(26).xpmPen > by(31).xpmPen);
  // isolating the 10G channels away from the coherent ones reduces the penalty
  const gap = []; for (let s = 20; s < 24; s++) gap.push({ slot: s, mode: 'dwdm10f', off: 0, svc: s === 22 });
  for (let s = 40; s < 48; s++) gap.push({ slot: s, mode: 'zrp400', off: 0, svc: false });
  const rg = M.simulate(withPlan(build('dci'), gap), undefined, { single: true });
  assert.equal(rg.channels.find(c => c.svc).xpmPen, 0); // all 10G neighbours in reach are the same type, but there are 3 vs 11
});

test('plan sanitize: drops duplicates and out-of-range slots, keeps exactly one service channel', () => {
  const dirty = [{ slot: 5, mode: 'zr400', svc: true }, { slot: 5, mode: 'm800' }, { slot: 999, mode: 'zr400' }, { slot: 'x', mode: 'zr400' }, { slot: 7, mode: 'nope', off: 99, svc: true }, null];
  const p = M.sanitizePlan(dirty, 75);
  assert.equal(p.length, 2);
  assert.equal(p.filter(c => c.svc).length, 1);
  assert.equal(p[1].mode, 'zrp400'); assert.equal(p[1].off, 10);
  assert.equal(M.sanitizePlan([], 75), null);
  assert.equal(M.sanitizePlan('x', 75), null);
  const S = build('dci'); S.g.plan = dirty; assert.equal(M.sanitize(S).g.plan.length, 2);
  // remapping keeps channel frequencies when the grid changes
  const r = M.remapPlan([{ slot: 10, mode: 'zr400', off: 0, svc: true }, { slot: 11, mode: 'zr400', off: 0, svc: false }], 75, 50);
  assert.ok(r.length >= 1 && r.every(c => c.slot >= 0));
});

test('Raman gain spectrum: channels across the band get different gain, and more pumps flatten it', () => {
  const spread = pumps => {
    const S = build('dark'); const f = S.links.find(l => l.kind === 'fiber'); f.p.len = 60; f.p.extra = 1; f.p.raman = 700; f.p.ramanPumps = pumps; f.p.nch = 6; // no mux on this bench: say how many channels are lit
    S.g.df = 75; S.g.plan = [0, 12, 24, 36, 48, 63].map(s => ({ slot: s, mode: 'zr400', off: 0, svc: s === 24 }));
    const r = M.simulate(S, undefined, { single: true }), rx = r.channels.map(c => c.prx);
    return { spread: Math.max(...rx) - Math.min(...rx), svc: r.channels.find(c => c.svc).prx, r };
  };
  const one = spread(1), three = spread(3);
  assert.ok(one.spread > 1, `1 pump spread ${one.spread}`);
  assert.ok(three.spread < one.spread * 0.6, `3 pumps ${three.spread} vs ${one.spread}`);
  // the service channel is the reference, so adding the plan does not move the headline
  const S0 = build('dark'); const f0 = S0.links.find(l => l.kind === 'fiber'); f0.p.len = 60; f0.p.extra = 1; f0.p.raman = 700; f0.p.nch = 6;
  assert.ok(Math.abs(M.simulate(S0, undefined, { single: true }).prx - one.svc) < 1e-6);
});

test('double Rayleigh scattering grows with the square of the Raman gain and eventually dominates', () => {
  const run = mw => { const S = build('dci'); const f = S.links.find(l => l.kind === 'fiber'); f.p.len = 100; f.p.raman = mw; return M.simulate(S, undefined, { single: true }); };
  const low = run(300), mid = run(900), hi = run(1500);
  assert.equal(run(0).budget.mpi, 0);
  assert.ok(mid.budget.mpi > low.budget.mpi * 4, 'about 2 dB of MPI per dB of gain');
  assert.ok(hi.budget.mpi > mid.budget.mpi * 3);
  assert.ok(hi.gosnr < mid.gosnr, 'pushing the pump too far costs GSNR');
});

test('mixed-line preset: 10G channels get their own results and the overload fix works through the power offset', () => {
  const S = build('mix'), r = M.simulate(S);
  assert.equal(r.status, 'up');
  const tens = r.channels.filter(c => c.rate === 10), coh = r.channels.filter(c => c.rate === 400);
  assert.equal(tens.length, 3); assert.ok(coh.length >= 10);
  assert.ok(tens.every(c => c.prx < -7 && c.prx > -23 && c.xpmPen > 0));
  // the -3 dB offsets lower the 10G channels' power at every receiver; without them they sit 3 dB higher
  const flat = clone(S); flat.g.plan.forEach(c => (c.off = 0));
  const rf = M.simulate(flat);
  assert.ok(Math.abs(rf.channels.find(c => c.rate === 10).prx - (tens[0].prx + 3)) < 0.01);
  assert.ok(Math.abs(rf.channels.find(c => c.rate === 400).prx - coh[0].prx) < 0.01, 'coherent channels do not move');
  // both directions work in plan mode too
  assert.ok(r.rev && r.rev.channels && r.rev.channels.length === r.channels.length);
});

// ---- per-channel add/drop ----
test('add/drop preset: channels are lit only between their add and drop ROADMs', () => {
  const S = build('adddrop'), r = M.simulate(S);
  assert.equal(r.status, 'up');
  const rb = S.nodes.find(n => n.name === 'ROADM-B').id;
  assert.equal(S.g.plan.filter(c => c.to === rb).length, 4); assert.equal(S.g.plan.filter(c => c.from === rb).length, 4);
  const spans = r.hops.filter(h => h.kind === 'span');
  assert.deepEqual(spans.map(h => h.nch), [12, 12], '16 channels in the plan, 12 on each span');
  assert.equal(r.hops.find(h => h.name === 'ROADM-A add').nch, 12);
  const dropped = r.channels.filter(c => c.to === rb), added = r.channels.filter(c => c.from === rb), through = r.channels.filter(c => !c.partial);
  assert.equal(dropped.length, 4); assert.equal(added.length, 4); assert.equal(through.length, 8);
  assert.ok(dropped.every(c => c.toName === 'ROADM-B' && c.partial));
  assert.ok(r.channels.every(c => c.status === 'up'));
  // fewer spans and fewer WSS passes mean better GSNR than the end-to-end channels
  const gMean = a => a.reduce((x, c) => x + c.gosnr, 0) / a.length;
  assert.ok(gMean(dropped) > gMean(through) + 0.5 && gMean(added) > gMean(through) + 0.5);
  // the service channel is end to end, so its row still equals the headline
  const svc = r.channels.find(c => c.svc);
  assert.ok(Math.abs(svc.qMargin - r.qMargin) < 1e-6 && Math.abs(svc.prx - r.prx) < 1e-6);
  // a spectrum measured after the first span shows the 12 channels that are lit there, not all 16
  assert.equal(spans[0].lit.filter(Boolean).length, 12);
  assert.notDeepEqual(spans[0].lit, spans[1].lit);
});

test('add/drop: a channel that leaves early does not load the rest of the line', () => {
  const S = build('adddrop'), full = clone(S);
  full.g.plan.forEach(c => { c.from = ''; c.to = ''; });
  const a = M.simulate(S, 3, { single: true }), b = M.simulate(full, 3, { single: true });
  assert.ok(a.budget.nli < b.budget.nli, 'fewer channels per span, less nonlinear noise');
  assert.ok(a.qMargin > b.qMargin);
  // end-to-end plan: the same numbers as before add/drop existed (all channels everywhere)
  assert.deepEqual(b.hops.filter(h => h.kind === 'span').map(h => h.nch), [16, 16]);
  assert.ok(b.channels.every(c => !c.partial));
});

test('add/drop works in the return direction', () => {
  const r = M.simulate(build('adddrop'));
  assert.ok(r.rev && r.rev.channels.length === r.channels.length);
  assert.equal(r.rev.channels.filter(c => c.partial).length, 8);
  assert.deepEqual(r.rev.hops.filter(h => h.kind === 'span').map(h => h.nch), [12, 12]);
  const fwd = r.channels.find(c => c.to && !c.svc), back = r.rev.channels.find(c => c.slot === fwd.slot);
  assert.ok(Math.abs(fwd.gosnr - back.gosnr) < 1.5, 'a symmetric line gives similar GSNR both ways');
});

test('add/drop sanitize: unknown nodes, the service channel and from=to are cleaned up', () => {
  const S = build('adddrop'), rb = S.nodes.find(n => n.name === 'ROADM-B').id, mux = 'nope';
  const d = clone(S);
  d.g.plan[0].from = mux; d.g.plan[1].to = rb; d.g.plan[1].from = rb; d.g.plan.find(c => c.svc).to = rb; d.g.plan[2].from = { evil: 1 };
  const c = M.sanitize(d), p = c.g.plan;
  assert.equal(p[0].from, '');
  assert.equal(p[1].to, '', 'from === to is cleared');
  assert.equal(p.find(x => x.svc).to, '', 'the service runs end to end');
  assert.equal(p[2].from, '');
  // legacy plans without the fields load as end-to-end
  const old = clone(S); old.g.plan.forEach(x => { delete x.from; delete x.to; });
  assert.ok(M.sanitize(old).g.plan.every(x => x.from === '' && x.to === ''));
});

test('add/drop: a channel whose ROADM is not on the routed path falls back to end to end', () => {
  const S = build('adddrop'), rb = S.nodes.find(n => n.name === 'ROADM-B').id;
  const cut = clone(S); cut.nodes = cut.nodes.filter(n => n.id !== rb); cut.links = cut.links.filter(l => l.a !== rb && l.b !== rb);
  const c = M.sanitize(cut);
  assert.ok(c.g.plan.every(x => x.from === '' && x.to === ''), 'sanitize clears ids that no longer exist');
});

// ---- mesh routing: every channel has its own route ----
test('mesh preset: channels run on their own routes and load only those fibers', () => {
  const S = build('mesh'), r = M.simulate(S);
  assert.equal(r.status, 'up');
  const byRoute = k => r.channels.filter(c => c.route.join('>') === k);
  assert.equal(byRoute('ROADM-A>ROADM-B').length, 4); assert.equal(byRoute('ROADM-B>ROADM-C').length, 4);
  assert.equal(byRoute('ROADM-A>ROADM-B>ROADM-C').length, 3, 'forced the long way round');
  assert.equal(byRoute('TRX-A>ROADM-A>ROADM-C>TRX-C').length, 5);
  assert.ok(r.channels.every(c => c.status === 'up' && c.prx != null));
  const load = Object.fromEntries(r.linkLoad.map(l => [l.name, l.n]));
  assert.deepEqual(load, { 'ROADM-A–ROADM-B': 7, 'TRX-A–ROADM-A': 5, 'ROADM-A–ROADM-C': 5, 'TRX-C–ROADM-C': 5, 'ROADM-B–ROADM-C': 7 });
  assert.deepEqual(r.hops.filter(h => h.kind === 'span').map(h => h.nch), [5]);
  const svc = r.channels.find(c => c.svc);
  assert.ok(Math.abs(svc.qMargin - r.qMargin) < 1e-6 && Math.abs(svc.prx - r.prx) < 1e-6, 'the service row still equals the headline');
  // the 110 km B to C channels have the weakest GSNR; each channel is judged on its own route
  const g = k => byRoute(k)[0].gosnr;
  assert.ok(g('ROADM-B>ROADM-C') < g('ROADM-A>ROADM-B') && g('ROADM-A>ROADM-B') < g('TRX-A>ROADM-A>ROADM-C>TRX-C'));
  assert.ok(g('ROADM-A>ROADM-B>ROADM-C') < g('ROADM-B>ROADM-C'), 'two spans and a ROADM in between: the worst GSNR');
  assert.ok(byRoute('ROADM-B>ROADM-C').every(c => c.partial));
});

test('mesh: channels elsewhere in the network lighten the service fiber, and it matters', () => {
  const S = build('mesh'), all = clone(S);
  all.g.plan.forEach((c, k) => { c.from = ''; c.to = ''; c.via = ''; c.slot = 20 + k; }); // every channel end to end on the service route, one slot each
  const a = M.simulate(S, 3, { single: true }), b = M.simulate(all, 3, { single: true });
  assert.deepEqual(b.hops.filter(h => h.kind === 'span').map(h => h.nch), [16]);
  assert.ok(a.budget.nli < b.budget.nli && a.qMargin > b.qMargin);
});

test('mesh: a cut fiber reroutes the service and the other channels, and the loads pile up on the detour', () => {
  const S = build('mesh'); S.links.find(l => l.kind === 'fiber' && l.p.len === 70).p.cut = true;
  const r = M.simulate(S);
  assert.deepEqual(r.path.nodes.map(id => S.nodes.find(n => n.id === id).name), ['TRX-A', 'ROADM-A', 'ROADM-B', 'ROADM-C', 'TRX-C']);
  const load = Object.fromEntries(r.linkLoad.map(l => [l.name, l.n]));
  assert.equal(load['ROADM-A–ROADM-B'], 12); assert.equal(load['ROADM-B–ROADM-C'], 12);
  assert.ok(!('ROADM-A–ROADM-C' in load));
  assert.equal(r.hops.filter(h => h.kind === 'span').length, 2);
  assert.ok(r.channels.every(c => c.prx != null));
});

test('mesh: a channel with no route says so and does not disturb the others', () => {
  const S = build('mesh'), ref = M.simulate(S);
  const island = { id: 'island', type: 'roadm', name: 'ROADM-X', x: 10, y: 10, p: { wss: 6, ad: 4, amps: true, nf: 5.5 } };
  S.nodes.push(island);
  S.g.plan.find(c => !c.svc && !c.from).from = 'island';
  const r = M.simulate(M.sanitize(S));
  const lost = r.channels.filter(c => c.status === 'nopath');
  assert.equal(lost.length, 1); assert.equal(lost[0].prx, null);
  assert.ok(r.alarms.some(a => /failing/.test(a.text)));
  assert.ok(Math.abs(r.qMargin - ref.qMargin) < 0.3, 'the service sees one channel less, nothing else changes');
});

test('mesh: the return direction routes every channel the other way round', () => {
  const r = M.simulate(build('mesh'));
  assert.ok(r.rev && r.rev.channels.length === r.channels.length);
  assert.ok(r.rev.channels.every(c => c.status === 'up' && c.prx != null));
  const fwd = r.channels.find(c => c.route.join('>') === 'ROADM-B>ROADM-C'), back = r.rev.channels[fwd.idx];
  assert.deepEqual(back.route.slice().sort(), fwd.route.slice().sort());
  assert.ok(Math.abs(fwd.gosnr - back.gosnr) < 1.5);
});

test('mesh: each channel reports the links and nodes of its route for the canvas highlight', () => {
  const S = build('mesh'), r = M.simulate(S);
  for (const c of r.channels) {
    assert.equal(c.routeNodes.length, c.routeLinks.length + 1);
    assert.equal(c.routeNodes.length, c.route.length);
    assert.ok(c.routeLinks.every(id => S.links.some(l => l.id === id)));
  }
  const ab = r.channels.find(c => c.route.join('>') === 'ROADM-A>ROADM-B'), svc = r.channels.find(c => c.svc);
  assert.equal(ab.routeLinks.length, 1); assert.deepEqual(svc.routeLinks, r.path.links);
  assert.deepEqual(r.rev.channels.find(c => c.svc).routeNodes, r.rev.path.nodes, 'the return view highlights the return route');
});

test('explicit routing: a waypoint forces a channel onto a longer route and the numbers follow', () => {
  const S = build('mesh'), ra = S.nodes.find(n => n.name === 'ROADM-A').id, rb = S.nodes.find(n => n.name === 'ROADM-B').id, rc = S.nodes.find(n => n.name === 'ROADM-C').id;
  const mk = via => { const T = clone(S); const k = T.g.plan.findIndex(x => x.via); T.g.plan[k].via = via; return { T, k }; };
  const direct = mk(''), around = mk(rb);
  const d = M.simulate(direct.T).channels[direct.k], a = M.simulate(around.T).channels[around.k];
  assert.deepEqual(d.route, ['ROADM-A', 'ROADM-C']); assert.deepEqual(a.route, ['ROADM-A', 'ROADM-B', 'ROADM-C']);
  assert.equal(a.via, rb); assert.equal(a.routeLinks.length, 2);
  assert.ok(a.gosnr < d.gosnr - 1.5, 'two longer spans cost GSNR');
  // loads follow the explicit route
  const load = Object.fromEntries(M.simulate(around.T).linkLoad.map(l => [l.name, l.n]));
  assert.equal(load['ROADM-A–ROADM-B'], 7);
  const loop = clone(S); const k2 = loop.g.plan.findIndex(x => x.via), c2 = loop.g.plan[k2]; c2.via = ra; // a waypoint equal to the add node changes nothing
  assert.deepEqual(M.simulate(loop).channels[k2].route, ['ROADM-A', 'ROADM-C']);
  const back = clone(S); const k3 = back.g.plan.findIndex(x => x.from === rb), c3 = back.g.plan[k3]; c3.to = ra; c3.via = rc; // B to A the long way: B-C then C-A
  const rr = M.simulate(back).channels[k3];
  assert.deepEqual(rr.route, ['ROADM-B', 'ROADM-C', 'ROADM-A']);
});

test('explicit routing: sanitize keeps waypoints only on ROADMs and never on the service channel', () => {
  const S = build('mesh'), rb = S.nodes.find(n => n.name === 'ROADM-B').id, trx = S.nodes.find(n => n.name === 'TRX-A').id;
  const d = clone(S); d.g.plan[0].via = trx; d.g.plan[1].via = 'nope'; d.g.plan[2].via = rb; d.g.plan.find(c => c.svc).via = rb;
  const p = M.sanitize(d).g.plan;
  assert.equal(p[0].via, ''); assert.equal(p[1].via, ''); assert.equal(p[2].via, rb); assert.equal(p.find(c => c.svc).via, '');
});

test('explicit routing: a waypoint no route can reach says why', () => {
  const S = build('mesh');
  S.nodes.push({ id: 'island', type: 'roadm', name: 'ROADM-X', x: 0, y: 0, p: { wss: 6, ad: 4, amps: true, nf: 5.5 } });
  const c = S.g.plan.find(x => !x.svc && !x.from); c.via = 'island';
  const r = M.simulate(M.sanitize(S)), e = r.channels.find(x => x.slot === c.slot);
  assert.equal(e.status, 'nopath'); assert.match(e.notes[0], /waypoint/);
});

// ---- wavelength assignment: slot reuse, blocking, first-fit ----
test('wavelength reuse: channels on routes that share no fiber can use the same slot', () => {
  const S = build('mesh'), r = M.simulate(S);
  const slots = S.g.plan.map(c => c.slot);
  assert.ok(new Set(slots).size < slots.length, 'the A-B and B-C channels reuse slots');
  assert.ok(r.channels.every(c => c.status === 'up'), 'no blocking');
  const s24 = r.channels.filter(c => c.slot === 24);
  assert.equal(s24.length, 2); assert.notDeepEqual(s24[0].route, s24[1].route);
  // sanitize keeps same-slot channels on different routes and drops exact duplicates
  const d = clone(S); d.g.plan.push({ ...d.g.plan[0] });
  assert.equal(M.sanitize(d).g.plan.length, S.g.plan.length);
  assert.equal(M.sanitize(S).g.plan.length, S.g.plan.length);
});

test('wavelength blocking: two channels in one slot on a shared fiber cannot both be lit', () => {
  const S = build('mesh'), rc = S.nodes.find(n => n.name === 'ROADM-C').id;
  // a B to C channel moved into slot 29, which a via-B channel already uses on the same B-C fiber; the earlier one in the plan wins
  const bc = S.g.plan.findIndex(c => c.slot === 24 && c.to === rc && !c.via);
  S.g.plan[bc].slot = 29;
  const r = M.simulate(S);
  const blocked = r.channels.filter(c => c.status === 'blocked');
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].slot, 29); assert.ok(S.g.plan[blocked[0].idx].via, 'the later channel (the long way round) is the one blocked');
  assert.equal(blocked[0].prx, null); assert.match(blocked[0].notes[0], /already lit on .* by another channel/);
  assert.equal(r.channels[bc].status, 'up');
  assert.ok(r.alarms.some(a => /failing/.test(a.text)));
  const load = Object.fromEntries(r.linkLoad.map(l => [l.name, l.n]));
  assert.equal(load['ROADM-B–ROADM-C'], 6, 'a blocked channel is not on the fiber');
});

test('wavelength blocking: the service has priority over every other channel', () => {
  const S = build('mesh'), svcSlot = S.g.plan.find(c => c.svc).slot;
  const other = S.g.plan.find(c => !c.svc && !c.from && !c.via);
  other.slot = svcSlot; // an end-to-end channel on the service's own slot and fiber
  const r = M.simulate(S);
  assert.equal(r.channels.filter(c => c.status === 'blocked').length, 1);
  assert.equal(r.channels.find(c => c.svc).status, 'up');
  assert.ok(r.channels[S.g.plan.indexOf(other)].status === 'blocked');
  assert.ok(r.status === 'degraded' || r.status === 'up');
  assert.equal(r.hops.filter(h => h.kind === 'span')[0].nch, 4, 'the blocked channel does not load the service fiber');
});

test('first-fit assignment: reuses slots across disjoint routes and clears every conflict', () => {
  const S = build('mesh');
  S.g.plan.forEach((c, k) => { c.slot = 10 + k; }); // spread over 16 different slots
  const svcSlot = S.g.plan.find(c => c.svc).slot;
  const plan = M.assignSlots(S);
  assert.equal(plan.length, 16);
  assert.equal(plan.find(c => c.svc).slot, svcSlot, 'the service keeps its slot');
  const used = new Set(plan.map(c => c.slot));
  assert.ok(used.size <= 12, `disjoint routes share slots: ${used.size} slots for 16 channels`);
  assert.ok(Math.min(...used) === 0, 'first fit packs from the bottom');
  S.g.plan = plan;
  const r = M.simulate(S);
  assert.ok(r.channels.every(c => c.status === 'up'), 'no channel blocked');
  // idempotent
  assert.deepEqual(M.assignSlots(S).map(c => c.slot), plan.map(c => c.slot));
});

test('first-fit assignment: channels that all cross one fiber need a slot each', () => {
  const S = build('mesh');
  S.g.plan.forEach(c => { c.from = ''; c.to = ''; c.via = ''; });
  const plan = M.assignSlots(S);
  assert.equal(new Set(plan.map(c => c.slot)).size, plan.length);
  assert.equal(M.assignSlots({ ...build('dci') }), null, 'no plan, nothing to assign');
});

// ---- launch re-optimisation as the load changes ----
test('optLaunch: the GN optimum falls as channels are added and sits near 0 to +2 dBm for 80 km of SMF', () => {
  const f = PHY.FIBERS.smf, o = n => PHY.optLaunch(f, 80, 60e9, n, 75e9, 5.5, 17);
  assert.ok(o(4) > o(16) && o(16) > o(48) && o(48) > o(96));
  assert.ok(o(48) > -0.5 && o(48) < 2.5, `got ${o(48)}`);
  // a longer, lossier span wants more power to stay above its noise
  assert.ok(PHY.optLaunch(f, 120, 60e9, 48, 75e9, 5.5, 26) > o(48));
});

test('re-optimisation: line amplifiers follow the load and match the best fixed launch power', () => {
  const S = build('lh'); S.g.nch = 8; S.g.launch = -4; // a poor fixed setting for a lightly loaded line
  const fixed = M.simulate(S, undefined, { single: true });
  S.g.reopt = true;
  const opt = M.simulate(S, undefined, { single: true });
  assert.ok(opt.gosnr > fixed.gosnr + 1, `re-optimised ${opt.gosnr.toFixed(1)} vs fixed ${fixed.gosnr.toFixed(1)}`);
  const note = opt.hops.find(h => h.kind === 'amp' && /re-optimised for 8 channels/.test(h.note || ''));
  assert.ok(note, 'the hop says what it set');
  // the best the manual launch sweep can do is no better than the re-optimised line (it picks one value for every span)
  S.g.reopt = false;
  let best = -Infinity; for (let p = -8; p <= 8; p += 0.5) best = Math.max(best, M.simulate(S, p, { single: true }).gosnr);
  assert.ok(opt.gosnr > best - 0.5, `re-optimised ${opt.gosnr.toFixed(2)} vs best sweep ${best.toFixed(2)}`);
  // load it up and the targets come down
  S.g.reopt = true; S.g.nch = 90;
  const full = M.simulate(S, undefined, { single: true });
  const tgt = r => +r.hops.find(h => h.kind === 'amp' && /re-optimised/.test(h.note || '')).note.match(/(-?\d+\.\d) dBm/)[1];
  assert.ok(tgt(full) < tgt(opt));
});

test('re-optimisation: an amplifier with an explicit output target keeps it', () => {
  const S = build('lh'); S.g.reopt = true;
  const amp = S.nodes.find(n => n.type === 'edfa'); amp.p.target = -2;
  const r = M.simulate(S, undefined, { single: true });
  assert.ok(!r.hops.find(h => h.name === amp.name).note || !/re-optimised/.test(r.hops.find(h => h.name === amp.name).note));
});

test('re-optimisation follows the plan load per span', () => {
  const S = build('adddrop'); S.g.reopt = true;
  const r = M.simulate(S, undefined, { single: true });
  assert.ok(r.hops.some(h => h.kind === 'amp' && /re-optimised for 12 channels/.test(h.note || '')));
});

// ---- wavelength converters (regeneration) ----
const meshIds = S => ({ ra: S.nodes.find(n => n.name === 'ROADM-A').id, rb: S.nodes.find(n => n.name === 'ROADM-B').id, rc: S.nodes.find(n => n.name === 'ROADM-C').id });
const addCh = (S, o) => { S.g.plan.push({ slot: 40, mode: 'zrp400', off: 0, svc: false, from: '', to: '', via: '', conv: '', slot2: o.slot ?? 40, prot: '', ...o }); return S.g.plan.length - 1; };

test('converter: a channel changes slot and is regenerated at the converter ROADM', () => {
  const S = build('mesh'), { ra, rb, rc } = meshIds(S);
  const k = addCh(S, { slot: 40, slot2: 41, from: ra, to: rc, conv: rb });
  const r = M.simulate(S), c = r.channels[k];
  assert.equal(r.channels.length, S.g.plan.length, 'results stay one per plan entry');
  assert.ok(c.converted && c.segments.length === 2);
  assert.equal(c.slot, 40); assert.equal(c.slot2, 41);
  assert.deepEqual(c.route, ['ROADM-A', 'ROADM-B', 'ROADM-C']);
  assert.equal(c.status, 'up');
  assert.equal(c.segments[0].slot, 40); assert.equal(c.segments[1].slot, 41);
  const load = Object.fromEntries(r.linkLoad.map(l => [l.name, l.n]));
  assert.equal(load['ROADM-A–ROADM-B'], 8); assert.equal(load['ROADM-B–ROADM-C'], 8);
  // regeneration: each segment starts clean, so it beats the same route lit straight through
  const T = build('mesh'), ti = meshIds(T); const k2 = addCh(T, { slot: 40, from: ti.ra, to: ti.rc, via: ti.rb });
  const through = M.simulate(T).channels[k2];
  assert.deepEqual(through.route, c.route);
  assert.ok(Math.min(...c.segments.map(s => s.gosnr)) > through.gosnr + 1, 'worst segment better than the unregenerated channel');
  assert.ok(c.gosnr > through.gosnr + 1);
});

test('converter: it gets a channel past a slot clash that would block it', () => {
  const S = build('mesh'), { ra, rb, rc } = meshIds(S);
  // slot 24 is lit on both A-B and B-C (the A to B and B to C channels reuse it): an A to C channel through B cannot also use 24
  const k = addCh(S, { slot: 24, from: ra, to: rc, via: rb });
  assert.equal(M.simulate(S).channels[k].status, 'blocked');
  S.g.plan[k].via = ''; S.g.plan[k].conv = rb; S.g.plan[k].slot = 40; S.g.plan[k].slot2 = 41;
  assert.equal(M.simulate(S).channels[k].status, 'up');
  // the second slot still has to be free on the second leg
  S.g.plan[k].slot2 = 24;
  const bad = M.simulate(S).channels[k];
  assert.equal(bad.status, 'blocked'); assert.match(bad.notes[0], /after the converter/);
});

test('converter: sanitize keeps it on ROADMs only and never on the service', () => {
  const S = build('mesh'), { ra, rb, rc } = meshIds(S);
  const k = addCh(S, { slot: 40, slot2: 41, from: ra, to: rc, conv: rb, via: rb, prot: '1+1' });
  S.g.plan.find(c => c.svc).conv = rb;
  const p = M.sanitize(S).g.plan, c = p.find(x => x.conv);
  assert.equal(c.via, ''); assert.equal(c.prot, '1+1', 'a converted channel can be protected'); assert.equal(c.slot2, 41);
  assert.equal(p.find(x => x.svc).conv, '');
  const T = clone(S); T.g.plan[k].conv = S.nodes.find(n => n.name === 'TRX-A').id;
  assert.equal(M.sanitize(T).g.plan.find(x => x.slot === 40).conv, '', 'a transponder cannot convert');
  const U = clone(S); U.g.plan[k].conv = ra;
  assert.equal(M.sanitize(U).g.plan.find(x => x.slot === 40).conv, '', 'the converter cannot be the add node');
  const V = clone(S); V.g.plan[k].slot2 = 999;
  assert.equal(M.sanitize(V).g.plan.find(x => x.slot === 40).slot2, 40, 'out-of-range second slot falls back to the first');
});

test('converter: first-fit assigns each segment its own slot', () => {
  const S = build('mesh'), { ra, rb, rc } = meshIds(S);
  const k = addCh(S, { slot: 50, slot2: 51, from: ra, to: rc, conv: rb });
  const plan = M.assignSlots(S), c = plan.find(x => x.conv);
  assert.ok(Number.isInteger(c.slot) && Number.isInteger(c.slot2));
  S.g.plan = plan;
  assert.ok(M.simulate(S).channels.every(x => x.status === 'up'));
  assert.ok(k >= 0);
});

// ---- 1+1 protection ----
test('protection: a protected service plans a fiber-disjoint second route and lights it', () => {
  const S = build('mesh'); S.g.plan.find(c => c.svc).prot = '1+1';
  const r = M.simulate(S), sv = r.channels.find(c => c.svc);
  assert.equal(r.status, 'up');
  assert.ok(sv.protection && sv.protection.active === 'work');
  assert.deepEqual(sv.protection.work.route, ['TRX-A', 'ROADM-A', 'ROADM-C', 'TRX-C']);
  assert.ok(sv.protection.protect.route.includes('ROADM-B'), 'the protection route goes round through B');
  assert.equal(sv.protection.protect.status, 'up');
  // the standby copy is lit: it loads the fibers it rides
  const base = Object.fromEntries(M.simulate(build('mesh')).linkLoad.map(l => [l.name, l.n]));
  const load = Object.fromEntries(r.linkLoad.map(l => [l.name, l.n]));
  assert.equal(load['ROADM-A–ROADM-B'], base['ROADM-A–ROADM-B'] + 1); assert.equal(load['ROADM-B–ROADM-C'], base['ROADM-B–ROADM-C'] + 1);
  assert.equal(load['ROADM-A–ROADM-C'], base['ROADM-A–ROADM-C']);
  assert.ok(Math.abs(sv.qMargin - r.qMargin) < 1e-6, 'the service row still equals the headline');
  assert.ok(sv.protection.protect.gosnr < sv.protection.work.gosnr - 2, 'the long way round has less GSNR');
});

test('protection: a cut on the working route switches the service to the protection route', () => {
  const S = build('mesh'); S.g.plan.find(c => c.svc).prot = '1+1';
  S.links.find(l => l.kind === 'fiber' && l.p.len === 70).p.cut = true;
  const r = M.simulate(S), sv = r.channels.find(c => c.svc);
  assert.deepEqual(r.path.nodes.map(id => S.nodes.find(n => n.id === id).name), ['TRX-A', 'ROADM-A', 'ROADM-B', 'ROADM-C', 'TRX-C']);
  assert.equal(sv.protection.active, 'protect');
  assert.ok(r.alarms.some(a => /switched to the protection route/.test(a.text) && /cut/.test(a.text)));
  assert.equal(r.status, 'degraded', 'running without protection is a warning');
  assert.ok(r.qMargin != null && Math.abs(sv.qMargin - r.qMargin) < 1e-6);
  assert.ok(r.rev && r.rev.path.nodes.length === 5, 'the return direction uses the same detour');
  // both routes cut: down
  S.links.find(l => l.kind === 'fiber' && l.p.len === 100).p.cut = true;
  assert.equal(M.simulate(S).status, 'los');
});

test('protection: a working route that is down (not cut) hands over to the protection route', () => {
  const S = build('mesh'); S.g.plan.find(c => c.svc).prot = '1+1';
  S.links.find(l => l.kind === 'fiber' && l.p.len === 70).p.extra = 40; // 40 dB of extra loss on the direct fiber
  const r = M.simulate(S);
  assert.ok(r.switched, 'signal-fail switch');
  assert.ok(r.path.nodes.some(id => S.nodes.find(n => n.id === id).name === 'ROADM-B'));
  assert.ok(r.alarms.some(a => /working route is down/.test(a.text)));
  assert.notEqual(r.status, 'down');
  // without protection the same loss simply takes the service down
  const T = build('mesh'); T.links.find(l => l.kind === 'fiber' && l.p.len === 70).p.extra = 40;
  assert.ok(['down', 'los'].includes(M.simulate(T).status));
});

test('protection: a protected channel that is not the service switches on a cut and reports its standby', () => {
  const S = build('mesh'), { ra, rb } = meshIds(S);
  const k = addCh(S, { slot: 50, from: ra, to: rb, prot: '1+1' });
  let r = M.simulate(S), c = r.channels[k];
  assert.equal(c.status, 'up'); assert.equal(c.protection.active, 'work');
  assert.deepEqual(c.protection.work.route, ['ROADM-A', 'ROADM-B']);
  assert.deepEqual(c.protection.protect.route, ['ROADM-A', 'ROADM-C', 'ROADM-B'], 'the disjoint route is the long way round');
  S.links.find(l => l.kind === 'fiber' && l.p.len === 100).p.cut = true; // the A-B fiber
  r = M.simulate(S); c = r.channels[k];
  assert.equal(c.protection.active, 'protect');
  assert.ok(c.prx != null && (c.status === 'degraded' || c.status === 'up'));
  assert.match(c.notes[0], /protection route/);
});

test('protection: with no fiber-disjoint route the channel is flagged unprotected', () => {
  const S = build('adddrop'), rb = S.nodes.find(n => n.name === 'ROADM-B').id;
  const k = S.g.plan.findIndex(c => !c.svc && c.to === rb); S.g.plan[k].prot = '1+1';
  const r = M.simulate(S), c = r.channels[k];
  assert.equal(c.protection.protect.status, 'nopath');
  assert.equal(c.status, 'degraded'); assert.match(c.notes.join(' '), /no protection/);
  assert.ok(r.alarms.some(a => /no usable protection route/.test(a.text)));
});

test('protection: sanitize accepts only 1+1', () => {
  const S = build('mesh'); S.g.plan[0].prot = '1+1'; S.g.plan[1].prot = 'banana'; S.g.plan[2].prot = 7;
  const p = M.sanitize(S).g.plan;
  assert.equal(p.filter(c => c.prot === '1+1').length, 1);
  assert.ok(p.every(c => c.prot === '' || c.prot === '1+1'));
});

test('protection: first-fit gives both copies one slot that is free on both routes', () => {
  const S = build('mesh'), { ra, rb } = meshIds(S);
  addCh(S, { slot: 50, from: ra, to: rb, prot: '1+1' });
  S.g.plan.forEach((c, k) => { c.slot = 10 + k; });
  S.g.plan.forEach(c => { c.slot2 = c.slot; });
  const plan = M.assignSlots(S); S.g.plan = plan;
  const r = M.simulate(S);
  assert.ok(r.channels.every(c => c.status === 'up'), r.channels.map(c => c.status).join());
  assert.ok(r.channels.find(c => c.protection && !c.svc).protection.protect.status === 'up');
});

test('protection of a converted channel: each side of the converter is protected on its own', () => {
  const S = build('mesh'), { ra, rb, rc } = meshIds(S);
  const k = addCh(S, { slot: 40, slot2: 41, from: ra, to: rc, conv: rb, prot: '1+1' });
  const base = Object.fromEntries(M.simulate(build('mesh')).linkLoad.map(l => [l.name, l.n]));
  let r = M.simulate(S), c = r.channels[k];
  assert.ok(c.converted && c.protection && c.protection.sections.length === 2);
  assert.equal(c.status, 'up'); assert.equal(c.protection.active, 'work');
  assert.deepEqual(c.route, ['ROADM-A', 'ROADM-B', 'ROADM-C']);
  assert.deepEqual(c.protection.protect.route, ['ROADM-A', 'ROADM-C', 'ROADM-B', 'ROADM-A', 'ROADM-C'], 'A-C-B then B-A-C: each half goes the other way round');
  assert.equal(c.protection.protect.status, 'up');
  const load = Object.fromEntries(r.linkLoad.map(l => [l.name, l.n]));
  assert.equal(load['ROADM-A–ROADM-B'], base['ROADM-A–ROADM-B'] + 2, 'working half 1 and protection half 2 both ride A-B');
  assert.equal(load['ROADM-A–ROADM-C'], base['ROADM-A–ROADM-C'] + 2);
  // cut the A-B fiber: the first half switches, the second half's protection also crosses the cut so it is left unprotected
  S.links.find(l => l.kind === 'fiber' && l.p.len === 100).p.cut = true;
  r = M.simulate(S); c = r.channels[k];
  assert.equal(c.protection.active, 'protect'); assert.equal(c.status, 'degraded');
  assert.ok(c.prx != null, 'still carrying traffic');
  assert.match(c.notes[0], /protection|converter/);
});

test('protection of a converted channel: first-fit gives each protected half one slot for both copies', () => {
  const S = build('mesh'), { ra, rb, rc } = meshIds(S);
  addCh(S, { slot: 50, slot2: 51, from: ra, to: rc, conv: rb, prot: '1+1' });
  S.g.plan = M.assignSlots(S);
  assert.ok(M.simulate(S).channels.every(x => x.status === 'up'));
});

// ---- shared (1:N) protection ----
// Two working fibers (A1-B1, A2-B2) whose protection routes both cross the one middle fiber M1-M2.
function sharedTopo(prot) {
  const n = (id, type, name, x, y, p) => ({ id, type, name, x, y, p: { ...M.TYPES[type].def(), ...p } }), f = (id, a, b, len) => ({ id, a, b, kind: 'fiber', p: { ...M.linkDefaults('fiber'), len } });
  const nodes = ['A1', 'B1', 'A2', 'B2', 'M1', 'M2'].map((nm, i) => n(nm, 'roadm', nm, 100 + i * 80, 100)).concat([n('TA', 'trx', 'TA', 0, 200, { mode: 'zrp400' }), n('TB', 'trx', 'TB', 600, 200, { mode: 'zrp400' })]);
  const links = [f('wx', 'A1', 'B1', 80), f('wy', 'A2', 'B2', 80), f('a1m', 'A1', 'M1', 60), f('a2m', 'A2', 'M1', 60), f('mm', 'M1', 'M2', 60), f('m1b', 'M2', 'B1', 60), f('m2b', 'M2', 'B2', 60),
    { id: 'pa', a: 'TA', b: 'A1', kind: 'patch', p: M.linkDefaults('patch') }, { id: 'pb', a: 'TB', b: 'B1', kind: 'patch', p: M.linkDefaults('patch') }];
  const ch = (slot, o) => ({ slot, mode: 'zrp400', off: 0, svc: false, from: '', to: '', via: '', conv: '', slot2: slot, prot: '', ...o });
  const plan = [ch(30, { svc: true }), ch(31, { from: 'A1', to: 'B1', prot }), ch(31, { from: 'A2', to: 'B2', prot })];
  return { nodes, links, g: { nch: 3, df: 75, launch: 0, plan }, svc: { a: 'TA', z: 'TB' } };
}

test('shared protection: the standby is dark, shares a slot, and is checked by simulating the failure', () => {
  const r = M.simulate(sharedTopo('shared')), load = Object.fromEntries(r.linkLoad.map(l => [l.name, l.n]));
  assert.equal(r.status, 'up');
  assert.ok(!('M1–M2' in load), 'a dark standby does not load the middle fiber');
  for (const i of [1, 2]) {
    const c = r.channels[i];
    assert.equal(c.status, 'up'); assert.equal(c.protection.active, 'work');
    assert.ok(c.protection.protect.predicted, 'the margin is predicted, not measured');
    assert.equal(c.protection.protect.status, 'up'); assert.ok(c.protection.protect.route.includes('M1') && c.protection.protect.route.includes('M2'));
  }
  assert.equal(r.segments.filter(s => s.status === 'standby').length, 2);
});

test('shared protection: two 1+1 protections would collide where two shared ones do not', () => {
  const dedicated = M.simulate(sharedTopo('1+1')), blocked = dedicated.channels.filter(c => c.protection && c.protection.protect.status === 'blocked');
  assert.equal(blocked.length, 1, 'both lit copies need slot 31 on M1-M2');
  assert.ok(dedicated.channels.some(c => c.status === 'degraded' && /no protection/.test(c.notes.join(' '))));
  const shared = M.simulate(sharedTopo('shared'));
  assert.ok(shared.channels.every(c => c.status === 'up'));
});

test('shared protection: a cut lights the standby; two failures at once contend for it', () => {
  const S = sharedTopo('shared'); S.links.find(l => l.id === 'wx').p.cut = true;
  let r = M.simulate(S);
  assert.equal(r.channels[1].protection.active, 'protect'); assert.equal(r.channels[1].status, 'degraded');
  assert.equal(r.channels[2].protection.active, 'work');
  assert.equal(r.linkLoad.find(l => l.name === 'M1–M2').n, 2, 'the activated protection and the restored service (its own fiber is cut) light the middle fiber');
  assert.ok(r.segments.filter(x => x.lg === 1).every(x => x.status !== 'standby'), 'the protection copy is lit now');
  S.links.find(l => l.id === 'wy').p.cut = true; // both working fibers fail
  r = M.simulate(S);
  const states = [r.channels[1], r.channels[2]].map(c => c.status).sort();
  assert.ok(states.includes('blocked') || states.includes('los'), 'one of them cannot get the shared slot: ' + states);
});

test('shared protection: a protected service predicts its margin and keeps the fibers free', () => {
  const S = build('mesh'); S.g.plan.find(c => c.svc).prot = 'shared';
  const base = Object.fromEntries(M.simulate(build('mesh')).linkLoad.map(l => [l.name, l.n]));
  const r = M.simulate(S), sv = r.channels.find(c => c.svc), load = Object.fromEntries(r.linkLoad.map(l => [l.name, l.n]));
  assert.equal(r.status, 'up'); assert.ok(sv.protection.protect.predicted && sv.protection.protect.status === 'up');
  assert.deepEqual(load, base, 'no extra load: the protection route is dark');
  S.links.find(l => l.kind === 'fiber' && l.p.len === 70).p.cut = true;
  const c = M.simulate(S);
  assert.equal(c.channels.find(x => x.svc).protection.active, 'protect');
  assert.ok(c.alarms.some(a => /switched to the protection route/.test(a.text)));
});

test('shared protection: first-fit lets protection copies share a slot but keeps lit channels clear of them', () => {
  const S = sharedTopo('shared'); S.g.plan[1].slot = 10; S.g.plan[2].slot = 20; S.g.plan.forEach(c => { c.slot2 = c.slot; });
  const plan = M.assignSlots(S);
  const own = pl => pl.filter(c => !c.svc).map(c => c.slot);
  assert.equal(own(plan)[0], own(plan)[1], 'disjoint working routes, overlapping backups: one slot is enough');
  S.g.plan = plan;
  assert.ok(M.simulate(S).channels.every(c => c.status === 'up'));
  // with 1+1 the two protection copies cannot share
  const D = sharedTopo('1+1'); D.g.plan[1].slot = 10; D.g.plan[2].slot = 20; D.g.plan.forEach(c => { c.slot2 = c.slot; });
  const dp = M.assignSlots(D); assert.notEqual(own(dp)[0], own(dp)[1]);
});

test('shared protection: sanitize accepts it', () => {
  const S = build('mesh'); S.g.plan[0].prot = 'shared'; S.g.plan[1].prot = 'bogus';
  const p = M.sanitize(S).g.plan;
  assert.equal(p[0].prot, 'shared'); assert.equal(p[1].prot, '');
});

// ---- resilience: switching time and expected downtime ----
test('resilience: an unprotected channel restores over another route and is down for the restoration time', () => {
  const S = build('mesh'); S.g.devRate = 0; const r = M.resilience(S), sv = r[S.g.plan.findIndex(c => c.svc)];
  assert.equal(sv.kind, 'restoration'); assert.equal(sv.km, 70);
  assert.ok(Math.abs(sv.failures - 3 * 70 / 1000) < 1e-9);
  assert.ok(Math.abs(sv.downSec - 0.21 * 60) < 1e-6, `${sv.downSec}`);
  assert.equal(sv.outageSec, 60);
  assert.ok(Math.abs(sv.availability - (1 - sv.downSec / (8760 * 3600))) < 1e-12);
  assert.equal(r.length, S.g.plan.length);
});

test('resilience: with no other route a cut lasts until it is repaired', () => {
  const S = build('adddrop'); S.g.devRate = 0; const sv = M.resilience(S)[S.g.plan.findIndex(c => c.svc)];
  assert.equal(sv.kind, 'unprotected'); assert.equal(sv.outageSec, 12 * 3600);
  assert.ok(Math.abs(sv.downSec - 3 * 160 / 1000 * 12 * 3600) < 1e-3);
});

test('resilience: 1+1 costs detect plus switch per failure and a small double-failure term; shared adds the turn-up time', () => {
  const S = build('mesh'); S.g.devRate = 0; const k = S.g.plan.findIndex(c => c.svc);
  S.g.plan[k].prot = '1+1';
  const d = M.resilience(S)[k], lw = 0.21, Uw = lw * 12 / 8760, Up = 3 * 210 / 1000 * 12 / 8760;
  assert.equal(d.kind, '1+1'); assert.equal(d.km, 70); assert.equal(d.protKm, 210);
  assert.ok(Math.abs(d.outageSec - 0.035) < 1e-9);
  assert.ok(Math.abs(d.downSec - (lw * 0.035 + Uw * Up * 8760 * 3600)) < 1e-6);
  S.g.plan[k].prot = 'shared';
  const sh = M.resilience(S)[k];
  assert.equal(sh.kind, 'shared'); assert.ok(Math.abs(sh.outageSec - 3.035) < 1e-9);
  assert.ok(Math.abs(sh.downSec - d.downSec - lw * 3) < 1e-6, 'shared costs the extra turn-up per failure');
  // slower switching hardware shows up directly
  S.g.plan[k].prot = '1+1'; S.g.switchMs = 330;
  assert.ok(Math.abs(M.resilience(S)[k].outageSec - 0.335) < 1e-9);
});

test('resilience: a converted channel is the sum of its halves, and protection halves each side', () => {
  const S = build('mesh'); S.g.devRate = 0; const { ra, rb, rc } = meshIds(S);
  const k = addCh(S, { slot: 40, slot2: 41, from: ra, to: rc, conv: rb });
  const plain = M.resilience(S)[k];
  assert.equal(plain.km, 210); assert.ok(Math.abs(plain.failures - 3 * 210 / 1000) < 1e-9);
  S.g.plan[k].prot = '1+1';
  const prot = M.resilience(S)[k];
  assert.equal(prot.kind, '1+1'); assert.equal(prot.km, 210); assert.ok(prot.protKm > prot.km);
  assert.ok(prot.downSec < plain.downSec);
});

test('resilience: no route is reported, availability defaults load, and sanitize bounds the assumptions', () => {
  const S = build('mesh'); S.nodes.push({ id: 'x', type: 'roadm', name: 'X', x: 0, y: 0, p: M.TYPES.roadm.def() });
  const k = S.g.plan.findIndex(c => !c.svc && !c.from); S.g.plan[k].from = 'x';
  assert.equal(M.resilience(S)[k].kind, 'no route');
  const T = build('mesh'); T.g.cutRate = 1e9; T.g.mttr = 'x'; T.g.switchMs = -5;
  const g = M.sanitize(T).g; assert.equal(g.cutRate, 50); assert.equal(g.mttr, 12); assert.equal(g.switchMs, 0);
  assert.deepEqual(Object.keys(M.RESIL).sort(), ['cutRate', 'detectMs', 'devRate', 'mttr', 'restoreSec', 'sharedSec', 'switchMs']);
  assert.equal(M.resilience(uniform('dci')).length, 1, 'no plan: just the service');
});

// ---- power transients when channels drop ----
test('transients: a cascade of gain-controlled amplifiers adds up the surge each one lets through', () => {
  const S = build('lh'), r = M.simulate(S, undefined, { single: true }), t = r.transient;
  const amps = r.hops.filter(h => h.kind === 'amp');
  assert.equal(t.rows.length, amps.length);
  const T = PHY.TRANSIENT, f = 1 - Math.exp(-T.agcUs / T.tauUs), n = t.rows[0].n, lost = Math.max(1, Math.round(0.5 * (n - 1)));
  assert.equal(n, 48); assert.equal(t.rows[0].lost, lost);
  assert.ok(Math.abs(t.rows[0].rawDb - 10 * Math.log10(n / (n - lost))) < 1e-9);
  assert.ok(Math.abs(t.rows[0].peakDb - t.rows[0].rawDb * f) < 1e-9);
  assert.ok(t.rows.every((x, i) => i === 0 || x.cumDb > t.rows[i - 1].cumDb), 'excursions accumulate along the cascade');
  assert.ok(Math.abs(t.surgeDb - t.rows.reduce((a, x) => a + x.peakDb, 0)) < 1e-9);
  assert.equal(r.status, 'up', 'transient notes are advisory');
});

test('transients: slow amplifier control lets the whole surge through and can overload the receiver', () => {
  const S = build('lh'), fast = M.simulate(S, undefined, { single: true }).transient;
  S.g.agcUs = 5000;
  const r = M.simulate(S, undefined, { single: true }), slow = r.transient;
  assert.ok(slow.surgeDb > fast.surgeDb * 5);
  assert.ok(Math.abs(slow.rows[0].peakDb - slow.rows[0].rawDb) < 0.01, 'a loop that never reacts passes the full surge');
  assert.ok(slow.overload && slow.prxSurge > r.mode.rxMax);
  assert.ok(r.alarms.some(a => a.sev === 'info' && /overload/.test(a.text)));
  assert.ok(slow.qMarginSurge < fast.qMarginSurge);
  assert.ok(slow.prxDip < fast.prxDip, 'and the dip when channels return is deeper');
});

test('transients: one slow amplifier shows up in its own row; losing fewer channels is gentler; a lone channel has nothing to surge', () => {
  const S = build('lh'), amp = S.nodes.find(n => n.type === 'edfa'); amp.p.agcUs = 2000;
  const t = M.simulate(S, undefined, { single: true }).transient, row = t.rows.find(x => x.name === amp.name);
  assert.equal(row.agcUs, 2000); assert.ok(row.peakDb > 2.5);
  const base = M.simulate(build('lh'), undefined, { single: true }).transient;
  const gentle = build('lh'); gentle.g.lossPct = 10;
  assert.ok(M.simulate(gentle, undefined, { single: true }).transient.surgeDb < base.surgeDb / 3);
  const one = build('lh'); one.g.nch = 1;
  assert.equal(M.simulate(one, undefined, { single: true }).transient, undefined);
  const T = build('lh'); T.g.lossPct = 500; T.g.agcUs = -3; const g = M.sanitize(T).g;
  assert.equal(g.lossPct, 95); assert.equal(g.agcUs, 0);
});

// ---- failures other than fiber cuts ----
function diamond(prot) { // R1 - R2 - R4 (120 km) and R1 - R3 - R4 (160 km), a transponder at each end
  const n = (id, type, p) => ({ id, type, name: id, x: 0, y: 0, p: { ...M.TYPES[type].def(), ...p } }), f = (id, a, b, len) => ({ id, a, b, kind: 'fiber', p: { ...M.linkDefaults('fiber'), len } });
  return { nodes: [n('R1', 'roadm'), n('R2', 'roadm'), n('R3', 'roadm'), n('R4', 'roadm'), n('TA', 'trx', { mode: 'zrp400' }), n('TB', 'trx', { mode: 'zrp400' })],
    links: [f('a', 'R1', 'R2', 60), f('b', 'R2', 'R4', 60), f('c', 'R1', 'R3', 80), f('d', 'R3', 'R4', 80), { id: 'pa', a: 'TA', b: 'R1', kind: 'patch', p: M.linkDefaults('patch') }, { id: 'pb', a: 'TB', b: 'R4', kind: 'patch', p: M.linkDefaults('patch') }],
    g: { nch: 1, df: 75, launch: 0, plan: [{ slot: 30, mode: 'zrp400', off: 0, svc: true, from: '', to: '', via: '', conv: '', slot2: 30, prot }] }, svc: { a: 'TA', z: 'TB' } };
}

test('a failed amplifier breaks the line: LOS at the far end, both ways', () => {
  const S = build('lh'), amp = S.nodes.find(n => n.type === 'edfa' && n.name === 'ILA-2'); amp.p.fail = 'dead';
  const r = M.simulate(S);
  assert.equal(r.status, 'los'); assert.match(r.headline, /ILA-2 has failed/);
  assert.ok(r.hops.some(h => h.kind === 'cut' && h.note === 'Device failed'));
  assert.equal(M.simulate(build('lh')).status, 'up');
});

test('a failed transponder is reported at once, whichever end', () => {
  for (const nm of ['TRX-A', 'TRX-Z']) {
    const S = build('lh'); S.nodes.find(n => n.name === nm).p.fail = 'dead';
    const r = M.simulate(S);
    assert.equal(r.status, 'los'); assert.match(r.headline, new RegExp(nm + ' has failed'));
  }
});

test('a failed ROADM is routed around, and takes down the channels that end there', () => {
  const S = build('mesh'), rb = S.nodes.find(n => n.name === 'ROADM-B'); rb.p.fail = 'dead';
  const r = M.simulate(S);
  assert.equal(r.channels.find(c => c.svc).status, 'up', 'the service does not touch B');
  const lost = r.channels.filter(c => c.status === 'los');
  assert.ok(lost.length >= 8, 'A to B, B to C and the via-B channels are down: ' + lost.length);
  assert.ok(r.channels.filter(c => c.route.join('>') === 'TRX-A>ROADM-A>ROADM-C>TRX-C').every(c => c.status === 'up'));
  assert.ok(r.alarms.some(a => /failing/.test(a.text)));
});

test('a failed ROADM in the middle of a service re-routes it, or switches it to protection', () => {
  const S = diamond(''); S.nodes.find(n => n.id === 'R2').p.fail = 'dead';
  let r = M.simulate(S);
  assert.deepEqual(r.path.nodes, ['TA', 'R1', 'R3', 'R4', 'TB']); assert.equal(r.status, 'up'); // restoration around the failure
  const P = diamond('1+1'); P.nodes.find(n => n.id === 'R2').p.fail = 'dead';
  r = M.simulate(P);
  assert.deepEqual(r.path.nodes, ['TA', 'R1', 'R3', 'R4', 'TB']);
  assert.ok(r.alarms.some(a => /failed device/.test(a.text) && /switched to the protection route/.test(a.text)));
  assert.equal(r.channels[0].protection.active, 'protect');
  P.nodes.find(n => n.id === 'R3').p.fail = 'dead'; // now both routes have a dead device
  assert.equal(M.simulate(P).status, 'los');
});

test('a degraded device costs margin by type', () => {
  const base = M.simulate(build('lh'), undefined, { single: true });
  const amp = build('lh'); amp.nodes.find(n => n.name === 'ILA-2').p.fail = 'degraded'; amp.nodes.find(n => n.name === 'ILA-2').p.degDb = 6;
  const a = M.simulate(amp, undefined, { single: true });
  assert.ok(a.qMargin < base.qMargin && a.gosnr < base.gosnr, 'less output and a worse noise figure');
  assert.ok(a.alarms.some(x => /ILA-2 is degraded/.test(x.text)));
  assert.match(a.hops.find(h => h.name === 'ILA-2').note, /Degraded/);
  const tx = build('lh'); const t = tx.nodes.find(n => n.name === 'TRX-A'); t.p.fail = 'degraded'; t.p.degDb = 4;
  const tr = M.simulate(tx, undefined, { single: true });
  assert.ok(tr.gosnr < base.gosnr && Math.abs(tr.prx - base.prx) < 1e-6, 'an amplified line re-levels the power; the booster just has more gain to make up and so more noise');
  const dk = build('dark'), d0 = M.simulate(dk, undefined, { single: true }).prx, ta = dk.nodes.find(n => n.type === 'trx'); ta.p.fail = 'degraded'; ta.p.degDb = 4;
  assert.ok(Math.abs(M.simulate(dk, undefined, { single: true }).prx - (d0 - 4)) < 1e-6, 'an unamplified link loses exactly the laser degradation');
  const rx = build('lh'); const z = rx.nodes.find(n => n.name === 'TRX-Z'); z.p.fail = 'degraded'; z.p.degDb = 3;
  const rr = M.simulate(rx, undefined, { single: true });
  assert.ok(rr.qMargin < base.qMargin - 1 && Math.abs(rr.prx - base.prx) < 1e-6, 'a degraded receiver does not change power but costs SNR');
  const ro = build('adddrop'); const b = ro.nodes.find(n => n.name === 'ROADM-B'); const g0 = M.simulate(ro, undefined, { single: true }).hops.find(h => h.name === 'ROADM-B express').gain;
  b.p.fail = 'degraded'; b.p.degDb = 5;
  assert.ok(Math.abs(M.simulate(ro, undefined, { single: true }).hops.find(h => h.name === 'ROADM-B express').gain - (g0 - 5)) < 1e-9, 'a ROADM with a partly blocked WSS adds that much loss');
});

test('failure state is sanitised', () => {
  const S = build('lh'); S.nodes[0].p.fail = 'on fire'; S.nodes[1].p.fail = 'dead'; S.nodes[2].p.fail = 'degraded'; S.nodes[2].p.degDb = 99; S.nodes[3].p.degDb = 'x';
  const n = M.sanitize(S).nodes;
  assert.equal(n[0].p.fail, ''); assert.equal(n[1].p.fail, 'dead'); assert.equal(n[2].p.degDb, 30); assert.equal(n[3].p.degDb, 3);
  const T = build('lh'); const f = T.links.find(l => l.kind === 'fiber'); f.p.srlg = 'duct 1; drop'; 
  assert.equal(M.sanitize(T).links.find(l => l.id === f.id).p.srlg, '');
  f.p.srlg = 'duct-1'; assert.equal(M.sanitize(T).links.find(l => l.id === f.id).p.srlg, 'duct-1');
});

// ---- shared risk link groups ----
test('srlg: cutting one fiber of a duct cuts them all', () => {
  const S = build('srlg'), ac = S.links.find(l => l.kind === 'fiber' && l.p.srlg === 'duct1' && l.p.len === 70), ab = S.links.find(l => l.kind === 'fiber' && l.p.srlg === 'duct1' && l.p.len === 80);
  assert.ok(!M.isCut(S, ab));
  ac.p.cut = true;
  assert.ok(M.isCut(S, ab) && M.isCut(S, ac), 'the neighbour in the duct goes with it');
  assert.ok(!M.isCut(S, S.links.find(l => l.p.len === 90)), 'other fibers are not affected');
  const r = M.simulate(S);
  assert.ok(r.channels.filter(c => c.route.join('>') === 'ROADM-A>ROADM-B').length === 0 || r.channels.filter(c => c.status === 'los').length >= 3, 'A to B channels cannot use A-B either');
});

test('srlg: protection planning avoids the whole duct, not just the working fiber', () => {
  const S = build('srlg'), r = M.simulate(S), sv = r.channels.find(c => c.svc);
  assert.deepEqual(sv.protection.work.route, ['TRX-A', 'ROADM-A', 'ROADM-C', 'TRX-C']);
  assert.deepEqual(sv.protection.protect.route, ['TRX-A', 'ROADM-A', 'ROADM-D', 'ROADM-C', 'TRX-C'], 'A-B is in the same duct as A-C so the long way round through D is used');
  assert.equal(r.status, 'up');
  S.links.forEach(l => { delete l.p.srlg; });
  assert.ok(M.simulate(S).channels.find(c => c.svc).protection.protect.route.includes('ROADM-B'), 'without the duct, A-B-C is the protection route');
  // a cut anywhere in the duct switches the service to the route that avoids it
  const T = build('srlg'); T.links.find(l => l.p.srlg === 'duct1' && l.p.len === 80).p.cut = true;
  const c = M.simulate(T);
  assert.ok(c.path.nodes.some(id => T.nodes.find(n => n.id === id).name === 'ROADM-D'));
  assert.ok(c.alarms.some(a => /switched to the protection route/.test(a.text)));
});

test('failures: device failures enter the availability estimate; protection bypasses an interior device', () => {
  const base = diamond('1+1'); base.g.devRate = 0;
  const noDev = M.resilience(base)[0];
  const S = diamond('1+1'); S.g.devRate = 0.02; // R1 and R4 are single-homed access nodes (12 h repair); R2 is bypassed by the protection route
  const withDev = M.resilience(S)[0];
  assert.ok(Math.abs(withDev.downSec - noDev.downSec - (2 * 0.02 * 12 * 3600 + 0.02 * 0.035 + 2 * 1.5 * 0.02 * 12 * 3600)) < 1e-6, `${withDev.downSec - noDev.downSec}`); // + the two transponders, 1.5x the device rate
  const U = diamond(''); U.g.devRate = 0.02;
  const un = M.resilience(U)[0];
  assert.equal(un.kind, 'restoration');
  const U0 = diamond(''); U0.g.devRate = 0;
  assert.ok(Math.abs(un.downSec - M.resilience(U0)[0].downSec - (2 * 0.02 * 12 * 3600 + 0.02 * 60 + 2 * 1.5 * 0.02 * 12 * 3600)) < 1e-6, 'R2 restores over R3 in 60 s, the access ROADMs wait for repair');
  assert.ok(withDev.failures > noDev.failures);
});

// ---- demand-driven planner ----
test('planner: candidate routes are the shortest first, then the ones through other ROADMs', () => {
  const S = build('mesh'), { ra, rb, rc } = meshIds(S), c = M.candidateRoutes(S, ra, rb);
  assert.equal(c.length, 2);
  assert.equal(c[0].km, 100); assert.equal(c[0].via, '');
  assert.equal(c[1].km, 180); assert.equal(c[1].via, rc);
  assert.equal(M.candidateRoutes(S, ra, rb, 1).length, 1);
});

test('planner: demands take the lowest free slot on their route, the service keeps its own', () => {
  const S = build('mesh'), { ra, rb } = meshIds(S);
  const r = M.planDemands(S, [{ a: ra, z: rb, mode: 'zrp400', count: 4 }]);
  assert.equal(r.stats.placed, 4); assert.deepEqual(r.results.map(x => x.slot), [0, 1, 2, 3]);
  assert.ok(r.results.every(x => x.status === 'placed' && x.km === 100 && !x.detour && x.margin > 1));
  assert.equal(r.entries.length, 4); assert.ok(r.entries.every(e => e.from === ra && e.to === rb && e.via === ''));
  // a demand across the service's own fiber skips the service slot
  const sv = S.g.plan.find(c => c.svc).slot, rc = meshIds(S).rc;
  const t = M.planDemands(S, Array.from({ length: 40 }, () => ({ a: ra, z: rc, mode: 'zrp400', count: 1 })));
  assert.ok(!t.results.some(x => x.slot === sv && x.status === 'placed' && x.route.join() === 'ROADM-A,ROADM-C'), 'the service slot is taken on A-C');
});

test('planner: a full fiber sends demands the long way round, and blocks them when that is full too', () => {
  const S = build('mesh'), { ra, rb } = meshIds(S); S.g.df = 150; // 32 slots
  const ds = [{ a: ra, z: rb, mode: 'zrp400', count: 40 }];
  const r = M.planDemands(S, ds);
  assert.equal(r.stats.placed, 40); assert.equal(r.results.filter(x => x.detour).length, 8, '32 fit on A-B, 8 go A-C-B');
  assert.ok(r.results.filter(x => x.detour).every(x => x.km === 180 && x.via));
  const one = M.planDemands(S, ds, { K: 1 });
  assert.equal(one.stats.blocked, 8); assert.ok(Math.abs(one.stats.blocking - 8 / 40) < 1e-9);
  const many = M.planDemands(S, [{ a: ra, z: rb, mode: 'zrp400', count: 90 }]);
  assert.ok(many.stats.blocked > 0 && many.stats.placed < 90 && many.stats.placed >= 63);
  assert.ok(many.stats.maxUtil >= 0.99);
});

test('planner: reach is checked, and the long way round has less margin', () => {
  const S = build('mesh'), { ra, rb } = meshIds(S);
  const [short, long] = M.candidateRoutes(S, ra, rb), mode = PHY.MODES.zrp400, df = 75e9;
  const e1 = M.estimateRoute(S, short, mode, new Map(), df), e2 = M.estimateRoute(S, long, mode, new Map(), df);
  assert.ok(e1.margin > e2.margin + 1);
  const hard = M.planDemands(S, [{ a: ra, z: rb, mode: 'zrp400', count: 2 }], { minMargin: 40 });
  assert.equal(hard.stats.placed, 0); assert.equal(hard.stats.unreachable, 2);
  const none = M.planDemands(S, [{ a: ra, z: 'nowhere', mode: 'zrp400', count: 1 }]);
  assert.equal(none.results[0].status, 'no route');
});

test('planner: the plan it makes runs in the simulator without blocked channels', () => {
  const S = build('mesh'), { ra, rb, rc } = meshIds(S);
  const r = M.planDemands(S, [{ a: ra, z: rb, mode: 'zrp400', count: 6 }, { a: rb, z: rc, mode: 'zrp400', count: 6 }, { a: ra, z: rc, mode: 'zrp400', count: 3 }]);
  S.g.plan = [S.g.plan.find(c => c.svc), ...r.entries];
  const sim = M.simulate(S);
  assert.ok(sim.channels.every(c => c.status !== 'blocked' && c.status !== 'nopath'), sim.channels.map(c => c.status).join());
  assert.ok(sim.channels.every(c => c.status === 'up'));
  const placed = r.results.filter(x => x.status === 'placed');
  assert.equal(placed.length, 15);
  sim.channels.filter(c => !c.svc).forEach((c, i) => assert.ok(Math.abs(c.qMargin - r.results.filter(x => x.status === 'placed')[i].margin) < 6, 'the estimate is the right ballpark'));
});

test('planner: blocking probability rises with load and is repeatable', () => {
  const S = build('mesh'); S.g.df = 150;
  const a = M.blockingCurve(S, 'zrp400', [10, 60, 140], 6, 7), b = M.blockingCurve(S, 'zrp400', [10, 60, 140], 6, 7);
  assert.deepEqual(a, b);
  assert.equal(a[0].p, 0); assert.ok(a[2].p > a[1].p || a[2].p > 0.2, JSON.stringify(a));
  assert.ok(a.every(x => x.p >= 0 && x.p <= 1));
});

test('planner: demands are sanitised', () => {
  const S = build('mesh'), { ra, rb } = meshIds(S);
  S.nodes.push({ id: 'amp1', type: 'edfa', name: 'AMP', x: 0, y: 0, p: M.TYPES.edfa.def() });
  S.demands = [{ a: ra, z: rb, mode: 'zrp400', count: 5 }, { a: ra, z: ra, mode: 'zrp400', count: 1 }, { a: ra, z: 'ghost', mode: 'zrp400', count: 1 }, { a: ra, z: rb, mode: 'nope', count: 999 }, 'junk', { a: 'amp1', z: rb, count: 1 }];
  const d = M.sanitize(S).demands;
  assert.equal(d.length, 2); assert.equal(d[0].count, 5); assert.equal(d[1].mode, 'zrp400'); assert.equal(d[1].count, 96);
  assert.deepEqual(M.sanitize(build('dci')).demands, []);
});

// ---- per-channel power-offset optimiser ----
test('offset optimiser: lifts the worst channel and leaves the service at zero', () => {
  const S = build('mix'); S.g.plan.forEach(c => (c.off = 0)); // flat plan: the 10G channels sit too high for their receivers
  const before = M.simulate(S, undefined, { single: true }).channels, worst = a => Math.min(...a.filter(c => c.qMargin != null).map(c => c.qMargin));
  const o = M.optimiseOffsets(S);
  assert.ok(o.after.min >= o.before.min - 1e-9);
  assert.ok(o.after.min > o.before.min + 0.05, `worst ${o.before.min.toFixed(2)} -> ${o.after.min.toFixed(2)}`);
  assert.ok(o.offsets.filter((v, i) => S.g.plan[i].mode === 'dwdm10f' && !S.g.plan[i].svc).every(v => v < 0), 'the margin-rich 10G channels give power up to their 400G neighbours');
  assert.equal(o.offsets[S.g.plan.findIndex(c => c.svc)], 0);
  assert.ok(o.offsets.every(v => v >= -6 && v <= 3));
  S.g.plan.forEach((c, i) => (c.off = o.offsets[i]));
  assert.ok(Math.abs(worst(M.simulate(S, undefined, { single: true }).channels) - o.after.min) < 1e-9, 'what it reports is what the simulator gives');
  assert.ok(worst(before) < o.after.min);
  const again = M.optimiseOffsets(S);
  assert.ok(Math.abs(again.after.min - o.after.min) < 0.05, 'a second run finds nothing more');
  assert.equal(M.optimiseOffsets(build('dci')), null, 'needs a plan');
});

// ---- XPM walk-off ----
test('xpm walk-off: neighbours further away matter less, and low-dispersion fiber matters more', () => {
  const smf = PHY.FIBERS.smf, leaf = PHY.FIBERS.leaf;
  assert.ok(Math.abs(PHY.xpmWalk(smf, 80, 75e9) - 1) < 1e-9, 'normalised to a neighbour 75 GHz away on 80 km of SMF');
  const w = d => PHY.xpmWalk(smf, 80, d);
  assert.ok(w(150e9) < w(75e9) && w(300e9) < w(150e9));
  assert.ok(w(150e9) < 0.65 && w(150e9) > 0.35, `about half at twice the spacing: ${w(150e9)}`);
  assert.ok(PHY.xpmWalk(leaf, 80, 75e9) > PHY.xpmWalk(smf, 80, 75e9) * 1.5, 'less dispersion, less walk-off, more XPM');
  assert.ok(PHY.xpmWalk({ ...smf, D: 0 }, 80, 75e9) <= 8);
});

test('xpm walk-off: a 10G channel suffers more from a close coherent neighbour than from a far one, and more on NZ-DSF', () => {
  const mk = (gap, fiber) => {
    const S = build('mix'); S.links.filter(l => l.kind === 'fiber').forEach(l => { l.p.fiber = fiber; });
    S.g.df = 75; S.g.plan = [{ slot: 20, mode: 'dwdm10f', off: 0, svc: true, from: '', to: '', via: '', conv: '', slot2: 20, prot: '' }, { slot: 20 + gap, mode: 'zrp400', off: 0, svc: false, from: '', to: '', via: '', conv: '', slot2: 20 + gap, prot: '' }];
    return M.simulate(S, 0, { single: true }).channels[0].xpmPen;
  };
  const near = mk(1, 'smf'), far = mk(4, 'smf'), nz = mk(1, 'leaf');
  assert.ok(near > 0 && far < near * 0.6, `${near} vs ${far}`);
  assert.ok(nz > near, `${nz} vs ${near}`);
});

// ---- time-domain transients and ramped adds ----
test('transient trace: the excursion rises, peaks when the control engages and recovers', () => {
  const r = M.simulate(build('lh'), undefined, { single: true }), tr = r.transientTrace, t = r.transient;
  assert.equal(tr.t.length, tr.surge.length); assert.equal(tr.t[0], 0); assert.equal(tr.surge[0], 0);
  assert.ok(Math.abs(tr.peakDb - t.surgeDb) < 0.02, 'amplifiers with the same response peak together: the peak is the sum of their peaks');
  assert.ok(tr.surge[tr.surge.length - 1] < tr.peakDb * 0.05, 'the loop has pulled it back by the end');
  const iPk = tr.surge.indexOf(tr.peakDb); assert.ok(tr.t[iPk] > 0 && tr.t[iPk] < 80, `peaks around the 20 us response time: ${tr.t[iPk]}`);
  assert.ok(tr.dip.every(v => v <= 0) && Math.abs(Math.min(...tr.dip) + tr.peakDb) < 1e-9, 'channels returning mirror it');
});

test('transient trace: a slow amplifier peaks later and lower than the sum of the peaks; ideal control shows nothing', () => {
  const S = build('lh'); S.nodes.find(n => n.name === 'ILA-2').p.agcUs = 3000;
  const r = M.simulate(S, undefined, { single: true });
  assert.ok(r.transient.peakDb < r.transient.surgeDb, 'the peaks do not coincide');
  assert.ok(r.transientTrace.t[r.transientTrace.surge.indexOf(r.transientTrace.peakDb)] > 100);
  const Z = build('lh'); Z.g.agcUs = 0;
  assert.equal(M.simulate(Z, undefined, { single: true }).transient.surgeDb, 0);
  assert.equal(M.simulate(Z, undefined, { single: true }).transientTrace.peakDb, 0);
});

test('ramped adds: a ramp slower than the amplifier time constant shrinks the dip, and never the surge', () => {
  const S = build('lh'); S.g.agcUs = 400; // a slower control loop, so there is a real dip to reduce
  const inst = M.simulate(S, undefined, { single: true });
  S.g.rampMs = 5;
  const ramp = M.simulate(S, undefined, { single: true });
  assert.equal(inst.transient.rampF, 1);
  assert.ok(ramp.transient.rampF < 0.1 && Math.abs(ramp.transient.rampF - (200 / 5000) * (1 - Math.exp(-25))) < 1e-9);
  assert.equal(ramp.transient.surgeDb, inst.transient.surgeDb);
  assert.ok(ramp.transient.prxDip > inst.transient.prxDip + 1, 'the dip is much shallower');
  assert.ok(ramp.transient.qMarginDip > inst.transient.qMarginDip);
  const T = build('lh'); T.g.rampMs = -4; assert.equal(M.sanitize(T).g.rampMs, 0);
  T.g.rampMs = 1e9; assert.equal(M.sanitize(T).g.rampMs, 10000);
});

// ---- client-side protection ----
test('dual-homed transponders: the protection route avoids the access cords and ROADMs too', () => {
  const S = build('client'), r = M.simulate(S), sv = r.channels.find(c => c.svc);
  assert.equal(r.status, 'up');
  assert.deepEqual(sv.protection.work.route, ['TRX-A', 'ROADM-A1', 'ROADM-Z1', 'TRX-Z']);
  assert.deepEqual(sv.protection.protect.route, ['TRX-A', 'ROADM-A2', 'ROADM-Z2', 'TRX-Z']);
  assert.ok(sv.protection.work.routeLinks.every(id => !sv.protection.protect.routeLinks.includes(id)), 'no cable in common, patch cords included');
  // a single-homed transponder still shares its access cord (the mesh preset's protection is unchanged)
  const m = M.simulate(build('mesh')); S.g.plan.find(c => c.svc).prot = '1+1';
  assert.equal(M.simulate(build('mesh')).status, 'up'); assert.ok(m.channels.every(c => c.status === 'up'));
});

test('spare module: a failed primary is covered, at the price of the switch or y-cable loss', () => {
  const S = build('lh'); const a = S.nodes.find(n => n.name === 'TRX-A');
  a.p.fail = 'dead';
  assert.equal(M.simulate(S).status, 'los', 'without a spare it is dark');
  a.p.spare = 'switch';
  const r = M.simulate(S);
  assert.notEqual(r.status, 'los'); assert.ok(r.alarms.some(x => /primary module has failed/.test(x.text) && /optical switch/.test(x.text)));
  const base = M.simulate(build('lh'), undefined, { single: true }), T = build('lh');
  T.nodes.find(n => n.name === 'TRX-Z').p.spare = 'ycable';
  assert.ok(Math.abs(M.simulate(T, undefined, { single: true }).prx - (base.prx - 3.5)) < 1e-6, 'a y-cable in front of the receiver costs 3.5 dB');
  const U = build('lh'); U.nodes.find(n => n.name === 'TRX-A').p.spare = 'ycable';
  assert.ok(M.simulate(U, undefined, { single: true }).gosnr <= base.gosnr, 'and on the transmit side lowers the power into the first amplifier');
  const bad = build('lh'); bad.nodes[0].p.spare = 'wire'; assert.equal(M.sanitize(bad).nodes[0].p.spare === '' || M.sanitize(bad).nodes[0].p.spare === undefined, true);
});

test('client protection in the availability estimate: spares and dual-homing cut the transponder and access-ROADM downtime', () => {
  const S = build('client'); S.g.cutRate = 0; // only device failures
  const d = M.resilience(S)[S.g.plan.findIndex(c => c.svc)];
  assert.ok(Math.abs(d.downSec - (2 * 0.02 + 2 * 0.03) * 0.035) < 1e-9, `${d.downSec}`);
  const U = build('client'); U.g.cutRate = 0; U.nodes.filter(n => n.type === 'trx').forEach(n => { n.p.spare = ''; });
  const u = M.resilience(U)[U.g.plan.findIndex(c => c.svc)];
  assert.ok(Math.abs(u.downSec - (d.downSec + 2 * 0.03 * (12 * 3600 - 0.035))) < 1e-6, 'without spares the transponders wait for repair');
});

// ---- coupled-wave Raman solver in the line simulation ----
const ramanLine = (opts = {}) => {
  const S = uniform('dci'), f = S.links.find(l => l.kind === 'fiber'); f.p.len = 110; f.p.raman = opts.mw ?? 800; f.p.ramanPumps = opts.pumps ?? 1; f.p.ramanDir = opts.dir ?? 'back'; f.p.ramanFull = !!opts.full;
  S.g.nch = opts.nch ?? 32; S.g.df = 75; S.g.launch = opts.launch ?? 0;
  return { S, f };
};

test('raman solver in the line: gain close to the closed-form model, with a gain spectrum from the physics', () => {
  const approx = ramanLine({}), full = ramanLine({ full: true });
  const a = M.simulate(approx.S), b = M.simulate(full.S);
  const ga = a.hops.find(h => h.kind === 'span').raman, gb = b.hops.find(h => h.kind === 'span').raman;
  assert.ok(Math.abs(ga - gb) < 3.5, `closed form ${ga.toFixed(1)} dB, solver ${gb.toFixed(1)} dB`);
  assert.equal(a.status, 'up'); assert.equal(b.status, 'up');
  assert.ok(b.raman.length === 1 && b.raman[0].solver === true && a.raman[0].solver === false, 'the Raman tab data exists for both');
  assert.ok(Math.abs(a.raman[0].gainSvcDb - ga) < 3.5);
  assert.ok(b.raman[0].ripple > 0.5 && b.raman[0].ripple < 5, `ripple ${b.raman[0].ripple}`);
  assert.equal(M.simulate(full.S, undefined, { single: true }).raman.length, 0, 'sweeps skip the profile');
});

test('raman solver in the line: more pump wavelengths flatten it, more channels deplete it', () => {
  const rip = n => M.simulate(ramanLine({ full: true, pumps: n, mw: 900 }).S).raman[0].ripple;
  assert.ok(rip(3) < rip(1) * 0.7, `${rip(3)} vs ${rip(1)}`);
  const gain = n => M.simulate(ramanLine({ full: true, nch: n, launch: 3, mw: 500 }).S, undefined, { single: true }).hops.find(h => h.kind === 'span').raman;
  assert.ok(gain(96) < gain(8) - 0.3, `${gain(96)} vs ${gain(8)}`);
  const both = M.simulate(ramanLine({ full: true, dir: 'both', mw: 800 }).S);
  assert.equal(both.status, 'up'); assert.ok(both.raman[0].pumps.some(p => p.dir === 'fwd') && both.raman[0].pumps.some(p => p.dir === 'back'));
  assert.ok(both.raman[0].profile.pump.length === 2);
});

test('raman solver in the line: per-channel gain in a plan follows the physics, and the service row matches the headline', () => {
  const { S } = ramanLine({ full: true, mw: 900, pumps: 1 });
  S.g.plan = [0, 20, 40, 63].map((slot, i) => ({ slot, mode: 'zrp400', off: 0, svc: i === 1, from: '', to: '', via: '', conv: '', slot2: slot, prot: '' }));
  S.links.find(l => l.kind === 'fiber').p.nch = 4;
  const r = M.simulate(S), svc = r.channels.find(c => c.svc);
  assert.ok(Math.abs(svc.qMargin - r.qMargin) < 1e-6);
  const g = r.channels.map(c => c.gosnr), spread = Math.max(...g) - Math.min(...g); // the amplifier re-levels the power, so the gain difference shows up as noise
  assert.ok(spread > 0.05, `channels at the band edges get different Raman gain and so different GSNR: ${spread}`);
  assert.ok(r.raman[0].samples.length === 4);
});

test('raman solver: the option is sanitised', () => {
  const S = build('dci'), f = S.links.find(l => l.kind === 'fiber'); f.p.ramanFull = 'yes';
  assert.equal(M.sanitize(S).links.find(l => l.id === f.id).p.ramanFull, false);
  f.p.ramanFull = true; assert.equal(M.sanitize(S).links.find(l => l.id === f.id).p.ramanFull, true);
});

test('two muxponders per side share passive muxes, one wave each', () => {
  const S = build('mxp2'), r = M.simulate(S);
  assert.equal(r.status, 'up');
  const a2 = S.nodes.find(n => n.name === 'MXP-A2').id, b2 = S.nodes.find(n => n.name === 'MXP-B2').id;
  const second = r.channels.find(c => c.from === a2 && c.to === b2);
  assert.ok(second && second.status === 'up', 'second muxponder pair is carried');
  assert.notEqual(second.slot, r.channels.find(c => c.svc).slot);
  assert.ok(r.channels.every(c => c.status === 'up'));
  S.nodes.find(n => n.name === 'MXP-B2').p.fail = 'dead'; // losing one far-end muxponder takes down only its own wave
  const r2 = M.simulate(S);
  assert.equal(r2.channels.find(c => c.svc).status, 'up');
  assert.notEqual(r2.channels.find(c => c.from === a2).status, 'up');
});

test('a failed port on a passive mux takes down only its own wave', () => {
  const S = M.sanitize(build('mxp2')), mb = S.nodes.find(n => n.name === 'MUX-B');
  const r0 = M.simulate(S), sv = r0.channels.find(c => c.svc).slot, other = r0.channels.find(c => !c.svc && c.from).slot;
  mb.p.badPorts = [other];
  const r = M.simulate(S);
  assert.equal(r.channels.find(c => c.svc).status, 'up');
  const lost = r.channels.filter(c => c.status === 'los');
  assert.deepEqual(lost.map(c => c.slot), [other]);
  assert.match(lost[0].notes[0], /port on MUX-B/);
  mb.p.badPorts = [sv]; // the service's own port: the headline reports it
  const r2 = M.simulate(S);
  assert.equal(r2.status, 'down');
  assert.match(r2.headline, /port for slot \d+ \(CH[\d.]+\) on MUX-B/);
});

test('a failed card takes down its eight ports and nothing else', () => {
  const S = M.sanitize(build('mxp2')), ma = S.nodes.find(n => n.name === 'MUX-A');
  const slots = M.simulate(S).channels.map(c => c.slot), card = Math.floor(Math.max(...slots) / M.PORTS_PER_CARD);
  ma.p.badCards = [card];
  const r = M.simulate(S);
  for (const c of r.channels) assert.equal(c.status === 'los', Math.floor(c.slot / M.PORTS_PER_CARD) === card, `slot ${c.slot}`);
  assert.ok(r.channels.some(c => c.status === 'up'), 'channels on other cards keep running');
});

test('port and card lists survive sanitize and reject junk', () => {
  const S = build('mxp2'), mb = S.nodes.find(n => n.name === 'MUX-B');
  mb.p.badPorts = [3, 3, -1, 200, 'x', 1.5, 7]; mb.p.badCards = [2, 99, null];
  const c = M.sanitize(clone(S)).nodes.find(n => n.name === 'MUX-B');
  assert.deepEqual(c.p.badPorts, [3, 7]); assert.deepEqual(c.p.badCards, [2]);
  assert.equal(M.sanitize(clone(S)).nodes.find(n => n.name === 'MXP-A1').p.badPorts, undefined);
});

test('passive OADM bus: transponders on add/drop ports pair across the line and the rest passes through', () => {
  const S = M.sanitize(build('oadm')), d = M.derive(S), r = M.simulate(S), nm = id => S.nodes.find(n => n.id === id).name;
  assert.equal(d.paired, 6); assert.equal(d.dark.length, 0);
  assert.equal(r.status, 'up'); assert.ok(r.channels.every(c => c.status === 'up'));
  const pairs = d.plan.filter(c => !c.filler).map(c => `${nm(c.from)}>${nm(c.to)}@${c.slot + 1}`).sort();
  assert.deepEqual(pairs, ['TRX-A1>TRX-B1@25', 'TRX-A2>TRX-B2@26', 'TRX-A3>TRX-Z2@32', 'TRX-A4>TRX-C1@29', 'TRX-B3>TRX-Z1@27', 'TRX-C2>TRX-Z3@30']);
  assert.ok(d.plan.filter(c => c.filler).every(c => ![24, 25, 26, 28, 29].includes(c.slot)), 'background channels keep out of the slots an OADM serves');
});

test('passive OADM: a slot a side serves cannot pass through it', () => {
  const S = M.sanitize(build('oadm')), sv = M.simulate(S).channels.find(c => c.svc).slot;
  S.nodes.find(n => n.name === 'OADM-C').p.wPorts = sv - 28 + 1; // OADM-C's west side now also serves the service's slot
  const r = M.simulate(S);
  assert.equal(r.status, 'down'); assert.match(r.headline, /dropped by the filter at OADM-C/);
});

test('passive OADM: a transponder faces one side of the OADM and talks to that side only', () => {
  const S = M.sanitize(build('oadm')), ob = S.nodes.find(n => n.name === 'OADM-B');
  for (const l of S.links) if (l.a === ob.id || l.b === ob.id) { const k = l.a === ob.id ? 'sa' : 'sb'; if (!S.nodes.find(n => n.id === (l.a === ob.id ? l.b : l.a)).type.match(/trx/)) l.p[k] = l.p[k] === 'w' ? 'e' : 'w'; }
  const d = M.derive(S), b1 = S.nodes.find(n => n.name === 'TRX-B1');
  assert.match(d.dark.find(x => x.id === b1.id).why, /no partner.*west side/); // its west port now faces the line to OADM-C, away from the A end
  const S2 = M.sanitize(build('oadm')); S2.nodes.find(n => n.name === 'TRX-B1').p.slot = 3;
  assert.match(M.derive(S2).dark.find(x => /TRX-B1 is tuned/.test(x.why)).why, /OADM-B west port 1.*filter blocks it/);
});

test('passive OADM: add/drop ports cost the add/drop loss, through channels the pass-through loss, and 1310 adds a little', () => {
  const S = M.sanitize(build('oadm')), pick = r => ({ drop: r.channels.find(c => c.slot === 24).prx, thru: r.channels.find(c => c.svc).prx });
  const hop = r => r.hops.find(h => h.name === 'OADM-B').gain;
  const r0 = M.simulate(S), a = pick(r0), ob = S.nodes.find(n => n.name === 'OADM-B');
  assert.equal(hop(r0), -1.5);
  ob.p.ad = 9; const r1 = M.simulate(S), b = pick(r1);
  assert.ok(Math.abs((a.drop - b.drop) - 6) < 0.5, `drop port lost ${a.drop - b.drop} dB, wanted 6`);
  assert.ok(Math.abs(a.thru - b.thru) < 0.01);
  ob.p.p1310 = true; assert.ok(Math.abs(hop(M.simulate(S)) + 2.1) < 1e-9, 'the 1310 coupler adds 0.6 dB on the line');
});

test('passive OADM: sides, port counts and old slot lists survive sanitize', () => {
  const S = build('oadm'), ob = S.nodes.find(n => n.name === 'OADM-B');
  Object.assign(ob.p, { sides: 'x', ePorts: 999, wFirst: -3, p1310: 'yes' });
  let c = M.sanitize(clone(S)).nodes.find(n => n.name === 'OADM-B');
  assert.equal(c.p.sides, 'ew'); assert.equal(c.p.ePorts, 64); assert.equal(c.p.wFirst, 0); assert.equal(c.p.p1310, false);
  ob.p = { thru: 1.5, ad: 3, tx: 0, slots: [24, 25, 26, 27] }; // an older lab
  c = M.sanitize(clone(S)).nodes.find(n => n.name === 'OADM-B');
  assert.deepEqual([c.p.eFirst, c.p.ePorts, c.p.wFirst, c.p.wPorts], [24, 4, 24, 4]); assert.equal(c.p.slots, undefined);
  ob.p = { ...M.TYPES.oadm.def(), sides: 'e' }; // a one-sided OADM: every cable end is on its east side
  const C = M.sanitize(clone(S)), id = C.nodes.find(n => n.name === 'OADM-B').id;
  assert.ok(C.links.filter(l => l.a === id || l.b === id).every(l => (l.a === id ? l.p.sa : l.p.sb) === 'e'));
  assert.equal(M.sanitize(clone(S)).nodes.find(n => n.name === 'MUX-A').p.sides, undefined);
});

test('passive OADM: a failed port at an OADM takes down only that channel', () => {
  const S = M.sanitize(build('oadm')); S.nodes.find(n => n.name === 'OADM-B').p.badPorts = [24];
  const r = M.simulate(S), lost = r.channels.filter(c => c.status === 'los');
  assert.deepEqual(lost.map(c => c.slot), [24]);
  assert.equal(r.channels.find(c => c.svc).status, 'up');
});

test('cabling defines channels: transponders on mux ports pair up by slot', () => {
  const S = build('ports'), d = M.derive(S);
  assert.equal(d.paired, 3); assert.equal(d.dark.length, 0);
  assert.deepEqual(d.plan.filter(c => !c.filler).map(c => c.slot), [26, 27, 29]);
  assert.equal(d.plan.length, 16, 'the rest of the line is filled up to the channel count');
  const r = M.simulate(S);
  assert.equal(r.status, 'up');
  assert.ok(r.channels.every(c => c.status === 'up'));
  assert.ok(r.derived && r.derived.paired === 3);
  assert.equal(r.channels.find(c => c.svc).slot, 26);
});

test('cabling defines channels: a transponder tuned away from its port is dark, and says why', () => {
  const S = build('ports'), a2 = S.nodes.find(n => n.name === 'TRX-A2');
  a2.p.slot = 40;
  const d = M.derive(S);
  assert.equal(d.paired, 2);
  assert.match(d.dark.find(x => x.id === a2.id).why, /tuned to slot 41 \(CH[\d.]+\) but plugged into MUX-A port 4, which passes slot 28 \(CH[\d.]+\)/);
  assert.ok(d.dark.some(x => x.name === 'TRX-B2' && /no partner/.test(x.why)), 'its far end loses its partner');
  assert.ok(M.simulate(S).alarms.some(a => /tuned to slot 41/.test(a.text)));
  const sv = S.nodes.find(n => n.name === 'TRX-A1'); sv.p.slot = 3; // the service transponder itself
  const r = M.simulate(S);
  assert.equal(r.status, 'los'); assert.match(r.headline, /filter blocks it/);
});

test('cabling defines channels: two transponders on one port, a missing port and a mode mismatch', () => {
  let S = build('ports'); S.links.find(l => l.p.mport === 3 && S.nodes.find(n => n.id === l.a || n.id === l.b).name === 'TRX-A2').p.mport = 2;
  assert.ok(M.derive(S).dark.some(x => x.name === 'TRX-A2' && /already uses/.test(x.why)));
  S = build('ports'); S.nodes.find(n => n.name === 'MUX-A').p.ports = 3; // MUX-A now has ports 1-3 only
  assert.ok(M.derive(S).dark.some(x => /has no port 6/.test(x.why)));
  S = build('ports'); S.nodes.find(n => n.name === 'TRX-B2').p.mode = 'zr400';
  const d = M.derive(S); assert.equal(d.paired, 2); assert.ok(d.dark.some(x => /will never lock/.test(x.why)));
});

test('the starter labs are plugged in by mux port, with the results of the uniform line', () => {
  for (const k of ['dci', 'lh', 'sfp10', 'sfp10dcm', 'mxp', 'olp', 'odf']) {
    const c = M.simulate(build(k)), u = M.simulate(uniform(k));
    assert.ok(c.derived, `${k} is cabled`); assert.equal(c.status, u.status, k); assert.ok(Math.abs(c.gosnr - u.gosnr) < 0.05, `${k}: ${c.gosnr} vs ${u.gosnr}`);
    assert.equal(c.derived.dark.length, 0, `${k}: every transponder has a partner`);
  }
});

test('cabling defines channels: a lab without mux ports behaves as before, and ports survive sanitize', () => {
  assert.equal(M.derive(uniform('mxp')), null); assert.equal(M.derive(uniform('dci')), null);
  const S = build('ports'), c = M.sanitize(clone(S));
  assert.equal(M.derive(c).paired, 3);
  const bad = clone(S); bad.links.forEach(l => { if (l.p.mport === 2) l.p.mport = 'x'; if (l.p.mport === 3) l.p.mport = -4; });
  const cc = M.sanitize(bad); assert.equal(cc.links.filter(l => l.p.mport === 2 || l.p.mport === 3).length, 0);
  assert.ok(cc.links.filter(l => l.kind === 'fiber').every(l => l.p.mport === null), 'only a transponder-to-mux patch has a port');
});

const rp = () => M.sanitize(build('roadmports'));
test('ROADM add/drop ports: transponders pair across the ring, and a slot is reused on different fibers', () => {
  const S = rp(), d = M.derive(S), r = M.simulate(S), nm = id => S.nodes.find(n => n.id === id).name;
  assert.equal(d.paired, 3); assert.equal(d.dark.length, 0);
  assert.deepEqual(d.plan.filter(c => !c.filler).map(c => `${nm(c.from)}>${nm(c.to)}@${c.slot + 1}`).sort(), ['TRX-A1>TRX-C1@30', 'TRX-A2>TRX-B1@31', 'TRX-C2>TRX-B2@31']);
  assert.equal(r.status, 'up'); assert.ok(r.channels.every(c => c.status === 'up'), 'the reused slot is not blocked');
  assert.equal(d.plan.length, 12);
});

test('ROADM add/drop ports: colored, contentionless and directionless change what can be plugged where', () => {
  let S = rp(); S.nodes.find(n => n.name === 'ROADM-B').p.contentionless = false; // B1 and B2 are both in slot 31 on ROADM-B
  assert.ok(M.derive(S).dark.some(x => /not contentionless/.test(x.why)));
  S = rp(); S.nodes.find(n => n.name === 'ROADM-A').p.colorless = false; // A1 is tuned to slot 30 but port 1 now passes slot 25
  assert.ok(M.derive(S).dark.some(x => x.name === 'TRX-A1' && /plugged into ROADM-A port 1, which passes slot 25/.test(x.why)));
  S = rp(); S.nodes.find(n => n.name === 'ROADM-A').p.directionless = false; // each port now belongs to a degree
  S = M.sanitize(clone(S));
  assert.equal(M.derive(S).paired, 3);
  const l = S.links.find(x => S.nodes.find(n => n.id === (x.a === S.nodes.find(q => q.name === 'ROADM-A').id ? x.b : x.a)).name === 'TRX-A1');
  (l.a === S.nodes.find(n => n.name === 'ROADM-A').id ? (l.p.sa = '4') : (l.p.sb = '4')); // a degree with no line cable
  assert.match(M.derive(S).dark.find(x => x.name === 'TRX-A1').why, /no partner.*degree 4/);
});

test('ROADM add/drop ports: peers, degrees and port failures', () => {
  let S = rp(); S.nodes.find(n => n.name === 'TRX-A2').p.peer = S.nodes.find(n => n.name === 'TRX-C2').id; S.nodes.find(n => n.name === 'TRX-B1').p.peer = '';
  assert.ok(M.derive(S).dark.length > 0, 'a peer that is already taken leaves someone without a partner');
  S = rp(); const ra = S.nodes.find(n => n.name === 'ROADM-A'); ra.p.degrees = 99; ra.p.colorless = 'yes'; S.nodes.find(n => n.name === 'TRX-B1').p.peer = 'nope';
  const c = M.sanitize(clone(S)); assert.equal(c.nodes.find(n => n.name === 'ROADM-A').p.degrees, 9); assert.equal(c.nodes.find(n => n.name === 'ROADM-A').p.colorless, true); assert.equal(c.nodes.find(n => n.name === 'TRX-B1').p.peer, '');
  const idA = c.nodes.find(n => n.name === 'ROADM-A').id;
  assert.deepEqual(c.links.filter(l => l.kind === 'fiber' && (l.a === idA || l.b === idA)).map(l => (l.a === idA ? l.p.sa : l.p.sb)).sort(), ['1', '2'], 'line cables get degrees 1 and 2');
  S = rp(); S.nodes.find(n => n.name === 'ROADM-C').p.badPorts = [29];
  const r = M.simulate(S); assert.equal(r.status, 'down'); assert.match(r.headline, /port for slot 30 \(CH[\d.]+\) on ROADM-C/);
});

const hostPair = (S, a, b) => { const id = n => S.nodes.find(x => x.name === n).id, ia = id(a), ib = id(b); return M.reach(S, M.simulate(S)).find(r => (r.a === ia && r.z === ib) || (r.a === ib && r.z === ia)); };
test('reachability: hosts on matching muxponder client ports reach each other, with a latency from the fiber', () => {
  const S = M.sanitize(build('reach')), r = hostPair(S, 'HOST-A1', 'HOST-B1');
  assert.equal(r.ok, true); assert.ok(r.steps.every(s => s.ok));
  assert.ok(Math.abs(r.latencyUs - (80 * 4.9 + 20 + 0.012 * 4.9)) < 1e-6, `latency ${r.latencyUs}`); assert.equal(r.rate, 100); // latency: fiber, the transceivers and four 3 m patch cords
  assert.equal(hostPair(S, 'HOST-A2', 'HOST-B2').ok, true);
  assert.match(hostPair(S, 'HOST-A1', 'HOST-B2').why, /client port 1 is carried to client port 1.*client port 2/);
  assert.match(hostPair(S, 'HOST-A1', 'HOST-A2').why, /same muxponder/);
});

test('reachability: each thing that can be wrong says so, in the order a packet meets it', () => {
  let S = M.sanitize(build('reach')); S.nodes.find(n => n.name === 'HOST-B1').p.speed = 10;
  assert.match(hostPair(S, 'HOST-A1', 'HOST-B1').why, /100GBASE-LR4 \(100G\) but HOST-B1's port is 10G/);
  S = M.sanitize(build('reach')); S.links.find(l => l.kind === 'fiber').p.cut = true;
  assert.match(hostPair(S, 'HOST-A1', 'HOST-B1').why, /channel is LOS/);
  S = M.sanitize(build('reach')); S.nodes.find(n => n.name === 'HOST-B1').p.ip = '10.0.1.2/24';
  assert.match(hostPair(S, 'HOST-A1', 'HOST-B1').why, /different subnets/);
  S.nodes.find(n => n.name === 'HOST-B1').p.ip = '10.0.0.1/24'; assert.match(hostPair(S, 'HOST-A1', 'HOST-B1').why, /both hosts use the address/);
  S = M.sanitize(build('reach')); S.nodes.find(n => n.name === 'MXP-B').p.mode = 'zr400';
  assert.match(hostPair(S, 'HOST-A1', 'HOST-B1').why, /will never lock/);
  S = M.sanitize(build('reach')); S.links = S.links.filter(l => !(l.p.hport != null && S.nodes.find(n => n.id === (l.a === S.nodes.find(x => x.name === 'HOST-A1').id ? l.a : l.b)).name === 'HOST-A1'));
  assert.match(hostPair(S, 'HOST-A1', 'HOST-B1').why, /HOST-A1 is not cabled/);
  S = M.sanitize(build('reach')); S.nodes.find(n => n.name === 'MXP-A').p.clients[0].len = 200; // a client link far beyond what its optic can reach
  assert.match(hostPair(S, 'HOST-A1', 'HOST-B1').why, /below the .* sensitivity/);
});

test('traffic: flows are capped by the host port and share the channel, with the loss reported', () => {
  const S = M.sanitize(build('reach')), T = M.traffic(S, M.simulate(S)), nm = id => S.nodes.find(n => n.id === id).name;
  const f = (a, z) => T.flows.find(x => nm(x.a) === a && nm(x.z) === z);
  assert.equal(f('HOST-A1', 'HOST-B1').delivered, 60); assert.equal(f('HOST-A1', 'HOST-B1').lossPct, 0);
  assert.equal(f('HOST-A2', 'HOST-B2').delivered, 100); assert.ok(Math.abs(f('HOST-A2', 'HOST-B2').lossPct - 100 / 3) < 1e-6);
  const ab = T.channels.find(c => c.dir === 'ab'); assert.equal(ab.load, 160); assert.equal(ab.cap, 400); assert.ok(!ab.over);
  S.g.plan = null; S.links.find(l => l.kind === 'fiber').p.cut = true;
  assert.equal(M.traffic(S, M.simulate(S)).flows.every(x => x.delivered === 0 && !x.ok), true);
});

test('hosts: sanitize keeps valid addresses, speeds, ports and flows, and drops junk', () => {
  const S = build('reach'), h = S.nodes.find(n => n.name === 'HOST-A1');
  Object.assign(h.p, { ip: '999.1.1.1/24', speed: 77, ports: 99 }); S.flows.push({ a: h.id, z: h.id, gbps: 5 }, { a: 'x', z: h.id, gbps: 5 }, { a: h.id, z: S.nodes.find(n => n.name === 'HOST-B1').id, gbps: 'lots' });
  S.links.find(l => l.p.hport === 0).p.cport = 9;
  const c = M.sanitize(clone(S)), ch = c.nodes.find(n => n.name === 'HOST-A1');
  assert.equal(ch.p.ip, ''); assert.equal(ch.p.speed, 100); assert.equal(ch.p.ports, 8); assert.equal(c.flows.length, 3, 'the three good flows survive');
  assert.equal(c.links.filter(l => l.p.cport === 9).length, 0);
  assert.equal(c.links.find(l => l.kind === 'fiber').p.hport, null);
  assert.ok(M.route(c, c.svc.a, c.svc.z, true), 'hosts never become part of the light path');
});

test('reachability: transponders on mux ports carry hosts, and a mistuned transponder explains itself', () => {
  const S = M.sanitize(build('ports')), id = n => S.nodes.find(x => x.name === n).id, mk = (nm, t) => ({ id: 'h' + nm, type: 'host', name: nm, x: 0, y: 0, p: { ip: '10.1.0.' + nm.slice(1) + '/24', ports: 1, speed: 400 } });
  S.nodes.push(mk('H1'), mk('H2')); S.links.push({ id: 'lc1', a: 'hH1', b: id('TRX-A1'), kind: 'patch', p: { ...M.linkDefaults('patch'), hport: 0, cport: 0 } }, { id: 'lc2', a: 'hH2', b: id('TRX-B1'), kind: 'patch', p: { ...M.linkDefaults('patch'), hport: 0, cport: 0 } });
  let r = M.reach(S, M.simulate(S))[0]; assert.equal(r.ok, true); assert.equal(r.entry.slot, 26);
  S.nodes.find(n => n.name === 'TRX-B1').p.slot = 40;
  const res = M.simulate(S); r = M.reach(S, res)[0]; assert.equal(r.ok, false); assert.match(r.why, /is dark/);
  assert.ok(res.derived.dark.some(x => /TRX-B1 is tuned to slot 41/.test(x.why)), 'the mistuned end says why, and the other end has no partner');
});

const bd = () => M.sanitize(build('bidi'));
test('single fiber: BiDi ports pair transmit and receive slots, and each direction runs at its own frequency', () => {
  const S = bd(), d = M.derive(S), r = M.simulate(S), nm = id => S.nodes.find(n => n.id === id).name;
  assert.equal(d.paired, 3); assert.equal(d.dark.length, 0);
  assert.deepEqual(d.plan.filter(c => !c.filler).map(c => `${nm(c.from)}>${nm(c.to)} ${c.slot + 1}/${c.slotRev + 1}`).sort(), ['TRX-A1>TRX-B1 25/27', 'TRX-A2>TRX-B2 26/28', 'TRX-B3>TRX-Z1 31/32']);
  assert.equal(r.status, 'up'); assert.ok(r.channels.every(c => c.status === 'up'));
  const sv = r.channels.find(c => c.svc), rv = r.rev.channels.find(c => c.svc);
  assert.equal(sv.slot, 24); assert.equal(rv.slot, 26); assert.ok(rv.fTHz > sv.fTHz, 'the way back is on the other slot');
  const ob = S.nodes.find(n => n.name === 'OADM-B'); assert.deepEqual([M.oadmRange(ob, 'w'), M.oadmRange(ob, 'e')], [[24, 28], [30, 32]]);
});

test('single fiber: both ends on the same band, or a wrong receive slot, is dark and says why', () => {
  let S = bd(); S.nodes.find(n => n.name === 'MUX-Z').p.role = 'low'; // Z now transmits the same slot as OADM-B's east port
  assert.match(M.derive(S).dark.find(x => x.name === 'TRX-Z1').why, /both transmit on slot 31.*single fiber.*own wavelength/);
  S = bd(); S.nodes.find(n => n.name === 'TRX-A1').p.rxSlot = 24;
  assert.match(M.derive(S).dark.find(x => x.name === 'TRX-A1').why, /listens on slot 25 \(CH[\d.]+\) but MUX-A port 1 delivers slot 27 \(CH[\d.]+\)/);
  S = bd(); S.nodes.find(n => n.name === 'TRX-A2').p.slot = 3;
  assert.match(M.derive(S).dark.find(x => x.name === 'TRX-A2').why, /tuned to slot 4 \(CH[\d.]+\) but plugged into MUX-A port 2, which transmits slot 26 \(CH[\d.]+\)/);
  S = bd(); S.nodes.find(n => n.name === 'MUX-A').p.bidi = false; // one end not BiDi: it cannot pair with a BiDi far end
  assert.ok(M.derive(S).dark.some(x => x.name === 'TRX-A1'));
});

test('single fiber: a channel needs a different slot each way, and no other channel may use either', () => {
  const S = M.sanitize(uniform('dci')), fib = S.links.find(l => l.kind === 'fiber'); fib.p.single = true;
  S.nodes.forEach(n => { if (n.type === 'edfa') n.p.bidi = true; }); // the line's amplifiers have to pass both directions on a single fiber
  S.g.plan = M.planFromUniform(S.g, 'zrp400'); S.g.nch = S.g.plan.length;
  let r = M.simulate(S); assert.equal(r.status, 'down'); assert.match(r.headline, /single fiber: each direction needs its own wavelength/);
  const plan = S.g.plan.map((c, i) => ({ ...c, slotRev: c.slot + 20 })); S.g.plan = plan; // another slot each way
  r = M.simulate(S); assert.equal(r.status, 'up', r.headline); assert.ok(r.channels.every(c => c.status === 'up'));
  S.g.plan = [{ ...plan[0], slot: 30, slotRev: 31, svc: true }, { ...plan[1], slot: 31, slotRev: 32, svc: false }]; // 31 is also the first channel's way back
  r = M.simulate(S); const b = r.channels.find(c => !c.svc); assert.equal(b.status, 'blocked'); assert.match(b.notes[0], /already lit.*single fiber/);
  fib.p.single = false; r = M.simulate(S); assert.ok(r.channels.every(c => c.status === 'up'), 'on two fibers the directions do not collide');
});

test('single fiber: the flags survive sanitize and bad values are dropped', () => {
  const S = build('bidi'); S.nodes.find(n => n.name === 'MUX-A').p.role = 'sideways'; S.nodes.find(n => n.name === 'OADM-B').p.wRole = 5; S.nodes.find(n => n.name === 'TRX-A1').p.rxSlot = 'x';
  S.links.find(l => l.kind === 'patch').p.single = true; S.links.filter(l => l.kind === 'fiber').forEach(l => { l.p.single = 'yes'; });
  const c = M.sanitize(clone(S));
  assert.equal(c.nodes.find(n => n.name === 'MUX-A').p.role, 'low'); assert.equal(c.nodes.find(n => n.name === 'OADM-B').p.wRole, 'high'); assert.equal(c.nodes.find(n => n.name === 'TRX-A1').p.rxSlot, null);
  assert.ok(c.links.every(l => l.p.single === false), 'only a fiber span can be single, and only if true');
  assert.deepEqual(M.sanitizePlan([{ slot: 3, slotRev: 3 }, { slot: 5, slotRev: 9 }, { slot: 7, slotRev: 'x' }], 75).map(x => x.slotRev), [null, 9, null]);
});

const olp = () => M.sanitize(build('olp'));
const fib = (S, km) => S.links.find(l => l.kind === 'fiber' && +l.p.len === km);
test('splitter and switch: the service takes the selected branch, losing the splitter share and the switch loss', () => {
  const S = olp(), r = M.simulate(S), hop = n => r.hops.find(h => h.name === n);
  assert.equal(r.status, 'up'); assert.equal(Math.round(r.km), 60);
  assert.ok(Math.abs(hop('SPL-A').gain + 3.31) < 0.01, `splitter ${hop('SPL-A').gain}`); assert.ok(Math.abs(hop('TAP-A').gain + 0.34) < 0.01);
  assert.equal(hop('SW-Z').gain, -1);
  assert.ok(Math.abs(M.splitLossDb({ p: { ratio: '99/1', excess: 0.3 } }, 'b') - 20.3) < 1e-9);
});

test('optical switch: auto-switching moves to the other branch on a cut, manual leaves it dark', () => {
  const S = olp(); fib(S, 60).p.cut = true;
  let r = M.simulate(S); assert.equal(r.status, 'up'); assert.equal(Math.round(r.km), 80, 'the 80 km fiber now carries it');
  assert.ok(r.hops.find(h => h.name === 'SW-Z').note.includes('switched away'));
  S.nodes.find(n => n.name === 'SW-Z').p.auto = false; r = M.simulate(S); assert.equal(r.status, 'los', 'a manual switch stays on its port');
  S.nodes.find(n => n.name === 'SW-Z').p.pos = 'b'; r = M.simulate(S); assert.equal(r.status, 'up'); assert.equal(Math.round(r.km), 80);
  fib(S, 60).p.cut = false; assert.equal(Math.round(M.simulate(S).km), 80, 'set to port B it uses B');
});

test('splitter: light goes common to branch and back, never branch to branch', () => {
  const mk = (id, ty, p = {}) => ({ id, type: ty, name: id, x: 0, y: 0, p: { ...M.TYPES[ty].def(), ...p } });
  const e = ['ea', 'eb', 'ec'].map(k => mk(k, 'edfa')), sp = mk('sp', 'splitter'), L = (a, b, port) => ({ id: a + b, a, b, kind: 'patch', p: { ...M.linkDefaults('patch'), sb: port } });
  const S = { nodes: [...e, sp], links: [L('ea', 'sp', 'a'), L('eb', 'sp', 'b'), L('ec', 'sp', 'c')], g: {}, svc: {} };
  assert.ok(M.route(S, 'ec', 'ea', true)); assert.ok(M.route(S, 'ea', 'ec', true)); assert.ok(M.route(S, 'ec', 'eb', true));
  assert.equal(M.route(S, 'ea', 'eb', true), null, 'a splitter does not pass branch A to branch B');
  const T = M.sanitize(clone(S)); assert.deepEqual(T.links.map(l => l.p.sb).sort(), ['a', 'b', 'c']);
});

test('optical switch: restoring through an auto switch takes the switch time, not the restoration time', () => {
  const S = olp(); S.g.devRate = 0; const k = S.g.plan ? S.g.plan.findIndex(c => c.svc) : 0, a = M.resilience(S)[Math.max(0, k)];
  assert.ok(a.outageSec < 1, `outage ${a.outageSec} s`);
  S.nodes.find(n => n.name === 'SW-Z').p.auto = false;
  const b = M.resilience(S)[Math.max(0, k)]; assert.ok(b.outageSec > 3600, `a manual switch waits for the repair: ${b.outageSec} s`);
});

test('splitter and switch: settings survive sanitize and bad values are dropped', () => {
  const S = build('olp'); S.nodes.find(n => n.name === 'SPL-A').p.ratio = '13/87'; S.nodes.find(n => n.name === 'SW-Z').p.pos = 'z'; S.nodes.find(n => n.name === 'SW-Z').p.switchMs = 'fast'; S.nodes.find(n => n.name === 'SW-Z').p.auto = 'yes';
  const c = M.sanitize(clone(S)), sp = c.nodes.find(n => n.name === 'SPL-A').p, sw = c.nodes.find(n => n.name === 'SW-Z').p;
  assert.equal(sp.ratio, '50/50'); assert.equal(sw.pos, 'a'); assert.equal(sw.switchMs, 20); assert.equal(sw.auto, true);
});

const odf = () => M.sanitize(build('odf'));
test('patch panel: each mated pair costs its loss, and a dirty connector costs more and raises an alarm', () => {
  const S = odf(), r = M.simulate(S), hop = n => r.hops.find(h => h.name === n);
  assert.equal(r.status, 'degraded'); assert.ok(Math.abs(hop('ODF-A').gain + 0.5) < 1e-9); assert.ok(Math.abs(hop('ODF-B').gain + 2.3) < 1e-9);
  assert.ok(r.alarms.some(a => /ODF-B port 1: a dirty or damaged connector costs 1\.8 dB/.test(a.text)));
  S.nodes.find(n => n.name === 'ODF-B').p.dirty = {};
  const c = M.simulate(S); assert.ok(Math.abs(c.hops.find(h => h.name === 'ODF-B').gain + 0.5) < 1e-9); assert.ok(!c.alarms.some(a => /dirty/.test(a.text)));
  assert.ok(c.qMargin > r.qMargin, 'cleaning it gives margin back');
});

test('patch panel: light enters one side of a port and leaves the other side of the same port', () => {
  const mk = (id, ty, p = {}) => ({ id, type: ty, name: id, x: 0, y: 0, p: { ...M.TYPES[ty].def(), ...p } }), lk = (a, b, side) => ({ id: a + b, a, b, kind: 'patch', p: { ...M.linkDefaults('patch'), sb: side } });
  const e = ['r1', 'f1', 'f2'].map(k => mk('e' + k, 'edfa')), pn = mk('pn', 'panel');
  const S = { nodes: [...e, pn], links: [lk('er1', 'pn', 'r1'), lk('ef1', 'pn', 'f1'), lk('ef2', 'pn', 'f2')], g: {}, svc: {} };
  assert.ok(M.route(S, 'er1', 'ef1', true) && M.route(S, 'ef1', 'er1', true));
  assert.equal(M.route(S, 'er1', 'ef2', true), null, 'rear of port 1 does not reach the front of port 2');
  assert.equal(M.route(S, 'ef1', 'ef2', true), null, 'front to front does not pass');
});

test('patch panel: cables get paired sides by default, and ports and dirty connectors survive sanitize', () => {
  const S = build('odf'), oa = S.nodes.find(n => n.name === 'ODF-A'), ob = S.nodes.find(n => n.name === 'ODF-B');
  S.links.forEach(l => { if (l.a === oa.id || l.b === oa.id) { l.p.sa = ''; l.p.sb = ''; } });
  ob.p.dirty = { 1: 1.8, 99: 3, 2: -1, 3: 'x', 4: 50 }; ob.p.ports = 999;
  const c = M.sanitize(clone(S)), id = c.nodes.find(n => n.name === 'ODF-A').id, sides = c.links.filter(l => l.a === id || l.b === id).map(l => (l.a === id ? l.p.sa : l.p.sb)).sort();
  assert.deepEqual(sides, ['f1', 'r1'], 'the two cables on ODF-A end up on the two sides of port 1');
  const cb = c.nodes.find(n => n.name === 'ODF-B').p; assert.equal(cb.ports, 48); assert.deepEqual(cb.dirty, { 1: 1.8, 4: 10 });
});

test('cabling-defined channels: protection and converters set on the transponders', () => {
  const nm = (S, n) => S.nodes.find(x => x.name === n);
  let S = rp(); nm(S, 'TRX-A2').p.prot = '1+1';
  let d = M.derive(S); const e = d.plan.find(c => !c.filler && !c.svc && c.prot);
  assert.equal(e.prot, '1+1'); assert.equal(d.plan.filter(c => c.prot).length, 1);
  let r = M.simulate(S); const ch = r.channels[r.derived.plan.indexOf(r.derived.plan.find(c => c.prot))];
  assert.ok(ch.protection, 'the derived channel has a protection copy'); assert.equal(ch.protection.active, 'work');
  // a cut on the working route switches it
  const direct = S.links.find(l => l.kind === 'fiber' && Math.round(l.p.len) === 80 && [l.a, l.b].includes(nm(S, 'ROADM-A').id) && [l.a, l.b].includes(nm(S, 'ROADM-B').id));
  direct.p.cut = true; r = M.simulate(S); const ch2 = r.channels[r.derived.plan.indexOf(r.derived.plan.find(c => c.prot))];
  assert.equal(ch2.protection.active, 'protect');
  // a converter: the partners are in different slots and the plan says so
  S = rp(); nm(S, 'TRX-B2').p.slot = 32; nm(S, 'TRX-C2').p.slot = 31; // ROADM ports are colorless, so tuning decides the slot
  const cs = M.sanitize(clone(S)); const C2 = nm(cs, 'TRX-C2'), B2 = nm(cs, 'TRX-B2'); C2.p.conv = nm(cs, 'ROADM-A').id; C2.p.peer = B2.p.peer = '';
  assert.match(M.derive(cs).dark.find(x => x.name === 'TRX-C2').why, /Connect to/, 'a converter without a named partner is explained');
  C2.p.peer = B2.id; B2.p.peer = C2.id; d = M.derive(cs);
  const cv = d.plan.find(c => c.conv); assert.ok(cv, 'paired across slots'); assert.equal(cv.slot !== cv.slot2, true); assert.equal(cv.conv, nm(cs, 'ROADM-A').id);
  r = M.simulate(cs); const rc = r.channels[r.derived.plan.indexOf(r.derived.plan.find(c => c.conv))];
  assert.ok(rc.converted, 'simulated as two halves'); assert.equal(rc.segments.length, 2);
  // the service cannot be converted
  const s2 = rp(); nm(s2, 'TRX-A1').p.conv = nm(s2, 'ROADM-B').id; nm(s2, 'TRX-A1').p.peer = nm(s2, 'TRX-C1').id; nm(s2, 'TRX-C1').p.peer = nm(s2, 'TRX-A1').id; const d2 = M.derive(s2);
  assert.ok(d2.notes.length && d2.plan.find(c => c.svc).conv === '');
  // untrusted values are cleaned
  const bad = rp(); nm(bad, 'TRX-A2').p.prot = 'x'; nm(bad, 'TRX-A2').p.conv = nm(bad, 'TRX-B1').id;
  const sc = M.sanitize(clone(bad)); assert.equal(nm(sc, 'TRX-A2').p.prot, ''); assert.equal(nm(sc, 'TRX-A2').p.conv, '');
});

test('Protection and a converter on cabled channels scenario is clean and has both features', () => {
  const S = M.sanitize(build('cabprot')), r = M.simulate(S);
  assert.equal(r.status, 'up'); assert.equal(M.derive(S).dark.length, 0);
  const d = r.derived.plan, real = d.filter(c => !c.filler);
  assert.ok(real.some(c => c.prot === '1+1') && real.some(c => c.conv));
  assert.ok(r.channels.every((c, i) => d[i].filler || c.status === 'up'));
});

test('1310 nm client ports and the 1510 nm supervisory channel', () => {
  const S = M.sanitize(build('osc')), nm = (X, n) => X.nodes.find(x => x.name === n), r = M.simulate(S), B = r.b1310, O = r.osc;
  // 1310 nm client: 15 km at 0.35 dB/km + two 0.6 dB couplers + panel 0.5 dB + dirty 1.5 dB, from the optic's launch power
  const l12 = B.links.find(l => l.aName === 'OADM-1' && l.bName === 'OADM-2');
  assert.ok(Math.abs(l12.loss - (15 * 0.35 + 1.2 + 0.5 + 1.5)) < 1e-9); assert.ok(Math.abs(l12.rx - (-3 - l12.loss)) < 1e-9); assert.equal(l12.status, 'warn');
  assert.ok(B.links.some(l => l.aName === 'OADM-3' && l.status === 'blocked' && /AMP-C/.test(l.why)), 'an amplifier blocks 1310 nm');
  // the OSC at 1510 nm: the amplifiers regenerate it, so the sites form one domain; a mux ends the chain
  const s12 = O.links.find(l => l.aName === 'OADM-1' && l.bName === 'OADM-2');
  assert.ok(Math.abs(s12.loss - (15 * 0.25 + 2 + 0.5 + 1.5)) < 1e-9); assert.equal(s12.status, 'up');
  assert.deepEqual(O.domains.map(d => d.sort()), [['AMP-C', 'BST-A', 'OADM-1', 'OADM-2', 'OADM-3']]);
  assert.ok(O.links.some(l => l.aName === 'BST-A' && l.status === 'blocked' && /MUX-A/.test(l.why)));
  assert.ok(!r.alarms.some(a => /supervisory/.test(a.text)), 'a healthy OSC raises no alarm');
  // a dead amplifier breaks the chain; a long span goes down; a cut fiber does too
  const d = clone(S); nm(d, 'AMP-C').p.fail = 'dead'; const rd = M.simulate(d);
  assert.equal(rd.osc.domains.length, 2); assert.ok(rd.alarms.some(a => /2 management domains/.test(a.text)));
  const lg = clone(S); lg.links.find(l => l.kind === 'fiber' && l.p.len === 40).p.len = 120; const rl = M.simulate(lg);
  assert.equal(rl.osc.links.find(l => l.aName === 'OADM-2' && l.bName === 'AMP-C').status, 'down'); assert.ok(rl.alarms.some(a => /span OADM-2 to AMP-C is down/.test(a.text)));
  const k = clone(S); k.links.find(l => l.kind === 'fiber' && l.p.len === 8).p.cut = true; assert.ok(M.simulate(k).osc.links.some(l => l.aName === 'OADM-1' && l.status === 'blocked' && /is cut/.test(l.why)));
  // clean the connector: more margin on the 1310 nm link; mismatched optics are down
  const c = clone(S); nm(c, 'ODF-1').p.dirty = {}; assert.ok(M.simulate(c).b1310.links.find(l => l.bName === 'OADM-2').margin > l12.margin + 1.4);
  const m = clone(S); nm(m, 'OADM-2').p.o1310 = '25g-lr'; assert.match(M.simulate(m).b1310.links.find(l => l.bName === 'OADM-2').why, /do not match/);
  // sanitize: only 1310 nm optics; an older lab with o1310 'osc' becomes an OSC
  const bad = clone(S); nm(bad, 'OADM-1').p.o1310 = '10g-er'; assert.equal(nm(M.sanitize(bad), 'OADM-1').p.o1310, '10g-lr');
  const old = clone(S); const o = nm(old, 'OADM-1'); o.p.osc = false; o.p.p1310 = true; o.p.o1310 = 'osc'; const oo = nm(M.sanitize(old), 'OADM-1'); assert.equal(oo.p.osc, true); assert.equal(oo.p.p1310, false);
  const none = clone(S); none.nodes.filter(n => n.type === 'oadm').forEach(n => { n.p.osc = false; n.p.p1310 = false; }); assert.equal(M.simulate(none).osc, undefined);
});

test('overloads: amplifier input, OSC and 1310 nm receivers alert and show on the hop', () => {
  const S = M.sanitize(build('osc')), nm = (X, n) => X.nodes.find(x => x.name === n);
  assert.ok(!M.simulate(S).alarms.some(a => /overload/i.test(a.text)), 'the scenario starts without overloads');
  // lower AMP-C's input limit below what it receives
  const h0 = M.simulate(S).hops.find(x => x.name === 'AMP-C'), tot = h0.in.sig + 10 * Math.log10(h0.nch);
  let o = clone(S); nm(o, 'AMP-C').p.pinMax = tot - 1; let r = M.simulate(o);
  const h = r.hops.find(x => x.name === 'AMP-C'); assert.ok(h.over > 0, 'the hop is marked'); assert.match(h.note, /Input overload/);
  assert.ok(r.alarms.some(a => /AMP-C: Input overload.*Add a pad/.test(a.text)));
  const bad = r.alarms.find(a => /AMP-C: Input overload/.test(a.text)); o.nodes.find(n => n.name === 'AMP-C').p.pinMax = tot - 5; r = M.simulate(o);
  assert.equal(r.alarms.find(a => /AMP-C: Input overload/.test(a.text)).sev, 'bad', 'well over the limit is a severe alarm'); assert.ok(bad);
  o = clone(S); nm(o, 'AMP-C').p.pinMax = 100; assert.equal(nm(M.sanitize(o), 'AMP-C').p.pinMax <= 20, true, 'the limit is clamped');
  // a short OSC span overloads its receiver: -3 dBm launch over 0.1 km and two 1 dB filters is -5.1 dBm, above the -8 dBm limit
  const t = clone(S); t.links.find(l => l.kind === 'fiber' && l.p.len === 20 && nm(t, 'BST-A') && [l.a, l.b].includes(nm(t, 'BST-A').id)).p.len = 0.1; const rt = M.simulate(t);
  const sp = rt.osc.links.find(l => l.aName === 'BST-A' && l.bName === 'OADM-1');
  assert.equal(sp.status, 'warn'); assert.match(sp.why, /overload point.*pad/); assert.ok(rt.alarms.some(a => /supervisory channel span BST-A to OADM-1 is overloaded/.test(a.text)));
  // a 1310 nm client that overloads: 25GBASE-ER launches 0 dBm but its receiver overloads at -3 dBm, so a short path with only the couplers' loss is over
  const c = clone(S); nm(c, 'OADM-1').p.o1310 = nm(c, 'OADM-2').p.o1310 = '25g-er'; c.links.find(l => l.kind === 'fiber' && l.p.len === 8).p.len = 0.1; c.links.find(l => l.kind === 'fiber' && l.p.len === 7).p.len = 0.1; nm(c, 'ODF-1').p.il = 0; nm(c, 'ODF-1').p.dirty = {};
  const rc = M.simulate(c), l = rc.b1310.links.find(x => x.bName === 'OADM-2');
  assert.equal(l.status, 'warn'); assert.match(l.why, /overload point.*pad/); assert.ok(rc.alarms.some(a => /1310 nm link OADM-1 to OADM-2 is overloaded/.test(a.text)));
});

test('OTDR and power meter at a patch panel', () => {
  const S = M.sanitize(build('otdr')), nm = (X, n) => X.nodes.find(x => x.name === n), ot = nm(S, 'OTDR-1');
  let t = M.otdrTrace(S, ot.id), att = PHY.FIBERS.smf.att * 1.1;
  assert.match(t.endWhy, /PRE-B/); assert.ok(Math.abs(t.endKm - 60.003) < 1e-6);
  // 0.5 dB at ODF-A, 60 km of fiber at 1625 nm, 1 dB joint, ODF-B 0.5 + 1.8 dirty, the patch cord 0.5
  assert.ok(Math.abs(t.loss - (0.5 + 60 * att + 1 + 0.5 + 1.8 + 0.5)) < 1e-6, 'the trace adds up the events and the slope');
  assert.ok(t.events.some(e => /ODF-B port 1/.test(e.name) && e.refl === -30), 'the dirty connector reflects more');
  assert.ok(t.events.filter(e => /merged/.test(e.note || '')).length >= 1, 'close events merge inside the dead zone at 300 ns');
  // a shorter pulse resolves the 3 m patch cord from the panel but runs out of range on 60 km
  nm(S, 'OTDR-1').p.pulse = 10; t = M.otdrTrace(S, ot.id); assert.match(t.endWhy, /noise/); assert.ok(t.endKm >= 40 && t.endKm < 60);
  nm(S, 'OTDR-1').p.pulse = 1000; t = M.otdrTrace(S, ot.id); assert.ok(t.dz > 0.1);
  // a cut shows as a break at its position; the default is halfway
  const c = clone(S); const fib = c.links.find(l => l.kind === 'fiber'); fib.p.cut = true; fib.p.cutAt = 20;
  t = M.otdrTrace(c, c.nodes.find(n => n.type === 'otdr').id); const br = t.events.find(e => e.kind === 'break');
  assert.ok(Math.abs(br.km - 20) < 1e-6); assert.match(t.endWhy, /cut 20\.0 km/);
  fib.p.cutAt = ''; t = M.otdrTrace(c, c.nodes.find(n => n.type === 'otdr').id); assert.ok(Math.abs(t.events.find(e => e.kind === 'break').km - 30) < 1e-6);
  // an OTDR on an amplifier is not allowed to be cabled there (sanitize drops it); an unplugged one says so
  const bad = clone(S); bad.links.push({ id: 'zz', a: ot.id, b: nm(bad, 'BST-A').id, kind: 'patch', p: {} }); assert.equal(M.sanitize(bad).links.length, S.links.length, 'one cable and only to a test point');
  const lone = clone(S); lone.links = lone.links.filter(l => l.a !== ot.id && l.b !== ot.id); assert.match(M.otdrTrace(lone, ot.id).endWhy, /not plugged/);
  // the power meter reads the light at its test point, and the dirty connector shows in the reading
  const r = M.simulate(S), pm = r.meters[nm(S, 'PM-1').id];
  const hop = r.hops.find(h => h.name === 'ODF-B'); assert.equal(pm.status, 'ok'); assert.ok(Math.abs(pm.dbm - (hop.out.sig + 10 * Math.log10(hop.nch))) < 1e-9);
  assert.ok(Math.abs(pm.perCh - hop.out.sig) < 1e-9);
  // on the booster side of ODF-A the light is above the meter's range: it reads OVER
  const o = clone(S); const l = o.links.find(x => x.a === nm(o, 'PM-1').id || x.b === nm(o, 'PM-1').id); l.a === nm(o, 'PM-1').id ? l.b = nm(o, 'ODF-A').id : l.a = nm(o, 'ODF-A').id; l.p.sa = l.p.sb = 'f1';
  const ro = M.simulate(M.sanitize(o)), po = Object.values(ro.meters)[0]; assert.equal(po.status, 'over'); assert.ok(po.dbm > M.METER.max);
  // a port the service light does not pass reads nothing
  l.p.sa = l.p.sb = 'f5'; assert.equal(Object.values(M.simulate(M.sanitize(o)).meters)[0].status, 'none');
});

test('headlines and alarms say what is wrong and what to do', () => {
  // a degraded service names its first problem instead of "alarms to look at"
  const S = M.sanitize(build('odf')), r = M.simulate(S);
  assert.equal(r.status, 'degraded'); assert.match(r.headline, /ODF-B port 1: a dirty or damaged connector costs 1\.8 dB extra\. Clean it\./); assert.doesNotMatch(r.headline, /alarms to look at/);
  // a cut gives LOS with a fix, in the headline and as an alarm (the alarm list used to be empty)
  const c = M.sanitize(build('lh')); const fib = c.links.filter(l => l.kind === 'fiber')[2]; fib.p.cut = true; const rc = M.simulate(c);
  assert.equal(rc.status, 'los'); assert.match(rc.headline, /fiber cut on .*Splice it back, or add a second route/);
  assert.ok(rc.alarms.some(a => a.sev === 'bad' && /is cut, so no light reaches .*Splice it back.*second fiber route/.test(a.text)));
  // a failed device says how to get round it
  const d = M.sanitize(build('lh')); d.nodes.find(n => n.type === 'edfa' && n.name !== 'BST-A' && n.name !== 'PRE-B').p.fail = 'dead'; const rd = M.simulate(d);
  assert.equal(rd.status, 'los'); assert.match(rd.headline, /has failed\. Replace it, or give the service a route around it/); assert.ok(rd.alarms.some(a => a.sev === 'bad' && /Set it back to Working/.test(a.text)));
});

test('results panel reads in order: status, diagnosis, evidence', () => {
  const fs = require('node:fs'), shell = fs.readFileSync(require('node:path').join(__dirname, '../src/shell.html'), 'utf8');
  const at = id => shell.indexOf(`id="${id}"`);
  assert.ok(at('headline') < at('alarms') && at('alarms') < at('kpis') && at('kpis') < at('diag') && at('diag') < at('tabs'), 'alarms come before the KPI cards');
});

test('a cut the service survives is explained: the detour, its cost and the old route', () => {
  const S = M.sanitize(build('ring')), r0 = M.simulate(S);
  assert.equal(r0.restored, undefined, 'nothing to explain while the lab is intact'); assert.doesNotMatch(r0.headline, /restored/);
  const fib = S.links.filter(l => l.kind === 'fiber').find(l => r0.path.links.includes(l.id)); fib.p.cut = true;
  const r = M.simulate(S);
  assert.equal(r.status, 'up'); assert.ok(r.km > r0.km, 'the detour is longer');
  assert.match(r.headline, /restored over ROADM-B after ROADM-A–ROADM-C is cut: \+140\.0 km, −[\d.]+ dB margin/);
  const a = r.alarms[0]; assert.equal(a.sev, 'info'); assert.match(a.text, /^Splice the fiber back to return to the original route/); assert.doesNotMatch(a.text, /140/, 'the headline carries the cost; the alarm does not repeat it');
  assert.deepEqual(new Set(r.restored.links), new Set(r0.path.links), 'the ghost is the original route');
  // a failed device that is routed around gets the same story, and with no spare route it is the LOS message, not this one
  const d = M.sanitize(build('ring')); d.nodes.find(n => n.name === 'ROADM-C').p.fail = 'dead'; const rd = M.simulate(d);
  if (rd.status !== 'los' && rd.restored) assert.match(rd.restored.short, /ROADM-C has failed|is cut/);
  const dead = M.sanitize(build('lh')); dead.links.filter(l => l.kind === 'fiber')[2].p.cut = true; const rl = M.simulate(dead);
  assert.equal(rl.status, 'los'); assert.equal(rl.restored, undefined);
});

test('alarms offer a one-tap remedy as plain data: splice, set back to Working, clean a port', () => {
  const nm = (X, n) => X.nodes.find(x => x.name === n);
  // a dirty connector: clean that port
  const odf = M.sanitize(build('odf')), ro = M.simulate(odf), pn = nm(odf, 'ODF-B');
  assert.deepEqual(ro.headlineFix, { type: 'clean', id: pn.id, port: 1, label: 'Clean ODF-B port 1' });
  assert.deepEqual(ro.alarms.find(a => a.fix).fix, ro.headlineFix);
  delete pn.p.dirty[1]; const clean = M.simulate(odf); assert.equal(clean.status, 'up'); assert.ok(!clean.headlineFix, 'nothing to offer once it is fixed');
  // a cut: splice that cable
  const lh = M.sanitize(build('lh')), fib = lh.links.filter(l => l.kind === 'fiber')[2]; fib.p.cut = true;
  let r = M.simulate(lh); assert.deepEqual(r.headlineFix, { type: 'splice', id: fib.id, label: 'Splice it back' });
  assert.ok(r.alarms.some(a => a.fix && a.fix.id === fib.id && /Splice it back/.test(a.text)));
  fib.p.cut = false; assert.ok(!M.simulate(lh).headlineFix);
  // a failed service end now has an alarm row and a fix, not just a headline
  const e = M.sanitize(build('lh')); nm(e, 'TRX-Z').p.fail = 'dead'; r = M.simulate(e);
  assert.equal(r.status, 'los'); assert.equal(r.alarms.length, 1); assert.equal(r.headlineFix.type, 'work'); assert.equal(r.headlineFix.id, nm(e, 'TRX-Z').id); assert.match(r.headlineFix.label, /Set TRX-Z back to Working/);
  // a failed device in the middle, and a survived cut on the ring
  const m = M.sanitize(build('lh')); nm(m, 'ILA-2').p.fail = 'dead'; r = M.simulate(m); assert.equal(r.headlineFix.type, 'work'); assert.equal(r.headlineFix.id, nm(m, 'ILA-2').id);
  const ring = M.sanitize(build('ring')), r0 = M.simulate(ring), cutL = ring.links.filter(l => l.kind === 'fiber').find(l => r0.path.links.includes(l.id)); cutL.p.cut = true;
  r = M.simulate(ring); assert.equal(r.headlineFix.type, 'splice'); assert.equal(r.headlineFix.id, cutL.id); assert.match(r.headlineFix.label, /restore the original route/);
});

test('worst channel margin is the worst lit channel in the plan, as the Channels table shows it', () => {
  const S = M.sanitize(build('mix')), r = M.simulate(S);
  const table = Math.min(...r.channels.filter(c => (c.status === 'up' || c.status === 'degraded') && Number.isFinite(c.qMargin)).map(c => c.qMargin));
  assert.ok(Math.abs(r.worstChannelQ - table) < 1e-9);
  assert.ok(r.worstQMargin > r.worstChannelQ + 3, 'the SRS-tilt edge slot of the service mode is a different (higher) number in a mixed line');
  const u = M.sanitize(uniform('dci')); assert.equal(M.simulate(u).worstChannelQ, undefined, 'a uniform line has no plan; the tilt-edge slot is the worst channel');
});

test('a remedy can be carried out on the lab: splice, work, clean and an amplifier in a too-long span', () => {
  const nm = (X, n) => X.nodes.find(x => x.name === n);
  // the first link a student builds: two transponders on an 80 km fiber is LOS, and the remedy is an amplifier halfway
  const a = { id: 'na', type: 'trx', name: 'TRX-1', x: 100, y: 200, p: M.TYPES.trx.def() }, z = { id: 'nz', type: 'trx', name: 'TRX-2', x: 500, y: 200, p: M.TYPES.trx.def() };
  const S = M.sanitize({ nodes: [a, z], links: [{ id: 'l1', a: 'na', b: 'nz', kind: 'fiber', p: M.linkDefaults('fiber') }], g: { nch: 1, df: 75, launch: 0 }, svc: { a: 'na', z: 'nz' } });
  let r = M.simulate(S); assert.equal(r.status, 'los'); assert.deepEqual(r.headlineFix, { type: 'insertAmp', id: 'l1', label: 'Add an amplifier halfway along TRX-1–TRX-2' });
  assert.ok(r.alarms.find(x => x.fix && x.fix.type === 'insertAmp'));
  assert.match(M.applyFix(S, r.headlineFix), /^Added AMP-1 halfway along TRX-1–TRX-2$/);
  assert.equal(S.nodes.length, 3); assert.deepEqual(S.links.map(l => +l.p.len), [40, 40], 'the span is split in two halves'); assert.equal(nm(S, 'AMP-1').x, 300);
  r = M.simulate(S); assert.equal(r.status, 'up'); assert.ok(!r.headlineFix, 'nothing more to offer once it works');
  // the other remedies change the lab and say what they did, and do nothing once they no longer apply
  const lh = M.sanitize(build('lh')), fib = lh.links.filter(l => l.kind === 'fiber')[2]; fib.p.cut = true;
  assert.equal(M.applyFix(lh, { type: 'splice', id: fib.id }), 'Spliced the fiber back'); assert.equal(fib.p.cut, false); assert.equal(M.applyFix(lh, { type: 'splice', id: fib.id }), '');
  const ila = nm(lh, 'ILA-2'); ila.p.fail = 'dead'; assert.match(M.applyFix(lh, { type: 'work', id: ila.id }), /ILA-2 is working again/); assert.equal(ila.p.fail, '');
  const odf = M.sanitize(build('odf')), pn = nm(odf, 'ODF-B'); assert.match(M.applyFix(odf, { type: 'clean', id: pn.id, port: 1 }), /Cleaned ODF-B port 1/); assert.equal(pn.p.dirty[1], undefined);
  assert.equal(M.applyFix(lh, null), ''); assert.equal(M.applyFix(lh, { type: 'insertAmp', id: 'nope' }), '');
  // a receiver below its sensitivity spec but not lost also offers the amplifier
  const long = M.sanitize({ nodes: [a, z], links: [{ id: 'l1', a: 'na', b: 'nz', kind: 'fiber', p: { ...M.linkDefaults('fiber'), len: 52 } }], g: { nch: 1, df: 75, launch: 0 }, svc: { a: 'na', z: 'nz' } });
  const rl = M.simulate(long); if (rl.status !== 'los') assert.ok(rl.alarms.some(x => /Rx LOW/.test(x.text) && x.fix && x.fix.type === 'insertAmp'));
});

test('distributed Raman noise: the integral matches the lumped figure for a uniform gain, vanishes without gain, and grows with temperature', () => {
  const P = require('../src/engine.js'), L = 20, g = 0.3, z = Array.from({ length: 61 }, (_, k) => L * k / 60), S = z.map(x => 1e-3 * Math.exp(g * x)), G = Math.exp(g * L);
  const ase = P.ramanAseN({ att: 0, gamma: 1.3 }, 193.4, { z, sig: [S] }, 0, 13.2, 300);
  assert.ok(Math.abs(ase / (2 * P.nspRaman(13.2, 300) * (G - 1)) - 1) < 0.01, 'a uniform gain gives 2 n_sp (G - 1), the lumped amplifier figure');
  const loss = z.map(x => 1e-3 * Math.exp(-0.2 / 4.343 * x)); assert.ok(P.ramanAseN({ att: 0.2, gamma: 1.3 }, 193.4, { z, sig: [loss] }, 0, 13.2, 300) < 1e-6, 'a passive fiber adds none');
  assert.ok(P.nspRaman(13.2, 350) > P.nspRaman(13.2, 300) && P.nspRaman(13.2, 300) > P.nspRaman(13.2, 250)); assert.ok(Math.abs(P.nspRaman(13.2, 0.001) - 1) < 1e-6, 'only the quantum term is left at 0 K');
  assert.ok(Math.abs(P.nspRaman(13.2, 300) - 1.138) < 0.005);
  // in a span: the solver's distributed noise replaces the equivalent lumped amplifier, stays within a couple of dB of it, and follows the temperature
  const span = (o, t) => { const p = M.PRESETS.dci.build(), X = M.sanitize({ nodes: p.nodes, links: p.links, g: { ...p.g, tempC: t ?? 27 }, svc: p.svc }), f = X.links.find(l => l.kind === 'fiber'); f.p.len = 110; Object.assign(f.p, o); return M.simulate(X); };
  const off = span({}), lumped = span({ raman: 600, ramanFull: false }), dist = span({ raman: 600, ramanFull: true });
  assert.ok(dist.osnr > off.osnr + 1, 'a 600 mW backward pump still buys OSNR with the distributed noise'); assert.ok(Math.abs(dist.osnr - lumped.osnr) < 2.5, 'and agrees with the equivalent lumped amplifier to within about two dB');
  assert.match(dist.hops.find(h => /Raman/.test(h.note || '')).note, /distributed noise: the span's effective noise figure is [\d.]+ dB/); assert.ok(!/distributed noise/.test(lumped.hops.find(h => /Raman/.test(h.note || '')).note), 'the closed-form model keeps the lumped noise');
  assert.ok(span({ raman: 600, ramanFull: true }, -40).osnr > span({ raman: 600, ramanFull: true }, 85).osnr, 'a warmer fiber is noisier');
  const fw = span({ raman: 600, ramanDir: 'fwd', ramanFull: true }), bw = span({ raman: 600, ramanDir: 'back', ramanFull: true });
  const nf = r => +/effective noise figure is ([\d.-]+)/.exec(r.hops.find(h => /Raman/.test(h.note || '')).note)[1]; assert.ok(nf(fw) < nf(bw), 'forward pumping has the lower span noise figure: the gain comes before most of the loss');
  assert.equal(M.sanitize({ nodes: [], links: [], g: { tempC: 999 } }).g.tempC, 85); assert.equal(M.sanitize({ nodes: [], links: [], g: { tempC: 'x' } }).g.tempC, 27);
});

test('revertive switching: failover is reported, a revertive switch hits twice per cut, a non-revertive one is told to stay put', () => {
  const mk = rev => { const S = M.sanitize(build('olp')), sw = S.nodes.find(n => n.type === 'switch'); sw.p.revertive = rev; return { S, sw }; };
  // defaults and sanitising
  const d = M.TYPES.switch.def(); assert.equal(d.revertive, true); assert.equal(d.wtrMin, 5);
  const bad = mk(true); bad.sw.p.wtrMin = 9999; bad.sw.p.revertive = 'maybe'; const cl = M.sanitize(clone(bad.S)).nodes.find(n => n.type === 'switch'); assert.equal(cl.p.wtrMin, 120); assert.equal(cl.p.revertive, true);
  bad.sw.p.wtrMin = 'x'; assert.equal(M.sanitize(clone(bad.S)).nodes.find(n => n.type === 'switch').p.wtrMin, 5);
  // intact: nothing to report, and the selected port is used even though the other branch is the shorter one
  const { S, sw } = mk(true); let r = M.simulate(S); assert.deepEqual(r.failovers, []); assert.equal(r.status, 'up');
  const fib = S.links.filter(l => l.kind === 'fiber'), working = fib.find(l => r.path.links.includes(l.id)); assert.equal(working.p.len, 60, 'the working branch is the 60 km one');
  const short = M.sanitize(clone(S)); short.links.filter(l => l.kind === 'fiber').find(l => !r.path.links.includes(l.id)).p.len = 5; assert.ok(M.simulate(short).path.links.includes(working.id), 'a much shorter protection branch is not used while the selected port is fine');
  // a cut on the working branch: the switch rides the other port and says so, with the revert story
  working.p.cut = true; r = M.simulate(S); assert.equal(r.status, 'up'); assert.equal(r.failovers.length, 1); assert.deepEqual([r.failovers[0].from, r.failovers[0].to, r.failovers[0].revertive], ['a', 'b', true]);
  assert.ok(r.alarms.some(a => /SW-Z moved from port A to port B.*goes back to port A after the repair and 5 min of stable light/.test(a.text)));
  const nr = mk(false); nr.S.links.filter(l => l.kind === 'fiber').find(l => l.p.len === 60).p.cut = true; const rn = M.simulate(nr.S);
  assert.equal(rn.failovers[0].revertive, false); assert.ok(rn.alarms.some(a => /stays on port B after the repair \(non-revertive\)/.test(a.text)));
  // moving the position to the port it failed over to (what the app does for a non-revertive switch) makes the failover go away, and it survives the splice
  nr.sw.p.pos = 'b'; assert.deepEqual(M.simulate(nr.S).failovers, []); nr.S.links.forEach(l => { l.p.cut = false; }); const spliced = M.simulate(nr.S); assert.deepEqual(spliced.failovers, []); assert.ok(spliced.path.links.includes(nr.S.links.filter(l => l.kind === 'fiber').find(l => l.p.len === 80).id), 'still on the 80 km protection branch after the repair');
  // availability: a revertive switch costs one more switch time per cut
  const a = M.resilience(mk(true).S)[0], b = M.resilience(mk(false).S)[0], lam = 3 * 60 / 1000;
  assert.ok(Math.abs((a.downSec - b.downSec) - lam * 0.020) < 1e-9, 'one extra 20 ms hit per cut');
});

test('a degraded port hurts only its own channel: add side costs power and OSNR, drop side power only', () => {
  const S = M.sanitize(build('mix')), r0 = M.simulate(S), slot = S.g.plan.find(c => !c.svc).slot;
  const base = r0.channels.find(c => c.slot === slot);
  const mA = S.nodes.find(n => n.name === 'MUX-A'), mB = S.nodes.find(n => n.name === 'MUX-B');
  const moved = r => r.channels.filter((c, i) => Math.abs(c.prx - r0.channels[i].prx) > 0.01 || Math.abs(c.gosnr - r0.channels[i].gosnr) > 0.01).map(c => c.slot);
  mA.p.degPorts = { [slot]: 4 };
  const ra = M.simulate(S), ca = ra.channels.find(c => c.slot === slot);
  assert.deepEqual(moved(ra), [slot], 'no other channel moves');
  assert.ok(Math.abs(ca.prx - base.prx + 4) < 0.01, 'the add side survives re-levelling: Rx falls by the full 4 dB');
  assert.ok(ca.gosnr < base.gosnr - 0.5, 'and its OSNR falls');
  assert.ok(ra.alarms.some(a => a.fix && a.fix.type === 'repairPort'), 'an alarm offers a replacement port');
  mA.p.degPorts = {}; mB.p.degPorts = { [slot]: 4 };
  const rb = M.simulate(S), cb = rb.channels.find(c => c.slot === slot);
  assert.ok(Math.abs(cb.prx - base.prx + 4) < 0.01);
  assert.ok(Math.abs(cb.gosnr - base.gosnr) < 0.01, 'a drop-side loss leaves the OSNR alone');
  const fix = rb.alarms.find(a => a.fix && a.fix.type === 'repairPort').fix;
  M.applyFix(S, fix);
  assert.deepEqual(mB.p.degPorts, {});
});

test('degPorts is sanitised: junk and non-positive values are dropped, loss is capped', () => {
  const S = build('mix'), mb = S.nodes.find(n => n.name === 'MUX-B');
  mb.p.degPorts = { 3: 2, '-1': 5, 200: 1, x: 2, 4: 0, 5: true, 6: 99 };
  assert.deepEqual(M.sanitize(clone(S)).nodes.find(n => n.name === 'MUX-B').p.degPorts, { 3: 2, 6: 30 });
});

test('connector reflections: two reflectors with an amplifier between them make multipath noise, an APC polish cures it', () => {
  const S = M.sanitize(build('odf')), A = S.nodes.find(n => n.name === 'ODF-A'), B = S.nodes.find(n => n.name === 'ODF-B');
  const fiber = S.links.find(l => l.kind === 'fiber' && ((l.a === A.id && l.b === B.id) || (l.a === B.id && l.b === A.id)));
  const r0 = M.simulate(S);
  assert.ok(r0.reflection && r0.reflection.x < -60, 'clean UPC connectors across a lossy span: negligible');
  assert.ok(!r0.alarms.some(a => /Reflections between/.test(a.text)));
  assert.equal(M.sanitize({ ...clone(S), nodes: S.nodes.map(n => n === A ? { ...n, p: { ...n.p, rl: 'x' } } : n) }).nodes.find(n => n.name === 'ODF-A').p.rl, 50);
  A.p.rl = 25; B.p.rl = 25; A.p.dirty = { 1: 1 }; B.p.dirty = { 1: 1 };
  fiber.p.len = 1;
  M.applyFix(S, { type: 'insertAmp', id: fiber.id });
  const amp = S.nodes[S.nodes.length - 1]; amp.p.ctl = 'gain'; amp.p.gain = 15; amp.p.gmax = 30;
  const bad = M.simulate(S), x = bad.reflection.x;
  assert.ok(x > -30, 'an amplifier with gain between two poor connectors lifts the double reflection: ' + x);
  assert.ok(bad.alarms.some(a => /Reflections between/.test(a.text)));
  A.p.rl = 65; B.p.rl = 65; A.p.dirty = {}; B.p.dirty = {};
  const good = M.simulate(S);
  assert.ok(good.gosnr > bad.gosnr, 'the multipath noise costs OSNR');
  assert.ok(good.reflection.x < x - 40 && !good.alarms.some(a => /Reflections between/.test(a.text)));
});

test('patch cord length: default 3 m, sanitised, and it counts in latency, loss and the OTDR distance', () => {
  const S = M.sanitize(build('otdr')), cords = S.links.filter(l => l.kind === 'patch');
  assert.ok(cords.every(l => l.p.len === 3));
  const odd = clone(S), oc = odd.links.filter(l => l.kind === 'patch'); assert.ok(oc.length >= 1);
  for (const [v, want] of [[-5, 3], ['x', 3], [true, 3], [99999, 2000], [12, 12]]) { oc[0].p.len = v; assert.equal(M.sanitize(clone(odd)).links.find(l => l.id === oc[0].id).p.len, want, String(v)); }
  const R = M.sanitize(build('reach')), lat = () => hostPair(R, 'HOST-A1', 'HOST-B1');
  const l0 = lat().latencyUs; let hit = 0;
  for (const cord of R.links.filter(l => l.kind === 'patch')) { cord.p.len = 1003; const d = lat().latencyUs - l0; cord.p.len = 3; if (Math.abs(d - 4.9) < 1e-6) hit++; }
  assert.ok(hit >= 2, 'every cord on the path adds 4.9 us for a kilometre more of glass');
});

test('planner: a protected demand lights a fiber-disjoint second route and loads both', () => {
  const S = build('mesh'), { ra, rb, rc } = meshIds(S); S.g.df = 150;
  const r = M.planDemands(S, [{ a: ra, z: rb, mode: 'zrp400', count: 2, prot: '1+1' }, { a: ra, z: rc, mode: 'zrp400', count: 1 }]);
  assert.equal(r.stats.protected, 2); assert.equal(r.stats.unprotected, 0);
  assert.deepEqual(r.results.slice(0, 2).map(x => x.route.join('>') + ' | ' + x.protRoute.join('>')), Array(2).fill('ROADM-A>ROADM-B | ROADM-A>ROADM-C>ROADM-B'));
  assert.deepEqual(r.entries.map(e => e.prot), ['1+1', '1+1', '']);
  assert.equal(r.results[0].protKm, 180);
  assert.equal(r.results[2].slot, 2, 'the protection copies already hold slots 0 and 1 on A-C');
  // with no disjoint route the demand is carried unprotected and says so
  const T = build('mesh'), t = meshIds(T); T.g.df = 150;
  T.links = T.links.filter(l => !(l.kind === 'fiber' && [l.a, l.b].includes(t.rc))); // C is cut off: A-B has no second route
  const u = M.planDemands(T, [{ a: t.ra, z: t.rb, mode: 'zrp400', count: 1, prot: '1+1' }]);
  assert.equal(u.stats.unprotected, 1); assert.equal(u.results[0].status, 'placed'); assert.equal(u.entries[0].prot, '');
  assert.equal(M.sanitize({ ...clone(S), demands: [{ a: ra, z: rb, mode: 'zrp400', count: 1, prot: 'x' }] }).demands[0].prot, '');
  assert.equal(M.sanitize({ ...clone(S), demands: [{ a: ra, z: rb, mode: 'zrp400', count: 1, prot: '1+1' }] }).demands[0].prot, '1+1');
});

test('planner: a converter relieves wavelength-continuity blocking, each half judged on its own', () => {
  const S = M.sanitize(build('mesh')), { ra, rb, rc } = meshIds(S); S.g.df = 150; const svc0 = S.svc; S.svc = { a: rc, z: rb }; // the planner only needs the service's route and slot
  S.links.find(l => l.kind === 'fiber' && [l.a, l.b].includes(ra) && [l.a, l.b].includes(rb)).p.cut = true; // A-B only through C
  const ds = [{ a: ra, z: rc, mode: 'zrp400', count: 31 }, { a: rc, z: rb, mode: 'zrp400', count: 16 }, { a: ra, z: rb, mode: 'zrp400', count: 1 }];
  const plain = M.planDemands(S, ds), conv = M.planDemands(S, ds, { converters: true });
  assert.equal(plain.stats.blocked, 1, 'no slot is free on both A-C and C-B');
  assert.equal(conv.stats.blocked, 0); assert.equal(conv.stats.converted, 1);
  const last = conv.results[conv.results.length - 1], e = conv.entries[conv.entries.length - 1];
  assert.equal(last.converted, 'ROADM-C'); assert.notEqual(last.slot, last.slot2);
  assert.equal(e.conv, rc); assert.equal(e.slot, last.slot); assert.equal(e.slot2, last.slot2);
  // the entry is a valid plan: the simulator carries it
  S.svc = svc0; S.g.plan = M.sanitizePlan([{ ...S.g.plan.find(c => c.svc), slot: 5, slot2: 5 }, e], +S.g.df);
  const sim = M.simulate(S), ch = sim.channels.find(c => !c.svc);
  assert.ok(ch && ch.status !== 'blocked' && ch.status !== 'los', 'converted channel status ' + (ch && ch.status));
});

test('planner: a launch offset rescues a demand that misses the margin at the nominal power, without hurting its neighbours', () => {
  const S = M.sanitize(build('mesh')), { ra, rb } = meshIds(S), ab = S.links.find(l => l.kind === 'fiber' && [l.a, l.b].includes(ra) && [l.a, l.b].includes(rb));
  const ds = [{ a: ra, z: rb, mode: 'zrp400', count: 3 }];
  assert.ok(M.planDemands(S, ds, { K: 1 }).results.every(x => x.margin == null || Math.abs(x.launchOff || 0) < 1e-9), 'no offsets unless asked');
  const same = M.planDemands(S, ds, { K: 1 }), same2 = M.planDemands(S, ds, { K: 1, launch: true });
  assert.deepEqual(same.results.map(x => x.status), same2.results.map(x => x.status), 'a fine route is left alone');
  assert.ok(same2.entries.every(e => e.off === 0));
  ab.p.extra = 10; // an unusually lossy span: ASE-limited
  const without = M.planDemands(S, ds, { K: 1 }), withL = M.planDemands(S, ds, { K: 1, launch: true });
  assert.equal(without.stats.placed, 0); assert.equal(without.stats.unreachable, 3);
  assert.equal(withL.stats.placed, 3);
  assert.ok(withL.results.every(x => x.launchOff > 0 && x.margin >= 1), 'raised power, margin cleared');
  assert.deepEqual(withL.entries.map(e => e.off), withL.results.map(x => x.launchOff), 'the offset goes into the plan');
  // a lot of channels already on the fiber: raising one more channel would push the others under, so the planner will not
  ab.p.extra = 10.5;
  const crowded = M.planDemands(S, [{ a: ra, z: rb, mode: 'zrp400', count: 2 }], { K: 1, launch: true });
  assert.ok(crowded.results.every(x => x.status !== 'placed' || x.margin >= 1));
  // offsets are applied by the simulator: the first channel's launch offset reaches the plan
  const plan = M.sanitizePlan([{ ...S.g.plan.find(c => c.svc) }, ...withL.entries], +S.g.df);
  assert.ok(plan.filter(c => !c.svc).every(c => c.off > 0));
});

test('planner: a target availability decides the protection, and reports a target nothing can reach', () => {
  const S = M.sanitize(build('mesh')), { ra, rb } = meshIds(S), plan = t => M.planDemands(S, [{ a: ra, z: rb, mode: 'zrp400', count: 1, target: t }]);
  const none = plan(''), loose = plan(99.9), tight = plan(99.999);
  assert.equal(none.results[0].availability, undefined, 'no target, no availability computed');
  assert.ok(loose.results[0].meetsTarget && !loose.results[0].protRoute && loose.entries[0].prot === '', 'restoration already meets 99.9%');
  assert.ok(loose.results[0].availability > 0.999);
  assert.equal(tight.results[0].autoProt, true); assert.ok(tight.results[0].protRoute); assert.equal(tight.entries[0].prot, '1+1');
  assert.equal(tight.stats.autoProt, 1);
  assert.equal(tight.results[0].meetsTarget, false, 'with these repair times and rates even 1+1 cannot reach 99.999%');
  assert.equal(tight.stats.missed, 1);
  assert.ok(tight.results[0].availability >= loose.results[0].availability, 'protection never lowers availability');
  assert.equal(M.sanitize({ ...clone(S), demands: [{ a: ra, z: rb, mode: 'zrp400', count: 1, target: 99.99 }] }).demands[0].target, 99.99);
  for (const bad of [50, 100, 'x', true, -1, null]) assert.equal(M.sanitize({ ...clone(S), demands: [{ a: ra, z: rb, mode: 'zrp400', count: 1, target: bad }] }).demands[0].target, '', String(bad));
});

test('per-channel transients: a cut loses its channels, survivors get an excursion that adds up amplifier by amplifier, bluer channels more', () => {
  const S = M.sanitize(build('mesh')), t = M.channelTransients(S);
  assert.ok(t.cut && t.cutName && t.fibers.length >= 3);
  assert.ok(t.lost.length > 0 && t.rows.length > 0);
  assert.ok(t.rows.every(x => !t.lost.includes(x.slot) || x.svc !== undefined), 'rows are the survivors');
  for (const x of t.rows) assert.ok(Math.abs(x.surgeDb - x.hits.reduce((a, h) => a + h.peakDb, 0)) < 1e-9, 'the excursion is the sum over the amplifiers on its route');
  assert.ok(t.rows.some(x => x.surgeDb > 0.05) && t.rows.every(x => x.prxSurge >= x.prx));
  assert.equal(t.worst.surgeDb, Math.max(...t.rows.map(x => x.surgeDb)));
  // choosing another fiber changes who is lost
  const other = t.fibers.find(f => f.id !== t.cut), t2 = M.channelTransients(S, { cut: other.id });
  assert.equal(t2.cut, other.id); assert.notEqual(t2.cutName, t.cutName); assert.equal(t2.rows.length + t2.lost.length, t.rows.length + t.lost.length, 'the same channels, split differently');
  // a control loop that holds the amplifier completely removes the surge
  const fast = M.sanitize(build('mesh')); fast.g.agcUs = 0; fast.nodes.forEach(n => { if (n.p.agcUs !== undefined) n.p.agcUs = 0; });
  assert.ok(M.channelTransients(fast).rows.every(x => x.surgeDb < 1e-9), 'agc 0 us lets nothing through');
  // tilt: with hole burning off, among channels that see the same amplifiers the bluer one is lifted more
  const T = PHY.TRANSIENT, old = [T.shb, T.tiltPerDb]; T.shb = 0; T.tiltPerDb = 0.5;
  try {
    const r = M.channelTransients(S).rows, sig = x => x.hits.map(h => h.name + h.lost + '/' + h.n).join();
    const grp = r.filter(x => sig(x) === sig(r[0]) && x.hits.length), lo = grp.reduce((a, b) => (a.fTHz < b.fTHz ? a : b)), hi = grp.reduce((a, b) => (a.fTHz > b.fTHz ? a : b));
    assert.ok(grp.length >= 2 && hi.fTHz > lo.fTHz && hi.surgeDb > lo.surgeDb, 'blue end lifted more');
    T.tiltPerDb = 0; const flat = M.channelTransients(S).rows.filter(x => sig(x) === sig(r[0]) && x.hits.length);
    assert.ok(Math.max(...flat.map(x => x.surgeDb)) - Math.min(...flat.map(x => x.surgeDb)) < 1e-9, 'without tilt or hole burning every survivor on the route gets the same');
  } finally { [T.shb, T.tiltPerDb] = old; }
});

test('BiDi amplifier: a one-way EDFA on a single fiber loses the reverse direction, a BiDi one passes both for a filter loss', () => {
  const S = M.sanitize(build('bidi')), fiber = S.links.find(l => l.kind === 'fiber' && l.p.single), base = M.simulate(S);
  assert.equal(base.status, 'up');
  M.applyFix(S, { type: 'insertAmp', id: fiber.id });
  const amp = S.nodes.find(n => n.type === 'edfa');
  assert.equal(amp.p.bidi, true, 'an amplifier inserted on a single fiber is BiDi');
  const ok = M.simulate(S);
  assert.ok(['up', 'degraded'].includes(ok.status), ok.headline); assert.ok(['up', 'degraded'].includes(ok.rev.status), 'both directions pass: ' + ok.rev.headline);
  assert.ok(ok.hops.some(h => h.kind === 'bidi' && /band filters/.test(h.name)), 'the filter hop is in the table');
  const loss = ok.hops.find(h => h.kind === 'bidi'); assert.ok(Math.abs(loss.gain + 1.2) < 1e-9);
  amp.p.bidiLoss = 0; assert.ok(!M.simulate(S).hops.some(h => h.kind === 'bidi'), 'no filter loss, no hop');
  amp.p.bidiLoss = 1.2; amp.p.bidi = false; // a one-way amplifier
  const bad = M.simulate(S);
  assert.equal(bad.rev.status, 'los'); assert.match(bad.rev.headline, /one-way amplifier on a single fiber/);
  assert.ok(bad.rev.alarms.some(a => a.fix && a.fix.type === 'makeBidi'), 'an alarm offers the fix');
  const fix = bad.rev.headlineFix; assert.equal(fix.type, 'makeBidi'); assert.equal(bad.headlineFix && bad.headlineFix.type, 'makeBidi', 'the headline button carries the reverse direction\'s fix');
  M.applyFix(S, fix); assert.equal(amp.p.bidi, true); assert.ok(['up', 'degraded'].includes(M.simulate(S).rev.status));
  // a two-fiber line is untouched: a one-way amplifier is normal there
  const D = M.sanitize(build('dci')); assert.ok(D.nodes.filter(n => n.type === 'edfa').every(n => n.p.bidi === false));
  assert.equal(M.simulate(D).status, 'up'); assert.equal(M.simulate(D).rev.status, 'up');
  assert.equal(M.sanitize({ ...clone(S), nodes: S.nodes.map(n => (n === amp ? { ...n, p: { ...n.p, bidi: 'yes', bidiLoss: 99 } } : n)) }).nodes.find(n => n.id === amp.id).p.bidi, false);
  assert.equal(M.sanitize({ ...clone(S), nodes: S.nodes.map(n => (n === amp ? { ...n, p: { ...n.p, bidiLoss: 99 } } : n)) }).nodes.find(n => n.id === amp.id).p.bidiLoss, 6);
});

test('challenges: each starts unsolved, a known fix solves it, and a shortcut does not', () => {
  assert.equal(M.CHALLENGES.length, new Set(M.CHALLENGES.map(c => c.id)).size, 'ids are unique');
  const by = id => M.CHALLENGES.find(c => c.id === id), fresh = id => M.sanitize(by(id).build());
  const state = (id, S) => M.challengeStatus(by(id), S);
  const named = (S, n) => S.nodes.find(x => x.name === n);
  for (const c of M.CHALLENGES) {
    assert.ok(c.title && c.story && c.answer && c.hints.length >= 2 && c.goals.length >= 1, c.id + ' is complete');
    const S = fresh(c.id), st = state(c.id, S);
    assert.equal(st.done, false, c.id + ' starts broken');
    assert.deepEqual(M.sanitize(c.build()).nodes.length, c.build().nodes.length, c.id + ' survives sanitize');
  }
  // dirty: clean the connector
  let S = fresh('dirty'); M.applyFix(S, M.simulate(S).headlineFix); assert.equal(state('dirty', S).done, true);
  // hot: lower the transmit power (or pad the path)
  S = fresh('hot'); S.nodes.forEach(n => { if (n.type === 'trx') n.p.tx = -8; }); assert.equal(state('hot', S).done, true);
  S = fresh('hot'); S.links[0].p.extra = 8; assert.equal(state('hot', S).done, true, 'extra loss also works');
  // far: an amplifier halfway
  S = fresh('far'); assert.equal(M.simulate(S).headlineFix, undefined, 'no remedy button: the player has to work it out'); M.applyFix(S, { type: 'insertAmp', id: S.links.find(l => l.kind === 'fiber').id }); assert.equal(state('far', S).done, true, M.simulate(S).headline);
  // shortcut: a weaker mode is not the same service
  S = fresh('far'); S.nodes.forEach(n => { if (n.type === 'trx') n.p.mode = 'zr400'; }); assert.equal(state('far', S).goals[1].ok, false, 'changing the mode fails the keep-the-mode goal');
  // onefiber: BiDi amplifier
  S = fresh('onefiber'); M.applyFix(S, M.simulate(S).headlineFix); assert.equal(state('onefiber', S).done, true, M.simulate(S).headline);
  // dispersion: a DCM before the multiplexer
  S = fresh('dispersion'); const pb = named(S, 'PRE-B'), mb = named(S, 'MUX-B'); const dcm = { id: 'dcmx', type: 'dcm', name: 'DCM-B', x: 780, y: 220, p: M.TYPES.dcm.def() };
  const lk = S.links.find(l => l.a === pb.id && l.b === mb.id); S.nodes.push(dcm); lk.b = dcm.id; S.links.push({ id: 'dcml', a: dcm.id, b: mb.id, kind: 'patch', p: { ...lk.p } });
  assert.equal(state('dispersion', S).done, true, M.simulate(S).headline);
  // cut: close the triangle; the same fiber back in place of a cut does not count as a second route
  S = fresh('cut'); const a = named(S, 'ROADM-A'), cc = named(S, 'ROADM-C'); const l0 = S.links.find(l => l.kind === 'fiber');
  assert.equal(state('cut', S).goals[1].ok, false, 'a chain does not survive a cut');
  S.links.push({ id: 'closer', a: a.id, b: cc.id, kind: 'fiber', p: { ...l0.p, len: 70 } }); assert.equal(state('cut', S).done, true);
  // port: replace the degraded port
  S = fresh('port'); M.applyFix(S, M.simulate(S).headlineFix); assert.equal(state('port', S).done, true);
  // launch: back off, but not to nothing-to-gain extremes: 2 dBm works, 5 does not
  S = fresh('launch'); S.g.launch = 2; assert.equal(state('launch', S).done, true); S.g.launch = 5; assert.equal(state('launch', S).done, false);
  // eol: re-splice the span (or amplify); today's margin alone is not enough
  S = fresh('eol'); assert.equal(state('eol', S).goals[0].ok, false); S.links.find(l => l.kind === 'fiber').p.extra = 1; assert.equal(state('eol', S).done, true);
  S = fresh('eol'); M.applyFix(S, { type: 'insertAmp', id: S.links.find(l => l.kind === 'fiber').id }); assert.equal(state('eol', S).done, true, 'an amplifier also works');
  // tilt: gain-tilt control on
  S = fresh('tilt'); assert.equal(state('tilt', S).goals[2].ok, false); S.nodes.forEach(n => { if (n.type === 'edfa') n.p.tiltCtl = true; }); assert.equal(state('tilt', S).done, true);
  // convert: a converter at ROADM-A joins slots 31 and 32; retuning one end is a shortcut that fails the slot goal
  S = fresh('convert'); assert.equal(state('convert', S).goals[0].ok, false); named(S, 'TRX-C2').p.conv = named(S, 'ROADM-A').id; assert.equal(state('convert', S).done, true, M.simulate(S).headline);
  S = fresh('convert'); named(S, 'TRX-B2').p.slot = 31; assert.equal(state('convert', S).goals[0].ok, true); assert.equal(state('convert', S).goals[1].ok, false, 'retuning is a shortcut');
  // repack: first fit clears the clashes and keeps all eight channels; dropping the blocked ones does not count
  S = fresh('repack'); assert.equal(state('repack', S).goals[0].ok, false); S.g.plan = M.assignSlots(S); S.g.nch = S.g.plan.length; assert.equal(state('repack', M.sanitize(S)).done, true, M.simulate(M.sanitize(S)).headline);
  S = fresh('repack'); S.g.plan = S.g.plan.filter((c, i) => ![3, 5].includes(i)); assert.equal(state('repack', M.sanitize(S)).goals[1].ok, false, 'deleting channels is a shortcut');
  // size: both ROADMs need more ports and contentionless add/drop; ports alone leave a clash, retuning breaks the slot goal
  S = fresh('size'); assert.equal(state('size', S).goals[0].ok, false);
  for (const n of ['ROADM-A', 'ROADM-C']) named(S, n).p.ports = 4; assert.equal(state('size', S).done, false, 'ports alone are not enough: slot 30 still collides');
  for (const n of ['ROADM-A', 'ROADM-C']) named(S, n).p.contentionless = true; assert.equal(state('size', S).done, true, M.simulate(S).headline);
  S = fresh('size'); for (const n of ['ROADM-A', 'ROADM-C']) named(S, n).p.ports = 4; named(S, 'TRX-A3').p.slot = 31; named(S, 'TRX-C3').p.slot = 31; assert.equal(state('size', S).goals[1].ok, false, 'retuning is a shortcut');
  // duct: move one fiber into its own duct; or leave it and add a route that avoids the duct
  S = fresh('duct'); assert.equal(state('duct', S).done, false); S.links.forEach(l => { if (l.p.srlg && +l.p.len === 80) l.p.srlg = ''; }); assert.equal(state('duct', S).done, true, M.simulate(S).headline);
  S = fresh('duct'); S.links.forEach(l => { l.p.srlg = ''; }); assert.equal(state('duct', S).done, true, 'with no shared duct either route survives');
  // bench: three amplifiers split 210 km into four spans; one amplifier is not enough, and a shorter fiber is not the same job
  S = fresh('bench'); M.applyFix(S, { type: 'insertAmp', id: S.links[0].id }); assert.equal(state('bench', S).done, false, 'one amplifier is not enough');
  for (let k = 0; k < 2; k++) for (const l of S.links.filter(x => x.kind === 'fiber' && +x.p.len > 100)) M.applyFix(S, { type: 'insertAmp', id: l.id });
  assert.equal(S.nodes.filter(n => n.type === 'edfa').length, 3); assert.equal(state('bench', S).done, true, M.simulate(S).headline);
  S = fresh('bench'); S.links[0].p.len = 60; assert.equal(state('bench', S).goals[2].ok, false, 'shortening the fiber is a shortcut');
  // raman: a backward pump; one that is too weak, or an amplifier in the span, does not satisfy the brief
  S = fresh('raman'); const sp = S.links.find(l => l.kind === 'fiber'); sp.p.raman = 300; assert.equal(state('raman', S).done, false, 'a weak pump is not enough');
  sp.p.raman = 1000; assert.equal(state('raman', S).done, true, M.simulate(S).headline);
  S = fresh('raman'); M.applyFix(S, { type: 'insertAmp', id: S.links.find(l => l.kind === 'fiber').id }); assert.equal(state('raman', S).goals[2].ok, false, 'a mid-span amplifier is not allowed');
  // filters: swap the pass-through ROADMs for amplifiers; a wider grid alone is not enough
  S = fresh('filters'); S.g.df = 100; assert.equal(state('filters', S).done, false, 'a 100 GHz grid alone leaves too little margin');
  S = fresh('filters'); for (const n of S.nodes) if (n.type === 'roadm' && !['ROADM-1', 'ROADM-12'].includes(n.name)) { n.type = 'edfa'; n.p = M.TYPES.edfa.def(); }
  assert.equal(state('filters', M.sanitize(S)).done, true, M.simulate(M.sanitize(S)).headline);
  // monday: two faults, one after the other
  S = fresh('monday'); const r1 = M.simulate(S); assert.equal(r1.headlineFix.type, 'work'); M.applyFix(S, r1.headlineFix);
  assert.equal(state('monday', S).done, false, 'the second fault is still there'); const r2 = M.simulate(S); assert.equal(r2.headlineFix.type, 'clean'); M.applyFix(S, r2.headlineFix);
  assert.equal(state('monday', S).done, true);
});

test('copy and paste: devices and the cables between them are cloned, with new names and ids', () => {
  const S = M.sanitize(build('protect')), names = new Set(S.nodes.map(n => n.name)), before = JSON.stringify(S);
  const ids = S.nodes.filter(n => ['ROADM-A', 'ROADM-B', 'TRX-A'].includes(n.name)).map(n => n.id);
  const clip = M.copySelection(S, ids);
  assert.equal(clip.nodes.length, 3);
  assert.equal(clip.links.length, S.links.filter(l => ids.includes(l.a) && ids.includes(l.b)).length, 'only cables with both ends in the selection');
  assert.ok(clip.links.length >= 2 && clip.links.length < S.links.length, 'the cable to ROADM-C is left behind');
  assert.equal(JSON.stringify(S), before, 'copying changes nothing');
  const r = M.pasteSelection(S, clip, 40, 40);
  assert.equal(r.nodeIds.length, 3); assert.equal(r.linkIds.length, clip.links.length);
  const fresh = S.nodes.filter(n => r.nodeIds.includes(n.id));
  assert.ok(fresh.every(n => !names.has(n.name)), 'names are new'); assert.equal(new Set(S.nodes.map(n => n.name)).size, S.nodes.length, 'names stay unique');
  assert.equal(new Set(S.nodes.map(n => n.id)).size, S.nodes.length, 'ids stay unique');
  const src = S.nodes.find(n => n.name === 'ROADM-A'), cp = fresh.find(n => n.type === 'roadm' && n.x === src.x + 40 && n.y === src.y + 40); assert.ok(cp, 'offset by 40');
  for (const l of S.links.filter(x => r.linkIds.includes(x.id))) assert.ok(r.nodeIds.includes(l.a) && r.nodeIds.includes(l.b), 'copied cables join copied devices only');
  assert.ok(!S.nodes.filter(n => r.nodeIds.includes(n.id)).some(n => n.id === S.svc.a || n.id === S.svc.z), 'a copy is never a service end');
  assert.equal(M.sanitize(clone(S)).nodes.length, S.nodes.length, 'the result is a valid lab');
  // mutating a copy leaves the original alone
  fresh.find(n => n.type === 'roadm').p.wss = 99; assert.notEqual(src.p.wss, 99);
  // transponder links follow the copies, and point nowhere outside them
  const T = M.sanitize(build('client')), tx = T.nodes.filter(n => n.p && n.p.peer);
  if (tx.length >= 2) { const pair = tx.slice(0, 2).map(n => n.id), c2 = M.copySelection(T, pair), r2 = M.pasteSelection(T, c2); const p2 = T.nodes.filter(n => r2.nodeIds.includes(n.id)); for (const n of p2) assert.ok(!n.p.peer || r2.nodeIds.includes(n.p.peer), 'peer is a copy or empty'); }
  // removing devices removes their cables and clears a service end
  const a = S.svc.a; M.removeNodes(S, [a, ...r.nodeIds]); assert.equal(S.svc.a, null); assert.ok(S.links.every(l => S.nodes.some(n => n.id === l.a) && S.nodes.some(n => n.id === l.b)), 'no dangling cable');
});

test('align and distribute: edges line up, spacing is even, and fewer than three cannot be spaced', () => {
  const S = { nodes: [{ id: 'a', x: 10, y: 50 }, { id: 'b', x: 100, y: 20 }, { id: 'c', x: 400, y: 90 }, { id: 'd', x: 40, y: 0 }] };
  const xs = () => S.nodes.map(n => n.x), ys = () => S.nodes.map(n => n.y);
  assert.equal(M.alignNodes(S, ['a', 'b', 'c'], 'left'), 3); assert.deepEqual(xs(), [10, 10, 10, 40]);
  S.nodes[1].x = 100; S.nodes[2].x = 400;
  M.alignNodes(S, ['a', 'b', 'c'], 'right'); assert.deepEqual(xs(), [400, 400, 400, 40]);
  M.alignNodes(S, ['a', 'b', 'c'], 'top'); assert.deepEqual(ys(), [20, 20, 20, 0]);
  S.nodes[0].x = 10; S.nodes[1].x = 300; S.nodes[2].x = 400;
  M.alignNodes(S, ['a', 'b', 'c'], 'hspace'); assert.deepEqual(xs().slice(0, 3), [10, 205, 400]);
  assert.equal(M.alignNodes(S, ['a', 'b'], 'hspace'), 0);
  assert.equal(M.alignNodes(S, ['a'], 'left'), 0);
  assert.equal(M.alignNodes(S, ['a', 'b'], 'nonsense'), 0);
});

test('sanitize keeps the channel count within the slots the grid has', () => {
  const S = build('dci'); S.g = { ...S.g, df: 150, nch: 96 };
  S.links.find(l => l.kind === 'fiber').p.nch = 80;
  const o = M.sanitize(S);
  assert.equal(o.g.nch, PHY.cBandSlots(150e9));
  assert.equal(o.links.find(l => l.kind === 'fiber').p.nch, 32);
  assert.equal(M.sanitize({ ...build('dci'), g: { df: 50, nch: 96 } }).g.nch, 96);
});

test('cableKind: a fiber between sites, a patch cord inside a rack, matching nearly every cable in the scenarios', () => {
  const T = t => ({ type: t });
  assert.equal(M.cableKind(T('edfa'), T('edfa')), 'fiber');
  assert.equal(M.cableKind(T('roadm'), T('roadm')), 'fiber');
  assert.equal(M.cableKind(T('trx'), T('trx')), 'fiber'); // dark fiber
  assert.equal(M.cableKind(T('trx'), T('mux')), 'patch');
  assert.equal(M.cableKind(T('mux'), T('edfa')), 'patch');
  assert.equal(M.cableKind(T('host'), T('mxp')), 'patch');
  assert.equal(M.cableKind(T('panel'), T('otdr')), 'patch');
  let ok = 0, all = 0;
  for (const k in M.PRESETS) { const p = M.PRESETS[k].build(), n = id => p.nodes.find(x => x.id === id); for (const l of p.links) { all++; if (M.cableKind(n(l.a), n(l.b)) === l.kind) ok++; } }
  assert.ok(ok / all > 0.95, `${ok} of ${all}`);
});

test('txPower is the launch the simulation uses: the mode default or the set power, less a degraded laser', () => {
  const S = build('dci'), a = S.nodes.find(n => n.id === S.svc.a), launch = () => M.simulate(S).hops[0].out.sig;
  assert.equal(M.txPower(a), PHY.MODES[a.p.mode].tx);
  assert.equal(launch(), M.txPower(a));
  a.p.tx = -5; assert.equal(M.txPower(a), -5); assert.equal(launch(), -5);
  a.p.fail = 'degraded'; a.p.degDb = 2; assert.equal(M.txPower(a), -7); assert.equal(launch(), -7);
});
