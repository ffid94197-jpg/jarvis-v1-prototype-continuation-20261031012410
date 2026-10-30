import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { companionCancel } from "@/lib/agent/windows/bridge";
import { requestCancel } from "@/lib/agent/core/cancelRegistry";
import { transitionTask } from "@/lib/agent/core/taskState";
import {
  requireActiveSession,
  requireOwnedTask,
} from "@/lib/agent/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cancellation / emergency stop — PHASE 01 + Phase 04 semantics.
 *  - Authenticated + ACTIVE principal + same-origin required.
 *  - Ownership enforced: foreign tasks are NOT disclosed (404);
 *    legacy quarantined tasks are not actionable (403).
 *  - Sets the shared in-memory flag the Core checks between steps and
 *    signals in-flight executor work (cancelRegistry).
 *  - Durable-settles the task as cancelled (if still active) so the
 *    record survives even if the process dies immediately after.
 */
export async function POST(req: NextRequest) {
  const guard = await requireActiveSession(req);
  if (!guard.ok) return guard.response;
  const ctx = guard.ctx;

  let taskId: unknown;
  try {
    const body = await req.json();
    taskId = body?.taskId;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof taskId !== "string" || taskId.length === 0) {
    return Response.json({ error: "taskId is required." }, { status: 400 });
  }

  // Ownership BEFORE any effect or disclosure.
  const owned = await requireOwnedTask(ctx, taskId);
  if (!owned.ok) return owned.response;

  // In-memory flag — read by the live Core loop between steps and by
  // the in-flight cancellation hooks (Phase 04).
  requestCancel(taskId);
  // Best-effort cancellation for external Windows browser actions. It cannot
  // prove instantaneous stop during a blocking OS/browser navigation.
  void companionCancel(taskId);

  // PHASE 02 (§7.4): STOP is an explicit state, not just a Boolean.
  // planned/planning/executing → cancel_requested is a compare-and-set;
  // the live Core settles the terminal CANCELLED transition when it
  // acknowledges between steps. Startup reconciliation covers a dead
  // worker, so the honest intermediate state is durable either way.
  try {
    const task = await db.agentTask.findUnique({ where: { id: taskId } });
    if (task && ["planned", "planning", "executing"].includes(task.status)) {
      const cas = await transitionTask(taskId, "cancel_requested");
      // Report the ACTUAL durable result — never claim a state the CAS lost.
      return Response.json({
        ok: true,
        taskId,
        cancelled: true,
        state: cas.ok ? "cancel_requested" : task.status,
        note: cas.ok ? undefined : "STOP flag set; durable CAS lost a race — current state reported honestly.",
      });
    }
    if (task && task.status === "cancel_requested") {
      return Response.json({ ok: true, taskId, cancelled: true, state: "cancel_requested" });
    }
    return Response.json({
      ok: true,
      taskId,
      cancelled: false,
      state: task?.status ?? "unknown",
      note: "Task is not in a cancellable state (already settled).",
    });
  } catch {
    // journal best-effort; the in-memory flag is the operative control
  }

  return Response.json({ ok: true, taskId, cancelled: true });
}
