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
import {runGuardianApprovedPlayerEngine} from "../windows/playerEngineBridge";
import type { DesktopPrepared } from "../windows/policy";
import { executeLocalProjectBuild, type LocalProjectBuildPrepared } from "./localProjectBuild";

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
  ownerId?: string,
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
    localProjectBuild?: LocalProjectBuildPrepared;
    integration?: {ownerId:string;id?:string;url?:string;server?:string;name?:string;arguments?:Record<string,unknown>};
    memory?: {ownerId:string;query:string;limit:number};
    world?: {ownerId:string;query:string;limit:number};
    evolution?: {ownerId:string;action:"stage_skill"|"list_skills"|"expand_skill"|"stage_repair"|"list_repairs"|"learn_skill"|"diagnose"|"auto_apply_repair"|"verify_repair";id?:string;sourceTaskId?:string;manifest?:unknown;candidate?:unknown;inputs?:Record<string,unknown>};
  };
  switch (tool) {
    case "evolution_skill_stage":
    case "evolution_skill_learn":
    case "evolution_skill_list":
    case "evolution_skill_run":
    case "evolution_skill_expand":
    case "evolution_repair_stage":
    case "evolution_repair_list":
    case "evolution_diagnose":
    case "evolution_repair_apply": {
      const request=prepared.evolution;
      if(!request || isCancelled())
        return {ok:false,tool,evidence:"",error:"Guardian evolution owner/session unavailable"};
      const ownerId=request.ownerId;
      try{
        if(request.action==="diagnose"){
          const {diagnoseOwnerRuntime}=await import("../evolution/diagnostics.mjs");
          const report=await diagnoseOwnerRuntime(ownerId,db);
          return {ok:report.status==="diagnosed"||report.status==="no_recent_tasks",
            tool,evidence:"Read-only owner-scoped runtime diagnosis; no code changed and no effects retried",
            detail:{...report,readOnly:true,repairAuthorizationGranted:false}};
        }
        if(request.action==="auto_apply_repair"){
          if(!request.id)return {ok:false,tool,evidence:"",error:"Repair ID missing"};
          const {getRepair,autoApplyRepair}=await import("../evolution/repairVault.mjs");
          const staged=await getRepair(ownerId,request.id);
          const {diagnoseOwnerRuntime}=await import("../evolution/diagnostics.mjs");
          const diagnosis=await diagnoseOwnerRuntime(ownerId,db);
          const currentPattern=diagnosis.patterns?.find((item:{id:string;requiresSourceInspection:boolean})=>
            item.id===staged.diagnosisPatternId&&item.requiresSourceInspection===true);
          if(!currentPattern)
            return {ok:false,tool,evidence:"",
              error:"Automatic repair requires a current repairable runtime diagnosis signal"};
          const result=await autoApplyRepair(ownerId,request.id,taskId);
          const verified=result.state==="verified"&&result.verified===true;
          const effectUnknown=!verified&&(result.state==="effect_unknown"||result.state==="applied");
          return {ok:verified,tool,
            evidence:verified
              ?"Bounded self-repair applied and static syntax verified; project tests/runtime acceptance were not run"
              :"Bounded self-repair did not reach verified state; inspect repair ledger and rollback status",
            detail:{...result,effectUnknown,sourceContentsReturned:false,runtimeTestsExecuted:false}};
        }
        if(request.action==="learn_skill"){
          const {learnFromCompletedTask}=await import("../evolution/learnFromTask.mjs");
          const learned=await learnFromCompletedTask(ownerId,db,request.sourceTaskId);
          return {ok:true,tool,
            evidence:"Task-derived skill STAGED from same-owner successful durable receipts; owner approval still required",
            detail:{...learned,executed:false,ownerApprovalRequired:true}};
        }
        if(request.action==="stage_skill"){
          const {stageSkill}=await import("../evolution/skillForge.mjs");
          const result=await stageSkill(ownerId,request.manifest);
          return {ok:true,tool,evidence:"Skill STAGED for owner review; not approved or executed",
            detail:{...result,executed:false,authorized:false,ownerApprovalRequired:true}};
        }
        if(request.action==="list_skills"){
          const {listSkills}=await import("../evolution/skillForge.mjs");
          const records=await listSkills(ownerId,{includeDrafts:false});
          return {ok:true,tool,evidence:`Listed ${Math.min(records.length,12)} of ${records.length} approved reusable skill plans`,
            detail:{skills:records.slice(0,12).map(s=>({id:s.id,name:s.name,
              description:s.description,stageCount:s.stageCount,status:s.status})),
              total:records.length,truncated:records.length>12,executed:false}};
        }
        if(request.action==="expand_skill"){
          const {expandSkill}=await import("../evolution/skillForge.mjs");
          const plan=await expandSkill(ownerId,request.id,request.inputs||{});
          const runRequested=tool==="evolution_skill_run";
          return {ok:true,tool,
            evidence:runRequested
              ? "Approved skill expanded; Core will individually authorize and journal each bounded stage"
              : "Expanded owner-approved skill into advisory plan only",
            detail:{...plan,untrustedInstructions:true,queueRequested:runRequested}};
        }
        if(request.action==="stage_repair"){
          let diagnosisPatternId:string|undefined;
          if(process.env.JARVIS_SELF_REPAIR_AUTO_APPLY==="1"){
            const spec=request.candidate as {diagnosis?:unknown};
            const match=typeof spec?.diagnosis==="string"
              ?spec.diagnosis.match(/\\b(diag_[0-9a-f]{20})\\b/):null;
            if(!match)return {ok:false,tool,evidence:"",
              error:"Automatic repair staging requires a current diagnosis pattern ID in the repair rationale"};
            const {diagnoseOwnerRuntime}=await import("../evolution/diagnostics.mjs");
            const diagnosis=await diagnoseOwnerRuntime(ownerId,db);
            const pattern=diagnosis.patterns?.find((item:{id:string;requiresSourceInspection:boolean})=>
              item.id===match[1]&&item.requiresSourceInspection===true);
            if(!pattern)return {ok:false,tool,evidence:"",
              error:"Automatic repair staging is allowed only for a current repairable code-failure signal"};
            diagnosisPatternId=match[1];
          }
          const {stageRepair}=await import("../evolution/repairVault.mjs");
          const candidate=await stageRepair(ownerId,request.candidate,{taskId,diagnosisPatternId});
          return {ok:true,tool,evidence:"Repair candidate STAGED, no file modified; automatic apply remains bounded by owner policy",
            detail:{...candidate,applied:false,executed:false,ownerApprovalRequired:process.env.JARVIS_SELF_REPAIR_AUTO_APPLY!=="1"}};
        }
        if(request.action==="list_repairs"){
          const {listRepairs}=await import("../evolution/repairVault.mjs");
          const pending=await listRepairs(ownerId);
          return {ok:true,tool,evidence:`Listed ${Math.min(pending.length,8)} of ${pending.length} owner-scoped repair candidates`,
            detail:{repairs:pending.slice(-8),total:pending.length,
              truncated:pending.length>8,sourceContentReturned:false}};
        }
        return {ok:false,tool,evidence:"",error:"Unknown guarded evolution operation"};
      }catch(e){
        const status=(e&&typeof e==="object")?(e as {status?:unknown}).status:undefined;
        const effectUnknown=tool==="evolution_repair_apply"&&status===503;
        return {ok:false,tool,evidence:"",error:e instanceof Error?e.message:"Evolution registry unavailable",
          detail:effectUnknown?{effectUnknown:true}:undefined};
      }
    }
    case "memory_recall": {
      if(!prepared.memory || isCancelled() ||
         process.env.JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED!=="1")
        return {ok:false,tool,evidence:"",error:"owner-approved memory recall unavailable"};
      const {ownerId,query,limit}=prepared.memory;
      const terms=Array.from(new Set(query.normalize("NFKC")
        .toLocaleLowerCase("en-US").match(/[\p{L}\p{N}_]+/gu)??[])).slice(0,8);
      if(!terms.length)
        return {ok:true,tool,evidence:"No matching owner-approved memories",
          detail:{records:[],searchTruncated:false,ownerOnly:true}};
      try {
        // Even a manipulated planner cannot retrieve LOCAL_PRIVATE records.
        // Prisma enforces BOTH authenticated owner isolation and explicit
        // cloud-approved classification before records reach a model.
        const candidates=await db.jarvisMemory.findMany({
          // SQLite LIKE/contains is not reliably Unicode case-folded.
          // Fetch only a bounded same-owner/approved slice, then rank in JS.
          // This keeps the database boundary private and multilingual recall
          // independent of SQLite's ASCII-only case folding.
          where:{principalId:ownerId,deletedAt:null,dataClass:"CLOUD_APPROVED"},
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
    case "world_recall": {
      if(!prepared.world || isCancelled() ||
         process.env.JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED!=="1")
        return {ok:false,tool,evidence:"",error:"owner-approved world recall unavailable"};
      const {ownerId,query,limit}=prepared.world;
      const terms=Array.from(new Set(query.normalize("NFKC").toLocaleLowerCase("en-US")
        .match(/[\p{L}\p{N}_]+/gu)??[])).slice(0,8);
      if(!terms.length)
        return {ok:true,tool,evidence:"No matching active world observations",
          detail:{records:[],searchTruncated:false,ownerOnly:true,authority:"context_only"}};
      try {
        const now=new Date();
        const candidates=await db.jarvisWorldObservation.findMany({
          // Filter owner and temporal validity in SQLite first; lexical
          // Unicode/case-fold ranking happens on this bounded local slice.
          where:{principalId:ownerId,retractedAt:null,
            AND:[{OR:[{expiresAt:null},{expiresAt:{gt:now}}]}]},
          orderBy:{observedAt:"desc"},take:500,
          select:{subject:true,predicate:true,value:true,source:true,
            provenance:true,confidence:true,observedAt:true,expiresAt:true},
        });
        if(isCancelled())return {ok:false,tool,evidence:"",error:"world recall cancelled"};
        const ranked=rankOwnerMemoryRows(candidates.map(record=>({
          key:record.subject+" "+record.predicate,
          content:record.value,updatedAt:record.observedAt,record
        })),query,limit);
        const records=ranked.map(item=>({
          subject:item.record.subject,predicate:item.record.predicate,
          value:item.record.value,source:item.record.source,
          provenance:item.record.provenance,confidence:item.record.confidence,
          observedAt:item.record.observedAt instanceof Date
            ? item.record.observedAt.toISOString():String(item.record.observedAt),
          expiresAt:item.record.expiresAt instanceof Date
            ? item.record.expiresAt.toISOString()
            : item.record.expiresAt===null?null:String(item.record.expiresAt),
          authority:"context_only",neverAuthorizesActions:true
        }));
        return {ok:true,tool,
          evidence:`Recalled ${records.length} active owner-scoped world observations; context only`,
          detail:{records,searchTruncated:candidates.length===500,
            ownerOnly:true,activeOnly:true,temporal:true,
            authority:"context_only",notAnAuthorizationSource:true}};
      }catch{
        return {ok:false,tool,evidence:"",error:"local world retrieval unavailable"};
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
    case "local_project_build":
      if (!prepared.localProjectBuild) {
        return { ok: false, tool, evidence: "", error: "Guardian local project-build approval absent" };
      }
      return executeLocalProjectBuild(
        prepared.localProjectBuild, isCancelled, (child) => registerChild(taskId, child),
      );
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
    case "minecraft_companion_spawn":
    case "minecraft_companion_stop": {
      if (!prepared.desktop) return {ok:false,tool,evidence:"",error:"Guardian desktop arguments missing"};
      // The native backend is opt-in; default Mineflayer remains untouched.
      // Never accept owner identity from a model argument or the skill registry.
      if(process.env.JARVIS_MC_BACKEND==="playerengine" &&
         (tool==="minecraft_companion_command" || tool==="minecraft_companion_join" ||
          tool==="minecraft_companion_stop" || tool==="minecraft_companion_spawn")){
        if(!ownerId)return {ok:false,tool,evidence:"",error:"Authenticated Core owner missing"};
        const native=await runGuardianApprovedPlayerEngine(taskId,ownerId,prepared.desktop,decision,isCancelled);
        return {ok:native.ok,tool,
          evidence:native.ok?"Signed native game-server observation; completion still requires Core proof":"Unverified native gameplay operation",
          detail:native.evidence,error:native.error};
      }
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
