// expected outages from the planned routes
function fmtDur(s) { return s < 1 ? `${(s * 1000).toFixed(s < 0.1 ? 1 : 0)} ms` : s < 120 ? `${s.toFixed(1)} s` : s < 7200 ? `${(s / 60).toFixed(1)} min` : `${(s / 3600).toFixed(1)} h`; }
function resilView() {
  const wrap = el('div', { class: 'planwrap pad' }), rs = MODEL.resilience(S), plan = MODEL.effective(S).g.plan;
  const tbl = el('table', { class: 'tbl' }), th = el('tr'); ['Channel', 'Protection', 'Route km', 'Protect km', 'Cuts / yr', 'Outage per cut', 'Downtime / yr', 'Availability'].forEach(h => th.append(el('th', { text: h })));
  tbl.append(el('thead', {}, [th]));
  const tb = el('tbody');
  rs.forEach((x, i) => {
    const c = plan ? plan[i] : null, name = c ? `Slot ${c.slot + 1} (CH${PHY.slotChannel(c.slot, +S.g.df * 1e9).ch})${c.conv ? ' → ' + (c.slot2 + 1) : ''}${c.svc ? ' (service)' : ''}` : 'Service';
    const nines = x.availability > 0 && x.availability < 1 ? -Math.log10(1 - x.availability) : x.availability >= 1 ? Infinity : 0;
    tb.append(el('tr', { class: x.svc ? 'selrow' : '', title: x.note || '' }, [name, x.kind, x.km ? Math.round(x.km) : '', x.protKm ? Math.round(x.protKm) : '', x.failures ? x.failures.toFixed(2) : '', x.kind === 'no route' ? '' : fmtDur(x.outageSec), fmtDur(x.downSec),
      `${(100 * x.availability).toFixed(x.availability > 0.99999 ? 6 : 4)} % (${isFinite(nines) ? nines.toFixed(1) : '∞'} nines)`].map(v => el('td', { text: String(v) }))));
  });
  tbl.append(tb);
  wrap.append(el('div', { style: 'overflow:auto;max-height:460px' }, [tbl]), el('p', { class: 'muted small', text: 'Expected values from the planned routes on the intact network, not a simulation of events. Unprotected channels restore over another route if one exists (restoration time) and otherwise wait for the repair. 1+1 costs loss detection plus switch time per cut on the working route; shared protection adds the turn-up of the dark route. Both add the small chance that both routes are down at the same time. Cut rate, repair, detection, switch and restoration times are in the inspector (nothing selected).' }));
  return wrap;
}
// Rx power of a surviving channel against time after the event: the surge when channels vanish, the dip when they come back
function traceChart(r) {
  const tr = r.transientTrace, t = r.transient; if (!tr) return el('span');
  const W = 900, H = 240, ml = 52, mr = 16, mt = 16, mb = 40, tEnd = tr.t[tr.t.length - 1], mode = r.mode;
  const up = tr.surge.map(v => r.prx + v), dn = tr.dip.map(v => r.prx + v * 1);
  const lo = Math.min(...dn, mode.rxMin) - 2, hi = Math.max(...up, mode.rxMax) + 2;
  const X = v => ml + v / tEnd * (W - ml - mr), Y = v => mt + (hi - v) / (hi - lo) * (H - mt - mb);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Receiver power against time after the event' });
  const step = Math.max(1, Math.round((hi - lo) / 6));
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) { s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), class: 'grid' })); const x = sv('text', { x: ml - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end' }); x.textContent = v; s.append(x); }
  const tick = Math.pow(10, Math.floor(Math.log10(tEnd / 4))) * (tEnd / 4 / Math.pow(10, Math.floor(Math.log10(tEnd / 4))) > 5 ? 5 : tEnd / 4 / Math.pow(10, Math.floor(Math.log10(tEnd / 4))) > 2 ? 2 : 1);
  for (let v = 0; v <= tEnd; v += tick) { const x = sv('text', { x: X(v), y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); x.textContent = v >= 1000 ? (v / 1000) + ' ms' : v + ' µs'; s.append(x); }
  s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(mode.rxMax), y2: Y(mode.rxMax), class: 'pl l-ase dashed' }), sv('line', { x1: ml, x2: W - mr, y1: Y(mode.rxMin), y2: Y(mode.rxMin), class: 'pl l-ase dashed' }), sv('line', { x1: ml, x2: W - mr, y1: Y(r.prx), y2: Y(r.prx), class: 'nowline' }));
  const lab = (y, txt) => { const x = sv('text', { x: W - mr - 4, y: Y(y) - 4, class: 'ax bad', 'text-anchor': 'end' }); x.textContent = txt; s.append(x); };
  lab(mode.rxMax, `overload ${mode.rxMax} dBm`); lab(mode.rxMin, `sensitivity ${mode.rxMin} dBm`);
  s.append(sv('path', { d: tr.t.map((v, i) => `${i ? 'L' : 'M'}${X(v)},${Y(up[i])}`).join(' '), class: 'pl l-sig' }), sv('path', { d: tr.t.map((v, i) => `${i ? 'L' : 'M'}${X(v)},${Y(dn[i])}`).join(' '), class: 'pl l-nli' }));
  const xl = sv('text', { x: (ml + W - mr) / 2, y: H - 6, class: 'ax', 'text-anchor': 'middle' }); xl.textContent = 'Time after the event'; s.append(xl);
  return el('div', { class: 'chartwrap' }, [el('h3', { text: 'Receiver power through the event' }), s, el('div', { class: 'legend' }, [lg('l-sig', `Channels vanish: peak +${f1(tr.peakDb)} dB`), lg('l-nli', `Channels return${t.rampF < 1 ? ` over ${tr.rampMs} ms` : ' at once'}: dip −${f1(-Math.min(...tr.dip))} dB`), el('span', { class: 'muted', text: 'A surviving channel at the receiver. All amplifiers\' excursions line up in time (the event travels with the signal) and add; each is pulled back once its control loop engages.' })])]);
}
// what happens to the surviving channels when many vanish at once
// per channel: cut a fiber and see what every surviving channel gets (plan mode)
let transCut = null;
function chanTransients() {
  if (!Array.isArray(S.g.plan) || S.g.plan.length < 2) return null;
  const ct = MODEL.channelTransients(S, { cut: transCut });
  if (!ct.cut) return null;
  const box = el('div', { class: 'transchan', style: 'margin-top:20px' }), sel = el('select', { 'aria-label': 'Fiber to cut' });
  ct.fibers.forEach(f => sel.append(el('option', { value: f.id, text: `${f.name} (${f.n} channel${f.n === 1 ? '' : 's'})` }))); sel.value = ct.cut;
  sel.addEventListener('change', () => { transCut = sel.value; renderTabBody(); });
  box.append(el('h3', { text: 'Per channel' }), el('div', { class: 'planbar' }, [el('span', { text: 'Cut' }), sel]));
  if (!ct.rows.length) return (box.append(el('p', { class: 'muted', text: `Every channel crosses ${ct.cutName}, so nobody survives to be surged.` })), box);
  const worst = ct.worst, top = Math.max(0.1, worst.surgeDb), over = ct.rows.filter(x => x.overloadDb > 0).length;
  box.append(el('p', { html: `Cutting <b>${ct.cutName}</b> loses ${ct.lost.length} channel${ct.lost.length === 1 ? '' : 's'}. The other ${ct.rows.length} are lifted by up to <b>${f1(worst.surgeDb)} dB</b> (${chText(worst.slot, true)}), ${over ? `<b class="st-down">${over}</b> past the receiver overload point` : 'none past the receiver overload point'}.` }));
  const tbl = el('table', { class: 'tbl' }), th = el('tr'); ['Channel', 'Mode', 'Rx dBm', 'Lifted by', 'Rx at the surge', 'Amplifiers', ''].forEach(h => th.append(el('th', { text: h }))); tbl.append(el('thead', {}, [th]));
  const tb = el('tbody');
  for (const x of ct.rows) tb.append(el('tr', {}, [chText(x.slot, true) + (x.svc ? ' (service)' : ''), x.modeShort, f1(x.prx), `${f1(x.surgeDb)} dB`, el('span', { class: x.overloadDb > 0 ? 'st-down' : '', text: `${f1(x.prxSurge)} dBm${x.overloadDb > 0 ? ' OVERLOAD' : ''}` }), x.hits.length ? x.hits.map(h => h.name).join(', ') : 'none affected', el('span', { class: 'transbar', style: `width:${Math.max(2, 100 * x.surgeDb / top)}px` })].map(v => (v instanceof Node ? el('td', {}, [v]) : el('td', { text: String(v) })))));
  tbl.append(tb);
  box.append(el('div', { style: 'overflow:auto;max-height:300px' }, [tbl]), el('p', { class: 'muted small', text: `Only the channels whose route crossed the cut are lost; at each amplifier on a survivor's route the lost channels upstream stop loading it, and the survivors are lifted by 10·log10(channels / survivors) less what the control loop holds off. Two spectral terms are added, representative figures: gain tilt (the blue end of the band is lifted about ${Math.round(100 * PHY.TRANSIENT.tiltPerDb)}% more at the band edge than the middle) and spectral hole burning (up to ${Math.round(100 * PHY.TRANSIENT.shb)}% more for a channel within three slots of a lost one). An amplifier is an EDFA or a ROADM with its preamp and booster.` }));
  return box;
}
function transView(r) {
  const wrap = el('div', { class: 'planwrap pad' }), t = r.transient, cs = chanTransients();
  if (!t) return cs ? (wrap.append(el('p', { class: 'muted', text: 'The service has no amplifier shared with other channels, so it has nothing to surge. The other channels may:' }), cs), wrap) : el('p', { class: 'muted pad', text: 'Needs at least two channels on an amplifier: with a single channel there is nothing that can surge.' });
  const tbl = el('table', { class: 'tbl' }), th = el('tr'); ['Amplifier', 'Channels', 'Lost', 'Surge if uncontrolled', 'Control µs', 'Lets through', 'Accumulated', ''].forEach(h => th.append(el('th', { text: h })));
  tbl.append(el('thead', {}, [th]));
  const tb = el('tbody'), top = Math.max(0.1, t.surgeDb);
  for (const x of t.rows) tb.append(el('tr', {}, [x.name, x.n, x.lost, `${f1(x.rawDb)} dB`, x.agcUs, `${f1(x.peakDb)} dB`, `${f1(x.cumDb)} dB`, el('span', { class: 'transbar', style: `width:${Math.max(2, 100 * x.cumDb / top)}%` })].map(v => (v instanceof Node ? el('td', { class: 'barcell' }, [v]) : el('td', { text: String(v) })))));
  tbl.append(tb);
  const mode = r.mode, ok = v => (v >= 0 ? 'st-up' : 'st-down');
  wrap.append(el('p', { text: `Losing ${t.lossPct}% of the channels at once (an upstream cut, a protection switch) lifts the surviving channels by up to ${f1(t.surgeDb)} dB by the receiver.` }),
    el('div', { style: 'overflow:auto;max-height:340px' }, [tbl]),
    el('div', { class: 'transsum' }, [
      el('span', {}, ['Rx power at the surge: ', el('b', { class: t.overload ? 'st-down' : 'st-up', text: `${f1(t.prxSurge)} dBm` }), ` (overload at ${mode.rxMax} dBm)`]),
      el('span', {}, ['Q margin during the surge: ', el('b', { class: ok(t.qMarginSurge), text: `${f1(t.qMarginSurge)} dB` })]),
      el('span', {}, ['Rx power when they return: ', el('b', { text: `${f1(t.prxDip)} dBm` }), ` (sensitivity ${mode.rxMin} dBm)`]),
      el('span', {}, ['Q margin during that dip: ', el('b', { class: ok(t.qMarginDip), text: `${f1(t.qMarginDip)} dB` })])]),
    traceChart(r), ...(cs ? [cs] : []),
    el('p', { class: 'muted small', text: `A gain-controlled EDFA would raise the survivors by 10·log10(channels / survivors) if it did not react; its control loop holds off all but a fraction 1 − exp(−response / ${t.tauUs} µs) of that. The excursions of a cascade add. Raman pumps and ROADM wavelength blockers are not modelled. The event size and amplifier response are in the inspector (nothing selected); an amplifier can override the response.` }));
  return wrap;
}

// client ports (muxponders)
function clientsView(r) {
  const wrap = el('div', { class: 'tablewrap' });
  if (!r.clients || !r.clients.length) return el('p', { class: 'muted pad', text: 'Neither end of this service is a muxponder. Drag a Muxponder onto the bench to add client ports (100G, 400G and other grey optics) in front of the coherent line port.' });
  for (const c of r.clients) {
    const over = c.total > c.lineRate;
    wrap.append(el('h3', { text: `${c.node.name}: ${c.ports.length} client port${c.ports.length === 1 ? '' : 's'} into ${PHY.MODES[c.node.p.mode].short}` }),
      el('p', { class: 'small ' + (over ? 'cs-down' : 'muted'), text: `${c.total}G of clients on a ${c.lineRate}G line (${Math.round(100 * c.total / c.lineRate)}% full).${over ? ' The line port cannot carry this.' : ''}` }));
    const t = el('table', { class: 'hops' });
    t.append(el('thead', {}, el('tr', {}, ['Port', 'Optic', 'Rate', 'Rated reach', 'Length', 'Tx dBm', 'Loss dB', 'Rx dBm', 'Margin dB', 'Status'].map(h => el('th', { text: h })))));
    const tb = el('tbody');
    c.ports.forEach(p => tb.append(el('tr', {}, [p.idx, p.optic.name, p.optic.rate + 'G', p.optic.reach + ' km', p.len + ' km', f1(p.optic.tx), f1(p.loss), f1(p.rx), f1(p.margin),
      p.status === 'ok' ? 'OK' : p.status === 'warn' ? 'WARN: ' + p.notes[0] : 'DOWN: ' + p.notes[0]].map((x, i) => el('td', { text: String(x), class: i === 9 ? 'cs-' + p.status : '' })))));
    t.append(tb); wrap.append(t);
  }
  wrap.append(el('p', { class: 'muted small', text: 'Client optics are grey (non-DWDM) modules cabled to the host router or switch, so each port has its own short fiber budget, separate from the line system. Values are representative IEEE/MSA numbers; check your module datasheet.' }));
  return wrap;
}

// power map
function powerChart(r) {
  const W = 900, H = 300, ml = 46, mr = 16, mt = 16;
  let mb = 54;
  const hops = r.hops, total = Math.max(1, r.km), nodeW = Math.max(4, total * 0.05);
  let x = 0; const xs = hops.map(h => { const x0 = x; x += h.kind === 'span' ? h.len : h.kind === 'patch' ? nodeW * 0.25 : nodeW; return [x0, x]; });
  const X = v => ml + v / x * (W - ml - mr);
  // Device labels: first row that is free at this x, so neighbours on a busy path never overprint.
  const rowEnd = [], rowOf = {};
  hops.forEach((h, i) => {
    if (h.kind === 'span' || h.kind === 'patch') return;
    const cx = (X(xs[i][0]) + X(xs[i][1])) / 2, half = h.name.length * 3.3 + 3;
    let row = 0; while (rowEnd[row] != null && rowEnd[row] > cx - half) row++;
    rowEnd[row] = cx + half; rowOf[i] = row;
  });
  mb = 38 + Math.max(3, rowEnd.length) * 13;
  const vals = hops.flatMap(h => [h.in.sig, h.out.sig, h.in.ase, h.out.ase, h.in.nli, h.out.nli]).filter(v => v > -90);
  const ymax = Math.ceil((Math.max(...vals) + 3) / 5) * 5, ymin = Math.floor((Math.min(...vals) - 3) / 10) * 10;
  const Y = v => mt + (ymax - Math.max(v, ymin)) / (ymax - ymin) * (H - mt - mb);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Power level diagram' });
  for (let v = ymin; v <= ymax; v += 10) { s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), class: 'grid' })); const t = sv('text', { x: ml - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = v; s.append(t); }
  const yl = sv('text', { x: 12, y: mt + (H - mt - mb) / 2, class: 'ax', transform: `rotate(-90 12 ${mt + (H - mt - mb) / 2})`, 'text-anchor': 'middle' }); yl.textContent = 'dBm (per channel)'; s.append(yl);
  // osnr gap shading
  let area = ''; hops.forEach((h, i) => { area += `${i ? 'L' : 'M'}${X(xs[i][0])},${Y(h.in.sig)} L${X(xs[i][1])},${Y(h.out.sig)} `; });
  for (let i = hops.length - 1; i >= 0; i--) area += `L${X(xs[i][1])},${Y(hops[i].out.ase)} L${X(xs[i][0])},${Y(hops[i].in.ase)} `;
  s.append(sv('path', { d: area + 'Z', class: 'gap' }));
  for (const [key, cls] of [['nli', 'l-nli'], ['ase', 'l-ase'], ['sig', 'l-sig']]) {
    let d = ''; hops.forEach((h, i) => { if (h.in[key] < -90 && h.out[key] < -90) return; let a = h.in[key]; if (a < -90) { a = h.out[key] - (h.gain || 0); d = ''; } d += `${d ? 'L' : 'M'}${X(xs[i][0])},${Y(a)} L${X(xs[i][1])},${Y(h.out[key])} `; });
    if (d) s.append(sv('path', { d, class: 'pl ' + cls }));
  }
  hops.forEach((h, i) => {
    if (h.kind === 'span' || h.kind === 'patch') {
      if (h.kind === 'span' && X(xs[i][1]) - X(xs[i][0]) > String(h.len).length * 6.5 + 28) { const t = sv('text', { x: (X(xs[i][0]) + X(xs[i][1])) / 2, y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); t.textContent = `${h.len} km`; s.append(t); }
      return;
    }
    const cx = (X(xs[i][0]) + X(xs[i][1])) / 2;
    s.append(sv('line', { x1: cx, x2: cx, y1: mt, y2: H - mb, class: 'tick' }));
    const t = sv('text', { x: cx, y: H - mb + 30 + rowOf[i] * 13, class: 'ax node-ax', 'text-anchor': 'middle' }); t.textContent = h.name.replace(/ (pre|boost|express|add|drop)$/, m => m); s.append(t);
  });
  if (isFinite(r.prx)) { const t = sv('text', { x: W - mr, y: mt - 4, class: 'ax strong', 'text-anchor': 'end' }); t.textContent = `Rx ${f1(r.prx)} dBm`; s.append(t); }
  const wrap = el('div', { class: 'chartwrap' }, [s]);
  wrap.append(el('div', { class: 'legend' }, [lg('l-sig', 'Signal power'), lg('l-ase', 'ASE noise in 0.1 nm'), lg('l-nli', 'NLI noise in 0.1 nm'), el('span', { class: 'muted', text: 'Shaded gap between signal and ASE = OSNR. Spans slope down (fiber loss), amplifiers step up.' })]));
  return wrap;
}
const lg = (c, t) => el('span', {}, [el('i', { class: c }), t]);

function hopTable(r) {
  const t = el('table', { class: 'hops' });
  t.append(el('thead', {}, el('tr', {}, ['Element', 'Type', 'km', 'In dBm/ch', 'Out dBm/ch', 'Gain / loss', 'Total out', 'OSNR', 'GSNR', 'Notes'].map(h => el('th', { text: h })))));
  const tb = el('tbody');
  r.hops.forEach(h => {
    const tot = h.out.sig > -90 ? f1(h.out.sig + db(h.nch)) : '—';
    tb.append(el('tr', { class: h.kind === 'cut' || h.over ? 'cutrow' : h.warn ? 'warnrow' : '' }, [h.name, h.kind, Math.round(h.km), h.kind === 'tx' ? '' : f1(h.in.sig), h.out.sig > -90 ? f1(h.out.sig) : 'LOS', h.gain != null ? (h.gain > 0 ? '+' : '') + f1(h.gain) : '', tot + (h.nch > 1 ? ` (${h.nch}ch)` : ''), h.osnr != null ? f1(h.osnr) : '', h.gosnr != null ? f1(h.gosnr) : '',
      [h.nf ? `NF ${f1(h.nf)}` : '', h.launch != null ? `launch ${f1(h.launch)}` : '', (h.over || h.warn ? '⚠ ' : '') + (h.note || '')].filter(Boolean).join(' · ')].map(c => el('td', { text: String(c) }))));
  });
  t.append(tb);
  return el('div', { class: 'tablewrap' }, [el('p', { class: 'muted small', text: 'What the PM counters would read along the path, per channel. OSNR / GSNR in 0.1 nm measured after each element.' }), t]);
}

// spectrum (OSA-style view at any point along the path)
let specHop = null; // name of the chosen measurement point; null = busiest point on the path
function spectrumView(r) {
  const wrap = el('div', { class: 'chartwrap' });
  const hops = r.hops.filter(h => h.kind !== 'cut');
  if (!hops.length) return wrap;
  const maxN = Math.max(...hops.map(x => x.nch));
  const keys = hops.map((x, i) => `${x.name}#${hops.slice(0, i).filter(y => y.name === x.name).length}`); // names repeat (every patch cord), so add an occurrence number
  let hi = specHop == null ? -1 : keys.indexOf(specHop);
  if (hi < 0) hi = hops.map(x => x.nch).lastIndexOf(maxN);
  const h = hops[hi], df = +r.g.df * 1e9, slots = PHY.cBandSlots(df);
  let lit = Math.min(h.nch, slots);
  const sel = el('select', { id: 'spec-hop', 'aria-label': 'Measurement point' });
  hops.forEach((x, i) => sel.append(el('option', { value: i, text: `After ${x.name}${x.kind === 'patch' ? ` (${keys[i].split('#')[1] * 1 + 1})` : ''}` })));
  sel.value = hi; sel.addEventListener('change', () => { specHop = keys[+sel.value]; renderTabBody(); });
  wrap.append(el('div', { class: 'sp-sel' }, [el('label', { for: 'spec-hop', text: 'Measure at' }), sel]));

  const W = 900, H = 300, ml = 46, mr = 16, mt = 16, mb = 40, f0 = PHY.CBAND.f0 / 1e12, f1v = (PHY.CBAND.f0 + PHY.CBAND.width) / 1e12;
  const Rs = r.mode.Rs, dens = 10 * Math.log10(Rs / PHY.BREF); // channel power -> level seen in a 0.1 nm slice
  const plan = r.segments && h.lit ? r.segments.filter((_, k) => h.lit[k]) : null; // a custom channel plan draws every channel lit at this point as itself
  const isBg = c => !!(r.derived && r.derived.plan[c.idx] && r.derived.plan[c.idx].filler);
  const lvl = c => h.out.sig + c.off - 10 * Math.log10(PHY.MODES[c.modeKey].Rs / PHY.BREF);
  const sigD = h.out.sig - dens, aseD = h.out.ase, nliD = h.out.nli;
  const sigTop = plan ? Math.max(...plan.map(lvl)) : sigD;
  const top = Math.max(sigTop, aseD) + 8, ymax = Math.ceil(top / 10) * 10, ymin = Math.floor((Math.min(aseD, nliD > -90 ? nliD : aseD) - 14) / 10) * 10;
  const X = f => ml + (f - f0) / (f1v - f0) * (W - ml - mr), Y = v => mt + (ymax - Math.min(ymax, Math.max(ymin, v))) / (ymax - ymin) * (H - mt - mb);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Optical spectrum at the selected point' });
  for (let v = ymin; v <= ymax; v += 10) { s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), class: 'grid' })); const t = sv('text', { x: ml - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = v; s.append(t); }
  for (let f = Math.ceil(f0 * 2) / 2; f <= f1v + 1e-9; f += 0.5) { const t = sv('text', { x: X(f), y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); t.textContent = f.toFixed(1); s.append(t); }
  const xl = sv('text', { x: (ml + W - mr) / 2, y: H - 6, class: 'ax', 'text-anchor': 'middle' }); xl.textContent = 'Frequency (THz)'; s.append(xl);
  const yl = sv('text', { x: 12, y: mt + (H - mt - mb) / 2, class: 'ax', transform: `rotate(-90 12 ${mt + (H - mt - mb) / 2})`, 'text-anchor': 'middle' }); yl.textContent = 'dBm in 0.1 nm'; s.append(yl);
  // ASE fills the whole band (amplifiers amplify noise in unlit slots too)
  if (h.out.ase > -90) s.append(sv('rect', { x: X(f0), y: Y(aseD), width: X(f1v) - X(f0), height: Math.max(0, Y(ymin) - Y(aseD)), class: 'sp-ase' }));
  s.append(sv('line', { x1: X(f0), x2: X(f1v), y1: Y(aseD), y2: Y(aseD), class: 'pl l-ase' }));
  let first;
  if (plan) {
    lit = plan.length; first = Math.min(...plan.map(c => c.slot));
    const lo = first, hi = Math.max(...plan.map(c => c.slot));
    for (const c of plan) {
      const m = PHY.MODES[c.modeKey], fc = c.fTHz, half = Math.min(m.Rs, df * 0.98) / 2e12;
      const sk = lvl(c) + (hi > lo && h.tilt ? h.tilt * (0.5 - (c.slot - lo) / (hi - lo)) : 0);
      const rect = sv('rect', { x: X(fc - half), y: Y(sk), width: Math.max(1.5, X(fc + half) - X(fc - half)), height: Math.max(0, Y(ymin) - Y(sk)), class: c.svc ? 'sp-me' : isBg(c) ? 'sp-bg' : m.coh === false ? 'sp-nrz' : 'sp-ch' });
      const tt = sv('title', {}); tt.textContent = `Slot ${c.slot + 1} (CH${PHY.slotChannel(c.slot, +r.g.df * 1e9).ch}): ${m.short}, ${fc.toFixed(2)} THz${isBg(c) ? ', background (Line load)' : ''}`; rect.append(tt); s.append(rect);
    }
  } else {
    // lit block centred in the band; the service channel sits in its middle
    first = Math.floor((slots - lit) / 2);
    const me = first + Math.floor(lit / 2);
    for (let k = first; k < first + lit; k++) {
      const fc = f0 + (k + 0.5) * df / 1e12, half = Math.min(Rs, df * 0.92) / 2e12;
      const sk = sigD + (lit > 1 && h.tilt ? h.tilt * (0.5 - (k - first) / (lit - 1)) : 0); // SRS: low-frequency channels gain, high-frequency lose
      s.append(sv('rect', { x: X(fc - half), y: Y(sk), width: Math.max(1.5, X(fc + half) - X(fc - half)), height: Math.max(0, Y(ymin) - Y(sk)), class: k === me ? 'sp-me' : 'sp-bg' }));
    }
  }
  if (nliD > -90 && lit > 0) { // NLI is noise-like and sits under the lit channels
    const hiSlot = plan ? Math.max(...plan.map(c => c.slot)) + 1 : first + lit;
    const a = f0 + first * df / 1e12, b = f0 + hiSlot * df / 1e12;
    s.append(sv('line', { x1: X(a), x2: X(b), y1: Y(nliD), y2: Y(nliD), class: 'pl l-nli' }));
  }
  const tn = sv('text', { x: W - mr, y: mt + 10, class: 'ax strong', 'text-anchor': 'end' }); tn.textContent = `${lit} ch lit of ${slots} slots (${r.g.df} GHz grid)`; s.append(tn);
  const sw = (style, text) => el('span', {}, [el('i', { style }), text]), bgSw = 'background:none;border:1px dashed var(--muted)';
  const chans = !plan ? [sw(bgSw, 'Background: Line load copies of the service channel')]
    : r.derived ? [sw('background:var(--sig);opacity:.6', 'Cabled channels'), ...(plan.some(isBg) ? [sw(bgSw, 'Background channels (Line load)')] : [])] : [lg('l-sig', 'Neighbouring channels')];
  wrap.append(s, el('div', { class: 'legend' }, [...chans, sw('background:var(--accent)', 'Service channel'), lg('l-ase', 'ASE floor'), lg('l-nli', 'NLI under the lit channels'),
    el('span', { class: 'muted', text: `Channel power here is ${f1(h.out.sig)} dBm (reads ${f1(sigD)} dBm in a 0.1 nm slice, since a ${(Rs / 1e9).toFixed(0)} GBd signal is ${f1(dens)} dB wider). OSNR = channel power − ASE floor = ${f1(h.out.sig - aseD)} dB. All channels launch at equal power.${h.tilt > 0.05 ? ` SRS has tilted them by ${f1(h.tilt)} dB, lowest to highest frequency.` : ''}` })]));
  return wrap;
}

// constellation
let constSeed = 1;
function rand() { constSeed = (constSeed * 16807) % 2147483647; return constSeed / 2147483647; }
function gauss() { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); }
function constView(r) {
  const wrap = el('div', { class: 'constwrap' });
  const c = el('canvas', { width: 640, height: 640, class: 'const', 'aria-label': 'Constellation diagram' });
  const m = PHY.MODS[r.mode.mod], M = m.M, side = Math.sqrt(M);
  const ook = M === 2; // NRZ: two levels on one axis
  const pts = []; if (ook) pts.push([-1, 0], [1, 0]); else for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) pts.push([(2 * i - side + 1), (2 * j - side + 1)]);
  const Es = pts.reduce((a, p) => a + p[0] ** 2 + p[1] ** 2, 0) / M;
  const snr = r.effDb != null ? lin(r.effDb) : 0.5, sigma = Math.sqrt(Es / snr / (ook ? 1 : 2));
  const ctx = c.getContext('2d'), cs = getComputedStyle(document.documentElement);
  const fg = cs.getPropertyValue('--ink').trim(), acc = cs.getPropertyValue('--sig').trim(), mut = cs.getPropertyValue('--line').trim();
  const sc = ook ? 150 : 290 / side, cx = 320;
  ctx.strokeStyle = mut; ctx.lineWidth = 1;
  if (ook) { ctx.beginPath(); ctx.moveTo(cx, 20); ctx.lineTo(cx, 620); ctx.stroke(); }
  else for (let i = 1; i < side; i++) { const v = (2 * i - side) * sc; /* decision boundaries */ ctx.beginPath(); ctx.moveTo(cx + v, 20); ctx.lineTo(cx + v, 620); ctx.moveTo(20, cx + v); ctx.lineTo(620, cx + v); ctx.stroke(); }
  constSeed = 7;
  ctx.fillStyle = acc; ctx.globalAlpha = 0.45;
  const n = 4000;
  for (let k = 0; k < n; k++) { const p = pts[Math.floor(rand() * M)]; const x = cx + (p[0] + sigma * gauss()) * sc, y = ook ? cx + (rand() - 0.5) * 420 : cx - (p[1] + sigma * gauss()) * sc; ctx.fillRect(x - 1.6, y - 1.6, 3.2, 3.2); }
  ctx.globalAlpha = 1; ctx.fillStyle = fg;
  if (!ook) pts.forEach(p => { ctx.beginPath(); ctx.arc(cx + p[0] * sc, cx - p[1] * sc, 6, 0, 7); ctx.fill(); });
  else pts.forEach(p => ctx.fillRect(cx + p[0] * sc - 2, 20, 4, 600));
  const evm = 100 / Math.sqrt(snr);
  wrap.append(c, el('div', { class: 'constinfo' }, [
    el('h3', { text: r.mode.coh === false ? `${r.mode.mod}: received level histogram (1 / 0)` : `DP-${r.mode.mod}, one polarization` }),
    specRow('Effective SNR', `${f1(r.effDb)} dB`), specRow('EVM (rms)', `${f1(evm)} %`), specRow('Pre-FEC BER', r.ber < 1e-15 ? '<1e-15' : r.ber.toExponential(2)), specRow('Needed at FEC limit', `${f1(PHY.requiredEffSnrDb(r.mode))} dB SNR`),
    el('p', { class: 'muted small', text: 'Each dot is a received symbol. Noise smears dots away from the ideal points (black). A dot that lands across a grid line is decoded as the wrong symbol: that is a bit error. FEC can fix errors up to its BER limit. Try raising the span length and watch the clouds merge.' })]));
  return wrap;
}

// can the hosts reach each other, and what is the first thing in the way if not; plus offered traffic over the channels
let reachSel = null;
// OTDR: the trace of a fiber from a test point, with its events
let otdrSel = null;
function otdrView() {
  const wrap = el('div', { class: 'pad' }), ots = S.nodes.filter(n => n.type === 'otdr');
  if (!ots.length) return el('p', { class: 'muted pad', text: 'Add an OTDR (in the palette), plug it into a patch panel port, and this tab shows the trace: fiber loss, connectors, breaks and the end of the fiber. Try the "OTDR and power meter" scenario.' });
  if (!ots.some(n => n.id === otdrSel)) otdrSel = ots[0].id;
  const sel = el('select', { id: 'otdr-sel', 'aria-label': 'OTDR' }); ots.forEach(n => sel.append(el('option', { value: n.id, text: n.name }))); sel.value = otdrSel; sel.addEventListener('change', () => { otdrSel = sel.value; renderTabBody(); });
  const t = MODEL.otdrTrace(S, otdrSel), W = 760, H = 300, ml = 52, mr = 16, mt = 16, mb = 38, maxKm = Math.max(0.1, t.endKm * 1.05), minDb = Math.min(-5, ...t.points.map(q => q.db)) - 3, topDb = 28;
  const X = km => ml + (W - ml - mr) * km / maxKm, Y = db => mt + (H - mt - mb) * (topDb - db) / (topDb - minDb);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'OTDR trace', style: 'width:100%;max-width:760px;height:auto' });
  for (let d = Math.ceil(minDb / 5) * 5; d <= 25; d += 5) { svg.append(sv('line', { x1: ml, x2: W - mr, y1: Y(d), y2: Y(d), class: 'pl grid' })); const e = sv('text', { x: ml - 6, y: Y(d) + 4, class: 'glyph small', 'text-anchor': 'end' }); e.textContent = d; svg.append(e); }
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].find(v => maxKm / v <= 10) || 100;
  for (let k = 0; k <= maxKm; k += step) { const e = sv('text', { x: X(k), y: H - mb + 14, class: 'glyph small', 'text-anchor': 'middle' }); e.textContent = +k.toFixed(2); svg.append(e); }
  const ax = sv('text', { x: ml + (W - ml - mr) / 2, y: H - 6, class: 'glyph small', 'text-anchor': 'middle' }); ax.textContent = 'distance from the OTDR (km)'; svg.append(ax);
  const ay = sv('text', { x: 12, y: mt + 10, class: 'glyph small' }); ay.textContent = 'dB'; svg.append(ay);
  svg.append(sv('path', { d: t.points.map((q, i) => (i ? 'L' : 'M') + X(q.km).toFixed(1) + ',' + Y(q.db).toFixed(1)).join(' '), class: 'pl l-sig', fill: 'none', 'stroke-width': 2 }));
  t.events.forEach((e, i) => { // a reflective event is a spike above the trace; its height follows the reflectance
    const h = Math.max(0, 0.5 * (60 + e.refl)), lvl = t.points.filter(q => Math.abs(q.km - e.km) < 1e-9)[0];
    const bdb = lvl ? lvl.db : 0; svg.append(sv('line', { x1: X(e.km), x2: X(e.km), y1: Y(bdb), y2: Y(bdb + h), class: 'pl l-ase', 'stroke-width': 1.5 }));
    const lab = sv('text', { x: X(e.km) + 3, y: Y(bdb + h) - 3, class: 'glyph small' }); lab.textContent = i + 1; svg.append(lab);
  });
  wrap.append(el('div', { class: 'planbar' }, [el('b', { text: 'OTDR trace' }), sel, el('span', { class: 'muted small', text: `${t.pulse} ns pulse · dynamic range ${t.dr} dB · dead zone ${(t.dz * 1000).toFixed(1)} m` })]));
  wrap.append(svg, el('p', { class: 'small', text: `${t.endWhy ? 'The trace ends: ' + t.endWhy + '.' : ''} Distance ${f1(t.endKm)} km, ${f1(t.loss)} dB of loss along the trace (one way).` }));
  const tbl = el('table', { class: 'tbl' }), th = el('tr'); ['#', 'km', 'Event', 'Loss dB', 'Reflectance dB', 'Note'].forEach(h => th.append(el('th', { text: h }))); tbl.append(el('thead', {}, [th]));
  const tb = el('tbody'); t.events.forEach((e, i) => tb.append(el('tr', {}, [i + 1, e.km.toFixed(3), e.name, e.loss ? f1(e.loss) : '', e.refl > -80 ? Math.round(e.refl) : '', e.note || ''].map(x => el('td', { text: String(x) }))))); tbl.append(tb);
  wrap.append(el('div', { style: 'overflow:auto' }, [tbl]));
  return wrap;
}
// 1310 nm ports: what each OADM's 1310 nm port carries and whether the light gets across
function b1310View() {
  const B = lastRes && lastRes.b1310, O = lastRes && lastRes.osc; if (!(B && B.links.length) && !(O && O.links.length)) return null;
  const wrap = el('div', { class: 'pad' }), stt = r => el('span', { class: r.status === 'up' ? 'st-up' : r.status === 'warn' ? 'st-degraded' : 'st-down', text: (r.status === 'up' ? 'UP' : r.status === 'warn' ? 'WARN' : r.status === 'blocked' ? 'BLOCKED' : 'DOWN') + (r.why ? ': ' + r.why : '') });
  const table = (title, rows, carries) => {
    const tbl = el('table', { class: 'tbl' }), th = el('tr'); ['From', 'To', ...(carries ? ['Carries'] : []), 'Fiber km', 'Loss dB', 'Rx dBm', 'Margin dB', 'Status'].forEach(h => th.append(el('th', { text: h })));
    tbl.append(el('thead', {}, [th]));
    const tb = el('tbody');
    for (const r of rows) tb.append(el('tr', {}, [r.aName, r.bName || 'stops', ...(carries ? [r.opticName || ''] : []), r.km != null ? f1(r.km) : '', r.loss != null ? f1(r.loss) : '', r.rx != null ? f1(r.rx) : '', r.margin != null ? f1(r.margin) : '', stt(r)].map(x => (x instanceof Node ? el('td', {}, [x]) : el('td', { text: String(x) })))));
    tbl.append(tb); wrap.append(el('h3', { text: title }), el('div', { style: 'overflow:auto' }, [tbl]));
  };
  if (O && O.links.length) { table('Supervisory channel (1510 nm), span by span', O.links, false); wrap.append(el('p', { class: 'small', text: 'Management domains: ' + (O.domains.map(d => d.join(' + ')).join('; ') || 'none') })); }
  if (B && B.links.length) table('1310 nm ports', B.links, true);
  return wrap;
}
function reachView() {
  const b = b1310View(), v = reachHosts();
  if (!b) return v; const w = el('div', {}); w.append(b, v); return w;
}
function reachHosts() {
  const hosts = S.nodes.filter(n => n.type === 'host'), wrap = el('div', { class: 'planwrap pad' });
  if (hosts.length < 2) return el('p', { class: 'muted pad', text: 'Add two or more hosts (Host / router in the palette) and cable each to a transponder or a muxponder client port. This tab then shows whether they can reach each other over the optical network, how long it takes, and what is wrong when they cannot.' });
  const R = MODEL.reach(S, lastRes), T = MODEL.traffic(S, lastRes), name = id => (node(id) || {}).name, hplan = lastRes && lastRes.derived ? lastRes.derived.plan : S.g.plan;
  const key = r => r.a + '|' + r.z; if (!R.some(r => key(r) === reachSel)) reachSel = (R.find(r => !r.ok) || R[0]) ? key(R.find(r => !r.ok) || R[0]) : null;
  const tbl = el('table', { class: 'tbl reachtbl' }), th = el('tr'); ['Between', 'Reachable', 'One-way latency', 'Rate', 'First problem'].forEach(h => th.append(el('th', { text: h })));
  tbl.append(el('thead', {}, [th]));
  const tb = el('tbody');
  for (const r of R) tb.append(el('tr', { class: key(r) === reachSel ? 'selrow' : '', onclick: () => { reachSel = key(r); hiChan = r.entry && r.entry.i >= 0 && hplan ? hplan[r.entry.i] || null : null; renderCanvas(); renderTabBody(); } },
    [`${name(r.a)} ↔ ${name(r.z)}`, el('span', { class: r.ok ? (r.degraded ? 'st-degraded' : 'st-up') : 'st-down', text: r.ok ? (r.degraded ? 'YES (degraded)' : 'YES') : 'NO' }), r.ok ? fmtUs(r.latencyUs) : '', r.ok ? `${r.rate}G` : '', r.ok ? '' : r.why].map(x => (x instanceof Node ? el('td', {}, [x]) : el('td', { text: x })))));
  tbl.append(tb);
  wrap.append(el('div', { class: 'planbar' }, [el('b', { text: 'Can they reach each other?' }), el('span', { class: 'muted small', text: `${R.filter(r => r.ok).length} of ${R.length} host pairs` })]), el('div', { style: 'overflow:auto;max-height:200px' }, [tbl]));
  const cur = R.find(r => key(r) === reachSel);
  if (cur) {
    const ol = el('ol', { class: 'steps' }, cur.steps.map(st => el('li', { class: st.ok ? 'ok' : 'bad', text: st.text })));
    wrap.append(el('h3', { text: `Trace: ${name(cur.a)} → ${name(cur.z)}` }), ol);
    if (cur.ok) wrap.append(el('p', { class: 'muted small', text: `One way ${fmtUs(cur.latencyUs)} (${Math.round(cur.km)} km of fiber at 4.9 µs/km plus the transceivers), round trip ${fmtUs(2 * cur.latencyUs)}. Rate ${cur.rate}G.` }));
  }
  // offered traffic
  S.flows ??= [];
  const flowBar = el('div', { class: 'planbar' }, [el('b', { text: 'Traffic' }), el('button', { class: 'btn', text: 'Add flow', onclick: () => { S.flows.push({ a: hosts[0].id, z: hosts[1].id, gbps: 10 }); renderTabBody(); save(); } })]);
  wrap.append(flowBar);
  if (S.flows.length) {
    const ft = el('table', { class: 'tbl' }), fh = el('tr'); ['From', 'To', 'Offered (Gb/s)', 'Delivered', 'Loss', 'Slot', 'Latency', ''].forEach(h => fh.append(el('th', { text: h })));
    ft.append(el('thead', {}, [fh]));
    const ftb = el('tbody');
    S.flows.forEach((f, i) => {
      const o = T.flows[i], hs = k => { const sl = el('select', { 'aria-label': k === 'a' ? 'From' : 'To' }); hosts.forEach(h => sl.append(el('option', { value: h.id, text: h.name }))); sl.value = f[k]; sl.addEventListener('change', () => { f[k] = sl.value; if (f.a === f.z) f[k === 'a' ? 'z' : 'a'] = hosts.find(h => h.id !== f[k]).id; renderTabBody(); save(); }); return sl; };
      const g = el('input', { type: 'number', step: 1, min: 0, max: 1600, value: f.gbps, class: 'slotin', 'aria-label': 'Offered Gb/s' }); g.addEventListener('change', () => { if (isFinite(+g.value)) { f.gbps = Math.max(0, +g.value); renderTabBody(); save(); } });
      ftb.append(el('tr', {}, [hs('a'), hs('z'), g, o && o.ok ? `${f1(o.delivered)}` : '0', el('span', { class: o && o.ok ? (o.lossPct > 0.05 ? 'st-degraded' : 'st-up') : 'st-down', text: o && o.ok ? `${f1(o.lossPct)} %` : '100 %' }), o && o.slot != null ? String(o.slot + 1) : '', o && o.ok ? fmtUs(o.latencyUs) : (o ? o.why : ''),
        el('button', { class: 'btn', text: '×', title: 'Remove', 'aria-label': `Remove the flow from ${name(f.a)} to ${name(f.z)}`, onclick: () => { S.flows.splice(i, 1); renderTabBody(); save(); } })].map(x => (x instanceof Node ? el('td', {}, [x]) : el('td', { text: x })))));
    });
    ft.append(ftb); wrap.append(el('div', { style: 'overflow:auto;max-height:200px' }, [ft]));
    if (T.channels.length) wrap.append(el('div', {}, T.channels.map(c => el('div', { class: 'small', style: 'display:flex;gap:10px;align-items:center;margin:3px 0' }, [el('span', { text: `${c.slot != null ? 'Slot ' + (c.slot + 1) : 'Service channel'} ${name(c.a)} → ${name(c.z)}: ${f1(c.load)} of ${c.cap}G` }), el('div', { class: 'ubar' + (c.over ? ' over' : ''), style: 'flex:0 0 140px' }, [el('i', { style: `width:${Math.round(100 * c.util)}%` })]), el('span', { class: 'muted', text: `${Math.round(100 * c.util)} %` })]))));
  }
  wrap.append(el('p', { class: 'muted small', text: 'Latency is propagation in glass (4.9 µs per km), any dispersion-compensating fiber, and about 10 µs of DSP and FEC at each coherent transceiver (1 µs for a 10G direct-detect one): representative figures. A flow is capped by its host port and client optic, and flows sharing a channel in one direction are scaled down together when they exceed the line rate. There is no packet network: this checks that the optical layer can carry the traffic, not how routing behaves.' }));
  return wrap;
}

// channels defined by the cabling: transponders on numbered mux ports pair up by slot (see MODEL.derive); the table only shows them
function derivedPlanView(r, D) {
  const wrap = el('div', { class: 'planwrap pad' }), res = r && r.channels ? r.channels : [];
  const toTable = () => {
    S.g.plan = MODEL.sanitizePlan(D.plan.map(c => ({ slot: c.slot, mode: c.mode, off: c.off, svc: c.svc, from: c.filler || c.svc ? '' : c.from, to: c.filler || c.svc ? '' : c.to, via: '', conv: c.filler || c.svc ? '' : c.conv || '', slot2: c.slot2 ?? c.slot, prot: c.prot || '', slotRev: c.slotRev })), +S.g.df);
    S.g.nch = S.g.plan.length; S.links.forEach(l => { if (l.p.mport != null) l.p.mport = null; }); hiChan = null; renderAll(); toast('The channels are now a plain table; the mux ports are cleared.');
  };
  wrap.append(el('div', { class: 'planbar' }, [el('b', { text: `${D.plan.length} channels` }), el('span', { class: 'muted small', text: `${D.paired} from the cabling${D.fillers ? `, ${D.fillers} background (to reach the channel count)` : ''}` }),
    el('button', { class: 'btn', text: 'Edit as a table', title: 'Turn the derived channels into an editable plan and clear the mux ports', onclick: toTable })]));
  wrap.append(el('p', { class: 'muted small', text: 'These channels follow the cabling. Plug a transponder into a port of a mux, tune it (or leave it on Auto), and plug its partner into the port for the same slot on the far mux. Click a row to light its route on the canvas.' }));
  const tbl = el('table', { class: 'tbl plantbl' }), th = el('tr'); ['Slot (there / back)', 'Channel · THz', 'Mode', 'From', 'To', 'Protect / convert', 'Offset dB', 'Rx dBm', 'GSNR', 'Q margin', 'Status'].forEach(h => th.append(el('th', { text: h })));
  tbl.append(el('thead', {}, [th]));
  const tb = el('tbody');
  D.plan.forEach((c, i) => {
    const o = res[i], m = PHY.MODES[c.mode], fromN = c.filler ? 'background' : (node(c.from) || {}).name || '', toN = c.filler ? '' : (node(c.to) || {}).name || '';
    const off = el('input', { type: 'number', step: 0.5, min: -10, max: 10, value: c.off, class: 'slotin', 'aria-label': `Power offset for ${slotLbl(c.slot)}`, disabled: !!c.filler });
    off.addEventListener('change', () => { const t = node(c.tx); if (t && isFinite(+off.value)) { t.p.off = Math.max(-10, Math.min(10, +off.value)); renderAll(); } });
    tb.append(el('tr', { class: (c.svc ? 'selrow' : '') + (hiChan === c ? ' hirow' : ''), onclick: ev => { if (ev.target.closest('select,input,button')) return; hiChan = hiChan === c ? null : c; renderCanvas(); renderTabBody(); } },
      [String(c.slot + 1) + (c.slotRev != null ? ` / ${c.slotRev + 1}` : ''), chText(c.slot, true), m.short, fromN, toN, c.filler ? '' : [c.prot === '1+1' ? '1+1' : c.prot === 'shared' ? '1:N' : '', c.conv ? `convert at ${(node(c.conv) || {}).name}, ${slotLbl(c.slot)} → ${c.slot2 + 1}` : ''].filter(Boolean).join(', '), c.filler ? '' : off,
        o && o.prx != null ? f1(o.prx) : '', o && o.gosnr != null ? f1(o.gosnr) : '', o && o.qMargin != null ? (o.qMargin > 0 ? '+' : '') + f1(o.qMargin) : '',
        o ? el('span', { class: 'st-' + o.status, text: STATUS[o.status] + (o.notes && o.notes.length ? ': ' + o.notes[0] : '') }) : ''].map(x => (x instanceof Node ? el('td', {}, [x]) : el('td', { text: x })))));
  });
  tbl.append(tb);
  wrap.append(el('div', { style: 'overflow:auto;max-height:380px' }, [tbl]));
  (D.notes || []).forEach(t => wrap.append(el('p', { class: 'muted small', text: t })));
  if (D.dark.length) wrap.append(el('h3', { text: 'Dark transponders' }), el('ul', { class: 'small' }, D.dark.map(x => el('li', { text: x.why }))));
  return wrap;
}

// channel plan: which channels share the line (mode, grid slot, power offset) and how each one is doing
function planView(r) {
  { const D = (r && r.derived) || MODEL.derive(S); if (D) return derivedPlanView(r, D); }
  const wrap = el('div', { class: 'planwrap pad' });
  const svcNode = node(S.svc.a), svcMode = svcNode && isEnd(svcNode) ? svcNode.p.mode : 'zrp400';
  const slots = PHY.cBandSlots(+S.g.df * 1e9), modes = Object.entries(PHY.MODES).map(([k, m]) => [k, m.short]);
  if (!S.g.plan) {
    wrap.append(el('p', { class: 'muted', text: `The line carries ${S.g.nch} identical ${PHY.MODES[svcMode].short} channels in the middle of the C-band. Customise the plan to mix 10G, 100G and 400G channels, put them anywhere on the ${S.g.df} GHz grid and give each a power offset. Every channel then gets its own Rx power, GSNR and margin, nonlinear noise depends on its real neighbours, and 10G channels feel cross-phase modulation from the channels around them.` }));
    wrap.append(el('button', { class: 'btn', text: 'Customise channel plan', onclick: () => { S.g.plan = MODEL.planFromUniform(S.g, svcMode); S.g.nch = S.g.plan.length; renderAll(); } }));
    return wrap;
  }
  const plan = S.g.plan, bySlot = new Map();
  plan.forEach(c => bySlot.set(c.slot, [...(bySlot.get(c.slot) || []), c]));
  const commit = () => { plan.sort((a, b) => a.slot - b.slot); S.g.nch = plan.length; renderAll(); };
  let brush = 'zrp400';
  const brushSel = el('select', { 'aria-label': 'Mode for new channels' }); modes.forEach(([k, t]) => brushSel.append(el('option', { value: k, text: t }))); brushSel.value = brush; brushSel.addEventListener('change', () => { brush = brushSel.value; });
  wrap.append(el('div', { class: 'planbar' }, [
    el('b', { text: `${plan.length} channels on ${slots} slots` }), el('span', { class: 'muted small', text: 'New channels use' }), brushSel,
    el('button', { class: 'btn', text: 'Assign slots (first fit)', title: 'Give every channel except the service the lowest slot that is free on all the fibers of its route. Channels with no fiber in common end up sharing slots.', onclick: () => {
      const np = MODEL.assignSlots(S); if (!np) return toast('Nothing to assign: pick a service between two transponders first.');
      S.g.plan = np; S.g.nch = np.length; hiChan = null; renderAll(); toast(`${np.length} channels in ${new Set(np.map(c => c.slot)).size} slots`); } }),
    el('button', { class: 'btn', text: 'Optimise power offsets', title: 'Search the power offsets of the other channels for the best worst-channel margin (the service stays at 0 dB)', onclick: () => {
      const o = MODEL.optimiseOffsets(S); if (!o) return toast('Needs a channel plan with at least two channels.');
      plan.forEach((c, i) => { c.off = o.offsets[i]; }); renderAll(); toast(`Worst channel margin ${f1(o.before.min)} → ${f1(o.after.min)} dB`); } }),
    el('button', { class: 'btn', text: 'Add channel', title: 'Add a channel in the first empty slot', onclick: () => { const free = [...Array(slots).keys()].find(k => !bySlot.has(k)); if (free == null) return toast('Every slot is taken: change a slot number to reuse one.'); plan.push({ slot: free, mode: brush, off: 0, svc: false, from: '', to: '', via: '', conv: '', slot2: free, prot: '' }); commit(); } }),
    el('button', { class: 'btn', text: 'Reset to uniform', onclick: () => { S.g.plan = null; hiChan = null; renderAll(); } })]));
  const strip = el('div', { class: 'planstrip', role: 'group', 'aria-label': 'C-band slots' });
  for (let k = 0; k < slots; k++) {
    const cs = bySlot.get(k) || [], c = cs.find(x => x.svc) || cs[0], m = c && PHY.MODES[c.mode];
    strip.append(el('button', { class: 'pcell' + (c ? (m.coh === false ? ' nrz' : ' coh') + (c.svc ? ' me' : '') + (cs.length > 1 ? ' multi' : '') : ''), title: cs.length > 1 ? `Slot ${k + 1} (CH${PHY.slotChannel(k, +S.g.df * 1e9).ch}): ${cs.length} channels reuse this slot on different routes. Change their slot numbers in the table` : c ? `Slot ${k + 1} (CH${PHY.slotChannel(k, +S.g.df * 1e9).ch}): ${m.short}${c.svc ? ' (service)' : ''}. Click to remove` : `Slot ${k + 1} (CH${PHY.slotChannel(k, +S.g.df * 1e9).ch}): empty. Click to add a ${PHY.MODES[brush].short} channel`, 'aria-label': `Slot ${k + 1} (CH${PHY.slotChannel(k, +S.g.df * 1e9).ch})`, text: '',
      onclick: () => { if (cs.length > 1) return toast(`${cs.length} channels share ${slotLbl(k)}. Change their slot numbers in the table or remove them there.`); if (c) { if (c.svc) return toast('The service channel cannot be removed. Make another channel the service first.'); plan.splice(plan.indexOf(c), 1); } else plan.push({ slot: k, mode: brush, off: 0, svc: false, from: '', to: '', via: '', conv: '', slot2: k, prot: '' }); commit(); } }));
  }
  wrap.append(strip, el('p', { class: 'muted small', text: 'Teal = coherent, amber = direct-detection (10G), outlined = the service channel. Click an empty slot to add a channel, an occupied one to remove it. A slot with a double edge is reused by several channels on routes that share no fiber.' }));
  // Any ROADM or transponder can be where a channel is added or dropped: the channel is routed between them over the cabled network
  const pathRoadms = S.nodes.filter(n => n.type === 'roadm' || n.type === 'oadm' || isEnd(n));
  const anySingle = S.links.some(l => l.kind === 'fiber' && l.p.single); // a single fiber carries both directions, so a channel has a slot each way
  const tbl = el('table', { class: 'tbl plantbl' }), th = el('tr'); ['', 'Slot', ...(anySingle ? ['Slot back'] : []), 'Channel · THz', 'Mode', 'Route', 'Offset dB', 'Rx dBm', 'GSNR', 'Q margin', 'XPM', 'Status', '', ''].forEach(h => th.append(el('th', { text: h })));
  tbl.append(el('thead', {}, [th]));
  const tb = el('tbody');
  for (const c of plan) {
    const o = r && r.channels ? r.channels[plan.indexOf(c)] : null, m = PHY.MODES[c.mode];
    const radio = el('input', { type: 'radio', name: 'svcch', 'aria-label': `Make ${slotLbl(c.slot)} the service channel` }); radio.checked = c.svc; radio.addEventListener('change', () => { plan.forEach(x => (x.svc = x === c)); commit(); });
    const ms = el('select', {}); modes.forEach(([k, t]) => ms.append(el('option', { value: k, text: t }))); ms.value = svcNode && c.svc ? svcMode : c.mode; ms.disabled = !!c.svc; ms.title = c.svc ? 'The service channel always uses the transponder mode' : '';
    ms.addEventListener('change', () => { c.mode = ms.value; commit(); });
    const slotIn = el('input', { type: 'number', step: 1, min: 1, max: slots, value: c.slot + 1, 'aria-label': 'Slot number', class: 'slotin' });
    slotIn.addEventListener('change', () => { const v = Math.round(+slotIn.value); if (isFinite(v) && v >= 1 && v <= slots) { c.slot = v - 1; commit(); } else { slotIn.value = c.slot + 1; toast(`Slots run from 1 to ${slots}.`); } });
    const revIn = el('input', { type: 'number', step: 1, min: 1, max: slots, value: c.slotRev != null ? c.slotRev + 1 : '', placeholder: 'same', 'aria-label': `Slot on the way back for ${slotLbl(c.slot)}`, class: 'slotin', title: 'On a single fiber the way back needs its own slot. Blank = the same slot, which a single fiber cannot carry.' });
    revIn.addEventListener('change', () => { const v = Math.round(+revIn.value); if (revIn.value === '') { c.slotRev = null; commit(); } else if (isFinite(v) && v >= 1 && v <= slots && v - 1 !== c.slot) { c.slotRev = v - 1; commit(); } else { revIn.value = c.slotRev != null ? c.slotRev + 1 : ''; toast('The way back needs a different slot from the way there.'); } });
    const nodeSel = (key, ends, label) => {
      const sel = el('select', { 'aria-label': `${label} for ${slotLbl(c.slot)}` }); sel.append(el('option', { value: '', text: ends }));
      (key === 'via' || key === 'conv' ? pathRoadms.filter(n => n.type === 'roadm') : pathRoadms).forEach(n => sel.append(el('option', { value: n.id, text: n.name })));
      if (c[key] && !pathRoadms.some(n => n.id === c[key])) sel.append(el('option', { value: c[key], text: '(missing device)' }));
      sel.value = c[key] || ''; sel.disabled = !!c.svc || (key === 'via' && !!c.conv); sel.title = c.svc ? 'The service channel runs end to end' : '';
      sel.addEventListener('change', () => { c[key] = sel.value; if (c.from && c.from === c.to) c[key === 'from' ? 'to' : 'from'] = ''; if (c.conv && (c.conv === c.from || c.conv === c.to)) c.conv = ''; if (c.conv) { c.via = ''; if (!Number.isFinite(c.slot2)) c.slot2 = c.slot; } commit(); });
      if (key === 'via') sel.title = c.svc ? 'The service channel takes the shortest route' : c.conv ? 'A converted channel takes the shortest route on each side of the converter' : 'Force the route through this ROADM instead of taking the shortest path';
      if (key === 'conv') sel.title = c.svc ? 'The service channel is not converted' : 'Regenerate the channel at this ROADM into another slot: clears accumulated noise and lets the two sides use different slots';
      return sel;
    };
    const slot2In = el('input', { type: 'number', step: 1, min: 1, max: slots, value: (Number.isFinite(c.slot2) ? c.slot2 : c.slot) + 1, 'aria-label': `Slot after the converter for ${slotLbl(c.slot)}`, class: 'slotin', title: 'Slot after the converter' });
    slot2In.addEventListener('change', () => { const v = Math.round(+slot2In.value); if (isFinite(v) && v >= 1 && v <= slots) { c.slot2 = v - 1; commit(); } else { slot2In.value = (Number.isFinite(c.slot2) ? c.slot2 : c.slot) + 1; toast(`Slots run from 1 to ${slots}.`); } });
    slot2In.hidden = !c.conv;
    const convCell = el('div', { class: 'pair' }, [nodeSel('conv', 'None', 'Convert at'), slot2In]);
    const protSel = el('select', { 'aria-label': `Protection for ${slotLbl(c.slot)}` }); [['', 'None'], ['1+1', '1+1 dedicated'], ['shared', '1:N shared']].forEach(([v, t]) => protSel.append(el('option', { value: v, text: t })));
    protSel.value = c.prot === '1+1' || c.prot === 'shared' ? c.prot : ''; protSel.disabled = false;
    protSel.title = c.conv ? '1+1 on each side of the converter, separately (the converter ROADM itself is shared). ' + '1+1:' : '1+1: a second copy runs on the shortest route that shares no fiber with the working one. Both are lit; the receiver takes the working copy until it fails. 1:N shared: the protection route is dark until the working one fails, so it loads nothing and its slot may be shared with other channels\' protection routes; its margin is predicted by simulating the failure.';
    protSel.addEventListener('change', () => { c.prot = protSel.value; commit(); });
    const off = el('input', { type: 'number', step: 0.5, min: -10, max: 10, value: c.off, 'aria-label': `Power offset for ${slotLbl(c.slot)}` }); off.addEventListener('change', () => { if (isFinite(+off.value)) { c.off = Math.max(-10, Math.min(10, +off.value)); commit(); } });
    const del = el('button', { class: 'btn', text: '×', title: 'Remove channel', 'aria-label': `Remove the channel in ${slotLbl(c.slot)}`, disabled: c.svc, onclick: () => { plan.splice(plan.indexOf(c), 1); if (planEdit === c) planEdit = null; commit(); } });
    // the routing of a channel is a sentence, and its controls open only when asked for: most rows keep the defaults (shortest route, no converter, no protection)
    const nm = id => (node(id) || {}).name || '(missing device)', editing = planEdit === c;
    const extras = [c.via && !c.conv ? `via ${nm(c.via)}` : '', c.conv && !c.svc ? `converts at ${nm(c.conv)}, slot ${c.slot + 1} → ${(Number.isFinite(c.slot2) ? c.slot2 : c.slot) + 1}` : '', c.prot === '1+1' ? '1+1 dedicated' : c.prot === 'shared' ? '1:N shared' : ''].filter(Boolean).join(' · ');
    const routeCell = el('span', {}, [c.svc ? 'A end → Z end (the service)' : `${c.from ? nm(c.from) : 'A end'} → ${c.to ? nm(c.to) : 'Z end'}`, extras ? el('span', { class: 'muted', text: ' · ' + extras }) : null]);
    const modeText = PHY.MODES[svcNode && c.svc ? svcMode : c.mode].short, offText = c.off ? (c.off > 0 ? '+' : '') + c.off : '0';
    const editBtn = el('button', { class: 'btn', text: editing ? 'Done' : 'Edit', 'aria-expanded': editing ? 'true' : 'false', title: 'Mode, route, converter, protection and power offset for this channel', 'aria-label': `${editing ? 'Close the editor for' : 'Edit'} the channel in ${slotLbl(c.slot)}`, onclick: () => { planEdit = editing ? null : c; renderTabBody(); if (!editing) { const f = document.querySelector('.editrow select'); if (f) f.focus(); } } }); // opening the editor moves focus into it
    const row = el('tr', { class: (c.svc ? 'selrow' : '') + (hiChan === c ? ' hirow' : ''), onclick: ev => { if (ev.target.closest('select,input,button')) return; hiChan = hiChan === c ? null : c; renderCanvas(); renderTabBody(); }, title: o && o.route && o.route.length ? 'Route: ' + o.route.join(' → ') + (o.protection ? '\n' + ((o.protection.active === 'work' ? o.protection.protect : o.protection.work).predicted ? 'Shared protection, predicted by failing the working route (' : 'Standby (') + (o.protection.active === 'work' ? 'protection' : 'working') + ' copy): ' + ((o.protection.active === 'work' ? o.protection.protect : o.protection.work).route.join(' → ') || (o.protection.active === 'work' ? o.protection.protect : o.protection.work).notes[0]) : '') + (o.converted ? '\nConverted at ' + (o.segments[0].toName || '') + ': slot ' + (o.slot + 1) + ' then slot ' + (o.slot2 + 1) : '') : '' }, [radio, slotIn, ...(anySingle ? [revIn] : []), chText(c.slot, true), modeText, routeCell, offText,
      o && o.prx != null ? f1(o.prx) : '', o && o.gosnr != null ? f1(o.gosnr) : '', o && o.qMargin != null ? (o.qMargin > 0 ? '+' : '') + f1(o.qMargin) : '', o && m.coh === false ? f1(o.xpmPen) : '',
      o ? el('span', { class: 'st-' + o.status, text: STATUS[o.status] + (o.notes.length ? ': ' + o.notes[0] : '') }) : '', editBtn, del].map(x => (x instanceof Node ? el('td', {}, [x]) : el('td', { text: x }))));
    tb.append(row);
    if (editing) { // the controls, with labels, directly under the channel
      const fld = (label, ...ctl) => el('label', { class: 'fld' }, [el('span', { text: label }), ...ctl]);
      tb.append(el('tr', { class: 'editrow' }, [el('td', { colspan: 15 + (anySingle ? 1 : 0) }, [el('div', { class: 'editgrid' }, [
        fld('Mode', ms), fld('Add at', nodeSel('from', 'A end', 'Add at')), fld('Drop at', nodeSel('to', 'Z end', 'Drop at')), fld('Route via', nodeSel('via', 'Shortest', 'Route via')),
        fld('Convert at', convCell), fld('Protection', protSel), fld('Power offset (dB)', off)])])]));
    }
  }
  tbl.append(tb);
  wrap.append(el('div', { style: 'overflow:auto;max-height:420px' }, [tbl]));
  if (r && r.linkLoad && r.linkLoad.length > 1) wrap.append(el('p', { class: 'muted small', text: 'Channels per fiber: ' + r.linkLoad.filter(l => node(S.links.find(x => x.id === l.id).a) && S.links.find(x => x.id === l.id).kind === 'fiber').map(l => `${l.name} ${l.n}`).join(', ') + '.' }));
  wrap.append(el('p', { class: 'muted small', text: 'Slot numbers are editable: channels on routes with no fiber in common may share a slot (wavelength reuse), but two channels in one slot on a shared fiber cannot both be lit and the later one is BLOCKED. "Assign slots" does a first-fit assignment for you. Offset = this channel\'s power relative to the service channel, set at the line mux (a 10G optic beside 400G usually wants a few dB less). The service channel (radio button) takes its mode from the transponder. "Add at" and "Drop at" pick the ROADMs or transponders between which a channel runs (blank = the A and Z ends of the service; the service channel always runs end to end). Each channel takes the shortest route over the cabled network unless \"Via\" forces it through a ROADM (a diverse or protection route), loads only the fibers on it and accumulates noise only along it; click a row to highlight its route on the canvas. Per-span channel counts on the fibers are ignored in plan mode.' }));
  return wrap;
}

// launch sweep
function sweepChart(r) {
  const W = 900, H = 300, ml = 46, mr = 16, mt = 16, mb = 40, lo = -8, hi = 8;
  const pts = []; for (let p = lo; p <= hi + 1e-9; p += 0.25) { const q = simulate(p, { single: true, reverse: dir === 'rev' }); if (q.gosnr != null) pts.push({ p, g: q.gosnr, o: q.osnr, qm: q.qMargin }); }
  const wrap = el('div', { class: 'chartwrap' });
  if (pts.length < 3) { wrap.append(el('p', { class: 'muted pad', text: 'No signal at the receiver, so there is nothing to sweep.' })); return wrap; }
  const ys = pts.flatMap(p => [p.g, Math.min(p.o, p.g + 12)]).concat([r.req]);
  const ymax = Math.ceil((Math.max(...ys) + 1) / 5) * 5, ymin = Math.floor((Math.min(...ys) - 1) / 5) * 5;
  const X = v => ml + (v - lo) / (hi - lo) * (W - ml - mr), Y = v => mt + (ymax - Math.min(ymax, Math.max(ymin, v))) / (ymax - ymin) * (H - mt - mb);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'GSNR versus launch power' });
  for (let v = ymin; v <= ymax; v += 5) { s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), class: 'grid' })); const t = sv('text', { x: ml - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = v; s.append(t); }
  for (let v = lo; v <= hi; v += 2) { const t = sv('text', { x: X(v), y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); t.textContent = (v > 0 ? '+' : '') + v; s.append(t); }
  const xl = sv('text', { x: (ml + W - mr) / 2, y: H - 6, class: 'ax', 'text-anchor': 'middle' }); xl.textContent = 'Launch power per channel (dBm)'; s.append(xl);
  s.append(sv('rect', { x: ml, y: Y(r.req), width: W - ml - mr, height: Math.max(0, Y(ymin) - Y(r.req)), class: 'failzone' }));
  const rl = sv('text', { x: W - mr - 4, y: Y(r.req) + 14, class: 'ax bad', 'text-anchor': 'end' }); rl.textContent = `Required OSNR ${f1(r.req)} dB: below this line the link fails`; s.append(rl);
  s.append(sv('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.p)},${Y(p.o)}`).join(' '), class: 'pl l-ase dashed' }));
  s.append(sv('path', { d: pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.p)},${Y(p.g)}`).join(' '), class: 'pl l-sig' }));
  const best = pts.reduce((a, b) => (b.g > a.g ? b : a));
  s.append(sv('circle', { cx: X(best.p), cy: Y(best.g), r: 5, class: 'dot-best' }));
  const bt = sv('text', { x: X(best.p), y: Y(best.g) - 12, class: 'ax strong', 'text-anchor': 'middle' }); const bestTxt = `${best.p > 0 ? '+' : ''}${best.p} dBm`; bt.textContent = `optimum ${bestTxt}`; s.append(bt);
  if (r.gosnr != null && S.g.launch >= lo && S.g.launch <= hi) { s.append(sv('line', { x1: X(S.g.launch), x2: X(S.g.launch), y1: mt, y2: H - mb, class: 'nowline' })); s.append(sv('circle', { cx: X(S.g.launch), cy: Y(r.gosnr), r: 5, class: 'dot-now' })); }
  if (Math.abs(best.p - S.g.launch) >= 0.25) wrap.append(el('p', { class: 'pad' }, [el('button', { class: 'btn primary', type: 'button', text: `Use ${bestTxt}`, title: 'Set Amp output in the header to the optimum', onclick: act(() => { S.g.launch = best.p; }, `Amp output set to ${bestTxt} per channel`) }),
    el('span', { class: 'muted', text: ` Amp output is ${S.g.launch > 0 ? '+' : ''}${S.g.launch} dBm; the best GSNR here is at ${bestTxt}.` })]));
  wrap.append(s, el('div', { class: 'legend' }, [lg('l-sig', 'GSNR (ASE + nonlinearity)'), lg('l-ase dashed', 'OSNR (ASE only, what an OSA shows)'), lg('dot-now-i', 'Current global launch power'),
    el('span', { class: 'muted', text: 'Too little power and amplifier noise wins. Too much and fiber nonlinearity wins. The top of the curve is the optimum. Only amplifiers in Auto mode follow the global launch power.' })]));
  wrap.append(loadChart(r));
  return wrap;
}
// Q margin against the number of channels lit (a uniform line), with the launch power fixed or re-optimised for each load
function loadChart(r) {
  const W = 900, H = 260, ml = 46, mr = 16, mt = 16, mb = 40, ns = [4, 8, 16, 24, 32, 48, 64, 80, 96].filter(n => n <= PHY.cBandSlots(+S.g.df * 1e9));
  const run = (n, re) => { const q = MODEL.simulate({ ...S, g: { ...S.g, plan: null, nch: n, reopt: re } }, undefined, { single: true, reverse: dir === 'rev' }); return q.qMargin; };
  const a = ns.map(n => run(n, false)), b = ns.map(n => run(n, true));
  const wrap = el('div', { class: 'chartwrap' });
  if (a.some(v => v == null) || ns.length < 3) return wrap;
  const all = a.concat(b), ymax = Math.ceil(Math.max(...all) + 0.5), ymin = Math.floor(Math.min(...all, 0) - 0.5), lo = ns[0], hi = ns[ns.length - 1];
  const X = v => ml + (v - lo) / (hi - lo) * (W - ml - mr), Y = v => mt + (ymax - Math.min(ymax, Math.max(ymin, v))) / (ymax - ymin) * (H - mt - mb);
  const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Q margin versus number of channels, fixed and re-optimised launch power' });
  for (let v = Math.ceil(ymin); v <= ymax; v += Math.max(1, Math.round((ymax - ymin) / 6))) { s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), class: 'grid' })); const t = sv('text', { x: ml - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = v; s.append(t); }
  ns.forEach(n => { const t = sv('text', { x: X(n), y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); t.textContent = n; s.append(t); });
  const xl = sv('text', { x: (ml + W - mr) / 2, y: H - 6, class: 'ax', 'text-anchor': 'middle' }); xl.textContent = 'Channels lit (uniform line)'; s.append(xl);
  const yl = sv('text', { x: 12, y: mt + (H - mt - mb) / 2, class: 'ax', transform: `rotate(-90 12 ${mt + (H - mt - mb) / 2})`, 'text-anchor': 'middle' }); yl.textContent = 'Q margin (dB)'; s.append(yl);
  s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(0), y2: Y(0), class: 'nowline' }));
  s.append(sv('path', { d: a.map((v, i) => `${i ? 'L' : 'M'}${X(ns[i])},${Y(v)}`).join(' '), class: 'pl l-ase dashed' }));
  s.append(sv('path', { d: b.map((v, i) => `${i ? 'L' : 'M'}${X(ns[i])},${Y(v)}`).join(' '), class: 'pl l-sig' }));
  wrap.append(el('h3', { class: 'pad', text: 'As channels come and go' }), s, el('div', { class: 'legend' }, [lg('l-ase dashed', `Fixed launch (${f1(+S.g.launch)} dBm and amplifier targets)`), lg('l-sig', 'Re-optimised for the load on each span'),
    el('span', { class: 'muted', text: 'The fixed line is tuned for one load. The re-optimised line moves every amplifier to the GN optimum for the channels actually on the next span, so a lightly loaded line runs hotter and a full one cooler. Plans and per-span loads are ignored here: it is a uniform line with that many channels.' })]));
  return wrap;
}

