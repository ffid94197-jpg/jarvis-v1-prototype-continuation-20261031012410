# JARVIS V1 TRACK B — WINDOWS BUILD AND INSTALL GUIDE

**Honest status:** the current runtime is a **Linux development/testing
build**. A genuine Windows-native package is **NOT delivered** — the
environment blocker and the honest path are documented in
`evidence/WINDOWS_NATIVE_SECURITY.md`. This guide records (a) how to run
the current build on Linux/macOS, and (b) the concrete, evidence-backed
route to the Windows-native package on the owner's machine.

## A. Running the current (Linux) development build

Requirements: Bun ≥ 1.3 (or Node 20+), any POSIX OS.

```bash
bun install
# .env at the repo root:
#   DATABASE_URL=file:/ABSOLUTE/PATH/TO/db/custom.db
bun run db:push          # first run only (or reuse the included evidence DB)
bash scripts/verify-track-b.sh   # §19 gate harness — must read PASS
bun run dev               # http://localhost:3000
```

First visitor enrolls as OWNER (one-time bootstrap); later browsers pair as
PENDING devices and require owner approval (`POST /api/jarvis/auth/devices`,
`{principalId, action:"approve"}` — owner session required). No shipped
development credentials; the included `db/custom.db` contains only
acceptance-test evidence rows.

## B. Windows-native package (the actual release target) — not yet built

1. **Host:** Windows 11 (owner hardware: i7-13700HX / RTX 5060 / 16 GB).
2. **Supervisor:** port the portable supervisor contract (task route +
   Core loop: process creation, lifecycle, bounded resources, cancellation
   — all Linux-proven in CAN-01…05) to a native Windows host process.
   Reference materials (reviewed in isolation, S0-2):
   `supplemental_phase6/root_020` real LPAC probe suite (attested
   AppContainer SIDs, Job-object membership, timeout termination) and the
   `rlm_broker.py` isolation pattern. Do not copy unreviewed code.
3. **Isolation:** LPAC/AppContainer profile, restricted identity, Job
   Objects, deny-by-default resource access, authenticated IPC, explicit
   handle-inheritance policy, runtime integrity verification, crash cleanup
   (§9.3 checklist — all currently BLOCKED items become executable there).
4. **Model provider:** the runtime is model-agnostic except two call sites
   (`src/lib/agent/core/loop.ts` ~L110 planner, ~L136 report); wire any
   OpenAI-compatible provider with BYOK keys kept out of logs and bundles.
5. **Certification:** run `WIN-01 … WIN-14` verbatim on the Windows host;
   only native evidence may flip Checkpoint 6 from BLOCKED.

## C. Update / rollback / uninstall (current build)

- Update: `git pull` → `bun install` → `bun run db:push` (additive
  migrations only; evidence rows preserved) → restart.
- Rollback: git revert to the recorded phase commits
  (`PATCHSET_AND_SOURCE_MANIFEST.json`); the DB schema is backward
  compatible with legacy rows (ownerId-null quarantined history).
- Uninstall: stop the server; the workspace is self-contained
  (delete the project folder; `agent-workspace/` holds only JARVIS-created
  artifacts).
