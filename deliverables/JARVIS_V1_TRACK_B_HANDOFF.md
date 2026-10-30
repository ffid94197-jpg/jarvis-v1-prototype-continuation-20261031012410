# JARVIS V1 TRACK B — HANDOFF

**To:** the owner / next engineering agent
**From:** GLM-5.3 via ZCode, 2026-10-26 session
**Working tree:** `/home/z/my-project` (git; phase commits `4e29124`, `7bd6ce5`, `31ed926`, final docs commit)

## Where to look first

1. `AGENTS.md` — the 22 durable rules (§20). Read before touching anything.
2. `evidence/STAGE_LEDGER.json` — the single source of truth for stage status (PASS / FAIL / BLOCKED / NOT_STARTED / NOT_TESTED — never COMPLETE without tests).
3. `evidence/REQUIREMENTS_TRACEABILITY.csv` — Playbook requirement → status → evidence.
4. `deliverables/JARVIS_V1_RELEASE_VERDICT.md` — the honest verdict and blockers.

## What this session delivered (all evidence-gated, all reproducible)

- **Foundation repaired end-to-end (Checkpoints 1–5):** real identity/ownership on every route; explicit state machine with journal-before-effect admission; honest settlement (never false success); crash reconciliation; deterministic completion arbitration; atomic duplicate suppression; cancellation that kills real OS work and survives restarts. Every claim backed by executed probes in `evidence/` with raw transcripts.
- **NEXUS two-mode contract enforced:** Orb Mode = orb + one bottom switch (browser-verified); all configuration lives in Text Mode.
- **§19 harness:** `bash scripts/verify-track-b.sh` re-runs every deterministic gate in one command and writes the gate ledger.
- **Fault-injection test channel:** `JARVIS_TEST_FAULT=admission|settlement|audit` (documented, test-only, fail-closed by construction).

## How to re-verify quickly (Linux)

```bash
export JARVIS_OWNER_TOKEN=$(agent-browser cookies … )   # or re-enroll a fresh DB
bash scripts/verify-track-b.sh                          # deterministic gates
bun run scripts/auth-probe.ts phase1 && … phase2        # AUTH (phase2 needs a restart between)
bash scripts/durable-suite.sh                           # DUR with real fault+restarts
bun run scripts/atomic-probe.ts unit && … can01 … eff01 # atomic/cancel
```

## Open work (prioritized, honest)

1. Windows-native milestone on the owner's machine (WIN-01…14; reference suite in `/home/z/track-b-review/`, never claimed as done here).
2. VER-03/04/05 clean live passes (blocked only by the upstream 429 window; deterministic equivalents already PASS).
3. Phases 07/08: provider gateway + BYOK (two call-site seam), LAYA advisory with deterministic fallback, memory/world model.
4. Phases 09/11/12/13/14 per STAGE_LEDGER.json — nothing there is claimed.

## Session artifacts worth preserving

- Real defect reproductions: `evidence/00_BASELINE_REPORT.md` (anonymous task creation, anonymous cancel, cross-origin state change — all since closed).
- Raw gate transcripts: `evidence/*_raw.txt` (AUTH/DURABLE/VER/UI/FULL_DETERMINISTIC_GATE/VERIFY_GATE_LEDGER).
- UI contract screenshots: `UI01_orb_contract.png`, `UI10_text_mode_controls.png`.
- Track B candidate review (isolated): `/home/z/track-b-review/REVIEW_REPORT.md`.
