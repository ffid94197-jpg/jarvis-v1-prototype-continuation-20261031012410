# AI Companion / PlayerEngine integration pin

This prototype vendors the upstream source as pinned Git submodules; it does not download executable code at runtime.

| Component | Pinned source | Commit |
|---|---|---|
| AI Companion Fabric mod + PlayerEngine fork | https://github.com/adevivo/ai-companion — release v0.4.0+mc1.21.11 | 6623267807879593a1002b2030e8b2ad82829c87 |
| Version-neutral memory core | https://github.com/adevivo/ai-companion-memory — release 0.5.1 | cc33ad4c2f8202f68b138c0df433ede3b8947e95 |

## Intended ownership

- JARVIS Core remains the sole natural-language planner and owner of Guardian authorization, durable mission state, cancellation and acceptance reporting.
- AI Companion's actual PlayerEngine / AltoClef / Automatone implementation becomes the in-world action runtime: navigation, resource tasks, crafting, combat, farming and structure building.
- The JARVIS overlay disables AI Companion's independent chat-brain turn loop only while the authenticated JARVIS bridge is enabled. It does not remove the upstream engine or its task catalogue.
- The local bridge is loopback-only, bearer-token protected, owner-bound and accepts typed allowlisted goals. It does not accept arbitrary Java, shell, script or raw command strings.
- The upstream gamer task is exposed only through explicit JARVIS owner-authorized Dragon missions. Full Netherite gear is then requested through PlayerEngine's own get / smithing task catalogue. JARVIS must still verify the actual in-world results independently.

## Build

Run integrations/build-ai-companion.ps1 from a Windows checkout. It initializes the two pinned submodules, applies the checked-in JARVIS overlay, stages the exact memory and PlayerEngine jars, and builds the 1.21.11 Fabric mod.

Required toolchains:
- JDK 17 for the version-neutral memory core.
- JDK 21 for PlayerEngine and the Minecraft 1.21.11 mod.

Set JARVIS_JAVA17_HOME and JARVIS_JAVA21_HOME, or pass -Java17Home and -Java21Home.

The resulting jar is produced under integrations/ai-companion/aicompanion/build/libs/. It must be installed in the target Fabric 1.21.11 instance with Fabric API 0.141.1+1.21.11 and Architectury API 19.0.1. The bridge creates config/jarvis-bridge.json on first server startup; point JARVIS_MINECRAFT_AI_COMPANION_CONFIG at that file in the JARVIS environment.

## Licensing and scope

The upstream mod and PlayerEngine sources carry LGPL-3.0 and the accompanying GPL text / NOTICE for their upstream lineage. The memory core is LGPL-3.0. Keep those files and notices with source and binary distributions. This integration does not copy the unlicensed Player2NPC project.

Upstream labels this release alpha and documents limitations for shared/public servers. This is an integration candidate for a trusted local/singleplayer environment, not a security certification or a claim that Minecraft acceptance has passed.
