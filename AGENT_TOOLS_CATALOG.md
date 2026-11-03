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
- `windows_native_inspect` enumerates actual foreground app accessibility controls through Windows UI Automation (UIA), returning short-lived opaque element IDs and screen bounds. Optional `{"query":"Save"}` uses a pinned MIT UFO²-derived **read-only lexical control filter** over actual foreground UIA candidates. No matching control → no actionable elementId. This does not invoke UFO² HostAgent/AppAgents or bypass Guardian.
- `windows_native_action` invokes/focuses inspected controls or sets bounded text with exact UIA readback when supported. For complex tasks, inspect again after any navigation and verify external effects.

These new tools require the same explicit local desktop-control flag and existing Guardian/audit pipeline. UIA may not expose custom game GUIs, protected desktops or certain Chrome content. Mouse/keyboard + the continuous screen-vision loop remain available as fallbacks. Real laptop tests are mandatory.

## Native coding edit — November 3, 2026

The OpenHands-inspired source-edit slice now exposes `edit_file` as a
first-class **JARVIS Core + Guardian** tool, not as a separate agent.

- `read_file` returns `sha256` only for a *full untruncated* file read.
- `edit_file` accepts `path`, `expectedSha256`, `oldText` and `newText`.
- Guardian requires a workspace-relative path, audited authorization, a full
  64-character lowercase SHA-256 and fragments of at most 1500 UTF-8 bytes.
- The executor requires an existing regular UTF-8 file, a digest match, and
  exactly one occurrence of `oldText`; it stages into a same-directory
  temporary file, rechecks the source digest before rename, and verifies
  the result by reading back the file.
- Every call is durably admitted before file modification; crash-interrupted
  edits are conservatively `EFFECT_UNKNOWN` and **never automatically retried**.
- No new shell, repository-wide permissions, external OpenHands executor,
  GitHub Actions dependency or full coding-agent certification.
- Focused regression command: `node scripts/verify-native-code-edit.cjs`.

**Important:** the rename is not a cross-process filesystem transaction.
Changes by uncooperative external writers can still race; real Windows,
permissions, file-locking, model and release behavior remain unverified.

## Owner-approved memory recall (November 3, 2026)

`memory_recall` is a **read-only JARVIS Core tool**, not a separate Mem0
agent. Owner-managed memory remains stored in JARVIS's existing local database.

- Disabled by default. The owner must intentionally set
  `JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED=1` on the **trusted JARVIS server**
  before the planner can request memory in an explicitly requested task.
- Guardian validates the authenticated owner context, query bounds, and
  maximum five results. The model cannot choose a different owner ID.
- Executor additionally enforces `dataClass=CLOUD_APPROVED`,
  `principalId=authenticated owner`, and `deletedAt=null` in Prisma
  **before** returning any record. `LOCAL_PRIVATE` memories never enter
  model-visible tool results. No automatic private-memory import, embeddings,
  or cloud storage.
- Records are explicitly marked as owner-reported and not independently
  verified; no personal memory is promoted to Guardian authority.
- Focused opt-in/cross-owner mock contract:
  `node scripts/verify-native-memory-recall.cjs`.

This is still an owner-requested memory retrieval capability, not the full
Mem0 embedding or consolidation platform. End-to-end Prisma/provider privacy
acceptance is required before production use.

## November 3 — native research-derived Core capabilities

- `edit_file`: Guardian-audited, workspace-relative, expected-SHA-256 text replacement; exact-one-match, staged readback and durable effect journal.
- `memory_recall`: explicit owner opt-in; returns only same-owner `CLOUD_APPROVED` memory records.
- `world_recall`: same opt-in and owner binding; queries current temporal World Model observations, filtering retracted/expired rows before ranking. Results include provenance and are explicitly marked context-only; they never authorize actions.
- Memory retrieval uses deterministic phrase/key, token-coverage, Unicode and bounded recency signals. It is not embedding/vector search.
- Optional faster-whisper is an additional local STT backend. Vosk remains the default; Piper `jarvis-high` remains the selected TTS. See `FASTER_WHISPER_LOCAL_STT.md`.

These tools remain inside the one JARVIS Core/Guardian path. No upstream agent is granted independent execution or permission authority.
