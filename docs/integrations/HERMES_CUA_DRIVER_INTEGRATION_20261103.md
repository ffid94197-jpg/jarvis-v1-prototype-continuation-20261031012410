# Hermes Computer Use / Cua Driver integration

## Source and decision

Hermes Agent's computer-use implementation manages the Cua Driver native
binary as a separate stdio-MCP child process. JARVIS adopts the same upstream
Cua Driver project through its optional in-process Python SDK, so the existing
JARVIS companion owns execution without launching a second agent or MCP
server. This is a transport/lifecycle adaptation, not a copy of Hermes's
process manager or permission UI. JARVIS does not import the Hermes Agent
runtime, planner, model routing, credentials, or independent agent loop.

The upstream PyPI 0.38.0 release advertises Windows x64 and ARM64 wheels but
does not publish PyPI provenance attestations. JARVIS therefore pins the
version and both Windows wheel SHA-256 values in requirements-cua.txt and
installs with pip --require-hashes from the official PyPI index. This reduces
artifact-substitution risk but is not a substitute for upstream provenance
or independent binary review.
PyPI classifies this release as Beta. The JARVIS backend therefore remains
opt-in; the SDK preflight and real Windows acceptance must pass before any
default enablement decision.

Inspected upstream source revisions:
- Hermes Agent: NousResearch/hermes-agent at fd267bb3242a14c33d4899cffc60ee4be816f14d
- Cua Driver: trycua/cua at 07460674e1924ba2ed1219e858c31647bc206669
- Python SDK: cua-driver 0.38.0, MIT-licensed package.

## JARVIS ownership and security boundary

The execution path remains:

1. The Windows companion receives only its existing allowlisted environment;
   provider API keys from the main JARVIS server are not copied into the
   companion. CUA telemetry is disabled by default.
2. JARVIS Core selects a Windows desktop tool.
3. JARVIS Guardian validates and audits the exact arguments.
4. The authenticated loopback-only Windows companion validates the request again.
5. The companion's desktop-control module dispatches to Cua Driver only when
   both local opt-ins are set.
6. The result is returned to JARVIS Core; the task verifier must still prove
   the requested postcondition.

Cua Driver has no model, planner, provider keys, task queue, shell access,
browser navigation authority, or independent Guardian permissions. It is an
optional input/accessibility backend, not another agent.

## Integrated capabilities

- Same-process Python SDK runtime, one instance per companion process.
- Native visible-window discovery and accessibility snapshots.
- Structured control records with role, label, bounds, enabled state, PID,
  native window ID and snapshot-scoped element token. Raw text-field values,
  screenshots and unredacted accessibility markdown are not forwarded.
- Exact-window background element-token clicks.
- Exact-window-targeted text input and key chords when PID/window ID are supplied;
  the CUA receipt reports whether the selected route was background or foreground.
- Primary-desktop coordinate clicks, pointer movement, and foreground text/key input.
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

- Run windows_desktop_observe before selecting controls. It lists visible
  windows and takes one accessibility snapshot of the current foreground
  window. If the foreground window cannot be identified or is not present in
  the bounded visible-window list, observation fails closed; it never silently
  selects the first visible window.
- To inspect a different window, pass its PID and cuaWindowId from
  visibleWindows to windows_desktop_observe. The returned observedWindow then
  reports selectionReason "explicit-window". Only one window is snapshotted
  per call so inspecting another window cannot invalidate tokens before they
  are returned.
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
