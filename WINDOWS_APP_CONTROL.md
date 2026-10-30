# JARVIS Windows application control — current capabilities

This version fixes two user-reported issues: **Settings incorrectly routed to Explorer**, and **Chrome rejected due to the small fixed allowlist**. Exact simple commands like `open settings` are deterministically mapped to the Settings tool rather than relying on potentially incorrect model routing, while Guardian remains in control. It supports real Windows Settings via Windows `ms-settings:` URI, a verified install-path lookup for Chrome/Edge/Firefox/VS Code, approved Windows utilities, explicit approved-app discovery, and new operator-managed app aliases. Guardian still authorizes and audits every call.

## Normal commands to try in NEXUS

- `Open Windows Settings` → `windows_open_settings {"page":"home"}`.
- `Open Display settings` → `windows_open_settings {"page":"display"}`.
- `Open Google Chrome` → `windows_open_app {"app":"chrome"}`. Chrome opens as an installed **normal** app. JARVIS's scripted browser remains its separate Playwright Chromium instance.
- `List the apps you are allowed to launch` → `windows_discover_apps {}`. Installed detection is an availability check, not a GUI verification.
- `Open Notepad` → `windows_open_app {"app":"notepad"}`.

All of these need `JARVIS_WINDOWS_AGENT_ENABLED=1` under the `bun run dev:windows` supervisor. `JARVIS_WINDOWS_UI_CONTROL_ENABLED=1` enables extra visible-window checks and approved focus, but does not enable arbitrary typing or clicking. The companion is accessible only on loopback and carries a private generated token. Do not tunnel the server or turn off Guardian.

## Owner-approved apps beyond the built-in catalog

Edit `windows-companion/approved_apps.json` *locally* on your Windows PC, outside JARVIS's agent workspace. Example:

```json
{
  "obs": "C:\Program Files\obs-studio\bin\64bit\obs64.exe",
  "music": "D:\Installed Apps\MusicApp\music.exe"
}
```

This is operator approval, **not something the AI may silently edit**. Applications must be local absolute `.exe` paths with no arguments; UNC/network paths, scripts, shells, sensitive system utilities, and arbitrary paths supplied in chat are denied. Restart `bun run dev:windows` after editing approvals. A non-installed approved program is reported unavailable, not falsely launched.

## Verification

`bun run test:agent-tools-offline`, `bunx tsc --noEmit`, `bun run lint` and `bun run build` must pass on the real Windows environment. Then perform Settings/Chrome/Notepad live launch tests and verify windows visibly appear, and repeat normal Guardian-deny/cancel paths. Pure offline tests **do not certify Windows-native execution**. This is not unrestricted PC control, full game playing, nor production LPAC/RLM security certification.
