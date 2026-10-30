/**
 * JARVIS AGENT RUNTIME — shared cancellation registry.
 *
 * Both the task route and the cancel route import THIS module directly.
 * It MUST NOT live inside a route file: dev bundlers (Turbopack) can give
 * each route its own module instance, silently splitting the registry —
 * a real IPC failure observed during TEST 6. Attaching the registry to
 * globalThis guarantees a single shared instance (and survives HMR).
 *
 * PHASE 04 (§7.4): requestCancel now ALSO terminates actual in-flight OS
 * work (child processes) — a STOP is never just a Boolean flip.
 */

import { killInFlightChildren } from "../tools/executor";

const g = globalThis as unknown as {
  __jarvisCancelFlags?: Map<string, boolean>;
};

export const cancelFlags: Map<string, boolean> =
  (g.__jarvisCancelFlags ??= new Map<string, boolean>());

export function requestCancel(taskId: string): void {
  cancelFlags.set(taskId, true);
  // §7.4: signal in-flight workers — kill the real child processes.
  try {
    const killed = killInFlightChildren(taskId);
    if (killed > 0) {
      console.error(`[cancel] terminated ${killed} in-flight child process(es) for task ${taskId}`);
    }
  } catch {
    // registry unavailable — the between-step flag still stops the loop
  }
}

export function isCancelled(taskId: string): boolean {
  return cancelFlags.get(taskId) === true;
}

export function clearCancel(taskId: string): void {
  cancelFlags.delete(taskId);
}
