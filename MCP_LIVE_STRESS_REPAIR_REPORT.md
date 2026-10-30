# JARVIS V1 MCP / Skills / Tools — Protocol Repair & Stress Test (2026-10-28)

## Source lineage
Modified a **copy** of `JARVIS_V1_GPT6_UNIVERSAL_MCP_SKILLS_TOOLS_FULL_SOURCE_2026-10-28.zip`. No prior Windows project or protected Track A checkout was modified.

## Verified defects and repairs
1. **MCP version mismatch:** Existing HTTP code advertised `2026-07-28` but issued `initialize`/`initialized` requests. Official 2026 MCP is stateless; older 2025 protocol uses handshake and optional sessions. Repaired HTTP client negotiates modern `server/discover` and per-request `_meta`, or falls back to a 2025-11-25 handshake if the server explicitly rejects the modern protocol. Enforces `Mcp-Method`, `Mcp-Name`, exact JSON-RPC IDs, byte-size limits, and UTF-8 stream reassembly. Stdio retains compatible legacy handshake.
2. **Orphaned install after quota:** `stageFromDirectory` copied files **before** verifying the owner had fewer than 50 integrations. A rejected 51st install left an orphan directory. Staging is now serialized per owner; quota checked before copying; copied directory cleaned up on failure. Also rejects a symlink selected as source root.
3. **Ambiguous ZIP archive entries:** Prior extractor accepted duplicate archive names, allowing later content to shadow earlier content. It now validates the entire ZIP manifest before extracting, rejecting duplicates, Unicode/case collisions, Windows device names, trailing dots/spaces, symlinks, traversal, oversized entries and disallowed special files; uses exclusive creation for files.

## Recorded completed test results

| Test | Completed outcome | Scope |
|---|---:|---|
| Strict modern + legacy MCP HTTP | 8/8 rounds | Actual loopback servers using JSON-RPC 2.0, strict protocol checks |
| Real local MCP tool calls | 6,264 succeeded | Echo, sum, SSE notifications, Unicode, tool discovery, wrong-name rejection |
| Local MCP HTTP requests | 27,482 | Initialize negotiation, discovery, listing and calling |
| Strict protocol harness checks | 35,759 passed | Including synthetic GitHub URL fixtures and skill staging |
| Hostile MCP / owner quota | 16,996 passed | 100 normal calls, 500 malformed response rejections, 135 simultaneous installs |
| Hostile HTTP requests | 1,800 | Oversized, malformed, SSE ID mismatch, errors |
| ZIP extraction checks | 270 passed | Real in-process Python extraction in disposable filesystem directories |
| Repeated legacy/focused regression | 24/24 passed | 3 rounds of 8 tests (MCP, native, LAYA, autonomy, long-run) |
| Syntax parsing | 117 JS/TS, 19 Python | 0 parse errors |

## What these results **do not** establish
- No public GitHub repository was actually downloaded and installed in this sandbox; GitHub URLs and installed packages were **local synthetic fixtures**.
- No authenticated third-party MCP provider, OAuth handshake, npm/uvx automatic dependency installation, or Windows-native GUI integration was exercised.
- A full Next.js production build and live hardware/PC workflow were **not** performed; this environment lacks Bun, Windows, and a configured model profile.
- Not every possible security issue can be exhausted with a finite test matrix. TLS DNS rebinding, remote package supply-chain risk and executable plugins remain separate security concerns; Guardian owner approval must remain mandatory.
- MCP tools can return success without proving external side-effects. Existing JARVIS effect auditing and verification gates must remain enabled.

## On-device instructions
Extract this version into a **new Windows test directory**. Preserve the existing private `.env`, model vault key and database. Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\RUN_MCP_LIVE_STRESS.ps1
```

For full application acceptance, then run `bun install --frozen-lockfile`, `bunx prisma generate`, `bunx tsc --noEmit`, `bun run lint`, and `bun run build` from the project root. Only after these pass start `bun run dev:windows`, stage a real public GitHub skill via Settings, approve it, test a live external MCP server, and observe a genuine JARVIS task calling it.

**Release verdict:** PASS for bounded local protocol and adoption tests; **Windows and external-provider acceptance pending**.
