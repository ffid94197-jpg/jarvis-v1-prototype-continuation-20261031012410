# JARVIS Minecraft: AI Companion / PlayerEngine integration

This source is pinned as a Git submodule at `integrations/ai-companion`:
- Upstream: https://github.com/adevivo/ai-companion
- Pinned upstream commit: 6bb1df1a06258ca712b66f1404dd05204f25b9c7
- Project: AI Companion, Fabric 1.20.1; PlayerEngine fork with AltoClef and Automatone/Baritone.
- License: upstream repository declares LGPL-3.0; the engine carries LGPL/GPL license texts. Preserve all notices and source availability for modified LGPL components. Do not copy Player2NPC (upstream explicitly says it is unlicensed).

## Integration intent

Use the upstream **PlayerEngine task/navigation runtime** as the Minecraft execution backend for JARVIS. It is not a second assistant and must not become an independent authority.

JARVIS remains the only owner-facing agent and source of intent:
1. Natural-language request enters the existing JARVIS Core and Guardian.
2. Guardian-approved, typed Minecraft objective is handed to the integration adapter.
3. Adapter maps only allow-listed objectives to AltoClef tasks / Automatone navigation.
4. The adapter returns structured, server-observed action receipts and task state to JARVIS.
5. JARVIS verifies the actual world/inventory/equipment postconditions before declaring success.

## Non-negotiable boundaries

- Keep the existing Mineflayer/MCP path as a fallback until the new backend is built and accepted; do not silently switch runtime.
- No direct LLM-to-game authority inside the imported companion. Disable/replace its independent chat brain for JARVIS-controlled sessions; JARVIS must be the sole planner and Guardian.
- No bypass of Guardian, owner identity, world allow-list, action budgets, cancellation/E-stop, task journal, or independent verification.
- Do not trust model narration, command dispatch acknowledgements, or AltoClef task completion alone as proof of a world-state postcondition.
- Use explicit task IDs, idempotency keys, bounded execution, cancellation, and durable receipts across the adapter boundary.
- Keep MC/Fabric version compatibility explicit. Upstream targets Fabric 1.20.1; do not claim compatibility with another game/server version without a port and build.
- No live Minecraft acceptance is implied by vendoring this source.

## Work still required to make it an active JARVIS backend

1. Inspect the pinned upstream source and identify the narrowest AltoClefController/task API seam.
2. Add a JARVIS-owned adapter in the companion/engine that accepts authenticated local IPC requests from the existing MineAI MCP host (or a narrowly scoped JARVIS service), not arbitrary network commands.
3. Define a versioned typed request/receipt protocol covering gather, mine, craft, equip, build, travel, combat, inspect, stop/cancel, and status.
4. Bind request identity and Guardian authorization to each accepted task; reject replay, stale, malformed, oversized, or unauthorized requests.
5. Convert AltoClef task transitions and actual Minecraft observations into receipts; expose cancellation and process/world disconnect recovery.
6. Map existing JARVIS completion gates to real game observations, including newly acquired resources, equipped Netherite slots, and observed Ender Dragon death.
7. Build on the supported JDK 17 / Fabric 1.20.1 toolchain and run targeted offline checks, then a live Java server acceptance before enabling by default.

This commit adds the upstream source dependency and integration contract only. It does **not** yet implement the IPC adapter or prove that the engine is running under JARVIS control.
