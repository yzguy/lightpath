# Lightpath

A browser-based, drag-and-drop DWDM lab for building intuition about the optical physical layer, in the spirit of EVE-NG or Packet Tracer but for optics.

Drag transponders, muxponders, mux/demux, EDFAs, ROADMs and VOAs onto a bench, cable them with patch cords or fiber spans, pick an A and Z transponder, and watch Rx power, OSNR, GSNR, pre-FEC BER, Q-factor, margin, CD and DGD respond. Includes alarms (LOS, Rx LOW/HIGH, amp gain range, CD out of range), a noise budget breakdown, a power-level diagram, a hop-by-hop PM table, an OSA-style spectrum at any point along the path, a live constellation, a launch-power sweep and short physics explainers.

## Run

```sh
./build.sh
open dist/lightpath.html   # or xdg-open on Linux
```

No dependencies, no bundler. (The page asks Google Fonts for Archivo and IBM Plex Mono and falls back to system fonts offline.) Run the tests with `npm test`. Topology is saved in the browser's localStorage and can be exported/imported as JSON.

## Layout

| File | What it holds |
| --- | --- |
| `src/engine.js` | Physics (`PHY`): ASE, GN-model NLI, transceiver modes, fiber types, BER/Q math, required OSNR. Also loadable in Node (`require('./src/engine.js')`). |
| `src/model.js` | Device types, preset scenarios, input validation (`sanitize`), routing (Dijkstra over the cabled graph) and the A→Z path simulation. DOM-free, also loadable in Node. |
| `src/app.js` | Canvas, palette, inspector, results views, Learn content. |
| `test/` | Node unit tests for the engine and model (`npm test`). |
| `src/shell.html` | Markup and CSS (light and dark themes). |
| `build.sh` | Syntax-checks, then concatenates shell + engine + model + app into `dist/lightpath.html`. |

## Physics model

- **ASE:** each EDFA adds `NF · hν · G · B_ref` (B_ref = 12.5 GHz, 0.1 nm), giving the familiar `OSNR ≈ 58 + P_in − NF` per amp. NF rises when gain is run below ~14 dB.
- **Nonlinear interference:** closed-form incoherent GN model (Poggiolini), the same family of physics used by TIP's [GNPy](https://github.com/Telecominfraproject/oopt-gnpy). `P_NLI = η · P³` per span, with η depending on γ, effective length, β₂, baud rate, channel count and spacing. Successive spans add incoherently on normal uncompensated fiber, but partly coherently when the dispersion map is flat (an inline DCM, or low-dispersion NZ-DSF): the cross term fades from full at 0 accumulated ps/nm to none at about 400.
- **Transceivers:** each mode has a back-to-back SNR ceiling and an implementation penalty, tuned so required OSNR lands near real values (400ZR ≈ 23 dB, 400G ZR+ ≈ 22 dB, 100G DP-QPSK ≈ 11.6 dB). BER from Gray-coded M-QAM formulas; Q = 20·log10(√2·erfc⁻¹(2·BER)).
- **Two directions:** every service is simulated both ways (A to Z and Z to A). The service status is the worse of the two, and buttons by the status pill switch every result view to either direction. Fibers have a separate return-direction connector loss and Raman pump, and amplifiers a separate return-direction output target or gain, because an amplifier box is a booster in one direction and a preamp in the other. Blank means "same as forward". Amplifier gain range, noise figure and output limit, and DCM dispersion and loss, have return-direction fields too. A fiber can be set to carry one direction only ("Carries light"), so each direction routes separately; an arrow on the cable label shows it, and a one-way fiber with no return path takes the service down.
- **Raman amplification:** each fiber span can carry a Raman pump (0 to 1500 mW total), pumped backward, forward or from both ends, with 1, 2 or 3 pump wavelengths. On-off gain follows pump power, effective length and fiber γ, reduced by pump depletion when the signal is strong. Backward gain acts like a lumped amplifier late in the span (about 40% of the gain counts as OSNR benefit, 4.5 dB equivalent noise figure); forward gain acts early (better ASE, but a 7 dB noise figure from pump noise and much more nonlinearity); both ends is usually best. Gain ripple across the band shrinks with more pump wavelengths and shows up in the tilt figure. Alarms for depletion and for pumps above 1 W. A full Raman gain-spectrum solver and double Rayleigh scattering are not modelled.
- **End-of-life allowances:** the extra loss per span (default 1.0 dB) and transceiver ageing (default 0.5 dB) behind the end-of-life margin are editable in the inspector when nothing is selected.
- **Span list import:** Export / import has a "Build a line from a span list" box. Paste `km, fiber, extra loss dB` rows (for example from an OTDR or planning sheet) and it builds TRX, mux, booster, an ILA between spans, preamp, mux and TRX, with bad rows reported.
- **10G DWDM optics:** a non-coherent mode for tunable SFP+ ZR optics in switches (NRZ, 10.3 GBd, APD receiver, no FEC, about 19 dB required OSNR). With no DSP, chromatic dispersion costs SNR gradually and the link drops past 1600 ps/nm (~95 km of SMF). Values are representative, not datasheet-exact. Try the "Switch 10G DWDM optics" scenario and stretch the span past 90 km. A "10G+FEC" variant models a host-side FEC (~10 dB required OSNR instead of ~19). A Dispersion comp. device (DCF/FBG, default -1360 ps/nm and 7 dB) brings a 120 km link back inside the tolerance (see the "Switch 10G over 120 km with a DCM" scenario). Cross-phase modulation from neighbouring channels adds a penalty for these optics (per span, growing with neighbours within ~400 GHz, launch power and effective length; choose same-type or coherent neighbours in the inspector with nothing selected). Representative numbers, not a full XPM model.
- **Muxponders:** a muxponder has up to 8 client ports (10G to 800G grey optics: LR/ER, DR/FR/LR4, DR4/FR4, DR8/2xFR4) feeding one coherent line port. Each client has its own fiber and connector budget against the module's Rx window and rated reach (Rx LOW, overload and over-reach alarms), and the clients must fit the line rate. 400ZR carries a single 400GbE client; OpenZR+ modes can multiplex sub-rate clients. Client values are representative IEEE/MSA numbers, not datasheet-exact. Client ports are modelled inside the device, not as separate cabled hosts.
- **End of life:** every result also carries an end-of-life run (+1.0 dB loss per fiber span, +0.5 dB transceiver ageing). A link that passes today but fails then raises an alarm.
- **SRS tilt:** first-order Raman tilt per span (grows with total power, effective length and occupied bandwidth). Amplifier gain-tilt control (on by default) and ROADM WSSs re-flatten the band. The service channel sits mid-band, so the *worst channel* (highest frequency) Q margin is reported separately, and the Spectrum tab draws the tilt.
- **Other impairments:** CD vs DSP tolerance (hard fail), mean DGD penalty vs PMD tolerance, WSS filter-narrowing penalty per pass, Rx thermal noise and overload penalty, amplifier gain range and total-output saturation.

### Simplifications

- One direction only (A → Z). Channel load is the global setting unless a fiber span overrides it; all channels are assumed equal power, centred in the C-band (191.3–196.1 THz).
- ROADM express = 2 WSS passes; add/drop = 1 WSS pass + add/drop structure; optional integrated pre/booster amps.
- Numbers are good for trends and intuition, within a few dB of reality. This is not a planning tool.

## Ideas for next steps

- A real Raman gain-spectrum solver (per-channel gain, pump-to-pump interaction) and double Rayleigh scattering
- Per-channel allocation, so XPM depends on where the 10G channels sit in the grid
- Different channel types on one line (a real mix of 10G, 100G and 400G) with per-channel results
