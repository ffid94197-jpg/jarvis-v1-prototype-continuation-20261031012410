# Hermes Computer Use / Cua Driver integration

## Source and decision

Hermes Agent's computer-use implementation uses the Cua Driver SDK/backend.
JARVIS adopts the underlying Cua Driver execution engine, not the Hermes Agent
runtime, planner, model routing, credentials, or independent agent loop.

Inspected upstream source revisions:
- Hermes Agent: NousResearch/hermes-agent at 74b2ed65e6564bfcafd29236e5fab2447a68fc76
- Cua Driver: trycua/cua at 07460674e1924ba2ed1219e858c31647bc206669
- Python SDK: cua-driver 0.38.0, MIT-licensed package.

## JARVIS ownership and security boundary

The execution path remains:

1. JARVIS Core selects a Windows desktop tool.
2. JARVIS Guardian validates and audits the exact arguments.
3. The authenticated loopback-only Windows companion validates the request again.
4. The companion's desktop-control module dispatches to Cua Driver only when
   both local opt-ins are set.
5. The result is returned to JARVIS Core; the task verifier must still prove
   the requested postcondition.

Cua Driver has no model, planner, provider keys, task queue, shell access,
browser navigation authority, or independent Guardian permissions. It is an
optional input/accessibility backend, not another agent.

## Integrated capabilities

- Same-process Python SDK runtime, one instance per companion process.
- Native visible-window discovery and accessibility snapshots.
- Structured control records with role, label, value, bounds, enabled state,
  PID, native window ID and snapshot-scoped element token.
- Exact-window background element-token clicks.
- Primary-desktop coordinate clicks, pointer movement, text input and key chords.
- Existing Win32 window enumeration/focus and scrolling remain on the legacy
  backend; this integration does not silently replace those paths.
- Structured action receipts distinguish refused, partial, unverifiable and
  confirmed effects.
- A timeout after dispatch is marked outcome-unknown. A second mutation is
  blocked until the previous call settles and a fresh desktop observation is
  performed.
- The existing Ctrl+Shift+F12 emergency-stop monitor requests CUA session end
  so held input is released; companion shutdown also ends the session before
  shutting down the SDK.
- Existing Win32/UIA, screen-watch and Minecraft paths remain available as
  fallback or separate execution paths.

## Installation and opt-in

Use the same Python interpreter configured by JARVIS_PYTHON:

    powershell -ExecutionPolicy Bypass -File scripts/install-cua-driver.ps1

Set these variables only in an isolated local Windows development session:

    $env:JARVIS_EXPERIMENTAL_DESKTOP_CONTROL = "1"
    $env:JARVIS_CUA_DRIVER_ENABLED = "1"

Restart JARVIS with npm run dev:windows. If Cua Driver is disabled, the
existing Windows backend remains unchanged. If it is explicitly enabled but
unavailable, CUA operations fail safely rather than silently switching drivers.

Before enabling it in JARVIS, run the read-only native SDK preflight:

    npm run test:cua-driver-windows-live

This checks the installed SDK against real visible Windows windows and
accessibility snapshots without dispatching clicks or keystrokes. It is a
driver preflight only; the JARVIS/Guardian end-to-end check must still be run
separately with windows_desktop_observe and a harmless test application.

## Model operating rules

- Run windows_desktop_observe before selecting controls.
- Prefer an elementToken from the latest snapshot, paired with that row's PID
  and cuaWindowId, over guessed coordinates.
- Use windows_desktop_click with elementToken, pid, cuaWindowId and button.
- Element tokens are single-use, expire after 25 seconds, and a new
  observation invalidates all previous tokens. Never reuse them.
- After an outcome-unknown response, observe before any retry.
- A Cua action receipt is not proof that the user's larger task completed.
  Use the existing independent JARVIS verifier.

## Acceptance still required

This integration adds offline contract tests only. It has not been installed
or exercised on the owner's Windows PC. Live tests must cover Notepad, Explorer,
a browser window, elevated-window limitations, cancellation, stale tokens,
timeout recovery, and post-action verification. Keep the backend opt-in until
those tests pass. The full JARVIS product and Minecraft acceptance remain
separate gates.
