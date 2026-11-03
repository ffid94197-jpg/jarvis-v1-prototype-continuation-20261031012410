# Prototype JARVIS — external-research integration ledger (2026-11-03)

## Engineering rule

This is **one existing JARVIS**: Core owns planning and durable task state; Guardian authorizes side effects; LAYA only advises on model routing; Windows Companion is a bounded execution adapter. No external standalone agent or autonomous shell is given authority. PC Work JARVIS at `D:\jarvis_pc_work` remains untouched. All edits in this changeset are prototype-only and marked `[skip ci]`, to conserve GitHub Actions minutes.

## Source components and what has actually been integrated

| Upstream candidate | Pinned revision | Native prototype capability / limitations |
|---|---|---|
| Microsoft UFO² (previous PR #14) | `eae3c0a8d168c47cb10df0652e293e092eda1078` | Read-only native UIA name grounding (already merged); no UFO² HostAgent/AppAgent. |
| LangGraph | `3c916d750575b22c464790e9774494d810ccd322` | **Inspired by its persisted checkpoint and safe resume discipline**: exact routine attempt/task/cursor matching in the existing Windows long-run worker. No `@langchain/langgraph` dependency or second graph executor. |
| OpenHands Software Agent SDK | `b0789c73151a967fdd4a10f8383d2c0bc7109563` | **MIT code adaptation** from `openhands-sdk/openhands/sdk/utils/redact.py`, blob `40bea01d5c08cf6b4bd0108c2ddb941891a6a7c1`; redact nested secret-bearing keys and tool-output authorization headers before model-visible MCP receipts. Licensed notice is preserved in `src/lib/agent/adoption/licenses/OPENHANDS_MIT_LICENSE.txt`. Does NOT import its separate file editor, terminal runner, LLM agent, or Agent Server. |
| Browser Use | `b49a68e4060acb226da8f784194fef301c53a6d7` | **Behavioral adaptation (original implementation)**: optional plain-language filtering of real, visible Playwright link and search-field observations. Maintains short-lived page token and original checked indices; no generated selectors, arbitrary click JS, external Browser Use agent, or new browser profile. |
| OmniParser | `354021201345a96178360b28733573e27269f2de` | **Optional read-only local adapter** for `parsed_content_list`, normalized bounding boxes and an operator-started loopback `POST /parse` model. No model weights, OCR dependencies, or remote service bundled. Local screenshot inference requires three explicit opt-ins and a >=32-character token; results cannot authorize clicks. The upstream code is CC BY 4.0; specific upstream detection/caption model weight licenses vary, see upstream README. |
| Mem0 | `753496cf1435d76c3a711f3af51303f7fdcb6420` | **Behavioral adaptation (original implementation)**: bounded lexical retrieval on the existing authenticated owner-only database records, with deleted records excluded; no automatic cloud forwarding or model-context injection. Does NOT import full Mem0 embedding/vector, self-hosted service, or memory inference. |
| OpenClaw | `5918b1d7bf4bca308322e0c0a7f5b5acb1311d48` | **Selective pinned read-only skill staging**: `skill-creator` and `healthcheck` from official `SKILL.md`, downloaded individually (no 12 GB repo archive), stored as staged owner-specific untrusted instructions requiring explicit approval before viewing. MIT notice retained in staged package. No OpenClaw gateway, CLI, shell commands, or competing agent loop. |

Upstream links:
- https://github.com/langchain-ai/langgraph
- https://github.com/OpenHands/software-agent-sdk
- https://github.com/browser-use/browser-use
- https://github.com/microsoft/OmniParser
- https://github.com/mem0ai/mem0
- https://github.com/openclaw/openclaw

## Focused offline checks (without GitHub Actions)

On the Windows prototype checkout, with dependencies already installed:

```powershell
node scripts/longrun/verify-longrun.mjs
node scripts/verify-memory-contracts.cjs
node scripts/adoption/verify-adoption.mjs
python windows-companion/verify_agent_tools_offline.py
python windows-companion/verify_omniparser_offline.py
node scripts/verify-windows-policy.cjs
npx tsc --noEmit
```

These checks are not equivalent to complete deployment acceptance. No rerun of unrelated, already passing suites is requested.

## Special configuration and safety

OpenClaw text-only staging, after explicit owner instruction in JARVIS, uses either:

`https://github.com/openclaw/openclaw/tree/main/skills/skill-creator`

or

`https://github.com/openclaw/openclaw/tree/main/skills/healthcheck`

The importer always pins the source commit, checks bounded UTF-8 metadata, preserves the MIT license and returns a **staged** owner-specific item. Owner approval in Settings → Integrations is still required. Neither skill provides command execution authority.

OmniParser is disabled by default. To use it, an owner must separately install/run a **local compatible** `POST /parse` service that wraps their legitimate, appropriately licensed OmniParser model, with a bearer token, loopback-only bind, and a JSON response containing `parsed_content_list`. The caller uses the hard-coded address `127.0.0.1`, bounded port, bounded screenshot and response sizes, and a short timeout. Set `JARVIS_OMNIPARSER_ENABLED=1`, `JARVIS_SCREEN_WATCH_ENABLED=1`, `JARVIS_EXPERIMENTAL_DESKTOP_CONTROL=1`, a private `JARVIS_OMNIPARSER_PORT`, and a 32+ character `JARVIS_OMNIPARSER_TOKEN` only on the isolated owner Windows test PC. Do not run it in an untrusted environment. Detector output is advice only; it never yields a Guardian authority or a clickable element ID.

## What remains NOT VERIFIED / NOT COMPLETE

- Real Windows node/python sidecar, installed dependencies, TypeScript production build, model access, encrypted credential storage and authorizations on the owner PC.
- Live browser navigation or memory DB integration with changed APIs.
- OmniParser model weights/server: not bundled; this is an adapter, not a full model deployment.
- Full OpenHands autonomous software-engineering runtime, complete LangGraph state-engine, Browser Use's agent, Mem0 backend, and OpenClaw gateway are **not installed**: the selected capabilities above are intentionally smaller, which preserves JARVIS's sole-Core design.
- Extended Minecraft unknown-seed live gameplay and Dragon/Netherite end-to-end Java LAN acceptance remain blocked. This integration work provides no evidence of Minecraft victory.

**Verdict:** Selective component integration candidate with bounded code changes, **NOT FULL UPSTREAM MERGE**, **NOT V1 RELEASE ACCEPTED**. Only declare stronger outcomes after independent local/full-stack tests and actual Windows live acceptance.
