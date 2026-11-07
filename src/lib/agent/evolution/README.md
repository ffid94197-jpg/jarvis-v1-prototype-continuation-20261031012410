# JARVIS Native Evolution — Skill Forge / Crucible / Repair Vault

**Status: original source implementation, not live-accepted.**
This work belongs to the secondary **JARVIS Prototype** repository only.
It does NOT change the original PC Work JARVIS.

## Provenance and source-license boundary

This is a JARVIS-native implementation of ideas seen in the November 2026
Brahma AI demonstrations. The Brahma Evo/Echo implementations themselves
are **NOT** copied, vendored, translated, mirrored, imported or redistributed.

- [Brahma AI Evo](https://github.com/liveatul/brahma-ai-evo): Source-available personal/private-local-use license. No redistribution/derivative publication. Inspiration only.
- [Brahma Echo](https://github.com/spatialsage/Brahma-Echo): Custom source-available license. Inspiration only.
- [Original Brahma AI](https://github.com/titechprabhasolutions/Brahma-AI): MIT-licensed earlier desktop assistant. Reviewed as a compatible reference; **no original Brahma AI code is included in this integration**.

Our code in this directory was newly written for the existing JARVIS
Core / Guardian / Next.js architecture.

## What is actually built

### Skill Forge — \`skillForge.mjs\`

1. The existing JARVIS model may propose a **declarative** recipe (max 8 existing JARVIS tool stages). No Python, JS, eval, shell, external agents or package installation can be embedded as executable skills.
2. \`crucible.mjs\` performs deterministic, non-executing static checks: allowed tools, basic arguments, placeholders, bounded shapes and risk classification.
3. The recipe is staged as owner-scoped data. It does not run.
4. Only an authenticated OWNER can approve/disable from the same-origin Settings interface or the owner API.
5. \`evolution_skill_expand\` hot-loads an approved recipe and resolves bounded \`{{input}}\` placeholders, returning an **advisory** list of exact JARVIS tool calls. Every subsequent call goes back to the **original** Core -> Guardian -> effect journal -> executor pipeline. The registry grants no permission.

The Crucible is static and **not** an isolated runtime test of arbitrary code. That distinction is intentional: generated executable programs are not accepted into the skill registry in the first place.

### Repair Vault — \`repairVault.mjs\`

1. The existing Core can read a file inside \`JARVIS_AGENT_WORKSPACE\`, observe the entire content SHA-256 and propose one precise edit using \`evolution_repair_stage\`.
2. The vault checks exact SHA, one unique old-text occurrence, allowed scope, non-symlink regular files, UTF-8 and bounded sizes (64 KiB file, 4 KiB replacement spans). Hidden paths, dependencies, core Guardian/auth, evolution implementation, API routes and deployment configuration are immune to this automatic-repair proposal mechanism.
3. The candidate is **staged**, not applied. The owner reviews the old/new text and must separately approve.
4. A second explicit owner action **applies** the approved repair, after saving an owner-private original file and durably marking the operation as \`applying\` **before touching the target**.
5. Exact readback determines \`applied\`; ambiguity becomes \`effect_unknown\`.
6. Explicit rollback restores **only if** the current file SHA matches the applied candidate SHA, or recognizes the file was already restored. If another editor changed it, rollback refuses to overwrite.
7. \`inspectRecovery\` provides a read-only boot-sentry report of \`applying\`, \`rolling_back\` and \`effect_unknown\` records. It never silently retries an uncertain patch.

This is a safe repair candidate and rollback feature, **not** unrestricted autonomous patching of the JARVIS security core. It does not currently auto-synthesize a patch for every runtime crash, run arbitrary generated code, or certify deployment.

## Skill learning from completed JARVIS tasks

`evolution_skill_learn` can stage a new reusable recipe from a **previous,
Core-completed task** whose durable trace belongs to the same authenticated
owner. The owner may specify a real completed task UUID, or allow JARVIS to
select the most recent completed owned task. The feature is also available
from **Settings → Agent Skills & Integrations → Learn from a completed task**
and the owner-only `learn_skill` API action.

The learner enforces:

- Only complete traces of 1–8 explicitly supported tool calls are accepted:
  `read_file`, `list_dir`, `create_folder`,
  `windows_discover_apps`, `windows_find_capability`. It rejects GUI clicks,
  Minecraft effects, shell commands, credentialed calls, file writes, and
  all other potentially sensitive action types.
- Each source call must have **one matching successful result** in the original
  durable Core step journal. Truncated/invalid JSON, unverified readbacks,
  denied/error steps, foreign-owner history and partial tasks are refused.
- Every learned folder creation must also match an independently durable,
  successfully settled `EffectRecord` with the exact folder path and live
  `isDirectory` receipt.
- The learner copies **tool names and bounded prepared input arguments only**.
  It does not copy prior file contents, output text, API keys, model prompts,
  screenshots or arbitrary code.
- Learning stages a **new candidate**, not an approved action. The owner must
  inspect its actual steps and explicitly approve it before Core execution.
  Future runs are freshly Guardian-audited and may still fail if the outside
  world or owner policy changed.

The optional mock-receipt fixture is
`npm run test:evolution-learn-offline` (authored, **not run here**).
It is not evidence of real Windows field success or independent acceptance.

## Core-executed approved skill (source extension)

A saved and **owner-approved** skill is now executable through the **same** JARVIS
Core loop. The UI offers **RUN APPROVED SKILL IN JARVIS** alongside the separate
**PREVIEW PLAN** action.

- The UI's explicit run command is deterministically routed by
  `src/lib/agent/core/skillIntent.ts`. It does not need a new model call
  or provider quota just to run a known recipe.
- The model can also select `evolution_skill_run` for an owner's open-ended
  request. `evolution_skill_expand` remains **preview only** and never starts
  an action.
- `approvedSkillQueue.ts` binds the expansion to the owner's approved skill
  ID and SHA-256 manifest digest, refuses nested skill recursion, validates
  the tool allowlist and creates at most eight process-local stages.
- `core/loop.ts` takes one stage at a time. **Every stage** executes through
  the unchanged Guardian audit -> durable effect admission -> cancellation
  check -> actual executor -> settlement -> final independent arbitration.
- Before each stage, Core re-reads the original owner registry to ensure
  that approval is still active and its digest has not changed. Revocation
  stops the remaining stages; there is no permission inheritance.
- A denied tool, failed effect, uncertain journal, unverified GUI mutation or
  duplicate/reconciled effect stops the remaining queue; Core cannot claim
  a fully completed skill if a stage was halted.
- The owner autonomy-tier step budget includes expansion and every staged
  tool. A run refuses to start if its maximum bounded stages will not fit.
- A process-local queue is **not** replayed blindly after crash/pause. The
  durable Core effect journal remains the source of truth; external effects
  must be reconciled before a fresh owner-approved run.
- The normal JARVIS Core does not become a new separate agent, and no
  generated Python, JS, shell or third-party runtime is executed.

The optional local-only fixture `npm run test:evolution-core-offline`
parses changed TypeScript and checks deterministic intent and bounded
receipt acceptance. It is **not** a live runtime or Windows field acceptance.

## Owner controls

**Existing UI:** Settings → Agent Skills & Integrations → Native Skill Forge & Repair Vault.

**Owner API:** \`GET /api/jarvis/evolution\` lists owner-scoped skill/repair summaries and read-only recovery state. \`POST /api/jarvis/evolution\` accepts:

- \`stage_skill\` (\`manifest\`), \`skill_details\` (\`id\`), \`approve_skill\` (\`id\`), \`disable_skill\` (\`id\`), \`expand_skill\` (\`id\`, optional \`inputs\`).
- \`stage_repair\` (\`candidate\`), \`repair_details\` (\`id\`), \`approve_repair\` (\`id\`), \`apply_repair\` (\`id\`), \`rollback_repair\` (\`id\`).

All API endpoints derive the owner from the active authenticated JARVIS session and require the OWNER role. Mutations use the existing same-origin policy **and** a separate mandatory Guardian audit through the trusted `evolution_owner_control` gate; if audit storage is unavailable, no mutation occurs. Model tool calls cannot assert the trusted owner-control flag, approve, apply or roll back a patch.

**Model-facing tools:** \`evolution_skill_stage\`, \`evolution_skill_list\`,
\`evolution_skill_expand\`, \`evolution_repair_stage\`, \`evolution_repair_list\`. All pass through JARVIS Guardian and durable audit; staging writes also use the Core effect journal. No backdoor executable skill runner exists.

## Configuration and deployment

The owner-private vault defaults to \`data/jarvis-evolution\` inside the deployment. It can be changed by the trusted server operator using \`JARVIS_EVOLUTION_ROOT\`. The repair workspace is exactly the already configured \`JARVIS_AGENT_WORKSPACE\` (default \`agent-workspace\`), never a path supplied by the model to widen permissions.

Registry/backup directories are created with owner-only filesystem mode requests and atomic JSON replacement. Cross-process lock files fail closed rather than steal a busy writer's lock. Exact scope, ACL permissions, host rollback semantics, multi-process crashes and production security require final integration acceptance on the owner's real Windows system. Do not depend on this prototype alone as a security boundary.

## Local contract

\`npm run test:evolution-native\` executes only a disposable local workspace fixture. It checks stage/approve/expand, Crucible validation, source SHA pinning, patch apply/rollback and traversal rejection, without running arbitrary code or GitHub Actions.

This command is **provided but has not been executed here**. Full TypeScript/Next.js build, real Windows tests, live error-driven repair behavior and independent security acceptance are still not certified. Do not report them as complete.

## Autonomous self-evolution continuation (2026-11-06)

The prototype now adds a first native, bounded diagnosis → repair → verification
path on top of Skill Forge and Repair Vault.

### Self-diagnosis

- **evolution_diagnose** reads only the authenticated owner's durable task, step,
  effect and Guardian audit records.
- Core automatically injects one read-only diagnosis after the first failed tool
  action in a task, without spending another model/provider call. The planner can
  also invoke the same read-only tool explicitly.
- It classifies observed signals such as provider quota/auth/network faults,
  Guardian denials, planner/syntax errors, runtime type failures, missing
  resources and unsettled effects.
- It returns bounded task references, categories, recurrence counts and
  recommended next actions. It does **not** return raw objectives, tool
  arguments, file contents, provider payloads or credentials.
- A classification is not proof of a source-level root cause. Code repair
  still requires a fresh source inspection and exact SHA-bound patch.

### Continuous bounded learning

After a task is durably settled as **completed**, Core checks whether its trace
contains 1–8 fully paired successful receipts from the existing safe learning
allowlist (read_file, list_dir, create_folder, app discovery and
capability discovery). Eligible traces are passed through the existing
learnFromCompletedTask and Forge/Crucible pipeline.

- The learning action is admitted through the durable effect journal before
  the registry write.
- The learned candidate stores same-owner source task provenance, allowing
  crash reconciliation without blindly replaying the learning operation.
- Learning only stages a declarative skill. It never approves or runs it.
- Failed, partial, denied, effect-uncertain, oversized or unsupported traces
  are not learned.

### Measured self-improvement

- Core records terminal task outcome metrics from the durable owner-scoped task,
  step and effect journals. It does not trust model-reported scores.
- The performance ledger stores only a normalized objective SHA-256, task ID,
  optional approved skill ID, terminal status, tool-step count, elapsed time,
  failure count, uncertain-effect count and verification result. Raw objectives,
  prompts, tool arguments, file contents and credentials are not stored.
- Approved-skill runs are attributed only when the durable skill expansion
  receipt and every expected queued stage receipt match the same skill ID.
- The evaluator compares at least three baseline runs (without a skill) against
  at least three candidate runs (with the same approved skill) for the same
  normalized owner objective. It compares verified success rate, median tool
  steps, median elapsed time and uncertain-effect rate.
- A candidate is marked improved only when it improves verified success rate
  or achieves at least a 10% reduction in median steps or elapsed time without
  lowering success rate or increasing uncertain effects. Regressions and
  insufficient evidence are reported explicitly.
- Evaluation never approves, disables, executes or edits a skill. Owner and
  Guardian controls remain authoritative. The owner-only evolution GET endpoint
  exposes the privacy-minimized performance summary.
- Run `npm run test:self-improvement-offline` for the disposable baseline vs
  candidate contract.

### Bounded autonomous code repair

Automatic repair remains **OFF by default**. A trusted server operator must
explicitly set:

**JARVIS_SELF_REPAIR_AUTO_APPLY=1**

When enabled, Core may call **evolution_repair_apply** for a staged repair, subject to
all of these limits:

- The target remains inside JARVIS_AGENT_WORKSPACE; paths are relative,
  bounded UTF-8 regular files with no symlink escape.
- To repair project source, the trusted operator must configure
  JARVIS_AGENT_WORKSPACE to a dedicated working checkout that JARVIS is
  authorized to edit. The vault cannot reach outside that root; do not point it
  at the original production PC Work checkout without a deliberate owner decision.
- Guardian/auth/evolution/API, tool executor, Windows execution bridge,
  Core loop, effect journal, task state, verifier, autonomy policy, database,
  credentials, security infrastructure and other protected control-plane
  files are immune to self-patching.
- The patch must match the full current SHA-256 and exactly one old-text span.
- In bounded-auto mode, the candidate must carry a current repairable diagnosis
  pattern ID from the same active Core task. Executor rechecks that owner-scoped
  failure signal and task reference immediately before applying the patch.
- At most one automatic repair may be applied in a Core task.
- A static syntax preflight must pass before the write. The write is journaled
  before effect, backed up, atomically replaced and checked by exact readback.
- A post-apply static syntax check must pass. Syntax failure triggers rollback
  only while the target still exactly matches the candidate SHA. If another
  writer changed it, rollback refuses to overwrite that change.
- Crash recovery reconciles the repair ledger; ambiguous outcomes remain
  effect_unknown and are never blindly retried.

The TypeScript parser is a production dependency (not dev-only), because the bounded repair verifier runs inside the deployed server as well as during development. The offline contract asserts that this parser is present before testing repair.

Validate the production dependency set with `npm ci --omit=dev` followed by `npm run test:self-evolution-offline`; use a normal `npm ci` for the full development typecheck and build.

The current verifier parses JSON and JavaScript/TypeScript syntax only. It does
**not** execute the patched program, run the project's unit tests, perform a
full TypeScript typecheck, build Next.js/Fabric, or certify Windows runtime
behaviour. Those remain separate acceptance gates. The normal owner API
approval/apply/rollback path remains available when automatic repair is off.

### Interfaces and local contract

- GET /api/jarvis/evolution now includes owner-scoped runtime diagnostics and
  the active repair policy summary.
- Owner-only POST actions include verify_repair; apply_repair performs
  static syntax verification after a successful write and reports rollback
  when syntax validation fails.
- Model-facing evolution_diagnose is read-only. Model-facing
  evolution_repair_apply is denied unless the trusted server flag is enabled.
- Run npm run test:self-evolution-offline for the disposable offline contract.

This is a bounded self-evolution implementation, not unrestricted autonomous
modification of JARVIS itself. Full repository build, full test suites,
Windows field verification and independent security acceptance are still
required before calling the subsystem production-complete.
