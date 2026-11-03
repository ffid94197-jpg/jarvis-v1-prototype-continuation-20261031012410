/**
 * JARVIS AGENT RUNTIME — Real tool executor.
 *
 * These are genuine operations against the OS (fs/promises, child_process),
 * restricted to Guardian-prepared arguments. The executor NEVER re-derives
 * paths or commands from raw model output — it only consumes what the
 * Guardian normalized and approved.
 *
 * Every result carries meaningful execution status AND evidence.
 */

import { execFile } from "child_process";
import { createHash } from "node:crypto";
import { editWorkspaceTextFile } from "./edit";
import { db } from "@/lib/db";
import { rankOwnerMemoryRows } from "../memory/contracts";
import fs from "fs/promises";
import {
  COMMAND_TIMEOUT_MS,
  MAX_READ_BYTES,
  WORKSPACE_ROOT,
} from "../guardian/policy";
import type { GuardianDecision } from "../guardian/guardian";
import { companionAction } from "../windows/bridge";
import type { DesktopPrepared } from "../windows/policy";

export interface ToolResult {
  ok: boolean;
  tool: string;
  /** Human-readable proof of what actually happened on the machine. */
  evidence: string;
  /** Structured payload for the planner observation. */
  detail?: Record<string, unknown>;
  error?: string;
}

// ——— filesystem tools ———

async function toolCreateFolder(
  prepared: { path?: string; relPath?: string },
): Promise<ToolResult> {
  try {
    await fs.mkdir(prepared.path!, { recursive: true });
    const st = await fs.stat(prepared.path!);
    return {
      ok: st.isDirectory(),
      tool: "create_folder",
      evidence: `directory created and verified on disk: ${prepared.relPath}`,
      detail: { path: prepared.relPath, isDirectory: st.isDirectory() },
    };
  } catch (err) {
    return {
      ok: false,
      tool: "create_folder",
      evidence: "",
      error: err instanceof Error ? err.message : "mkdir failed",
    };
  }
}

async function toolWriteFile(
  prepared: { path?: string; relPath?: string; content?: string },
): Promise<ToolResult> {
  try {
    await fs.writeFile(prepared.path!, prepared.content ?? "", "utf8");
    // Immediate readback — the executor verifies its own write.
    const readBack = await fs.readFile(prepared.path!, "utf8");
    const bytes = Buffer.byteLength(readBack, "utf8");
    return {
      ok: readBack === (prepared.content ?? ""),
      tool: "write_file",
      evidence: `wrote ${bytes} bytes to ${prepared.relPath} and read back ${Buffer.byteLength(readBack, "utf8")} bytes${readBack === (prepared.content ?? "") ? " (content verified)" : " (MISMATCH)"}`,
      detail: { path: prepared.relPath, bytes, verified: readBack === (prepared.content ?? "") },
    };
  } catch (err) {
    return {
      ok: false,
      tool: "write_file",
      evidence: "",
      error: err instanceof Error ? err.message : "write failed",
    };
  }
}

async function toolReadFile(
  prepared: { path?: string; relPath?: string },
): Promise<ToolResult> {
  try {
    const buf = await fs.readFile(prepared.path!);
    if (buf.byteLength > MAX_READ_BYTES) {
      const head = buf.subarray(0, MAX_READ_BYTES).toString("utf8");
      return {
        ok: true,
        tool: "read_file",
        evidence: `read ${buf.byteLength} bytes from ${prepared.relPath} (truncated to ${MAX_READ_BYTES})`,
        detail: { path: prepared.relPath, size: buf.byteLength, content: head,
        truncated:true },
      };
    }
    return {
      ok: true,
      tool: "read_file",
      evidence: `read ${buf.byteLength} bytes from ${prepared.relPath}`,
      detail: { path: prepared.relPath, size: buf.byteLength, content: buf.toString("utf8"),
        sha256:createHash("sha256").update(buf).digest("hex"),truncated:false },
    };
  } catch (err) {
    return {
      ok: false,
      tool: "read_file",
      evidence: "",
      error: err instanceof Error ? err.message : "read failed",
    };
  }
}

async function toolListDir(
  prepared: { path?: string; relPath?: string },
): Promise<ToolResult> {
  try {
    const entries = await fs.readdir(prepared.path!, { withFileTypes: true });
    const listing = entries.map((e) => `${e.name}${e.isDirectory() ? "/" : ""}`);
    return {
      ok: true,
      tool: "list_dir",
      evidence: `listed ${entries.length} entries in ${prepared.relPath}: [${listing.join(", ")}]`,
      detail: { path: prepared.relPath, entries: listing, count: entries.length },
    };
  } catch (err) {
    return {
      ok: false,
      tool: "list_dir",
      evidence: "",
      error: err instanceof Error ? err.message : "readdir failed",
    };
  }
}

// ——— process execution (allowlisted, no shell) ———

/**
 * PHASE 04 (§7.4): in-flight child registry, keyed by taskId.
 * STOP must reach ACTUAL running OS work — never just a Boolean.
 */
const g = globalThis as unknown as {
  __jarvisChildRegistry?: Map<string, Set<import("child_process").ChildProcess>>;
};
const childRegistry: Map<string, Set<import("child_process").ChildProcess>> =
  (g.__jarvisChildRegistry ??= new Map());

function registerChild(taskId: string, child: import("child_process").ChildProcess) {
  let set = childRegistry.get(taskId);
  if (!set) {
    set = new Set();
    childRegistry.set(taskId, set);
  }
  set.add(child);
  child.once("exit", () => {
    set?.delete(child);
    if (set && set.size === 0) childRegistry.delete(taskId);
  });
}

/** Terminate every in-flight child of a task: SIGTERM, then SIGKILL. */
export function killInFlightChildren(taskId: string): number {
  const set = childRegistry.get(taskId);
  if (!set || set.size === 0) return 0;
  let killed = 0;
  for (const child of [...set]) {
    try {
      if (!child.killed) {
        child.kill("SIGTERM");
        killed++;
        // Escalate if the process ignores SIGTERM.
        const c = child;
        setTimeout(() => {
          try {
            // child.killed becomes true after SIGTERM is SENT, not when the
            // process actually exits. Therefore it must NOT guard escalation.
            if (c.exitCode === null) c.kill("SIGKILL");
          } catch { /* already gone */ }
        }, 1500).unref?.();
      }
    } catch { /* already gone */ }
  }
  return killed;
}

async function toolRunCommand(
  taskId: string,
  prepared: { command?: string; args?: string[] },
): Promise<ToolResult> {
  return new Promise<ToolResult>((resolve) => {
    const child = execFile(
      prepared.command!,
      prepared.args ?? [],
      {
        cwd: WORKSPACE_ROOT,
        timeout: COMMAND_TIMEOUT_MS,
        shell: false, // NEVER a shell. Direct exec of the allowlisted binary.
        maxBuffer: 1024 * 64,
        encoding: "utf8" as const,
        // Minimal environment: only what the allowlisted read-only binaries
        // need. No application secrets, DATABASE_URL, or token material is
        // ever handed to a child process.
        env: {
          PATH: process.env.PATH ?? "",
          HOME: WORKSPACE_ROOT,
          LANG: "C.UTF-8",
          TERM: "dumb",
          NODE_ENV: process.env.NODE_ENV,
        },
      },
      (error, stdout, stderr) => {
        const terminated = error && (error as { killed?: boolean }).killed === true;
        const exitCode = error && typeof (error as { code?: number }).code === "number"
          ? (error as { code?: number }).code
          : error
            ? 1
            : 0;
        const out = (stdout ?? "").slice(0, 4000);
        const errOut = (stderr ?? "").slice(0, 2000);
        resolve({
          ok: exitCode === 0 && !terminated,
          tool: "run_command",
          evidence: terminated
            ? `command '${[prepared.command, ...(prepared.args ?? [])].join(" ")}' was TERMINATED by cancellation/timeout before completion`
            : `command '${[prepared.command, ...(prepared.args ?? [])].join(" ")}' exited with code ${exitCode}; stdout: ${out.slice(0, 300) || "(empty)"}`,
          detail: {
            command: prepared.command,
            args: prepared.args ?? [],
            exitCode,
            terminated,
            stdout: out,
            stderr: errOut,
          },
          error: terminated
            ? "process terminated by cancellation"
            : exitCode === 0
              ? undefined
              : `exit code ${exitCode}${errOut ? `: ${errOut.slice(0, 200)}` : ""}`,
        });
      },
    );
    registerChild(taskId, child);
  });
}

// ——— dispatch ———

/** Execute one tool by name using ONLY Guardian-prepared arguments. */
export async function executeTool(
  taskId: string,
  tool: string,
  decision: GuardianDecision,
  isCancelled: () => boolean = () => false,
): Promise<ToolResult> {
  const prepared = (decision.prepared ?? {}) as {
    path?: string;
    relPath?: string;
    content?: string;
    expectedSha256?: string;
    oldText?: string;
    newText?: string;
    command?: string;
    args?: string[];
    desktop?: DesktopPrepared;
    integration?: {ownerId:string;id?:string;url?:string;server?:string;name?:string;arguments?:Record<string,unknown>};
    memory?: {ownerId:string;query:string;limit:number};
  };
  switch (tool) {
    case "memory_recall": {
      if(!prepared.memory || isCancelled() ||
         process.env.JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED!=="1")
        return {ok:false,tool,evidence:"",error:"owner-approved memory recall unavailable"};
      const {ownerId,query,limit}=prepared.memory;
      const terms=Array.from(new Set(query.toLocaleLowerCase("en-US")
        .match(/[a-z0-9_]+/g)??[])).slice(0,8);
      if(!terms.length)
        return {ok:true,tool,evidence:"No matching owner-approved memories",
          detail:{records:[],searchTruncated:false,ownerOnly:true}};
      try {
        // Even a manipulated planner cannot retrieve LOCAL_PRIVATE records.
        // Prisma enforces BOTH authenticated owner isolation and explicit
        // cloud-approved classification before records reach a model.
        const candidates=await db.jarvisMemory.findMany({
          where:{principalId:ownerId,deletedAt:null,dataClass:"CLOUD_APPROVED",
            OR:terms.flatMap(term=>[
              {key:{contains:term}},{content:{contains:term}}
            ])},
          orderBy:{updatedAt:"desc"},take:500,
          select:{key:true,content:true,source:true,version:true,updatedAt:true},
        });
        if(isCancelled())return {ok:false,tool,evidence:"",error:"memory recall cancelled"};
        const records=rankOwnerMemoryRows(candidates,query,limit).map(item=>({
          key:item.key,content:item.content.slice(0,1200),
          source:item.source,version:item.version,
          userReportedNotVerified:true
        }));
        return {ok:true,tool,
          evidence:`Recalled ${records.length} owner-approved memory records (not independent proof)`,
          detail:{records,searchTruncated:candidates.length===500,
            ownerOnly:true,classification:"CLOUD_APPROVED",
            untrustedOwnerRecords:true}};
      }catch{
        return {ok:false,tool,evidence:"",error:"local memory retrieval unavailable"};
      }
    }
    case "adoption_stage_github":
    case "adoption_list":
    case "adoption_skill":
    case "adoption_mcp_list":
    case "adoption_mcp_call": {
      if(!prepared.integration) return {ok:false,tool,evidence:"",error:"Guardian integration arguments missing"};
      if(isCancelled()) return {ok:false,tool,evidence:"",error:"Task cancelled"};
      const a=prepared.integration;
      try {
        if(tool==="adoption_stage_github") {
          const {stageGitHub}=await import("../adoption/registry.mjs");
          const result=await stageGitHub(a.ownerId,a.url!);
          return {ok:true,tool,evidence:`Downloaded and STAGED integration ${result.id}. Owner MUST approve it in Settings → Integrations before use. No install scripts executed.`,detail:result};
        }
        if(tool==="adoption_list") {
          const {list}=await import("../adoption/registry.mjs");const items=await list(a.ownerId);
          return {ok:true,tool,evidence:`Listed ${items.length} managed integrations`,detail:{integrations:items}};
        }
        if(tool==="adoption_skill") {
          const {activateSkill}=await import("../adoption/registry.mjs");const skill=await activateSkill(a.ownerId,a.id!,a.name!);
          return {ok:true,tool,evidence:`Loaded skill '${skill.name}' as untrusted third-party instructions; not executable authority.`,detail:skill};
        }
        const {mcpOperation}=await import("../adoption/mcp.mjs");
        const result=await mcpOperation(a.ownerId,a.id!,a.server||"",tool==="adoption_mcp_call"?"call_tool":"list_tools",a.name,a.arguments||{});
        const ok=tool!=="adoption_mcp_call" || result.ok!==false;
        return {ok,tool,evidence:tool==="adoption_mcp_call"?`MCP server reported result for '${a.name}'. Remote side effect NOT independently verified.`:"Live MCP tools discovered",detail:result,error:ok?undefined:"MCP server returned tool error"};
      } catch(e) {return {ok:false,tool,evidence:"",error:e instanceof Error?e.message:"Integration failed"};}
    }
    case "create_folder":
      return toolCreateFolder(prepared);
    case "write_file":
      return toolWriteFile(prepared);
    case "edit_file": {
      if (!prepared.path || !prepared.relPath || !prepared.expectedSha256 ||
          prepared.oldText===undefined || prepared.newText===undefined)
        return {ok:false,tool,evidence:"",error:"Guardian-scoped edit arguments missing"};
      const result=await editWorkspaceTextFile({
        path:prepared.path,relPath:prepared.relPath,
        expectedSha256:prepared.expectedSha256,
        oldText:prepared.oldText,newText:prepared.newText
      },isCancelled);
      return {...result,tool};
    }
    case "read_file":
      return toolReadFile(prepared);
    case "list_dir":
      return toolListDir(prepared);
    case "run_command":
      return toolRunCommand(taskId, prepared);
    case "windows_open_url":
    case "windows_open_app":
    case "windows_open_settings":
    case "windows_discover_apps":
    case "windows_find_capability":
    case "windows_youtube_oldest":
    case "windows_watch_screen":
    case "windows_browser_search":
    case "windows_browser_inspect":
    case "windows_browser_read_page":
    case "windows_browser_click_link":
    case "windows_browser_fill_search":
    case "windows_browser_scroll":
    case "windows_list_windows":
    case "windows_focus_app":
    case "windows_launch_installed":
    case "windows_native_open_url":
    case "windows_native_verify":
    case "windows_desktop_observe":
    case "windows_native_inspect":
    case "windows_native_action":
    case "windows_desktop_state":
    case "windows_desktop_windows":
    case "windows_desktop_focus":
    case "windows_desktop_click":
    case "windows_desktop_move":
    case "windows_desktop_type":
    case "windows_desktop_keys":
    case "windows_desktop_scroll":
    case "windows_minecraft_input":
    case "minecraft_companion_command":
    case "minecraft_companion_join":
    case "minecraft_companion_stop": {
      if (!prepared.desktop) return {ok:false,tool,evidence:"",error:"Guardian desktop arguments missing"};
      const receipt = await companionAction(prepared.desktop, isCancelled, taskId);
      const verified = receipt.ok && (tool !== "minecraft_companion_join" ||
        (receipt.evidence as {joinedVerified?: boolean} | undefined)?.joinedVerified === true);
      return { ok:verified,tool,
        evidence: verified ? `Windows companion receipt: ${JSON.stringify(receipt.evidence).slice(0,1400)}` : "Unverified Windows operation",
        detail: receipt.evidence && typeof receipt.evidence === "object" ? receipt.evidence as Record<string,unknown> : undefined,
        error:verified ? undefined : receipt.error || "Windows operation not independently verified" };
    }
    default:
      return { ok: false, tool, evidence: "", error: "unknown tool" };
  }
}
