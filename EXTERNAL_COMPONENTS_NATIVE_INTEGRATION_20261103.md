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

## November 3 continuation — runnable runtime additions

- Added `windows-companion/omniparser_server.py`, a **real optional
  localhost HTTP model driver** that loads the pinned official
  `util.omniparser.Omniparser` from a separately installed, revision-checked
  Microsoft source checkout. It uses the official v2 detector/Florence config.
  Strong bearer authentication, bounding, fixed loopback binding, serialized
  requests, no screenshot logs, and a PNG-only request contract are enforced.
  This is a model *driver*, not an agent authority. Official model weights are
  **not bundled** and were **not loaded** here.
- Added a focused `verify_omniparser_loopback_offline.py` test against the
  actual HTTP handler with stub inference (8 request/denial assertions, including PNG dimension rejection, in a
  local equivalent harness; live model not tested). See
  `OMNIPARSER_LOCAL_RUNTIME.md` for owner Windows installation/flags.
- Local owner memory search now asks Prisma to filter owner-scoped, non-deleted
  matching records **before** taking the 500-row ranking window. The API
  explicitly labels potentially truncated searches; it does not imply
  exhaustive semantic/vector matching. A route fixture covers old records
  outside the original 500-newest window.
- One local, Windows-native acceptance script
  `scripts/verify-external-integrations-local.ps1` runs changed offline gates
  without GitHub Actions and records `NOT_RUN` for the live PC/model/Guardian
  and Minecraft gates.

**No change to the safety boundary:** JARVIS Core and Guardian stay sole
authority, and no completion proof is inferred from test fixtures.

## What remains NOT VERIFIED / NOT COMPLETE

- Real Windows node/python sidecar, installed dependencies, TypeScript production build, model access, encrypted credential storage and authorizations on the owner PC.
- Live browser navigation or memory DB integration with changed APIs.
- OmniParser official weights are not bundled; a local pinned-source model driver is now included but has not been installed on Windows or run with real model weights. This is not full model deployment.
- Full OpenHands autonomous software-engineering runtime, complete LangGraph state-engine, Browser Use's agent, Mem0 backend, and OpenClaw gateway are **not installed**: the selected capabilities above are intentionally smaller, which preserves JARVIS's sole-Core design.
- Extended Minecraft unknown-seed live gameplay and Dragon/Netherite end-to-end Java LAN acceptance remain blocked. This integration work provides no evidence of Minecraft victory.

**Verdict:** Selective component integration candidate with bounded code changes, **NOT FULL UPSTREAM MERGE**, **NOT V1 RELEASE ACCEPTED**. Only declare stronger outcomes after independent local/full-stack tests and actual Windows live acceptance.

## November 3 coding-tool continuation

Prototype JARVIS also gains a native **edit_file** primitive for bounded
incremental source changes, inspired by OpenHands' verified coding workflows
without importing a competing agent. The input requires a full observed
read_file SHA-256 and exactly one matching snippet. Guardian authorizes
workspace containment and audits, Core records the write intent in the
durable effect admission table, and the executor stages, rechecks and
reads back actual bytes. Crash-unknown edits never replay automatically.
`node scripts/verify-native-code-edit.cjs` and the local Windows
acceptance runner cover targeted regressions.

The source-edit module passed **7 isolated real temporary-filesystem
checks** in a Linux tool container using the exact module, with a mocked
Guardian path predicate. The complete test-suite, live database,
LLM-driven coding task and owner Windows environment have NOT been
verified. This does not equal full OpenHands SDK integration.

## November 3 owner memory bridge continuation

Added a **native read-only `memory_recall`** call in Core and Guardian.
Its only input is an owner-intent search query and limit <=5. The server
operator must explicitly enable `JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED=1`,
and the authenticated owner is injected by Guardian rather than trusted from
the model. The executor filters `principalId`, `deletedAt=null`, and
`dataClass=CLOUD_APPROVED` at the database level; `LOCAL_PRIVATE` is never
returned to the model. Output carries unverified owner-provenance labels and
a bounded content preview.

A focused mocked security suite
`node scripts/verify-native-memory-recall.cjs` covers disabled-by-default,
owner isolation, data-class denial, forged owner, cancellation, and audit
redaction. Actual owner Windows/Prisma/provider execution is not certified.
This is a capability slice, **not full Mem0 SDK/runtime**.

## November 3 connector security continuation

The OpenHands-derived MCP redaction layer now recognizes common camelCase,
snake_case and dashed API keys, session tokens, credentials and nested headers.
Untrusted MCP error messages are no longer forwarded into the Core as
error prose. This is a defensive filter, not a guarantee that arbitrary
unstructured output contains no secrets.

For external HTTPS MCP servers, the Node transport now resolves **all**
A/AAAA answers, rejects restricted/reserved/loopback and tunneled prefixes,
and pins a validated IP directly to each new non-pooled socket's DNS lookup.
The original hostname remains the TLS SNI and certificate verification name.
The address is validated again at connection time so DNS rebinding between
discovery and actual tool call cannot redirect the request to private network
services. Redirects, credential-bearing endpoint URLs and IP literals are
rejected. Loopback-only HTTP MCP remains supported for user-controlled local
test servers.

Owner approval of third-party MCP code is not an OS sandbox. Therefore
**stdio MCP subprocesses are disabled by default**; running a local package
script requires an additional explicit
`JARVIS_UNSANDBOXED_MCP_STDIO_ALLOWED=1` operator development opt-in on an
isolated machine. This override is *not* an LPAC/Guardian confinement proof.
External tools still require Guardian authorization and effect journaling.

The focused test script `node scripts/adoption/verify-mcp-pinned.mjs`
exercises public/private address policy, redaction and a mocked HTTPS
socket-level DNS pin. Actual public network TLS, DNS infrastructure, Windows
LPAC, full MCP SDK and production acceptance remain NOT VERIFIED. No new
external agent is granted Core authority.

## November 3 — recovered global component-harvest continuation

The complete recovered candidate inventory and explicit KEEP / WRAP / HYBRID /
REFERENCE-ONLY / DEFER / REJECT decision for each item is now recorded in
`RESEARCH_COMPONENT_INTEGRATION_MATRIX_20261103.md`. It reconciles the seven
shortlisted components with the broader archive inventory (Pydantic AI,
Temporal, OPA, NeMo, Prompt Guard 2, memory candidates, visual computer-use
systems, Stagehand, mini-SWE, E2B/Firecracker, realtime voice, STT, vision,
Home Assistant, OTel, vector stores, source scanners and SBOM tools) and the
earlier Minecraft/agent research (Hermes, Agent Zero, Voyager, SIMA 2,
Gemini Argon and Deep Agents).

Two further useful native behavior slices are being added in this continuation:

- `faster-whisper` 1.2.1 (MIT code) is an optional local STT adapter. It requires
  a separately installed compatible package and locally provisioned
  CTranslate2 model; it uses `local_files_only=True`, bounded 16 kHz PCM and
  no model download during a voice request. Vosk remains the default and
  Piper remains the owner-selected TTS. Model-weight terms remain separate.
- PropMem/SimpleMem-inspired retrieval improvements add normalized Unicode
  tokens, exact phrase/key boosts, term coverage and bounded recency ranking
  to the existing owner-scoped store. This remains deterministic lexical
  retrieval, not an embedding or graph database.

Focused local test sources are included in the existing Windows-only acceptance
runner. No test run or live owner-PC/model acceptance is claimed in this branch.

## November 3 — memory, temporal facts and local voice follow-on

- The existing memory ranking now uses normalized Unicode tokens, exact key
  and phrase boosts, term coverage, stable tie-breaking and a bounded
  recency bonus. This borrows useful PropMem/SimpleMem retrieval ideas but
  remains deterministic lexical search; no semantic embedding or graph
  retrieval is claimed.
- Added `world_recall` as a read-only Core tool under the same explicit
  `JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED=1` owner opt-in. It binds the
  authenticated owner in Guardian and filters `principalId`,
  `retractedAt=null`, and null/future `expiresAt` in Prisma before ranking.
  Returned records retain source, provenance, confidence and timestamps and
  are explicitly marked `context_only` / `neverAuthorizesActions`.
  It is a native temporal World Model bridge inspired by Graphiti, not the
  Graphiti runtime or a graph database.
- Added an optional `faster-whisper==1.2.1` local STT backend. It loads only
  an existing CTranslate2 model directory with `local_files_only=True`;
  Vosk remains the default and Piper remains the owner-selected TTS. The
  optional dependency/model are not installed or bundled.
- Added offline test sources for Unicode/phrase/recency retrieval,
  owner/expiry/retraction/context-only world recall, and the faster-whisper
  adapter. They are included in the Windows-local acceptance runner; they
  have not been run on the owner's PC or against real models/Prisma.

## November 3 acceptance-hardening follow-on

- SQLite `contains` matching is not a reliable Unicode case-folding layer.
  Owner memory and temporal World Model recall now retrieve only a bounded
  500-row same-owner slice (with deleted/private and expired/retracted
  filtering enforced in Prisma), then apply Unicode NFKC/case-fold ranking in
  the local executor. Results remain capped at five and no other owner's rows
  are fetched. The test fixture asserts the owner/classification/temporal
  predicates and the 500-row bound, including Tamil query examples.
- Corrected faster-whisper's segment join to normalize provider-specific
  whitespace and added tests for the 0.1–12 second PCM bounds and odd byte
  lengths. The Python/CTranslate2 wheel compatibility check is documented;
  do not alter the existing Windows Companion Python environment if no
  compatible wheel exists.
- Source-level verification performed in this continuation: the actual
  TypeScript ranking implementation passed isolated phrase/key, recency,
  Unicode and stopword checks; changed JavaScript test files passed syntax
  parsing; source wiring for Guardian/executor/opt-in and local runner was
  inspected. These checks do **not** substitute for executing the Windows
  acceptance runner or real Prisma/model inference.

- Closed an upstream faster-whisper offline fallback: if a local CTranslate2
  folder omits `tokenizer.json`, the library can call
  `Tokenizer.from_pretrained("openai/whisper-tiny")`; the model's
  `local_files_only=True` flag does not guard that local-directory tokenizer
  fallback. The JARVIS loader now requires `tokenizer.json` before importing
  the optional runtime and has a regression fixture for the missing-tokenizer
  case. The exact upstream behavior is visible in the official
  [faster-whisper constructor](https://github.com/SYSTRAN/faster-whisper/blob/v1.2.1/faster_whisper/transcribe.py).
