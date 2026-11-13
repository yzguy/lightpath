  // ---------- presets ----------
  function N(type, name, x, y, p = {}) { return { id: uid('n'), type, name, x, y, p: { ...TYPES[type].def(), ...p } }; }
  function L(a, b, kind, p = {}) { return { id: uid('l'), a: a.id, b: b.id, kind, p: { ...linkDefaults(kind), ...p } }; }
  // Transponders on a passive mux are plugged in by port; with the defaults (16 ports from slot 24) port 8 (mport 7) passes slot 31, the usual service channel.
  const PRESETS = {
    dci: {
      name: 'DCI: 400ZR over 80 km', build() {
        const a1 = N('trx', 'TRX-A1', 80, 120), a2 = N('trx', 'TRX-A2', 80, 220), a3 = N('trx', 'TRX-A3', 80, 320);
        const ma = N('mux', 'MUX-A', 230, 220), ba = N('edfa', 'BST-A', 370, 220, { gmin: 5 });
        const pb = N('edfa', 'PRE-B', 640, 220, { gmin: 5 }), mb = N('mux', 'MUX-B', 780, 220);
        const b1 = N('trx', 'TRX-B1', 930, 120), b2 = N('trx', 'TRX-B2', 930, 220), b3 = N('trx', 'TRX-B3', 930, 320);
        return { nodes: [a1, a2, a3, ma, ba, pb, mb, b1, b2, b3], links: [L(a1, ma, 'patch', { mport: 7 }), L(a2, ma, 'patch', { mport: 8 }), L(a3, ma, 'patch', { mport: 9 }), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 80 }), L(pb, mb, 'patch'), L(mb, b1, 'patch', { mport: 7 }), L(mb, b2, 'patch', { mport: 8 }), L(mb, b3, 'patch', { mport: 9 })],
          g: { nch: 16, df: 100, launch: 0 }, svc: { a: a1.id, z: b1.id } };
      }
    },
    lh: {
      name: 'Long haul: 5 spans with ILAs', build() {
        // 48 channels at 0 dBm each put 12 dBm into the booster and the return-direction preamp, so these two are the high-input type (the default limit is 10 dBm).
        const a = N('trx', 'TRX-A', 60, 120, { mode: 'zrp400' }), ma = N('mux', 'MUX-A', 60, 250), ba = N('edfa', 'BST-A', 220, 250, { gmin: 5, pinMax: 14 });
        const i1 = N('edfa', 'ILA-1', 400, 250), i2 = N('edfa', 'ILA-2', 580, 250), i3 = N('edfa', 'ILA-3', 760, 250), i4 = N('edfa', 'ILA-4', 940, 250);
        const pb = N('edfa', 'PRE-B', 1120, 250, { gmin: 5, pinMax: 14 }), mb = N('mux', 'MUX-B', 1260, 250), z = N('trx', 'TRX-Z', 1260, 120, { mode: 'zrp400' });
        return { nodes: [a, ma, ba, i1, i2, i3, i4, pb, mb, z], links: [L(a, ma, 'patch', { mport: 7 }), L(ma, ba, 'patch'), L(ba, i1, 'fiber', { len: 80 }), L(i1, i2, 'fiber', { len: 95 }), L(i2, i3, 'fiber', { len: 80 }), L(i3, i4, 'fiber', { len: 100 }), L(i4, pb, 'fiber', { len: 85 }), L(pb, mb, 'patch'), L(mb, z, 'patch', { mport: 7 })],
          g: { nch: 48, df: 100, launch: 1 }, svc: { a: a.id, z: z.id } };
      }
    },
    ring: {
      name: 'ROADM triangle with restoration', build() {
        const ra = N('roadm', 'ROADM-A', 200, 300), rb = N('roadm', 'ROADM-B', 520, 110), rc = N('roadm', 'ROADM-C', 840, 300);
        const ta = N('trx', 'TRX-A', 200, 440, { mode: 'zrp400' }), tc = N('trx', 'TRX-C', 840, 440, { mode: 'zrp400' }), tb = N('trx', 'TRX-B', 520, 0, { mode: 'zrp400' });
        return { nodes: [ra, rb, rc, ta, tb, tc], links: [L(ra, rc, 'fiber', { len: 70 }), L(ra, rb, 'fiber', { len: 100 }), L(rb, rc, 'fiber', { len: 110 }), L(ta, ra, 'patch'), L(tc, rc, 'patch'), L(tb, rb, 'patch')],
          g: { nch: 48, df: 100, launch: 0 }, svc: { a: ta.id, z: tc.id } };
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
          g: { nch: plan.length, df: 100, launch: 0, plan }, svc: { a: ta.id, z: tc.id } };
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
          g: { nch: plan.length, df: 100, launch: 0, plan }, svc: { a: ta.id, z: tc.id } };
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
          g: { nch: plan.length, df: 100, launch: 0, plan }, svc: { a: ta.id, z: tc.id } };
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
          g: { nch: plan.length, df: 100, launch: 0, plan }, svc: { a: ta.id, z: tc.id } };
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
          g: { nch: plan.length, df: 100, launch: 0, plan }, svc: { a: ta.id, z: tz.id } };
      }
    },
    mxp: {
      name: 'Muxponder: 4x100G over 400G ZR+', build() {
        const a = N('mxp', 'MXP-A', 80, 220), ma = N('mux', 'MUX-A', 260, 220), ba = N('edfa', 'BST-A', 400, 220, { gmin: 5 });
        const pb = N('edfa', 'PRE-B', 670, 220, { gmin: 5 }), mb = N('mux', 'MUX-B', 810, 220), z = N('mxp', 'MXP-B', 960, 220);
        return { nodes: [a, ma, ba, pb, mb, z], links: [L(a, ma, 'patch', { mport: 7 }), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 80 }), L(pb, mb, 'patch'), L(mb, z, 'patch', { mport: 7 })],
          g: { nch: 16, df: 100, launch: 0 }, svc: { a: a.id, z: z.id } };
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
          g: { nch: plan.length, df: 100, launch: 0, plan }, svc: { a: a1.id, z: z1.id } };
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
        return { nodes: [...a, ...b, ...c, ...z, ma, mz, ba, ab, ob, ac, oc, pz], links, g: { nch: 16, df: 100, launch: 0 }, svc: { a: a[2].id, z: z[1].id } };
      }
    },
    ports: {
      name: 'Transponders on mux ports: the cabling sets the channels', build() {
        const a = [1, 2, 3].map(k => N('trx', 'TRX-A' + k, 60, 60 + k * 120, { mode: 'zrp400' })), z = [1, 2, 3].map(k => N('trx', 'TRX-B' + k, 1000, 60 + k * 120, { mode: 'zrp400' }));
        const ma = N('mux', 'MUX-A', 260, 300, { ports: 16, first: 24 }), mb = N('mux', 'MUX-B', 800, 300, { ports: 16, first: 24 }), ba = N('edfa', 'BST-A', 400, 300, { gmin: 5 }), pb = N('edfa', 'PRE-B', 660, 300, { gmin: 5 });
        const port = [2, 3, 5]; // MUX ports 3, 4 and 6 (slots 27, 28, 30); each transponder follows its port
        return { nodes: [...a, ...z, ma, mb, ba, pb], links: [...a.map((t, k) => L(t, ma, 'patch', { mport: port[k] })), ...z.map((t, k) => L(t, mb, 'patch', { mport: port[k] })), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 80 }), L(pb, mb, 'patch')],
          g: { nch: 16, df: 100, launch: 0 }, svc: { a: a[0].id, z: z[0].id } };
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
          g: { nch: 12, df: 100, launch: 0 }, svc: { a: a1.id, z: c1.id } };
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
          L(o2, ac, 'fiber', { len: 40 }), L(ac, o3, 'fiber', { len: 40 }), L(o3, mz, 'patch'), L(mz, tz, 'patch', { mport: 7 })], g: { nch: 8, df: 100, launch: 0 }, svc: { a: ta.id, z: tz.id } };
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
          g: { nch: 16, df: 100, launch: 0 }, svc: { a: a.id, z: z.id },
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
        return { nodes: [...a, ...b, z, ma, ob, mz], links, g: { nch: 3, df: 100, launch: 0 }, svc: { a: a[0].id, z: b[0].id } };
      }
    },
    bidiamp: {
      name: 'Single-fiber (BiDi) bus with a BiDi amplifier', build() {
        // The bus above with a 60 km first span cut in two by an amplifier. It has to pass both directions down the one glass, so it is a BiDi amplifier
        // (circulators and band filters around two amplifier paths). Set it to one-way and the reverse direction is lost.
        const p = PRESETS.bidi.build(), f = p.links.find(l => l.kind === 'fiber'), ob = p.nodes.find(n => n.name === 'OADM-B');
        const amp = N('edfa', 'BIDI-AMP', 475, 300, { bidi: true, gmin: 5 });
        const tail = L(amp, ob, 'fiber', { len: 30, single: true, sb: 'w' });
        f.b = amp.id; f.p.len = 30; f.p.sb = '';
        return { ...p, nodes: [...p.nodes, amp], links: [...p.links, tail] };
      }
    },
    olp: {
      name: 'Optical line protection: splitter, tap and switch', build() {
        const ta = N('trx', 'TRX-A', 50, 200, { mode: 'zrp400' }), tz = N('trx', 'TRX-Z', 1370, 200, { mode: 'zrp400' });
        const ma = N('mux', 'MUX-A', 180, 280), ba = N('edfa', 'BST-A', 310, 280, { gmin: 5 }), tap = N('splitter', 'TAP-A', 440, 280, { ratio: '99/1' }), spl = N('splitter', 'SPL-A', 570, 280, { ratio: '50/50' });
        const sw = N('switch', 'SW-Z', 900, 280), pz = N('edfa', 'PRE-Z', 1030, 280, { gmin: 5 }), mz = N('mux', 'MUX-Z', 1190, 280);
        // The booster feeds a 99/1 tap (its monitor port is left free to read the power) and a 50/50 splitter that lights both fibers. The switch at the far end
        // passes port A (60 km) and, being set to auto, goes to port B (80 km) if the light on A is lost. Cut the 60 km fiber, then set the switch to manual.
        const links = [L(ta, ma, 'patch', { mport: 7 }), L(ma, ba, 'patch'), L(ba, tap, 'patch', { sb: 'c' }), L(tap, spl, 'patch', { sa: 'a', sb: 'c' }), L(spl, sw, 'fiber', { len: 60, sa: 'a', sb: 'a' }), L(spl, sw, 'fiber', { len: 80, sa: 'b', sb: 'b' }), L(sw, pz, 'patch', { sa: 'c' }), L(pz, mz, 'patch'), L(mz, tz, 'patch', { mport: 7 })];
        return { nodes: [ta, tz, ma, ba, tap, spl, sw, pz, mz], links, g: { nch: 16, df: 100, launch: 0 }, svc: { a: ta.id, z: tz.id } };
      }
    },
    odf: {
      name: 'Patch panels: connector loss and a dirty port', build() {
        const ta = N('trx', 'TRX-A', 50, 200, { mode: 'zrp400' }), tz = N('trx', 'TRX-Z', 1230, 200, { mode: 'zrp400' });
        const ma = N('mux', 'MUX-A', 180, 280), ba = N('edfa', 'BST-A', 310, 280, { gmin: 5 }), oa = N('panel', 'ODF-A', 460, 280, { ports: 12 });
        const ob = N('panel', 'ODF-B', 820, 280, { ports: 12, dirty: { 1: 1.8 } }), pb = N('edfa', 'PRE-B', 960, 280, { gmin: 5 }), mb = N('mux', 'MUX-B', 1090, 280);
        // The booster is patched to the front of ODF-A port 1; the fiber runs from the rear of that port to the rear of ODF-B port 1; the pre-amp hangs off its front.
        // Every mated connector pair costs 0.5 dB, and the connector on ODF-B port 1 is dirty: 1.8 dB more. Clean it in the inspector (Dirty connectors).
        const links = [L(ta, ma, 'patch', { mport: 7 }), L(ma, ba, 'patch'), L(ba, oa, 'patch', { sb: 'f1' }), L(oa, ob, 'fiber', { len: 60, sa: 'r1', sb: 'r1' }), L(ob, pb, 'patch', { sa: 'f1' }), L(pb, mb, 'patch'), L(mb, tz, 'patch', { mport: 7 })];
        return { nodes: [ta, tz, ma, ba, oa, ob, pb, mb], links, g: { nch: 16, df: 100, launch: 0 }, svc: { a: ta.id, z: tz.id } };
      }
    },
    sfp10: {
      name: 'Switch 10G DWDM optics over 60 km', build() {
        const a1 = N('trx', 'SW-A1', 80, 150, { mode: 'dwdm10' }), a2 = N('trx', 'SW-A2', 80, 290, { mode: 'dwdm10' });
        const ma = N('mux', 'MUX-A', 240, 220), ba = N('edfa', 'BST-A', 380, 220, { gmin: 3, targetRev: -4 });
        const pb = N('edfa', 'PRE-B', 650, 220, { target: -4, targetRev: 0, gmin: 0 }), mb = N('mux', 'MUX-B', 790, 220);
        const b1 = N('trx', 'SW-B1', 940, 150, { mode: 'dwdm10' }), b2 = N('trx', 'SW-B2', 940, 290, { mode: 'dwdm10' });
        return { nodes: [a1, a2, ma, ba, pb, mb, b1, b2], links: [L(a1, ma, 'patch', { mport: 7 }), L(a2, ma, 'patch', { mport: 8 }), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 60 }), L(pb, mb, 'patch'), L(mb, b1, 'patch', { mport: 7 }), L(mb, b2, 'patch', { mport: 8 })],
          g: { nch: 8, df: 100, launch: 0 }, svc: { a: a1.id, z: b1.id } };
      }
    },
    sfp10dcm: {
      name: 'Switch 10G over 120 km with a DCM', build() {
        const a1 = N('trx', 'SW-A1', 80, 220, { mode: 'dwdm10f' }), ma = N('mux', 'MUX-A', 230, 220), ba = N('edfa', 'BST-A', 370, 220, { gmin: 3, targetRev: -4 });
        const pb = N('edfa', 'PRE-B', 640, 220, { target: 2, targetRev: 0, gmin: 0 }), dc = N('dcm', 'DCM-B', 780, 220, { cd: -1360, il: 7 }), mb = N('mux', 'MUX-B', 920, 220), b1 = N('trx', 'SW-B1', 1060, 220, { mode: 'dwdm10f' });
        return { nodes: [a1, ma, ba, pb, dc, mb, b1], links: [L(a1, ma, 'patch', { mport: 7 }), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 120 }), L(pb, dc, 'patch'), L(dc, mb, 'patch'), L(mb, b1, 'patch', { mport: 7 })],
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
          g: { nch: plan.length, df: 100, launch: 0, plan }, svc: { a: a.id, z: z.id } };
      }
    },
    dark: {
      name: 'Dark fiber: unamplified ZR', build() {
        const a = N('trx', 'TRX-A', 150, 220), z = N('trx', 'TRX-Z', 800, 220);
        return { nodes: [a, z], links: [L(a, z, 'fiber', { len: 25, extra: 1.5 })], g: { nch: 1, df: 100, launch: 0 }, svc: { a: a.id, z: z.id } };
      }
    },
  };

