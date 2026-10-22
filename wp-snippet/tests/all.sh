#!/bin/sh
# Every check, in order; stops at the first failure. Run before sending a snippet.
# Usage: sh wp-snippet/tests/all.sh   (php, node + playwright with chromium; CHROMIUM=/path if not bundled)
set -e
D=$(cd "$(dirname "$0")" && pwd)
{ echo '<?php'; cat "$D/../fsa-v2-snippet.php"; } > "${TMPDIR:-/tmp}/fsa-lint.php" && php -l "${TMPDIR:-/tmp}/fsa-lint.php" >/dev/null && echo "syntax: ok"
for t in data domains rollout addon profile; do
	out=$(php "$D/$t-test.php" 2>&1) || { echo "$out"; echo "$t: FAILED"; exit 1; }
	echo "$out" | tail -1 | grep -q 'ALL PASSED' || { echo "$out"; echo "$t: FAILED"; exit 1; }
	echo "$t: ok"
done
O=${OUT:-$D/out}; mkdir -p "$O"
out=$(php "$D/sitejs-test.php" "$O" 2>&1) || { echo "$out"; echo "sitejs: FAILED"; exit 1; }
out=$(NODE_PATH=${NODE_PATH:-/opt/node-tools/node_modules} node "$D/sitejs.js" "$O" 2>&1); echo "$out" | tail -1 | grep -q 'ALL PASSED' || { echo "$out"; echo "sitejs: FAILED"; exit 1; }
echo "site scripts: ok"
out=$(sh "$D/run.sh" 2>&1) ; echo "$out" | tail -1 | grep -q 'ALL PASSED' || { echo "$out" | tail -20; echo "browser: FAILED"; exit 1; }
echo "browser: ok"
echo "ALL CHECKS PASSED"
