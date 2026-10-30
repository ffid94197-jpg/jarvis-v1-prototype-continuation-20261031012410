#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p evidence/laya
LOG=evidence/laya
: > "$LOG/RESULTS.tsv"
for round in 1 2 3; do
  for f in scripts/model-manager/verify-*.cjs scripts/verify-*.cjs; do
    case "$f" in *verify-local-dev-no-login.cjs) continue;; esac
    name=$(basename "$f" .cjs)
    node "$f" > "$LOG/round${round}_${name}.log" 2>&1
    count=$(grep -c '^PASS ' "$LOG/round${round}_${name}.log" || true)
    echo -e "$round\t$name\tPASS\t$count" >> "$LOG/RESULTS.tsv"
  done
  for f in windows-companion/verify_*offline.py windows-companion/verify_desktop_action_fixture.py; do
    name=$(basename "$f" .py)
    python "$f" > "$LOG/round${round}_${name}.log" 2>&1
    count=$(grep -c '^PASS ' "$LOG/round${round}_${name}.log" || true)
    echo -e "$round\t$name\tPASS\t$count" >> "$LOG/RESULTS.tsv"
  done
  echo "Completed round $round: $(awk -v x="$round" '$1==x{n++}END{print n}' "$LOG/RESULTS.tsv") suites"
done
