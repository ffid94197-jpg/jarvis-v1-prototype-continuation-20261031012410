import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { buildReplayFromJournal, runTask } from "@/lib/agent/core/loop";
import { ensureWorkspace } from "@/lib/agent/guardian/policy";
import {
  cancelFlags,
  clearCancel,
  isCancelled,
} from "@/lib/agent/core/cancelRegistry";
import { reconcileCrashedTasks } from "@/lib/agent/core/effects";
import {
  requireActiveSession,
  requireOwnedTask,
  type AuthContext,
} from "@/lib/agent/auth/session";
import { prepareTaskObjective } from "@/lib/agent/core/taskInputGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TaskRequestBody {
  objective?: unknown;
  resumeTaskId?: unknown;
  stepBudget?: unknown;
  ownerId?: unknown; // NEVER trusted — server derives the owner (AUTH-07)
}

export async function POST(req: NextRequest) {
  // ——— PHASE 01 GUARD: authenticated, ACTIVE principal, same-origin ———
  const guard = await requireActiveSession(req);
  if (!guard.ok) return guard.response;
  const ctx: AuthContext = guard.ctx;

  let body: TaskRequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  await ensureWorkspace();
  // Startup crash reconciliation (§5.5): runs at most once per process.
  await reconcileCrashedTasks();

  let taskId: string;
  let objective: string;
  let budget: number;
  let replay: string | undefined;
  let executedEffects: string[] | undefined;
  let pendingGuiVerification = 0;
  let stepsUsedOffset = 0;
  let planRevision = 0;

  const resumeId = typeof body.resumeTaskId === "string" ? body.resumeTaskId : null;

  if (resumeId) {
    // ——— RESUME a durably paused task (restart continuity) ———
    // Ownership is enforced FIRST (foreign tasks 404, legacy 403),
    // before any task data is disclosed.
    const owned = await requireOwnedTask(ctx, resumeId);
    if (!owned.ok) return owned.response;
    const journal = await buildReplayFromJournal(resumeId).catch(() => null);
    if (!journal) {
      return Response.json(
        { error: `Task ${resumeId} is not resumable (missing, or not in 'paused' state).` },
        { status: 409 },
      );
    }
    taskId = resumeId;
    objective = journal.objective;
    replay = journal.replay;
    executedEffects = journal.executedEffects; // Core duplicate-effect guard
    pendingGuiVerification = journal.pendingGuiVerification;
    stepsUsedOffset = journal.stepsUsed;
    budget =
      typeof body.stepBudget === "number" && body.stepBudget > 0
        ? Math.floor(body.stepBudget)
        : 12;
    // Resume continues the SAME plan lineage (objective is immutable), so
    // the plan revision is unchanged — duplicate identities still match.
    try {
      const row = await db.agentTask.findUnique({ where: { id: resumeId } });
      planRevision = row?.planRevision ?? 0;
    } catch {
      planRevision = 0;
    }
  } else {
    // ——— NEW task: the SERVER derives ownership ———
    const prepared = prepareTaskObjective(body.objective);
    if (!prepared.ok) {
      return Response.json({ error: prepared.message, code: prepared.code }, { status: prepared.status });
    }
    objective = prepared.objective;
    budget =
      typeof body.stepBudget === "number" && body.stepBudget > 0
        ? Math.min(Math.floor(body.stepBudget), process.env.JARVIS_EXPERIMENTAL_DESKTOP_CONTROL === "1" ? 48 : 24)
        : (process.env.JARVIS_EXPERIMENTAL_DESKTOP_CONTROL === "1" ? 24 : 12);
    try {
      const created = await db.agentTask.create({
        data: {
          objective,
          // PHASE 02: tasks are born PLANNED; the Core moves them into
          // PLANNING through the explicit state machine (CAS + version).
          status: "planned",
          stepsUsed: 0,
          // Server-derived ownership (client-supplied ownerId ignored):
          ownerId: ctx.principalId,
          sessionId: ctx.sessionId,
          createdByDeviceId: ctx.principalId,
        },
      });
      taskId = created.id;
    } catch {
      return Response.json(
        { error: "Task journal unavailable — refusing to start an unauditable task." },
        { status: 503 },
      );
    }
  }

  cancelFlags.set(taskId, false); // shared registry (globalThis-backed)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      try {
        await runTask({
          taskId,
          ownerId: ctx.principalId,
          objective,
          budget,
          replay,
          executedEffects,
          pendingGuiVerification,
          stepsUsedOffset,
          planRevision,
          emit: (ev) => {
            if (ev.type === "status") send("status", ev);
            else if (ev.type === "step") send("step", ev);
            else if (ev.type === "delta") send("delta", ev);
            else if (ev.type === "final") send("final", ev);
            else if (ev.type === "error") send("error", ev);
          },
          isCancelled: () => isCancelled(taskId),
        });
      } catch (err) {
        send("error", {
          message: err instanceof Error ? err.message : "Task runtime failure.",
        });
      } finally {
        clearCancel(taskId);
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
