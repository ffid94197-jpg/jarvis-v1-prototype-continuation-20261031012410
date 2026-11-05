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

## Source extension: sequence, container and observation bridges

Additional prototype source now includes:

- Native sequence stages `tools`, `stone_age`, `iron_age` and owner-bounded linear `build` (up to eight physically checked adjacent placement targets per stage), aligned with the existing Guardian `x+`/`x-`/`z+`/`z-` construction axis contract.
- Local `JarvisNativeInventoryTransfer.java` for an exact quantity of one named vanilla item in a nearby loaded chest/barrel. The Java server journals the task before the effect, checks both inventories and reports a same-task `missionStatus` including `transferDone`. Both `auto_goal transfer` and the direct `transfer_container` primitive are wired at the Core adapter, but method correctness has not been field-tested.
- Owner-bound native read-only `inspect_villager` (up to eight real trade offers, no trading) and `inspect_block` (loaded-world block identifier, open/powered state where present).
- Native `interact_block` for observed doors, trapdoors, levers and buttons, reporting an actual changed state before success; it does not pretend to prove chest/container transactions from a click alone.
- Correct `operationDirection` from Guardian-prepared Minecraft transfer goals, default bounded mission durations, Core-native auto-status matching of the original goal and task, and retention of settled mission identity until final evidence readback.
- A corrected reference to the actually declared durable native journal within the Fabric bridge.

**Remaining build-only limitations:** unimplemented native villager purchase transactions, enchanting, multi-operation advanced container and world interactions, broad generic construction beyond bounded primitives, hardening of all long-horizon edge cases, and remaining general-purpose Windows/AI autonomy coverage. Also, this code has NOT been compiled or field-accepted. GitHub Actions have not been used in this pass.

## One-instruction explicit owner companion spawn and pairing

The opt-in PlayerEngine integration supports an original
\`minecraft_companion_spawn\` **Core-owned** tool for explicit natural-language
requests such as **"Spawn my Minecraft companion"** or **"Summon JarvisBuddy in
Minecraft"**. Ordinary "play Minecraft" still **joins only** and NEVER spawns
another entity. This is not a new autonomous agent or a Creative-mode summon.

Deployment requires the existing strict JARVIS_MC_BRIDGE_* secret, owner
principal, owner UUID, companion UUID and world allowlist settings **plus**
\`JARVIS_MC_BRIDGE_SPAWN_ENABLED=1\` on **both** the Node JARVIS process and
the pinned Fabric game-server process.

- Core's exact imperative owner-intent parser produces the standalone spawn
  action. Model-selected spawn calls are rejected by Guardian unless Core has
  supplied its trusted intent flag. No tool argument can override the owner,
  entity identity, spawn position, or entity type.
- The server requires that the original owner is online and alive in the
  Overworld, that the exact preconfigured companion UUID is unused, that the
  owner has no other loaded companion, and that a **safe, already-loaded
  adjacent block** has a solid floor. It never generates terrain for a spawn.
- The server's persistent native journal is checked for **any prior spawn
  history** of the configured companion UUID. This prevents duplicate entities
  when an older companion is saved in an unloaded chunk after a restart.
- Journal admission is durable **BEFORE** the world mutation. The companion
  is instantiated from the pinned upstream \`AiCompanion.COMPANION\` type,
  assigned the already configured UUID **before** spawning, receives the
  mod's normal default roster entry and its actual owner-bound
  \`AltoClefController\` (without an independent LLM in JARVIS mode).
- The returned signed server observation contains the original owner UUID,
  companion UUID, owner-paired controller status, Overworld dimension and
  real inventory/health. Core accepts spawn completion **only** if those
  fields match the original Guardian-authorized, exact configured identities.
- A lost reply, uncertain journal, duplicate UUID, unloaded old companion,
  absent owner or missing opt-in **never authorizes an automatic retry**.
  Existing owned companions can be attached through ordinary read-only JOIN
  after the real game state has been reconciled.

Limits: this does not automatically recover an unloaded prior companion,
despawn one, reset the server's owner roster, defeat the Dragon or guarantee
general-purpose gameplay. No real Windows/Fabric acceptance has yet run.

## Owner-assisted real vanilla enchanting (not independent bot XP)

The pinned \`CompanionEntity\` does not own an autonomous vanilla
experience-level system. The original JARVIS extension therefore supports a
narrow, **owner-assisted** vanilla enchantment, NOT free enchanted items or
a claim that the bot has learned independent XP collection.

The user must explicitly say something like:
**"Jarvis, enchant my diamond sword at the observed table using the first
option; use my XP."**
The chosen item, first/second/third option and the observed real
\`enchanting_table\` position must all match the owner's words and the latest
game-server scene. A named *owner* intent never authorizes unrelated XP spending.

Deployment requires **both** trusted server processes to opt in with
\`JARVIS_MC_BRIDGE_OWNER_XP_ENCHANT_ENABLE=1\`. Guardian also requires a
separate Core-bound \`coreOwnerXpConsent\` flag derived from the original
owner task; the model cannot invent this flag or mint the original audit.

On the server thread, the actual online survival-mode owner and companion
must stand near the **same loaded enchanting table**. The companion must
hold exactly one unenchanted item of the requested kind and sufficient real
lapis. A vanilla \`EnchantmentScreenHandler\` calculates actual bookshelf-
and enchantment-seed-sensitive options, spends the owner's genuine XP and
the handler's lapis, and produces the real enchanted output. The adapter
debits the companion's corresponding actual lapis and swaps in the output.
It never directly installs an enchantment or supplies a synthetic resource.

The native journal writes ADMITTED **before** the vanilla button action.
The signed observation includes actual XP-level delta, lapis delta,
enchanted-item identity and enchantment count; the JARVIS Core validates
those physical postconditions and admits a completion claim only after
an OBSERVED settlement. If receipt or server accounting is uncertain,
there is no automatic retry. Owner consultation and reconciliation are
required to avoid double-spending XP or duplicating an item.

**Limits:** owner XP is a deliberate resource cost; this feature does not
enable the companion to earn/use its own XP autonomously. Full vanilla
interactive enchanting GUI acceptance, inventory handling and Fabric
compilation remain outstanding and cannot be claimed from source alone.

## Owner-authorized native villager trading

The opt-in PlayerEngine backend implements a bounded **real trade** transaction
for a freshly observed villager (at most eight inspectable offers, one to four
purchases, at most 4.5 blocks from the companion). A model cannot choose a
trade: the **owner must explicitly request the offer number and villager**,
and the Minecraft AI gate and Guardian independently reject invented IDs.

1. The JARVIS client asks the game server for the live villager's **adjusted**
   first price, secondary price, output item/count, uses, max uses and disabled
   state; that signed observation is the source of expected values.
2. The server rechecks the EXACT inspected offer and adjusted price on the
   server thread, rejecting restocks or price changes. It preflights the
   companion's entire finite inventory and product capacity for all purchases,
   preserving enchanted/NBT output item stacks.
3. The native journal records ADMITTED before any currency is spent. The
   helper spends actual inventory, delivers the villager's actual offer output
   and invokes \`VillagerEntity.trade(offer)\` for each real merchant transaction.
4. The server checks full slot readback, exact input/output counts and
   villager offer use-counter increments. Only after a durable OBSERVED journal
   write is the signed trade receipt marked complete.
5. The JARVIS Core separately checks the signed returned trade/offer IDs,
   uses delta, output and inventory delta. Uncertain outcomes keep an active
   run quarantine: no duplicate purchase retry or fabricated success.

This is an original adapter to vanilla trade mechanics, not a creative-mode
item grant, and no independent LLM is invoked by the Fabric companion.
**Source-only; the native Fabric artifact and live-game outcome have not yet
been independently accepted.** Do not advertise guaranteed game success.

## One-instruction native resource-gathering mission

A bounded JARVIS-survival goal can now use the upstream AltoClef resource
catalogue as **one long-running, individually authorized gameplay mission**.
For example, **"Jarvis, gather 16 cobblestone in Minecraft"** is parsed
deterministically with the specified number and resource. There is no
separate script, second agent, unrestricted shell tool or invented coordinate.

- Allowed exact resources: logs, planks, sticks, cobblestone, raw iron, iron
  ingots, diamonds, obsidian, flint and netherrack, quantity **1–64 new items**.
  Unsupported resources and quantities are rejected; catalogue entries
  must actually exist in pinned PlayerEngine.
- For the deterministic route, JARVIS Core emits one Guardian-audited JOIN,
  then a Guardian-audited \`auto_goal gather\` with the exact owner-requested
  resource/count. No separate cloud-model call is required for this exact
  phrasing. Other open-ended goals retain the existing model planner.
- The native server first records the companion's actual baseline resource
  count, then starts **one** pinned \`TaskCatalogue.getItemTask\` with the
  absolute target (baseline + requested new items). The bounded mission uses
  the existing world inventory, physical gathering/crafting/mining as chosen
  by AltoClef, health and movement restrictions, and the server's durable
  ADMITTED journal.
- Only when the underlying resource task settles with **new** actual items
  beyond the saved baseline may Fabric mark the mission OBSERVED.
  Subsequent signed \`missionStatus\` includes source, count requested,
  baseline, current count, newly acquired count and whether gatherDone.
- The owner can inspect the signed mission status after the finite Core
  chat task has settled using the new read-only monitor. A STARTED receipt
  is **not** proof of the requested new items.
- Following a Node restart, read-only status can reconstruct the run from
  an exact settled Core receipt. Neither unknown outcomes nor game-server
  restarts cause automatic mutation replay.

This still does not certify that the pinned bot can gather **every**
Minecraft material, solve every world, complete Netherite/Dragon on its
own, or satisfy the 200k independently tested internet prompts. The
Fabric Java source and the actual game playthrough remain unaccepted.

## Owner live mission monitor after Core task settlement

A multi-hour Minecraft survival goal may continue after the parent JARVIS
chat task durably settles **PARTIAL**. Previously the only supported
\`auto_status\` action lived inside that same finite chat task; a fresh UI
request could not locate the original native mission without trying to
relaunch it.

Now the owner can use **Settings → Agent Skills & Integrations → Native
Minecraft mission status** and enter the **original JARVIS Core task UUID**,
or use read-only
\`GET /api/jarvis/minecraft/mission-status?taskId=<original-uuid>\`.

- The handler requires an active authenticated OWNER session and an
  **original task owned by that exact principal**. Foreign task existence
  is not disclosed.
- It scans bounded, durably SETTLED original \`minecraft_companion_command\`
  effects to find an actual native \`auto_goal\` admission. It rejects
  arbitrary objective text, invalid historical receipts and unknown IDs.
- Each read requests a **new real Guardian audit**, bound to the original
  owner task, before the native PlayerEngine IPC client sends a signed
  \`auto_status\` to the **already-running** Fabric game server.
- The client reconstructs the original run UUID only from the matching
  previously settled owner effect and pinned owner/companion/world identity,
  and refuses unsettled effects or stale/drifted start records. The server
  again validates the live native task's original Core task ID and returns
  fresh game-world milestones.
- This endpoint has **NO mutating operations**. It does not spawn, resume,
  repeat, retry, cancel or restart any action and cannot make an
  in-progress mission complete. It labels a Fabric \`complete\` receipt as
  \`inGameMissionReportedComplete\`, never as independent field acceptance.
- If the Node or Fabric server lost the original task, status is
  \`unverified\`; the user must inspect/reconcile the original effect.
  A missing receipt is NOT permission to issue a new mission.

No Windows, actual world or independent Dragon/Netherite acceptance is
claimed by adding this read-only control.

## Native Node-process restart recovery

An owner-authorized native `auto_goal` stores its randomly generated native
run UUID and start time in the **existing, durably SETTLED Core effect receipt**,
together with the original world, owner UUID, companion UUID and native
operation. The original Core task UUID remains the authoritative parent.

When the **same Core task** resumes after a Node process restart, an explicit
`auto_status` can restore the native run binding only from owner-matching
settled effect records. JARVIS refuses restoration when a Core effect is
ADMITTED/EFFECT_UNKNOWN, when the receipt is damaged or missing a provenance
field, when the goal/world/companion differs, or when the stored start time
is stale. It then requests a **new authenticated, HMAC-signed** status from the
still-running Fabric server. A past accepted-dispatch receipt is never
accepted as a successful game-state result.

**Important limits:** This does not resurrect a Fabric world, a killed server
task, or an already-settled Core task as a new owner command. Cross-task
historical mission monitoring, recovery from an interrupted Minecraft
server and durable autonomous completion across a world restart still need
separate accepted implementation. No automatic reexecution of a previous
mutating goal is permitted.

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
