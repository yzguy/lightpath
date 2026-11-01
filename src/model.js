// ===== Topology model, routing and path simulation =====
// DOM-free (like engine.js) so it can be tested in Node. Depends on the global PHY from engine.js.
const MODEL = (() => {
  const PHY_ = typeof PHY !== 'undefined' ? PHY : require('./engine.js');
  const { db, lin } = PHY_;
  const f1 = x => (isFinite(x) ? x.toFixed(1) : '—');
  const uid = p => p + Math.random().toString(36).slice(2, 7);

  const TYPES = {
    trx: { label: 'Transponder', hint: 'Coherent pluggable, or a 10G DWDM SFP+', maxLinks: 1, def: () => ({ mode: 'zr400', tx: null }) },
    mxp: { label: 'Muxponder', hint: 'Client ports into one coherent line port', maxLinks: 1, def: () => ({ mode: 'zrp400', tx: null, clients: defaultClients() }) },
    mux: { label: 'Mux / Demux', hint: 'Passive DWDM filter', maxLinks: 99, def: () => ({ il: 5 }) },
    edfa: { label: 'EDFA', hint: 'Booster, in-line or preamp', maxLinks: 2, def: () => ({ ctl: 'auto', target: '', targetRev: '', gain: 20, gainRev: '', nf: 5, nfRev: '', gmin: 10, gminRev: '', gmax: 30, gmaxRev: '', pmax: 23, pmaxRev: '', tiltCtl: true, agcUs: '' }) },
    roadm: { label: 'ROADM', hint: 'WSS node, any degree', maxLinks: 99, def: () => ({ wss: 6, ad: 4, amps: true, nf: 5.5 }) },
    dcm: { label: 'Dispersion comp.', hint: 'DCF module or FBG, cancels CD', maxLinks: 2, def: () => ({ cd: -1360, cdRev: '', il: 7, ilRev: '' }) },
    voa: { label: 'VOA / pad', hint: 'Fixed attenuator', maxLinks: 2, def: () => ({ att: 5 }) },
  };
  const defaultClients = () => Array.from({ length: 4 }, () => newClient());
  const newClient = (optic = '100g-lr4') => ({ optic, len: 0.1, extra: 1 });
  const isEnd = n => !!n && (n.type === 'trx' || n.type === 'mxp'); // service end: a coherent line port that light never passes through
  const PREFIX = { dcm: 'DCM', mxp: 'MXP', trx: 'TRX', mux: 'MUX', edfa: 'AMP', roadm: 'ROADM', voa: 'VOA' };
  const linkDefaults = kind => (kind === 'fiber' ? { len: 80, fiber: 'smf', extra: 1, extraRev: '', nch: '', raman: 0, ramanRev: '', ramanDir: 'back', ramanPumps: 1, dir: 'both', cut: false, srlg: '' } : { il: 0.5, dir: 'both', cut: false });

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
        const a = N('trx', 'TRX-A', 60, 120, { mode: 'zrp400' }), ma = N('mux', 'MUX-A', 60, 250), ba = N('edfa', 'BST-A', 220, 250, { gmin: 5 });
        const i1 = N('edfa', 'ILA-1', 400, 250), i2 = N('edfa', 'ILA-2', 580, 250), i3 = N('edfa', 'ILA-3', 760, 250), i4 = N('edfa', 'ILA-4', 940, 250);
        const pb = N('edfa', 'PRE-B', 1120, 250, { gmin: 5 }), mb = N('mux', 'MUX-B', 1260, 250), z = N('trx', 'TRX-Z', 1260, 120, { mode: 'zrp400' });
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
    mxp: {
      name: 'Muxponder: 4x100G over 400G ZR+', build() {
        const a = N('mxp', 'MXP-A', 80, 220), ma = N('mux', 'MUX-A', 260, 220), ba = N('edfa', 'BST-A', 400, 220, { gmin: 5 });
        const pb = N('edfa', 'PRE-B', 670, 220, { gmin: 5 }), mb = N('mux', 'MUX-B', 810, 220), z = N('mxp', 'MXP-B', 960, 220);
        return { nodes: [a, ma, ba, pb, mb, z], links: [L(a, ma, 'patch'), L(ma, ba, 'patch'), L(ba, pb, 'fiber', { len: 80 }), L(pb, mb, 'patch'), L(mb, z, 'patch')],
          g: { nch: 16, df: 75, launch: 0 }, svc: { a: a.id, z: z.id } };
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
      out.push({ slot, mode: PHY_.MODES[c.mode] ? c.mode : 'zrp400', off: Math.min(10, Math.max(-10, Number.isFinite(+c.off) && c.off !== '' && c.off !== null ? +c.off : 0)), svc: !!c.svc, from: nodeId(c.from), to: nodeId(c.to), via: nodeId(c.via), conv: nodeId(c.conv), slot2: Number.isFinite(+c.slot2) && c.slot2 !== '' && c.slot2 !== null && +c.slot2 >= 0 && +c.slot2 < slots ? Math.round(+c.slot2) : slot, prot: c.prot === '1+1' ? '1+1' : c.prot === 'shared' ? 'shared' : '' });
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
      if (n.type === 'edfa' && p.ctl !== 'auto' && p.ctl !== 'fixed') p.ctl = 'auto';
      if (isEnd(n) && !(p.tx === null || p.tx === '' || Number.isFinite(+p.tx))) p.tx = null;
      if (n.type === 'edfa') for (const k of ['target', 'targetRev', 'gainRev', 'nfRev', 'gminRev', 'gmaxRev', 'pmaxRev', 'agcUs']) if (!(p[k] === '' || (p[k] !== null && typeof p[k] !== 'boolean' && Number.isFinite(+p[k])))) p[k] = '';
      if (n.type === 'dcm') for (const k of ['cdRev', 'ilRev']) if (!(p[k] === '' || (p[k] !== null && typeof p[k] !== 'boolean' && Number.isFinite(+p[k])))) p[k] = '';
      seen.add(n.id);
      nodes.push({ id: n.id, type: n.type, name: String(n.name ?? n.id), x: Number.isFinite(+n.x) ? +n.x : 0, y: Number.isFinite(+n.y) ? +n.y : 0, p });
    }
    const lseen = new Set(), links = [];
    for (const l of o.links) {
      if (!l || typeof l.id !== 'string' || lseen.has(l.id) || !seen.has(l.a) || !seen.has(l.b) || l.a === l.b) continue;
      const kind = l.kind === 'fiber' ? 'fiber' : 'patch', p = fill(linkDefaults(kind), l.p);
      if (kind === 'fiber' && !PHY_.FIBERS[p.fiber]) p.fiber = 'smf';
      if (!['both', 'ab', 'ba'].includes(p.dir)) p.dir = 'both';
      p.srlg = typeof p.srlg === 'string' && /^[\w-]{0,24}$/.test(p.srlg) ? p.srlg : '';
      if (kind === 'fiber') for (const k of ['extraRev', 'ramanRev']) if (!(p[k] === '' || (Number.isFinite(+p[k]) && p[k] !== null && +p[k] >= 0))) p[k] = '';
      if (kind === 'fiber') { if (!['back', 'fwd', 'both'].includes(p.ramanDir)) p.ramanDir = 'back'; p.ramanPumps = Math.min(3, Math.max(1, Math.round(+p.ramanPumps || 1))); }
      if (kind === 'fiber') p.raman = Math.min(PHY_.RAMAN.maxMw, Math.max(0, +p.raman || 0));
      if (kind === 'fiber' && !(p.nch === '' || (Number.isFinite(+p.nch) && +p.nch >= 1))) p.nch = '';
      lseen.add(l.id);
      links.push({ id: l.id, a: l.a, b: l.b, kind, p });
    }
    const gi = o.g && typeof o.g === 'object' ? o.g : {};
    const num = (v, d) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : d);
    const g = { nch: Math.min(96, Math.max(1, Math.round(num(gi.nch, 16)))), df: [50, 75, 100, 150].includes(+gi.df) ? +gi.df : 75, launch: num(gi.launch, 0), neighbors: gi.neighbors === 'coh' ? 'coh' : 'same', reopt: gi.reopt === true, plan: null,
      eolSpan: Math.min(5, Math.max(0, num(gi.eolSpan, PHY_.EOL.spanLoss))), eolTrx: Math.min(3, Math.max(0, num(gi.eolTrx, PHY_.EOL.trxPen))),
      lossPct: Math.min(95, Math.max(1, num(gi.lossPct, PHY_.TRANSIENT.lossPct))), agcUs: Math.min(5000, Math.max(0, num(gi.agcUs, PHY_.TRANSIENT.agcUs))),
      cutRate: Math.min(50, Math.max(0, num(gi.cutRate, RESIL.cutRate))), mttr: Math.min(720, Math.max(0.5, num(gi.mttr, RESIL.mttr))), detectMs: Math.min(1000, Math.max(0, num(gi.detectMs, RESIL.detectMs))),
      switchMs: Math.min(10000, Math.max(0, num(gi.switchMs, RESIL.switchMs))), sharedSec: Math.min(600, Math.max(0, num(gi.sharedSec, RESIL.sharedSec))), restoreSec: Math.min(3600, Math.max(0, num(gi.restoreSec, RESIL.restoreSec))), devRate: Math.min(5, Math.max(0, num(gi.devRate, RESIL.devRate))) };
    g.plan = sanitizePlan(gi.plan, g.df);
    if (g.plan) { const ok = new Set(nodes.filter(n => n.type === 'roadm' || isEnd(n)).map(n => n.id)), roadms = new Set(nodes.filter(n => n.type === 'roadm').map(n => n.id)); g.plan.forEach(c => { if (!ok.has(c.from)) c.from = ''; if (!ok.has(c.to)) c.to = ''; if (c.from && c.from === c.to) c.to = ''; if (!roadms.has(c.via)) c.via = ''; if (!roadms.has(c.conv) || c.conv === c.from || c.conv === c.to) c.conv = ''; if (c.conv) c.via = ''; }); }
    const si = o.svc && typeof o.svc === 'object' ? o.svc : {};
    const svc = { a: seen.has(si.a) ? si.a : null, z: seen.has(si.z) ? si.z : null };
    // planner demands (a traffic list for the Planner tab)
    const demands = (Array.isArray(o.demands) ? o.demands : []).slice(0, 40).map(d => (d && typeof d === 'object' && seen.has(d.a) && seen.has(d.z) && d.a !== d.z && ['roadm', 'trx', 'mxp'].includes((nodes.find(n => n.id === d.a) || {}).type) && ['roadm', 'trx', 'mxp'].includes((nodes.find(n => n.id === d.z) || {}).type)
      ? { a: d.a, z: d.z, mode: PHY_.MODES[d.mode] ? d.mode : 'zrp400', count: Math.min(96, Math.max(1, Math.round(num(d.count, 1)))) } : null)).filter(Boolean);
    return { nodes, links, g, svc, demands };
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
  const isDead = n => !!n && !!n.p && n.p.fail === 'dead';
  const degOf = n => (n && n.p && n.p.fail === 'degraded' ? (Number.isFinite(+n.p.degDb) ? Math.min(30, Math.max(0, +n.p.degDb)) : 3) : 0);

  // Shortest path (km) from A to Z. Light never passes *through* a transponder. Cut fibers are only used if allowCut.
  // x.ignoreCut: plan on the intact network (cut flags are failures, not topology). x.exclude: link ids the route may not use.
  function route(S, aId, zId, allowCut, x = {}) {
    const { node, linksOf, other } = mkGraph(S);
    const dist = { [aId]: 0 }, prev = {}, done = new Set(), plan = x.ignoreCut;
    if (isDead(node(aId)) && !allowCut && !plan) return null;
    while (true) {
      let u = null, best = Infinity;
      for (const k in dist) if (!done.has(k) && dist[k] < best) { best = dist[k]; u = k; }
      if (u == null) return null;
      if (u === zId) break;
      done.add(u);
      if (u !== aId && isEnd(node(u))) continue;
      for (const l of linksOf(u)) {
        const cut = isCut(S, l);
        if (cut && !allowCut && !plan) continue;
        if (x.exclude && x.exclude.has(l.id)) continue;
        if ((l.p.dir === 'ab' && l.a !== u) || (l.p.dir === 'ba' && l.b !== u)) continue; // one-way fiber: light only travels the carried way
        const v = other(l, u), dead = isDead(node(v));
        if (dead && !allowCut && !plan) continue;
        if (x.excludeNodes && x.excludeNodes.has(v) && v !== zId) continue;
        const w = (l.kind === 'fiber' ? +l.p.len : 0.01) + 0.01 + (cut && !plan ? 1e6 : 0) + (dead && !plan ? 1e6 : 0);
        if (dist[v] == null || dist[u] + w < dist[v]) { dist[v] = dist[u] + w; prev[v] = { u, l: l.id }; }
      }
    }
    const nodes = [zId], links = [];
    let c = zId;
    while (c !== aId) { links.unshift(prev[c].l); c = prev[c].u; nodes.unshift(c); }
    return { nodes, links };
  }

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
    return { W0, P0: leg(x, y, fibers), why: '' };
  }
  // a route is unusable if it crosses a cut fiber (or one in the same risk group) or a dead device
  const routeCut = (S, r) => !!r && (r.links.some(id => { const l = S.links.find(o => o.id === id); return l && isCut(S, l); }) || r.nodes.some(id => isDead(S.nodes.find(n => n.id === id))));

  // Channel table for a service. Plan mode: the stored plan, with the service channel forced to the service's own mode.
  // Otherwise: g.nch identical channels in a contiguous block centred in the C-band, service in the middle.
  // A plan entry becomes one or two routed channels (segments): a wavelength converter splits it in two in series (before and after the
  // converter ROADM, each in its own slot, each regenerated), and 1+1 protection makes a working and a protection copy in parallel.
  // lg is the plan entry a segment belongs to, role says which part it is. svcOnProt: the service runs on its protection copy.
  function buildChans(g, svcKey, planOn, slotsN, df, svcOnProt = false) {
    let list;
    if (planOn) {
      list = [];
      g.plan.forEach((c, lg) => {
        const svc = !!c.svc, base = { mode: svc ? svcKey : c.mode, off: Number.isFinite(+c.off) ? +c.off : 0, lg };
        const from = svc ? '' : c.from || '', to = svc ? '' : c.to || '', via = svc ? '' : c.via || '', conv = svc ? '' : c.conv || '', slot = +c.slot;
        const prot = c.prot === '1+1' || c.prot === 'shared', shared = c.prot === 'shared';
        // pc: '' unprotected, 'w' working copy, 'p' protection copy; sec: which side of the converter (0 before, 1 after)
        const mk = (sec, sl, f, t, v, pc, svcFlag) => ({ ...base, slot: sl, svc: svcFlag, from: f, to: t, via: v, sec, pc, shared: shared && pc === 'p', hasConv: !!conv, role: pc === 'w' ? 'work' : pc === 'p' ? 'prot' : 'only' });
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
    return list.map((c, i) => { const m = PHY_.MODES[c.mode] || PHY_.MODES[svcKey], fTHz = PHY_.slotFreqTHz(c.slot, df); return { ...c, idx: i, m, mode: PHY_.MODES[c.mode] ? c.mode : svcKey, Rs: m.Rs, fTHz, f: fTHz * 1e12 }; });
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
    const svcA = S.svc.a, svcZ = S.svc.z, memo = new Map(), { link, linkName } = mkGraph(S);
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
    // Wavelength continuity: a slot can carry one channel per fiber. The service has priority, then plan order; a channel that meets a lit slot is blocked.
    if (!noBlock) {
      const used = new Map();
      chans.map((_, k) => k).sort((a, b) => (chans[b].svc ? 1 : 0) - (chans[a].svc ? 1 : 0) || a - b).forEach(k => {
        const r = routes0[k]; if (!r || dark[k]) return;
        const hit = r.links.find(id => { const o = used.get(chans[k].slot + '|' + id); return o != null && chans[o].lg !== chans[k].lg; }); // the two copies of a 1+1 channel are one signal
        if (hit) { routes[k] = null; blocked[k] = true; why[k] = `slot ${chans[k].slot + 1} is already lit on ${linkName(link(hit))} by another channel`; }
        else r.links.forEach(id => used.set(chans[k].slot + '|' + id, k));
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
    return { routes, routes0, loads, hosts, why, blocked, cutOff, dark };
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
    const g = S.g || {}, num = (v, d) => (Number.isFinite(+v) && v !== '' && v !== null ? +v : d);
    const P = {}; for (const k in RESIL) P[k] = num(g[k], RESIL[k]);
    const { link, node } = mkGraph(S), YEAR = 8760 * 3600, svc = S.svc || {};
    const len = id => { const l = link(id); return l && l.kind === 'fiber' ? +l.p.len : 0; }, km = ids => ids.reduce((a, id) => a + len(id), 0);
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
        else t = route(S, x, y, true, { ignoreCut: true, excludeNodes: new Set([d]) }) ? P.restoreSec : P.mttr * 3600;
        devDown += P.devRate * t; devFail += P.devRate; devWorst = Math.max(devWorst, t);
      }
      if (isProt) {
        const pk = km(pp.P0.links);
        return { kind: prot === 'shared' ? 'shared' : '1+1', km: wk, protKm: pk, failures: lw + devFail, outageSec: Math.max(sw, devWorst), downSec: lw * sw + Uf(wk) * Uf(pk) * YEAR + devDown };
      }
      let down = 0, worst = 0, restorable = 0, fibers = 0;
      for (const id of W.links) {
        if (!len(id)) continue; fibers++;
        const grp = (link(id).p || {}).srlg, mates = grp ? S.links.filter(o => o.p.srlg === grp).map(o => o.id) : [id];
        const alt = route(S, x, y, true, { ignoreCut: true, exclude: new Set([id, ...mates]) }), t = alt ? P.restoreSec : P.mttr * 3600;
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
    const eol = !!opts.eol, rv = !!opts.reverse, W = opts.walk || null; // W: a mesh walk, the simulation of a route other than the service's (see planMesh)
    const pd = (p, k) => (rv && p[k + 'Rev'] !== '' && p[k + 'Rev'] != null && Number.isFinite(+p[k + 'Rev']) ? p[k + 'Rev'] : p[k]);
    const { node, link, linkName } = mkGraph(S);
    const g = { ...S.g }; if (launchOverride != null) g.launch = launchOverride;
    const A = node(W ? W.a : rv ? S.svc.z : S.svc.a), Z = node(W ? W.z : rv ? S.svc.a : S.svc.z);
    if (!W && (!isEnd(A) || !isEnd(Z) || A === Z)) return { status: 'none', headline: 'Pick two transponders or muxponders as the A and Z ends of a service.' };
    if (!W && isDead(A)) return { status: 'los', headline: `${A.name} has failed: nothing is transmitted.` };
    if (!W && isDead(Z)) return { status: 'los', headline: `${Z.name} has failed: nothing receives the signal.` };
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
    const chans = buildChans(g, modeKey, planOn, slotsN, df, svcOnProt);
    if (planOn) g.nch = g.plan.length;
    const svcIdx = Math.max(0, chans.findIndex(c => c.svc)), nChan = chans.length;
    // Mesh: every channel has its own route; this walk follows `path`. Members are the channels that ride (a stretch of) this path,
    // with lo/hi the node positions where they are added and dropped. Link loads count every channel on a fiber, member or not.
    const lastPos = path.nodes.length - 1;
    const mesh = planOn ? (W ? W.mesh : planMesh(S, chans, path, rv)) : null, members = planOn ? (W ? W.members : mesh.hosts[0].members) : [];
    const lohi = chans.map(() => null); members.forEach(m => (lohi[m.k] = m));
    const maskAt = j => { const set = mesh.loads.get(path.links[j]); return chans.map((_, k) => !!set && set.has(k)); }, litCount = j => maskAt(j).filter(Boolean).length;
    const nchLine = Math.max(1, +g.nch), Rs = mode.Rs;
    const reachHz = PHY_.XPM.reachGHz * 1e9, nbWeight = c => (planOn ? (c.m.coh === false ? PHY_.XPM.same : PHY_.XPM.coh) : (g.neighbors === 'coh' ? PHY_.XPM.coh : PHY_.XPM.same));
    // XPM neighbours within reach, weighted by who they are, their power and how far they walk off over this span (fb, Lk)
    const xpmWFor = (i, act, fb, Lk) => (chans[i].m.coh === false ? chans.reduce((a, cj, j) => a + (j !== i && (!act || act[j]) && Math.abs(cj.f - chans[i].f) <= reachHz ? nbWeight(cj) * lin(cj.off - chans[i].off) * PHY_.xpmWalk(fb, Lk, Math.abs(cj.f - chans[i].f)) : 0), 0) : 0);
    const ev = []; // event log replayed per channel after the loop (plan mode only)
    let curAct = planOn ? maskAt(0) : null; // channels lit at the current point of the path (plan mode)
    const txDbm = W && A.type === 'roadm' ? +g.launch : (A.p.tx === '' || A.p.tx == null ? mode.tx : +A.p.tx) - (isEnd(A) ? degOf(A) : 0); // a channel added at a ROADM starts at the launch level; a degraded laser is weaker
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
    function amp(name, nf, ctl, target, gFixed, gmin, gmax, pmax, tiltCtl, look = -1, agc = '', deg = 0) {
      const before = snap(), pin = before.sig;
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
      rec(name, 'amp', before, { gain: G, nf: nfe, note: note || info, agcUs: agc === '' || agc == null || !Number.isFinite(+agc) ? null : +agc });
      if (note) alarms.push({ sev: 'warn', text: `${name}: ${note}.` });
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
        const sb = PHY_.ramanGainSat(fb, Lk, pb, sigW, sl), sf = PHY_.ramanGainSat(fb, Lk, pf, sigW, sl);
        const gb = sb.gain, gf = sf.gain, gr = gb + gf, depl = Math.max(sb.depletion, sf.depletion);
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
        const rel = gr > 0 && full ? chans.map(c => PHY_.ramanRel(npump, c.fTHz, chans[svcIdx].fTHz)) : null;
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
      } else if (t === 'dcm') { const b = snap(); const dil = +pd(nxt.p, 'il') + degOf(nxt), dcd = +pd(nxt.p, 'cd'); loss(dil); cd += dcd; dgd2 += 1; if (planOn) ev.push({ k: 'C', dcd, dg2: 1 }); rec(nxt.name, 'dcm', b, { gain: -dil, note: `${dcd} ps/nm` }); }
      else if (t === 'voa') { const b = snap(), att = +nxt.p.att + degOf(nxt); loss(att); rec(nxt.name, 'voa', b, { gain: -att }); }
      else if (t === 'edfa') { amp(nxt.name, pd(nxt.p, 'nf'), nxt.p.ctl, target, pd(nxt.p, 'gain'), +pd(nxt.p, 'gmin'), +pd(nxt.p, 'gmax'), +pd(nxt.p, 'pmax'), nxt.p.tiltCtl !== false, tv === '' || tv == null ? i + 1 : -1, nxt.p.agcUs, degOf(nxt)); }
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
    // 1+1 protection on signal fail: if the working route is down (not just cut) and the protection route carries the service, switch to it.
    const switchIfBetter = r0 => {
      if (!svcProt || svcOnProt || opts.useProtect || eol || W || !(r0.status === 'down' || r0.status === 'los')) return r0;
      const r2 = simulate(S, launchOverride, { ...opts, useProtect: true });
      if (!r2.mode || (STATUS_RANK[r2.status] ?? 0) >= (STATUS_RANK[r0.status] ?? 0)) return r0;
      r2.alarms.unshift({ sev: 'warn', text: `The working route is down (${r0.headline}): traffic switched to the protection route. There is no protection left.` });
      r2.switched = true; return r2;
    };
    const res = { mode, modeKey, A, Z, path, hops, alarms, km, cd, dgd: Math.sqrt(dgd2), passes, g, rerouteCut, txDbm };
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
    if (losAt) { res.status = 'los'; res.headline = losAt.node ? `LOS at ${Z.name}: ${losAt.node.name} has failed.` : `LOS at ${Z.name}: fiber cut on ${linkName(losAt)}.`; res.prx = -Infinity; return res; }
    const prx = db(P * 1000); res.prx = prx;
    if (prx < mode.rxMin - 12 && !W) {
      res.status = 'los'; res.headline = `LOS at ${Z.name}: ${f1(prx)} dBm is below what the receiver can detect.`;
      alarms.unshift({ sev: 'bad', text: `Rx power ${f1(prx)} dBm is far below the ${f1(mode.rxMin)} dBm sensitivity.` });
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
        const avg = rows.reduce((a, r) => a + r.cumDb, 0) / rows.length;
        // average excursion over the spans for the nonlinear and noise terms, end-of-line excursion for the receiver
        const qAt = s => { const ln = 1 / (1 / snrAse * lin(-s) + 1 / snrNli * lin(2 * s) + 1 / snrRx * lin(-s) + mpi), ov = Math.max(0, prx + s - mode.rxMax) * 1.5;
          return PHY_.qFromBer(PHY_.MODS[mode.mod].ber(PHY_.effSnr(mode, ln, basePen - over + ov))) - res.qThr; };
        const s = cum, prxSurge = prx + s, prxDip = prx - cum;
        res.transient = { lossPct: Math.round(frac * 100), tauUs: T.tauUs, rows, surgeDb: s, prxSurge, prxDip, overload: prxSurge > mode.rxMax, qMarginSurge: qAt(avg), qMarginDip: qAt(-avg), avgDb: avg };
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
          Pc[i] = sP * lin(chans[i].off); Pa[i] = Pc[i] / lin(chans[i].m.txOsnr); Pn[i] = 0; xp[i] = 0; cdc[i] = 0; dg2[i] = 0; psc[i] = 1; alive[i] = true;
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
    if (!eol && !rv && !W) for (const id of path.nodes) {
      const n = node(id), d = degOf(n);
      if (d > 0) alarms.push({ sev: 'warn', text: `${n.name} is degraded: ${n.type === 'edfa' ? `its output is ${f1(d)} dB below the setting and its noise figure is worse` : isEnd(n) ? (id === A.id ? `its laser is ${f1(d)} dB weaker` : `its receiver loses ${f1(d)} dB of SNR`) : `${f1(d)} dB of extra loss`}.` });
    }
    if (svcOnProt && !W) alarms.push({ sev: 'warn', text: protWhy === 'cut' ? `The working route has failed (a cut fiber or a failed device): traffic switched to the protection route (${Math.round(km)} km). There is no protection left until it is repaired.` : 'The working route is down: traffic switched to the protection route. There is no protection left.' });
    if (bad.length) { res.status = 'down'; res.headline = bad[0]; }
    else if (res.qMargin < 1 || alarms.some(a => a.sev !== 'info')) { res.status = 'degraded'; res.headline = res.qMargin < 1 ? `Up, but only ${f1(res.qMargin)} dB of Q margin. Aging or a dirty connector will take it down.` : 'Up, with alarms to look at.'; }
    else { res.status = 'up'; res.headline = `Up with ${f1(res.qMargin)} dB Q margin.`; }
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

  return { TYPES, PREFIX, PRESETS, isEnd, newClient, uid, linkDefaults, sanitize, sanitizePlan, planFromUniform, remapPlan, assignSlots, resilience, RESIL, isCut, candidateRoutes, estimateRoute, planDemands, blockingCurve, optimiseOffsets, fromSpans, mkGraph, route, simulate, reqOsnr };
})();
if (typeof module !== 'undefined') module.exports = MODEL;
