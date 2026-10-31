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
  assert.deepEqual(c.g, { nch: 16, df: 75, launch: 1.5, neighbors: "same", eolSpan: 1, eolTrx: 0.5 });
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
  assert.ok(run('back', 1).tilt > run('back', 3).tilt + 0.5);
  assert.ok(run('back', 1).tilt > off.tilt);
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
