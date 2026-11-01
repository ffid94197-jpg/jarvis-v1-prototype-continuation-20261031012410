/**
 * JARVIS AGENT RUNTIME — Guardian policy primitives.
 *
 * SECURITY MODEL: fail-closed.
 *  - Every path argument must be RELATIVE and resolve strictly inside the
 *    permitted agent workspace. Absolute paths, traversal (..), Windows-style
 *    paths, null bytes and symlink escapes are all denied.
 *  - Command execution is allowlist-only. Everything not explicitly listed
 *    is denied. No shell is ever invoked (execFile without shell), and
 *    shell metacharacters are additionally rejected at validation time.
 */

import path from "path";
import fs from "fs/promises";

/** The only filesystem scope the agent may touch. */
/** Operator configured scope, never model-supplied. On Windows and Linux the default
 * is a dedicated directory inside this deployment. An external path may only be
 * selected by the trusted server operator, and remains the entire Guardian scope.
 * This portability improvement is NOT a Windows LPAC/RLM security certification. */
export const WORKSPACE_ROOT = path.resolve(
  process.env.JARVIS_AGENT_WORKSPACE || path.join(process.cwd(), "agent-workspace"),
);

export const MAX_WRITE_BYTES = 64 * 1024;
export const MAX_READ_BYTES = 64 * 1024;
export const MAX_PATH_LENGTH = 400;
export const COMMAND_TIMEOUT_MS = 10_000;

/** Reject an attempt to create source-code FILES as folders. File-extension
 * detection is a structural Guard, not OS authorization. Ordinary dotted
 * directories (e.g. .github) and version folders remain permitted. */
export function isSourceFileTarget(rel: string): boolean {
  const last = rel.replace(/\\/g,"/").split("/").filter(Boolean).pop() ?? "";
  return /\.(?:tsx?|jsx?|mjs|cjs|mts|cts|css|scss|less|html?|json|jsonc|py|sql|prisma|yaml|yml|xml|svg|md|txt|toml|go|rs|java|kt|sh|ps1)$/i.test(last);
}

export interface PathDecision {
  ok: boolean;
  reason?: string;
  abs?: string;
  rel?: string;
}

/** Resolve a user/model-supplied path into the permitted workspace (or deny). */
export function resolveScopedPath(input: unknown): PathDecision {
  if (typeof input !== "string") {
    return { ok: false, reason: "path must be a string" };
  }
  const raw = input.trim();
  if (raw.length === 0) return { ok: false, reason: "path must not be empty" };
  if (raw.length > MAX_PATH_LENGTH) {
    return { ok: false, reason: "path too long" };
  }
  if (raw.includes("\0")) {
    return { ok: false, reason: "null byte in path" };
  }
  // Windows drive / UNC paths have no meaning here and are denied outright.
  if (/^[a-zA-Z]:[\\/]/.test(raw) || /^\\\\/.test(raw)) {
    return {
      ok: false,
      reason: "windows-style paths are not permitted in this environment",
    };
  }
  if (path.isAbsolute(raw)) {
    return {
      ok: false,
      reason: "absolute paths are not permitted; use workspace-relative paths",
    };
  }
  const rel = path.posix.normalize(raw.replace(/\\/g, "/"));
  if (rel.split("/").includes("..")) {
    return { ok: false, reason: "path traversal (..) is not permitted" };
  }
  if (rel === "." || rel === "/") {
    return { ok: false, reason: "path resolves to the workspace root; name a concrete entry" };
  }
  const abs = path.join(WORKSPACE_ROOT, rel);
  if (abs !== WORKSPACE_ROOT && !abs.startsWith(WORKSPACE_ROOT + path.sep)) {
    return { ok: false, reason: "path escapes the permitted workspace" };
  }
  return { ok: true, abs, rel };
}

/** Ensure the workspace exists (idempotent). */
export async function ensureWorkspace(): Promise<void> {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
}

/**
 * Symlink-escape defense: walk up to the deepest existing ancestor, then
 * require its real (resolved) path to remain inside the real workspace root.
 */
export async function assertWithinRoot(abs: string): Promise<PathDecision> {
  const rootReal = await fs.realpath(WORKSPACE_ROOT).catch(() => null);
  if (!rootReal) return { ok: false, reason: "workspace unavailable" };
  let cur = abs;
  for (let depth = 0; depth < 64; depth++) {
    try {
      const real = await fs.realpath(cur);
      if (real === rootReal || real.startsWith(rootReal + path.sep)) {
        return { ok: true, abs };
      }
      return { ok: false, reason: "resolved path escapes the permitted workspace (symlink)" };
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return { ok: false, reason: "unable to verify path containment" };
}

// ——— COMMAND ALLOWLIST ———
// argSpec:
//   "none"    — zero arguments allowed
//   "version" — only -v / --version
//   "files"   — file arguments: EACH argument is resolved through the same
//               path gate as read_file/write_file (resolveScopedPath +
//               assertWithinRoot, async symlink check) and rewritten to the
//               Guardian-approved workspace-relative path. Anything that does
//               not resolve strictly inside the workspace is DENIED.
//   "free"    — short plain strings (no metacharacters)
export interface CommandSpec {
  argSpec: "none" | "version" | "files" | "free" | "numeric";
  maxArgs: number;
  desc: string;
}

export const COMMAND_ALLOWLIST: Record<string, CommandSpec> = {
  pwd: { argSpec: "none", maxArgs: 0, desc: "print working directory" },
  date: { argSpec: "none", maxArgs: 0, desc: "print current date/time" },
  whoami: { argSpec: "none", maxArgs: 0, desc: "print current user" },
  node: { argSpec: "version", maxArgs: 1, desc: "print node version (-v)" },
  bun: { argSpec: "version", maxArgs: 1, desc: "print bun version (-v)" },
  echo: { argSpec: "free", maxArgs: 4, desc: "print a short string" },
  ls: { argSpec: "files", maxArgs: 4, desc: "list a directory inside the workspace" },
  cat: { argSpec: "files", maxArgs: 2, desc: "print a file inside the workspace" },
  wc: { argSpec: "files", maxArgs: 2, desc: "count lines/words/bytes of a workspace file" },
  // PHASE 04: bounded pause — the ONLY allowlisted way to observe long-
  // running child behavior (timeout + cancellation tests). Strictly
  // numeric seconds; bounded by COMMAND_TIMEOUT_MS regardless.
  sleep: { argSpec: "numeric", maxArgs: 1, desc: "pause for N seconds (bounded)" },
};

export interface CommandDecision {
  ok: boolean;
  reason?: string;
  command?: string;
  args?: string[];
}

/**
 * Validate a command request against the allowlist (fail-closed).
 * ASYNC: "files" arguments require real filesystem containment checks
 * (symlink defense), so the gate revalidates them exactly like the
 * read/write tools and rewrites them to Guardian-approved relative paths.
 */
export async function validateCommand(
  command: unknown,
  args: unknown,
): Promise<CommandDecision> {
  if (typeof command !== "string" || command.length === 0) {
    return { ok: false, reason: "command must be a non-empty string" };
  }
  const spec = COMMAND_ALLOWLIST[command];
  if (!spec) {
    return {
      ok: false,
      reason: `command '${command}' is not on the Guardian allowlist`,
    };
  }
  if (args !== undefined && !Array.isArray(args)) {
    return { ok: false, reason: "command arguments must be an array of strings" };
  }
  const list: unknown[] = Array.isArray(args) ? args : [];
  if (list.length > spec.maxArgs) {
    return {
      ok: false,
      reason: `too many arguments for '${command}' (max ${spec.maxArgs})`,
    };
  }
  const clean: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") {
      return { ok: false, reason: "command arguments must be strings" };
    }
    if (raw.length === 0 || raw.length > 200) {
      return { ok: false, reason: "command argument length out of bounds" };
    }
    if (/[\u0000-\u0008\u000b-\u001f`;|&$<>]/.test(raw) || /\n|\r/.test(raw)) {
      return {
        ok: false,
        reason: "shell metacharacters are not permitted in arguments",
      };
    }
    if (spec.argSpec === "version" && !/^(-v|--version)$/.test(raw)) {
      return { ok: false, reason: `'${command}' only accepts -v / --version` };
    }
    if (spec.argSpec === "numeric" && !/^\d{1,2}$/.test(raw)) {
      return { ok: false, reason: `'${command}' only accepts a 1-2 digit number of seconds` };
    }
    if (spec.argSpec === "none") {
      return { ok: false, reason: `'${command}' takes no arguments` };
    }
    if (spec.argSpec === "files") {
      // SECURITY: each file argument goes through the SAME path gate as the
      // fs tools — relative-only, no traversal, no absolute paths, no
      // symlink escapes. The executor receives the rewritten, approved path.
      const p = resolveScopedPath(raw);
      if (!p.ok || !p.abs || !p.rel) {
        return { ok: false, reason: `file argument rejected: ${p.reason ?? "invalid path"}` };
      }
      const within = await assertWithinRoot(p.abs);
      if (!within.ok) {
        return { ok: false, reason: `file argument rejected: ${within.reason ?? "path containment failed"}` };
      }
      clean.push(p.rel);
    } else {
      clean.push(raw);
    }
  }
  return { ok: true, command, args: clean };
}
