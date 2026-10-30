# JARVIS V1 — Managed extension adoption (28 October 2026)

## What is implemented

A new **Settings → SKILLS · MCP · TOOLS** panel lets the owner submit an HTTPS GitHub repository (including a `/tree/branch/subfolder` link) or a remote Streamable HTTP MCP endpoint. A GitHub package is fetched from GitHub's archive API, safely extracted with limits, inspected for supported manifests, copied into the private `data/jarvis-adoptions` store, and marked **STAGED**. Nothing from the repository is executed during discovery or staging. The owner must review and explicitly click **APPROVE / ENABLE** before JARVIS can activate it.

Package detection includes Agent Skills `SKILL.md` with YAML frontmatter (Claude, Codex, Gemini CLI, Cursor, OpenClaw and other clients that use the portable spec), Claude `.claude-plugin/plugin.json`, Codex `.codex-plugin/plugin.json`, `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` and `.gemini/settings.json` MCP definitions.

Enabled skill metadata is supplied to the JARVIS task planner. The agent can call `adoption_skill` to load an approved skill's instructions on demand. These are untrusted reference text and cannot override the Core, Guardian, or the operator. Enabled MCP servers expose live tool lists and can receive `tools/call` requests, with Guardian audit and durable effect-admission records. Read-only tool listings and MCP calls are separate; a successful MCP response does **not** independently prove effects in the external application. The owner may disable or remove an integration.

## User experience

1. Open **NEXUS Console → Settings → SKILLS · MCP · TOOLS**.
2. Enter `https://github.com/OWNER/REPO`, or a supported `/tree/BRANCH/SUBFOLDER` link. For remote endpoints check **Direct MCP HTTP endpoint**, then enter an HTTPS URL (or localhost HTTP).
3. Click **DOWNLOAD / STAGE FOR REVIEW**. Inspect detected skills and MCP servers in the result.
4. Click **APPROVE / ENABLE** for extensions whose code and permissions you trust.
5. Click **TEST** to discover the actual MCP tools. A source package with a missing language runtime or dependencies is not a working MCP server just because the package was downloaded.
6. Ask JARVIS for tasks using approved capabilities. It will use `adoption_list`, `adoption_skill`, `adoption_mcp_list` and `adoption_mcp_call` under Guardian.

Example voice or text request: **“Jarvis, download and inspect the skill at https://github.com/owner/repo. Show what it can do and tell me when it needs approval.”** Another: **“Jarvis, list my approved MCP tools and use the weather tool to get today's forecast.”**

## Supported baseline and honest limitations

| Component | This release |
|---|---|
| Portable Agent Skills (`SKILL.md`) | Discovery, install staging, metadata listing, on-demand instructions |
| Claude and Codex plugin manifests | Detect and stage; plugin hooks, agents and lifecycle scripts not auto-executed |
| GitHub install link | Public HTTPS repository snapshot, limited single-component branch refs and optional subfolder |
| Cursor/VS Code/Gemini MCP JSON | Detect `mcpServers`/`servers` and attempt compatible servers |
| Remote MCP | JSON-RPC POST Streamable HTTP; JSON and bounded SSE replies; tools and discovery |
| Local MCP (stdio) | Approved `node`, `python`, `python3` entrypoints inside an installed package, without shell |
| MCP resources/prompts | Basic list introspection in transport; no full rich-client workflows |
| npm/uvx/OAuth/remote auth | **Not supported automatically**. Required packages, keys or OAuth must be separately set up with owner approval |
| MCP Apps, elicitation, sampling, tasks, arbitrary protocol extensions | **Not yet implemented** |
| Proprietary plugin APIs | Adapter needed; **not all vendor features work by copying a manifest** |

Remote MCP allows HTTPS public endpoints, and explicit localhost HTTP. The HTTP adapter implements a core subset of MCP, not all protocol versions or stateful/client-initiated capabilities. Local MCP servers are third-party executable programs; they run with the Windows user's privileges after the owner approves them. The registry does not provide OS sandboxing. Use only trusted code, verify GitHub maintainers/dependencies, avoid giving unknown tools credentials, and keep the JARVIS emergency stop available. The bundled regression tests use simulated services; real provider and Windows execution are not validated in this Linux build environment.

## Test and install

From the extracted full-source folder on Windows, preserve your `.env`, vault credentials and existing database in a safe location. Use a new development folder and test DB first. Run:

```powershell
bun install --frozen-lockfile
bunx prisma generate
bunx prisma db push
bun run test:adoption-offline
bunx tsc --noEmit
bun run lint
bun run build
bun run dev:windows
```

No extra npm dependencies are introduced by the extension baseline. The GitHub download and validation helpers require Python already used by the Windows Companion. Managed integration files are persisted under `data/jarvis-adoptions` and intentionally excluded from version control and source ZIPs.
