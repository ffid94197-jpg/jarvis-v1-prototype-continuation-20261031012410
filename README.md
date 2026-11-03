## External research integration status (2026-11-03)

See [RESEARCH_COMPONENT_INTEGRATION_MATRIX_20261103.md](RESEARCH_COMPONENT_INTEGRATION_MATRIX_20261103.md)
for the recovered component inventory and each KEEP / WRAP / HYBRID /
REFERENCE-ONLY / DEFER / REJECT decision. Selected capabilities are native
JARVIS subsystems; this is not a claim that every upstream framework/runtime
or model weight has been installed or live-accepted.

Optional local STT research adapter: [FASTER_WHISPER_LOCAL_STT.md](FASTER_WHISPER_LOCAL_STT.md).
Vosk remains default; owner-selected Piper TTS is unchanged.

## New: Independent Minecraft LAN Gameplay Autonomy (2026-10-28)

JarvisBuddy now has a bounded observe–decide–act–verify loop for wood gathering, basic crafting, owner-follow, defensive retreat, short exploration, and survival monitoring. See [`MINECRAFT_AUTONOMOUS_GAMEPLAY_GUIDE.md`](MINECRAFT_AUTONOMOUS_GAMEPLAY_GUIDE.md). **Not fully autonomous gameplay; live Minecraft testing pending.**

> **2026-10-28 MCP compatibility and stress patch:** See [MCP_LIVE_STRESS_REPAIR_REPORT.md](MCP_LIVE_STRESS_REPAIR_REPORT.md) for the modern/legacy MCP protocol fix, orphaned-install cleanup fix, archive hardening, verified test results and remaining Windows acceptance gates.

## Latest change: Owner-priority LAYA routing (2026-10-28)

For new tasks, an explicit instruction such as "use the strongest model", "use cloud model", or "use local LLM" overrides automatic routing weightage and privacy preference. A single enabled cloud or local profile is always tried instead of being filtered out. See [LAYA_OWNER_PRIORITY_RELEASE.md](LAYA_OWNER_PRIORITY_RELEASE.md) for exceptions, privacy implications, stress tests and verification limits. Guardian permissions are unchanged.

---

# 2026-10-28: CONSOLE SETTINGS + LAYA ROUTING

See **[LAYA_SETTINGS_AND_ROUTING_GUIDE.md](LAYA_SETTINGS_AND_ROUTING_GUIDE.md)** for the new Settings UI, privacy-first auto model selection, real local Laya decision server integration, migration, and looped tests.

# JARVIS V1 — Native PC Agent experimental source (2026-10-28)

**START HERE:** [`NATIVE_WINDOWS_AGENT_SETUP.md`](NATIVE_WINDOWS_AGENT_SETUP.md). This build adds native Windows default-browser + Microsoft UIA control. It is not fully verified on Windows, and not JARVIS V1 complete.

# JARVIS V1 — Experimental Minecraft Friend upgrade (28 October 2026)

**Not the completed JARVIS V1 release.** This full-source development candidate is derived from the experimental Windows full-desktop source (27 October). The main engineering addition is a LAN Java Minecraft friend that can independently join a compatible local world, follow, come, stay, guard against common hostile mobs, attempt to gather two logs, reply in-game, and report health/inventory/position. There is also a separate bounded **foreground Minecraft game input** tool for your own window, with an emergency-stop latch.

For installing the Minecraft bot dependencies, LAN port/player configuration, explicit game-input opt-in and test commands, read `MINECRAFT_FRIEND_UPGRADE.md`. See `MINECRAFT_FRIEND_RELEASE_VERDICT.md` for evidence limitations.

Existing JARVIS NEXUS/Core/Guardian, provider adapter, Windows desktop companion, browser tools and SQLite schema remain. Do not overwrite protected `D:\jarvis_pc_work`. Do not copy `.env` credentials into chat or archives.


## Autonomous Windows interaction upgrade (2026-10-28)

The actual JARVIS task Core now has `windows_desktop_observe` to inspect the
foreground desktop, visible windows and UIA controls together, and
`windows_native_verify` to evaluate a real foreground UI postcondition (title,
visible control or exact editable value). The Core tracks GUI actions lacking
confirmation and settles them as **partial**, not verified. Repeat-action
watchdogs prevent stalled clicks/inputs. Native browser navigation and UIA
mutations are included in durable effect admission, and repeated desktop input
is step-fenced. Outstanding UI proof debt persists through pause/resume.

This is **not** certification of unattended Windows GUI automation or Minecraft
play. Run `RUN_AUTONOMY_ACCEPTANCE.ps1` in an isolated Windows test workspace
and then complete on-device acceptance scenarios.

## 2026-10-28: Optional local face and voice perception

Console now includes **◉ FACE / VOICE**. Local YuNet + SFace face-enrollment/comparison and Vosk offline speech-to-text integrate with existing NEXUS. Speech transcripts are explicitly reviewed and submitted into normal LAYA/Core/Guardian task routing; face matching **never** authenticates the owner or bypasses authorization. Camera/microphone require explicit browser permission and activation; no background listening or facial surveillance.

For setup, supported models, privacy limitations and acceptance, start with [FACE_VOICE_SETUP_AND_LIMITS.md](FACE_VOICE_SETUP_AND_LIMITS.md). The official model weights are downloaded separately via `INSTALL_FACE_VOICE_MODELS.ps1`. Run `RUN_FACE_VOICE_ACCEPTANCE.ps1` for repeatable sample-based offline checks. Real Windows camera/mic and actual model inference remain required acceptance tests.
