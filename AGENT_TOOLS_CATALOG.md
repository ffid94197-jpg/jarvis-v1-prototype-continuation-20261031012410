# JARVIS V1 — Integrated agent tools (source candidate)

**Release status: NOT COMPLETE.** This catalog distinguishes implemented source contracts from proven live Windows behavior. The package is based on the 27 October 2026 Windows Desktop Companion code supplied in this conversation. It does not merge the owner's separate protected `D:\jarvis_pc_work` checkout or newer changes not present in the distributed source.

## Existing tools retained

- **Workspace:** `create_folder`, `write_file`, `read_file`, `list_dir` under Guardian relative-path scope; readback verification where applicable.
- **Read-only commands:** Guardian allowlist `run_command`; some shell utilities are not available on native Windows and have not been made cross-platform in this update.
- **Windows actions:** `windows_open_url`, `windows_open_app`, `windows_youtube_oldest`, `windows_watch_screen`.
- **Minecraft LAN foundation:** `minecraft_companion_join`, `minecraft_companion_stop` (optional Mineflayer helper; no automatic world creation or independent survival-game intelligence).
- **Memory:** existing owner-scoped memory API and NEXUS Text Mode management; it is not a general unrestricted planner tool.
- **Models:** OpenAI-compatible HTTPS providers such as Gemini; opt-in local Ollama. LAYA remains advisory; Guardian is authoritative.

## Eight new Guardian-audited Windows tools

| Tool | Arguments | Operator scope | Actual effect |
|---|---|---|---|
| `windows_browser_search` | `{"query":"..."}` | `JARVIS_BROWSER_AGENT_ENABLED=1` | Opens a public web-search results page in the dedicated Playwright browser. |
| `windows_browser_inspect` | `{}` | Browser opt-in | Lists up to 40 visible public links / search inputs and issues a fresh `pageToken`. Never extracts input values. |
| `windows_browser_read_page` | `{}` | Browser opt-in | Reads at most 6,000 visible text characters from the current tab; content is untrusted. |
| `windows_browser_click_link` | `{"index":0,"pageToken":"..."}` | Browser opt-in | Navigates directly to the previously inspected public HTTPS href; does not fire DOM click handlers. |
| `windows_browser_fill_search` | `{"index":0,"pageToken":"...","text":"..."}` | Browser opt-in | Fills a verified search input and presses Enter. No password, payment, or arbitrary form fields. |
| `windows_browser_scroll` | `{"direction":"down","pages":2,"pageToken":"..."}` | Browser opt-in | Scrolls 1–5 screen heights within the inspected page. |
| `windows_list_windows` | `{}` | `JARVIS_WINDOWS_UI_CONTROL_ENABLED=1` | Lists visible windows only from the process allowlist: Notepad, Calculator, Explorer, Paint. |
| `windows_focus_app` | `{"app":"notepad"}` | Window opt-in | Requests foreground focus for an allowlisted app and checks foreground handle. No arbitrary input. |

The new tools still require `JARVIS_WINDOWS_AGENT_ENABLED=1`, local-dev session flags, a strong private sidecar bearer token, Guardian authorization and durable auditing. The Windows supervisor supplies the private sidecar token. **Neither `.env` nor API keys are packaged.** If the Guardian audit or effect admission fails, an effect must not be executed.

## Activate on the user's isolated Windows checkout

1. Preserve the existing private `.env`, SQLite database, `node_modules` and working Gemini model (`gemini-3.5-flash-lite` as user-tested). Do not delete anything or copy these secrets into chat.
2. **Recommended:** use the accompanying hash-checked `Apply-AgentTools.ps1` overlay on the existing `D:\glm 5.3\GPT6_TEST\JARVIS_V1_Windows_Desktop_Companion_2026-10-27` checkout. Dry-run first; abort on a modified-source conflict. This avoids reinstalling 827 packages.
3. In your existing private `.env`, add `JARVIS_BROWSER_AGENT_ENABLED="1"`. Add `JARVIS_WINDOWS_UI_CONTROL_ENABLED="1"` **only** to test allowlisted window focus. Keep `JARVIS_PUBLIC_ORIGIN="http://127.0.0.1:3000"`.
4. Run `bun run test:agent-tools-offline`, `bunx tsc --noEmit`, `bun run lint`, and `bun run build` on Windows. Full production status requires these gates.
5. Stop any existing port-3000 JARVIS instance, then run `bun run dev:windows`. Open `http://127.0.0.1:3000`.
6. Example: *"Open YouTube, search for MrBeast, inspect the page, and open the official channel."* Use a separate explicit request for oldest-upload playback if needed; the existing `windows_youtube_oldest` tool handles that workflow.
7. Example: *"Open Notepad, then list and focus its window."* The agent cannot yet type arbitrary content into desktop programs.

## Security and privacy boundaries

- Browser is a **dedicated disposable Playwright Chromium profile**; it is not the user's logged-in Chrome account. Web search queries and visited-page requests are sent to external websites. Retrieved page text may be sent to the configured model for planning. Treat page text as **untrusted**; never obey instructions embedded in it.
- The companion rejects direct private/loopback URLs and direct IP-literal navigation; it is **not** a production-grade proxy or network isolation boundary. It cannot certify absence of DNS rebinding or unsafe redirects in every scenario.
- Browser links navigate directly by inspected HTTPS href rather than firing a page's click handlers. This prevents one class of DOM side effects but does **not** prove a GET request is consequence-free. Do not automate financial, destructive, login, posting or other sensitive web flows.
- The live screen feed remains opt-in and locally sampled (~3 FPS); sending screen images to a cloud vision model requires separate explicit opt-in `JARVIS_SCREEN_VISION_TO_CLOUD=1`.
- Do not expose local passwordless development mode to a LAN, proxy, tunnel, or public host. A person with local computer access may control the dev instance.
- Windows process focus does not grant mouse/keyboard text input. All new operations are bounded, allowlisted, and double-checked by TypeScript Guardian policy and the Python sidecar.

## Tests and remaining acceptance

`bun run test:agent-tools-offline` runs static wiring, TypeScript policy, original Python sidecar policy, and new simulated browser policy tests. No live Windows, browser, Gemini, Minecraft, device hardware or end-to-end task completion is certified by these offline tests. Native LPAC/RLM, general app input, full autonomous Minecraft world creation/playing, cross-device, and V1 final security gates remain incomplete.


## Windows app-control extension (October 27)

`windows_open_settings` opens selected real Windows Settings pages; `windows_discover_apps` lists approved installed aliases; `windows_open_app` now supports Chrome/Edge/Firefox/VS Code and operator-approved local `.exe` paths. See `WINDOWS_APP_CONTROL.md`. All actions use the existing Guardian/durable pipeline. Live Windows results are not certified.

## Native Windows control tools (NEW)

- `windows_native_open_url` opens public HTTPS links in the user-selected **default Windows browser**, not a separate Playwright Chromium session.
- `windows_native_inspect` enumerates actual foreground app accessibility controls through Windows UI Automation (UIA), returning short-lived opaque element IDs and screen bounds.
- `windows_native_action` invokes/focuses inspected controls or sets bounded text with exact UIA readback when supported. For complex tasks, inspect again after any navigation and verify external effects.

These new tools require the same explicit local desktop-control flag and existing Guardian/audit pipeline. UIA may not expose custom game GUIs, protected desktops or certain Chrome content. Mouse/keyboard + the continuous screen-vision loop remain available as fallbacks. Real laptop tests are mandatory.
