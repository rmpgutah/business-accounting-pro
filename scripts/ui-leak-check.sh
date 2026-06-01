#!/usr/bin/env bash
# Fails-soft visual leak audit: reports banned patterns in renderer source.
# Excludes auth/ (login left as-is). Counts must only ever go DOWN vs baseline.
set -uo pipefail
ROOT="src/renderer"

count() { grep -rIl "$1" $ROOT/modules $ROOT/components/layout 2>/dev/null | grep -v "/auth/" | wc -l | tr -d ' '; }
countm() { grep -rIl "$1" $ROOT/modules 2>/dev/null | grep -v "/auth/" | wc -l | tr -d ' '; }

echo "== borderRadius: 0 / '0px' (files) =="
count "borderRadius: *'\{0,1\}0"
echo "== bg-white / text-gray-* / border-gray-* (files) =="
count "bg-white\|text-gray-\|border-gray-"
echo "== hard-coded blue hex 60a5fa/3b82f6/2563eb (module files) =="
countm "60a5fa\|3b82f6\|2563eb"
