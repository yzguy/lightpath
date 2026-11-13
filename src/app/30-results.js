// ---------- globals bar ----------
function bindGlobals() {
  const nch = $('#g-nch'), df = $('#g-df'), la = $('#g-launch');
  nch.max = PHY.cBandSlots(+S.g.df * 1e9); nch.value = S.g.nch; df.value = S.g.df; la.value = S.g.launch;
  const D = lastRes && lastRes.derived, lbl = $('#g-nch-l'), out = $('#g-nch-v');
  nch.disabled = !!S.g.plan && !D;
  if (S.g.plan && !D) { out.textContent = `${S.g.plan.length} ch · plan`; lbl.title = 'The channel plan on the Channels tab sets the load. Use "Reset to uniform" there to go back to this slider.'; }
  else if (D) { out.textContent = `${S.g.nch} ch`; lbl.title = `How many channels the fibers carry. ${D.paired} come from the cabled transponders; the other ${D.fillers} are background channels that load the amplifiers and add nonlinear noise like real traffic would.`; }
  else { out.textContent = `${S.g.nch} ch`; lbl.title = `How many channels the fibers carry: the service plus ${Math.max(0, S.g.nch - 1)} identical background channels. More channels share the amplifier power and add nonlinear noise.`; }
  $('#g-launch-v').textContent = (S.g.launch > 0 ? '+' : '') + S.g.launch + ' dBm/ch';
}
$('#g-nch').addEventListener('input', e => { if (S.g.plan) return; S.g.nch = +e.target.value; $('#g-nch-v').textContent = `${S.g.nch} ch`; renderAll(); });
$('#g-df').addEventListener('change', e => { const old = +S.g.df; S.g.df = +e.target.value; if (S.g.plan) { S.g.plan = MODEL.remapPlan(S.g.plan, old, S.g.df); if (S.g.plan) S.g.nch = S.g.plan.length; }
  const max = PHY.cBandSlots(S.g.df * 1e9); if (S.g.nch > max) { S.g.nch = max; toast(`Only ${max} channels fit the C band at ${S.g.df} GHz: the line now carries ${max}`); } renderAll(); });
$('#g-launch').addEventListener('input', e => { S.g.launch = +e.target.value; $('#g-launch-v').textContent = (S.g.launch > 0 ? '+' : '') + S.g.launch + ' dBm/ch'; recompute(); });
$('#preset').addEventListener('change', e => { if (e.target.value) applyPreset(e.target.value); else syncLab(); });
$('#btn-reset').addEventListener('click', () => applyPreset(labKey));
$('#chsum').addEventListener('click', () => { tab = 'plan'; renderTabBody(); });
$('#btn-fit').addEventListener('click', () => { fitView(); applyView(); });
$('#btn-itu').addEventListener('click', () => learn('itu'));
const syncExpert = () => { document.body.classList.toggle('expert', expert); $('#btn-expert').setAttribute('aria-pressed', expert); };
syncExpert();
$('#btn-expert').addEventListener('click', () => { expert = !expert; try { localStorage.setItem('lightpath-expert', expert ? '1' : '0'); } catch (e) { /* no storage */ } syncExpert(); renderAll(); toast(expert ? 'Expert mode: advanced settings and the Planner, Resilience, Transients and Raman tabs are shown' : 'Expert mode off: advanced settings are hidden unless they are in use'); });
$('#btn-undo').addEventListener('click', undo); $('#btn-redo').addEventListener('click', redo);
$('#btn-clear').addEventListener('click', () => {
  const b = $('#btn-clear');
  if (b.dataset.armed) { S.nodes = []; S.links = []; S.svc = { a: null, z: null }; labKey = ''; sel = null; delete b.dataset.armed; b.textContent = 'Clear canvas'; checkpoint(); renderAll(); toast('Cleared the canvas', { label: 'Undo', fn: undo }); }
  else { b.dataset.armed = '1'; b.textContent = 'Click again to clear'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Clear canvas'; }, 2500); }
});
const labData = () => ({ nodes: S.nodes, links: S.links, g: S.g, svc: S.svc, demands: S.demands, flows: S.flows });
$('#btn-export').addEventListener('click', () => { $('#io').hidden = false; $('#io-text').value = JSON.stringify(labData(), null, 1); });
$('#io-close').addEventListener('click', () => { $('#io').hidden = true; });
$('#io-copy').addEventListener('click', () => { const t = $('#io-text'); navigator.clipboard?.writeText(t.value).then(() => toast('Copied topology JSON'), () => { t.select(); toast('Select-all done; press Ctrl/Cmd+C'); }) ?? t.select(); });
$('#io-load').addEventListener('click', () => {
  try { const o = MODEL.sanitize(JSON.parse($('#io-text').value)); S = { ...S, ...o }; labKey = ''; sel = null; $('#io').hidden = true; fitView(); checkpoint(); renderAll(); toast('Topology loaded', { label: 'Undo', fn: undo }); }
  catch (e) { toast('That text is not a topology export. Paste the JSON from Export.'); }
});

// A share link carries the lab (not the pan and zoom) in the URL fragment, deflated and base64url-encoded, so it never reaches a server.
// Opening one is an import: it goes through sanitize, and inflating stops at SHARE_MAX bytes so a crafted link cannot expand without bound.
const SHARE_MAX = 4e6;
async function packLab() {
  const b = new Uint8Array(await new Response(new Blob([JSON.stringify(labData())]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let t = ''; for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpackLab(t) {
  const bin = atob(t.replace(/-/g, '+').replace(/_/g, '/'));
  const r = new Blob([Uint8Array.from(bin, c => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), parts = [];
  for (let n = 0; ;) { const { done, value } = await r.read(); if (done) break; n += value.length; if (n > SHARE_MAX) { r.cancel(); throw new Error('too large'); } parts.push(value); }
  return MODEL.sanitize(JSON.parse(await new Blob(parts).text()));
}
$('#btn-share').addEventListener('click', async () => {
  const url = location.href.split('#')[0] + '#lab=' + await packLab();
  try { await navigator.clipboard.writeText(url); toast('Link copied: whoever opens it gets this lab'); }
  catch (e) { window.prompt('Copy this link to share the lab', url); }
});
async function openShared() {
  const m = /^#lab=([A-Za-z0-9_-]+)$/.exec(location.hash); if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search); // once opened the lab is saved like any other: a reload must keep the edits made since
  try {
    const o = await unpackLab(m[1]);
    S = { ...S, ...o }; labKey = ''; sel = null; group.clear(); if (chal.active) { chal.active = ''; saveChal(); }
    fitView(); checkpoint(); renderAll(); toast('Opened a shared lab', { label: 'Undo', fn: undo }); return true;
  } catch (e) { toast('That link does not hold a lab Lightpath can open'); return false; }
}
window.addEventListener('hashchange', openShared);

const csvMode = $('#csv-mode');
Object.entries(PHY.MODES).forEach(([k, m]) => csvMode.append(el('option', { value: k, text: m.short })));
csvMode.value = 'zrp400';
$('#csv-build').addEventListener('click', () => {
  const r = MODEL.fromSpans($('#csv-text').value, csvMode.value);
  if (!r.topo) return toast(r.errors[0]);
  S = { ...S, ...MODEL.sanitize(r.topo) }; labKey = ''; sel = null; $('#io').hidden = true; fitView(); checkpoint(); renderAll();
  toast(`Built ${r.spans.length} span${r.spans.length === 1 ? '' : 's'}` + (r.errors.length ? `. ${r.errors.length} row${r.errors.length === 1 ? '' : 's'} skipped: ${r.errors[0]}` : ''));
});

// ---------- results ----------
const STATUS = { up: 'UP', degraded: 'DEGRADED', down: 'DOWN', los: 'LOS', none: '—', nopath: 'NO PATH', blocked: 'BLOCKED', standby: 'STANDBY' };
let tab = 'power';
function tile(label, val, unit, topic, cls = '') {
  return el('button', { class: 'kpi ' + cls, onclick: () => learn(topic), title: 'Explain ' + label }, [el('span', { class: 'kl', text: label }), el('span', { class: 'kv' }, [document.createTextNode(val), el('small', { text: unit })])]);
}
// A remedy offered by an alarm: plain data from the model (splice a cable, set a device back to Working, clean a patch panel port)
function applyFix(f) {
  if (!f) return;
  const what = MODEL.applyFix(S, f); if (!what) return;
  checkpoint(); renderAll(); toast(what, { label: 'Undo', fn: undo });
}
const sameFix = (a, b) => !!a && !!b && a.type === b.type && a.id === b.id && a.port === b.port;
function renderAlarms(r) {
  const al = $('#alarms'); al.innerHTML = '';
  const hf = lastRes.headlineFix, hb = $('#headfix');
  hb.hidden = !hf; if (hf) { hb.textContent = hf.label; hb.onclick = () => applyFix(hf); }
  // the headline already says the first problem in full: do not repeat it in the list; a remedy shows once, next to the headline or on its own alarm
  (r.alarms || []).filter(a => !(lastRes.headline && lastRes.headline.includes(a.text))).slice(0, 6).forEach(a => {
    const li = el('li', { class: 'al-' + a.sev }, [a.text]);
    if (a.fix && !sameFix(a.fix, hf)) li.append(el('button', { class: 'btn alfix', text: a.fix.label, onclick: () => applyFix(a.fix) }));
    al.append(li);
  });
}
function renderResults() {
  const box = $('#results');
  const sw = $('#dirsw'); sw.innerHTML = '';
  sw.hidden = !(lastRes && lastRes.rev && lastRes.rev.mode);
  if (sw.hidden) dir = 'fwd';
  if (!sw.hidden) {
    [['fwd', lastRes.A, lastRes.Z], ['rev', lastRes.Z, lastRes.A]].forEach(([k, a, z]) => sw.append(el('button', { class: 'chip', 'aria-pressed': dir === k, text: `${a.name} → ${z.name}`, title: 'Show this direction in the results', onclick: () => { dir = k; renderCanvas(); renderResults(); } })));
  }
  const r = view();
  // service selectors
  const trx = S.nodes.filter(isEnd);
  for (const [id, key] of [['#svc-a', 'a'], ['#svc-z', 'z']]) {
    const s = $(id); s.innerHTML = ''; s.append(el('option', { value: '', text: '— pick —' }));
    trx.forEach(n => s.append(el('option', { value: n.id, text: n.name })));
    s.value = node(S.svc[key]) ? S.svc[key] : '';
  }
  $('#status').className = 'status s-' + lastRes.status; $('#status').textContent = STATUS[lastRes.status];
  $('#headline').textContent = lastRes.headline;
  { // more than one channel: a count by status, so the channels besides the service are not missed; it opens the Channels table
    const D = lastRes.derived, chans = (lastRes.channels || []).filter((c, i) => !(D && D.plan[i] && D.plan[i].filler)), cs = $('#chsum'), by = {};
    chans.forEach(c => { by[c.status] = (by[c.status] || 0) + 1; });
    cs.hidden = chans.length < 2;
    cs.textContent = `${chans.length} channels: ` + Object.entries(by).map(([st, n]) => `${n} ${(STATUS[st] || st).toLowerCase()}`).join(', ');
    cs.classList.toggle('bad', !!(by.down || by.los || by.blocked));
  }
  { const msg = `${STATUS[lastRes.status]}. ${lastRes.headline}`; if (msg !== srLast) { srLast = msg; $('#sr-live').textContent = msg; } } // announced only when it changes
  const k = $('#kpis'); k.innerHTML = ''; $('#diag').innerHTML = '';
  if (!r.mode) { $('#tabbody').innerHTML = ''; renderAlarms(r); renderTabBody(); return; }
  const m = r.mode;
  const prxCls = !isFinite(r.prx) ? 'bad' : r.prx < m.rxMin || r.prx > m.rxMax ? 'warn' : '';
  // The numbers come in three short groups: the margins (the verdict, led by Q margin), the signal that reaches the receiver, and the line it crossed
  const kg = t => el('span', { class: 'kgroup', text: t }), sg = v => (v > 0 ? '+' : '') + f1(v), lvl = (v, warnBelow) => (v < 0 ? 'bad' : v < warnBelow ? 'warn' : '');
  if (r.ber != null) {
    k.append(kg('Margins'), tile('Q margin', sg(r.qMargin), ' dB', 'margin', (r.qMargin < 0 || lastRes.status === 'down' || lastRes.status === 'los' ? 'bad' : r.qMargin < 1 || lastRes.status === 'degraded' ? 'warn' : 'good') + ' lead core'),
      tile('OSNR margin', sg(r.osnrMargin), ' dB', 'margin', lvl(r.osnrMargin, 2)), tile('Q margin, end of life', sg(r.eol.qMargin), ' dB', 'aging', lvl(r.eol.qMargin, 1)),
      tile(r.worstChannelQ != null ? 'Q margin, worst channel' : 'Q margin, worst slot', sg(r.worstChannelQ ?? r.worstQMargin), ' dB', 'srs', lvl(r.worstChannelQ ?? r.worstQMargin, 1)));
  }
  k.append(kg('Signal'), tile('Rx power', isFinite(r.prx) ? f1(r.prx) : 'LOS', isFinite(r.prx) ? ' dBm' : '', 'rx', prxCls + ' core'));
  if (r.ber != null) {
    k.append(tile('OSNR', f1(r.osnr), ' dB', 'osnr', 'core'), tile('GSNR (w/ NLI)', f1(r.gosnr), ' dB', 'gsnr', 'core'), tile('Q-factor', f1(r.q), ' dB', 'q'),
      tile('Pre-FEC BER', r.ber < 1e-15 ? '<1e-15' : r.ber.toExponential(1), '', 'ber', r.ber > m.berThr ? 'bad' : ''),
      kg('Line'), tile('Distance', Math.round(r.km), ' km', 'span', 'core'), tile('CD', Math.round(r.cd).toLocaleString(), ' ps/nm', 'cd', Math.abs(r.cd) > m.cdTol ? 'bad' : ''), tile('Mean DGD', f1(r.dgd), ' ps', 'pmd'),
      tile('SRS tilt (peak)', f1(r.tilt), ' dB', 'srs'), ...(m.coh === false ? [tile('XPM penalty', f1(r.xpmPen), ' dB', 'xpm', r.xpmPen > 1.5 ? 'warn' : '')] : []));
  }
  if (r.ber != null) k.append(el('button', { class: 'btn quiet morekpi', text: kpiAll ? 'Fewer readings' : 'More readings', 'aria-expanded': kpiAll ? 'true' : 'false', onclick: () => { kpiAll = !kpiAll; renderResults(); } })); // the first five readings are the verdict; the rest (margins, signal, line, and the noise breakdown) open with this
  k.classList.toggle('all', kpiAll);
  renderAlarms(r);
  if (r.ber != null) $('#diag').append(el('div', {}, [diagnose(r)]));
  renderTabBody();
}
function diagnose(r) {
  const b = r.budget, tot = b.ase + b.nli + b.trx + b.rx + (b.mpi || 0);
  const parts = [['ase', 'ASE (amplifier noise)', b.ase], ['nli', 'Fiber nonlinearity', b.nli], ['trx', 'Transceiver limit', b.trx], ['rx', 'Receiver noise', b.rx], ...(b.mpi > 0 ? [['mpi', 'Raman double Rayleigh', b.mpi]] : [])];
  const wrap = el('div', { class: 'budget' });
  const bar = el('div', { class: 'bbar', role: 'img', 'aria-label': 'Noise budget' });
  parts.forEach(([k, n, v]) => { if (v / tot > 0.005) bar.append(el('span', { class: 'b-' + k, style: `width:${(v / tot * 100).toFixed(1)}%`, title: `${n}: ${(v / tot * 100).toFixed(0)}%` })); });
  const leg = el('div', { class: 'blegend' }); parts.forEach(([k, n, v]) => leg.append(el('span', {}, [el('i', { class: 'b-' + k }), `${n} ${(v / tot * 100).toFixed(0)}%`])));
  const top = parts.slice().sort((x, y) => y[2] - x[2])[0][0];
  const tips = {
    ase: b.nli < b.ase / 2 ? 'Noise is mostly ASE and nonlinearity is small, so raising launch power (or cutting span loss / NF) buys SNR.' : 'ASE leads, but nonlinearity is close. You are near the optimum launch power.',
    nli: 'Nonlinearity dominates: you are launching too hot. Lowering launch power will improve GSNR until ASE takes over.',
    trx: 'Noise from the line is small. The transceiver itself is the limit, so changing launch power or amplifiers will not help much.' + (lastRes && lastRes.alarms && lastRes.alarms.some(x => x.sev !== 'info') ? ' The warnings are about power and loss, not noise: they are not in this bar.' : ''),
    rx: 'Too little light reaches the receiver. Add or re-target an amplifier before the Rx, or remove a pad.',
    mpi: 'Double Rayleigh scattering from the Raman pump dominates. Lower the pump power (it grows with the square of the gain) or split the gain with an EDFA.',
  };
  const pen = r.filt + r.over + r.pmdPen;
  wrap.append(el('b', { text: 'What is eating the SNR' }), bar, leg, el('span', { text: tips[top] + (pen > 0.3 ? ` Plus ${f1(pen)} dB of penalties (${[r.filt > 0.05 ? `filtering ${f1(r.filt)}` : '', r.over > 0 ? `Rx overload ${f1(r.over)}` : '', r.pmdPen > 0.05 ? `PMD ${f1(r.pmdPen)}` : ''].filter(Boolean).join(', ')}).` : '') }));
  return wrap;
}
// bring a tab into view by moving the strip sideways only: scrollIntoView would also scroll the page (and a render must never move the page)
const revealTab = t => { const c = $('#tabs'); if (c.scrollWidth > c.clientWidth) c.scrollLeft = t.offsetLeft - (c.clientWidth - t.offsetWidth) / 2; };
// the tabs come in four groups: a pill per group, and only the active group's tabs beside them, so the strip stays on one row
const TGROUPS = [['res', 'Results'], ['ins', 'Instruments'], ['ana', 'Analysis'], ['learn', 'Learn']], lastTab = {};
const tabEls = () => [...document.querySelectorAll('.tab')], groupOf = k => (tabEls().find(t => t.dataset.tab === k) || {}).dataset?.group || 'res';
const visTabs = () => tabEls().filter(t => !t.hidden);
// a tab shows when the lab has something for it, or always in Expert mode
const tabAvailable = k => {
  const has = t => S.nodes.some(n => n.type === t);
  switch (k) {
    case 'clients': return has('mxp');
    case 'reach': return has('host') || S.nodes.some(n => n.type === 'oadm' && (n.p.osc || n.p.p1310));
    case 'otdr': return has('otdr');
    case 'raman': return expert || S.links.some(l => +l.p.raman > 0 || +l.p.ramanRev > 0);
    case 'resil': return expert || !!chal.active || has('switch') || S.links.some(l => l.p.srlg) || S.nodes.some(n => isEnd(n) && (n.p.prot || n.p.spare)) || !!(S.g.plan && S.g.plan.some(c => c.prot));
    case 'planner': return expert;
    case 'trans': return expert;
    default: return true;
  }
};
const firstIn = g => (tabEls().find(t => t.dataset.group === g && tabAvailable(t.dataset.tab)) || {}).dataset?.tab;
for (const [g, label] of TGROUPS) $('#tgroups').append(el('button', { class: 'tgroup', type: 'button', text: label, 'data-group': g, onclick: () => { tab = lastTab[g] && tabAvailable(lastTab[g]) ? lastTab[g] : firstIn(g); renderTabBody(); } }));
tabEls().forEach(t => t.addEventListener('click', () => { tab = t.dataset.tab; renderTabBody(); revealTab(t); }));
$('#tabs').addEventListener('keydown', e => { // arrow keys move between tabs (only the selected one is a Tab stop)
  if (!e.target.classList.contains('tab')) return;
  const all = visTabs(), i = all.findIndex(t => t.dataset.tab === tab);
  const j = e.key === 'ArrowRight' ? (i + 1) % all.length : e.key === 'ArrowLeft' ? (i + all.length - 1) % all.length : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : -1;
  if (j < 0) return; e.preventDefault(); tab = all[j].dataset.tab; renderTabBody(); all[j].focus({ preventScroll: true }); revealTab(all[j]);
});
$('#svc-a').addEventListener('change', e => { S.svc.a = e.target.value || null; renderAll(); });
$('#svc-z').addEventListener('change', e => { S.svc.z = e.target.value || null; renderAll(); });
$('#svc-swap').addEventListener('click', () => { [S.svc.a, S.svc.z] = [S.svc.z, S.svc.a]; renderAll(); });

function renderTabBody() {
  if (!tabAvailable(tab)) tab = 'power';
  const grp = groupOf(tab); lastTab[grp] = tab;
  document.querySelectorAll('.tgroup').forEach(g => { g.setAttribute('aria-pressed', g.dataset.group === grp); g.hidden = !firstIn(g.dataset.group); });
  document.querySelectorAll('.tab').forEach(t => { t.hidden = t.dataset.group !== grp || !tabAvailable(t.dataset.tab); const on = t.dataset.tab === tab; t.setAttribute('aria-selected', on); t.id = 'tab-' + t.dataset.tab; t.setAttribute('aria-controls', 'tabbody'); t.tabIndex = on ? 0 : -1; });
  const b = $('#tabbody'); b.innerHTML = ''; b.setAttribute('role', 'tabpanel'); b.setAttribute('aria-labelledby', 'tab-' + tab);
  const r = view();
  if (tab === 'learn') return b.append(learnView());
  if (tab === 'challenges') return b.append(challengesView());
  if (tab === 'plan') return b.append(planView(r));
  if (tab === 'resil') return b.append(resilView());
  if (tab === 'planner') return b.append(plannerView());
  if (tab === 'reach') return b.append(reachView());
  if (tab === 'otdr') return b.append(otdrView());
  if (!r || !r.hops) return b.append(el('p', { class: 'muted pad', text: r ? r.headline : '' }));
  if (tab === 'power') b.append(powerChart(r));
  else if (tab === 'hops') b.append(hopTable(r));
  else if (tab === 'clients') b.append(clientsView(r));
  else if (tab === 'spectrum') b.append(spectrumView(r));
  else if (tab === 'const') b.append(constView(r));
  else if (tab === 'sweep') b.append(sweepChart(r));
  else if (tab === 'trans') b.append(transView(r));
  else if (tab === 'raman') b.append(ramanView(r));
}

// demand-driven planner: a traffic list in, routes and slots out, with blocking
let plannerOpts = { minMargin: 1, K: 6, order: 'given', converters: false, launch: false };
function plannerView() {
  S.demands ??= [];
  const wrap = el('div', { class: 'planwrap pad' }), nodes = S.nodes.filter(n => n.type === 'roadm' || isEnd(n)), modes = Object.entries(PHY.MODES).map(([k, m]) => [k, m.short]);
  if (nodes.length < 2) return el('p', { class: 'muted pad', text: 'Add at least two ROADMs or transponders to plan traffic between them.' });
  const redo = () => { renderTabBody(); save(); };
  const optRow = el('div', { class: 'planbar' }, []);
  const kSel = el('select', { 'aria-label': 'Alternative routes' }); [[1, 'Shortest route only'], [2, 'Up to 2 routes'], [4, 'Up to 4 routes'], [6, 'Up to 6 routes']].forEach(([v, t]) => kSel.append(el('option', { value: v, text: t }))); kSel.value = plannerOpts.K; kSel.addEventListener('change', () => { plannerOpts.K = +kSel.value; redo(); });
  const oSel = el('select', { 'aria-label': 'Order' }); [['given', 'In the order listed'], ['longest', 'Longest routes first']].forEach(([v, t]) => oSel.append(el('option', { value: v, text: t }))); oSel.value = plannerOpts.order; oSel.addEventListener('change', () => { plannerOpts.order = oSel.value; redo(); });
  const mm = el('input', { type: 'number', step: 0.5, min: -5, max: 10, value: plannerOpts.minMargin, 'aria-label': 'Minimum margin (dB)', class: 'slotin' }); mm.addEventListener('change', () => { if (isFinite(+mm.value)) { plannerOpts.minMargin = +mm.value; redo(); } });
  const cv = el('input', { type: 'checkbox', id: 'pl-conv', checked: plannerOpts.converters }); cv.addEventListener('change', () => { plannerOpts.converters = cv.checked; redo(); });
  const lp = el('input', { type: 'checkbox', id: 'pl-launch', checked: plannerOpts.launch }); lp.addEventListener('change', () => { plannerOpts.launch = lp.checked; redo(); });
  optRow.append(el('b', { text: 'Traffic' }), kSel, oSel, el('label', { class: 'small', title: 'A channel that misses the margin at the global launch power may be launched up to 3 dB higher or lower, the smallest change that clears the margin without pushing a channel already on the same fibers under it. The offset goes into the plan.' }, [lp, ' Adjust launch power']), el('label', { class: 'small', title: 'When no slot is free end to end, regenerate the channel at a ROADM on its route into another slot. Each half has to clear the margin on its own.' }, [cv, ' Use converters']), el('span', { class: 'muted small', text: 'Minimum Q margin' }), mm, el('span', { class: 'muted small', text: 'dB' }));
  const tbl = el('table', { class: 'tbl' }), th = el('tr'); ['From', 'To', 'Mode', 'Channels', 'Protect', 'Availability target', ''].forEach(h => th.append(el('th', { text: h })));
  tbl.append(el('thead', {}, [th]));
  const tb = el('tbody');
  const nodeSel = (d, key) => { const s = el('select', { 'aria-label': key === 'a' ? 'From' : 'To' }); nodes.forEach(n => s.append(el('option', { value: n.id, text: n.name }))); s.value = d[key]; s.addEventListener('change', () => { d[key] = s.value; if (d.a === d.z) d[key === 'a' ? 'z' : 'a'] = nodes.find(n => n.id !== d[key]).id; redo(); }); return s; };
  S.demands.forEach(d => {
    const ms = el('select', { 'aria-label': 'Mode' }); modes.forEach(([k, t]) => ms.append(el('option', { value: k, text: t }))); ms.value = d.mode; ms.addEventListener('change', () => { d.mode = ms.value; redo(); });
    const cnt = el('input', { type: 'number', step: 1, min: 1, max: 96, value: d.count, class: 'slotin', 'aria-label': 'Channels' }); cnt.addEventListener('change', () => { d.count = Math.max(1, Math.min(96, Math.round(+cnt.value) || 1)); redo(); });
    const pr = el('select', { 'aria-label': 'Protection', title: '1+1: a second copy on a route that shares no fiber with the working one, in the same slot, loading both routes' }); [['', 'None'], ['1+1', '1+1']].forEach(([v, t]) => pr.append(el('option', { value: v, text: t }))); pr.value = d.prot || ''; pr.addEventListener('change', () => { d.prot = pr.value; redo(); });
    const tg = el('select', { 'aria-label': 'Target availability', title: 'The planner adds 1+1 protection where the route would not meet this availability on its own (the Resilience model: fiber cuts, repair times, device failure rates)' }); [['', 'No target'], [99.9, '99.9%'], [99.99, '99.99%'], [99.999, '99.999%']].forEach(([v, t]) => tg.append(el('option', { value: v, text: t }))); tg.value = d.target || ''; tg.addEventListener('change', () => { d.target = tg.value === '' ? '' : +tg.value; redo(); });
    tb.append(el('tr', {}, [nodeSel(d, 'a'), nodeSel(d, 'z'), ms, cnt, pr, tg, el('button', { class: 'btn', text: '×', title: 'Remove', 'aria-label': `Remove the demand from ${(node(d.a) || {}).name || 'A'} to ${(node(d.z) || {}).name || 'Z'}`, onclick: () => { S.demands.splice(S.demands.indexOf(d), 1); redo(); } })].map(x => el('td', {}, [x]))));
  });
  tbl.append(tb);
  const addBtn = el('button', { class: 'btn', text: 'Add demand', onclick: () => { S.demands.push({ a: nodes[0].id, z: nodes[1].id, mode: nodes.find(n => isEnd(n)) ? nodes.find(n => isEnd(n)).p.mode : 'zrp400', count: 4 }); redo(); } });
  const meshBtn = el('button', { class: 'btn', text: 'Every pair of ROADMs × 4', title: 'Replace the list with 4 channels between each pair of ROADMs', onclick: () => { const rs = S.nodes.filter(n => n.type === 'roadm'); const mode = (S.nodes.find(isEnd) || { p: { mode: 'zrp400' } }).p.mode; S.demands = []; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) S.demands.push({ a: rs[i].id, z: rs[j].id, mode, count: 4 }); redo(); } });
  wrap.append(optRow, el('div', { style: 'overflow:auto;max-height:240px' }, [tbl]), el('div', { class: 'planbar' }, [addBtn, meshBtn]));
  if (!S.demands.length) return (wrap.append(el('p', { class: 'muted', text: 'List the traffic you want to carry: who talks to whom, at what rate, how many channels. The planner routes each channel (shortest route first, then detours through other ROADMs when a fiber is full or too long), gives it the first free slot, checks the estimated margin and reports what is blocked.' })), wrap);
  const r = MODEL.planDemands(S, S.demands, { minMargin: plannerOpts.minMargin, K: plannerOpts.K, order: plannerOpts.order, converters: plannerOpts.converters, launch: plannerOpts.launch }), st = r.stats;
  wrap.append(el('p', { html: `<b>${st.placed}</b> of ${st.demands} placed, <b class="${st.blocked ? 'st-down' : 'st-up'}">${st.blocked}</b> blocked (${(100 * st.blocking).toFixed(1)}%), ${st.unreachable ? `<b class="st-degraded">${st.unreachable}</b> out of reach, ` : ''}${st.protected ? `${st.protected} protected, ` : ''}${st.unprotected ? `<b class="st-degraded">${st.unprotected}</b> asked for protection but have no disjoint route, ` : ''}${st.converted ? `${st.converted} converted, ` : ''}${st.autoProt ? `${st.autoProt} given 1+1 to meet an availability target, ` : ''}${st.missed ? `<b class="st-down">${st.missed}</b> miss their target, ` : ''}${st.slotsUsed} of ${st.slots} slots used, busiest fiber ${(100 * st.maxUtil).toFixed(0)}% full.` }));
  wrap.append(el('div', { class: 'planbar' }, [el('button', { class: 'btn primary', text: 'Apply to the bench', title: 'Replace the channel plan with the service plus these channels; the Channels tab then shows the full simulation', onclick: () => {
    const svc = (S.g.plan && S.g.plan.find(c => c.svc)) || { slot: st.svcSlot, mode: (node(S.svc.a) || { p: { mode: 'zrp400' } }).p.mode, off: 0, svc: true, from: '', to: '', via: '', conv: '', slot2: st.svcSlot, prot: '' };
    S.g.plan = MODEL.sanitizePlan([{ ...svc, slot: st.svcSlot }, ...r.entries], +S.g.df); S.g.nch = S.g.plan.length; tab = 'plan'; renderAll(); toast(`${r.entries.length} channels added to the plan`); } })]));
  const rt = el('table', { class: 'tbl' }), rth = el('tr'); ['', 'Demand', 'Status', 'Slot', 'Route', 'km', 'Est. margin', 'Availability'].forEach(h => rth.append(el('th', { text: h })));
  rt.append(el('thead', {}, [rth]));
  const rb = el('tbody'), nm = id => (node(id) || {}).name;
  r.results.forEach((x, i) => rb.append(el('tr', {}, [i + 1, `${nm(x.a)} → ${nm(x.z)} (${PHY.MODES[x.mode].short})`, el('span', { class: x.status === 'placed' ? (x.detour || x.unprotected || x.launchOff || x.meetsTarget === false ? 'st-degraded' : 'st-up') : 'st-down', text: x.status === 'placed' ? [x.converted ? 'CONVERTED' : x.protRoute ? (x.autoProt ? 'PROTECTED FOR TARGET' : 'PROTECTED') : x.unprotected ? 'UNPROTECTED' : 'PLACED', x.detour ? 'DETOUR' : '', x.launchOff ? `${x.launchOff > 0 ? '+' : ''}${x.launchOff} dB LAUNCH` : ''].filter(Boolean).join(', ') : x.status.toUpperCase() + (x.why ? ` (${x.why})` : '') }), x.slot != null ? (x.slot2 != null ? `${x.slot + 1} → ${x.slot2 + 1}` : x.slot + 1) : '', x.route ? x.route.join(' → ') + (x.protRoute ? ` | protection ${x.protRoute.join(' → ')}` : '') + (x.converted ? ` (converted at ${x.converted})` : '') : '', x.km != null ? Math.round(x.km) : '', x.margin != null ? f1(x.margin) : '', x.availability != null ? `${(100 * x.availability).toFixed(4)}%${x.target ? (x.meetsTarget ? ' ✓' : ` ✗ (target ${x.target}%)`) : ''}` : ''].map(v => (v instanceof Node ? el('td', {}, [v]) : el('td', { text: String(v) }))))));
  rt.append(rb);
  wrap.append(el('div', { style: 'overflow:auto;max-height:300px' }, [rt]));
  // blocking against offered load, with and without detours
  const loadsList = [10, 20, 40, 60, 80, 100, 140, 180], md = S.demands[0].mode;
  const cC = plannerOpts.converters ? MODEL.blockingCurve(S, md, loadsList, 8, 3, { K: Math.max(2, plannerOpts.K), minMargin: plannerOpts.minMargin, converters: true }) : [], c1 = MODEL.blockingCurve(S, md, loadsList, 8, 3, { K: 1, minMargin: plannerOpts.minMargin }), cK = MODEL.blockingCurve(S, md, loadsList, 8, 3, { K: Math.max(2, plannerOpts.K), minMargin: plannerOpts.minMargin });
  if (c1.length) {
    const W = 900, H = 240, ml = 46, mr = 16, mt = 16, mb = 40, lo = loadsList[0], hi = loadsList[loadsList.length - 1], ymax = Math.max(10, Math.ceil(Math.max(...c1.map(p => p.p), ...cK.map(p => p.p), ...cC.map(p => p.p)) * 10) * 10);
    const X = v => ml + (v - lo) / (hi - lo) * (W - ml - mr), Y = v => mt + (1 - v / ymax) * (H - mt - mb);
    const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Blocking probability versus offered channels' });
    for (let v = 0; v <= ymax + 1e-9; v += ymax / 5) { s.append(sv("line", { x1: ml, x2: W - mr, y1: Y(v), y2: Y(v), class: "grid" })); const t = sv('text', { x: ml - 6, y: Y(v) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = Math.round(v) + '%'; s.append(t); }
    loadsList.forEach(n => { const t = sv('text', { x: X(n), y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); t.textContent = n; s.append(t); });
    const xl = sv('text', { x: (ml + W - mr) / 2, y: H - 6, class: 'ax', 'text-anchor': 'middle' }); xl.textContent = 'Channels offered (random pairs of ROADMs)'; s.append(xl);
    s.append(sv('path', { d: c1.map((p, i) => `${i ? 'L' : 'M'}${X(p.n)},${Y(p.p * 100)}`).join(' '), class: 'pl l-ase dashed' }));
    if (cC.length) s.append(sv('path', { d: cC.map((p, i) => `${i ? 'L' : 'M'}${X(p.n)},${Y(p.p * 100)}`).join(' '), class: 'pl l-nli' }));
    s.append(sv('path', { d: cK.map((p, i) => `${i ? 'L' : 'M'}${X(p.n)},${Y(p.p * 100)}`).join(' '), class: 'pl l-sig' }));
    wrap.append(el('h3', { text: 'Blocking against load' }), s, el('div', { class: 'legend' }, [lg('l-ase dashed', 'Shortest route only'), lg('l-sig', `Up to ${Math.max(2, plannerOpts.K)} routes`), ...(cC.length ? [lg('l-nli', 'With converters')] : []), el('span', { class: 'muted', text: 'Random traffic between ROADM pairs on this network, first-fit slots, averaged over 8 draws. The service keeps its slot. Detours let the network carry more before it blocks, at the price of longer routes with less margin.' })]));
  }
  return wrap;
}

// Raman spans: power along the fiber and the gain spectrum, from the coupled-wave solver
function ramanView(r) {
  const wrap = el('div', { class: 'planwrap pad' }), views = r.raman || [];
  if (!views.length) return el('p', { class: 'muted pad', text: r.reverse ? 'Raman profiles are shown for the forward direction.' : 'No fiber span on the service path has a Raman pump. Set a pump power in the cable inspector, then switch the Raman model to the coupled-wave solver to see the profile of every pump and channel along the fiber.' });
  for (const v of views) {
    const W = 900, H = 230, ml = 50, mr = 16, mt = 14, mb = 36, dbm = w => 10 * Math.log10(Math.max(w, 1e-12) * 1000), zs = v.profile.z, L = zs[zs.length - 1];
    const pick = [0, Math.floor((v.samples.length - 1) / 2), v.samples.length - 1].filter((x, i, a) => a.indexOf(x) === i);
    const series = [...pick.map(i => ({ y: v.profile.sig[i].map(dbm), cls: 'l-sig', name: `${v.samples[i].toFixed(1)} THz` })), ...pick.map(i => ({ y: v.profile.off[i].map(dbm), cls: 'l-ase dashed', name: 'without pump' })).slice(0, 1), ...v.profile.pump.map((p, j) => ({ y: p.map(dbm), cls: 'l-nli', name: `pump ${v.pumps[j].fTHz.toFixed(1)} THz ${v.pumps[j].dir === 'fwd' ? '→' : '←'}` }))];
    const all = series.flatMap(s => s.y), ymax = Math.ceil((Math.max(...all) + 1) / 5) * 5, ymin = Math.floor((Math.min(...all) - 1) / 5) * 5, X = x => ml + x / L * (W - ml - mr), Y = y => mt + (ymax - y) / (ymax - ymin) * (H - mt - mb);
    const s = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Power along the Raman span' });
    for (let y = ymin; y <= ymax; y += 5) { s.append(sv('line', { x1: ml, x2: W - mr, y1: Y(y), y2: Y(y), class: 'grid' })); const t = sv('text', { x: ml - 6, y: Y(y) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = y; s.append(t); }
    for (let x = 0; x <= L + 1e-9; x += L / 4) { const t = sv('text', { x: X(x), y: H - mb + 16, class: 'ax', 'text-anchor': 'middle' }); t.textContent = Math.round(x) + ' km'; s.append(t); }
    series.forEach(sr => s.append(sv('path', { d: sr.y.map((y, i) => `${i ? 'L' : 'M'}${X(zs[i])},${Y(y)}`).join(' '), class: 'pl ' + sr.cls })));
    const yl = sv('text', { x: 12, y: mt + (H - mt - mb) / 2, class: 'ax', transform: `rotate(-90 12 ${mt + (H - mt - mb) / 2})`, 'text-anchor': 'middle' }); yl.textContent = 'dBm'; s.append(yl);
    // gain spectrum
    const GH = 170, gmax = Math.ceil(Math.max(...v.gainDb) + 1), gmin = Math.max(0, Math.floor(Math.min(...v.gainDb) - 1)), fl = v.samples[0], fh = v.samples[v.samples.length - 1], fspan = Math.max(0.5, fh - fl);
    const GX = f => ml + (f - fl) / fspan * (W - ml - mr), GY = g => 14 + (gmax - g) / Math.max(1, gmax - gmin) * (GH - 14 - 34);
    const g = sv('svg', { viewBox: `0 0 ${W} ${GH}`, class: 'chart', role: 'img', 'aria-label': 'Raman gain spectrum' });
    for (let y = gmin; y <= gmax; y++) { g.append(sv('line', { x1: ml, x2: W - mr, y1: GY(y), y2: GY(y), class: 'grid' })); const t = sv('text', { x: ml - 6, y: GY(y) + 4, class: 'ax', 'text-anchor': 'end' }); t.textContent = y; g.append(t); }
    v.samples.forEach(f => { const t = sv('text', { x: GX(f), y: GH - 18, class: 'ax', 'text-anchor': 'middle' }); t.textContent = f.toFixed(1); g.append(t); });
    g.append(sv('path', { d: v.gainDb.map((y, i) => `${i ? 'L' : 'M'}${GX(v.samples[i])},${GY(y)}`).join(' '), class: 'pl l-sig' }));
    if (v.approxDb != null) g.append(sv('circle', { cx: GX(v.svcTHz), cy: GY(v.approxDb), r: 5, class: 'dot-best' }));
    const gl = sv('text', { x: (ml + W - mr) / 2, y: GH - 2, class: 'ax', 'text-anchor': 'middle' }); gl.textContent = 'Channel frequency (THz): on-off gain (dB)'; g.append(gl);
    wrap.append(el('h3', { text: `${v.name} · ${Math.round(v.km)} km · ${v.pumps.map(p => `${p.fTHz.toFixed(1)} THz ${p.mW.toFixed(0)} mW ${p.dir === 'fwd' ? 'forward' : 'backward'}`).join(', ')}` }),
      el('p', { class: 'small', html: `${v.solver ? '<b>Coupled-wave solver</b> in use for this fiber.' : 'This fiber uses the <b>closed-form approximation</b> (the solver is shown for comparison; switch it on in the cable inspector).'} Gain at the service channel <b>${f1(v.gainSvcDb)} dB</b>${v.approxDb != null ? `, approximation <b>${f1(v.approxDb)} dB</b> (dot)` : ''}, gain spectrum spread <b>${f1(v.ripple)} dB</b>, pump depletion by the signals <b>${Math.round(100 * v.depletion)}%</b>.` }), s,
      el('div', { class: 'legend' }, [lg('l-sig', 'Channels (lowest, middle, highest frequency)'), lg('l-ase dashed', 'The same channel without the pump'), lg('l-nli', 'Pumps (→ forward, ← backward)')]), el('h3', { text: 'Gain spectrum' }), g);
  }
  return wrap;
}

