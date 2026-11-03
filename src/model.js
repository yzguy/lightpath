// ===== Topology model, routing and path simulation =====
// DOM-free (like engine.js) so it can be tested in Node. Depends on the global PHY from engine.js.
const MODEL = (() => {
  const PHY_ = typeof PHY !== 'undefined' ? PHY : require('./engine.js');
  const { db, lin } = PHY_;
  const f1 = x => (isFinite(x) ? x.toFixed(1) : '—');
  const uid = p => p + Math.random().toString(36).slice(2, 7);

  const TYPES = {
    trx: { label: 'Transponder', hint: 'Coherent pluggable, or a 10G DWDM SFP+', maxLinks: 2, def: () => ({ mode: 'zr400', tx: null, spare: '', slot: null, rxSlot: null, off: 0, peer: '', prot: '', conv: '' }) },
    mxp: { label: 'Muxponder', hint: 'Client ports into one coherent line port', maxLinks: 2, def: () => ({ mode: 'zrp400', tx: null, spare: '', slot: null, rxSlot: null, off: 0, peer: '', prot: '', conv: '', clients: defaultClients() }) },
    meter: { label: 'Power meter', hint: 'Reads the light at a test point', maxLinks: 1, def: () => ({}) },
    otdr: { label: 'OTDR', hint: 'Traces a fiber: loss, events, breaks', maxLinks: 1, def: () => ({ pulse: 100 }) },
    host: { label: 'Host / router', hint: 'Traffic endpoint with Ethernet ports', maxLinks: 8, def: () => ({ ip: '', ports: 1, speed: 100 }) },
    splitter: { label: 'Splitter / tap', hint: 'Passive power splitter, 50/50 up to a 99/1 monitor tap', maxLinks: 3, def: () => ({ ratio: '50/50', excess: 0.3 }) },
    switch: { label: 'Optical switch', hint: '1x2 switch: one common port, two inputs', maxLinks: 3, def: () => ({ il: 1, pos: 'a', auto: true, switchMs: 20 }) },
    panel: { label: 'Patch panel / ODF', hint: 'Fiber panel: connector loss per port, dirty-connector faults', maxLinks: 96, def: () => ({ ports: 12, il: 0.5, dirty: {} }) },
    mux: { label: 'Mux / Demux', hint: 'Passive DWDM filter', maxLinks: 99, def: () => ({ il: 5, ports: 16, first: 24, bidi: false, role: 'low' }) },
    oadm: { label: 'OADM', hint: 'Passive add/drop filter', maxLinks: 99, def: () => ({ thru: 1.5, ad: 3, tx: 0, sides: 'ew', eFirst: 24, ePorts: 4, wFirst: 24, wPorts: 4, osc: false, p1310: false, o1310: '10g-lr', bidi: false, eRole: 'low', wRole: 'high' }) },
    edfa: { label: 'EDFA', hint: 'Booster, in-line or preamp', maxLinks: 2, def: () => ({ ctl: 'auto', target: '', targetRev: '', gain: 20, gainRev: '', nf: 5, nfRev: '', gmin: 10, gminRev: '', gmax: 30, gmaxRev: '', pmax: 23, pinMax: 10, pmaxRev: '', tiltCtl: true, agcUs: '' }) },
    roadm: { label: 'ROADM', hint: 'WSS node, any degree', maxLinks: 99, def: () => ({ wss: 6, ad: 4, amps: true, nf: 5.5, degrees: 4, ports: 16, first: 24, colorless: true, directionless: true, contentionless: true }) },
    dcm: { label: 'Dispersion comp.', hint: 'DCF module or FBG, cancels CD', maxLinks: 2, def: () => ({ cd: -1360, cdRev: '', il: 7, ilRev: '' }) },
    voa: { label: 'VOA / pad', hint: 'Fixed attenuator', maxLinks: 2, def: () => ({ att: 5 }) },
  };
  const defaultClients = () => Array.from({ length: 4 }, () => newClient());
  const newClient = (optic = '100g-lr4') => ({ optic, len: 0.1, extra: 1 });
  const isEnd = n => !!n && (n.type === 'trx' || n.type === 'mxp'); // service end: a coherent line port that light never passes through
  const PREFIX = { dcm: 'DCM', mxp: 'MXP', trx: 'TRX', mux: 'MUX', panel: 'ODF', splitter: 'SPL', switch: 'SW', host: 'HOST', meter: 'PM', otdr: 'OTDR', oadm: 'OADM', edfa: 'AMP', roadm: 'ROADM', voa: 'VOA' };
  const linkDefaults = kind => (kind === 'fiber' ? { len: 80, fiber: 'smf', extra: 1, extraRev: '', nch: '', raman: 0, ramanRev: '', ramanDir: 'back', ramanPumps: 1, ramanFull: false, dir: 'both', cut: false, cutAt: '', srlg: '', sa: '', sb: '', single: false } : { il: 0.5, dir: 'both', cut: false, mport: null, sa: '', sb: '', cport: null, hport: null });

  // ---------- presets ----------
  function N(type, name, x, y, p = {}) { return { id: uid('n'), type, name, x, y, p: { ...TYPES[type].def(), ...p } }; }
  function L(a, b, kind, p = {}) { return { id: uid('l'), a: a.id, b: b.id, kind, p: { ...linkDefaults(kind), ...p } }; }
  const PRESETS = {
    dci: {
      name: 'DCI: 400ZR over 80 km', build() {
        const a1 = N('trx', 'TRX-A1', 80, 120), a2 = N('trx', 'TRX-A2', 80, 220), a3 = N('trx', 'TRX-A3', 80, 320);
        const ma = N('mux', 'MUX-A', 230, 220), ba = N('edfa', 'BST-A', 370, 220, { gmin: 5 });
        const pb = N('edfa', 'PRE-B', 640, 220, { gmin: 5 }), mb = N('mux', 'MUX-B', 780, 220);
        const b1 = N('trx', 'TRX-B1', 930, 120), b2 = N('trx', 'TRX-B2', 930, 220), b3 = N('trx', 'TRX-B3', 930, 320);
        return { nodes: [a1, a2, a3, ma, ba, pb, mb, b1, b2, b3], links: [L(a1, ma, 'patch'), L(a2, ma, 'patch'), L(a3, ma, 'patch'), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 80 }), L(pb, mb, 'patch'), L(mb, b1, 'patch'), L(mb, b2, 'patch'), L(mb, b3, 'patch')],
          g: { nch: 16, df: 75, launch: 0 }, svc: { a: a1.id, z: b1.id } };
      }
    },
    lh: {
      name: 'Long haul: 5 spans with ILAs', build() {
        // 64 channels at 0 dBm each put 12 dBm into the booster and the return-direction preamp, so these two are the high-input type (the default limit is 10 dBm).
        const a = N('trx', 'TRX-A', 60, 120, { mode: 'zrp400' }), ma = N('mux', 'MUX-A', 60, 250), ba = N('edfa', 'BST-A', 220, 250, { gmin: 5, pinMax: 14 });
        const i1 = N('edfa', 'ILA-1', 400, 250), i2 = N('edfa', 'ILA-2', 580, 250), i3 = N('edfa', 'ILA-3', 760, 250), i4 = N('edfa', 'ILA-4', 940, 250);
        const pb = N('edfa', 'PRE-B', 1120, 250, { gmin: 5, pinMax: 14 }), mb = N('mux', 'MUX-B', 1260, 250), z = N('trx', 'TRX-Z', 1260, 120, { mode: 'zrp400' });
        return { nodes: [a, ma, ba, i1, i2, i3, i4, pb, mb, z], links: [L(a, ma, 'patch'), L(ma, ba, 'patch'), L(ba, i1, 'fiber', { len: 80 }), L(i1, i2, 'fiber', { len: 95 }), L(i2, i3, 'fiber', { len: 80 }), L(i3, i4, 'fiber', { len: 100 }), L(i4, pb, 'fiber', { len: 85 }), L(pb, mb, 'patch'), L(mb, z, 'patch')],
          g: { nch: 64, df: 75, launch: 1 }, svc: { a: a.id, z: z.id } };
      }
    },
    ring: {
      name: 'ROADM triangle with restoration', build() {
        const ra = N('roadm', 'ROADM-A', 200, 300), rb = N('roadm', 'ROADM-B', 520, 110), rc = N('roadm', 'ROADM-C', 840, 300);
        const ta = N('trx', 'TRX-A', 200, 440, { mode: 'zrp400' }), tc = N('trx', 'TRX-C', 840, 440, { mode: 'zrp400' }), tb = N('trx', 'TRX-B', 520, 0, { mode: 'zrp400' });
        return { nodes: [ra, rb, rc, ta, tb, tc], links: [L(ra, rc, 'fiber', { len: 70 }), L(ra, rb, 'fiber', { len: 100 }), L(rb, rc, 'fiber', { len: 110 }), L(ta, ra, 'patch'), L(tc, rc, 'patch'), L(tb, rb, 'patch')],
          g: { nch: 48, df: 75, launch: 0 }, svc: { a: ta.id, z: tc.id } };
      }
    },
    adddrop: {
      name: 'ROADM line with add/drop at the middle node', build() {
        const ra = N('roadm', 'ROADM-A', 160, 240), rb = N('roadm', 'ROADM-B', 520, 240), rc = N('roadm', 'ROADM-C', 880, 240);
        const ta = N('trx', 'TRX-A', 160, 400, { mode: 'zrp400' }), tc = N('trx', 'TRX-C', 880, 400, { mode: 'zrp400' });
        // slots 22..37: some run end to end, some drop at B, some are added at B
        const plan = [];
        for (let s = 22; s < 38; s++) {
          const k = s - 22, c = { slot: s, mode: 'zrp400', off: 0, svc: s === 30, from: '', to: '', via: '' };
          if (!c.svc && k % 4 === 1) c.to = rb.id; // A to B
          else if (!c.svc && k % 4 === 3) c.from = rb.id; // B to C
          plan.push(c);
        }
        return { nodes: [ra, rb, rc, ta, tc], links: [L(ra, rb, 'fiber', { len: 80 }), L(rb, rc, 'fiber', { len: 80 }), L(ta, ra, 'patch'), L(tc, rc, 'patch')],
          g: { nch: plan.length, df: 75, launch: 0, plan }, svc: { a: ta.id, z: tc.id } };
      }
    },
    mesh: {
      name: 'Mesh: channels on different routes', build() {
        const ra = N('roadm', 'ROADM-A', 200, 300), rb = N('roadm', 'ROADM-B', 520, 110), rc = N('roadm', 'ROADM-C', 840, 300);
        const ta = N('trx', 'TRX-A', 200, 440, { mode: 'zrp400' }), tc = N('trx', 'TRX-C', 840, 440, { mode: 'zrp400' });
        // The service rides A to C directly; others run A to B, B to C, or A to C the long way round via B (a diverse route).
        // The A-B and B-C channels share no fiber, so they reuse the same four slots; the long-way channels cross both fibers and need their own.
        const plan = [], ch = (slot, o = {}) => plan.push({ slot, mode: 'zrp400', off: 0, svc: false, from: '', to: '', via: '', ...o });
        for (let k = 0; k < 4; k++) { ch(24 + k, { from: ra.id, to: rb.id }); ch(24 + k, { from: rb.id, to: rc.id }); }
        for (let k = 0; k < 3; k++) ch(28 + k, { from: ra.id, to: rc.id, via: rb.id });
        ch(31, { svc: true });
        for (let k = 0; k < 4; k++) ch(32 + k);
        plan.sort((a, b) => a.slot - b.slot);
        return { nodes: [ra, rb, rc, ta, tc], links: [L(ra, rc, 'fiber', { len: 70 }), L(ra, rb, 'fiber', { len: 100 }), L(rb, rc, 'fiber', { len: 110 }), L(ta, ra, 'patch'), L(tc, rc, 'patch')],
          g: { nch: plan.length, df: 75, launch: 0, plan }, svc: { a: ta.id, z: tc.id } };
      }
    },
    protect: {
      name: 'Protection and converters on a triangle', build() {
        const ra = N('roadm', 'ROADM-A', 200, 300), rb = N('roadm', 'ROADM-B', 520, 110), rc = N('roadm', 'ROADM-C', 840, 300);
        const ta = N('trx', 'TRX-A', 200, 440, { mode: 'zrp400' }), tc = N('trx', 'TRX-C', 840, 440, { mode: 'zrp400' });
        // The service is 1+1 protected: working on the direct 70 km fiber, protection the long way round through B. Four A to B channels are
        // protected too (their protection runs A-C-B). Two A to C channels cross B and change slot there. Cut the 70 km fiber to watch it switch.
        const plan = [], ch = (slot, o = {}) => plan.push({ slot, mode: 'zrp400', off: 0, svc: false, from: '', to: '', via: '', conv: '', slot2: slot, prot: '', ...o });
        for (let k = 0; k < 4; k++) ch(24 + k, { from: ra.id, to: rb.id, prot: '1+1' });
        ch(28, { from: ra.id, to: rc.id, conv: rb.id, slot2: 40 }); ch(29, { from: ra.id, to: rc.id, conv: rb.id, slot2: 41 });
        ch(31, { svc: true, prot: '1+1' });
        for (let k = 0; k < 4; k++) ch(32 + k);
        return { nodes: [ra, rb, rc, ta, tc], links: [L(ra, rc, 'fiber', { len: 70 }), L(ra, rb, 'fiber', { len: 100 }), L(rb, rc, 'fiber', { len: 110 }), L(ta, ra, 'patch'), L(tc, rc, 'patch')],
          g: { nch: plan.length, df: 75, launch: 0, plan }, svc: { a: ta.id, z: tc.id } };
      }
    },
    srlg: {
      name: 'Shared duct: two fibers that fail together', build() {
        const ra = N('roadm', 'ROADM-A', 200, 300), rb = N('roadm', 'ROADM-B', 520, 110), rc = N('roadm', 'ROADM-C', 840, 300), rd = N('roadm', 'ROADM-D', 520, 440);
        const ta = N('trx', 'TRX-A', 200, 440, { mode: 'zrp400' }), tc = N('trx', 'TRX-C', 840, 440, { mode: 'zrp400' });
        // A-C and A-B leave A in the same duct (risk group duct1). Without that, the shortest fiber-disjoint protection route for the
        // A to C service would be A-B-C (180 km); with it, protection has to go the long way through D. Cut either fiber and both go dark.
        const plan = [], ch = (slot, o = {}) => plan.push({ slot, mode: 'zrp400', off: 0, svc: false, from: '', to: '', via: '', conv: '', slot2: slot, prot: '', ...o });
        ch(31, { svc: true, prot: '1+1' }); for (let k = 0; k < 3; k++) ch(32 + k); for (let k = 0; k < 3; k++) ch(24 + k, { from: ra.id, to: rb.id });
        return { nodes: [ra, rb, rc, rd, ta, tc], links: [L(ra, rc, 'fiber', { len: 70, srlg: 'duct1' }), L(ra, rb, 'fiber', { len: 80, srlg: 'duct1' }), L(rb, rc, 'fiber', { len: 80 }), L(ra, rd, 'fiber', { len: 90 }), L(rd, rc, 'fiber', { len: 90 }), L(ta, ra, 'patch'), L(tc, rc, 'patch')],
          g: { nch: plan.length, df: 75, launch: 0, plan }, svc: { a: ta.id, z: tc.id } };
      }
    },
    client: {
      name: 'Dual-homed transponders with spare modules', build() {
        const a1 = N('roadm', 'ROADM-A1', 240, 160), a2 = N('roadm', 'ROADM-A2', 240, 420), z1 = N('roadm', 'ROADM-Z1', 800, 160), z2 = N('roadm', 'ROADM-Z2', 800, 420);
        const ta = N('trx', 'TRX-A', 60, 290, { mode: 'zrp400', spare: 'switch' }), tz = N('trx', 'TRX-Z', 980, 290, { mode: 'zrp400', spare: 'switch' });
        // Each transponder has a spare module and two patch cords to two ROADMs, so the 1+1 protection of the service is diverse all the way
        // to the transponders. Fail ROADM-A1, or the primary module of TRX-A, and the service carries on.
        const plan = [], ch = (slot, o = {}) => plan.push({ slot, mode: 'zrp400', off: 0, svc: false, from: '', to: '', via: '', conv: '', slot2: slot, prot: '', ...o });
        ch(31, { svc: true, prot: '1+1' }); for (let k = 0; k < 4; k++) ch(32 + k, { from: a1.id, to: z1.id }); for (let k = 0; k < 4; k++) ch(24 + k, { from: a2.id, to: z2.id });
        return { nodes: [a1, a2, z1, z2, ta, tz], links: [L(a1, z1, 'fiber', { len: 90 }), L(a2, z2, 'fiber', { len: 110 }), L(ta, a1, 'patch'), L(ta, a2, 'patch'), L(tz, z1, 'patch'), L(tz, z2, 'patch')],
          g: { nch: plan.length, df: 75, launch: 0, plan }, svc: { a: ta.id, z: tz.id } };
      }
    },
    mxp: {
      name: 'Muxponder: 4x100G over 400G ZR+', build() {
        const a = N('mxp', 'MXP-A', 80, 220), ma = N('mux', 'MUX-A', 260, 220), ba = N('edfa', 'BST-A', 400, 220, { gmin: 5 });
        const pb = N('edfa', 'PRE-B', 670, 220, { gmin: 5 }), mb = N('mux', 'MUX-B', 810, 220), z = N('mxp', 'MXP-B', 960, 220);
        return { nodes: [a, ma, ba, pb, mb, z], links: [L(a, ma, 'patch'), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 80 }), L(pb, mb, 'patch'), L(mb, z, 'patch')],
          g: { nch: 16, df: 75, launch: 0 }, svc: { a: a.id, z: z.id } };
      }
    },
    mxp2: {
      name: 'Two muxponders per side on passive muxes', build() {
        const a1 = N('mxp', 'MXP-A1', 80, 150), a2 = N('mxp', 'MXP-A2', 80, 290), ma = N('mux', 'MUX-A', 260, 220), ba = N('edfa', 'BST-A', 400, 220, { gmin: 5 });
        const pb = N('edfa', 'PRE-B', 670, 220, { gmin: 5 }), mb = N('mux', 'MUX-B', 810, 220), z1 = N('mxp', 'MXP-B1', 960, 150), z2 = N('mxp', 'MXP-B2', 960, 290);
        // Each muxponder is one wave. A1-B1 is the service (slot 31) and A2-B2 rides slot 32 on the same line; the other waves stand for further muxponders.
        const plan = [], ch = (slot, o = {}) => plan.push({ slot, mode: 'zrp400', off: 0, svc: false, from: '', to: '', via: '', conv: '', slot2: slot, prot: '', ...o });
        ch(31, { svc: true, from: a1.id, to: z1.id }); ch(32, { from: a2.id, to: z2.id }); for (let k = 0; k < 6; k++) ch(24 + k);
        return { nodes: [a1, a2, ma, ba, pb, mb, z1, z2], links: [L(a1, ma, 'patch'), L(a2, ma, 'patch'), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 80 }), L(pb, mb, 'patch'), L(mb, z1, 'patch'), L(mb, z2, 'patch')],
          g: { nch: plan.length, df: 75, launch: 0, plan }, svc: { a: a1.id, z: z1.id } };
      }
    },
    oadm: {
      name: 'Passive OADM bus: transponders on add/drop ports', build() {
        const T = (nm, x, y) => N('trx', nm, x, y, { mode: 'zrp400' });
        const a = [1, 2, 3, 4].map(k => T('TRX-A' + k, 60, 60 + k * 90)), b = [T('TRX-B1', 540, 470), T('TRX-B2', 640, 470), T('TRX-B3', 780, 470)], c = [T('TRX-C1', 940, 470), T('TRX-C2', 1080, 470)], z = [1, 2, 3].map(k => T('TRX-Z' + k, 1470, 100 + k * 100));
        const ma = N('mux', 'MUX-A', 220, 300, { ports: 16, first: 24 }), mz = N('mux', 'MUX-Z', 1310, 300, { ports: 16, first: 24 }), ba = N('edfa', 'BST-A', 350, 300, { gmin: 5 });
        const ab = N('edfa', 'AMP-B', 520, 300, { gmin: 5 }), ob = N('oadm', 'OADM-B', 680, 300, { wFirst: 24, wPorts: 2, eFirst: 26, ePorts: 1 });
        const ac = N('edfa', 'AMP-C', 850, 300, { gmin: 5 }), oc = N('oadm', 'OADM-C', 1000, 300, { wFirst: 28, wPorts: 1, eFirst: 29, ePorts: 1 }), pz = N('edfa', 'PRE-Z', 1170, 300, { gmin: 5 });
        // Plugged in by port: A1-B1 (slot 25) and A2-B2 (26) on OADM-B's west ports, B3-Z1 (27) on its east port, A4-C1 (29) on OADM-C's west port,
        // C2-Z3 (30) on its east port, and the service A3-Z2 (32) end to end through both. Each transponder follows its port.
        const pa = [0, 1, 7, 4], pzz = [2, 7, 5];
        const links = [...a.map((t, k) => L(t, ma, 'patch', { mport: pa[k] })), ...z.map((t, k) => L(t, mz, 'patch', { mport: pzz[k] })), L(ma, ba, 'patch'), L(ba, ab, 'fiber', { len: 40 }), L(ab, ob, 'patch', { sb: 'w' }),
          L(b[0], ob, 'patch', { mport: 0, sb: 'w' }), L(b[1], ob, 'patch', { mport: 1, sb: 'w' }), L(b[2], ob, 'patch', { mport: 0, sb: 'e' }), L(ob, ac, 'fiber', { len: 40, sa: 'e' }), L(ac, oc, 'patch', { sb: 'w' }),
          L(c[0], oc, 'patch', { mport: 0, sb: 'w' }), L(c[1], oc, 'patch', { mport: 0, sb: 'e' }), L(oc, pz, 'fiber', { len: 40, sa: 'e' }), L(pz, mz, 'patch')];
        return { nodes: [...a, ...b, ...c, ...z, ma, mz, ba, ab, ob, ac, oc, pz], links, g: { nch: 16, df: 75, launch: 0 }, svc: { a: a[2].id, z: z[1].id } };
      }
    },
    ports: {
      name: 'Transponders on mux ports: the cabling sets the channels', build() {
        const a = [1, 2, 3].map(k => N('trx', 'TRX-A' + k, 60, 60 + k * 120, { mode: 'zrp400' })), z = [1, 2, 3].map(k => N('trx', 'TRX-B' + k, 1000, 60 + k * 120, { mode: 'zrp400' }));
        const ma = N('mux', 'MUX-A', 260, 300, { ports: 16, first: 24 }), mb = N('mux', 'MUX-B', 800, 300, { ports: 16, first: 24 }), ba = N('edfa', 'BST-A', 400, 300, { gmin: 5 }), pb = N('edfa', 'PRE-B', 660, 300, { gmin: 5 });
        const port = [2, 3, 5]; // MUX ports 3, 4 and 6 (slots 27, 28, 30); each transponder follows its port
        return { nodes: [...a, ...z, ma, mb, ba, pb], links: [...a.map((t, k) => L(t, ma, 'patch', { mport: port[k] })), ...z.map((t, k) => L(t, mb, 'patch', { mport: port[k] })), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 80 }), L(pb, mb, 'patch')],
          g: { nch: 16, df: 75, launch: 0 }, svc: { a: a[0].id, z: z[0].id } };
      }
    },
    roadmports: {
      name: 'ROADM ring with transponders on add/drop ports', build() {
        const T = (nm, x, y, slot) => N('trx', nm, x, y, { mode: 'zrp400', slot });
        const ra = N('roadm', 'ROADM-A', 200, 300), rb = N('roadm', 'ROADM-B', 520, 150), rc = N('roadm', 'ROADM-C', 840, 300);
        const a1 = T('TRX-A1', 60, 230, 29), a2 = T('TRX-A2', 60, 370, 30), b1 = T('TRX-B1', 420, 30, 30), b2 = T('TRX-B2', 620, 30, 30), c1 = T('TRX-C1', 980, 230, 29), c2 = T('TRX-C2', 980, 370, 30);
        // The service is A1-C1 (slot 30). A2-B1 and B2-C2 both use slot 31 on different fibers, so the slot is reused; "Connect to" says who pairs with whom.
        a2.p.peer = b1.id; b1.p.peer = a2.id; b2.p.peer = c2.id; c2.p.peer = b2.id;
        const port = (t, r, k) => L(t, r, 'patch', { mport: k });
        return { nodes: [ra, rb, rc, a1, a2, b1, b2, c1, c2], links: [L(ra, rb, 'fiber', { len: 80 }), L(rb, rc, 'fiber', { len: 80 }), L(ra, rc, 'fiber', { len: 70 }), port(a1, ra, 0), port(a2, ra, 1), port(b1, rb, 0), port(b2, rb, 1), port(c1, rc, 0), port(c2, rc, 1)],
          g: { nch: 12, df: 75, launch: 0 }, svc: { a: a1.id, z: c1.id } };
      }
    },
    otdr: {
      name: 'OTDR and power meter at a patch panel', build() {
        // The ODF scenario (a dirty connector on ODF-B port 1) with two instruments on test points. The OTDR is plugged into the front of ODF-A port 1 and traces
        // the 60 km span; the power meter is on the front of ODF-B port 1 and reads the light that arrives there. Change the pulse width to trade reach against resolution.
        const p = PRESETS.odf.build(), nm = n => p.nodes.find(x => x.name === n), oa = nm('ODF-A'), ob = nm('ODF-B');
        const ot = N('otdr', 'OTDR-1', oa.x, oa.y - 130, { pulse: 300 }), pm = N('meter', 'PM-1', ob.x, ob.y - 130);
        p.nodes.push(ot, pm); p.links.push(L(ot, oa, 'patch', { sb: 'f1' }), L(pm, ob, 'patch', { sb: 'f1' }));
        return p;
      }
    },
    osc: {
      name: 'Supervisory channel (1510 nm) and 1310 nm client ports', build() {
        const ta = N('trx', 'TRX-A', 60, 300, { mode: 'zrp400' }), tz = N('trx', 'TRX-Z', 1330, 300, { mode: 'zrp400' });
        const ma = N('mux', 'MUX-A', 200, 300, { ports: 16, first: 24 }), mz = N('mux', 'MUX-Z', 1200, 300, { ports: 16, first: 24 }), ba = N('edfa', 'BST-A', 330, 300, { gmin: 5 });
        const sd = { wFirst: 24, wPorts: 2, eFirst: 24, ePorts: 2, osc: true };
        const o1 = N('oadm', 'OADM-1', 470, 300, { ...sd, p1310: true }), od = N('panel', 'ODF-1', 620, 300, { ports: 12, dirty: { 1: 1.5 } });
        const o2 = N('oadm', 'OADM-2', 770, 300, { ...sd, p1310: true }), ac = N('edfa', 'AMP-C', 910, 300, { gmin: 5 });
        const o3 = N('oadm', 'OADM-3', 1050, 300, { ...sd, p1310: true });
        // TRX-A to TRX-Z is the service in slot 32, passing all three OADMs. Each OADM has the supervisory channel (1510 nm) on, so the amplifiers and the OADMs form one
        // management domain, each span with its own budget. OADM-1 and OADM-2 also have a 1310 nm port with a 10GBASE-LR client over 15 km of fiber and a patch panel
        // port with a dirty connector (little margin left). The amplifier between OADM-2 and OADM-3 regenerates the OSC but blocks the 1310 nm client.
        return { nodes: [ta, tz, ma, mz, ba, o1, od, o2, ac, o3], links: [L(ta, ma, 'patch', { mport: 7 }), L(ma, ba, 'patch'), L(ba, o1, 'fiber', { len: 20 }), L(o1, od, 'fiber', { len: 8 }), L(od, o2, 'fiber', { len: 7 }),
          L(o2, ac, 'fiber', { len: 40 }), L(ac, o3, 'fiber', { len: 40 }), L(o3, mz, 'patch'), L(mz, tz, 'patch', { mport: 7 })], g: { nch: 8, df: 75, launch: 0 }, svc: { a: ta.id, z: tz.id } };
      }
    },
    cabprot: {
      name: 'Protection and a converter on cabled channels', build() {
        // The ROADM ring with transponders on add/drop ports (as in the ROADM ports scenario). TRX-A2 to TRX-B1 is 1+1 protected: the copy runs A-C-B.
        // TRX-C2 is tuned to slot 32 and TRX-B2 to slot 33; converting at ROADM-A (set on C2, with Connect to naming B2) joins them across the slots.
        const p = PRESETS.roadmports.build(), nm = n => p.nodes.find(x => x.name === n);
        nm('TRX-A2').p.prot = '1+1'; nm('TRX-C2').p.slot = 31; nm('TRX-B2').p.slot = 32; nm('TRX-C2').p.conv = nm('ROADM-A').id;
        return p;
      }
    },
    reach: {
      name: 'Hosts reaching each other over a muxponder link', build() {
        const H = (nm, x, y, ip) => N('host', nm, x, y, { ip, speed: 100 });
        const ha1 = H('HOST-A1', 60, 140, '10.0.0.1/24'), ha2 = H('HOST-A2', 60, 300, '10.0.0.3/24'), hb1 = H('HOST-B1', 1230, 140, '10.0.0.2/24'), hb2 = H('HOST-B2', 1230, 300, '10.0.0.4/24');
        const a = N('mxp', 'MXP-A', 220, 220), ma = N('mux', 'MUX-A', 380, 220), ba = N('edfa', 'BST-A', 510, 220, { gmin: 5 });
        const pb = N('edfa', 'PRE-B', 780, 220, { gmin: 5 }), mb = N('mux', 'MUX-B', 910, 220), z = N('mxp', 'MXP-B', 1060, 220);
        const cli = (h, m, k) => L(h, m, 'patch', { hport: 0, cport: k });
        return { nodes: [ha1, ha2, a, ma, ba, pb, mb, z, hb1, hb2], links: [cli(ha1, a, 0), cli(ha2, a, 1), L(a, ma, 'patch'), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 80 }), L(pb, mb, 'patch'), L(mb, z, 'patch'), cli(hb1, z, 0), cli(hb2, z, 1)],
          g: { nch: 16, df: 75, launch: 0 }, svc: { a: a.id, z: z.id },
          flows: [{ a: ha1.id, z: hb1.id, gbps: 60 }, { a: ha2.id, z: hb2.id, gbps: 150 }, { a: hb1.id, z: ha1.id, gbps: 20 }] };
      }
    },
    bidi: {
      name: 'Single-fiber (BiDi) bus: OADM between two muxes', build() {
        const T = (nm, x, y) => N('trx', nm, x, y, { mode: 'dwdm10f' });
        const a = [1, 2].map(k => T('TRX-A' + k, 60, 110 + k * 110)), b = [T('TRX-B1', 520, 470), T('TRX-B2', 640, 470), T('TRX-B3', 820, 470)], z = T('TRX-Z1', 1260, 330);
        // One fiber carries both directions, so the two ends of every channel use different slots: the A end the low band, the far end the high band.
        const ma = N('mux', 'MUX-A', 260, 300, { bidi: true, role: 'low', ports: 2, first: 24 }), mz = N('mux', 'MUX-Z', 1120, 300, { bidi: true, role: 'high', ports: 1, first: 30 });
        const ob = N('oadm', 'OADM-B', 690, 300, { bidi: true, sides: 'ew', wFirst: 24, wPorts: 2, wRole: 'high', eFirst: 30, ePorts: 1, eRole: 'low' });
        const links = [...a.map((t, k) => L(t, ma, 'patch', { mport: k })), L(ma, ob, 'fiber', { len: 25, single: true, sb: 'w' }), L(b[0], ob, 'patch', { mport: 0, sb: 'w' }), L(b[1], ob, 'patch', { mport: 1, sb: 'w' }), L(b[2], ob, 'patch', { mport: 0, sb: 'e' }),
          L(ob, mz, 'fiber', { len: 25, single: true, sa: 'e' }), L(z, mz, 'patch', { mport: 0 })];
        return { nodes: [...a, ...b, z, ma, ob, mz], links, g: { nch: 3, df: 75, launch: 0 }, svc: { a: a[0].id, z: b[0].id } };
      }
    },
    olp: {
      name: 'Optical line protection: splitter, tap and switch', build() {
        const ta = N('trx', 'TRX-A', 50, 200, { mode: 'zrp400' }), tz = N('trx', 'TRX-Z', 1370, 200, { mode: 'zrp400' });
        const ma = N('mux', 'MUX-A', 180, 280), ba = N('edfa', 'BST-A', 310, 280, { gmin: 5 }), tap = N('splitter', 'TAP-A', 440, 280, { ratio: '99/1' }), spl = N('splitter', 'SPL-A', 570, 280, { ratio: '50/50' });
        const sw = N('switch', 'SW-Z', 900, 280), pz = N('edfa', 'PRE-Z', 1030, 280, { gmin: 5 }), mz = N('mux', 'MUX-Z', 1190, 280);
        // The booster feeds a 99/1 tap (its monitor port is left free to read the power) and a 50/50 splitter that lights both fibers. The switch at the far end
        // passes port A (60 km) and, being set to auto, goes to port B (80 km) if the light on A is lost. Cut the 60 km fiber, then set the switch to manual.
        const links = [L(ta, ma, 'patch'), L(ma, ba, 'patch'), L(ba, tap, 'patch', { sb: 'c' }), L(tap, spl, 'patch', { sa: 'a', sb: 'c' }), L(spl, sw, 'fiber', { len: 60, sa: 'a', sb: 'a' }), L(spl, sw, 'fiber', { len: 80, sa: 'b', sb: 'b' }), L(sw, pz, 'patch', { sa: 'c' }), L(pz, mz, 'patch'), L(mz, tz, 'patch')];
        return { nodes: [ta, tz, ma, ba, tap, spl, sw, pz, mz], links, g: { nch: 16, df: 75, launch: 0 }, svc: { a: ta.id, z: tz.id } };
      }
    },
    odf: {
      name: 'Patch panels: connector loss and a dirty port', build() {
        const ta = N('trx', 'TRX-A', 50, 200, { mode: 'zrp400' }), tz = N('trx', 'TRX-Z', 1230, 200, { mode: 'zrp400' });
        const ma = N('mux', 'MUX-A', 180, 280), ba = N('edfa', 'BST-A', 310, 280, { gmin: 5 }), oa = N('panel', 'ODF-A', 460, 280, { ports: 12 });
        const ob = N('panel', 'ODF-B', 820, 280, { ports: 12, dirty: { 1: 1.8 } }), pb = N('edfa', 'PRE-B', 960, 280, { gmin: 5 }), mb = N('mux', 'MUX-B', 1090, 280);
        // The booster is patched to the front of ODF-A port 1; the fiber runs from the rear of that port to the rear of ODF-B port 1; the pre-amp hangs off its front.
        // Every mated connector pair costs 0.5 dB, and the connector on ODF-B port 1 is dirty: 1.8 dB more. Clean it in the inspector (Dirty connectors).
        const links = [L(ta, ma, 'patch'), L(ma, ba, 'patch'), L(ba, oa, 'patch', { sb: 'f1' }), L(oa, ob, 'fiber', { len: 60, sa: 'r1', sb: 'r1' }), L(ob, pb, 'patch', { sa: 'f1' }), L(pb, mb, 'patch'), L(mb, tz, 'patch')];
        return { nodes: [ta, tz, ma, ba, oa, ob, pb, mb], links, g: { nch: 16, df: 75, launch: 0 }, svc: { a: ta.id, z: tz.id } };
      }
    },
    sfp10: {
      name: 'Switch 10G DWDM optics over 60 km', build() {
        const a1 = N('trx', 'SW-A1', 80, 150, { mode: 'dwdm10' }), a2 = N('trx', 'SW-A2', 80, 290, { mode: 'dwdm10' });
        const ma = N('mux', 'MUX-A', 240, 220), ba = N('edfa', 'BST-A', 380, 220, { gmin: 3, targetRev: -4 });
        const pb = N('edfa', 'PRE-B', 650, 220, { target: -4, targetRev: 0, gmin: 0 }), mb = N('mux', 'MUX-B', 790, 220);
        const b1 = N('trx', 'SW-B1', 940, 150, { mode: 'dwdm10' }), b2 = N('trx', 'SW-B2', 940, 290, { mode: 'dwdm10' });
        return { nodes: [a1, a2, ma, ba, pb, mb, b1, b2], links: [L(a1, ma, 'patch'), L(a2, ma, 'patch'), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 60 }), L(pb, mb, 'patch'), L(mb, b1, 'patch'), L(mb, b2, 'patch')],
          g: { nch: 8, df: 100, launch: 0 }, svc: { a: a1.id, z: b1.id } };
      }
    },
    sfp10dcm: {
      name: 'Switch 10G over 120 km with a DCM', build() {
        const a1 = N('trx', 'SW-A1', 80, 220, { mode: 'dwdm10f' }), ma = N('mux', 'MUX-A', 230, 220), ba = N('edfa', 'BST-A', 370, 220, { gmin: 3, targetRev: -4 });
        const pb = N('edfa', 'PRE-B', 640, 220, { target: 2, targetRev: 0, gmin: 0 }), dc = N('dcm', 'DCM-B', 780, 220, { cd: -1360, il: 7 }), mb = N('mux', 'MUX-B', 920, 220), b1 = N('trx', 'SW-B1', 1060, 220, { mode: 'dwdm10f' });
        return { nodes: [a1, ma, ba, pb, dc, mb, b1], links: [L(a1, ma, 'patch'), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 120 }), L(pb, dc, 'patch'), L(dc, mb, 'patch'), L(mb, b1, 'patch')],
          g: { nch: 8, df: 100, launch: 0 }, svc: { a: a1.id, z: b1.id } };
      }
    },
    mix: {
      name: 'Mixed line: 10G beside 400G', build() {
        const a = N('trx', 'SW-A', 80, 220, { mode: 'dwdm10f' }), ma = N('mux', 'MUX-A', 230, 220), ba = N('edfa', 'BST-A', 370, 220, { gmin: 3, targetRev: -3 });
        const pb = N('edfa', 'PRE-B', 640, 220, { target: -3, gmin: 0, targetRev: 0 }), mb = N('mux', 'MUX-B', 790, 220), z = N('trx', 'SW-B', 940, 220, { mode: 'dwdm10f' });
        const plan = [];
        for (let s = 24; s < 40; s++) plan.push({ slot: s, mode: s === 30 || s === 32 ? 'dwdm10f' : 'zrp400', off: s === 30 || s === 32 ? -3 : 0, svc: s === 31 });
        plan[7].mode = 'dwdm10f'; plan[7].off = -3; // slot 31 is the service: the 10G channel in the middle
        return { nodes: [a, ma, ba, pb, mb, z], links: [L(a, ma, 'patch'), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 60 }), L(pb, mb, 'patch'), L(mb, z, 'patch')],
          g: { nch: plan.length, df: 75, launch: 0, plan }, svc: { a: a.id, z: z.id } };
      }
    },
    dark: {
      name: 'Dark fiber: unamplified ZR', build() {
        const a = N('trx', 'TRX-A', 150, 220), z = N('trx', 'TRX-Z', 800, 220);
        return { nodes: [a, z], links: [L(a, z, 'fiber', { len: 25, extra: 1.5 })], g: { nch: 1, df: 75, launch: 0 }, svc: { a: a.id, z: z.id } };
      }
    },
  };

  // ---------- span list import ----------
  // Builds a point-to-point line from CSV rows "km[, fiber[, extra_dB[, label]]]": TRX - MUX - booster - (ILA between spans) - preamp - MUX - TRX.
  // Blank lines, # comments and a header row are skipped. Returns { topo, errors, spans }; topo is null if no span parsed.
  const FIBER_ALIAS = { smf: 'smf', g652: 'smf', 'g.652': 'smf', ssmf: 'smf', leaf: 'leaf', nzdsf: 'leaf', g655: 'leaf', 'g.655': 'leaf', ull: 'ull', g654: 'ull', 'g.654': 'ull', legacy: 'legacy' };
  function fromSpans(text, mode = 'zrp400') {
    const errors = [], spans = [];
    String(text).split(/\r?\n/).forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim();
      if (!line) return;
      const c = line.split(/[,;\t]/).map(x => x.trim());
      if (!Number.isFinite(+c[0]) || c[0] === '') { if (spans.length || i > 0) errors.push(`Line ${i + 1}: "${c[0]}" is not a length in km.`); return; } // first non-numeric row = header
      const km = +c[0], fkey = (c[1] || 'smf').toLowerCase().replace(/[\s-]/g, ''), extra = c[2] === undefined || c[2] === '' ? 1 : +c[2];
      if (!(km > 0 && km <= 1000)) return errors.push(`Line ${i + 1}: length ${c[0]} km must be between 0 and 1000.`);
      if (!FIBER_ALIAS[fkey]) return errors.push(`Line ${i + 1}: unknown fiber "${c[1]}". Use smf, leaf, ull or legacy.`);
      if (!Number.isFinite(extra) || extra < 0 || extra > 30) return errors.push(`Line ${i + 1}: extra loss "${c[2]}" dB must be 0 to 30.`);
      spans.push({ km, fiber: FIBER_ALIAS[fkey], extra });
    });
    if (spans.length > 40) { errors.push('More than 40 spans: only the first 40 were used.'); spans.length = 40; }
    if (!spans.length) return { topo: null, errors: errors.length ? errors : ['No spans found. One per line: km, fiber, extra loss dB.'], spans };
    const X = 150, y = 220, nodes = [], links = [];
    const add = (type, name, p) => { const n = N(type, name, 60 + nodes.length * X, y, p); nodes.push(n); return n; };
    const a = add('trx', 'TRX-A', { mode }), ma = add('mux', 'MUX-A'), ba = add('edfa', 'BST-A', { gmin: 5 });
    let prev = ba;
    spans.forEach((sp, i) => {
      const last = i === spans.length - 1, nx = last ? add('edfa', 'PRE-B') : add('edfa', `ILA-${i + 1}`);
      links.push(L(prev, nx, 'fiber', { len: sp.km, fiber: sp.fiber, extra: sp.extra })); prev = nx;
    });
    const mb = add('mux', 'MUX-B'), z = add('trx', 'TRX-Z', { mode });
    links.unshift(L(a, ma, 'patch'), L(ma, ba, 'patch'));
    links.push(L(prev, mb, 'patch'), L(mb, z, 'patch'));
    return { topo: { nodes, links, g: { nch: 16, df: 75, launch: 0 }, svc: { a: a.id, z: z.id } }, errors, spans };
  }

  // Resilience assumptions: fiber cuts per 1000 km per year, mean time to repair (h), loss-of-signal detection and switch time (ms) for 1+1,
  // extra turn-up time for a dark shared protection route (s), and control-plane restoration time for an unprotected channel (s).
  const RESIL = { cutRate: 3, mttr: 12, detectMs: 5, switchMs: 30, sharedSec: 3, restoreSec: 60, devRate: 0.02 };

  // ---------- channel plan ----------
  // g.plan = null (identical channels, g.nch of them) or [{ slot, mode, off (dB vs the service), svc, from, to, via }]. Slots index the C-band grid.
  // A slot can be used by several channels as long as their routes share no fiber (wavelength reuse); on a shared fiber the later one is blocked.
  const nodeId = v => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : '');
  function sanitizePlan(p, df) {
    if (!Array.isArray(p) || !p.length) return null;
    const slots = PHY_.cBandSlots(df * 1e9), seen = new Set(), out = [];
    for (const c of p) {
      if (!c || typeof c !== 'object') continue;
      const slot = Math.round(+c.slot);
      const key = slot + '|' + nodeId(c.from) + '|' + nodeId(c.to) + '|' + nodeId(c.via) + '|' + nodeId(c.conv); // the same slot may repeat on different routes
      if (!Number.isFinite(slot) || slot < 0 || slot >= slots || seen.has(key)) continue;
      seen.add(key);
      out.push({ slot, mode: PHY_.MODES[c.mode] ? c.mode : 'zrp400', off: Math.min(10, Math.max(-10, Number.isFinite(+c.off) && c.off !== '' && c.off !== null ? +c.off : 0)), svc: !!c.svc, from: nodeId(c.from), to: nodeId(c.to), via: nodeId(c.via), conv: nodeId(c.conv), slot2: Number.isFinite(+c.slot2) && c.slot2 !== '' && c.slot2 !== null && +c.slot2 >= 0 && +c.slot2 < slots ? Math.round(+c.slot2) : slot, prot: c.prot === '1+1' ? '1+1' : c.prot === 'shared' ? 'shared' : '', slotRev: Number.isFinite(+c.slotRev) && c.slotRev !== '' && c.slotRev !== null && typeof c.slotRev !== 'boolean' && +c.slotRev >= 0 && +c.slotRev < slots && Math.round(+c.slotRev) !== slot ? Math.round(+c.slotRev) : null });
      if (out.length >= 96) break;
    }
    if (!out.length) return null;
    out.sort((a, b) => a.slot - b.slot);
    const first = out.findIndex(c => c.svc);
    out.forEach((c, i) => { c.svc = i === (first >= 0 ? first : Math.floor(out.length / 2)); if (c.svc || c.from === c.to) { if (c.svc) c.from = c.to = ''; else c.to = ''; } if (c.svc) { c.via = ''; c.conv = ''; } if (c.conv) c.via = ''; });
    return out;
  }
  // Turn the uniform line into an editable plan: the same block of channels, service in the middle.
  function planFromUniform(g, svcMode) {
    const df = +g.df * 1e9, ch = buildChans(g, svcMode, false, PHY_.cBandSlots(df), df);
    return ch.map(c => ({ slot: c.slot, mode: c.mode, off: 0, svc: c.svc, from: '', to: '', via: '', conv: '', slot2: c.slot, prot: '' }));
  }
  // The same plan on a different grid: each channel keeps its frequency, collisions drop.
  function remapPlan(plan, oldDf, newDf) {
    if (!plan) return plan;
    const slots = PHY_.cBandSlots(newDf * 1e9), seen = new Set(), out = [];
    for (const c of plan) { const s = Math.floor((c.slot + 0.5) * oldDf / newDf), key = s + '|' + c.from + '|' + c.to + '|' + c.via + '|' + c.conv; if (s >= slots || seen.has(key)) continue; seen.add(key); out.push({ ...c, slot: s, slot2: Math.min(slots - 1, Math.floor(((c.slot2 ?? c.slot) + 0.5) * oldDf / newDf)) }); }
    return sanitizePlan(out, newDf);
  }

  // ---------- validation ----------
  // Takes untrusted topology JSON (localStorage or pasted import) and returns a clean {nodes, links, g, svc}.
  // Unknown device types and links to missing devices are dropped; missing or non-numeric parameters get defaults.
  const SPLIT = { '50/50': [0.5, 0.5], '60/40': [0.6, 0.4], '70/30': [0.7, 0.3], '80/20': [0.8, 0.2], '90/10': [0.9, 0.1], '95/5': [0.95, 0.05], '99/1': [0.99, 0.01] }; // power share of ports a and b
  const splitLossDb = (n, port) => -10 * Math.log10((SPLIT[n.p.ratio] || SPLIT['50/50'])[port === 'b' ? 1 : 0]) + (+n.p.excess || 0); // from the common port to a branch (and back)
  const isTriPort = n => !!n && (n.type === 'splitter' || n.type === 'switch'); // a common port c and two branches a and b
  // The side of an OADM (e, w), or the degree of a ROADM ('1'..'9'), that one end of a cable uses. `given` is kept if valid; otherwise an OADM takes the side the
  // neighbour lies on, a ROADM the first degree no other line cable uses. A transponder cable on a ROADM that is not directionless belongs to a degree too.
  function sideFor(me, other, given, usedDeg) {
    if (!me) return '';
    if (me.type === 'oadm') return ['e', 'w'].includes(given) && me.p.sides.includes(given) ? given : me.p.sides.length === 1 ? me.p.sides : other.x < me.x ? 'w' : 'e';
    if (me.type === 'panel') { // a port of a patch panel: 'r3' is the rear of port 3, 'f3' its front; light enters one side and leaves the other
      const u = usedDeg.get(me.id) || new Set(), n = me.p.ports; usedDeg.set(me.id, u);
      const m = /^([rf])(\d{1,2})$/.exec(String(given || '')); if (m && +m[2] >= 1 && +m[2] <= n) { u.add(given); return given; }
      for (let k = 1; k <= n; k++) { if (u.has('r' + k) && !u.has('f' + k)) { u.add('f' + k); return 'f' + k; } if (u.has('f' + k) && !u.has('r' + k)) { u.add('r' + k); return 'r' + k; } } // the other side of a port already in use
      for (let k = 1; k <= n; k++) if (!u.has('r' + k) && !u.has('f' + k)) { u.add('r' + k); return 'r' + k; }
      return '';
    }
    if (isTriPort(me)) { const u = usedDeg.get(me.id) || new Set(); usedDeg.set(me.id, u); let d = ['c', 'a', 'b'].includes(given) ? given : ''; if (!d) d = ['c', 'a', 'b'].find(k => !u.has(k)) || ''; if (d) u.add(d); return d; }
    if (me.type !== 'roadm') return '';
    const ok = /^[1-9]$/.test(given) && +given <= me.p.degrees;
    if (isEnd(other)) return me.p.directionless ? '' : ok ? given : '1';
    const u = usedDeg.get(me.id) || new Set(); usedDeg.set(me.id, u);
    let d = ok ? given : ''; if (!d) for (let k = 1; k <= me.p.degrees; k++) if (!u.has(String(k))) { d = String(k); break; }
    if (d) u.add(d); return d;
  }
  // fill in the sides and degrees of every cable end in place (after a ROADM's add/drop type or an OADM's sides change)
  function assignSides(S) {
    const used = new Map(), by = id => S.nodes.find(n => n.id === id);
    for (const l of S.links) { const A = by(l.a), B = by(l.b); if (!A || !B) continue; l.p.sa = sideFor(A, B, l.p.sa, used); l.p.sb = sideFor(B, A, l.p.sb, used); }
  }
  function sanitize(o) {
    if (!o || typeof o !== 'object' || !Array.isArray(o.nodes) || !Array.isArray(o.links)) throw new Error('not a topology');
    const fill = (def, p) => {
      const out = { ...def }; p = p && typeof p === 'object' ? p : {};
      for (const k in def) {
        const v = p[k];
        if (typeof def[k] === 'number') out[k] = Number.isFinite(+v) && v !== '' && v !== null ? +v : def[k];
        else if (typeof def[k] === 'boolean') out[k] = typeof v === 'boolean' ? v : def[k];
        else if (v !== undefined) out[k] = v;
      }
      return out;
    };
    const seen = new Set(), nodes = [];
    for (const n of o.nodes) {
      if (!n || !TYPES[n.type] || typeof n.id !== 'string' || seen.has(n.id)) continue;
      const p = fill(TYPES[n.type].def(), n.p);
      if (isEnd(n) && !PHY_.MODES[p.mode]) p.mode = TYPES[n.type].def().mode;
      if (n.type === 'mxp') {
        const cs = Array.isArray(n.p && n.p.clients) ? n.p.clients.slice(0, 8) : defaultClients();
        p.clients = cs.map(c => { c = c && typeof c === 'object' ? c : {}; return { optic: PHY_.CLIENT_OPTICS[c.optic] ? c.optic : '100g-lr4', len: Number.isFinite(+c.len) && c.len !== '' && c.len !== null && +c.len >= 0 ? +c.len : 0.1, extra: Number.isFinite(+c.extra) && c.extra !== '' && c.extra !== null && +c.extra >= 0 ? +c.extra : 1 }; });
      }
      { const raw = n.p && typeof n.p === 'object' ? n.p : {}; p.fail = raw.fail === 'dead' || raw.fail === 'degraded' ? raw.fail : ''; p.degDb = Number.isFinite(+raw.degDb) && raw.degDb !== '' && raw.degDb !== null && typeof raw.degDb !== 'boolean' ? Math.min(30, Math.max(0, +raw.degDb)) : 3; }
      if (n.type === 'roadm' || n.type === 'mux' || n.type === 'oadm') {
        const ints = (v, max) => [...new Set((Array.isArray(v) ? v : []).filter(x => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < max))].sort((a, b) => a - b).slice(0, max);
        p.badPorts = ints(n.p && n.p.badPorts, 128); p.badCards = ints(n.p && n.p.badCards, 16);
        if (n.type === 'oadm') {
          const raw = n.p || {}, legacy = Array.isArray(raw.slots) && raw.slots.length && raw.eFirst === undefined ? ints(raw.slots, 128) : null; // an older lab: one list of slots, served from both sides
          const num = (v, d, lo, hi) => (Number.isFinite(+v) && v !== '' && v !== null && typeof v !== 'boolean' ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
          p.sides = ['ew', 'e', 'w'].includes(raw.sides) ? raw.sides : 'ew';
          if (legacy && legacy.length) { p.eFirst = p.wFirst = legacy[0]; p.ePorts = p.wPorts = Math.min(64, legacy[legacy.length - 1] - legacy[0] + 1); }
          else { p.eFirst = num(raw.eFirst, 24, 0, 127); p.ePorts = num(raw.ePorts, 4, 0, 64); p.wFirst = num(raw.wFirst, 24, 0, 127); p.wPorts = num(raw.wPorts, 4, 0, 64); }
          p.osc = raw.osc === true || (raw.p1310 === true && raw.o1310 === 'osc'); p.p1310 = raw.p1310 === true && raw.o1310 !== 'osc'; p.o1310 = PHY_.CLIENT_OPTICS[raw.o1310] && PHY_.CLIENT_OPTICS[raw.o1310].nm === 1310 ? raw.o1310 : '10g-lr'; delete p.slots;
        }
      }
      if (isEnd(n)) {
        p.slot = n.p && Number.isInteger(n.p.slot) && n.p.slot >= 0 && n.p.slot < 128 ? n.p.slot : null;
        p.rxSlot = n.p && Number.isInteger(n.p.rxSlot) && n.p.rxSlot >= 0 && n.p.rxSlot < 128 ? n.p.rxSlot : null;
        p.off = Number.isFinite(+(n.p && n.p.off)) && n.p.off !== '' && n.p.off !== null && typeof n.p.off !== 'boolean' ? Math.min(10, Math.max(-10, +n.p.off)) : 0;
      }
      if (n.type === 'panel') {
        p.ports = Math.min(48, Math.max(1, Math.round(+p.ports) || 12)); p.il = Math.min(3, Math.max(0, Number.isFinite(+p.il) && p.il !== '' && p.il !== null && typeof p.il !== 'boolean' ? +p.il : 0.5));
        const raw = n.p && n.p.dirty && typeof n.p.dirty === 'object' && !Array.isArray(n.p.dirty) ? n.p.dirty : {}; p.dirty = {};
        for (const k of Object.keys(raw).slice(0, 96)) { const i = +k, v = raw[k]; if (Number.isInteger(i) && i >= 1 && i <= p.ports && Number.isFinite(+v) && v !== '' && v !== null && typeof v !== 'boolean' && +v > 0) p.dirty[i] = Math.min(10, +v); } // extra loss of a dirty or damaged connector, by port number
      }
      if (n.type === 'splitter') { p.ratio = SPLIT[p.ratio] ? p.ratio : '50/50'; p.excess = Math.min(3, Math.max(0, Number.isFinite(+p.excess) && p.excess !== '' && p.excess !== null ? +p.excess : 0.3)); }
      if (n.type === 'switch') { p.il = Math.min(10, Math.max(0, Number.isFinite(+p.il) && p.il !== '' && p.il !== null ? +p.il : 1)); p.pos = p.pos === 'b' ? 'b' : 'a'; p.auto = p.auto !== false; p.switchMs = Math.min(1000, Math.max(1, Number.isFinite(+p.switchMs) && p.switchMs !== '' && p.switchMs !== null ? +p.switchMs : 20)); }
      if (n.type === 'otdr') p.pulse = OTDR_PULSES.includes(+p.pulse) ? +p.pulse : 100;
      if (n.type === 'host') { p.ip = parseIp(p.ip) ? String(p.ip).trim() : ''; p.ports = Math.min(8, Math.max(1, Math.round(+p.ports) || 1)); p.speed = HOST_SPEEDS.includes(+p.speed) ? +p.speed : 100; }
      if (n.type === 'roadm') { p.degrees = Math.min(9, Math.max(1, Math.round(+p.degrees) || 4)); p.ports = Math.min(64, Math.max(1, Math.round(+p.ports) || 16)); p.first = Math.min(63, Math.max(0, Math.round(+p.first) || 0)); }
      if (n.type === 'mux') { p.bidi = p.bidi === true; p.role = p.role === 'high' ? 'high' : 'low'; }
      if (n.type === 'oadm') { p.bidi = p.bidi === true; p.eRole = p.eRole === 'high' ? 'high' : 'low'; p.wRole = p.wRole === 'low' ? 'low' : 'high'; }
      if (n.type === 'mux') { p.ports = Math.min(64, Math.max(1, Math.round(+p.ports) || 16)); p.first = Math.min(63, Math.max(0, Math.round(+p.first) || 0)); }
      if (isEnd(n)) p.spare = ['switch', 'ycable'].includes(n.p && n.p.spare) ? n.p.spare : '';
      if (n.type === 'edfa' && p.ctl !== 'auto' && p.ctl !== 'fixed') p.ctl = 'auto';
      if (isEnd(n) && !(p.tx === null || p.tx === '' || Number.isFinite(+p.tx))) p.tx = null;
      if (n.type === 'edfa') p.pinMax = Number.isFinite(+p.pinMax) && p.pinMax !== null && typeof p.pinMax !== 'boolean' ? Math.min(20, Math.max(-10, +p.pinMax)) : 10;
      if (n.type === 'edfa') for (const k of ['target', 'targetRev', 'gainRev', 'nfRev', 'gminRev', 'gmaxRev', 'pmaxRev', 'agcUs']) if (!(p[k] === '' || (p[k] !== null && typeof p[k] !== 'boolean' && Number.isFinite(+p[k])))) p[k] = '';
      if (n.type === 'dcm') for (const k of ['cdRev', 'ilRev']) if (!(p[k] === '' || (p[k] !== null && typeof p[k] !== 'boolean' && Number.isFinite(+p[k])))) p[k] = '';
      seen.add(n.id);
      nodes.push({ id: n.id, type: n.type, name: String(n.name ?? n.id), x: Number.isFinite(+n.x) ? +n.x : 0, y: Number.isFinite(+n.y) ? +n.y : 0, p });
    }
    { const ends = new Set(nodes.filter(isEnd).map(n => n.id)); for (const n of nodes) if (isEnd(n)) n.p.peer = typeof n.p.peer === 'string' && ends.has(n.p.peer) && n.p.peer !== n.id ? n.p.peer : ''; }
    { const rd = new Set(nodes.filter(n => n.type === 'roadm').map(n => n.id)); for (const n of nodes) if (isEnd(n)) { n.p.prot = n.p.prot === '1+1' ? '1+1' : n.p.prot === 'shared' ? 'shared' : ''; n.p.conv = typeof n.p.conv === 'string' && rd.has(n.p.conv) ? n.p.conv : ''; } }
    const lseen = new Set(), links = [], usedDeg = new Map();
    for (const l of o.links) {
      if (!l || typeof l.id !== 'string' || lseen.has(l.id) || !seen.has(l.a) || !seen.has(l.b) || l.a === l.b) continue;
      const kind = l.kind === 'fiber' ? 'fiber' : 'patch', p = fill(linkDefaults(kind), l.p);
      if (kind === 'fiber' && !PHY_.FIBERS[p.fiber]) p.fiber = 'smf';
      p.cutAt = kind === 'fiber' && p.cutAt !== '' && p.cutAt !== null && typeof p.cutAt !== 'boolean' && Number.isFinite(+p.cutAt) && +p.cutAt >= 0 ? Math.min(+p.cutAt, 300) : '';
      { const A0 = nodes.find(n => n.id === l.a), B0 = nodes.find(n => n.id === l.b), inst = x => x && (x.type === 'meter' || x.type === 'otdr'), test = x => x && (x.type === 'panel' || x.type === 'splitter' || x.type === 'switch');
        if ((inst(A0) || inst(B0)) && !((inst(A0) && test(B0)) || (inst(B0) && test(A0)))) continue; // an instrument plugs into a patch panel, splitter or switch port and nothing else
        if ((inst(A0) || inst(B0)) && links.some(q => [q.a, q.b].some(id => id === (inst(A0) ? A0 : B0).id))) continue; }
      if (!['both', 'ab', 'ba'].includes(p.dir)) p.dir = 'both';
      p.ramanFull = p.ramanFull === true; p.single = kind === 'fiber' && p.single === true; // one fiber carrying both directions
      p.srlg = typeof p.srlg === 'string' && /^[\w-]{0,24}$/.test(p.srlg) ? p.srlg : '';
      if (kind === 'fiber') for (const k of ['extraRev', 'ramanRev']) if (!(p[k] === '' || (Number.isFinite(+p[k]) && p[k] !== null && +p[k] >= 0))) p[k] = '';
      if (kind === 'fiber') { if (!['back', 'fwd', 'both'].includes(p.ramanDir)) p.ramanDir = 'back'; p.ramanPumps = Math.min(3, Math.max(1, Math.round(+p.ramanPumps || 1))); }
      if (kind === 'fiber') p.raman = Math.min(PHY_.RAMAN.maxMw, Math.max(0, +p.raman || 0));
      if (kind === 'fiber' && !(p.nch === '' || (Number.isFinite(+p.nch) && +p.nch >= 1))) p.nch = '';
      { const A = nodes.find(n => n.id === l.a), B = nodes.find(n => n.id === l.b), dev = x => x && (x.type === 'mux' || x.type === 'oadm' || x.type === 'roadm');
        const portable = kind === 'patch' && A && B && ((isEnd(A) && dev(B)) || (isEnd(B) && dev(A))); // the port a transponder is plugged into
        p.mport = portable && l.p && Number.isInteger(l.p.mport) && l.p.mport >= 0 && l.p.mport < 64 ? l.p.mport : null;
        // a cable end on an OADM is on its east or west side (by default the side the neighbour lies on); on a ROADM it is a degree, or for a transponder cable
        // on a ROADM whose add/drop is not directionless, the degree its port belongs to
        p.sa = sideFor(A, B, l.p && l.p.sa, usedDeg); p.sb = sideFor(B, A, l.p && l.p.sb, usedDeg);
        // a client cable joins a host port to a transponder (one client port) or a muxponder client port
        const cli = kind === 'patch' && A && B && ((isEnd(A) && B.type === 'host') || (isEnd(B) && A.type === 'host')), host = cli ? (A.type === 'host' ? A : B) : null, end = cli ? (isEnd(A) ? A : B) : null;
        const idx = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : null);
        p.cport = cli ? idx(l.p && l.p.cport, end.type === 'mxp' ? end.p.clients.length : 1) : null; p.hport = cli ? idx(l.p && l.p.hport, host.p.ports) : null; }
      lseen.add(l.id);
      links.push({ id: l.id, a: l.a, b: l.b, kind, p });
    }
    const gi = o.g && typeof o.g === 'object' ? o.g : {};
    const num = (v, d) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : d);
    const g = { nch: Math.min(96, Math.max(1, Math.round(num(gi.nch, 16)))), df: [50, 75, 100, 150].includes(+gi.df) ? +gi.df : 75, launch: num(gi.launch, 0), neighbors: gi.neighbors === 'coh' ? 'coh' : 'same', reopt: gi.reopt === true, plan: null,
      eolSpan: Math.min(5, Math.max(0, num(gi.eolSpan, PHY_.EOL.spanLoss))), eolTrx: Math.min(3, Math.max(0, num(gi.eolTrx, PHY_.EOL.trxPen))),
      rampMs: Math.min(10000, Math.max(0, num(gi.rampMs, 0))), lossPct: Math.min(95, Math.max(1, num(gi.lossPct, PHY_.TRANSIENT.lossPct))), agcUs: Math.min(5000, Math.max(0, num(gi.agcUs, PHY_.TRANSIENT.agcUs))),
      cutRate: Math.min(50, Math.max(0, num(gi.cutRate, RESIL.cutRate))), mttr: Math.min(720, Math.max(0.5, num(gi.mttr, RESIL.mttr))), detectMs: Math.min(1000, Math.max(0, num(gi.detectMs, RESIL.detectMs))),
      switchMs: Math.min(10000, Math.max(0, num(gi.switchMs, RESIL.switchMs))), sharedSec: Math.min(600, Math.max(0, num(gi.sharedSec, RESIL.sharedSec))), restoreSec: Math.min(3600, Math.max(0, num(gi.restoreSec, RESIL.restoreSec))), devRate: Math.min(5, Math.max(0, num(gi.devRate, RESIL.devRate))) };
    g.plan = sanitizePlan(gi.plan, g.df);
    if (g.plan) { const ok = new Set(nodes.filter(n => n.type === 'roadm' || n.type === 'oadm' || isEnd(n)).map(n => n.id)), roadms = new Set(nodes.filter(n => n.type === 'roadm').map(n => n.id)); g.plan.forEach(c => { if (!ok.has(c.from)) c.from = ''; if (!ok.has(c.to)) c.to = ''; if (c.from && c.from === c.to) c.to = ''; if (!roadms.has(c.via)) c.via = ''; if (!roadms.has(c.conv) || c.conv === c.from || c.conv === c.to) c.conv = ''; if (c.conv) c.via = ''; }); }
    const si = o.svc && typeof o.svc === 'object' ? o.svc : {};
    const svc = { a: seen.has(si.a) ? si.a : null, z: seen.has(si.z) ? si.z : null };
    // planner demands (a traffic list for the Planner tab)
    const hostIds = new Set(nodes.filter(n => n.type === 'host').map(n => n.id));
    const flows = (Array.isArray(o.flows) ? o.flows : []).slice(0, 40).map(f => (f && typeof f === 'object' && hostIds.has(f.a) && hostIds.has(f.z) && f.a !== f.z && Number.isFinite(+f.gbps) && f.gbps !== '' && f.gbps !== null && typeof f.gbps !== 'boolean' ? { a: f.a, z: f.z, gbps: Math.min(1600, Math.max(0, +f.gbps)) } : null)).filter(Boolean);
    const demands = (Array.isArray(o.demands) ? o.demands : []).slice(0, 40).map(d => (d && typeof d === 'object' && seen.has(d.a) && seen.has(d.z) && d.a !== d.z && ['roadm', 'trx', 'mxp'].includes((nodes.find(n => n.id === d.a) || {}).type) && ['roadm', 'trx', 'mxp'].includes((nodes.find(n => n.id === d.z) || {}).type)
      ? { a: d.a, z: d.z, mode: PHY_.MODES[d.mode] ? d.mode : 'zrp400', count: Math.min(96, Math.max(1, Math.round(num(d.count, 1)))) } : null)).filter(Boolean);
    return { nodes, links, g, svc, demands, flows };
  }

  // ---------- graph helpers ----------
  const mkGraph = S => {
    const node = id => S.nodes.find(n => n.id === id);
    const link = id => S.links.find(l => l.id === id);
    const linksOf = id => S.links.filter(l => l.a === id || l.b === id);
    const other = (l, id) => (l.a === id ? l.b : l.a);
    const linkName = l => { const a = node(l.a), b = node(l.b); return `${a ? a.name : '?'}–${b ? b.name : '?'}`; };
    return { node, link, linksOf, other, linkName };
  };

  // Failures. A fiber is cut if it is flagged cut or shares a risk group (p.srlg, a shared duct) with a fiber that is. A device (p.fail) is
  // 'dead' (passes no light) or 'degraded' (p.degDb of extra loss, lower output or a worse receiver, by type).
  const isCut = (S, l) => !!l.p.cut || (!!l.p.srlg && S.links.some(o => o !== l && o.p.srlg === l.p.srlg && o.p.cut));
  // A transponder with a spare module (optical switch or y-cable) keeps carrying light when its primary fails.
  const SPARE_LOSS = { switch: 1, ycable: 3.5 };
  const onSpare = n => !!n && isEnd(n) && !!n.p && n.p.fail === 'dead' && !!SPARE_LOSS[n.p.spare];
  // Port and card failures on a ROADM or passive mux: p.badPorts lists failed channel slots (0-based), p.badCards failed cards of PORTS_PER_CARD
  // slots each. Only the channels that join or leave the line at that device are lost; everything else keeps running.
  const PORTS_PER_CARD = 8;
  const portDown = (n, slot) => !!n && !!n.p && ((Array.isArray(n.p.badPorts) && n.p.badPorts.includes(slot)) || (Array.isArray(n.p.badCards) && n.p.badCards.includes(Math.floor(slot / PORTS_PER_CARD))));
  // A passive OADM serves a block of slots on each side: east (eFirst, ePorts) and west (wFirst, wPorts). A transponder is plugged into a port of
  // one side and talks to that side's line; a channel entering from a side in one of that side's slots is dropped. A channel can also not pass
  // through in a slot either side serves (dropped at the input, or in the way of the added channel at the output).
  const P1310_LOSS = 0.6; // the 1310 nm coupler on the line path
  // ---------- instruments: power meter and OTDR ----------
  // Both plug into a test point: a port of a patch panel (the rear or front of a numbered port), a port of a splitter (the tap) or of a switch.
  // The power meter reads the C-band service light at that port against a range of -50 to +10 dBm: below the floor it reads LOW, above the top OVER,
  // which is what happens when you plug a meter into a booster's output. The OTDR launches a pulse at 1625 nm through the test point and traces the fiber:
  // it sees fiber loss, connector and splitter events, breaks and the end of the fiber, until its dynamic range runs out.
  const OTDR_PULSES = [10, 30, 100, 300, 1000, 3000];
  const OTDR_DR = { 10: 12, 30: 16, 100: 22, 300: 27, 1000: 32, 3000: 36 }; // dynamic range in dB of one-way loss, by pulse width (ns): representative
  const METER = { min: -50, max: 10 };
  const PATCH_KM = 0.003; // a patch cord is taken as 3 m
  function meterRead(S, hops, n) {
    const { node } = mkGraph(S), l = S.links.find(x => x.a === n.id || x.b === n.id);
    if (!l) return { status: 'none', why: 'not plugged into anything' };
    const dev = node(l.a === n.id ? l.b : l.a), side = oadmSide(l, dev.id);
    const h = hops.find(x => x.name === dev.name && x.kind === dev.type);
    if (!h) return { status: 'none', why: `no service light passes ${dev.name}`, at: dev.name };
    const dbn = 10 * Math.log10(Math.max(1, h.nch || 1)), T = x => x.sig + dbn;
    const mk = (v, why) => ({ dbm: v, perCh: v - dbn, status: v > METER.max ? 'over' : v < METER.min ? 'low' : 'ok', why, at: dev.name });
    if (dev.type === 'panel') {
      const m = /^([rf])(\d+)$/.exec(side || ''); if (!m) return { status: 'none', why: 'the cable does not name a port', at: dev.name };
      if (+m[2] !== h.port) return { status: 'none', why: `the service light goes through port ${h.port}, not port ${m[2]}`, at: dev.name };
      return side === h.inSide ? mk(T(h.in), `the light arriving at ${dev.name} port ${m[2]}`) : mk(T(h.out), `the light leaving ${dev.name} port ${m[2]}, after the connector pair`);
    }
    if (side === h.inP) return mk(T(h.in), `the light arriving at port ${side.toUpperCase()}`);
    if (side === h.outP) return mk(T(h.out), `the light leaving port ${side.toUpperCase()}`);
    if (dev.type === 'splitter') return mk(T(h.in) - splitLossDb(dev, side), `the tap: ${f1(splitLossDb(dev, side))} dB below the input of the ${dev.p.ratio} splitter`);
    return { status: 'none', why: `the switch is not passing light to port ${side.toUpperCase()}`, at: dev.name };
  }
  function otdrTrace(S, id) {
    const { node } = mkGraph(S), o = node(id); if (!o || o.type !== 'otdr') return null;
    const pulse = OTDR_PULSES.includes(+o.p.pulse) ? +o.p.pulse : 100, DR = OTDR_DR[pulse], dz = 1.5 * pulse * 0.0001, att1625 = 1.1; // dead zone in km; 1625 nm loses a little more than 1550
    const out = { id, name: o.name, pulse, dr: DR, dz, points: [{ km: 0, db: 0 }], events: [], endKm: 0, loss: 0, endWhy: '' };
    const l0 = S.links.find(x => x.a === id || x.b === id); if (!l0) { out.endWhy = 'The OTDR is not plugged into anything.'; return out; }
    let km = 0, loss = 0, cur = l0.a === id ? l0.b : l0.a, arr = oadmSide(l0, cur), prev = l0;
    const sideOf = (l, nid) => (l.a === nid ? l.p.sa : l.p.sb);
    const ev = (kind, name, dl, refl, note) => { // an event at km, merged into the last one when it falls inside the dead zone
      const last = out.events[out.events.length - 1];
      if (last && km - last.km < dz && kind !== 'end' && kind !== 'break') { last.loss += dl; last.refl = Math.max(last.refl, refl); last.name += ' + ' + name; last.note = /merged/.test(last.note || '') ? last.note : (last.note ? last.note + '; ' : '') + 'merged: inside the dead zone'; }
      else out.events.push({ km, kind, name, loss: dl, refl, note });
      loss += dl; out.points.push({ km, db: -(loss - dl) }, { km, db: -loss });
    };
    const finish = why => { out.endKm = km; out.loss = loss; out.endWhy = why; };
    const far = () => loss > DR - 1.5;
    for (let guard = 0; guard < 80; guard++) {
      const n = node(cur); let outSide = null;
      if (isDead(n)) { ev('end', n.name, 0, -30, 'has failed'); return finish(`${n.name} has failed`), out; }
      if (n.type === 'panel') {
        const m = /^([rf])(\d+)$/.exec(arr || ''); if (!m) { ev('end', n.name, 0, -14, 'the cable does not name a port'); return finish(`${n.name}: the cable does not name a port`), out; }
        const dirty = (n.p.dirty && +n.p.dirty[+m[2]]) || 0; ev('connector', `${n.name} port ${m[2]}`, +n.p.il + dirty, dirty > 0.3 ? -30 : -50, dirty > 0.3 ? `dirty or damaged connector (${f1(dirty)} dB extra)` : 'connector pair');
        outSide = (m[1] === 'r' ? 'f' : 'r') + m[2];
      } else if (n.type === 'splitter') {
        const to = arr === 'c' ? 'a' : 'c'; ev('splitter', n.name, splitLossDb(n, arr === 'c' ? 'a' : arr), -60, arr === 'c' ? 'the trace follows branch A; branch B is lit too' : 'combiner direction'); outSide = to;
      } else if (n.type === 'switch') {
        if (arr !== 'c' && arr !== n.p.pos) { ev('end', n.name, 0, -30, 'the switch is on the other port'); return finish(`${n.name} is switched to port ${n.p.pos.toUpperCase()}`), out; }
        ev('switch', n.name, +n.p.il, -55, `passing port ${(arr === 'c' ? n.p.pos : arr).toUpperCase()}`); outSide = arr === 'c' ? n.p.pos : 'c';
      } else { ev('end', n.name, 0, -30, `${(TYPES[n.type] || {}).label || n.type} does not pass 1625 nm light`); return finish(`the pulse is reflected at ${n.name}, which does not pass 1625 nm light`), out; }
      if (far()) { ev('noise', 'noise floor', 0, -90, `the trace sinks into the noise (dynamic range ${DR} dB): use a longer pulse`); return finish('the trace sinks into the noise: use a longer pulse'), out; }
      const nx = S.links.find(x => x !== prev && (x.a === cur || x.b === cur) && sideOf(x, cur) === outSide && !['meter', 'otdr'].includes((node(x.a === cur ? x.b : x.a) || {}).type));
      if (!nx) { ev('end', 'end of fiber', 0, -14, `nothing is cabled to ${n.name} ${outSide.toUpperCase()}: an open connector reflects`); return finish(`nothing is cabled to ${n.name} ${outSide.toUpperCase()}`), out; }
      const nid = nx.a === cur ? nx.b : nx.a;
      if (nx.kind === 'fiber') {
        const len = +nx.p.len || 0, a = (PHY_.FIBERS[nx.p.fiber] || PHY_.FIBERS.smf).att * att1625;
        if (isCut(S, nx)) {
          const at = nx.p.cutAt !== '' && Number.isFinite(+nx.p.cutAt) ? Math.min(len, +nx.p.cutAt) : len / 2, d = nx.a === cur ? at : len - at;
          km += d; loss += a * d; out.points.push({ km, db: -loss }); ev('break', `fiber ${node(nx.a).name}–${node(nx.b).name}`, 0, -14, `a break ${f1(d)} km into the span`); return finish(`the fiber is cut ${f1(d)} km into ${node(nx.a).name}–${node(nx.b).name}`), out;
        }
        const room = DR - 1.5 - loss; // loss the trace can still take before it sinks into the noise
        if (a * len > room) { const d = Math.max(0, room / a); km += d; loss += a * d; out.points.push({ km, db: -loss }); ev('noise', 'noise floor', 0, -90, `the trace sinks into the noise (dynamic range ${DR} dB): use a longer pulse`); return finish('the trace sinks into the noise: use a longer pulse'), out; }
        km += len; loss += a * len; out.points.push({ km, db: -loss });
        if (far()) { ev('noise', 'noise floor', 0, -90, `the trace sinks into the noise (dynamic range ${DR} dB): use a longer pulse`); return finish('the trace sinks into the noise: use a longer pulse'), out; }
        if (+nx.p.extra > 0.05) ev('connector', 'connector / splice', +nx.p.extra, +nx.p.extra > 1 ? -32 : -48, +nx.p.extra > 1 ? 'a lossy joint: dirty connector or poor splice' : 'connector or splice');
      } else {
        km += PATCH_KM; if (isCut(S, nx)) { ev('break', 'patch cord', 0, -14, 'a cut patch cord'); return finish('a patch cord is cut'), out; }
        if (+nx.p.il > 0.01) ev('connector', 'patch cord', +nx.p.il, -50, 'connector');
      }
      prev = nx; cur = nid; arr = sideOf(nx, nid);
      if (guard === 79) return finish('stopped: the path loops'), out;
    }
    return out;
  }

  // ---------- 1310 nm ports and the 1510 nm supervisory channel ----------
  // An OADM's 1310 nm port carries a legacy grey client optic. That light bypasses the C-band filters, so it only sees fiber (about 0.35 dB/km), patch
  // panel ports and the couplers of the OADMs at both ends; amplifiers, ROADMs, muxes and every other active or filtered device block it.
  // The optical supervisory channel (OSC) is different: it sits at 1510 nm, outside the C band, and every amplifier and ROADM on the line has a filter that
  // drops it, regenerates it and adds it again, so it is judged span by span and the chain of sites carries management traffic end to end. Passive muxes,
  // splitters and switches have no such filter and block it.
  const OSC = { name: 'Supervisory channel (1510 nm, 1.25 Gb/s)', nm: 1510, att: 0.25, tx: -3, rxMin: -28, rxMax: -8, filter: 1.0 };
  const optic1310 = k => PHY_.CLIENT_OPTICS[k];
  function band1310(S) {
    const { node, link } = mkGraph(S), out = [], seen = new Set(), ends = S.nodes.filter(n => n.type === 'oadm' && n.p.p1310);
    const sideOf = (l, id) => (l.a === id ? l.p.sa : l.p.sb);
    for (const a of ends) {
      if (isDead(a)) continue;
      for (const l0 of S.links) {
        if (l0.kind !== 'fiber' || (l0.a !== a.id && l0.b !== a.id)) continue;
        let l = l0, cur = a.id, km = 0, extra = P1310_LOSS, why = '', hops = [a.name], b = null;
        for (let guard = 0; guard < 40; guard++) {
          if (isCut(S, l)) { why = `the fiber ${link(l.id) ? node(l.a).name + '–' + node(l.b).name : ''} is cut`; break; }
          km += l.kind === 'fiber' ? +l.p.len : 0;
          const nid = l.a === cur ? l.b : l.a, n = node(nid), arr = sideOf(l, nid); hops.push(n.name);
          if (isDead(n)) { why = `${n.name} has failed`; break; }
          if (n.type === 'oadm' && n.p.p1310) { b = n; extra += P1310_LOSS; break; }
          if (n.type === 'panel') {
            const m = /^([rf])(\d+)$/.exec(arr || ''); if (!m) { why = `${n.name}: the cable does not name a port`; break; }
            const outSide = (m[1] === 'r' ? 'f' : 'r') + m[2], nx = S.links.find(x => x !== l && (x.a === nid || x.b === nid) && sideOf(x, nid) === outSide);
            extra += (+n.p.il || 0) + ((n.p.dirty && +n.p.dirty[+m[2]]) || 0);
            if (!nx) { why = `nothing is cabled to ${n.name} ${outSide.toUpperCase()}`; break; }
            cur = nid; l = nx; continue;
          }
          why = n.type === 'oadm' ? `${n.name} has no 1310 nm port` : `${n.name} (${(TYPES[n.type] || {}).label || n.type}) does not pass 1310 nm light`; break;
        }
        if (b) {
          const key = [a.id, b.id].sort().join('|') + '|' + [l0.id, l.id].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
          const oa = optic1310(a.p.o1310), ob = optic1310(b.p.o1310);
          if (a.p.o1310 !== b.p.o1310) { out.push({ a: a.id, b: b.id, aName: a.name, bName: b.name, status: 'down', why: `${a.name} has ${oa.name} and ${b.name} has ${ob.name}: the ends do not match`, km, loss: null, hops }); continue; }
          const loss = oa.att * km + extra, rx = oa.tx - loss, margin = rx - oa.rxMin; let status = 'up', w = '';
          if (margin < 0) { status = 'down'; w = `Rx ${f1(rx)} dBm is below the ${oa.rxMin} dBm sensitivity`; }
          else if (rx > oa.rxMax + 3) { status = 'down'; w = `Rx ${f1(rx)} dBm overloads the receiver (limit ${oa.rxMax} dBm): add a ${Math.ceil(rx - oa.rxMax)} dB pad`; }
          else if (rx > oa.rxMax) { status = 'warn'; w = `Rx ${f1(rx)} dBm is above the ${oa.rxMax} dBm overload point: add a ${Math.ceil(rx - oa.rxMax)} dB pad`; }
          else if (margin < 3) { status = 'warn'; w = `only ${f1(margin)} dB of margin`; }
          out.push({ a: a.id, b: b.id, aName: a.name, bName: b.name, optic: a.p.o1310, opticName: oa.name, km, loss, tx: oa.tx, rx, margin, rxMin: oa.rxMin, status, why: w, hops });
        } else if (why) {
          const key = a.id + '|' + l0.id; if (seen.has(key)) continue; seen.add(key);
          out.push({ a: a.id, b: null, aName: a.name, bName: '', status: 'blocked', why, km, hops, optic: a.p.o1310, opticName: optic1310(a.p.o1310).name });
        }
      }
    }
    return { links: out };
  }
  // The supervisory channel: sites are the OADMs with the OSC enabled plus every amplifier and ROADM on the line (they all regenerate it). A span runs between two
  // neighbouring sites over fiber and patch panel ports; anything else on the way blocks it. Each span has its own budget; spans that are up join the sites into a domain.
  function oscSpans(S) {
    const { node, link } = mkGraph(S), enabled = S.nodes.filter(n => n.type === 'oadm' && n.p.osc);
    if (!enabled.length) return null;
    const site = n => (n.type === 'oadm' && n.p.osc) || n.type === 'edfa' || n.type === 'roadm', sideOf = (l, id) => (l.a === id ? l.p.sa : l.p.sb), out = [], seen = new Set();
    for (const a of S.nodes.filter(site)) {
      if (isDead(a)) continue;
      for (const l0 of S.links) {
        if (l0.kind !== 'fiber' && l0.kind !== 'patch' || (l0.a !== a.id && l0.b !== a.id)) continue;
        let l = l0, cur = a.id, km = 0, extra = 2 * OSC.filter, why = '', b = null;
        for (let guard = 0; guard < 40; guard++) {
          if (isCut(S, l)) { why = `the fiber ${node(l.a).name}–${node(l.b).name} is cut`; break; }
          km += l.kind === 'fiber' ? +l.p.len : 0;
          const nid = l.a === cur ? l.b : l.a, n = node(nid), arr = sideOf(l, nid);
          if (isDead(n)) { why = `${n.name} has failed`; break; }
          if (site(n)) { b = n; break; }
          if (n.type === 'panel') {
            const m = /^([rf])(\d+)$/.exec(arr || ''); if (!m) { why = `${n.name}: the cable does not name a port`; break; }
            const outSide = (m[1] === 'r' ? 'f' : 'r') + m[2], nx = S.links.find(x => x !== l && (x.a === nid || x.b === nid) && sideOf(x, nid) === outSide);
            extra += (+n.p.il || 0) + ((n.p.dirty && +n.p.dirty[+m[2]]) || 0);
            if (!nx) { why = `nothing is cabled to ${n.name} ${outSide.toUpperCase()}`; break; }
            cur = nid; l = nx; continue;
          }
          if (n.type === 'oadm') { why = `${n.name} has no supervisory channel port`; break; }
          why = `${n.name} (${(TYPES[n.type] || {}).label || n.type}) has no filter for 1510 nm light`; break;
        }
        if (b) {
          const key = [a.id, b.id].sort().join('|') + '|' + [l0.id, l.id].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
          const loss = OSC.att * km + extra, rx = OSC.tx - loss, margin = rx - OSC.rxMin; let status = 'up', w = '';
          if (margin < 0) { status = 'down'; w = `Rx ${f1(rx)} dBm is below the ${OSC.rxMin} dBm sensitivity`; }
          else if (rx > OSC.rxMax + 3) { status = 'down'; w = `Rx ${f1(rx)} dBm overloads the receiver (limit ${OSC.rxMax} dBm): add a ${Math.ceil(rx - OSC.rxMax)} dB pad`; }
          else if (rx > OSC.rxMax) { status = 'warn'; w = `Rx ${f1(rx)} dBm is above the ${OSC.rxMax} dBm overload point: add a ${Math.ceil(rx - OSC.rxMax)} dB pad`; }
          else if (margin < 3) { status = 'warn'; w = `only ${f1(margin)} dB of margin`; }
          out.push({ a: a.id, b: b.id, aName: a.name, bName: b.name, km, loss, tx: OSC.tx, rx, margin, rxMin: OSC.rxMin, status, why: w });
        } else if (why) { const key = a.id + '|' + l0.id; if (!seen.has(key)) { seen.add(key); out.push({ a: a.id, b: null, aName: a.name, bName: '', km, status: 'blocked', why }); } }
      }
    }
    // sites joined by a span that is up form a management domain; only domains that hold an OADM with the OSC enabled are reported
    const par = new Map(S.nodes.filter(site).map(n => [n.id, n.id])), find = x => (par.get(x) === x ? x : (par.set(x, find(par.get(x))), par.get(x)));
    out.forEach(r => { if (r.b && r.status !== 'down' && par.has(r.a) && par.has(r.b)) par.set(find(r.a), find(r.b)); });
    const groups = new Map(); S.nodes.filter(n => site(n) && !isDead(n)).forEach(n => { const k = find(n.id); (groups.get(k) || groups.set(k, []).get(k)).push(n); });
    const domains = [...groups.values()].filter(g => g.some(n => n.type === 'oadm')).map(g => g.map(n => n.name));
    return { links: out, domains };
  }
  const oadmSide = (l, id) => (l ? (l.a === id ? l.p.sa : l.b === id ? l.p.sb : '') : '');
  const oadmRange = (n, side) => { if (!((n.p.sides || 'ew').includes(side))) return [0, 0]; const f = Math.round(+n.p[side + 'First']) || 0; const w = Math.round(+n.p[side + 'Ports']) || 0; return [f, f + (n.p.bidi ? 2 * w : w)]; }; // a BiDi side serves a low and a high band of that many slots each
  const oadmServes = (n, side, slot) => { const [a, b] = oadmRange(n, side); return slot >= a && slot < b; };
  const sideName = s => (s === 'e' ? 'east' : 'west');
  const oadmServed = n => ['e', 'w'].filter(s => oadmRange(n, s)[1] > oadmRange(n, s)[0]).map(s => { const [a, b] = oadmRange(n, s); return `${sideName(s)} slots ${a + 1}${b - a > 1 ? '-' + b : ''}`; }).join(', ') || 'no slots';
  // nodes and the links between them (links[j] joins nodes[j] and nodes[j+1]); returns why a route cannot carry a slot, or ''
  const oadmWhy = (nodes, slot, links, slotRev) => {
    const last = nodes.length - 1;
    for (let k = 0; k <= last; k++) {
      const n = nodes[k]; if (!n || n.type !== 'oadm') continue;
      const sideAt = j => (links && links[j] ? oadmSide(links[j], n.id) : '');
      if (k === 0 || k === last) { const s = k === 0 ? sideAt(0) : sideAt(last - 1); if (!oadmServes(n, s, slot)) return `${n.name} cannot add or drop slot ${slot + 1} on its ${sideName(s)} side (it serves ${oadmServed(n)})`; continue; }
      const joins = k === 1 && isEnd(nodes[0]), drops = k === last - 1 && isEnd(nodes[last]);
      if (joins || drops) { // a transponder plugged into a port: its port side must be the side the route uses
        const ps = joins ? sideAt(0) : sideAt(k), ls = joins ? sideAt(1) : sideAt(k - 1);
        if (!oadmServes(n, ps, slot)) return `${n.name} has no ${sideName(ps)} port for slot ${slot + 1} (it serves ${oadmServed(n)})`;
        if (ls && ls !== ps) return `the transponder is on ${n.name}'s ${sideName(ps)} port but the route uses its ${sideName(ls)} line`;
        continue;
      }
      for (const sl of slotRev != null ? [slot, slotRev] : [slot]) if (oadmServes(n, 'e', sl) || oadmServes(n, 'w', sl)) return `slot ${sl + 1} is dropped by the filter at ${n.name} and cannot pass it`;
    }
    return '';
  };
  // does a route use a port of its device number k (a mux, an end ROADM or OADM, an OADM a transponder is plugged into)
  const usesPort = (nodes, k, links) => {
    const n = nodes[k]; if (!n) return false; const last = nodes.length - 1;
    if (n.type === 'mux') return true;
    if (n.type !== 'oadm' && n.type !== 'roadm') return false;
    const plugged = j => !links || !links[j] || links[j].p.mport != null; // a transponder cable counts as a port only if it is plugged into a numbered one
    return k === 0 || k === last || (k === 1 && isEnd(nodes[0]) && plugged(0)) || (k === last - 1 && isEnd(nodes[last]) && plugged(last - 1));
  };
  const isDead = n => !!n && !!n.p && n.p.fail === 'dead' && !onSpare(n);
  const spareLoss = n => (n && isEnd(n) && n.p && SPARE_LOSS[n.p.spare]) || 0;
  const degOf = n => (n && n.p && n.p.fail === 'degraded' ? (Number.isFinite(+n.p.degDb) ? Math.min(30, Math.max(0, +n.p.degDb)) : 3) : 0);

  // Shortest path (km) from A to Z. Light never passes *through* a transponder. Cut fibers are only used if allowCut.
  // x.ignoreCut: plan on the intact network (cut flags are failures, not topology). x.exclude: link ids the route may not use.
  function route(S, aId, zId, allowCut, x = {}) {
    const { node, linksOf, other } = mkGraph(S);
    // The search state is a device, or for a splitter or switch the device plus the port the light came in by: a common port feeds the two branches,
    // a branch only feeds the common port (never the other branch), and a switch passes its selected branch (the other too, if it is set to auto-switch).
    const dist = { [aId]: 0 }, prev = {}, done = new Set(), plan = x.ignoreCut, idOf = k => k.split('#')[0];
    if (isDead(node(aId)) && !allowCut && !plan) return null;
    let end = null;
    while (true) {
      let u = null, best = Infinity;
      for (const k in dist) if (!done.has(k) && dist[k] < best) { best = dist[k]; u = k; }
      if (u == null) return null;
      const me = idOf(u);
      if (me === zId) { end = u; break; }
      done.add(u);
      const un = node(me), arr = u.includes('#') ? u.split('#')[1] : '';
      if (me !== aId && isEnd(un)) continue;
      for (const l of linksOf(me)) {
        if (prev[u] && prev[u].l === l.id) continue; // light does not turn round on the cable it arrived by
        const cut = isCut(S, l);
        if (cut && !allowCut && !plan) continue;
        if (x.exclude && x.exclude.has(l.id)) continue;
        if ((l.p.dir === 'ab' && l.a !== me) || (l.p.dir === 'ba' && l.b !== me)) continue; // one-way fiber: light only travels the carried way
        const v = other(l, me); if (node(v).type === 'host' || node(v).type === 'meter' || node(v).type === 'otdr') continue; // an instrument or a host hangs off a transponder; light never goes through it
        let extra = 0;
        if (un.type === 'panel' && arr) { const m = /^([rf])(\d+)$/.exec(arr); if (!m || oadmSide(l, me) !== (m[1] === 'r' ? 'f' : 'r') + m[2]) continue; } // in at the rear of a port, out at the front of the same port
        if (isTriPort(un) && arr) {
          const out = oadmSide(l, me); if (arr === 'c' ? out === 'c' : out !== 'c') continue;
          if (un.type === 'switch') { const branch = arr === 'c' ? out : arr; if (branch !== (un.p.pos === 'b' ? 'b' : 'a')) { if (!un.p.auto) continue; extra = 0.5; } }
        }
        const dead = isDead(node(v));
        if (dead && !allowCut && !plan) continue;
        if (x.excludeNodes && x.excludeNodes.has(v) && v !== zId) continue;
        const w = (l.kind === 'fiber' ? +l.p.len : 0.01) + 0.01 + extra + (cut && !plan ? 1e6 : 0) + (dead && !plan ? 1e6 : 0), vk = isTriPort(node(v)) || node(v).type === 'panel' ? v + '#' + oadmSide(l, v) : v;
        if (dist[vk] == null || dist[u] + w < dist[vk]) { dist[vk] = dist[u] + w; prev[vk] = { u, l: l.id }; }
      }
    }
    const nodes = [idOf(end)], links = [];
    let c = end;
    while (c !== aId) { links.unshift(prev[c].l); c = prev[c].u; nodes.unshift(idOf(c)); }
    return { nodes, links };
  }

  // ---------- hosts: reachability and traffic over the optical network ----------
  const HOST_SPEEDS = [1, 10, 25, 40, 50, 100, 200, 400, 800];
  const LAT = { fiberUsPerKm: 4.9, coherentUs: 10, directUs: 1 }; // propagation in glass, and the DSP/FEC delay of one coherent (or one direct-detect) transceiver; representative
  function parseIp(str) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(String(str || '').trim()); if (!m) return null;
    const o = m.slice(1, 5).map(Number), pl = +m[5]; if (o.some(x => x > 255) || pl > 32) return null;
    const addr = (((o[0] << 24) >>> 0) + (o[1] << 16) + (o[2] << 8) + o[3]) >>> 0, mask = pl === 0 ? 0 : (0xFFFFFFFF << (32 - pl)) >>> 0;
    return { addr, mask, net: (addr & mask) >>> 0, pl, text: `${o.join('.')}/${pl}` };
  }
  const fmtNet = x => [24, 16, 8, 0].map(sh => (x.net >>> sh) & 255).join('.') + '/' + x.pl;
  // the lit channels that could carry host traffic: one entry per plan channel (or the service alone), with the two transponders at its ends
  function channelTable(S, res) {
    const E = effective(S), plan = E.g.plan, a = S.svc && S.svc.a, z = S.svc && S.svc.z, out = [];
    if (Array.isArray(plan) && plan.length && res && res.channels) plan.forEach((c, i) => { const ch = res.channels[i]; if (c.filler || !ch) return; out.push({ i, slot: c.slot, a: c.svc || !c.from ? a : c.from, z: c.svc || !c.to ? z : c.to, ch, mode: PHY_.MODES[c.mode] || res.mode }); });
    else if (res && res.mode) out.push({ i: -1, slot: null, a, z, ch: { status: res.status, notes: res.status === 'up' ? [] : [res.headline], routeLinks: res.path ? res.path.links : [], routeNodes: res.path ? res.path.nodes : [], qMargin: res.qMargin, rate: res.mode.rate }, mode: res.mode });
    return out;
  }
  // One-way latency in microseconds along a channel: fiber, any dispersion-compensating fiber, and the two transceivers
  function latencyUs(S, entry) {
    const { link, node } = mkGraph(S); let us = 0, km = 0;
    for (const id of entry.ch.routeLinks || []) { const l = link(id); if (l && l.kind === 'fiber') { km += +l.p.len; us += +l.p.len * LAT.fiberUsPerKm; } }
    for (const id of entry.ch.routeNodes || []) { const n = node(id); if (n && n.type === 'dcm') us += Math.abs(+n.p.cd) / 17 * LAT.fiberUsPerKm; }
    us += 2 * (entry.mode && entry.mode.coh === false ? LAT.directUs : LAT.coherentUs);
    return { us, km };
  }
  // Can host A reach host Z? Every step the packet needs is checked in order, so the first one that fails says what is wrong:
  // the client cable and optic at each end, the transponders, the channel between them, its optical status, and the addresses.
  function reach(S, res) {
    const { node } = mkGraph(S), hosts = S.nodes.filter(n => n.type === 'host'), tbl = channelTable(S, res), out = [];
    const dark = new Map(((res && res.derived && res.derived.dark) || []).map(d => [d.id, d.why]));
    const cables = h => S.links.filter(l => l.kind === 'patch' && (l.a === h.id || l.b === h.id)).map(l => ({ l, end: node(l.a === h.id ? l.b : l.a) })).filter(x => x.end && isEnd(x.end));
    // the client side of one host cable: does the host port match the transponder's client port, and is that port itself healthy
    const side = (h, c, steps) => {
      const e = c.end, hp = c.l.p.hport == null ? 0 : c.l.p.hport, cp = c.l.p.cport == null ? 0 : c.l.p.cport;
      steps.push({ ok: true, text: `${h.name} port ${hp + 1} is cabled to ${e.name}${e.type === 'mxp' ? ` client port ${cp + 1}` : ''}` });
      const m = PHY_.MODES[e.p.mode];
      if (e.type === 'trx') {
        if (+h.p.speed !== m.rate) { steps.push({ ok: false, text: `${e.name} is a ${m.rate}G transponder (${m.short}) but ${h.name}'s port is ${h.p.speed}G: the client link cannot come up` }); return null; }
        steps.push({ ok: true, text: `${h.name}'s ${h.p.speed}G port matches the ${m.rate}G ${e.name}` });
        return { e, rate: m.rate, cp: 0 };
      }
      const cl = e.p.clients[cp]; if (!cl) { steps.push({ ok: false, text: `${e.name} has no client port ${cp + 1}` }); return null; }
      const b = PHY_.clientBudget(cl);
      if (+h.p.speed !== b.optic.rate) { steps.push({ ok: false, text: `${e.name} client port ${cp + 1} is a ${b.optic.name} (${b.optic.rate}G) but ${h.name}'s port is ${h.p.speed}G` }); return null; }
      if (b.status === 'down') { steps.push({ ok: false, text: `${e.name} client port ${cp + 1}: ${b.notes[0]}` }); return null; }
      const total = e.p.clients.reduce((t, c) => t + PHY_.CLIENT_OPTICS[c.optic].rate, 0);
      if (total > m.rate) { steps.push({ ok: false, text: `${e.name}'s client ports add up to ${total}G, more than the ${m.short} line port carries (${m.rate}G)` }); return null; }
      steps.push({ ok: true, text: `Client port ${cp + 1} (${b.optic.name}) has ${b.margin.toFixed(1)} dB of margin${b.status === 'warn' ? ': ' + b.notes[0] : ''}` });
      return { e, rate: b.optic.rate, cp };
    };
    for (let i = 0; i < hosts.length; i++) for (let j = i + 1; j < hosts.length; j++) {
      const A = hosts[i], Z = hosts[j], ca = cables(A), cz = cables(Z); let best = null;
      const attempts = ca.length && cz.length ? ca.flatMap(x => cz.map(y => [x, y])) : [[null, null]];
      for (const [x, y] of attempts) {
        const steps = [], fail = text => { steps.push({ ok: false, text }); return { steps, ok: false }; };
        let r;
        if (!x) r = fail(!ca.length ? `${A.name} is not cabled to a transponder or muxponder` : `${Z.name} is not cabled to a transponder or muxponder`);
        else {
          const sa = side(A, x, steps), sz = sa ? side(Z, y, steps) : null;
          if (!sa || !sz) r = { steps, ok: false };
          else if (dark.get(sa.e.id)) r = fail(`${sa.e.name} is dark: ${dark.get(sa.e.id)}`);
          else if (dark.get(sz.e.id)) r = fail(`${sz.e.name} is dark: ${dark.get(sz.e.id)}`);
          else if (sa.e === sz.e) r = fail(`${A.name} and ${Z.name} hang off the same ${sa.e.type === 'mxp' ? 'muxponder' : 'transponder'}, ${sa.e.name}: it does not switch between its own ports, so this traffic never reaches the line`);
          else if (sa.e.type !== sz.e.type) r = fail(`${sa.e.name} is a ${sa.e.type === 'mxp' ? 'muxponder' : 'transponder'} and ${sz.e.name} a ${sz.e.type === 'mxp' ? 'muxponder' : 'transponder'}: their client sides do not map onto each other`);
          else if (sa.e.type === 'mxp' && sa.cp !== sz.cp) r = fail(`${sa.e.name} client port ${sa.cp + 1} is carried to client port ${sa.cp + 1} on the far muxponder, but ${Z.name} is on ${sz.e.name} client port ${sz.cp + 1}`);
          else {
            const en = tbl.find(t => (t.a === sa.e.id && t.z === sz.e.id) || (t.a === sz.e.id && t.z === sa.e.id));
            if (!en) r = fail(`no channel connects ${sa.e.name} and ${sz.e.name}${res && res.derived ? ': plug each into the port for the same slot, with the same tuning, on a mux, OADM or ROADM on the way' : ': add a channel between them in the Channels tab'}`);
            else if (sa.e.p.mode !== sz.e.p.mode) r = fail(`${sa.e.name} is ${PHY_.MODES[sa.e.p.mode].short} but ${sz.e.name} is ${PHY_.MODES[sz.e.p.mode].short}: the line ports will never lock`);
            else if (['down', 'los', 'blocked', 'nopath', 'standby', 'unreachable'].includes(en.ch.status)) { steps.push({ ok: true, text: `Channel ${en.slot != null ? 'in slot ' + (en.slot + 1) : 'of the service'} joins ${sa.e.name} and ${sz.e.name}` }); r = fail(`the channel is ${en.ch.status.toUpperCase()}: ${(en.ch.notes && en.ch.notes[0]) || 'no light reaches the far end'}`); }
            else {
              steps.push({ ok: true, text: `Channel ${en.slot != null ? 'in slot ' + (en.slot + 1) : 'of the service'} joins ${sa.e.name} and ${sz.e.name} and is ${en.ch.status.toUpperCase()}${en.ch.qMargin != null ? ` (${en.ch.qMargin.toFixed(1)} dB Q margin)` : ''}` });
              const ia = parseIp(A.p.ip), iz = parseIp(Z.p.ip);
              if (ia && iz && ia.addr === iz.addr) r = fail(`both hosts use the address ${ia.text.split('/')[0]}`);
              else if (ia && iz && (ia.net !== iz.net || ia.pl !== iz.pl)) r = fail(`${A.name} is on ${fmtNet(ia)} and ${Z.name} on ${fmtNet(iz)}: different subnets need a router, and a host cannot reach across them`);
              else {
                if (ia && iz) steps.push({ ok: true, text: `Both hosts are on ${fmtNet(ia)}` });
                const lt = latencyUs(S, en);
                r = { steps, ok: true, entry: en, rate: Math.min(sa.rate, sz.rate), latencyUs: lt.us, km: lt.km, degraded: en.ch.status === 'degraded', cp: sa.cp };
              }
            }
          }
        }
        if (!best || (r.ok && !best.ok) || (!r.ok && !best.ok && r.steps.length > best.steps.length)) best = r;
        if (best.ok) break;
      }
      out.push({ a: A.id, z: Z.id, ok: best.ok, degraded: !!best.degraded, steps: best.steps, why: best.ok ? '' : best.steps[best.steps.length - 1].text, latencyUs: best.latencyUs, km: best.km, rate: best.rate, entry: best.entry || null, cp: best.cp });
    }
    return out;
  }
  // The offered traffic (S.flows, Gb/s from one host to another) over the channels the hosts can use. A flow is capped by its host ports and client
  // optics; the flows that share a channel in one direction are scaled down together when they add up to more than the line rate.
  function traffic(S, res) {
    const R = reach(S, res), { node } = mkGraph(S), flows = S.flows || [], chan = new Map(), out = [];
    const find = (a, z) => R.find(r => (r.a === a && r.z === z) || (r.a === z && r.z === a));
    for (const f of flows) {
      const r = find(f.a, f.z), A = node(f.a), Z = node(f.z), cap = A && Z ? Math.min(+A.p.speed, +Z.p.speed) : 0, o = { a: f.a, z: f.z, offered: f.gbps, ok: !!(r && r.ok), why: r ? r.why : 'unknown hosts', delivered: 0, lossPct: 100, latencyUs: r ? r.latencyUs : null, slot: r && r.entry ? r.entry.slot : null };
      if (r && r.ok) {
        const want = Math.min(f.gbps, cap, r.rate), key = (r.entry.i) + '|' + (r.a === f.a ? 'ab' : 'ba');
        if (!chan.has(key)) chan.set(key, { slot: r.entry.slot, dir: key.split('|')[1], cap: r.entry.ch.rate || (r.entry.mode && r.entry.mode.rate), load: 0, flows: [], a: r.a === f.a ? r.a : r.z, z: r.a === f.a ? r.z : r.a });
        const c = chan.get(key); c.load += want; c.flows.push(o); o.want = want;
      }
      out.push(o);
    }
    for (const c of chan.values()) { const k = c.cap ? Math.min(1, c.cap / c.load) : 1; c.util = c.cap ? Math.min(1, c.load / c.cap) : 0; c.over = c.load > c.cap; for (const o of c.flows) { o.delivered = o.want * k; o.lossPct = o.offered > 0 ? 100 * (1 - o.delivered / o.offered) : 0; } }
    return { flows: out, channels: [...chan.values()] };
  }

  // ---------- channels defined by the cabling ----------
  // A transponder plugged into a numbered port of a passive mux (link.p.mport) is tuned to a slot (p.slot, or the port's own when auto). Port k of a
  // mux passes slot first+k. The channels are then what the cabling makes: a transmitter whose tuning matches its port reaches the receiver plugged into
  // the port of the same slot on another mux; anything else is dark, with a reason. Returns null for a topology that does not use mux ports.
  function derive(S) {
    const { node, link } = mkGraph(S), g = S.g || {}, slotsN = PHY_.cBandSlots(+g.df * 1e9), atts = [], dev = x => x.type === 'mux' || x.type === 'oadm' || x.type === 'roadm';
    for (const l of S.links) {
      if (l.kind !== 'patch' || !Number.isInteger(l.p.mport)) continue;
      const a = node(l.a), b = node(l.b); if (!a || !b) continue;
      const t = isEnd(a) ? a : isEnd(b) ? b : null, m = t && dev(a) ? a : t && dev(b) ? b : null;
      if (t && m) atts.push({ t, m, l, port: l.p.mport, side: m.type === 'oadm' ? oadmSide(l, m.id) || 'e' : m.type === 'roadm' && !m.p.directionless ? oadmSide(l, m.id) || '1' : '' });
    }
    if (!atts.length) return null;
    const dirText = a => (a.m.type === 'oadm' ? sideName(a.side) + ' ' : a.m.type === 'roadm' && a.side ? `degree ${a.side} ` : '');
    const portName = a => `${a.m.name} ${dirText(a)}port ${a.port + 1}`;
    const colored = a => a.m.type !== 'roadm' || !a.m.p.colorless; // a colorless ROADM port passes any slot
    const firstOf = a => (a.m.type === 'oadm' ? oadmRange(a.m, a.side)[0] : Math.round(+a.m.p.first) || 0), capOf = a => (a.m.type === 'oadm' ? Math.round(+a.m.p[a.side + 'Ports']) || 0 : Math.round(+a.m.p.ports));
    const isBidi = a => a.m.type !== 'roadm' && a.m.p.bidi === true;
    const dark = new Map(), mark = (id, why) => { if (!dark.has(id)) dark.set(id, why); }, ok = [], byPort = new Map(), seenT = new Set(), bySlot = new Map();
    for (const a of atts) {
      if (seenT.has(a.t.id)) continue; seenT.add(a.t.id);
      const key = a.m.id + '|' + a.side + '|' + a.port, other = byPort.get(key);
      if (other) { mark(a.t.id, `${a.t.name} is plugged into ${portName(a)}, which ${other.t.name} already uses`); continue; }
      byPort.set(key, a); const pslot = firstOf(a) + a.port;
      // a BiDi (single-fiber) port passes a pair of slots: the low band and the high band, one for each direction; the role says which is transmit
      a.bidi = isBidi(a);
      if (a.bidi) { const n = capOf(a), role = a.m.type === 'oadm' ? a.m.p[a.side + 'Role'] : a.m.p.role, low = firstOf(a) + a.port, high = firstOf(a) + n + a.port; a.ptx = role === 'low' ? low : high; a.prx = role === 'low' ? high : low; } else a.ptx = a.prx = pslot;
      if (a.port >= capOf(a) || (colored(a) && Math.max(a.ptx, a.prx) >= slotsN)) { mark(a.t.id, `${a.m.name} has no ${dirText(a)}port ${a.port + 1} on this grid (it has ${capOf(a)}${colored(a) ? ` from slot ${firstOf(a) + 1}${a.bidi ? ' in each of its two bands' : ''}, the grid has ${slotsN} slots` : ''})`); continue; }
      a.tuned = Number.isInteger(a.t.p.slot) ? a.t.p.slot : a.ptx;
      a.slot = colored(a) ? a.ptx : a.tuned; // a colored port passes its own slot; a colorless one passes whatever the transponder is tuned to
      if (a.tuned !== a.slot || a.slot >= slotsN) { mark(a.t.id, a.slot >= slotsN ? `${a.t.name} is tuned to slot ${a.tuned + 1}, which is not on this grid` : `${a.t.name} is tuned to slot ${a.tuned + 1} but plugged into ${portName(a)}, which ${a.bidi ? 'transmits' : 'passes'} slot ${a.slot + 1}: the filter blocks it`); continue; }
      a.tx = a.slot; a.rx = a.bidi ? (Number.isInteger(a.t.p.rxSlot) ? a.t.p.rxSlot : a.prx) : a.slot;
      if (a.bidi && a.rx !== a.prx) { mark(a.t.id, `${a.t.name} listens on slot ${a.rx + 1} but ${portName(a)} delivers slot ${a.prx + 1} to it: it would hear nothing`); continue; }
      // a ROADM that is not contentionless can add a slot at only one port, whichever degree it leaves by
      if (a.m.type === 'roadm' && !a.m.p.contentionless) { const k = a.m.id + '|' + a.slot, o = bySlot.get(k); if (o) { mark(a.t.id, `${a.t.name} and ${o.t.name} are both tuned to slot ${a.slot + 1} on ${a.m.name}, which is not contentionless: only one can be added`); continue; } bySlot.set(k, a); }
      ok.push(a);
    }
    // a transponder on a side of an OADM, or a port of a ROADM that is not directionless, talks to that side's (degree's) line only: the route may not leave or arrive by another one
    const wrongSide = a => (a.m.type === 'oadm' || (a.m.type === 'roadm' && !a.m.p.directionless) ? S.links.filter(l => (l.a === a.m.id || l.b === a.m.id) && oadmSide(l, a.m.id) !== a.side).map(l => l.id) : []);
    const kmOf = r => r.links.reduce((t, id) => t + (link(id).kind === 'fiber' ? +link(id).p.len : 0), 0), used = new Set(), pairs = [];
    for (const a of ok) {
      if (used.has(a.t.id)) continue;
      let best = null, bestKm = Infinity;
      for (const b of ok) {
        // each end transmits what the other receives; with a converter set on either end the two slots may differ, but the partner must then be named
        const cv = a.t.p.conv || b.t.p.conv, named = a.t.p.peer === b.t.id || b.t.p.peer === a.t.id;
        if (b === a || used.has(b.t.id) || b.m === a.m || b.bidi !== a.bidi || (cv ? !named || a.bidi : b.tx !== a.rx || b.rx !== a.tx)) continue;
        if (a.t.p.peer ? a.t.p.peer !== b.t.id : b.t.p.peer && b.t.p.peer !== a.t.id) continue; // a far end named by 'Connect to' is reserved for its partner
        const r = route(S, a.t.id, b.t.id, true, { ignoreCut: true, exclude: new Set([...wrongSide(a), ...wrongSide(b)]) }); if (!r) continue;
        const km = kmOf(r); if (km < bestKm) { best = b; bestKm = km; }
      }
      if (!best && a.bidi) {
        const twin = ok.find(b => b !== a && b.m !== a.m && b.bidi && b.tx === a.tx), half = ok.find(b => b !== a && b.m !== a.m && b.bidi && b.rx === a.tx);
        mark(a.t.id, twin ? `${a.t.name} and ${twin.t.name} both transmit on slot ${a.tx + 1}: on a single fiber each end needs its own wavelength (one end on the low band, the other on the high band)`
          : half ? `${a.t.name} transmits slot ${a.tx + 1} and listens on slot ${a.rx + 1}, but ${half.t.name} transmits slot ${half.tx + 1}: each end must transmit the slot the other listens on`
          : `${a.t.name} has no partner: a single-fiber port transmits slot ${a.tx + 1} and listens on slot ${a.rx + 1}, so the far end has to be a single-fiber port that transmits slot ${a.rx + 1} and listens on slot ${a.tx + 1}`);
        continue;
      }
      if (!best && a.t.p.conv && !a.t.p.peer) { mark(a.t.id, `${a.t.name} converts at ${(node(a.t.p.conv) || {}).name}, which puts its partner in a different slot: set \u2018Connect to\u2019 to name the far end`); continue; }
      if (!best) { mark(a.t.id, a.t.p.peer && !ok.some(b => b.t.id === a.t.p.peer && b.slot === a.slot) ? `${a.t.name} is set to connect to ${(node(a.t.p.peer) || {}).name}, which is not on a port for slot ${a.slot + 1}` : `${a.t.name} has no partner: nothing is plugged into a port for slot ${a.slot + 1} on a mux, OADM or ROADM it can reach${a.side ? ` from ${a.m.name}'s ${a.m.type === 'oadm' ? sideName(a.side) + ' side' : 'degree ' + a.side}` : ''}`); continue; }
      if (a.t.p.mode !== best.t.p.mode) { const why = `${a.t.name} is ${PHY_.MODES[a.t.p.mode].short} but ${best.t.name} is ${PHY_.MODES[best.t.p.mode].short}: the ends will never lock`; mark(a.t.id, why); mark(best.t.id, why); continue; }
      used.add(a.t.id); used.add(best.t.id); pairs.push([a, best]);
    }
    const sa = S.svc && S.svc.a, sz = S.svc && S.svc.z;
    // amplifiers are set for the service direction, so every channel runs from the end nearer the service's A end to the one further away
    const dist = t => { const r = sa && sa !== t.id ? route(S, sa, t.id, true, { ignoreCut: true }) : null; return r ? kmOf(r) : sa === t.id ? 0 : Infinity; };
    pairs.forEach(pr => { if (dist(pr[1].t) < dist(pr[0].t)) pr.reverse(); });
    const notes = [], plan = pairs.sort((x, y) => x[0].tx - y[0].tx).map(([a, b]) => {
      const svc = (a.t.id === sa && b.t.id === sz) || (a.t.id === sz && b.t.id === sa), from = svc ? sa : a.t.id, to = svc ? sz : b.t.id, f = from === a.t.id ? a : b, o = f === a ? b : a;
      const cv = f.t.p.conv || o.t.p.conv, pt = f.t.p.prot || o.t.p.prot; // the transponders' settings: a converter on the way and the protection of the pair
      if (svc && cv) notes.push(`${a.t.name} and ${b.t.name} are the service: the service channel cannot change wavelength, so its converter is ignored.`);
      return { slot: f.tx, slotRev: !cv && o.tx !== f.tx ? o.tx : null, mode: a.t.p.mode, off: f.t.p.off || 0, svc, from, to, via: '', conv: svc ? '' : cv, slot2: cv && !svc ? o.tx : f.tx, prot: pt, derived: true, tx: from, rx: to };
    });
    let svcWhy = '';
    if (!plan.some(c => c.svc) && node(sa) && node(sz) && isEnd(node(sa)) && isEnd(node(sz))) svcWhy = dark.get(sa) || dark.get(sz) || 'The service transponders are not paired through the muxes: plug both into the port for the same slot.';
    // background channels fill the line up to the channel count, in the free slots nearest the lit ones
    const want = Math.max(0, Math.round(+g.nch || 0) - plan.length), lit = new Set(plan.flatMap(c => [c.slot, c.slotRev, c.conv ? c.slot2 : null]).filter(x => x != null)), fillers = [], single = S.links.some(l => l.kind === 'fiber' && l.p.single);
    if (want && plan.length) {
      const centre = plan.reduce((t, c) => t + c.slot, 0) / plan.length, mode = (plan.find(c => c.svc) || plan[0]).mode;
      // a filler runs the service's route, so it has to obey the filters on it: not in a slot an OADM there serves in passing, and in one it serves at the ends
      const rs = route(S, sa, sz, true, { ignoreCut: true }), okFor = (sl, back) => !rs || !oadmWhy(rs.nodes.map(id => node(id)), sl, rs.links.map(id => link(id)), back);
      const free = [...Array(slotsN).keys()].filter(k => !lit.has(k) && okFor(k, null)).sort((x, y) => Math.abs(x - centre) - Math.abs(y - centre) || x - y);
      for (let k = 0; k < want && free.length >= (single ? 2 : 1); k++) { const sl = free.shift(), back = single ? free.shift() : null; fillers.push({ slot: sl, slotRev: back, mode, off: 0, svc: false, from: '', to: '', via: '', conv: '', slot2: sl, prot: '', derived: true, filler: true }); } // on a single fiber a background channel takes a slot each way
    }
    const all = [...plan, ...fillers].sort((x, y) => x.slot - y.slot);
    return { plan: all, notes, dark: [...dark].map(([id, why]) => ({ id, name: (node(id) || {}).name, why })), svcWhy, paired: pairs.length, fillers: fillers.length };
  }
  // the topology with the channel plan the cabling defines (or S itself when it does not use mux ports)
  function effective(S) {
    if (S._derived) return S;
    const d = derive(S); if (!d) return S;
    return { ...S, g: { ...S.g, plan: d.plan, nch: d.plan.length }, _derived: d };
  }

  // ---------- one-tap remedies ----------
  // An alarm can carry a `fix` the UI offers as a button: plain data (what to change), applied by the app, so the model stays DOM-free.
  const fixSplice = (l, label = 'Splice it back') => ({ type: 'splice', id: l.id, label });
  const fixWork = n => ({ type: 'work', id: n.id, label: `Set ${n.name} back to Working` });
  const fixClean = (n, port) => ({ type: 'clean', id: n.id, port, label: `Clean ${n.name} port ${port}` });

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
          const w = `slot ${c.slot + 1} is used in both directions on ${linkName(link(one))}, a single fiber: each direction needs its own wavelength`;
          if (c.svc) svcClash = w; else { routes[k] = null; blocked[k] = true; why[k] = w; return; }
        }
        let clash = null;
        const hit = r.links.find(id => slotsOn(c, id).some(x => { const o = used.get(x + '|' + id); if (o != null && chans[o].lg !== c.lg) { clash = x; return true; } return false; })); // the two copies of a 1+1 channel are one signal
        if (hit) { routes[k] = null; blocked[k] = true; why[k] = `slot ${clash + 1} is already lit on ${linkName(link(hit))} by another channel${singles.has(hit) ? ' (in the other direction too: it is a single fiber)' : ''}`; }
        else r.links.forEach(id => slotsOn(c, id).forEach(x => used.set(x + '|' + id, k)));
      });
    }
    if (!noBlock) chans.forEach((c, k) => { // a dark protection route must still be free of lit channels in its slot
      const r = routes0[k]; if (!dark[k] || !r) return;
      const hit = r.links.find(id => { const o = chans.findIndex((x, j) => !dark[j] && routes[j] && x.slot === c.slot && x.lg !== c.lg && routes[j].links.includes(id)); return o >= 0; });
      if (hit) { blocked[k] = true; why[k] = `shared protection: slot ${c.slot + 1} is lit on ${linkName(link(hit))} by another channel`; }
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
    S = effective(S);
    const g = S.g || {}, num = (v, d) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : d);
    const P = {}; for (const k in RESIL) P[k] = num(g[k], RESIL[k]);
    const { link, node } = mkGraph(S), YEAR = 8760 * 3600, svc = S.svc || {};
    const len = id => { const l = link(id); return l && l.kind === 'fiber' ? +l.p.len : 0; }, km = ids => ids.reduce((a, id) => a + len(id), 0);
    // restoring over a route through an auto-switching optical switch takes the detection plus the switch time, not the control plane's restoration time
    const restoreOf = alt => { const sw = alt.nodes.map(id => node(id)).filter(n => n && n.type === 'switch' && n.p.auto); return sw.length ? (P.detectMs + Math.max(...sw.map(n => +n.p.switchMs || 20))) / 1000 : P.restoreSec; };
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

  // ---------- demand-driven planner ----------
  // Candidate routes between two nodes: the shortest, then the shortest through each other ROADM (the same routes a plan entry's `via` gives).
  function candidateRoutes(S, a, z, K = 6) {
    const { link } = mkGraph(S), out = [], seen = new Set(), km = r => r.links.reduce((t, id) => t + (link(id).kind === 'fiber' ? +link(id).p.len : 0), 0);
    const add = (r, via) => { if (!r) return; const key = r.links.join('|'); if (seen.has(key) || new Set(r.nodes).size !== r.nodes.length || new Set(r.links).size !== r.links.length) return; seen.add(key); out.push({ ...r, via, km: km(r) }); };
    add(route(S, a, z, false), '');
    for (const n of S.nodes) if (n.type === 'roadm' && n.id !== a && n.id !== z) { const r1 = route(S, a, n.id, false), r2 = route(S, n.id, z, false); if (r1 && r2) add({ nodes: [...r1.nodes, ...r2.nodes.slice(1)], links: [...r1.links, ...r2.links] }, n.id); }
    return out.sort((p, q) => p.km - q.km).slice(0, K);
  }
  // A quick physical-layer estimate for planning: one amplifier per span at the global launch power, the nonlinear noise of the channels already
  // on each fiber, ROADM filtering and dispersion. The Channels tab gives the full simulation once the plan is applied.
  function estimateRoute(S, r, mode, loads, df) {
    const { link, node } = mkGraph(S), Rs = mode.Rs, P = lin(+S.g.launch || 0) / 1000;
    let ase = 0, nli = 0, cd = 0, passes = 0;
    for (const id of r.links) {
      const l = link(id); if (l.kind !== 'fiber') continue;
      const fb = PHY_.FIBERS[l.p.fiber], L = +l.p.len, sl = fb.att * L + +l.p.extra, n = Math.max(1, (loads.get(id) || 0) + 1);
      ase += lin(PHY_.ampNfEff(5.5, sl)) * PHY_.H * PHY_.NU * lin(sl) * PHY_.BREF; nli += PHY_.etaNLI(fb, L, Rs, n, df) * P ** 3; cd += fb.D * L;
    }
    r.nodes.forEach((id, i) => { if ((node(id) || {}).type === 'roadm') passes += i === 0 || i === r.nodes.length - 1 ? 1 : 2; });
    const line = 1 / (ase / P * Rs / PHY_.BREF + (nli > 0 ? nli / P : 0)), eff = PHY_.effSnr(mode, line, passes * PHY_.filterPenaltyPerPass(Rs, df) + PHY_.cdPenalty(mode, cd));
    return { margin: PHY_.qFromBer(PHY_.MODS[mode.mod].ber(eff)) - PHY_.qFromBer(mode.berThr), cd };
  }
  // Allocate demands one by one: the first candidate route (shortest first) whose estimated margin clears opts.minMargin and that has a slot free on
  // every fiber (first fit). The service occupies its route and slot first. Returns plan entries for the placed demands and the statistics.
  function planDemands(S, demands, opts = {}) {
    const g = S.g, df = +g.df * 1e9, slotsN = PHY_.cBandSlots(df), minM = opts.minMargin ?? 1, K = opts.K ?? 6, cache = opts.cache || new Map();
    const { node, link } = mkGraph(S), used = Array.from({ length: slotsN }, () => new Set()), loads = new Map();
    const take = (slot, links) => links.forEach(id => { used[slot].add(id); loads.set(id, (loads.get(id) || 0) + 1); });
    const sp = S.svc && node(S.svc.a) && node(S.svc.z) ? route(S, S.svc.a, S.svc.z, false) || route(S, S.svc.a, S.svc.z, true) : null;
    const svcEntry = Array.isArray(g.plan) ? g.plan.find(c => c.svc) : null, svcSlot = svcEntry ? +svcEntry.slot : Math.floor(slotsN / 2);
    if (sp) take(svcSlot, sp.links);
    const list = []; demands.forEach(d => { for (let i = 0; i < d.count && list.length < 96; i++) list.push(d); });
    const rank = d => { const c = cands(d); return c.length ? c[0].km : 0; };
    function cands(d) { const key = d.a + '>' + d.z; if (!cache.has(key)) cache.set(key, candidateRoutes(S, d.a, d.z, K)); return cache.get(key); }
    if (opts.order === 'longest') list.sort((p, q) => rank(q) - rank(p));
    const results = [], entries = [];
    for (const d of list) {
      const mode = PHY_.MODES[d.mode] || PHY_.MODES.zrp400, cs = cands(d), out = { a: d.a, z: d.z, mode: d.mode };
      if (!cs.length) { results.push({ ...out, status: 'no route' }); continue; }
      let reach = false, placed = null;
      for (const r of cs) {
        const est = estimateRoute(S, r, mode, loads, df);
        if (Math.abs(est.cd) > mode.cdTol || est.margin < minM) continue;
        reach = true;
        const slot = used.findIndex(u => r.links.every(id => !u.has(id)));
        if (slot >= 0) { placed = { slot, r, est }; break; }
      }
      if (!placed) { results.push({ ...out, status: reach ? 'blocked' : 'unreachable' }); continue; }
      take(placed.slot, placed.r.links);
      entries.push({ slot: placed.slot, mode: d.mode, off: 0, svc: false, from: d.a, to: d.z, via: placed.r.via, conv: '', slot2: placed.slot, prot: '' });
      results.push({ ...out, status: 'placed', slot: placed.slot, km: placed.r.km, hops: placed.r.nodes.length - 1, margin: placed.est.margin, via: placed.r.via, detour: placed.r !== cs[0], route: placed.r.nodes.map(id => (node(id) || {}).name) });
    }
    const n = k => results.filter(r => r.status === k).length, placed = n('placed'), blocked = n('blocked');
    const fibers = [...loads].filter(([id]) => link(id).kind === 'fiber').map(([id, c]) => ({ id, name: `${node(link(id).a).name}–${node(link(id).b).name}`, n: c, util: c / slotsN }));
    return { entries, results, stats: { demands: results.length, placed, blocked, unreachable: n('unreachable') + n('no route'), blocking: placed + blocked ? blocked / (placed + blocked) : 0,
      maxUtil: Math.max(0, ...fibers.map(f => f.util)), slotsUsed: used.filter(u => u.size).length, slots: slotsN, fibers, svcSlot } };
  }
  // Blocking probability against offered load: random demands between random pairs of ROADMs (or ends), a fixed seed so it is repeatable.
  function blockingCurve(S, mode, loadsList, trials = 12, seed = 1, opts = {}) {
    const pool = S.nodes.filter(n => n.type === 'roadm'), nodes = pool.length >= 2 ? pool : S.nodes.filter(isEnd);
    if (nodes.length < 2) return [];
    let st = seed >>> 0; const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const cache = new Map();
    return loadsList.map(n => {
      let sum = 0, cnt = 0;
      for (let t = 0; t < trials; t++) {
        const ds = []; for (let i = 0; i < n; i++) { const a = nodes[Math.floor(rnd() * nodes.length)]; let z; do { z = nodes[Math.floor(rnd() * nodes.length)]; } while (z === a); ds.push({ a: a.id, z: z.id, mode, count: 1 }); }
        const r = planDemands(S, ds, { ...opts, cache }).stats; if (r.placed + r.blocked) { sum += r.blocking; cnt++; }
      }
      return { n, p: cnt ? sum / cnt : 0 };
    });
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
  const STATUS_RANK = { up: 0, degraded: 1, down: 2, nopath: 2, los: 3 };
  function simulate(S, launchOverride, opts = {}) {
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
    const txDbm = W && A.type === 'oadm' ? +A.p.tx - +A.p.ad : W && A.type === 'roadm' ? +g.launch : (A.p.tx === '' || A.p.tx == null ? mode.tx : +A.p.tx) - (isEnd(A) ? degOf(A) + spareLoss(A) : 0); // a channel added at a ROADM starts at the launch level; a degraded laser is weaker
    let mpi = 0, xpmPen = 0, P = lin(txDbm) / 1000, Pase = P / lin(mode.txOsnr), Pnli = 0, cd = 0, dgd2 = 0, km = 0, passes = 0, nch = 1, maxNch = 1, tilt = 0;
    const tiltSeen = []; // tilt (dB, low- minus high-frequency channel) at every amplifier input and at the receiver
    const hops = [], alarms = [];
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
      return { gb: gS * (1 - fracF), gf: gS * fracF, g0b: g0S * (1 - fracF), g0f: g0S * fracF, gS, depl: r.depletion, relFn: f => interp(r.gainDb, f) / Math.max(1e-9, gS), spread: Math.max(...r.gainDb) - Math.min(...r.gainDb),
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
    let losAt = null;
    for (let i = 0; i < path.links.length; i++) {
      const l = link(path.links[i]), nxt = node(path.nodes[i + 1]), prv = node(path.nodes[i]);
      if (isCut(S, l)) { losAt = l; hops.push({ name: linkName(l), kind: 'cut', in: snap(), out: { sig: -99, ase: -99, nli: -99 }, km, nch, note: l.p.cut ? 'Fiber cut' : `Fiber cut (shared risk group ${l.p.srlg})` }); break; }
      if (l.kind === 'patch') { const b = snap(); loss(+l.p.il); rec('patch', 'patch', b, { gain: -l.p.il }); }
      else {
        const fb = PHY_.FIBERS[l.p.fiber], Lk = +l.p.len, b = snap();
        // Per-span loading: from this fiber onward (until a mux or ROADM changes it) only this many channels are lit.
        if (planOn) { curAct = maskAt(i); nch = curAct.filter(Boolean).length; } // the plan decides which channels ride this span
        else if (l.p.nch !== '' && l.p.nch != null) nch = Math.min(96, Math.max(1, Math.round(+l.p.nch)));
        maxNch = Math.max(maxNch, nch);
        const sl = fb.att * Lk + +pd(l.p, 'extra') + (eol ? eolSpan : 0);
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
        if (gr > 0) {
          // Equivalent lumped amplifiers. Backward pump: gain late in the span (noiseFrac * gain dB of loss still ahead of the signal),
          // so most of the span loss is paid before the noise enters. Forward pump: gain early, noisier (pump RIN) and no OSNR benefit.
          let c = 0;
          const stage = (pos, gain, nf) => { loss(pos - c); c = pos; P *= lin(gain); Pnli *= lin(gain); Pase = Pase * lin(gain) + lin(nf) * PHY_.H * PHY_.NU * lin(gain) * PHY_.BREF; if (planOn) ev.push({ k: 'R', gain, nf, rel }); };
          if (gf > 0) stage(Math.min(sl, PHY_.RAMAN.fwdPreLoss), gf, PHY_.RAMAN.fwdNf);
          if (gb > 0) stage(Math.max(c, sl - PHY_.RAMAN.noiseFrac * gb), gb, PHY_.RAMAN.nf);
          loss(sl - c);
        } else loss(sl);
        cd += fb.D * Lk; dgd2 += fb.pmd ** 2 * Lk; km += Lk;
        rec(`${Lk} km ${fb.name.split(' ')[0]}`, 'span', b, { gain: gr - sl, len: Lk, launch: b.sig, ...(gr > 0 ? { raman: gr, note: `Raman ${rdir === 'both' ? 'bidirectional' : rdir === 'fwd' ? 'forward' : 'backward'} pump ${pump} mW (${npump}): +${gr.toFixed(1)} dB on-off gain` + (depl > 0.05 ? `, pump depletion cost ${(sb.g0 + sf.g0 - gr).toFixed(1)} dB` : '') } : {}) });
        if (depl > 0.15 && !eol && !rv) alarms.push({ sev: 'info', text: `${linkName(l)}: signal power is depleting the Raman pump (${Math.round(depl * 100)}% of its photons): about ${f1(sb.g0 + sf.g0 - gr)} dB of gain lost. Add pump power or reduce channels.` });
        if (pump > PHY_.RAMAN.warnMw) alarms.push({ sev: 'warn', text: `${linkName(l)}: ${pump} mW Raman pump is a Class 4 laser. Check connector cleanliness (fiber-fuse risk) and eye safety.` });
        if (gr > 0 && !eol && !rv && +l.p.raman > PHY_.RAMAN.maxMw) alarms.push({ sev: 'info', text: `${linkName(l)}: pump limited to ${PHY_.RAMAN.maxMw} mW.` });
      }
      if (i + 1 === path.links.length) break;
      if (isDead(nxt)) { losAt = { node: nxt }; hops.push({ name: nxt.name, kind: 'cut', in: snap(), out: { sig: -99, ase: -99, nli: -99 }, km, nch, note: 'Device failed' }); break; }
      const t = nxt.type, nnext = node(path.nodes[i + 2]);
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
        const pn = +(/\d+/.exec(oadmSide(link(path.links[i]), nxt.id)) || [0])[0], dirty = +(nxt.p.dirty && nxt.p.dirty[pn]) || 0, b = snap(), lo = +nxt.p.il + dirty + degOf(nxt); loss(lo);
        if (planOn) { nch = litCount(i + 1); curAct = maskAt(i + 1); }
        if (dirty > 0.3 && !eol && !rv && !W) alarms.push({ sev: 'warn', text: `${nxt.name} port ${pn}: a dirty or damaged connector costs ${f1(dirty)} dB extra. Clean it.`, fix: fixClean(nxt, pn) });
        rec(nxt.name, 'panel', b, { warn: dirty > 0.3 ? true : undefined, port: pn, inSide: oadmSide(link(path.links[i]), nxt.id), gain: -lo, note: `port ${pn}: ${f1(+nxt.p.il)} dB` + (dirty ? ` + ${f1(dirty)} dB dirty connector` : '') });
      } else if (t === 'splitter' || t === 'switch') {
        // A splitter sends the light to both branches: the branch the route takes gets its share of the power (a 99/1 tap costs 0.05 dB on the main
        // branch and 20 dB on the tap). A switch passes one branch for about 1 dB. Which branch is the route's cable on that side of the device.
        const inP = oadmSide(link(path.links[i]), nxt.id), branch = inP !== 'c' ? inP : oadmSide(link(path.links[i + 1]), nxt.id);
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
        if (planOn) { ev.push({ k: 'W', n: np }); ev.push({ k: 'Z' }); if (joining.length) ev.push({ k: 'J', idx: joining }); curAct = maskAt(k); } // the WSS equalises every channel, added ones join at the same level
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
    const res = { mode, modeKey, A, Z, path, raman: ramanViews, hops, alarms, km, cd, dgd: Math.sqrt(dgd2), passes, g, rerouteCut, txDbm };
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
      if (losAt.node) { res.headline = `LOS at ${Z.name}: ${losAt.node.name} has failed. Replace it, or give the service a route around it.`; if (!W) { res.headlineFix = fixWork(losAt.node); alarms.push({ sev: 'bad', text: `${losAt.node.name} has failed and passes no light, so nothing reaches ${Z.name}. Set it back to Working, or add a route that avoids it.`, fix: fixWork(losAt.node) }); } }
      else { res.headline = `LOS at ${Z.name}: fiber cut on ${linkName(losAt)}. Splice it back, or add a second route.`; if (!W) { res.headlineFix = fixSplice(losAt); alarms.push({ sev: 'bad', text: `${linkName(losAt)} is cut, so no light reaches ${Z.name}. Splice it back, or give the service a second fiber route (Protect, in the Channels tab).`, fix: fixSplice(losAt) }); } }
      return res;
    }
    const prx = db(P * 1000); res.prx = prx;
    if (prx < mode.rxMin - 12 && !W) {
      res.status = 'los'; res.headline = `LOS at ${Z.name}: ${f1(prx)} dBm is below what the receiver can detect.`;
      alarms.unshift({ sev: 'bad', text: `Rx power ${f1(prx)} dBm is far below the ${f1(mode.rxMin)} dBm sensitivity. Add gain before the receiver or remove loss: the hop table shows where the power goes.` });
      return switchIfBetter(res);
    }
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
      chans.forEach((c, i) => { if (alive[i]) { Pc[i] = P0 * lin(c.off); Pa[i] = Pc[i] / lin(c.m.txOsnr); } });
      let sP = P0;
      const each = fn => { for (let i = 0; i < N; i++) if (alive[i]) fn(i); };
      const freeze = i => { fin[i] = { Pc: Pc[i], Pa: Pa[i], Pn: Pn[i], xp: xp[i], cd: cdc[i], dg2: dg2[i], ps: psc[i] }; alive[i] = false; };
      for (const e of ev) {
        if (e.k === 'L') { sP *= e.f; each(i => { Pc[i] *= e.f; Pa[i] *= e.f; Pn[i] *= e.f; }); }
        else if (e.k === 'A') { sP *= e.G; each(i => { Pc[i] *= e.G; Pn[i] *= e.G; Pa[i] = Pa[i] * e.G + lin(e.nfe) * hnb * e.G; }); }
        else if (e.k === 'R') { sP *= lin(e.gain); each(i => { const gi = lin(e.gain * (e.rel ? e.rel[i] : 1)); Pc[i] *= gi; Pn[i] *= gi; Pa[i] = Pa[i] * gi + lin(e.nf) * hnb * gi; }); }
        else if (e.k === 'Z') each(i => { const c = sP * lin(chans[i].off) / Pc[i]; Pc[i] *= c; Pn[i] *= c; Pa[i] *= c; });
        else if (e.k === 'C') each(i => { cdc[i] += e.dcd; dg2[i] += e.dg2; });
        else if (e.k === 'W') each(i => { psc[i] += e.n; });
        else if (e.k === 'D') for (const i of e.idx) {
          if (!alive[i]) continue;
          Pc[i] *= e.G * e.f; Pn[i] *= e.G * e.f; Pa[i] = (Pa[i] * e.G + (e.G > 1 ? lin(e.nfe) * hnb * e.G : 0)) * e.f; psc[i] += 1;
          freeze(i);
        }
        else if (e.k === 'J') for (const i of e.idx) { // added at this ROADM: level with the express channels, own transmitter noise, nothing accumulated yet
          Pc[i] = (e.padd != null ? e.padd : sP) * lin(chans[i].off); Pa[i] = Pc[i] / lin(chans[i].m.txOsnr); Pn[i] = 0; xp[i] = 0; cdc[i] = 0; dg2[i] = 0; psc[i] = 1; alive[i] = true;
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
        { const pf = portFaultOn(path.nodes.slice(lohi[i].lo, lohi[i].hi + 1), c.slot, path.links.slice(lohi[i].lo, lohi[i].hi)); if (pf) { status = 'los'; notes.unshift(`its port on ${pf.name} has failed (slot ${c.slot + 1})`); } const fw = filterWhy(path.nodes.slice(lohi[i].lo, lohi[i].hi + 1), c.slot, path.links.slice(lohi[i].lo, lohi[i].hi), c.slotRev); if (fw) { status = 'los'; notes.unshift(fw); } }
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
      if (failing.length) alarms.push({ sev: 'warn', text: `${failing.length} other channel${failing.length > 1 ? 's' : ''} failing: ${failing.slice(0, 3).map(c => `slot ${c.slot + 1} (${c.short}): ${c.notes[0]}`).join('; ')}${failing.length > 3 ? '…' : ''}.` });
    }
    if (!eol && !W) { const e = simulate(S, launchOverride, { eol: true, reverse: rv, useProtect: svcOnProt }); res.eol = { qMargin: e.qMargin ?? -Infinity, worstQMargin: e.worstQMargin ?? -Infinity, status: e.status }; }
    // alarms & status
    const bad = [];
    if (mesh && mesh.svcClash && !eol && !rv && !W) bad.push(`The service channel cannot work: ${mesh.svcClash}.`);
    if (!eol && !rv && !W) { const fw = filterWhy(path.nodes, chans[svcIdx].slot, path.links, chans[svcIdx].slotRev); if (fw) bad.push(`The service channel is lost: ${fw}.`); }
    if (!eol && !rv && !W) { const pf = portFaultOn(path.nodes, chans[svcIdx].slot, path.links); if (pf) bad.push(`The port for slot ${chans[svcIdx].slot + 1} on ${pf.name} has failed: the service channel is lost.`); }
    if (Z.p.mode !== modeKey) bad.push(`Mode mismatch: ${A.name} is ${mode.short}, ${Z.name} is ${PHY_.MODES[Z.p.mode].short}. The ends will never lock.`);
    if (Math.abs(cd) > mode.cdTol) bad.push(`Chromatic dispersion ${Math.round(cd)} ps/nm exceeds the ${mode.short} ${mode.coh === false ? 'dispersion tolerance' : 'DSP range'} of ${mode.cdTol} ps/nm.`);
    if (ber > mode.berThr) bad.push(`Pre-FEC BER ${ber.toExponential(2)} is above the ${mode.fec} limit ${mode.berThr.toExponential(2)}: uncorrectable errors, link down.`);
    bad.push(...clientFatal);
    bad.forEach(t => alarms.unshift({ sev: 'bad', text: t }));
    if (prx < mode.rxMin) alarms.push({ sev: 'warn', text: `Rx power ${f1(prx)} dBm is below the ${mode.rxMin} dBm sensitivity spec (Rx LOW alarm). Receiver noise is now eating SNR.` });
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
        if ((STATUS_RANK[r2.status] ?? 0) > (STATUS_RANK[res.status] ?? 0)) { res.status = r2.status; res.headline = `${Z.name} to ${A.name}: ${r2.headline}`; }
        else if (res.status === 'up' && r2.status === 'degraded') { res.status = 'degraded'; res.headline = `${Z.name} to ${A.name}: ${r2.headline}`; }
      }
    }
    res.reverse = rv;
    return res;
  }

  return { TYPES, PREFIX, PORTS_PER_CARD, SPLIT, splitLossDb, otdrTrace, meterRead, OTDR_PULSES, OTDR_DR, METER, band1310, oscSpans, optic1310, parseIp, reach, traffic, assignSides, oadmWhy, oadmRange, oadmSide, derive, effective, PRESETS, isEnd, newClient, uid, linkDefaults, sanitize, sanitizePlan, planFromUniform, remapPlan, assignSlots, resilience, RESIL, isCut, candidateRoutes, estimateRoute, planDemands, blockingCurve, optimiseOffsets, fromSpans, mkGraph, route, simulate, reqOsnr };
})();
if (typeof module !== 'undefined') module.exports = MODEL;
