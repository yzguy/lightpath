#!/usr/bin/env bash
# Builds dist/optical-line-lab.html: a single self-contained page (shell + physics engine + model + app).
set -euo pipefail
cd "$(dirname "$0")"
for f in src/engine.js src/model.js src/app.js; do node --check "$f"; done
mkdir -p dist
{
  cat src/shell.html
  echo '<script>'; cat src/engine.js; echo '</script>'
  echo '<script>'; cat src/model.js; echo '</script>'
  echo '<script>'; cat src/app.js; echo '</script>'
} > dist/optical-line-lab.html.body
# Wrap in a document skeleton so the file opens directly in a browser.
{
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>'
  cat dist/optical-line-lab.html.body
  echo '</body></html>'
} > dist/optical-line-lab.html
rm dist/optical-line-lab.html.body
echo "built dist/optical-line-lab.html"
