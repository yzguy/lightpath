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
    switch: { label: 'Optical switch', hint: '1x2 switch: one common port, two inputs', maxLinks: 3, def: () => ({ il: 1, pos: 'a', auto: true, revertive: true, wtrMin: 5, switchMs: 20 }) },
    panel: { label: 'Patch panel / ODF', hint: 'Fiber panel: connector loss per port, dirty-connector faults', maxLinks: 96, def: () => ({ ports: 12, il: 0.5, rl: 50, dirty: {} }) },
    mux: { label: 'Mux / Demux', hint: 'Passive DWDM filter', maxLinks: 99, def: () => ({ il: 5, ports: 16, first: 24, bidi: false, role: 'low' }) },
    oadm: { label: 'OADM', hint: 'Passive add/drop filter', maxLinks: 99, def: () => ({ thru: 1.5, ad: 3, tx: 0, sides: 'ew', eFirst: 24, ePorts: 4, wFirst: 24, wPorts: 4, osc: false, p1310: false, o1310: '10g-lr', bidi: false, eRole: 'low', wRole: 'high' }) },
    edfa: { label: 'EDFA', hint: 'Booster, in-line or preamp', maxLinks: 2, def: () => ({ bidi: false, bidiLoss: 1.2, ctl: 'auto', target: '', targetRev: '', gain: 20, gainRev: '', nf: 5, nfRev: '', gmin: 10, gminRev: '', gmax: 30, gmaxRev: '', pmax: 23, pinMax: 10, pmaxRev: '', tiltCtl: true, agcUs: '' }) },
    roadm: { label: 'ROADM', hint: 'WSS node, any degree', maxLinks: 99, def: () => ({ wss: 6, ad: 4, amps: true, nf: 5.5, degrees: 4, ports: 16, first: 24, colorless: true, directionless: true, contentionless: true }) },
    dcm: { label: 'Dispersion comp.', hint: 'DCF module or FBG, cancels CD', maxLinks: 2, def: () => ({ cd: -1360, cdRev: '', il: 7, ilRev: '' }) },
    voa: { label: 'VOA / pad', hint: 'Fixed attenuator', maxLinks: 2, def: () => ({ att: 5 }) },
  };
  const defaultClients = () => Array.from({ length: 4 }, () => newClient());
  const newClient = (optic = '100g-lr4') => ({ optic, len: 0.1, extra: 1 });
  const isEnd = n => !!n && (n.type === 'trx' || n.type === 'mxp'); // service end: a coherent line port that light never passes through
  const PREFIX = { dcm: 'DCM', mxp: 'MXP', trx: 'TRX', mux: 'MUX', panel: 'ODF', splitter: 'SPL', switch: 'SW', host: 'HOST', meter: 'PM', otdr: 'OTDR', oadm: 'OADM', edfa: 'AMP', roadm: 'ROADM', voa: 'VOA' };
  const linkDefaults = kind => (kind === 'fiber' ? { len: 80, fiber: 'smf', extra: 1, extraRev: '', nch: '', raman: 0, ramanRev: '', ramanDir: 'back', ramanPumps: 1, ramanFull: false, dir: 'both', cut: false, cutAt: '', srlg: '', sa: '', sb: '', single: false } : { il: 0.5, len: 3, dir: 'both', cut: false, mport: null, sa: '', sb: '', cport: null, hport: null });

  // The cable a drag between two devices makes: a fiber span between line equipment that normally sits at different sites (amplifiers, ROADMs, OADMs,
  // two muxes, two transponders over dark fiber), a patch cord for everything inside a rack. The cable inspector can change it.
  function cableKind(a, b) {
    const T = new Set([a.type, b.type]), has = t => T.has(t);
    if (['host', 'meter', 'otdr', 'voa', 'dcm'].some(has)) return 'patch';
    if (isEnd(a) && isEnd(b)) return 'fiber';
    if (isEnd(a) || isEnd(b)) return 'patch';
    if (a.type === b.type) return has('splitter') || has('switch') ? 'patch' : 'fiber';
    const line = t => t === 'edfa' || t === 'roadm' || t === 'oadm';
    if (line(a.type) && line(b.type)) return 'fiber';
    if ((has('oadm') && has('mux')) || (has('splitter') && has('switch'))) return 'fiber';
    return 'patch';
  }

