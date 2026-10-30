# JARVIS — Autonomous Windows agent improvement (2026-10-28)

Baseline: full-source Model Manager edition dated 2026-10-28. This is a **consolidated source** update, not an independent EXE. Original uploaded ZIP untouched. No credentials, `.env`, or database bundled.

## Specific changes

1. **Unified real desktop observation:** `windows_desktop_observe {}` returns current foreground/window/cursor geometry and bounded live UIA controls in one operation. Reports UIA unavailability explicitly. Does **not** interpret screen pixels; existing opt-in screen vision handles custom-rendered apps.
2. **Verifiable Windows postconditions:** `windows_native_verify` accepts exactly one predicate: `titleContains`, `controlContains`, or `textEquals`. It reads a fresh Windows UI Automation tree, excludes password controls, and returns a Boolean proof; it does not echo the expected secret text.
3. **Honest execution:** Core `AutonomyGate` records GUI actions that were only *dispatched* rather than verified. A final response with outstanding GUI proof is **PARTIAL**, even if the model declares success. UIA exact readback and explicitly verified UIA postconditions count as evidence. A model cannot finish an obvious desktop task without any tool effects.
4. **Stall prevention:** Three identical unverified GUI actions trigger a durable partial stop with evidence instead of spinning, repeating clicks, or burning tokens indefinitely.
5. **Effect journal correctness:** `windows_native_open_url` and `windows_native_action` are now admitted to the durable effects table before OS action. Repeatable input tools are differentiated by durable step sequence, so clicking twice in a task does not get incorrectly deduplicated; a replayed *same step* retains its identity.
6. **Resume continuity:** Unverified GUI proof debt is reconstituted from saved task steps when paused work resumes, rather than silently forgetting unverified effects.
7. **Testability:** new model-free desktop policy/verification fixtures, TS supervisor tests, and a Windows operator verification command. Existing Guardian checks, owner scope, model profiles, cancellation and emergency stop retained.

## Operationally meaningful sequence

Ask: "Open Chrome, search YouTube for MrBeast, play the oldest video; type JARVIS_NATIVE_ACCEPTANCE_0123456789 in Notepad, verify its text."

A correct tool trace should begin with `windows_desktop_observe`, use native app/browser navigation, repeatedly inspect UIA controls and **verify** expectations with `windows_native_verify` (or a text-set receipt with exact UIA readback). No browser playback claim is accepted without an explicit observed playback state; UIA page title alone does **not** prove video playback. Screen vision is opt-in and may not provide deterministic playback proof.

## Explicit limits

- Native UI Automation does not expose every Chrome custom control or game scene.
- No live Windows PC, Gemini profile, Minecraft Java client, or native UIA session was available during Linux tests.
- This is not blanket authorization to change security settings, enter passwords, or perform destructive activity.
- Native LPAC/RLM production containment and fully independent Minecraft survival gameplay are **not certified**.
- A full production build/typecheck must run in your Windows checkout after Bun dependencies are installed.

8. **Structured observations:** large UIA scene receipts are compacted to bounded *valid JSON*, rather than truncating raw JSON mid-structure. This retains foreground controls and failure flags for planning.
