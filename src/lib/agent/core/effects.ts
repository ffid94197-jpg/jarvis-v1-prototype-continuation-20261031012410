/**
 * JARVIS AGENT RUNTIME — Phase 02/04: durable effect admission protocol.
 *
 * Playbook §5.4 (journal-before-effect) and §7.2 (atomic effect identity):
 *  - An effectful call is ATOMICALLY RESERVED in EffectRecord (unique
 *    taskId+effectKey) BEFORE the executor runs. Two concurrent workers
 *    cannot both admit the same effect (EFF-01).
 *  - If the admission write fails → the effect does NOT start (DUR-01).
 *  - Settlement happens only from the real executor receipt.
 *  - A crash between admission and settlement leaves an honest
 *    ADMITTED-but-unsettled row. Recovery RECONCILES against actual
 *    external state (fs readback for our tools) — never blind replay
 *    (DUR-04, §5.5). Unverifiable effects become EFFECT_UNKNOWN.
 */

import fs from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { resolveScopedPath, assertWithinRoot } from "../guardian/policy";
import { injectedFault } from "./faults";

export const EFFECTFUL_TOOLS = new Set(["create_folder", "write_file", "windows_open_url", "windows_open_app", "windows_open_settings", "windows_youtube_oldest", "minecraft_companion_join", "minecraft_companion_stop", "windows_browser_search", "windows_browser_click_link", "windows_browser_fill_search", "windows_browser_scroll", "windows_focus_app", "windows_launch_installed", "windows_native_open_url", "windows_native_action", "windows_desktop_focus", "windows_desktop_click", "windows_desktop_move", "windows_desktop_type", "windows_desktop_keys", "windows_desktop_scroll", "minecraft_companion_command", "windows_minecraft_input", "adoption_stage_github", "adoption_mcp_call", "local_project_build", "evolution_skill_stage", "evolution_skill_learn", "evolution_repair_stage"]);

/** Read-only Minecraft observations must be executed again on each request.
 * Treating `status`/`auto_status` as a durable effect previously returned stale
 * duplicate receipts instead of querying the live bot. Guardian still applies.
 */
export const MINECRAFT_READ_ONLY_COMMANDS = new Set([
  "status", "inventory", "observe", "auto_status", "inspect_block",
]);
export function isEffectfulToolInvocation(tool: string, args: Record<string, unknown>): boolean {
  if (!EFFECTFUL_TOOLS.has(tool)) return false;
  if (tool === "minecraft_companion_command" &&
      typeof args.command === "string" && MINECRAFT_READ_ONLY_COMMANDS.has(args.command)) return false;
  return true;
}

export interface EffectArgs {
  tool: string;
  args: Record<string, unknown>;
  /** Real desktop input may legitimately repeat at distinct durable step ids. */
  stepSeq?: number;
}

export const STEP_SCOPED_EFFECTS = new Set([
  "windows_native_action", "windows_desktop_focus", "windows_desktop_click",
  "windows_desktop_move", "windows_desktop_type", "windows_desktop_keys",
  "windows_desktop_scroll", "windows_minecraft_input", "windows_browser_scroll", "adoption_mcp_call",
  "minecraft_companion_command",
]);

export function effectIdentity(planRevision:number, eff:EffectArgs):string {
  const scoped = STEP_SCOPED_EFFECTS.has(eff.tool) && Number.isInteger(eff.stepSeq) &&
    (eff.stepSeq as number) >= 0;
  const args = scoped ? {...eff.args, __jarvisEffectStep:eff.stepSeq} : eff.args;
  return `${planRevision}|${canonicalKey(eff.tool,args)}`;
}

/** Canonical key-order-independent identity of a tool call. */
export function canonicalKey(tool: string, args: Record<string, unknown>): string {
  const sortDeep = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === "object") {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sortDeep((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return `${tool}|${JSON.stringify(sortDeep(args))}`;
}

export type AdmissionOutcome =
  | { kind: "admitted"; effectId: string }
  | { kind: "duplicate_settled"; effectId: string }
  | { kind: "needs_reconciliation"; effectId: string; status: string }
  | { kind: "refused"; reason: string };

/**
 * THE ADMISSION GATE. Must be called (and succeed) before any effectful
 * executor call. Unique constraint [taskId, effectKey] makes the
 * reservation atomic and concurrency-safe. The exact tool + args are
 * stored ON the row so crash reconciliation never has to guess them.
 */
export async function admitEffect(
  taskId: string,
  planRevision: number,
  eff: EffectArgs,
): Promise<AdmissionOutcome> {
  if (injectedFault() === "admission") {
    return { kind: "refused", reason: "durable admission journal unavailable (fault)" };
  }
  const effectKey = effectIdentity(planRevision,eff);
  try {
    const created = await db.effectRecord.create({
      data: {
        taskId,
        effectKey,
        status: "ADMITTED",
        tool: eff.tool,
        argsJson: JSON.stringify(eff.args).slice(0, 4000),
      },
    });
    return { kind: "admitted", effectId: created.id };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "P2002") {
      // Unique violation → this exact effect identity already exists.
      const existing = await db.effectRecord.findUnique({
        where: { taskId_effectKey: { taskId, effectKey } },
      });
      if (!existing) return { kind: "refused", reason: "admission race — row vanished" };
      if (existing.status === "SETTLED") return { kind: "duplicate_settled", effectId: existing.id };
      // ADMITTED / FAILED / EFFECT_UNKNOWN without settlement → reconcile.
      return { kind: "needs_reconciliation", effectId: existing.id, status: existing.status };
    }
    return { kind: "refused", reason: "durable admission journal unavailable" };
  }
}

export async function settleEffect(
  effectId: string,
  receipt: Record<string, unknown>,
  status: "SETTLED" | "FAILED" | "EFFECT_UNKNOWN" = "SETTLED",
): Promise<boolean> {
  try {
    // Compare-and-set: an ADMITTED effect may be settled once, never
    // overwritten by a delayed receipt from another worker or retry.
    const result = await db.effectRecord.updateMany({
      where: { id: effectId, status: "ADMITTED" },
      data: { status, receiptJson: JSON.stringify(receipt).slice(0, 4000), settledAt: new Date() },
    });
    return result.count === 1;
  } catch {
    return false;
  }
}

/**
 * Reconcile one ADMITTED-but-unsettled effect against ACTUAL external
 * state. For our fs tools this is a deterministic readback:
 *  - create_folder → stat the directory
 *  - write_file    → read the file and byte-compare the intended content
 * Unverifiable states stay EFFECT_UNKNOWN — never guessed.
 */
export async function reconcileEffect(
  effectId: string,
  eff: EffectArgs,
): Promise<
  | { kind: "verified"; detail: Record<string, unknown> }
  | { kind: "effect_unknown"; reason: string }
> {
  // Anything without a deterministic observation mechanism is permanently
  // uncertain. Do not reinterpret arbitrary external tool arguments as paths.
  if (eff.tool !== "create_folder" && eff.tool !== "write_file") {
    await settleEffect(effectId, { reconciled: false, reason: "no deterministic observer" }, "EFFECT_UNKNOWN");
    return { kind: "effect_unknown", reason: `no deterministic reconciliation for '${eff.tool}'` };
  }
  const rel = typeof eff.args.path === "string" ? eff.args.path : null;
  if (!rel) {
    await settleEffect(effectId, { reconciled: false, reason: "missing path" }, "EFFECT_UNKNOWN");
    return { kind: "effect_unknown", reason: "effect args lack a path" };
  }
  // A persisted effect row is not permission to access an arbitrary path.
  // Revalidate the resource before reconciliation; reject corrupted/stale
  // records, path traversal and symlink escapes without reading them.
  const decision = resolveScopedPath(rel);
  if (!decision.ok || !decision.abs) {
    await settleEffect(effectId, { reconciled: false, reason: "path out of scope" }, "EFFECT_UNKNOWN");
    return { kind: "effect_unknown", reason: "persisted effect path is outside the allowed workspace" };
  }
  const check = await assertWithinRoot(decision.abs);
  if (!check.ok) {
    await settleEffect(effectId, { reconciled: false, reason: "canonical containment failed" }, "EFFECT_UNKNOWN");
    return { kind: "effect_unknown", reason: "persisted effect path failed canonical containment" };
  }
  const abs = decision.abs;
  try {
    if (eff.tool === "create_folder") {
      const st = await fs.stat(abs);
      if (!st.isDirectory())
        return { kind: "effect_unknown", reason: "target exists but is not a directory" };
      const ok = await settleEffect(effectId, { reconciled: true, path: rel, isDirectory: true }, "SETTLED");
      return ok
        ? { kind: "verified", detail: { path: rel, isDirectory: true } }
        : { kind: "effect_unknown", reason: "settlement write failed during reconciliation" };
    }
    if (eff.tool === "write_file") {
      const content = typeof eff.args.content === "string" ? eff.args.content : "";
      const readBack = await fs.readFile(abs, "utf8");
      const match = readBack === content;
      const ok = await settleEffect(
        effectId,
        { reconciled: true, path: rel, bytes: Buffer.byteLength(readBack, "utf8"), contentVerified: match },
        match ? "SETTLED" : "EFFECT_UNKNOWN",
      );
      return match && ok
        ? { kind: "verified", detail: { path: rel, bytes: Buffer.byteLength(readBack, "utf8") } }
        : match
          ? { kind: "effect_unknown", reason: "settlement write failed during reconciliation" }
          : { kind: "effect_unknown", reason: "file exists but content differs from the admitted intent" };
    }
    return { kind: "effect_unknown", reason: `no deterministic reconciliation for '${eff.tool}'` };
  } catch (err) {
    await settleEffect(
      effectId,
      { reconciled: false, error: err instanceof Error ? err.message : "absent" },
      "EFFECT_UNKNOWN",
    ).catch(() => {});
    return { kind: "effect_unknown", reason: "target not observable on disk (may never have run)" };
  }
}

/**
 * STARTUP RECONCILIATION (§5.5 crash recovery). Runs at most once per
 * process (globalThis guard). Detects:
 *  - stale RUNNING tasks (planning/executing not updated for a long
 *    time — they died with a previous process)
 *  - ADMITTED-but-unsettled effects
 * and settles each task honestly:
 *  - all effects verified on disk → partial (interrupted, not falsely
 *    completed — the model never delivered a report)
 *  - any effect unverifiable → effect_unknown
 */
const g = globalThis as unknown as { __jarvisReconciled?: boolean };

export async function reconcileCrashedTasks(): Promise<void> {
  if (g.__jarvisReconciled) return;
  g.__jarvisReconciled = true;

  const staleMs = 5 * 60 * 1000; // 5 minutes without a write ⇒ crashed worker
  const staleBefore = new Date(Date.now() - staleMs);
  try {
    const stale = await db.agentTask.findMany({
      where: {
        status: { in: ["planning", "executing", "cancel_requested"] },
        updatedAt: { lt: staleBefore },
      },
      include: { effects: true },
    });
    for (const t of stale) {
      let unknown = false;
      let verifiedCount = 0;
      for (const e of t.effects) {
        if (e.status !== "ADMITTED") continue;
        const args = (() => {
          try {
            return JSON.parse(e.argsJson ?? "{}") as Record<string, unknown>;
          } catch {
            return {};
          }
        })();
        const rec = await reconcileEffect(e.id, { tool: e.tool, args });
        if (rec.kind === "verified") verifiedCount++;
        else unknown = true;
      }
      // CAN-05: a STOP must survive the restart — a crashed
      // cancel_requested task settles to CANCELLED (with its effects
      // reconciled), never back to "running" and never resurrected.
      const wasStop = t.status === "cancel_requested";
      const status = wasStop ? "cancelled" : unknown ? "effect_unknown" : "partial";
      const text = wasStop
        ? `Recovered after a crash: the operator had requested cancellation; the stop is honored. ${verifiedCount} admitted effect(s) verified on disk${unknown ? "; at least one effect could not be verified (recorded as uncertain)" : ""}. No work was resumed.`
        : unknown
          ? `Recovered after a crash: at least one admitted effect could not be verified against actual disk state. Nothing was blindly replayed. Verified effects: ${verifiedCount}.`
          : `Recovered after a crash: ${verifiedCount} effect(s) verified against actual disk state; the run was interrupted before a final report — recorded as PARTIAL, not completed.`;
      await db.agentTask.update({
        where: { id: t.id },
        data: { status, finalText: text, version: { increment: 1 } },
      }).catch(() => {});
      console.error(`[reconcile] task ${t.id} → ${status} (crash recovery)`);
    }
  } catch {
    // Reconciliation itself must never take the app down.
  }
}
