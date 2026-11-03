# JARVIS Prototype — Microsoft UFO² selective native control integration

## Selected part of the November 2–3 external-component research

**Imported/adapted:** Microsoft [UFO²](https://github.com/microsoft/UFO), the stateless UI-control text grounding/filtering strategy from `ufo/automator/ui_control/control_filter.py` (not the UFO HostAgent/AppAgent loop).

- Pinned upstream revision: `eae3c0a8d168c47cb10df0652e293e092eda1078`
- Pinned upstream file Git blob: `6c280ce6f9d16ec505e81604814c766fbfa38311`
- Source: https://github.com/microsoft/UFO/blob/eae3c0a8d168c47cb10df0652e293e092eda1078/ufo/automator/ui_control/control_filter.py
- Original copyright: Microsoft Corporation
- Original license: MIT; retained at `windows-companion/third_party/UFO2_MIT_LICENSE.txt`
- Adaptation file: `windows-companion/ufo2_control_grounding.py`

### Why only this part?

The prototype already has one authoritative JARVIS Core, planner, Guardian, Windows-native UIA adapter, session-bound opaque UI control references and post-action verification. Copying UFO²'s host agent, app agent, command executor, or LLM loop would create a second decision-making and execution authority. This import only ranks **real foreground** UIA control names and automation IDs using owner intent; it never clicks, authorizes or executes anything.

### Integrated owner-facing capability

The existing `windows_native_inspect` tool accepts an optional `query` with 2–160 printable characters. Example: `{"query":"Please click Save"}`. JARVIS forwards it under the existing opt-in Windows companion, Guardian/audit and cancellation boundary.

The Windows Python companion obtains its regular current-foreground pywinauto/UIA tree (up to 450 bounded candidates), hides disabled/password/invisible controls, ranks matching names/automation IDs and returns at most 65 actual controls with short-lived opaque IDs. A query with no observed match returns **zero** actionable IDs and `queryGrounded:false`, rather than guessed controls. Calling `windows_native_inspect {}` preserves the previous unfiltered behavior.

Actual effects **still require** `windows_native_action` with a fresh ID; invoke is not proof of an external effect, and must be followed by `windows_native_verify` or another observed postcondition. The emergency stop, foreground identity, token expiry, single-use tokens, bounded set_text and local test-mode flags are retained. No network/model dependency or installer is added.

### Acceptance / honest limitations

On the actual Windows prototype checkout with installed dependencies, run:

```powershell
python windows-companion/verify_native_uia_offline.py
node scripts/verify-native-tool-wiring.cjs
```

Those two are targeted offline fixture tests only; neither consumes GitHub Actions minutes. Then, on the explicitly enabled isolated Windows desktop, exercise `windows_native_inspect {"query":"Save"}` in a real app and verify the resulting action independently.

**Not yet proven:** actual Windows companion + main JARVIS model + Guardian full end-to-end run; no claim that UFO² as a whole has been installed; no claim of release-level Windows certification, universal PC automation, or completed JARVIS Prototype. This is one reusable external capability merged natively; later candidates (LangGraph, OpenHands SDK, Browser Use, OmniParser, memory, voice, MCP) require separate narrowly scoped reviews and measured benefit before adoption.

**Scope:** Prototype only, never PC Work JARVIS `D:\jarvis_pc_work`.
