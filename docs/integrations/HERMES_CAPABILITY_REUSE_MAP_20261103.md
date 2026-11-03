# Hermes Agent capability reuse map for JARVIS Prototype

Reviewed against Hermes Agent source revision
74b2ed65e6564bfcafd29236e5fab2447a68fc76 and JARVIS integration base
b2ca2c87716b67ddcbc27193a3ad946f41244714.

## Directly adopted

### Computer use — Cua Driver

Hermes computer-use uses the Cua Driver backend. JARVIS now has an optional
adapter for the same Cua Driver Python SDK inside its existing Windows
companion. It does not start a Hermes agent or import Hermes model/tool loops.

Status: code added on the stacked Hermes integration branch; local offline and
real Windows acceptance are still required.

## Already present in JARVIS — do not duplicate

### Agent Skills

JARVIS's adoption registry already supports Agent Skills SKILL.md packages,
staging, owner approval, enable/disable and removal. Hermes bundled skills can
be reviewed and selectively staged through this registry; they should not be
loaded or executed automatically.

### MCP and external tools

JARVIS already has an SDK-free MCP adapter for stdio JSON lines and
Streamable HTTP, plus endpoint validation, public DNS checks, connection-time
DNS pinning, response bounds and untrusted tool-output redaction. Hermes MCP
tool definitions are not a reason to add a second MCP runtime.

### Persistent memory

JARVIS already has owner-scoped memory and World Model contracts, explicit
data classifications and provenance rules. The memory layer deliberately does
not forward private memory to a model by default and does not allow user reports
to become verified facts. Hermes memory files should not replace this store or
bypass JARVIS provenance.

### Scheduling and long-running tasks

JARVIS already has durable routines, a long-run worker, owner checks, fenced
leases, heartbeats, transactional task creation, task journals and bounded
resume/recovery. Hermes cron scheduling is not a reason to create a second
scheduler. Any useful schedule syntax or UX should be adapted onto the existing
routine model.

### Browser automation

JARVIS already has a Playwright-based browser path, Guardian policy, URL
validation and network-egress controls. Hermes browser tools should not become
a second browser controller.

## Remaining candidate requiring JARVIS-native engineering

### Delegated subtasks / subagents

Hermes has a mature child-agent delegation system, but it is coupled to its
AIAgent runtime, tool registry, session transcripts, child credentials,
orchestrator mode, worktree isolation and concurrency manager. Copying the
Hermes module alone would not integrate correctly and could create a second
authorization system.

JARVIS does not yet have an accepted native subagent/delegation subsystem.
The correct adaptation is a JARVIS child-task service that:

- creates a durable child task linked to the parent and the same owner;
- invokes the existing JARVIS Core runner, not a second agent runtime;
- applies a strict per-child tool allowlist before Guardian and again at
  execution time;
- sends every effectful child call through the same Guardian, audit and
  durable effect admission path;
- defaults research/analysis children to read-only tools;
- prevents nested delegation, credential escalation and unrestricted parallel
  effects;
- bounds concurrency, wall-clock time, token budget and result size;
- records child progress and cancellation durably;
- returns only a bounded, provenance-tagged result to the parent;
- never lets a child report parent-task completion.

This is a future build item, not a claim of implemented delegation.

## Non-goals

- Do not embed the Hermes Agent runtime as a second JARVIS.
- Do not copy Hermes provider credentials, memory store, scheduler or shell
  permissions into JARVIS.
- Do not bypass Guardian or LPAC for imported tools.
- Do not claim feature parity based only on a README or a simulated result.
