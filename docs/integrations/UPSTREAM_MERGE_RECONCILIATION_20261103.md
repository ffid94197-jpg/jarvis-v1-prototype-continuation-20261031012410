# Prototype JARVIS upstream merge reconciliation — 2026-11-03

## Canonical target

- Repository: `ffid94197-jpg/jarvis-v1-prototype-continuation-20261031012410`
- Canonical target: `main`
- Consolidated candidate: PR #23, `integration/hermes-capabilities-20261103`
- PC Work JARVIS is out of scope and was not modified.
- No GitHub Actions workflow was dispatched during this reconciliation.

## PR-by-PR disposition

The comparison is against the current `main` content and the canonical PR #23 head, not merely PR titles or self-reported descriptions.

| PR | Paths changed | Paths already in canonical candidate | Disposition |
|---|---:|---:|---|
| #1 | 55 | 50 | Remaining pathfinder/bridge files are byte-identical to main; PR #1's Mine AI mission file is an older 147-line version, while main has the later 180-line version including the optional smithing-tool gate. `tsconfig.tsbuildinfo` is generated metadata. No unique implementation to cherry-pick. |
| #2 | 5 | 3 | The two remaining Mine AI mission/smithing files match current main. No unique implementation to cherry-pick. |
| #3 | 5 | 5 | Fully represented in the canonical candidate. |
| #4 | 74 | 67 | The seven uncovered paths are the same older pathfinder/MCP/test artifacts already reconciled through #1/#2, plus generated build metadata. No unique implementation to cherry-pick. |
| #5 | 5 | 5 | Fully represented in the canonical candidate. |
| #6 | 18 | 11 | Corpus validator, validator tests and benchmark README are already present in main. The old CI-only project-build adapter was deliberately not merged. Its replacement, local_project_build, is now implemented on branch feature/local-windows-sandbox-project-build-20261103 with Windows Sandbox, offline npm install/build, Guardian authorization and durable effect journaling; it awaits local Windows acceptance and a follow-up merge. |
| #7 | 8 | 1 | The uncovered files are present in main as identical or later versions. In particular, main's autonomy engine has stricter action-to-proof binding than the older branch; the older Dragon/Netherite proof mapping must not replace it. No unique implementation to cherry-pick. |
| #8 | 171 | 101 | Most uncovered Minecraft modules/tests are byte-identical; the differing files are older or superseded by stricter current-main companion validation, action-to-proof binding, live-campaign verification and language/gateway tests. Keep main's manual-only Windows workflow to preserve hosted Actions minutes. The CI-only project-build adapter was not merged; the local Windows Sandbox replacement is implemented separately on feature/local-windows-sandbox-project-build-20261103 and awaits owner-PC acceptance. Generated tsconfig.tsbuildinfo is not source. |

## Other open/closed integration PRs

- PR #22 is closed as superseded by PR #23.
- PR #24 is closed as a duplicate/smaller Hermes CUA implementation; its capability slice is represented in PR #23.
- PR #23 was merged into `main` as `a2c7cb3cd8e2159524a0da958d17b197aacd667f`. The merge consolidated the selected native integrations; it did not certify live acceptance.

## Hermes-derived CUA changes now in the canonical candidate

The optional Cua Driver backend is an adapter inside the existing Windows companion, not a second agent runtime. It remains disabled by default and requires both explicit local opt-ins. It does not import Hermes planner, credentials, memory, scheduler or agent loop.

Additional fail-closed safeguards added during this reconciliation:
- SDK telemetry is forcibly disabled by the adapter.
- Foreground window selection uses the exact PID/HWND identity supplied by Win32, not a window-title match; duplicate titles cannot redirect observation.
- If the exact foreground PID/HWND is absent from the bounded visible-window list, observation fails closed.
- Coordinate clicks/moves are checked against the actual primary-display dimensions before CUA dispatch.
- Text and key input require the exact PID/window ID from a fresh observation; implicit "whatever is foreground now" input is denied.
- Degraded, truncated, incomplete or failed accessibility snapshots do not produce usable element tokens.
- An outcome-unknown mutation remains latched when a follow-up observation fails.
- Offline regression cases and the owner's local Windows acceptance runner cover these contracts.

## What is not being claimed

- The new CUA Python/Node offline suites have NOT been executed on a local Windows checkout.
- The CUA SDK Windows preflight and harmless real-app acceptance have NOT been run.
- No full local TypeScript/Node/PowerShell acceptance has been run on the consolidated head.
- Real Minecraft Java Dragon defeat, End return and full Netherite equipment remain NOT ACCEPTED.
- The 200,000 Internet-original prompt corpus and live-model execution programme remain NOT ACCEPTED.
- The old CI-only project-build adapter remains intentionally unmerged. The new Windows Sandbox local replacement is in a separate feature branch and is not yet merged.
- This reconciliation is not a release certification and does not justify marking the autonomous layer 100%.

## Next gate

Run `npm run test:local-project-build-offline` and `npm run test:local-project-build-windows-live` on the owner Windows PC, then run the existing external-integration and CUA local acceptance. Keep the local build feature opt-in and do not claim product acceptance from static checks alone.
