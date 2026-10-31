# Optical Line Lab

A browser-based, drag-and-drop DWDM lab for building intuition about the optical physical layer, in the spirit of EVE-NG or Packet Tracer but for optics.

Drag transponders, mux/demux, EDFAs, ROADMs and VOAs onto a bench, cable them with patch cords or fiber spans, pick an A and Z transponder, and watch Rx power, OSNR, GSNR, pre-FEC BER, Q-factor, margin, CD and DGD respond. Includes alarms (LOS, Rx LOW/HIGH, amp gain range, CD out of range), a noise budget breakdown, a power-level diagram, a hop-by-hop PM table, a live constellation, a launch-power sweep and short physics explainers.

## Run

```sh
./build.sh
open dist/optical-line-lab.html   # or xdg-open on Linux
```

No dependencies, no bundler. Topology is saved in the browser's localStorage and can be exported/imported as JSON.

## Layout

| File | What it holds |
| --- | --- |
| `src/engine.js` | Physics (`PHY`): ASE, GN-model NLI, transceiver modes, fiber types, BER/Q math, required OSNR. Also loadable in Node (`require('./src/engine.js')`). |
| `src/app.js` | Canvas, palette, inspector, routing (Dijkstra over the cabled graph), path simulation, results views, Learn content. |
| `src/shell.html` | Markup and CSS (light and dark themes). |
| `build.sh` | Concatenates the three into `dist/optical-line-lab.html`. |

## Physics model

- **ASE:** each EDFA adds `NF · hν · G · B_ref` (B_ref = 12.5 GHz, 0.1 nm), giving the familiar `OSNR ≈ 58 + P_in − NF` per amp. NF rises when gain is run below ~14 dB.
- **Nonlinear interference:** closed-form incoherent GN model (Poggiolini), the same family of physics used by TIP's [GNPy](https://github.com/Telecominfraproject/oopt-gnpy). `P_NLI = η · P³` per span, with η depending on γ, effective length, β₂, baud rate, channel count and spacing.
- **Transceivers:** each mode has a back-to-back SNR ceiling and an implementation penalty, tuned so required OSNR lands near real values (400ZR ≈ 23 dB, 400G ZR+ ≈ 22 dB, 100G DP-QPSK ≈ 11.6 dB). BER from Gray-coded M-QAM formulas; Q = 20·log10(√2·erfc⁻¹(2·BER)).
- **Other impairments:** CD vs DSP tolerance (hard fail), mean DGD penalty vs PMD tolerance, WSS filter-narrowing penalty per pass, Rx thermal noise and overload penalty, amplifier gain range and total-output saturation.

### Simplifications

- One direction only (A → Z), same channel load on every span.
- ROADM express = 2 WSS passes; add/drop = 1 WSS pass + add/drop structure; optional integrated pre/booster amps.
- Numbers are good for trends and intuition, within a few dB of reality. This is not a planning tool.

## Ideas for next steps

- Bidirectional links and per-direction amp settings
- Per-span channel loading and a spectrum (OSA) view
- Import real span data (lengths, measured losses) from CSV
- Raman amplification, SRS tilt, ageing margins
