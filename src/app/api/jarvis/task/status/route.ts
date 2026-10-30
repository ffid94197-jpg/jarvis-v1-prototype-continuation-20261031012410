import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  requireActiveSession,
  requireOwnedTask,
} from "@/lib/agent/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PHASE 02 — owner-scoped task status retrieval (DUR-08 vehicle and the
 * §4.4 "status retrieval" protected route). The NEXUS client can compare
 * what the live stream says against the DURABLE backend truth at any
 * time — including after a reconnection or server restart.
 */
export async function GET(req: NextRequest) {
  const guard = await requireActiveSession(req);
  if (!guard.ok) return guard.response;

  const taskId = new URL(req.url).searchParams.get("taskId");
  if (!taskId) {
    return Response.json({ error: "taskId query parameter is required." }, { status: 400 });
  }
  const owned = await requireOwnedTask(guard.ctx, taskId);
  if (!owned.ok) return owned.response;

  const task = await db.agentTask.findUnique({
    where: { id: taskId },
    include: {
      effects: { select: { status: true } },
      _count: { select: { steps: true, audits: true } },
    },
  });
  if (!task) {
    return Response.json({ error: "Task not found." }, { status: 404 });
  }
  return Response.json({
    ok: true,
    task: {
      id: task.id,
      status: task.status,
      version: task.version,
      planRevision: task.planRevision,
      stepsUsed: task.stepsUsed,
      stepCount: task._count.steps,
      auditCount: task._count.audits,
      effects: {
        admitted: task.effects.filter((e) => e.status === "ADMITTED").length,
        settled: task.effects.filter((e) => e.status === "SETTLED").length,
        failed: task.effects.filter((e) => e.status === "FAILED").length,
        unknown: task.effects.filter((e) => e.status === "EFFECT_UNKNOWN").length,
      },
      finalText: task.finalText,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    },
  });
}
