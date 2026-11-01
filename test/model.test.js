const test = require('node:test');
const assert = require('node:assert/strict');
const PHY = require('../src/engine.js');
const M = require('../src/model.js');

const build = k => { const p = M.PRESETS[k].build(); return { nodes: p.nodes, links: p.links, g: p.g, svc: p.svc }; };
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
  const S = build('dci'), ids = S.nodes.filter(n => n.type === 'trx').map(n => n.id);
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
  const S = build('dci'); S.nodes.find(n => n.id === S.svc.z).p.mode = 'c100';
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
  const S = build('lh'); S.g.nch = 96; S.g.launch = 6;
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
  assert.deepEqual(c.g, { nch: 16, df: 75, launch: 1.5, neighbors: "same", reopt: false, plan: null, eolSpan: 1, eolTrx: 0.5 });
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
  const S = build('lh'); S.g.launch = 3;
  const base = M.simulate(S);
  S.links.filter(l => l.kind === 'fiber').forEach(l => (l.p.nch = 4));
  const thin = M.simulate(S);
  assert.ok(thin.snrNli > base.snrNli, 'NLI should drop');
  assert.ok(thin.hops.some(h => h.kind === 'span' && h.nch === 4));
  assert.equal(base.hops.filter(h => h.kind === 'span')[0].nch, 64);
});

test('channels that do not fit the C-band grid raise an alarm', () => {
  const S = build('lh'); // 64 ch at 75 GHz fits exactly
  assert.ok(!M.simulate(S).alarms.some(a => /do not fit/.test(a.text)));
  S.g.nch = 96;
  assert.ok(M.simulate(S).alarms.some(a => /do not fit/.test(a.text)));
  S.g.nch = 64; S.g.df = 100;
  assert.ok(M.simulate(S).alarms.some(a => /do not fit/.test(a.text)));
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
    const S = build('dci'), f = S.links.find(l => l.kind === 'fiber'); f.p.len = 50; f.p.raman = 300; S.g.nch = nch; S.g.launch = 3;
    return M.simulate(S, undefined, { single: true }).hops.find(h => h.kind === 'span').raman;
  };
  assert.ok(gainFor(2) > gainFor(96) + 0.2, `${gainFor(2)} vs ${gainFor(96)}`);
});

test('cross-phase modulation penalises direct-detection channels only, more beside coherent neighbours', () => {
  const S = build('sfp10'); S.g.nch = 40; S.g.launch = 3;
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
  const S = build('dci');
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
