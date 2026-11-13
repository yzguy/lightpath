  // ---------- challenges ----------
  // A challenge is a broken lab, a goal the simulator can check, and some help. `goals` are re-checked after every change; the lab counts as solved when all
  // pass. They look at what the simulator reports (and at a few things that must not be cheated), never at which fix the player chose.
  const goalUp = (min = 0) => ({ text: min ? `The service is Up with at least ${min} dB of Q margin` : 'The service is Up, with no warnings', ok: (S, r) => r.status === 'up' && !(r.qMargin < min) });
  const goalKeep = (mode, text) => ({ text: text || `Both service ends stay ${PHY_.MODES[mode].name.split(' (')[0]}`, ok: S => [S.svc && S.svc.a, S.svc && S.svc.z].every(id => { const n = S.nodes.find(x => x.id === id); return !!n && isEnd(n) && n.p.mode === mode; }) });
  const goalCut = { text: 'The service survives a cut of any one fiber', ok: S => {
    const fibers = S.links.filter(l => l.kind === 'fiber'); if (!fibers.length) return false;
    return fibers.every(f => { const c = JSON.parse(JSON.stringify(S)); c.links.find(l => l.id === f.id).p.cut = true; const r = simulate(c); return r.status === 'up' || r.status === 'degraded'; }); // a restored service counts
  } };
  const withNode = (p, name, fn) => { fn(p.nodes.find(n => n.name === name)); return p; };
  const CHALLENGES = [
    { id: 'dirty', level: 1, title: 'The warning that will not clear', topic: 'odf',
      story: 'A 60 km link carries traffic, but its alarm has been up since the last maintenance visit and nobody knows why. The amplifiers hide the loss in the Q margin, so the warning is the only clue.',
      goals: [goalUp(), goalKeep('zrp400')],
      hints: ['Read the headline above the tabs: it names the first problem it found.', 'Open the Hop-by-hop PM tab and look for a hop that loses far more than its neighbours.', 'Patch panels list their connectors in the inspector. A dirty one adds loss to its port.'],
      answer: 'ODF-B port 1 had a dirty connector (4.5 dB extra). Cleaning it clears the alarm. The pre-amplifier re-levelled the signal, so the cost never showed as lost margin: in an amplified line a bad connector shows up in the alarms and in the OSNR of the following span, not in the power at the receiver.',
      build() { return withNode(PRESETS.odf.build(), 'ODF-B', n => { n.p.dirty = { 1: 4.5 }; }); } },
    { id: 'hot', level: 1, title: 'Too much light', topic: 'rx',
      story: 'Two sites 1 km apart are joined by one fiber. Someone raised the transmitters to +3 dBm "to be safe", and the receiver has been complaining ever since.',
      goals: [goalUp(), goalKeep('zr400')],
      hints: ['Look at the received power in the KPI row and the alarm next to it.', 'A receiver has an overload point as well as a sensitivity floor. Too much light is also a fault.', 'Two ways in: take the power down at the transmitter, or add loss on the path (a VOA, or extra loss on the span).'],
      answer: 'The receiver overloads above 0 dBm. Lower the transmit power, or put a fixed attenuator (a VOA, from the palette) in the path. On short links with no amplifier the span loss is tiny, so a transmitter at full power has to be padded down.',
      build() { const a = N('trx', 'TRX-A', 150, 220, { tx: 3 }), z = N('trx', 'TRX-Z', 800, 220, { tx: 3 }); return { nodes: [a, z], links: [L(a, z, 'fiber', { len: 1, extra: 0 })], g: { nch: 1, df: 100, launch: 0 }, svc: { a: a.id, z: z.id } }; } },
    { id: 'port', level: 1, title: 'One wavelength is weak', topic: 'ports',
      story: 'Fifteen channels on this line are healthy, but the 10G service in the middle has been raising a warning ever since a technician swapped a card at the multiplexer.',
      goals: [goalUp(), goalKeep('dwdm10f')],
      hints: ['Open the Channels tab and compare the service channel with its neighbours.', 'A multiplexer port is a piece of hardware. A worn or damaged one costs only the channel that uses it.', 'Open the multiplexer in the inspector and look for degraded ports.'],
      answer: 'The multiplexer port for the service channel had 10 dB of extra loss. Only that channel was affected, so the line looked fine overall. Replacing the port clears it. On the add side the lost power also costs OSNR, because the channel enters the line weaker.',
      build() { const p = PRESETS.mix.build(), slot = p.g.plan.find(c => c.svc).slot; return withNode(p, 'MUX-A', n => { n.p.degPorts = { [slot]: 10 }; }); } },
    { id: 'launch', level: 2, title: 'Turned up too loud', topic: 'launch',
      story: 'A five-span, 48-channel line ran fine until someone raised the channel launch power to +5 dBm per channel to "gain some margin". The margin got worse.',
      goals: [goalUp(2), goalKeep('zrp400')],
      hints: ['Look at the first amplifier\'s alarm: what limit is it hitting?', 'More power drowns the amplifiers\' noise but adds noise from the fiber itself (nonlinearity). The best setting is between the two.', 'The Launch sweep tab plots the margin against the launch power.'],
      answer: 'At +5 dBm per channel the booster hits its 23 dBm total output limit, and the fiber\'s nonlinear noise grows faster than the signal. The margin has a peak (the Launch sweep tab shows it): at the right launch power ASE and nonlinear noise are balanced. Backing off to 0 to +2 dBm restores it.',
      build() { const p = PRESETS.lh.build(); p.g.launch = 5; return p; } },
    { id: 'eol', level: 2, title: 'Fine today, dead in five years', topic: 'aging',
      story: 'After a fiber repair the link came back and carries traffic, but the planning tool says the margin will not last: connectors and the laser will age, and a repair adds splices.',
      goals: [goalUp(), goalKeep('zrp400'), { text: 'It still works at end of life', ok: (S, r) => !!r.eol && r.eol.qMargin >= 0 }],
      hints: ['Read the warning: it mentions end of life and what it assumes.', 'Look at the span\'s loss in the hop table. Is it what 80 km of fiber should cost?', 'Either remove the excess loss or add something to make up for it.'],
      answer: 'The repair left 14 dB of extra splice loss on the span, against about 1 dB normally. Re-splice it, or add amplification, and the end-of-life margin (which adds repairs, connector wear and 0.5 dB of laser ageing) stays positive. A link that only passes on day one has no margin for the years ahead.',
      build() { const p = PRESETS.dci.build(); p.nodes.filter(n => n.type === 'trx').forEach(n => { n.p.mode = 'zrp400'; }); p.links.find(l => l.kind === 'fiber').p.extra = 14; return p; } },
    { id: 'far', level: 2, title: 'One span too many kilometres', topic: 'span',
      story: 'The customer wants 400 Gb/s over 170 km on a single span. The booster and pre-amplifier are in place; the link will not come up.',
      goals: [goalUp(1.5), goalKeep('zrp400')],
      hints: ['What does the headline say is wrong: noise, or something else?', 'Check the span loss against what the amplifiers can make up. Noise adds up with loss.', 'Halving a span cuts its loss by half in dB, which is worth far more than the extra amplifier\'s noise costs.'],
      answer: 'A 170 km span loses about 34 dB, so the signal reaches the pre-amplifier near its noise floor. An amplifier halfway splits it into two 85 km spans: two 17 dB spans give a much better OSNR than one 34 dB span, because each amplifier restarts the signal at a high level.',
      build() { const p = PRESETS.dci.build(); p.nodes.filter(n => n.type === 'trx').forEach(n => { n.p.mode = 'zrp400'; }); p.links.find(l => l.kind === 'fiber').p.len = 170; return p; } },
    { id: 'onefiber', level: 2, title: 'Only one way', topic: 'bidi',
      story: 'A single fiber carries both directions between two sites, and an amplifier sits in the middle. Traffic works one way and the other direction is dark.',
      goals: [goalUp(2), goalKeep('dwdm10f')],
      hints: ['The service bar shows the forward direction; the return direction can fail alone. Look at the headline.', 'Amplifiers normally have isolators that stop light going backwards.', 'A single fiber needs an amplifier built for both directions.'],
      answer: 'An ordinary EDFA is one-way: its isolators block the reverse run, which on a single fiber is the other direction of the service. A BiDi amplifier has circulators and band filters around two amplifier paths and passes both, for about 1.2 dB of filter loss each way.',
      build() { return withNode(PRESETS.bidiamp.build(), 'BIDI-AMP', n => { n.p.bidi = false; }); } },
    { id: 'dispersion', level: 2, title: 'The pulses smear', topic: 'cd',
      story: 'Ten-gigabit DWDM optics between two switches, 120 km apart. The power is fine and there is plenty of OSNR, yet the link is down.',
      goals: [goalUp(), goalKeep('dwdm10f')],
      hints: ['Read the headline: it is not about power or noise.', 'A 10G receiver tolerates only a small amount of accumulated dispersion; 120 km of fiber has far more.', 'Something in the palette cancels dispersion. It costs loss, so think about where in the line it can go.'],
      answer: 'About 2040 ps/nm of dispersion accumulates over 120 km, against a tolerance near 1600 ps/nm. A dispersion compensating module (DCF or a fiber Bragg grating) cancels it. Put it before the receiver, after the pre-amplifier, so its 7 dB of loss does not hurt the span.',
      build() { const p = PRESETS.sfp10dcm.build(), d = p.nodes.find(n => n.type === 'dcm'), pb = p.nodes.find(n => n.name === 'PRE-B'), mb = p.nodes.find(n => n.name === 'MUX-B');
        p.nodes = p.nodes.filter(n => n !== d); p.links = p.links.filter(l => l.a !== d.id && l.b !== d.id); p.links.push(L(pb, mb, 'patch')); return p; } },
    { id: 'cut', level: 3, title: 'One backhoe away from an outage', topic: 'resil',
      story: 'Three ROADM sites, but only two fibers join them in a chain. Everything works today. The network team wants the service A–C to survive any single fiber cut.',
      goals: [goalUp(), goalCut],
      hints: ['Try it: select a fiber, set it to Cut, and see what happens. Then splice it again.', 'To survive a cut a service needs a second route that shares no fiber with the first.', 'Close the triangle. The restoration tab in the Resilience view shows what the new route is worth.'],
      answer: 'With a chain A–B–C, a cut anywhere splits it. A third fiber from A to C closes the triangle, so each cut leaves a route over the other two. The restored route is longer, so its Q margin is lower: check it, because a route that exists but fails its margin does not protect anything.',
      build() { const p = PRESETS.ring.build(), tb = p.nodes.find(n => n.name === 'TRX-B'), ra = p.nodes.find(n => n.name === 'ROADM-A'), rc = p.nodes.find(n => n.name === 'ROADM-C');
        p.nodes = p.nodes.filter(n => n !== tb); p.links = p.links.filter(l => l.a !== tb.id && l.b !== tb.id && !(l.a === ra.id && l.b === rc.id)); return p; } }, // a chain A–B–C: the direct A–C fiber is missing
    { id: 'convert', level: 2, title: 'Two slots, one channel', topic: 'ports',
      story: 'Site C\u2019s mux plan puts TRX-C2 on slot 31, and site B\u2019s port for TRX-B2 is on slot 32. Both are named as each other\u2019s partner, but the pair stays dark because they are not tuned the same. Neither site can be retuned. The A\u2013C service has to keep running.',
      goals: [{ text: 'TRX-C2 and TRX-B2 carry a channel that is Up', ok: (S, r) => r.channels.some(c => c.status === 'up' && [c.fromName, c.toName].sort().join() === 'TRX-B2,TRX-C2') },
        { text: 'TRX-C2 stays on slot 31 and TRX-B2 on slot 32', ok: S => { const t = n => S.nodes.find(x => x.name === n); return !!t('TRX-C2') && !!t('TRX-B2') && t('TRX-C2').p.slot === 31 && t('TRX-B2').p.slot === 32; } },
        goalUp()],
      hints: ['Select TRX-C2 and look at its channel settings: a channel can change wavelength part way along its route.', 'A wavelength converter works at a ROADM, so pick one that is not at either end of the channel.', 'Set \u2018Convert at\u2019 on TRX-C2 (or TRX-B2) to ROADM-A. The pair already names each other, so nothing else is needed.'],
      answer: 'Set Convert at to ROADM-A on TRX-C2. The channel is received at ROADM-A, regenerated and sent on in slot 32, so each half uses a slot that is free on its own fibers. The service channel cannot be converted, and the converter must sit at a ROADM that is neither end, which is why it has to be ROADM-A. A converter regenerates the signal, which is also why a channel judged by its worst half can still be fine over a long route.',
      build() { const p = PRESETS.roadmports.build(); withNode(p, 'TRX-C2', n => { n.p.slot = 31; }); withNode(p, 'TRX-B2', n => { n.p.slot = 32; }); return p; } },
    { id: 'repack', level: 2, title: 'Slots in a pile-up', topic: 'plan',
      story: 'Eight channels on a four-site ring, planned by hand over several years. The monitoring shows two of them blocked with \u2018already lit\u2019: each was given a slot another channel already uses on a fiber they share. Every channel in the plan is wanted, and the service stays where it is.',
      goals: [{ text: 'No channel is blocked', ok: (S, r) => r.channels.every(c => c.status !== 'blocked') }, { text: 'All eight channels are still in the plan', ok: S => !!S.g.plan && S.g.plan.length >= 8 }, goalUp()],
      hints: ['Open the Channels tab and find the blocked ones. The message names the fiber and the slot.', 'Two channels may share a slot only when they have no fiber in common. Change one of each clashing pair to a slot free on every fiber of its route.', 'The Channels tab has an \u2018Assign slots (first fit)\u2019 button that gives each channel the lowest slot free along its route. Deleting a channel is not an answer: all eight are wanted.'],
      answer: 'A slot can be used again only on routes that share no fiber. Here an A\u2013C channel routed through B shares the B\u2013C fiber with one channel and the A\u2013B fiber with another, so its slot has to differ from both. First fit does this for the whole plan at once (it packs the channels into the lowest slots, reusing a slot wherever the routes do not meet), but it leaves the service where it is. Keeping the plan packed leaves the high slots free for later, which is the point of repacking.',
      build() { const p = PRESETS.srlg.build(), id = n => p.nodes.find(x => x.name === n).id, ra = id('ROADM-A'), rb = id('ROADM-B'), rc = id('ROADM-C'), plan = [];
        const ch = (slot, o = {}) => plan.push({ slot, mode: 'zrp400', off: 0, svc: false, from: '', to: '', via: '', conv: '', slot2: slot, prot: '', ...o });
        ch(31, { svc: true }); ch(32, { from: ra, to: rc }); ch(33, { from: ra, to: rc }); ch(31, { from: ra, to: rc, via: rb }); ch(32, { from: rb, to: rc }); ch(32, { from: ra, to: rc, via: rb }); ch(25, { from: ra, to: rb }); ch(25, { from: ra, to: rc, via: rb });
        p.g.plan = plan; p.g.nch = plan.length; p.links.forEach(l => { l.p.srlg = ''; return l; }); p.nodes.forEach(n => { if (n.type === 'roadm') n.p.amps = true; }); return p; } },
    { id: 'size', level: 3, title: 'A node that will not grow', topic: 'ports',
      story: 'ROADM-A and ROADM-C were bought small: two add/drop ports and a contention-limited add/drop. A third wavelength pair, TRX-A3 to TRX-C3 on slot 30, has been cabled into port 3 of each and stays dark. Slot 30 is already used on the other two fibers, which is fine because those routes do not meet. The other two channels and the service must stay up.',
      goals: [{ text: 'TRX-A3 and TRX-C3 carry a channel that is Up', ok: (S, r) => r.channels.some(c => c.status === 'up' && [c.fromName, c.toName].sort().join() === 'TRX-A3,TRX-C3') },
        { text: 'TRX-A3 and TRX-C3 stay on slot 30', ok: S => ['TRX-A3', 'TRX-C3'].every(n => { const t = S.nodes.find(x => x.name === n); return !!t && t.p.slot === 30; }) },
        { text: 'The service and the A2\u2013B1 and B2\u2013C2 channels stay Up', ok: (S, r) => r.status === 'up' && ['TRX-A2,TRX-B1', 'TRX-B2,TRX-C2'].every(k => r.channels.some(c => c.status === 'up' && [c.fromName, c.toName].sort().join() === k)) }],
      hints: ['Select TRX-A3 and read its reason for being dark: the node tells you.', 'There are two limits, and the second shows once the first is lifted: a ROADM has a number of add/drop ports, and a ROADM that is not contentionless adds a given slot at only one port.', 'On both ROADM-A and ROADM-C: raise the number of add/drop ports to at least 3, and make the add/drop contentionless. Retuning to another slot would also light the channel, but the slot was chosen on purpose.'],
      answer: 'A ROADM node is sized by its add/drop ports, and by how flexible they are. Port 3 does not exist on a 2-port node. And a node that is not contentionless can add a given slot at only one port, so slot 30 on A2 and A3 collide even though they leave on different fibers. Both ROADM-A and ROADM-C needed more ports and contentionless add/drop. Colorless and directionless add/drop would also have helped had the channels been retuned or moved to another degree.',
      build() { const p = PRESETS.roadmports.build(), nm = n => p.nodes.find(x => x.name === n), ra = nm('ROADM-A'), rc = nm('ROADM-C');
        const a3 = N('trx', 'TRX-A3', 60, 160, { mode: 'zrp400', slot: 30 }), c3 = N('trx', 'TRX-C3', 980, 160, { mode: 'zrp400', slot: 30 });
        a3.p.peer = c3.id; c3.p.peer = a3.id; p.nodes.push(a3, c3); p.links.push(L(a3, ra, 'patch', { mport: 2 }), L(c3, rc, 'patch', { mport: 2 }));
        for (const r of [ra, rc]) { r.p.ports = 2; r.p.contentionless = false; } return p; } },
    { id: 'tilt', level: 2, title: 'The edge of the band', topic: 'srs',
      story: 'A 48-channel line passes its margin test, but the customer on the highest-frequency channel keeps losing frames and the middle channels never do. The amplifiers were reconfigured last month.',
      goals: [goalUp(), goalKeep('zrp400'), { text: 'Every channel keeps at least 1 dB of margin', ok: (S, r) => r.worstQMargin >= 1 }],
      hints: ['The service bar shows the middle channel. Look at the Channels tab, or the worst-channel readings.', 'Stimulated Raman scattering moves power from the short wavelengths to the long ones, and the tilt builds up span after span.', 'Open an amplifier in the inspector and look at its gain-tilt control.'],
      answer: 'The in-line amplifiers had gain-tilt control switched off, so the SRS tilt added up over five spans and the edge channel lost about 1 dB more than the middle one. Turning it back on re-flattens the band at each amplifier output. A ROADM in the line would also re-equalise it.',
      build() { const p = PRESETS.lh.build(); p.nodes.filter(n => n.type === 'edfa').forEach(n => { n.p.tiltCtl = false; }); p.links.filter(l => l.kind === 'fiber').forEach(l => { l.p.len = 100; }); p.g.launch = 0; return p; } },
    { id: 'duct', level: 3, title: 'Two routes, one trench', topic: 'resil',
      story: 'The service is protected 1+1 over two fibers, A–C and the detour through B. Then the survey arrives: both fibers leave site A in the same duct. The network team wants the service to survive any single cut, including a dug-up duct.',
      goals: [goalUp(), goalCut],
      hints: ['Select the two fibers that leave ROADM-A and read their settings. What do they have in common?', 'A shared risk group means one cut takes down every fiber in it. The protection route has to avoid the group.', 'Either build a route that does not use that duct, or move one fiber into a separate duct (clear its shared-risk tag).'],
      answer: 'A–C and A–B shared the risk group duct1, so one cut took both the working and the protection route. Protection only protects if the two routes cannot fail together: re-route one fiber into its own duct (clear its tag), or add a fiber through another node so the detour avoids the shared stretch.',
      build() { const p = PRESETS.srlg.build(), rd = p.nodes.find(n => n.name === 'ROADM-D'); p.nodes = p.nodes.filter(n => n !== rd); p.links = p.links.filter(l => l.a !== rd.id && l.b !== rd.id); return p; } },
    { id: 'bench', level: 3, title: 'Build it from a blank bench', topic: 'span',
      story: 'Two 400G ZR+ transponders have to talk across 210 km of fiber. All that exists so far is the fiber. Design the line: nothing is wrong with the parts, there just are not enough of them.',
      goals: [goalUp(2), goalKeep('zrp400'), { text: 'The route is still 200 km or more of fiber', ok: S => S.links.filter(l => l.kind === 'fiber').reduce((a, l) => a + (+l.p.len || 0), 0) >= 200 }],
      hints: ['Read the received power in the KPI row. 210 km of fiber loses over 40 dB.', 'Drag amplifiers from the palette onto the span, or use the fix button on a span\'s alarm. Each one splits the span in two.', 'Shorter spans first, but do not forget the last one: the receiver needs enough power too, so an amplifier close to each end helps.'],
      answer: 'Light loses about 0.2 dB per km, so 210 km costs over 40 dB, more than a receiver can recover from. Three amplifiers split it into four spans of about 52 km: each loses about 10 dB, the amplifiers restore the level each time, and the last one hands the receiver a strong signal. The OSNR from four short spans beats the OSNR from one long one by a wide margin.',
      build() { const a = N('trx', 'TRX-A', 120, 220, { mode: 'zrp400' }), z = N('trx', 'TRX-Z', 840, 220, { mode: 'zrp400' }); return { nodes: [a, z], links: [L(a, z, 'fiber', { len: 210 })], g: { nch: 16, df: 100, launch: 0 }, svc: { a: a.id, z: z.id } }; } },
    { id: 'raman', level: 3, title: 'No room for a hut', topic: 'raman',
      story: 'A 160 km span has to carry 400G ZR+ between two sites. There is no power, building or access at the midpoint, so no amplifier can go there. The only equipment you can change is at the two ends.',
      goals: [goalUp(1.5), goalKeep('zrp400'), { text: 'No amplifier added in the span (still two EDFAs, 150 km or more of fiber)', ok: S => S.nodes.filter(n => n.type === 'edfa').length <= 2 && S.links.filter(l => l.kind === 'fiber').reduce((a, l) => a + (+l.p.len || 0), 0) >= 150 }],
      hints: ['A normal EDFA adds gain at one point, after the loss. Is there a way to add gain along the fiber instead?', 'A Raman pump at the receiving end sends light backwards down the span and amplifies the signal as it travels.', 'Open the fiber in the inspector and open its Raman pump settings. The Raman tab shows the gain profile.'],
      answer: 'A backward Raman pump of about 1 W amplifies the signal inside the last tens of kilometres of the span, where it is weakest, so the noise it adds is far less than one lumped amplifier would add after all 160 km of loss. The cost: more nonlinearity, and a Class 4 laser above about 1 W that needs interlocks and a safety procedure.',
      build() { const p = PRESETS.dci.build(); p.nodes.filter(n => n.type === 'trx').forEach(n => { n.p.mode = 'zrp400'; }); p.links.find(l => l.kind === 'fiber').p.len = 160; return p; } },
    { id: 'filters', level: 3, title: 'Death by a thousand filters', topic: 'filter',
      story: 'Someone put a full ROADM in every hut along 660 km, twelve in all, on a tight 75 GHz grid. Only the two end sites need to add or drop anything. The line passes its power checks, yet the 400G service will not come up.',
      goals: [goalUp(2), goalKeep('zrp400'), { text: 'The route is still 600 km or more of fiber', ok: S => S.links.filter(l => l.kind === 'fiber').reduce((a, l) => a + (+l.p.len || 0), 0) >= 600 }],
      hints: ['Read the headline: power is fine, so what else gets worse at every device?', 'Each WSS cuts a little off the edges of the passband. Twelve of them in a row cut a lot. The Spectrum tab shows the passband.', 'A site that only passes the light through needs only gain. A cheaper, wider device can do that job.'],
      answer: 'Each ROADM narrows the passband slightly, and the penalty adds up: after twelve the filtering costs well over a dB and the service fails. The huts that only pass light through need amplifiers, not ROADMs. Replace the ten middle ROADMs with in-line amplifiers and keep the two end ROADMs where channels are added and dropped. (Widening the grid to 100 GHz helps too but is not enough alone.)',
      build() { const n = 12, nodes = [], links = [], t = (nm, x) => N('trx', nm, x, 300, { mode: 'zrp400' }), a = t('TRX-A', 40), z = t('TRX-Z', 1240), r = [];
        for (let i = 0; i < n; i++) r.push(N('roadm', 'ROADM-' + (i + 1), 120 + i * 95, 180));
        nodes.push(a, ...r, z); links.push(L(a, r[0], 'patch')); for (let i = 0; i < n - 1; i++) links.push(L(r[i], r[i + 1], 'fiber', { len: 60 })); links.push(L(r[n - 1], z, 'patch'));
        return { nodes, links, g: { nch: 32, df: 75, launch: 0 }, svc: { a: a.id, z: z.id } }; } }, // at 100 GHz the slot is wide enough that the filters barely matter
    { id: 'monday', level: 3, title: 'Monday morning', topic: 'fail',
      story: 'The overnight alert says the A–Z service is down. Operations replaced the cable, but the link is still not right. There may be more than one thing wrong.',
      goals: [goalUp(), goalKeep('zrp400')],
      hints: ['Fix what the headline names first, then look again: the next fault only shows once the first is gone.', 'A failed device passes no light. After it is back, check the alarms for anything still reducing the margin.', 'Walk the hop table from the transmitter, watching the power at each device.'],
      answer: 'The booster had failed (Set it back to Working) and ODF-B port 1 still held a dirty connector (clean it). Faults hide behind each other: a dead amplifier gives a LOS that says nothing about the connector, so after each repair the diagnosis starts again from the headline.',
      build() { const p = PRESETS.odf.build(); withNode(p, 'ODF-B', n => { n.p.dirty = { 1: 4.5 }; }); withNode(p, 'BST-A', n => { n.p.fail = 'dead'; }); return p; } },
  ];
  // The challenge as the player sees it: the goals with their pass flags, from a simulation of S (or the one passed in).
  function challengeStatus(ch, S, res) {
    S = effective(S); res = res || simulate(S);
    const goals = ch.goals.map(g => ({ text: g.text, ok: !!g.ok(S, res) }));
    return { goals, done: goals.every(g => g.ok) };
  }

