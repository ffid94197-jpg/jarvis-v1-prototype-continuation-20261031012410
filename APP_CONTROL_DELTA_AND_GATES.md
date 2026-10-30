# Windows application-control delta — 2026-10-27

**Release verdict: JARVIS V1 NOT COMPLETE.** This update fixes the user-reported issue where "open Settings" was confused with opening File Explorer, and the limitation where Chrome wasn't approved as a launchable Windows app.

## Implemented source changes

- New `windows_open_settings` tool with hardcoded `ms-settings:` URI for home and a finite set of approved Settings sections. No arbitrary shell or untrusted URI is accepted.
- `windows_open_app` handles Settings, Chrome, Edge, Firefox, VS Code, Notepad, Calculator, Explorer, Paint, and operator-configured TLauncher.
- New `windows_discover_apps` returns approved alias and whether its executable was found; no broad or private process inventory.
- Operator may explicitly extend app catalog via `windows-companion/approved_apps.json` with local absolute `.exe` paths (not via JARVIS model tooling). Sensitive shells/scripts and network paths denied.
- Sidecar resolves actual local program paths and launches with `shell=False`; model/sidecar credentials aren't inherited. Visible-window proof is distinct from process launch evidence.
- Existing Guardian, auditing, effect admission/cancellation, browser policy, memory, local screen feed, and optional Minecraft LAN foundation remain intact. No changes to private credentials, `.env`, or databases.
- Planner explicitly distinguishes Windows Settings from File Explorer and normal Chrome from JARVIS's controlled Playwright browser. Exact one-step commands are deterministically routed to the correct tool, then still pass through Guardian and durable effect admission (16/16 offline intent tests).

## Focused offline results

- Agent tool wiring: **56/56 PASS** (source contract checks only)
- Node Windows Guardian/desktop policy: **56/56 PASS** (Windows simulated)
- Python companion action policy: **21/21 PASS** (isolated AST)
- Browser agent policy: **41/41 PASS** (simulated DOM)
- Application catalog: **17/17 PASS** (offline paths and approvals)
- App launch fixture: **8/8 PASS** (fake OS/process; no native launch)
- Exact Windows command routing: **16/16 PASS** (no browser, no model, Guardian execution pending)
- Combined **215/215** focused offline checks; Python syntax and TypeScript syntax transpilation passed (see packaging evidence).

**Not tested:** live `ms-settings:` opening, installed Chrome app launch, Windows foreground-window inspection, production build, full TypeScript typecheck, end-to-end Guardian task execution, real game control, full multimodal hardware, native LPAC/RLM acceptance. Do NOT certify these based on offline tests.

## Security note

The temporary no-login dev server must be run only on Windows loopback using `bun run dev:windows`. It grants local-PC processes access as test owner and must never be tunneled or served over a public/LAN address. Guardian remains required. This is not unrestricted arbitrary mouse/keyboard or shell control. User approval is needed for additional apps; tasks affecting security, finances, secrets, or system state require higher-level confirmations and security acceptance.
