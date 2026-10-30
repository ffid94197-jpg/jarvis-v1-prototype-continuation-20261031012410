# JARVIS V1 final release gate board — actual state

**Release verdict: NOT COMPLETE.** This board is tied to the 2026-10-29 isolated source development candidate. It is NOT an independent audit of the current Windows working tree.

| Gate | Requirement | Release evidence and result |
|---|---|---|
| G00 | Reproducible source/toolchain/typecheck | NOT TESTED for production build; offline syntax only |
| G01 | Secure production owner enrollment/sessions | NOT TESTED end-to-end, local dev auth mock passes |
| G02 | Fail-closed release verification ledger | PARTIAL, offline run logged; full release runner not exercised |
| G03 | Guardian/Core/effect/settlement/cancellation | PARTIAL, offline fixtures pass; native durability evidence missing |
| G04 | Windows LPAC/RLM protected supervisor | BLOCKED, target Windows LPAC certification not available |
| G05 | BYOK cloud/local/concurrent provider routing | PARTIAL, offline model-router policy; actual keys/network/local hardware untested |
| G06 | LAYA task advisory | PARTIAL, 4K owner routing and 1.5K local fixture stress pass |
| G07 | Persistent scoped memory/world-model | PARTIAL, isolated/mocked route tests; actual DB persistence/scope unverified |
| G08 | Skills/MCP/connectors | PARTIAL, tool contracts and offline policy do not certify live external effects |
| G09 | Windows application/browser control | BLOCKED, actual UIA click/input/postcondition/e-stop not proven |
| G10 | Real time screen/game computer-use | BLOCKED, real screen consent and game control loop unverified |
| G11 | Speech/wake/face/gesture/TTS | BLOCKED, real microphone/camera/output/recognition acceptance unverified |
| G12 | NEXUS Orb/Console/Settings | PARTIAL, source checks pass, no live browser release test |
| G13 | Durable scheduler and paired remote devices | BLOCKED, cross-device reconnect/revocation/live scheduling unverified |
| G14 | REA bounded repair/rollback | BLOCKED, end-to-end self-diagnosis isolation/review not proven |
| G15 | Security red-team/fault injection | BLOCKED, integrated Windows adversarial matrix incomplete |
| G16 | Performance/Windows package/migration/rollback | BLOCKED, real Windows clean installation and release package unverified |
| G17 | Independent acceptance + owner signoff | BLOCKED, dependent gates open |

Completed focused work must be preserved, but **no row becomes release PASS without the specific native proof**.

## Recommended next engineering slice
1. On Windows apply only hash-matching targeted fix; run the script's tests.
2. Run `npm run dev:windows` and verify local SQLite session, model privacy boundary and `minecraft_companion_join` with real owner name.
3. Verify `collect_wood` breaks a real log and inventory increases. If not, capture `lastAction`, owner name, and pathfinder diagnostics and fix only the failing navigation path.
4. Continue missing V1 functionality and integration by the canonical G00–G17 gate dependencies. Preserve dirty worktree and never overwrite newer Windows source with this archived copy.
