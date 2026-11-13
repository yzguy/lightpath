// ---------- misc ----------
let toastT, srLast = '';
function toast(t, action) { // an action ({label, fn}) stays longer so there is time to use it
  const e = $('#toast'); e.textContent = t; e.hidden = false;
  if (action) e.append(el('button', { class: 'toast-act', text: action.label, onclick: () => { e.hidden = true; action.fn(); } }));
  clearTimeout(toastT); toastT = setTimeout(() => (e.hidden = true), action ? 7000 : 2600);
}
// A non-revertive switch stays on the port it failed over to: the position is part of the lab, so it moves there once and the cable can be spliced back without it returning.
function settleSwitches() {
  const moved = [];
  for (const f of (lastRes.failovers || [])) { const n = node(f.id); if (n && !n.p.revertive && n.p.pos !== f.to) { n.p.pos = f.to; moved.push(f); } }
  if (!moved.length) return;
  lastRes = simulate();
  for (const f of moved) lastRes.alarms.unshift({ sev: 'info', text: `${f.name} moved from port ${f.from.toUpperCase()} to port ${f.to.toUpperCase()} and stays there (non-revertive): port ${f.from.toUpperCase()} is the standby once it is repaired.` });
}
function recompute() { MODEL.assignSides(S); lastRes = simulate(); settleSwitches(); refreshHostFaults(); renderCanvas(); renderResults(); save(); }
function renderAll() { for (const id of [...group]) if (!node(id)) group.delete(id); if (group.size < 2) { if (group.size === 1) sel = { kind: 'node', id: [...group][0] }; group.clear(); } MODEL.assignSides(S); lastRes = simulate(); settleSwitches(); refreshHostFaults(); bindGlobals(); renderCanvas(); renderInspector(); renderResults(); renderChallenge(); save(); }
window.addEventListener('resize', applyView);

// The divider under the bench trades canvas height for results: drag it or use the arrow keys, double-click for the default. The height is kept between visits.
const BENCH_KEY = 'lightpath-bench-h', bench = $('.bench'), split = $('#split');
function setBench(h, keep = true) {
  if (h == null) document.body.style.removeProperty('--bench-h');
  else { h = Math.round(Math.min(innerHeight - 60, Math.max(300, h))); document.body.style.setProperty('--bench-h', h + 'px'); }
  if (keep) try { if (h == null) localStorage.removeItem(BENCH_KEY); else localStorage.setItem(BENCH_KEY, h); } catch (e) { /* no storage */ }
}
try { const h = +localStorage.getItem(BENCH_KEY); if (h) setBench(h, false); } catch (e) { /* no storage */ }
split.addEventListener('pointerdown', e => {
  e.preventDefault(); const y0 = e.clientY, h0 = bench.offsetHeight; split.setPointerCapture(e.pointerId); split.classList.add('on');
  const move = ev => setBench(h0 + ev.clientY - y0, false);
  const up = () => { split.classList.remove('on'); split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); split.removeEventListener('pointercancel', up); setBench(bench.offsetHeight); };
  split.addEventListener('pointermove', move); split.addEventListener('pointerup', up); split.addEventListener('pointercancel', up);
});
split.addEventListener('dblclick', () => setBench(null));
split.addEventListener('keydown', e => { const d = { ArrowUp: -24, ArrowDown: 24 }[e.key]; if (d) { e.preventDefault(); setBench(bench.offsetHeight + d); } });

// ---------- first run: a welcome card and a short tour ----------
const WELCOMED = 'lightpath-welcomed';
const closeWelcome = () => { $('#welcome').hidden = true; try { localStorage.setItem(WELCOMED, '1'); } catch (e) { /* no storage */ } };
const openChallenges = () => { tab = 'challenges'; renderTabBody(); $('#tabs').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
$('#w-tour').addEventListener('click', () => { closeWelcome(); startTour(); });
$('#w-chal').addEventListener('click', () => { closeWelcome(); openChallenges(); });
$('#w-explore').addEventListener('click', closeWelcome);
$('#w-blank').addEventListener('click', () => { closeWelcome(); S.nodes = []; S.links = []; S.svc = { a: null, z: null }; S.g.plan = null; labKey = ''; sel = null; checkpoint(); renderAll(); });
$('#btn-chal').addEventListener('click', openChallenges);
$('#btn-tour').addEventListener('click', () => { closeWelcome(); startTour(); });
const TOUR = [
  ['.palette', 'Devices', 'Drag a device onto the bench, or click it to drop it in a free spot. Hover a device in the list to see what it is for.'],
  ['.canvaswrap', 'The bench', 'Drag from one device to another to cable them: Lightpath picks a patch cord or a fiber span for you. Click a fiber, then Cut this fiber, to see what breaks. Hover any device or cable for its power and OSNR.'],
  ['#insp', 'The inspector', 'Whatever you select shows its settings here. Faults to inject (failed ports, dirty connectors) fold away at the bottom; Expert mode in the header shows the rarer settings.'],
  ['.svcbar', 'The service under test', 'The two transponders whose link the results describe, its status and a one-line reason. Click a transponder on the bench to make the results follow it. When something has an obvious fix, a button here offers it.'],
  ['#kpis', 'The verdict', 'Q margin is the headroom before the receiver loses the signal: positive is working, negative is not. Hover any reading for what it means.'],
  ['#tabs', 'Results, instruments and Learn', 'The power map shows signal and noise along the path; the hop table lists every device. Learn explains the physics, and Challenges are broken labs to fix: a good next step.'],
];
let tourAt = -1;
function startTour() { tourAt = 0; showTour(); }
function endTour() { document.querySelectorAll('.tour-hi').forEach(e => e.classList.remove('tour-hi')); $('#tour').hidden = true; tourAt = -1; }
function showTour() {
  document.querySelectorAll('.tour-hi').forEach(e => e.classList.remove('tour-hi'));
  const [sel0, title, text] = TOUR[tourAt], target = $(sel0), box = $('#tour'), last = tourAt === TOUR.length - 1;
  target.classList.add('tour-hi'); target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  box.replaceChildren(el('h3', { text: title }), el('p', { text }), el('div', { class: 'row' }, [
    el('span', { class: 'muted small', text: `${tourAt + 1} of ${TOUR.length}` }),
    el('span', { class: 'row' }, [
      el('button', { class: 'btn quiet', type: 'button', text: 'Skip', onclick: endTour }),
      tourAt ? el('button', { class: 'btn', type: 'button', text: 'Back', onclick: () => { tourAt--; showTour(); } }) : null,
      el('button', { class: 'btn primary', type: 'button', text: last ? 'Done' : 'Next', onclick: () => { if (last) endTour(); else { tourAt++; showTour(); } } })])]));
  box.hidden = false;
  setTimeout(() => { // after the scroll: beside the target if there is room, else below or above it
    const r = target.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight, vw = innerWidth, vh = innerHeight;
    let x = r.right + 14, y = r.top;
    if (x + bw > vw - 8) { x = r.left - bw - 14; }
    if (x < 8) { x = Math.min(vw - bw - 8, Math.max(8, r.left)); y = r.bottom + 14 > vh - bh ? r.top - bh - 14 : r.bottom + 14; }
    box.style.left = x + 'px'; box.style.top = Math.min(vh - bh - 8, Math.max(8, y)) + 'px';
    box.querySelector('.btn.primary').focus({ preventScroll: true });
  }, 350);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && tourAt >= 0) endTour(); });

load();
setTool('select');
requestAnimationFrame(async () => { fitView(); renderAll(); if (await openShared()) return; let seen = false; try { seen = localStorage.getItem(WELCOMED) === '1'; } catch (e) { /* no storage */ } if (firstRun && !seen) $('#welcome').hidden = false; });
})();
