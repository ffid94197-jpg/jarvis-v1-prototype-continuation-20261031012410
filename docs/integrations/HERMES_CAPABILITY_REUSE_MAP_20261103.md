# Hermes Agent capability reuse map for JARVIS Prototype

Reviewed against Hermes Agent source revision
fd267bb3242a14c33d4899cffc60ee4be816f14d and JARVIS integration base
b2ca2c87716b67ddcbc27193a3ad946f41244714.

## Directly adopted

### Computer use — Cua Driver

Hermes computer-use manages the Cua Driver native binary through a
stdio-MCP transport. JARVIS now has an optional adapter for the same upstream
Cua Driver project through its Python SDK inside the existing Windows
companion. This intentionally changes the transport/lifecycle: no Hermes
agent, no separate MCP server, and no imported Hermes model/tool loop.
Guardian authorizes exact-window element clicks and window-targeted text/key
input; the CUA receipt reports whether the selected route was background or
foreground.

The observation tool snapshots exactly one window per call: foreground
by default, or an exact PID/window ID selected from the visible-window list.
This prevents snapshot-token invalidation when inspecting multiple windows.

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

## Capabilities Hermes does not replace

### Minecraft gameplay

Hermes is not a native Minecraft Java gameplay engine and does not satisfy
JARVIS's empty-survival-to-Netherite-and-Dragon acceptance requirement. Keep
the existing JARVIS Mineflayer/MCP companion and custom goal planner. The
remaining work is gameplay intelligence, robust recovery and real Java-server
acceptance; do not replace it with generic desktop clicking.

### 200,000 Internet-original evaluation corpus

Hermes does not provide the required 200,000-source-attested, difficult
Internet-original prompt corpus or its independent result-verification
pipeline. This remains a separate build-from-scratch evaluation project.
Generated benchmark instances and model-generated instructions do not count
toward the Internet-original target.

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

This is a future build candidate, not a claim of implemented delegation.
It is an optional advanced capability rather than a mandatory V1 release gate
unless the owner explicitly adds delegated execution to the acceptance criteria.

## Non-goals

- Do not embed the Hermes Agent runtime as a second JARVIS.
- Do not copy Hermes provider credentials, memory store, scheduler or shell
  permissions into JARVIS.
- Do not bypass Guardian or LPAC for imported tools.
- Do not claim feature parity based only on a README or a simulated result.
