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

## Owner controls

**Existing UI:** Settings → Agent Skills & Integrations → Native Skill Forge & Repair Vault.

**Owner API:** \`GET /api/jarvis/evolution\` lists owner-scoped skill/repair summaries and read-only recovery state. \`POST /api/jarvis/evolution\` accepts:

- \`stage_skill\` (\`manifest\`), \`skill_details\` (\`id\`), \`approve_skill\` (\`id\`), \`disable_skill\` (\`id\`), \`expand_skill\` (\`id\`, optional \`inputs\`).
- \`stage_repair\` (\`candidate\`), \`repair_details\` (\`id\`), \`approve_repair\` (\`id\`), \`apply_repair\` (\`id\`), \`rollback_repair\` (\`id\`).

All API endpoints derive the owner from the active authenticated JARVIS session and require the OWNER role. Mutations use the existing same-origin policy. Model tool calls cannot approve, apply or roll back a patch.

**Model-facing tools:** \`evolution_skill_stage\`, \`evolution_skill_list\`,
\`evolution_skill_expand\`, \`evolution_repair_stage\`, \`evolution_repair_list\`. All pass through JARVIS Guardian and durable audit; staging writes also use the Core effect journal. No backdoor executable skill runner exists.

## Configuration and deployment

The owner-private vault defaults to \`data/jarvis-evolution\` inside the deployment. It can be changed by the trusted server operator using \`JARVIS_EVOLUTION_ROOT\`. The repair workspace is exactly the already configured \`JARVIS_AGENT_WORKSPACE\` (default \`agent-workspace\`), never a path supplied by the model to widen permissions.

Registry/backup directories are created with owner-only filesystem mode requests and atomic JSON replacement. Cross-process lock files fail closed rather than steal a busy writer's lock. Exact scope, ACL permissions, host rollback semantics, multi-process crashes and production security require final integration acceptance on the owner's real Windows system. Do not depend on this prototype alone as a security boundary.

## Local contract

\`npm run test:evolution-native\` executes only a disposable local workspace fixture. It checks stage/approve/expand, Crucible validation, source SHA pinning, patch apply/rollback and traversal rejection, without running arbitrary code or GitHub Actions.

This command is **provided but has not been executed here**. Full TypeScript/Next.js build, real Windows tests, live error-driven repair behavior and independent security acceptance are still not certified. Do not report them as complete.
