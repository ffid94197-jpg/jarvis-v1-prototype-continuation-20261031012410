#!/usr/bin/env bash
# JARVIS PHASE 02 — DURABLE SUITE DRIVER
# Orchestrates REAL dev-server restarts with REAL fault injection and
# runs each DUR probe against the live runtime. All output is evidence.
set -u
cd /home/z/my-project
export JARVIS_OWNER_TOKEN="${JARVIS_OWNER_TOKEN:-$(cat /tmp/owner_token.txt)}"
OUT="evidence/DURABLE_suite_raw.txt"
: > "$OUT"

log() { echo "=== $* ===" | tee -a "$OUT"; }

restart_server() { # $1 = optional JARVIS_TEST_FAULT value
  kill $(ps aux | grep -E "next dev|bun run dev" | grep -v grep | awk '{print $2}') 2>/dev/null
  sleep 2
  kill -9 $(ps aux | grep -E "next" | grep -v grep | awk '{print $2}') 2>/dev/null
  sleep 1
  if [ -n "${1:-}" ]; then
    bun -e "const {spawn}=require('child_process'); const c=spawn('bun',['run','dev'],{cwd:'/home/z/my-project',detached:true,stdio:'ignore',env:{...process.env,JARVIS_TEST_FAULT:'$1'}}); c.unref();" >> "$OUT" 2>&1
  else
    bun -e "const {spawn}=require('child_process'); const c=spawn('bun',['run','dev'],{cwd:'/home/z/my-project',detached:true,stdio:'ignore'}); c.unref();" >> "$OUT" 2>&1
  fi
  for i in $(seq 1 25); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/ 2>/dev/null)
    if [ "$code" = "200" ]; then log "server up (${{1:-clean}})"; return 0; fi
    sleep 4
  done
  log "SERVER FAILED TO START"; exit 1
}

probe() { # $1 = subcommand, $2 = label
  log "PROBE $1 ($2)"
  if bun run "scripts/durable-probe.ts" "$1" 2>&1 | tee -a "$OUT"; then :; else
    log "PROBE $1 FINISHED NONZERO (recorded honestly)"
  fi
}

log "PHASE 02 DURABLE SUITE — $(date -u +%FT%TZ)"
log "step 1: unit probes (no server faults needed)"
probe unit "DUR-05/06/07 in-process"

log "step 2: restart with JARVIS_TEST_FAULT=admission (DUR-01)"
restart_server admission
probe dur01 "admission gate fail-closed"
restart_server ""
probe unit "post-fault regression check (DUR-05/06/07 still pass)"

log "step 3: restart with JARVIS_TEST_FAULT=settlement (DUR-02)"
restart_server settlement
probe dur02 "settlement honesty + crash reconciliation"
restart_server ""

log "step 4: restart continuity (DUR-03 / DUR-08)"
probe dur03-setup "pause with committed journal"
restart_server ""
probe dur03-verify "resume with zero re-execution + status agreement"

log "step 5: uncertain ghost effect (DUR-04)"
probe dur04 "no blind replay"
restart_server ""

log "SUITE COMPLETE — verdicts above (any FAIL is recorded, not hidden)"
