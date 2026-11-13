#!/usr/bin/env bash
# Builds dist/lightpath.html: a single self-contained page (shell + physics engine + model + app).
# src/model/*.js and src/app/*.js are consecutive parts of one closure each, joined in file-name order.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
cat src/model/*.js > dist/model.js
cat src/app/*.js > dist/app.js
for f in src/engine.js dist/model.js dist/app.js; do node --check "$f"; done
{
  cat src/shell.html
  echo '<script>'; cat src/engine.js; echo '</script>'
  echo '<script>'; cat dist/model.js; echo '</script>'
  echo '<script>'; cat dist/app.js; echo '</script>'
} > dist/lightpath.html.body
rm dist/model.js dist/app.js
# Wrap in a document skeleton so the file opens directly in a browser.
{
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>'
  cat dist/lightpath.html.body
  echo '</body></html>'
} > dist/lightpath.html
rm dist/lightpath.html.body
echo "built dist/lightpath.html"
