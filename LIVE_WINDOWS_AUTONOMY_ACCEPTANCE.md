# Real Windows Native Autonomy Acceptance — operator test

These scenarios must run on the isolated Windows test laptop with a working model profile, companion and NEXUS. Offline tests do **not** satisfy these gates. Start with `RUN_AUTONOMY_ACCEPTANCE.ps1`, then launch `bun run dev:windows` after stopping the previous process. Keep Ctrl+Shift+F12 available for emergency stop.

## Task A — Native Notepad + exact text

> JARVIS, operate my actual desktop without a separate Playwright Chromium. Observe the desktop and open Notepad using the real Windows launcher. Inspect the foreground accessibility tree. Set the editable text to exactly `JARVIS_NATIVE_ACCEPTANCE_0123456789` using Windows UI Automation and read it back. Save `native_acceptance.txt` inside the authorized test workspace. Read back the file. Only declare this task complete when text and file readbacks match exactly. If native UIA is unavailable, report the blocker and do not fake success.

Expected evidence: `windows_desktop_observe` receipt, native controls, `textVerifiedByUIA=true`, workspace exact bytes, confirmed foreground state.

## Task B — Native default-browser navigation

> JARVIS, use the installed default browser, not the Playwright test browser. Search YouTube for MrBeast, open the official channel's Videos tab, select Oldest and play the first video. After each major navigation, observe and verify current app/page state. If video playback cannot be independently observed, report PARTIAL rather than PASS. Do not merely paste a URL to the chat.

Expected evidence: actual default-browser process and window, page/title observed, oldest selection observed, playback state independently established (UIA alone may not expose playback). No invented playback claims.

## Task C — Recovery and repetition

> JARVIS, inspect the foreground window and attempt to focus an absent control. Recover by re-inspecting the current UI rather than repeating stale control IDs. If the target cannot be reached, stop and report BLOCKED with actions attempted.

Expected evidence: stale tokens rejected, no repeated ineffective input beyond watchdog threshold, partial/failed status rather than success.

## Task D — Durable pause/resume

> JARVIS, perform a multistep native Windows task with a small step budget. Pause at the budget. Resume the same task and verify previous desktop effects before finalizing.

Expected evidence: same task ID and model profile, no silent duplication, outstanding GUI verification obligations carried into the resumed run.

## Task E — Minecraft companion

> JARVIS, join my locally opened Minecraft Java LAN world as JarvisBuddy. Confirm spawn and my username. Follow me and report distance. Attempt a bounded wood-gathering task and inspect inventory afterward. If the bot cannot join or the world is incompatible, report the concrete error; do not claim gameplay.

Expected evidence: genuine Mineflayer game connection and live bot position/inventory events. Native mouse control of the human game is **not** the same as an independent second player.

**Verdict rule:** only actual Windows receipts and independently checked results can mark a gate PASS. Otherwise FAIL/BLOCKED/NOT_TESTED. Full V1 still requires native LPAC/RLM and wider capability acceptance.
