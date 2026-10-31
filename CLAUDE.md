# Optical Line Lab

Single-page browser app, no dependencies. Edit files in `src/`, then run `./build.sh` to produce `dist/optical-line-lab.html`.

- `src/engine.js` is pure physics and must stay DOM-free so it can be tested in Node.
- `src/app.js` is an IIFE using the global `PHY` from engine.js.
- `src/shell.html` has no `<html>/<head>/<body>`; build.sh wraps it.
- Colors are CSS tokens on `:root` with dark overrides; keep both themes working.
- Sanity checks after physics changes: `node -e "const P=require('./src/engine.js');for(const k in P.MODES)console.log(k,P.requiredOsnr(P.MODES[k]).toFixed(1))"` should give ~23 (400ZR), ~22 (ZR+ 400G), ~11.6 (100G).
