#!/bin/sh
# Renders the snippet with sample data (no WordPress needed), builds a plain page and a hostile-theme page, runs the browser checks.
# Usage: sh wp-snippet/tests/run.sh   (needs php, node + playwright with chromium)
set -e
D=$(cd "$(dirname "$0")" && pwd); OUT=${OUT:-$D/out}; mkdir -p "$OUT"
php "$D/harness.php" "$D/../fsa-v2-snippet.php" > "$OUT/area.html"
head='<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
{ printf '%s</head><body class="fsa-v2">' "$head"; cat "$OUT/area.html"; printf '</body></html>'; } > "$OUT/page-plain.html"
{ printf '%s<style>' "$head"; cat "$D/theme.css"; printf '</style></head><body class="fsa-v2"><div class="site-header"></div><div class="elementor-widget-container"><div class="entry-content">'; cat "$OUT/area.html"; printf '<div style="height:400px"></div></div></div></body></html>'; } > "$OUT/page-theme.html"
NODE_PATH=${NODE_PATH:-/opt/node-tools/node_modules} node "$D/suite.js" "$OUT"
