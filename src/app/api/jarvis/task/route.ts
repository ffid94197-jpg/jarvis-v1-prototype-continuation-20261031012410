import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { buildReplayFromJournal, runTask } from "@/lib/agent/core/loop";
import { ensureWorkspace } from "@/lib/agent/guardian/policy";
import { prepareTaskObjective } from "@/lib/agent/core/taskInputGate";
import {
  cancelFlags,
  clearCancel,
  isCancelled,
} from "@/lib/agent/core/cancelRegistry";
import { reconcileCrashedTasks } from "@/lib/agent/core/effects";
import { deriveStepBudget, loadOwnerAutonomyProfile } from "@/lib/agent/core/autonomyPolicy";
import {
  requireActiveSession,
  requireOwnedTask,
  type AuthContext,
} from "@/lib/agent/auth/session";

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

  // ——— PART 2: owner-configurable autonomy tier ———
  // Resolved from the SERVER-DERIVED principal (ctx.principalId), never from
  // body.ownerId, which the request interface already documents as untrusted.
  // A profile can only decide how LONG an authorized run may continue; it
  // carries no permission of any kind, and a memory row that was not written by
  // an explicit owner action is ignored rather than applied.
  const autonomy = await loadOwnerAutonomyProfile(ctx.principalId);

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
    // Owner autonomy tier (Part 2). Durable, owner-scoped, and used ONLY to
    // derive how long a run may continue — Guardian still authorizes every call.
    budget = deriveStepBudget({ requested: body.stepBudget, profile: autonomy.profile }).budget;
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
    if (typeof body.objective !== "string" || body.objective.trim().length === 0) {
      return Response.json({ error: "objective is required." }, { status: 400 });
    }
    const inputCheck=prepareTaskObjective(body.objective);
    console.info("[TASK_INPUT] "+(inputCheck.ok?"ACCEPTED":inputCheck.code)+
      " chars="+body.objective.length+" parsedRows="+inputCheck.inventoryRows);
    if(!inputCheck.ok)
      return Response.json({error:inputCheck.message,code:inputCheck.code},{status:inputCheck.status});
    objective=inputCheck.objective;
    budget = deriveStepBudget({ requested: body.stepBudget, profile: autonomy.profile }).budget;
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
          // PART 2: the owner's autonomy tier, resolved from the server-derived
          // principal above. It governs run persistence only.
          autonomy: autonomy.profile,
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
