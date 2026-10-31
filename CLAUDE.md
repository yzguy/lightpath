# Lightpath

Single-page browser app, no dependencies. Edit files in `src/`, then run `./build.sh` to produce `dist/lightpath.html`. Run `npm test` (Node's built-in runner, no installs) before finishing any change.

- `src/engine.js` is pure physics and must stay DOM-free so it can be tested in Node.
- `src/model.js` is the topology model: device/preset definitions, `sanitize()` for untrusted JSON, `route()` and `simulate(S, launchOverride)`. Also DOM-free and unit-tested; uses global `PHY`. Keep simulation logic here, not in app.js. The channel plan (`g.plan`, `buildChans`, event-log replay for per-channel results) lives here too.
- `src/app.js` is an IIFE using the globals `PHY` and `MODEL`: UI only (canvas, inspector, results views).
- Anything loaded from localStorage or pasted import must go through `MODEL.sanitize()`.
- `src/shell.html` has no `<html>/<head>/<body>`; build.sh wraps it.
- Colors are CSS tokens on `:root` with dark overrides; keep both themes working.
- Sanity checks after physics changes: `node -e "const P=require('./src/engine.js');for(const k in P.MODES)console.log(k,P.requiredOsnr(P.MODES[k]).toFixed(1))"` should give ~23 (400ZR), ~22 (ZR+ 400G), ~11.6 (100G).

- Add a test in `test/` for any physics or simulation change. Script order in the built page is engine, model, app.
