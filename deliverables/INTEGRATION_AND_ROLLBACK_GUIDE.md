# JARVIS V1 TRACK B — INTEGRATION AND ROLLBACK GUIDE

## What changed this session (git commits)

| Commit | Phase | Contents |
|---|---|---|
| `4e29124` | 01 | Identity/session/ownership: `Principal`/`Session` models, opaque hashed-token sessions, first-run owner bootstrap, device pairing (PENDING→ACTIVE→REVOKED), route guards (401/403/404 semantics), same-origin CSRF defense, `AgentTask.ownerId/sessionId/createdByDeviceId/version/planRevision`; legacy rows quarantined (ownerId=null). |
| `7bd6ce5` | 02 | Explicit 13-state machine with CAS transitions + version bumps; `EffectRecord` admission table (unique `taskId+effectKey`); journal-before-effect; honest settlement (write failure ⇒ `effect_unknown`, never broadcast success); startup crash reconciliation; owner-scoped status route. |
| `31ed926` | 03+04 | Completion arbitration (`verifier.ts`: deterministic predicates, folder-context candidates, VERIFIED/PARTIAL/FAILED/EFFECT_UNKNOWN); conversational finals refused when create-intent is unsatisfied; child-process registry + real SIGTERM→SIGKILL cancellation; pre-admission STOP gate; lease-conflict messaging; `sleep` (bounded, numeric) added to Guardian allowlist; `cancel_requested` reconciliation. |
| final | 05/10/docs | Orb Mode = orb + one bottom switch (UI contract), controls moved to Text Mode; AGENTS.md; §19 harness; full §22 evidence set + deliverables. |

Hashes of every patched file: `deliverables/PATCHSET_AND_SOURCE_MANIFEST.json`.

## Integration invariants (do not regress)

1. **No route without auth.** Every `/api/jarvis/**` handler starts with
   `requireActiveSession` (+ `requireOwnedTask` for task-scoped data).
2. **No effect without admission.** Effectful executor calls happen only
   after `admitEffect` succeeds; admission failure ⇒ fail-closed stop.
3. **No success without settlement.** Terminal transitions go through
   `transitionTask`; write failures surface `effect_unknown`/durable
   conflict — never "completed".
4. **No completion without predicates.** Model `final` is a proposal;
   `arbitrateCompletion` decides from disk + the effect table.
5. **No STOP without teeth.** `requestCancel` flips the flag AND kills
   in-flight children; new admissions are blocked; the stop is durable
   (`cancel_requested`) and survives restarts.
6. **Guardian untouched in spirit:** allowlist-only, fail-closed,
   audit-or-deny. The only allowlist addition is the bounded `sleep`
   (numeric-only, 1–2 digits, single arg) required for CAN-02, with
   positive+negative gate probes.

## Rollback procedure

```bash
git log --oneline                 # pick the phase commit to return to
git revert <commit>               # never reset --hard; history is evidence
bun run db:push                   # schema is additive; legacy rows survive
bash scripts/verify-track-b.sh    # re-run the deterministic gates
```

Known migration notes: legacy tasks (pre-identity) keep `ownerId=null` and
are quarantined history by design — do NOT backfill an owner. Sessions
expire after 12h; re-enrollment is by owner pairing only.
