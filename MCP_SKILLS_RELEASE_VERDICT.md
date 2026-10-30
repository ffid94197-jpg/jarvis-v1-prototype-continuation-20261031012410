# JARVIS V1 — MCP/Skills/Tool Adoption Release Verdict

Date: 28 October 2026

## Implemented in the actual source

- Owner-managed extension registry, persisted in `data/jarvis-adoptions` rather than mixed into model credentials.
- New Console Settings tab **SKILLS · MCP · TOOLS**, enabling GitHub URL staging, package inspection, review/approve, disable/remove, skill viewing and MCP connection tests.
- GitHub public-repository staging with archive size caps, safe ZIP extraction, and no auto-running install scripts.
- Detection for Agent Skills `SKILL.md` metadata, Claude/Codex plugin manifests, `.mcp.json` and common Cursor/VS Code/Gemini MCP JSON configurations.
- Missing runtime/dependency summaries read from `package.json`, `requirements.txt` and `pyproject.toml` (inspection only).
- MCP JSON-RPC stdio (Node/Python script inside the reviewed package) and HTTP POST (local HTTP/public HTTPS) tool discovery and invocation, plus list-resources/prompts transport operations.
- New agent tool calls through Core → Guardian audit → durable effect admission → executor: `adoption_stage_github`, `adoption_list`, `adoption_skill`, `adoption_mcp_list`, `adoption_mcp_call`. Skills are untrusted instructions, not higher-priority agent commands.
- Enabled integration metadata in the initial JARVIS planner context. No skill can modify Guardian permissions.

## Evidence run (local Linux simulation)

- 5 full rounds of the new adoption test: **20,675 passed assertions; zero failures**.
- Each complete round includes 2,000 GitHub-link cases and negative URL cases, real stdio and local HTTP MCP protocol handshakes + tool calls, refusal before approval, cross-owner isolation, enable/disable/remove operations and malformed tool calls.
- Safe ZIP extractor: **4/4 adversarial path/size cases passed**.
- Previously implemented autonomy supervisor: **53/53**; full desktop policy: **38/38**; native UIA policy: **25/25**; LAYA owner priority: **4,000/4,000 routing decisions, 9,772 assertions passed**.
- Source transpilation/parser: **108 TS/TSX/JS files, 0 syntax diagnostics**.

## Not yet verified / not implemented

- An actual public GitHub download using the Windows computer and actual public MCP provider authentication was **not** tested in this environment.
- Full Next.js production compilation/lint with installed Bun dependencies and live Windows native control was **not** tested here.
- OAuth, arbitrary npm/uvx installation, native executable/package-manager scripts, MCP Apps rendering, protocol sampling, elicitation and provider-specific plugin hooks are **not** supported in this release.
- StdIO child processes execute code with the current Windows user's OS privileges after owner approval: **no OS sandbox**, do not enable untrusted packages.
- JSON-RPC interoperability is a baseline, not complete coverage of all MCP versions and proprietary agent integrations.
- MCP tools that perform external side effects report server receipts, not independent verification of the remote application.

**Verdict:** Offline integration and regression simulations PASS; **Windows live acceptance and broad universal compatibility NOT YET CERTIFIED**. The package is an engineering candidate for a trusted localhost test environment, not a claim that every AI plugin/tool works without an adapter.
