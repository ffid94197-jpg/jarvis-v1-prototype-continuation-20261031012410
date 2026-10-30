# AGENTS.md — JARVIS Track B Durable Instructions

Non-negotiable rules for every agent (human or AI) working in this workspace.

1. JARVIS is an independent autonomous runtime, not an LLM wrapper. The Core owns task state, execution planning, and settlement — the model advises.
2. JARVIS Core owns task state, model routing (future), execution planning, memory, and settlement. Model output is never an execution receipt.
3. Guardian independently controls effect authorization and must fail closed. Audit failure ⇒ deny. Never weaken Guardian to make a test pass.
4. Protected effectful execution requires Windows-native security evidence. Linux runs are development/testing only — never label them Windows certification.
5. LAYA is a required bounded advisory subsystem; JEV alone is removed. Preserve LAYA and never give it Guardian authority.
6. Models cannot directly invoke unrestricted OS operations. They may only propose; only the executor executes, with Guardian-normalized args.
7. Reuse existing modules before implementing replacements. Do not rebuild without proven necessity.
8. Do not alter the protected PC Track A repository (`D:\jarvis_pc_work` — absent in this environment; treat as untouchable regardless).
9. Preserve source code, Git history, dirty files, and recovery evidence. No destructive git commands. No deleting evidence.
10. Maintain typed contracts and explicit state transitions (`src/lib/agent/core/taskState.ts` — invalid transitions are rejected).
11. Every effect must have admission (`EffectRecord`), evidence (receipt), and settlement. Journal-before-effect is mandatory: no admission ⇒ no effect.
12. Every test claim must name the real environment and results. Statuses allowed: PASS / FAIL / BLOCKED / NOT TESTED / NOT_STARTED — never COMPLETE without passing tests.
13. NEXUS has exactly two top-level modes: ORB (visual) and ASSIST (text console).
14. Orb Mode contains only the derived orb and one small bottom switch. All other HUD lives in Text Mode.
15. Original ULTRON orb provenance and licensing must be preserved (Sagar TamANG / SAGAR-TAMANG builds, github.com/SAGAR-TAMANG/ultron-by-sagar-builds).
16. Provider keys and personal data must be protected. Sessions store token hashes only; children get sanitized environments; never log secrets.
17. Use dedicated test credentials, fixtures, and databases. Never test against real user data.
18. Do not bypass security to satisfy a test. If Guardian blocks, fix the intent or record the denial honestly.
19. Use Plan mode for consequential architecture decisions. Bounded, verified engineering milestones only.
20. Continue through the stage ledger (`evidence/STAGE_LEDGER.json`); update it truthfully after every stage.
21. Request approval only when permissions, risks, or missing owner information genuinely require it.
22. Never report release completion with unresolved mandatory gates. Current verdict: **JARVIS V1 NOT COMPLETE** (see `deliverables/JARVIS_V1_RELEASE_VERDICT.md`).

The 15 core principles of the original JARVIS blueprint are preserved in
the mission documents (`upload/…ULTIMATE_MASTER_ENGINEERING_MISSION…md` §
"15 principles") and traced in `evidence/REQUIREMENTS_TRACEABILITY.csv`;
their authoritative meanings are not re-invented here.

## Experimental Windows full-desktop mode (owner-authorized test machine)

The operator has authorized opt-in generic desktop mouse, keyboard, visible-window and installed-app control solely on a separate test laptop. The new `JARVIS_EXPERIMENTAL_DESKTOP_CONTROL=1` flag allows these expanded tools through the **existing audited Guardian** on the loopback sidecar. This does not permit model-chosen shells, arbitrary executable paths, remote access or disabling cancellation. Respect the Ctrl+Shift+F12 emergency stop. A tool receipt saying an input was sent is not proof the app achieved the task. For Minecraft, the independent LAN bot's movement commands require game-side confirmation; opening a world and fully autonomous gameplay remain unverified.

## Native Windows controls (2026-10-28)
When the operator requests direct PC control, prefer `windows_native_open_url`, `windows_native_inspect`, `windows_native_action`, plus on-screen feedback over isolated Playwright browser tools. All native controls require the existing Guardian gates and bounded local test mode. Real Windows UIA actions and Minecraft must be verified on-device. Never label an action as complete from a dispatched input alone.

## LAYA model-routing invariants (2026-10-28)
- The Laya model advises on model selection only; it cannot authorize tools or override Guardian.
- Privacy filtering occurs before candidate inference and MUST NOT fall back to cloud for a sensitive task.
- New tasks are durably pinned to an exact model profile version; resumed tasks never silently re-route.
- Local Laya service is optional. Missing, malformed, or low-confidence responses revert to deterministic owner-weighted ranking; never claim inference occurred if it did not.
- Only loopback Laya endpoints are permitted; profile credentials are encrypted and never returned to the browser.
