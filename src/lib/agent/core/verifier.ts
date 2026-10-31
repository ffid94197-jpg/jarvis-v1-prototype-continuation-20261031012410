/**
 * JARVIS AGENT RUNTIME — Phase 03: completion verification (Playbook §6).
 *
 * The model's `final` means "the model PROPOSES the task is ready to
 * finish" — NEVER "the task is objectively complete". This module owns
 * the AUTHORITATIVE completion arbitration:
 *
 *   1. INTENT EXTRACTION (deterministic, no model): parse the objective
 *      for expected artifacts (folders / files / exact contents) with a
 *      conservative action-verb gate. Question-like or negated requests
 *      are conversational — no predicates.
 *   2. PREDICATE VERIFICATION: every expected artifact is checked
 *      against ACTUAL disk state (real readback through the same scoped
 *      path gate as the Guardian tools — objective text is user input
 *      and is never trusted as a path).
 *   3. ARBITRATION (§6.3): VERIFIED / PARTIAL / FAILED / EFFECT_UNKNOWN
 *      — derived from predicates + the durable effect table, never from
 *      model prose. The settled digest carries the predicate verdict.
 */

import fs from "fs/promises";
import { resolveScopedPath, assertWithinRoot } from "../guardian/policy";
import { db } from "@/lib/db";
import { inventoryArtifactKind, verifyInventoryCsv, verifyInventoryReport, type InventorySource } from "./inventoryIntegrity";

export interface Predicate {
  kind: "folder" | "file";
  relPath: string;
  expectedContent?: string;
  /** Resolved in priority order — a bare filename mentioned alongside
   *  folder(s) is checked INSIDE those folders first (user intent),
   *  with the bare workspace-relative path as fallback. */
  candidatePaths?: string[];
}

export interface ArbitrationInput {
  taskId: string;
  objective: string;
  /** True when the loop is about to finalize a TOOL-ASSISTED run. */
  toolAssisted: boolean;
  /** Source rows from current owner request or a same-owner prior objective. */
  inventorySource?: InventorySource | null;
}

export type Verdict =
  | "verified"
  | "partial"
  | "failed"
  | "effect_unknown"
  /** No predicates extractable AND no effects ran (pure conversation). */
  | "conversational";

export interface Arbitration {
  verdict: Verdict;
  predicateLines: string[];
  predicates: Array<{ predicate: Predicate; pass: boolean; observed: string }>;
}

// ——— 1. deterministic intent extraction ———

const CONVERSATIONAL_RE =
  /^(what|why|how|who|when|where|is|are|can|could|does|do|did|explain|describe|tell|list your|show me your)\b/i;
const NEGATION_RE =
  /\b(do not|don'?t|never)\s+(create|write|make|save|build|generate)|just answer|without creating/i;
const ACTION_RE = /\b(create|make|write|generate|save|build)\b/i;

// Preserve quoted path spelling, but exclude unquoted sentence punctuation.
// Drive-letter/UNC paths must never be interpreted as workspace-relative names.
const FOLDER_RE =
  /\b(?:folder|directory)\s+(?:named\s+|called\s+)?(?:(['"`])([A-Za-z0-9_][A-Za-z0-9_\-./]{0,120})\1|([A-Za-z0-9_][A-Za-z0-9_\-./]{0,120}))/gi;
const FILE_CONTENT_EXACT_RE =
  /([A-Za-z0-9_][A-Za-z0-9_\-./]{0,120}\.[A-Za-z0-9]{1,5})[`"']?\s+(?:containing|with(?: the)? content)\s+exactly\s+(?:(['"`])([^'"`\r\n]{1,200})\2|([A-Za-z0-9_:-]{1,200}))(?=\s|[.,!?;]|$)/gi;
function objectiveFolderName(m: RegExpMatchArray): string | null {
  const quoted = m[2];
  const bare = m[3];
  const value = quoted ?? bare;
  if (!value) return null;
  if (quoted === undefined) {
    // Punctuation that terminates an unquoted sentence is not a path.
    // Quoted paths retain their exact contents, including embedded dots.
    const trimmed = value.replace(/[.,;:!?]+$/, "");
    if (!trimmed) return null;
    const next = m.input?.slice((m.index ?? 0) + m[0].length) ?? "";
    if (/^[\\:]/.test(next)) return null; // C:\\ or C:/...
    return trimmed;
  }
  return quoted;
}
const FILE_CONTENT_RE =
  /([A-Za-z0-9_][A-Za-z0-9_\-./]{0,120}\.[A-Za-z0-9]{1,5})\s+(?:saying|with content|with the content|containing|that says|which says)\s+['"]([^'"]{1,200})['"]/gi;
const FILE_PLAIN_RE =
  /\b(?:file|files)\s+(?:named\s+|called\s+)?[`"']?([A-Za-z0-9_][A-Za-z0-9_\-./]{0,120}\.[A-Za-z0-9]{1,5})[`"']?/gi;
// Common natural-language routine form: "Create notes.txt ... write exactly X".
// A direct filename must follow an explicit effect verb; mere mentions in a
// chat, status check or model observation must not become success predicates.
const FILE_DIRECT_RE =
  /\b(?:create|make|write|generate|save|build)\s+(?:(?:a|the|new)\s+)?(?:file\s+(?:named\s+|called\s+)?)?[`"']?([A-Za-z0-9_][A-Za-z0-9_\-./]{0,120}\.[A-Za-z0-9]{1,5})[`"']?/gi;
const WRITE_EXACT_QUOTED_RE = /\bwrite\s+exactly\s+(['"`])([^'"`]{1,200})\1/i;
const WRITE_EXACT_TOKEN_RE = /\bwrite\s+exactly\s+([A-Za-z0-9_:-]{1,200})(?=\s|[,.!?;]|$)/i;

const MAX_PREDICATES = 10;

export function extractPredicates(objective: string): Predicate[] {
  // Conversational or negated objectives carry no completion predicates.
  if (CONVERSATIONAL_RE.test(objective.trim()) || NEGATION_RE.test(objective)) return [];
  if (!ACTION_RE.test(objective)) return [];

  // /g regexes are module-level — reset lastIndex so a previous call can
  // never leak cursor state into this one (matchAll copies lastIndex).
  FOLDER_RE.lastIndex = 0;
  FILE_CONTENT_RE.lastIndex = 0;
  FILE_CONTENT_EXACT_RE.lastIndex = 0;
  FILE_PLAIN_RE.lastIndex = 0;
  FILE_DIRECT_RE.lastIndex = 0;

  const preds: Predicate[] = [];
  const seen = new Map<string, Predicate>();
  const push = (p: Predicate) => {
    const key = `${p.kind}:${p.relPath}`;
    if (seen.has(key)) {
      // Prefer exact-content checking over existence-only when both forms
      // identify the same target. Never weaken a previously strong check.
      const existing = seen.get(key)!;
      if (existing.expectedContent === undefined && p.expectedContent !== undefined) {
        existing.expectedContent = p.expectedContent;
      }
      return;
    }
    if (preds.length >= MAX_PREDICATES) return;
    // Defense-in-depth: objective text is USER INPUT — every extracted
    // path must pass the same scoped-path gate as Guardian tools.
    const scoped = resolveScopedPath(p.relPath);
    if (!scoped.ok || !scoped.rel) return;
    const entry = { ...p, relPath: scoped.rel };
    seen.set(key, entry);
    preds.push(entry);
  };

  // folders
  for (const m of objective.matchAll(FOLDER_RE)) {
    const folder = objectiveFolderName(m);
    if (folder) push({ kind: "folder", relPath: folder });
  }
  // Do not salvage a basename from an absolute/traversal prefix.
  const safeFileBoundary = (m: RegExpMatchArray) =>
    !/[\/:]$/.test(objective.slice(Math.max(0, (m.index ?? 0) - 1), m.index ?? 0));
  // File/content pairs must name their exact target.
  const contentMatches = [...objective.matchAll(FILE_CONTENT_RE)];
  for (const m of contentMatches) {
    if (safeFileBoundary(m)) push({ kind: "file", relPath: m[1], expectedContent: m[2] });
  }
  const exactContentMatches = [...objective.matchAll(FILE_CONTENT_EXACT_RE)];
  for (const m of exactContentMatches) {
    if (safeFileBoundary(m)) push({ kind: "file", relPath: m[1], expectedContent: m[3] ?? m[4] });
  }
  // Detect named and direct targets without reducing strong predicates
  // to an existence-only check.
  for (const m of objective.matchAll(FILE_PLAIN_RE)) {
    push({ kind: "file", relPath: m[1] });
  }
  for (const m of objective.matchAll(FILE_DIRECT_RE)) {
    push({ kind: "file", relPath: m[1] });
  }

  // Infer unquoted exact content ONLY when there is exactly one file. With
  // multiple filenames the target of "write exactly" is ambiguous and must
  // stay UNVERIFIED rather than allowing an existence-only false success.
  const exact = objective.match(WRITE_EXACT_QUOTED_RE)?.[2]
    ?? objective.match(WRITE_EXACT_TOKEN_RE)?.[1];
  const files = preds.filter((p) => p.kind === "file");
  const mentionedFileNames = new Set(
    [...objective.matchAll(/\b([A-Za-z0-9_][A-Za-z0-9_\-./]{0,120}\.[A-Za-z0-9]{1,5})\b/g)]
      .map((m) => m[1]),
  );
  if (exact && (mentionedFileNames.size > files.length ||
      (files.length > 1 && files.some((p) => p.expectedContent === undefined)))) {
    return []; // ambiguity: require an explicit file→content statement
  }
  if (exact && files.length === 1 && files[0].expectedContent === undefined) {
    files[0].expectedContent = exact;
  }

  // ——— folder-context expansion ———
  // "Create a folder X with file notes.txt…" means the file lives INSIDE X.
  // A bare filename gets the folder(s) as high-priority candidates, with
  // the bare workspace-relative path as fallback.
  const folders = preds.filter((p) => p.kind === "folder");
  for (const p of preds) {
    if (p.kind !== "file") continue;
    if (p.relPath.includes("/")) {
      p.candidatePaths = [p.relPath];
    } else {
      p.candidatePaths = [
        ...folders.map((fd) => `${fd.relPath}/${p.relPath}`),
        p.relPath,
      ];
    }
  }
  return preds;
}

// ——— 2. real verification against disk ———

async function checkPredicate(
  p: Predicate,
): Promise<{ pass: boolean; observed: string; observedPath: string }> {
  const candidates =
    p.kind === "file" && (p.candidatePaths?.length ?? 0) > 0
      ? p.candidatePaths!
      : [p.relPath];

  let absentObserved = "";
  let mismatchObserved = "";
  for (const rel of candidates) {
    const scoped = resolveScopedPath(rel);
    if (!scoped.ok || !scoped.abs) {
      mismatchObserved ||= `invalid scope for '${rel}': ${scoped.reason ?? "path rejected"}`;
      continue;
    }
    try {
      // Completion verification must respect the same canonical path policy as
      // Guardian. A symlink inside the workspace is not proof if it resolves
      // outside the granted root. This is not a substitute for native isolation.
      const containment = await assertWithinRoot(scoped.abs);
      if (!containment.ok) {
        mismatchObserved ||= `verification denied for '${rel}': ${containment.reason ?? "outside scope"}`;
        continue;
      }
      if (p.kind === "folder") {
        const st = await fs.stat(scoped.abs);
        if (st.isDirectory()) {
          return { pass: true, observed: "directory exists on disk", observedPath: rel };
        }
        mismatchObserved ||= `path '${rel}' exists but is not a directory`;
        continue;
      }
      const readBack = await fs.readFile(scoped.abs, "utf8");
      if (p.expectedContent !== undefined) {
        if (readBack === p.expectedContent) {
          return {
            pass: true,
            observed: `content verified exactly at '${rel}' (${Buffer.byteLength(readBack, "utf8")} bytes)`,
            observedPath: rel,
          };
        }
        // Content mismatch is the MOST informative failure — keep it.
        mismatchObserved = `content mismatch at '${rel}' (read ${Buffer.byteLength(readBack, "utf8")} bytes, differs from the requested content)`;
        continue;
      }
      return {
        pass: true,
        observed: `file exists on disk at '${rel}' (${Buffer.byteLength(readBack, "utf8")} bytes)`,
        observedPath: rel,
      };
    } catch {
      absentObserved ||= `target '${rel}' absent from disk`;
    }
  }
  return {
    pass: false,
    observed: mismatchObserved || absentObserved || "target absent from disk",
    observedPath: p.relPath,
  };
}


/**
 * Specific completion proof for a source-grounded inventory analysis.
 * Both output files MUST be written in this task, durably settled and
 * independently re-read from within the Guardian workspace. The report
 * and CSV are each checked against original OWNER input, never against
 * one another alone. Unknown formats or missing provenance remain PARTIAL.
 */
async function verifyInventoryArtifacts(
  source: InventorySource,
  effects: Array<{ status: string; tool: string; argsJson: string | null }>,
  failedEffects: number,
): Promise<Arbitration> {
  const targets = new Map<"csv" | "report", string[]>();
  for (const e of effects) {
    if(e.status !== "SETTLED" || e.tool !== "write_file") continue;
    let args: {path?: unknown};
    try { args=JSON.parse(e.argsJson ?? "{}"); } catch { continue; }
    if(typeof args.path !== "string") continue;
    const kind=inventoryArtifactKind(args.path);
    if(!kind)continue;
    const paths=targets.get(kind) ?? [];
    if(!paths.includes(args.path))paths.push(args.path);
    targets.set(kind,paths);
  }
  const checked: Arbitration["predicates"]=[];
  const predicateLines: string[]=[];
  for(const kind of ["csv","report"] as const) {
    const paths=targets.get(kind) ?? [];
    if(paths.length !== 1){
      predicateLines.push("✗ INVENTORY " + kind + " — expected exactly one durably written artifact in this task, found " + paths.length);
      continue;
    }
    const rel=paths[0];
    const pred: Predicate={kind:"file",relPath:rel};
    const scoped=resolveScopedPath(rel);
    let issue: string | null = null;
    if(!scoped.ok || !scoped.abs)issue="invalid workspace-relative file path";
    else {
      const containment=await assertWithinRoot(scoped.abs);
      if(!containment.ok)issue="failed Guardian containment verification";
      else {
        try {
          const text=await fs.readFile(scoped.abs,"utf8");
          issue=kind==="csv"?verifyInventoryCsv(text,source):verifyInventoryReport(text,source);
        }catch {issue="file absent or unreadable from disk";}
      }
    }
    const pass=issue===null;
    checked.push({predicate:pred,pass,observed:pass?"all original rows and derived totals verified from disk":issue ?? "unverified"});
    predicateLines.push((pass?"✓":"✗")+" INVENTORY "+kind+" "+rel+" — "+(pass?"source fidelity, arithmetic and disk readback verified":issue));
  }
  const complete=checked.length===2 && checked.every(x=>x.pass) && predicateLines.filter(x=>x.startsWith("✗")).length===0;
  const clean=failedEffects===0;
  predicateLines.push("INVENTORY VERDICT: "+(complete && clean?"VERIFIED":"PARTIAL")+
    " — original source "+source.rows.length+" products, "+source.totalUnits+" units, "+
    (source.totalPaise/100).toFixed(2)+" INR; verified "+checked.filter(x=>x.pass).length+"/2 output files"+
    (clean?"":"; prior effect attempt failed"));
  return {verdict:complete && clean?"verified":"partial",predicateLines,predicates:checked};
}

// ——— 3. authoritative arbitration (§6.3) ———

export async function arbitrateCompletion(input: ArbitrationInput): Promise<Arbitration> {
  const { taskId, objective, toolAssisted } = input;

  // Durable effect truth for this task.
  const effects = await db.effectRecord.findMany({ where: { taskId } });
  const admittedUnsettled = effects.filter((e) => e.status === "ADMITTED").length;
  const unknownEffects = effects.filter((e) => e.status === "EFFECT_UNKNOWN").length;
  const settledOk = effects.filter((e) => e.status === "SETTLED").length;
  const failedEffects = effects.filter((e) => e.status === "FAILED").length;

  // Uncertain effects can NEVER yield a verified completion (VER-06).
  if (admittedUnsettled > 0 || unknownEffects > 0) {
    return {
      verdict: "effect_unknown",
      predicateLines: [
        `⚠ ${admittedUnsettled} admitted-unsettled + ${unknownEffects} unknown effect(s) — completion cannot be verified`,
      ],
      predicates: [],
    };
  }

  const inventoryDeliverables=/\b(?:inventory|stock)\b/i.test(objective)
    && /\b(?:csv|spreadsheet)\b/i.test(objective)
    && /(?:\b(?:report|summary)\b|[_-](?:report|summary)\.(?:txt|md)\b)/i.test(objective);
  if(toolAssisted&&inventoryDeliverables&&!input.inventorySource)
    return {verdict:"partial",predicates:[],
      predicateLines:["INVENTORY_SOURCE_UNAVAILABLE: folder-only proof cannot certify inventory"]};
  if(toolAssisted&&input.inventorySource)
    return verifyInventoryArtifacts(input.inventorySource,effects,failedEffects);
  const predicates=extractPredicates(objective);
  if(toolAssisted&&/\b(?:files?|csv|spreadsheet)\b/i.test(objective)
     &&predicates.length>0&&predicates.every(p=>p.kind==="folder"))
    return {verdict:"partial",predicates:[],
      predicateLines:["Requested file artifacts have no independent proof"]};

  // Pure conversation: no predicates, no effects.
  if (predicates.length === 0) {
    if (!toolAssisted && settledOk === 0 && failedEffects === 0) {
      return { verdict: "conversational", predicateLines: [], predicates: [] };
    }
    // A SETTLED journal entry proves the executor returned a receipt.
    // It does not establish that an external goal happened. In particular,
    // Minecraft auto_goal/collect_wood commonly acknowledge STARTED with
    // inGameOutcomeVerified:false. No success predicate means no independent
    // evidence that the user's objective is complete. Never turn a bare
    // receipt (or zero receipts) into VERIFIED.
    return {
      verdict: "partial",
      predicateLines: [
        `UNVERIFIED OUTCOME — no deterministic completion predicates for this objective; ${settledOk} settled effect receipt(s), ${failedEffects} failed effect(s). Acknowledgment/dispatched/STARTED is NOT in-game or OS outcome verification.`,
      ],
      predicates: [],
    };
  }

  // Verify EVERY predicate against actual disk state.
  const checked: Arbitration["predicates"] = [];
  for (const p of predicates) {
    const r = await checkPredicate(p);
    checked.push({
      predicate: { ...p, relPath: r.observedPath },
      pass: r.pass,
      observed: r.observed,
    });
  }
  const allPass = checked.every((c) => c.pass);
  const somePass = checked.some((c) => c.pass);

  const predicateLines = checked.map(
    (c) =>
      `${c.pass ? "✓" : "✗"} PREDICATE ${c.predicate.kind} ${c.predicate.relPath}${
        c.predicate.expectedContent !== undefined ? " (exact content)" : ""
      } — ${c.observed}`,
  );

  if (allPass) {
    // A satisfied file predicate does not erase other failed effect attempts
    // within the same task. Those failures must remain visible at arbitration.
    const clean = failedEffects === 0;
    return {
      verdict: clean ? "verified" : "partial",
      predicateLines: [...predicateLines, clean
        ? `VERDICT: VERIFIED — ${checked.length}/${checked.length} completion predicates independently confirmed on disk`
        : `VERDICT: PARTIAL — all ${checked.length} predicates currently hold, but ${failedEffects} effect attempt(s) failed`],
      predicates: checked,
    };
  }
  if (somePass || settledOk > 0) {
    return {
      verdict: "partial",
      predicateLines: [...predicateLines, `VERDICT: PARTIAL — ${checked.filter((c) => c.pass).length}/${checked.length} predicates confirmed; effects settled ${settledOk}, failed ${failedEffects}`],
      predicates: checked,
    };
  }
  return {
    verdict: "failed",
    predicateLines: [...predicateLines, "VERDICT: FAILED — zero effects executed and completion predicates are not satisfied on disk"],
    predicates: checked,
  };
}
