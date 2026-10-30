# JARVIS V1 — Long-running tasks, routines and bounded recovery

This edition **extends** the Face & Voice + LAYA owner-priority source. It does **not** claim universal independent PC operation or Minecraft survival autonomy.

## What is implemented

- **Console → ◷ ROUTINES**: create a one-time task or repeating routine, optionally decomposed into 1–8 independently journaled subgoals. Edit tasks by creating a new routine; stored history is immutable.
- **Background Bun worker**: launched alongside NEXUS and the Windows companion by `bun run dev:windows` when `JARVIS_LONGRUN_ENABLED=1`. The worker continues while the launcher is running, even if the Console is closed. **It does not continue when Windows sleeps, shuts down or the worker exits.** Its schedule and journal are persisted in SQLite.
- **Durable scheduler**: owner-scoped tasks, atomic task/routine linkage, per-routine lease with 10-second renewal, fenced global single-worker heartbeat, owner active status check, finite runs and tool-step limits. One routine task is processed at a time by this worker.
- **Subgoal planning**: one tool-using Core task per subgoal; existing LAYA chooses the model for that task and the original Guardian authorizes all effects.
- **Automatic alternate-path selection**: bounded cost-based graph search over permitted desktop/browser/file/Minecraft strategies. Verified completion advances; a recoverable failure can choose an unused strategy; denial, cancellation, unverified effect, unsafe interrupted task or exhausted paths blocks the routine.
- **Pause/resume**: ordinary Core step-budget pauses are rebuilt from the durable journal and resumed without replaying settled effects, up to eight slices per subgoal. If the worker crashes while an effect may have been executing, recovery **blocks for inspection** instead of blindly repeating the action.
- **Routine history/status**: current subgoal, path, cycle counter, next run, outcome, and heartbeat in NEXUS. Owner can disable.

## Install (Windows test copy only)

1. Extract ZIP into a **new** folder, not `D:\jarvis_pc_work`.
2. Copy your private `.env` from your previous working build. Use a fresh `DATABASE_URL` filename, and preserve your model-vault master key if you need saved profiles.
3. Append `.env.longrun.example` settings to `.env` (do **not** replace the original .env).
4. Execute:

```powershell
bun install --frozen-lockfile
bunx prisma generate
bunx prisma db push
node scripts/longrun/verify-longrun.mjs
bunx tsc --noEmit
bun run lint
bun run build
bun run dev:windows
```

5. Open http://127.0.0.1:3000 → Assistant Console → **◷ ROUTINES**. A healthy worker heartbeat should be visible rather than a warning.

## Example routines

**One-time native desktop validation:** Title `PC observation`, objective `Open Notepad, enter the exact test phrase, save it inside my authorized JARVIS workspace and verify the saved text.` Optional ordered subgoals: `Inspect my actual Windows foreground window`; `Open Notepad and type exactly JARVIS_LONGRUN_OK`; `Save inside the authorized workspace and read back text to verify`.

**Recurring documentation check:** Title `Daily workspace status`, objective `Review the authorized JARVIS test workspace and write a factual status report to its reports folder, citing real file observations.` Set interval 1440 minutes; cap total cycles to 7.

**Minecraft teammate:** Title `Minecraft LAN check`, objective `Check whether JarvisBuddy is connected, report coordinates and health, and follow my player only if the LAN session is established.` Requires independently configured and compatible Java LAN client; not a complete autonomous Minecraft game AI.

## Limitations and review gates

- The planner searches **bounded, known strategies**, not all possible actions on a PC. The existing Core/LLM still chooses individual real tool actions; the new layer handles scheduling and fallback.
- A *successful* tool dispatch is not automatically a verified outcome. Core UI proof debt and Guardian decisions still apply.
- Run count <=10,000; interval 5–10,080 minutes; max 8 subgoals; max 384 tool steps per subgoal, 8 chunks per subgoal; 50 enabled routines per owner; worker acquires one routine at a time.
- Model calls and native Windows operations have their own timeout behavior; the worker's 20-minute deadline is checked **between Core actions** and is not an OS-level interrupt. An OS crash or uncertain effect requires human inspection before trying again.
- Prevent Windows sleep if you need unattended operation; this version does not install a Windows Scheduled Task or Windows Service.
- SQLite must be migrated with `prisma db push` **before starting**; copy, don't overwrite, any previous user database. Do not enable on a machine holding sensitive data unless you understand the permissions and privacy consequences.
- Existing single-task Control UI remains available. All background work requires an explicit owner-created routine. There is no self-creating unlimited schedule.

## Test coverage

The Node test runner executes 20 × 2,500 simulated strategy decisions and checks graph search, safety stops, schedule catchup, and code invariants. Existing autonomy/Windows/LAYA fixture regressions are run separately. These cannot prove actual Windows/UI, Prisma runtime, true model reasoning, 24-hour uptime, or Minecraft LAN play; those need an on-device run.
