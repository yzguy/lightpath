# Lightpath

Single-page browser app, no dependencies. Edit files in `src/`, then run `./build.sh` to produce `dist/lightpath.html`. Run `npm test` (Node's built-in runner, no installs) before finishing any change. For UI changes also run `npm run test:ui` (builds, then a Python Playwright smoke test of the page in `test/ui_smoke.py`) and add a check there for new interactions.

- `src/engine.js` is pure physics and must stay DOM-free so it can be tested in Node.
- `src/model/*.js` is the topology model: device/preset definitions, challenges, `sanitize()` for untrusted JSON, `route()` and `simulate(S, launchOverride)` (in `95-simulate.js`). Also DOM-free and unit-tested; uses global `PHY`. Keep simulation logic here, not in the app. The channel plan (`g.plan`, `buildChans`, event-log replay for per-channel results) lives here too. The files are consecutive parts of ONE closure (the first opens `const MODEL = (() => {`, the last closes it), joined in file-name order by build.sh; they are not standalone modules, so a part need not parse on its own. `src/model.js` is only the Node loader (`require('./src/model.js')`); errors in Node point at line numbers in the joined text (`cat src/model/*.js`).
- `src/app/*.js` is the same pattern for the UI: parts of one IIFE using the globals `PHY` and `MODEL` (canvas, inspector, results views). New files sort into place by their number prefix.
- Anything loaded from localStorage or pasted import must go through `MODEL.sanitize()`.
- `src/shell.html` has no `<html>/<head>/<body>`; build.sh wraps it.
- Colors are CSS tokens on `:root` with dark overrides; keep both themes working.
- Sanity checks after physics changes: `node -e "const P=require('./src/engine.js');for(const k in P.MODES)console.log(k,P.requiredOsnr(P.MODES[k]).toFixed(1))"` should give ~23 (400ZR), ~22 (ZR+ 400G), ~11.6 (100G).

- Add a test in `test/` for any physics or simulation change. Script order in the built page is engine, model, app.
