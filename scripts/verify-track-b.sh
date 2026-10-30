#!/usr/bin/env bash
# JARVIS Track B verification. NEVER green when a mandatory check is not run.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
EVD="evidence/current_verification"
mkdir -p "$EVD"
LEDGER="$EVD/VERIFY_GATE_LEDGER.txt"
: > "$LEDGER"
fail=0
blocked=0

log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LEDGER"; }
gate() {
  local id="$1"; shift
  log "GATE $id START"
  if "$@" > "$EVD/${id}.log" 2>&1; then
    log "GATE $id PASS (exit 0)"
  else
    local exit_code=$?
    log "GATE $id FAIL (exit $exit_code); $EVD/${id}.log"
    fail=1
  fi
}
block() {
  log "GATE $1 BLOCKED — $2"
  blocked=1
}

[ -f package.json ] && [ -d src/lib/agent ] || { log 'FAIL not a JARVIS workspace'; exit 1; }
log "OS=$(uname -srm) — branch=${JARVIS_TRACKB_BRANCH:-unrecorded}"
if ! command -v bun >/dev/null 2>&1 || [ ! -d node_modules ]; then
  block 'TOOLCHAIN' 'Bun or reviewed installed dependencies missing'
else
  gate LINT bun run lint
  gate TYPECHECK ./node_modules/.bin/tsc --noEmit
  gate GPT6-OWNER-AUTH node scripts/gpt6-auth-contract-probe.cjs
  gate GPT6-OFFLINE-SECURITY node --experimental-strip-types scripts/gpt6-offline-security-probe.mjs
  gate GPT6-OLLAMA-FIXTURE node --experimental-strip-types scripts/gpt6-ollama-fixture-probe.mjs
  gate ORIGIN-POLICY bun run scripts/origin-probe.ts
  gate BUILD bun run build
  # Effectful fixture probes require a dedicated database; never run on a user DB.
  if [ -z "${JARVIS_TEST_DATABASE_URL:-}" ]; then
    block 'UNIT-TESTS' 'Set JARVIS_TEST_DATABASE_URL to a disposable test database'
  else
    export DATABASE_URL="$JARVIS_TEST_DATABASE_URL"
    gate GUARDIAN bun run scripts/guardian-probe.ts
    gate DURABLE-UNIT bun run scripts/durable-probe.ts unit
    gate ATOMIC-UNIT bun run scripts/atomic-probe.ts unit
    gate VERIFIER-UNIT bun run scripts/verify-probe.ts unit
    # Live HTTP/LLM/auth tests are separate; they MUST NOT be forged as PASSED.
  fi
fi
block 'LIVE-END-TO-END' 'Run separately with approved test credentials and a running server'
if [[ "$(uname -s)" != MINGW* && "$(uname -s)" != MSYS* && "$(uname -s)" != CYGWIN* ]]; then
  block 'WINDOWS-NATIVE' 'Requires real Windows test host, LPAC/RLM and protected worker evidence'
else
  block 'WINDOWS-NATIVE' 'Windows host detected; integrated LPAC/RLM certification suite not wired to this runner'
fi
if (( fail || blocked )); then
  log "RELEASE VERDICT: NOT COMPLETE (failed=$fail blocked=$blocked)"
  exit 1
fi
log 'RELEASE VERDICT: PASS (all mandatory gates executed)'
