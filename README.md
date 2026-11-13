# Lightpath

A drag-and-drop DWDM lab that runs in one HTML page, in the spirit of EVE-NG or Packet Tracer but for the optical layer. Place transponders, amplifiers, ROADMs and muxes, cable them, then break things (cut a fiber, dirty a connector, push the power too high) and see why the light still gets through, or why it doesn't.

Live at <https://yzguy.dev/lightpath/>.

## Run

```sh
./build.sh
open dist/lightpath.html   # or xdg-open on Linux
```

No dependencies and no bundler (the page asks Google Fonts for Archivo and IBM Plex Mono and falls back to system fonts offline). `npm test` runs the unit tests with Node's built-in runner. Your lab is autosaved in the browser and can be exported and imported as JSON.

## A five-minute tour

1. **Open it.** The first visit offers a short tour, a challenge, the example link, or a blank bench. The example is a 400ZR link over 80 km: three transponders per side, a mux, a booster, a span and a preamp.
2. **Hover anything** on the bench to see the power going in and out of it and the OSNR after it.
3. **Break it.** Click the fiber span, then *Cut this fiber*: the status turns LOS and the headline says why. *Splice it back* (or Undo) restores it.
4. **Make it marginal.** Drag *Amp output* in the header up and down and watch the Q margin. Too low and amplifier noise wins, too high and fiber nonlinearity does; the *Launch sweep* tab shows the sweet spot.
5. **Build your own.** *Start with a blank bench* (or *Clear canvas*), click *Transponder* twice in the palette, then drag the **+** beside one onto the other. That makes an 80 km fiber, and the receiver is far below its sensitivity. Take the offered *Add an amplifier halfway* fix and the link comes up.
6. **Try a challenge.** *Challenges* in the header loads broken labs with a story, goals that are re-checked after every change, hints and an answer.

## The screen

- **Palette (left):** devices. Drag one onto the bench or click it to drop it in a free spot.
- **Bench (middle):** drag the **+** beside a device onto another to cable them. Lightpath picks a fiber span between equipment that normally sits at different sites (amplifiers, ROADMs, OADMs, two muxes, two transponders over dark fiber) and a patch cord inside a rack; the cable inspector can change it. The *Patch cord* and *Fiber span* tools force one or the other. Shift-click or Shift-drag selects several devices.
- **Inspector (right):** settings for whatever is selected. Faults to inject (failed or weak ports, dirty connectors) fold away at the bottom of a device. *Model assumptions* (with nothing selected) holds the line-wide settings.
- **Header:** *Line load* is how many channels share each fiber (the transponders you cabled plus background channels that load the amplifiers like real traffic). *Amp output* is the per-channel power every amplifier aims for unless it has its own target. *Grid* is the channel spacing.
- **Results (bottom):** the service under test (two transponders), its status, a one-line reason and, when there is an obvious fix, a button for it. Click a transponder on the bench to make the results follow its channel. **Q margin** is the verdict: the headroom before the FEC gives up, positive means working.
- **Tabs:** Results (power map, hop-by-hop, channels), Instruments (spectrum, constellation, OTDR), Analysis (launch sweep) and Learn (challenges and short explainers). Tabs that need something the lab doesn't have (an OTDR, a muxponder, hosts) appear when you add it.
- **Expert mode** (header) shows the rarer settings (return-direction overrides, input overload limits, return loss, per-span channel counts, the coupled-wave Raman solver) and the Planner, Resilience, Transients and Raman tabs. A hidden setting that holds a value of its own is always shown.

## What it models

Amplifier noise (ASE) and fiber nonlinearity (closed-form GN model, the same family as TIP's GNPy); transceiver modes from 10G DWDM to 800G with BER, Q and required OSNR; chromatic dispersion, PMD, filtering, SRS tilt and Raman amplification; both directions of every link; ROADMs, passive OADMs and muxes with numbered ports; channel plans with routing, wavelength assignment, converters and 1+1 or shared protection; patch panels, splitters, optical switches, single-fiber (BiDi) links; device, port and connector faults; a power meter and an OTDR; hosts and reachability; resilience, transients and a demand planner.

[docs/REFERENCE.md](docs/REFERENCE.md) describes each model in detail, with its limits and ideas for next steps.

## Honest about precision

Constants are representative values tuned so results land near real equipment (required OSNR for 400ZR about 23 dB, 400G ZR+ about 22 dB, 100G about 11.6 dB). Treat the numbers as trends, within a few dB of reality. It is a learning lab, not a planning tool.

## Layout

| File | What it holds |
| --- | --- |
| `src/engine.js` | Physics (`PHY`): ASE, GN-model NLI, transceiver modes, fiber types, BER and Q math, Raman. DOM-free, loadable in Node. |
| `src/model/` | Topology model (`MODEL`): device types, scenarios, challenges, `sanitize()` for untrusted JSON, routing, channel plans and the simulation. DOM-free. The files are consecutive parts of one closure, joined in name order; `src/model.js` loads them in Node. |
| `src/app/` | UI (canvas, palette, inspector, result views, Learn content), also parts of one closure joined in name order. |
| `src/shell.html` | Markup and CSS (light and dark themes). |
| `test/` | Node unit tests for the engine and model. |
| `build.sh` | Syntax-checks, then joins shell, engine, model and app into `dist/lightpath.html`. |
