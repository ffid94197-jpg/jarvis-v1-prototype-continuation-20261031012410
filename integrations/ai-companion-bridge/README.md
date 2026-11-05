# JARVIS PlayerEngine bridge — developer integration candidate

**Status: source implementation, NOT deployed, compiled, or independently accepted.**
This is part of Prototype JARVIS, **not** the original Windows-native PC Work JARVIS.
Do not enable this instead of the existing Mineflayer/MCP bot until the acceptance gates below pass.

## Scope after code integration (5 Nov 2026)

This opt-in branch now includes an actual source-level Core-to-Fabric path:

- Core and Guardian audit -> native executor -> HMAC loopback service -> AltoClef task -> real server observations.
- **Supported native operations:** inspect/status, collect (including mixed tree logs), typed craft-item acquisition, travel up to 160 blocks, equip armor/tools, dig selected loaded blocks, place one allow-listed block, fight one nearby allow-listed hostile, owner-wide emergency stop, task-scoped cancel, explicit resume of an emergency-stop latch. Unsupported actions are rejected.
- Native JARVIS-controlled sessions disable upstream chat-brain packet delivery, upstream independent LLM requests, and idle command planning.
- Signed requests carry the actual Guardian audit-record UUID and original Core task UUID; signed responses echo both. Server validates owner, companion identity, world allow-list, deadline and task-binding.
- Per-task receipts expose real main-hand, exact four armor slots, inventory, health, hunger, coordinates, nearby loaded blocks and visible mobs.
- Local contract test entry: `npm run test:minecraft-playerengine-ipc`. **The test scripts have been authored but not run here.**
- Owner cancellation via the existing task cancellation API now sends a scoped, audited native stop request when there is a recorded Minecraft effect.

**Still not a fully built/released prototype:** This branch has not passed Java/Gradle compilation, Next.js TypeScript typechecking, the new local contract tests, security acceptance, the complete 200k Internet prompt evaluation, or Minecraft Java playthrough. Full Netherite, Dragon, broad arbitrary gameplay, and independent final acceptance are not demonstrated. A development commit is not proof of those milestones.

## Architecture and code

- Pinned AI Companion upstream: \`adevivo/ai-companion@6bb1df1a06258ca712b66f1404dd05204f25b9c7\`, LGPL-3.0; PlayerEngine / AltoClef / Automatone.
- \`guardian-ipc-client.cjs\`: local authenticated JARVIS request/receipt client.
- \`overlay/.../JarvisBridgeServer.java\`: bound local server-side adapter for Minecraft Fabric 1.20.1.
- \`apply-overlay.cjs\`: exact-commit source seam patch, respects a dirty submodule and refuses unfamiliar upstream edits.
- \`Build-JarvisCompanion.ps1\`: JDK 17 build on the owner's Windows machine, **no GitHub Actions**.

The Java overlay selects a loaded, alive, owner-bound \`CompanionEntity\`, and delegates gather/mine/craft to \`TaskCatalogue.getItemTask\` and travel to \`GetToBlockTask\`. Inspect/status return live main-inventory, armor, position and health observations. A dispatched task never becomes a Core-verified success merely because \`runUserTask\` returned or its callback fired.

**Implemented as opt-in source:** `src/lib/agent/windows/playerEngineBridge.ts` is now called from the existing Core/Guardian executor when `JARVIS_MC_BACKEND=playerengine` is explicitly set. The Core's server-derived owner principal is passed into the adapter. It supports readback, joined-companion check, bounded oak-log acquisition, craft-item acquisition (without claiming method-of-crafting proof), travel, and cancellation of its tracked native task. Unsupported operations fail closed; **there is no mixed Mineflayer fallback in this opt-in mode**.

**Still not implemented or accepted:** cross-process durable replay history across Fabric restart, full general-purpose gameplay including long-horizon Netherite and Dragon proof, multi-block creative construction, complete crafting-method evidence, all-version portability, live gameplay acceptance, full 200,000 Internet prompt evaluation, final independent Windows acceptance. The real Guardian audit UUID is now carried end-to-end, but independent authority/security testing remains mandatory.

## Enable only for isolated LAN development

1. Clone/restore this prototype on Windows, then \`git submodule update --init integrations/ai-companion\`.
2. Ensure **JDK 17** and Java 1.20.1 Fabric/Quilt-compatible game/runtime.
3. From this directory, run \`.\Build-JarvisCompanion.ps1\` (the script does not start the game).
4. Review the source overlay and configure **matching** environment variables for the Java game process and JARVIS client. Store the shared secret outside version control:

   \`JARVIS_MC_BRIDGE_ENABLE=1\` — enables Java service and disables companion chat/queued conversation brain inside patched engine.
   
   \`JARVIS_MC_BRIDGE_SECRET=<unique random secret of at least 32 UTF-8 bytes>\` — never log or commit.

   \`JARVIS_MC_BRIDGE_WORLD=minecraft:overworld\` — exact target-dimension allowlist. No wildcards.

   \`JARVIS_MC_BRIDGE_PORT=48251\` — bound to **127.0.0.1** only. Java and Node run on the same machine.

5. Set `JARVIS_MC_BACKEND=playerengine` in the JARVIS Core process to opt in. Set `JARVIS_MC_BRIDGE_OWNER_PRINCIPAL` to the exact authenticated JARVIS Core principal, and `JARVIS_MC_BRIDGE_OWNER_UUID`/`JARVIS_MC_BRIDGE_COMPANION_UUID` to actual Minecraft UUIDs. Keep the existing Windows companion safety preconditions enabled.
6. Spawn a companion owned by the **actual** online owner player and obtain the real Minecraft UUIDs from an authenticated game session; never infer a user UUID from a username.
7. The JARVIS Core must first authorize and **durably audit** the real owner task through Guardian. The client call must receive that authorization, same task and world binding, a fresh idempotency key, an explicit operation budget, and exact live companion identity. No model text may directly produce an approved Guardian object.
8. Observe and reconcile the real world state before another effect. Never blindly retry after a timeout or unknown response. Explicit cancel/stop requires a separately Guardian-approved signed request; closing the socket is NOT task cancellation.

## Request contract

Version \`1\`: an HMAC-SHA256 authenticated newline-delimited JSON object of \`{body, mac}\`, using canonical JSON serialization for the signed body. Request body contains \`taskId\` (UUID), \`idempotencyKey\` (UUID), \`nonce\` (32 hex chars), \`issuedAt\` (epoch milliseconds), \`operation\`, \`worldId\`, \`arguments\`, \`guardian\`, \`budgetMs\`. \`arguments\` includes \`ownerUuid\` and \`companionUuid\`; gather/mine/craft add \`item\` and \`count\`, travel adds integer \`x,y,z\`.

The Java service uses a server-thread ownership/world check, nonces and task IDs to reject replays/duplicates, one active task per companion, a 30-second maximum task budget, and an in-memory deadline watchdog. Receipt is separately HMAC-authenticated with matching UUIDs, nonce, world, state and live observations. **Neither a signed receipt nor the engine's callback alone proves the objective.**

## Mandatory acceptance before promotion

- Compile JDK 17 \`engine\` and \`aicompanion\` overlays, with exact staged PlayerEngine 1.1.19 dependency, validate compatible Fabric 1.20.1 Minecraft.
- Offline protocol tests: malformed/oversized frame, wrong/stale MAC/nonce, unauthorized/replayed approval, wrong owner/world, deadline timeout, cancellation, disconnect, source compatibility.
- Security: independent LLM disabled for controlled session, audit provenance, reproducible Guardian proof, revocation/E-stop, scoped listener, bounded resource use, re-entrancy protection, long-run idempotency and durable recovery.
- End-to-end: actual Core plan -> Guardian-approved receipt -> Java adapter -> real AltoClef/world mutation -> **new** server observation -> independent Core postcondition verification.
- Minecraft game acceptance: Ender Dragon death + End return and full equipped Netherite armor, with fresh game proof, not simulated callbacks.
- Broader original six prototype autonomy acceptance milestones, real Windows run and prompt-corpus evaluation.

This prototype is **not 100% built or 100% verified**. This module may not be used to assert full JARVIS or Minecraft completion.
