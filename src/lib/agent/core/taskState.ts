/**
 * JARVIS AGENT RUNTIME — Phase 02: explicit task state machine.
 *
 * Playbook §5.3: tasks move through explicit states via an explicit
 * transition table; invalid transitions are rejected. Status writes
 * are COMPARE-AND-SET on the current status and bump `version`
 * (optimistic concurrency — DUR-05: concurrent status updates obey
 * version checks).
 *
 * State vocabulary (Playbook-mapped):
 *   planned            PLANNED            row exists, planner not yet invoked
 *   planning           RUNNING (plan)     model call in flight
 *   executing          RUNNING            tool steps in flight
 *   waiting_approval   WAITING_APPROVAL   reserved (deny-by-default today)
 *   paused            (durable pause)     budget pause; resume-able
 *   cancel_requested   CANCEL_REQUESTED   STOP received; admissions blocked
 *   cancelled          CANCELLED
 *   effect_unknown     EFFECT_UNKNOWN     an effect may have happened but
 *                                         settlement could not be verified
 *   partial            PARTIAL            effects occurred, objectives incomplete
 *   failed             FAILED
 *   denied            (Guardian stop)    terminal, audited
 *   verified           VERIFIED           Phase 03 predicates passed
 *   completed          SETTLED            final report settled durably
 */

import { db } from "@/lib/db";

export type TaskState =
  | "planned"
  | "planning"
  | "executing"
  | "waiting_approval"
  | "paused"
  | "cancel_requested"
  | "cancelled"
  | "effect_unknown"
  | "partial"
  | "failed"
  | "denied"
  | "verified"
  | "completed";

export const TASK_STATES: readonly TaskState[] = [
  "planned", "planning", "executing", "waiting_approval", "paused",
  "cancel_requested", "cancelled", "effect_unknown", "partial",
  "failed", "denied", "verified", "completed",
];

/** The explicit transition table. Anything not listed is rejected. */
export const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  planned: ["planning", "cancel_requested", "cancelled", "failed"],
  planning: ["executing", "paused", "cancel_requested", "cancelled", "failed", "denied", "effect_unknown", "completed"],
  executing: [
    "executing", // phase self-loop (CAS refreshes version)
    "paused",
    "cancel_requested",
    "cancelled",
    "failed",
    "denied",
    "effect_unknown",
    "partial",
    "verified",
    "completed", // conversational final (no effects, no predicates to verify)
  ],
  waiting_approval: ["executing", "cancelled", "failed"],
  paused: ["planning", "cancel_requested", "cancelled", "failed"],
  cancel_requested: ["cancelled", "effect_unknown", "failed"],
  cancelled: [],
  effect_unknown: ["failed", "partial"], // reconciliation may only demote, never fake success
  partial: [],
  failed: [],
  denied: [],
  verified: ["completed", "partial"], // settlement write failure demotes honestly
  completed: [],
};

export function isTaskState(s: string): s is TaskState {
  return (TASK_STATES as readonly string[]).includes(s);
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface TransitionResult {
  ok: boolean;
  /** "applied" | "invalid_transition" | "unknown_state" | "write_failed" | "missing" */
  reason: string;
  from?: TaskState;
  version?: number;
}

/**
 * Compare-and-set transition. The WHERE clause pins the CURRENT status;
 * the write bumps `version`. Two concurrent writers on the same task
 * cannot both win — exactly one CAS succeeds (DUR-05).
 */
const TERMINAL_STATES: readonly TaskState[] = [
  "completed", "failed", "denied", "cancelled", "partial", "effect_unknown",
];

export async function transitionTask(
  taskId: string,
  to: TaskState,
  data: { finalText?: string; stepsUsed?: number } = {},
): Promise<TransitionResult> {
  const task = await db.agentTask.findUnique({ where: { id: taskId } });
  if (!task) return { ok: false, reason: "missing" };
  if (!isTaskState(task.status)) {
    // DUR-06: malformed persisted state is DETECTED and refused —
    // never silently reset to a "known good" value.
    return { ok: false, reason: "unknown_state", from: task.status as TaskState };
  }
  const from = task.status as TaskState;
  if (!canTransition(from, to)) {
    return { ok: false, reason: "invalid_transition", from };
  }
  if (TERMINAL_STATES.includes(to)) {
    const { injectedFault } = await import("./faults");
    if (injectedFault() === "settlement") {
      // DUR-02 fault: the settlement write fails — the caller must NOT
      // broadcast success.
      return { ok: false, reason: "write_failed", from };
    }
  }
  try {
    const res = await db.agentTask.updateMany({
      where: { id: taskId, status: from },
      data: {
        status: to,
        version: { increment: 1 },
        ...(data.finalText !== undefined ? { finalText: data.finalText.slice(0, 8000) } : {}),
        ...(data.stepsUsed !== undefined ? { stepsUsed: data.stepsUsed } : {}),
      },
    });
    if (res.count === 0) {
      // Lost the race (another writer moved the state first) — report,
      // never double-apply.
      return { ok: false, reason: "invalid_transition", from };
    }
    return { ok: true, reason: "applied", from, version: task.version + 1 };
  } catch {
    return { ok: false, reason: "write_failed", from };
  }
}
