/**
 * JARVIS AGENT RUNTIME — Guardian authorization gate.
 *
 * EVERY tool call passes through authorizeToolCall() before execution.
 *  - Allow decisions return Guardian-prepared, normalized arguments; the
 *    executor never touches raw model-supplied values.
 *  - Deny decisions carry a human-readable reason and stop the action.
 *  - Both ALLOW and DENY are written to the durable audit trail. If the
 *    audit write itself fails, the decision is force-flipped to DENY
 *    (fail-closed: no unaudited action may ever execute).
 */

import { db } from "@/lib/db";
import { validateDesktopTool, type DesktopPrepared } from "../windows/policy";
import { prepareLocalProjectBuild, type LocalProjectBuildPrepared } from "../tools/localProjectBuild";
import {
  assertWithinRoot,
  MAX_WRITE_BYTES,
  resolveScopedPath,
  validateCommand,
  WORKSPACE_ROOT,
} from "./policy";

export type GuardianVerdict = "allow" | "deny";

export interface PreparedArgs {
  path?: string;
  relPath?: string;
  content?: string;
  expectedSha256?: string;
  oldText?: string;
  newText?: string;
  command?: string;
  args?: string[];
  /** For multi-path tools (ls/cat/wc): guardian-approved absolute paths. */
  paths?: { abs: string; rel: string }[];
  desktop?: DesktopPrepared;
  localProjectBuild?: LocalProjectBuildPrepared;
  integration?: {ownerId:string;id?:string;url?:string;server?:string;name?:string;operation?:string;arguments?:Record<string,unknown>};
  memory?: {ownerId:string;query:string;limit:number};
  world?: {ownerId:string;query:string;limit:number};
  evolution?: {ownerId:string;action:"stage_skill"|"list_skills"|"expand_skill"|"stage_repair"|"list_repairs"|"learn_skill"|"diagnose"|"auto_apply_repair"|"verify_repair";
    id?:string;sourceTaskId?:string;manifest?:unknown;candidate?:unknown;inputs?:Record<string,unknown>};
}

export interface GuardianDecision {
  verdict: GuardianVerdict;
  reason?: string;
  prepared?: PreparedArgs;
}

/** Tools the Guardian knows about. Anything else is denied as unknown. */
export const GUARDIAN_KNOWN_TOOLS = [
  "create_folder",
  "write_file",
  "edit_file",
  "read_file",
  "list_dir",
  "memory_recall",
  "world_recall",
  "run_command",
  "local_project_build",
  "windows_open_url",
  "windows_open_app",
  "windows_open_settings",
  "windows_discover_apps",
  "windows_find_capability",
  "windows_youtube_oldest",
  "windows_watch_screen",
  "windows_browser_search",
  "windows_browser_inspect",
  "windows_browser_read_page",
  "windows_browser_click_link",
  "windows_browser_fill_search",
  "windows_browser_scroll",
  "windows_list_windows",
  "windows_focus_app",
  "windows_launch_installed",
  "windows_native_open_url",
  "windows_native_inspect",
  "windows_native_verify",
  "windows_desktop_observe",
  "windows_native_action",
  "windows_desktop_state",
  "windows_desktop_windows",
  "windows_desktop_focus",
  "windows_desktop_click",
  "windows_desktop_move",
  "windows_desktop_type",
  "windows_desktop_keys",
  "windows_desktop_scroll",
  "windows_minecraft_input",
  "minecraft_companion_command",
  "minecraft_companion_join",
  "minecraft_companion_spawn",
  "minecraft_companion_stop",
  "adoption_stage_github", "adoption_list", "adoption_skill", "adoption_mcp_list", "adoption_mcp_call",
  "evolution_skill_stage", "evolution_skill_list", "evolution_skill_expand", "evolution_skill_run",
  "evolution_repair_stage", "evolution_repair_list", "evolution_skill_learn", "evolution_diagnose", "evolution_repair_apply", "evolution_owner_control",
] as const;

export type GuardianTool = (typeof GUARDIAN_KNOWN_TOOLS)[number];

function deny(reason: string): GuardianDecision {
  return { verdict: "deny", reason };
}

async function writeAudit(
  taskId: string | null,
  tool: string,
  args: Record<string, unknown>,
  verdict: GuardianVerdict,
  reason: string,
): Promise<boolean> {
  // TEST-ONLY fault injection (documented in core/faults.ts): a simulated
  // audit-trail failure must flip the decision to DENY (fail-closed,
  // DUR-07). Inert unless JARVIS_TEST_FAULT=audit is explicitly set.
  if (process.env.JARVIS_TEST_FAULT === "audit") {
    return false;
  }
  try {
    await db.auditLog.create({
      data: {
        taskId: taskId ?? null,
        tool,
        // Audit is accountability metadata, NOT a second secret store.
        // The durable effect journal separately holds recovery inputs and
        // must be protected by its owner-scoped storage boundary.
        // Never persist model-supplied API keys, passwords, typed text,
        // file contents, URLs with tokens or arbitrary MCP arguments here.
        argsJson: JSON.stringify({redacted:true,fields:Object.keys(args).sort().slice(0,32)}),
        verdict: verdict.toUpperCase(),
        reason: reason.slice(0, 1000),
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** THE GATE. Authorize (and audit) one tool call. Fail-closed everywhere. */
export async function authorizeToolCall(
  ctx: { taskId: string | null; ownerId?:string; ownerControlPlane?:boolean; coreSpawnIntent?:boolean; coreOwnerXpConsent?:boolean },
  tool: string,
  rawArgs: Record<string, unknown>,
): Promise<GuardianDecision> {
  let decision: GuardianDecision = deny(`unknown tool '${tool}'`);

  if ((GUARDIAN_KNOWN_TOOLS as readonly string[]).includes(tool)) {
    switch (tool as GuardianTool) {
      case "evolution_owner_control": {
        // A model/agent can NEVER assert this flag. Only the trusted API,
        // AFTER verified session, OWNER role and origin checks, sets it.
        if(ctx.ownerControlPlane!==true || ctx.taskId!==null || !ctx.ownerId) {
          decision=deny("Owner-only trusted control plane authorization required");break;
        }
        const permitted=new Set(["stage_skill","approve_skill","disable_skill","learn_skill",
          "stage_repair","approve_repair","apply_repair","rollback_repair","verify_repair"]);
        const action=rawArgs.action;
        if(typeof action!=="string"||!permitted.has(action) ||
           Object.keys(rawArgs).some(k=>!["action","id","sourceTaskId"].includes(k))){
          decision=deny("Unsupported owner evolution mutation");break;
        }
        if(action==="learn_skill"){
          if(rawArgs.id!==undefined ||
             (rawArgs.sourceTaskId!==undefined &&
              (typeof rawArgs.sourceTaskId!=="string" ||
               !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(rawArgs.sourceTaskId)))){
            decision=deny("Invalid same-owner completed source task ID");break;
          }
        }else if(rawArgs.sourceTaskId!==undefined ||
           (!action.startsWith("stage_") &&
             (typeof rawArgs.id!=="string" ||
              !/^(?:sk|rp)_[0-9a-f]{32}$/.test(rawArgs.id) ||
              (action.endsWith("skill")&&!rawArgs.id.startsWith("sk_")) ||
              (action.endsWith("repair")&&!rawArgs.id.startsWith("rp_"))))){
          decision=deny("Exact type-matching candidate ID required");break;
        }
        decision={verdict:"allow",prepared:{evolution:{ownerId:ctx.ownerId,
          action:action as "stage_skill"|"list_skills"|"expand_skill"|"stage_repair"|"list_repairs"|"learn_skill"|"verify_repair",
          id:typeof rawArgs.id==="string"?rawArgs.id:undefined,
          sourceTaskId:typeof rawArgs.sourceTaskId==="string"?rawArgs.sourceTaskId:undefined}}};
        break;
      }
      case "evolution_skill_learn": {
        if(!ctx.ownerId || Object.keys(rawArgs).some(k=>k!=="sourceTaskId") ||
           (rawArgs.sourceTaskId!==undefined &&
            (typeof rawArgs.sourceTaskId!=="string" ||
             !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(rawArgs.sourceTaskId)))){
          decision=deny("Owner and optional real source task UUID required");break;
        }
        decision={verdict:"allow",prepared:{evolution:{ownerId:ctx.ownerId,
          action:"learn_skill",sourceTaskId:rawArgs.sourceTaskId as string|undefined}}};break;
      }
      case "evolution_skill_stage": {
        if(!ctx.ownerId){decision=deny("Authenticated owner required");break;}
        if(Object.keys(rawArgs).some(k=>k!=="manifest")){decision=deny("Only manifest is permitted");break;}
        try{
          const {normalizeSkillDraft}=await import("../evolution/skillForge.mjs");
          const manifest=normalizeSkillDraft(rawArgs.manifest);
          decision={verdict:"allow",prepared:{evolution:{ownerId:ctx.ownerId,
            action:"stage_skill",manifest}}};
        }catch(e){decision=deny(e instanceof Error?e.message:"Invalid skill draft");}
        break;
      }
      case "evolution_skill_list":
      case "evolution_repair_list": {
        if(!ctx.ownerId||Object.keys(rawArgs).length!==0) {
          decision=deny("Only an authenticated owner may list evolution candidates");break;
        }
        decision={verdict:"allow",prepared:{evolution:{ownerId:ctx.ownerId,
          action:tool==="evolution_skill_list"?"list_skills":"list_repairs"}}};break;
      }
      case "evolution_skill_run":
      case "evolution_skill_expand": {
        if(!ctx.ownerId || Object.keys(rawArgs).some(k=>!["id","inputs"].includes(k)) ||
           typeof rawArgs.id!=="string" || !/^sk_[0-9a-f]{32}$/.test(rawArgs.id)) {
          decision=deny("Approved skill id and bounded inputs required");break;
        }
        const inputs=rawArgs.inputs===undefined?{}:rawArgs.inputs;
        if(!inputs||typeof inputs!=="object"||Array.isArray(inputs)||
           Object.keys(inputs).length>8||JSON.stringify(inputs).length>2400){
          decision=deny("Invalid bounded skill inputs");break;
        }
        decision={verdict:"allow",prepared:{evolution:{ownerId:ctx.ownerId,
          action:"expand_skill",id:rawArgs.id,inputs:inputs as Record<string,unknown>}}};break;
      }
      case "evolution_diagnose": {
        if(!ctx.ownerId || Object.keys(rawArgs).length!==0){
          decision=deny("Read-only runtime diagnosis requires an authenticated owner and no arguments");break;
        }
        decision={verdict:"allow",prepared:{evolution:{ownerId:ctx.ownerId,action:"diagnose"}}};break;
      }
      case "evolution_repair_apply": {
        if(process.env.JARVIS_SELF_REPAIR_AUTO_APPLY!=="1"){
          decision=deny("Bounded automatic repair is disabled by owner policy");break;
        }
        if(!ctx.ownerId || Object.keys(rawArgs).some(k=>k!=="id") ||
           typeof rawArgs.id!=="string" || !/^rp_[0-9a-f]{32}$/.test(rawArgs.id)){
          decision=deny("A fresh staged repair ID and authenticated owner are required");break;
        }
        decision={verdict:"allow",prepared:{evolution:{ownerId:ctx.ownerId,
          action:"auto_apply_repair",id:rawArgs.id}}};break;
      }
      case "evolution_repair_stage": {
        if(!ctx.ownerId || Object.keys(rawArgs).some(k=>k!=="candidate") ||
           !rawArgs.candidate||typeof rawArgs.candidate!=="object"||
           Array.isArray(rawArgs.candidate) ||
           JSON.stringify(rawArgs.candidate).length>11000) {
          decision=deny("Bounded candidate repair and authenticated owner required");break;
        }
        const spec=rawArgs.candidate as Record<string,unknown>;
        if(typeof spec.expectedSha256!=="string"||
           !/^[a-f0-9]{64}$/.test(spec.expectedSha256) ||
           typeof spec.path!=="string" || typeof spec.oldText!=="string" ||
           typeof spec.newText!=="string" || typeof spec.diagnosis!=="string"){
          decision=deny("Repair must be based on full observed file SHA and concrete replacement");break;
        }
        // Stage ONLY: no source mutations, no unattended approvals, no arbitrary
        // patches of JARVIS runtime files. repairVault independently checks scope.
        decision={verdict:"allow",prepared:{evolution:{ownerId:ctx.ownerId,
          action:"stage_repair",candidate:spec}}};break;
      }
      case "adoption_stage_github": {
        if(!ctx.ownerId || typeof rawArgs.url!=="string") {decision=deny("Owner and GitHub URL required");break;}
        try { const {githubSpec}=await import("../adoption/registry.mjs");githubSpec(rawArgs.url);
          decision={verdict:"allow",prepared:{integration:{ownerId:ctx.ownerId,url:rawArgs.url}}};
        } catch(e) {decision=deny(e instanceof Error?e.message:"Invalid GitHub URL");}
        break;
      }
      case "adoption_list": {
        decision=ctx.ownerId?{verdict:"allow",prepared:{integration:{ownerId:ctx.ownerId}}}:deny("Owner required");break;
      }
      case "adoption_skill":
      case "adoption_mcp_list":
      case "adoption_mcp_call": {
        if(!ctx.ownerId || typeof rawArgs.id!=="string" || !/^ad_[a-f0-9]{20}$/.test(rawArgs.id)) {decision=deny("Valid managed integration ID required");break;}
        const {get}=await import("../adoption/registry.mjs");const item=await get(ctx.ownerId,rawArgs.id);
        if(!item || item.status!=="enabled") {decision=deny("Integration must first be approved in Settings → Integrations");break;}
        if(tool==="adoption_skill" && (typeof rawArgs.name!=="string"||rawArgs.name.length>90)) {decision=deny("Skill name required");break;}
        if(tool==="adoption_mcp_call" && (typeof rawArgs.name!=="string"||rawArgs.name.length>120 || !rawArgs.arguments || typeof rawArgs.arguments!=="object" || Array.isArray(rawArgs.arguments) || JSON.stringify(rawArgs.arguments).length>5000)) {decision=deny("MCP tool name and bounded argument object required");break;}
        const server=typeof rawArgs.server==="string"?rawArgs.server:"";
        if(server.length>120 || !/^[\w.-]*$/.test(server)) {decision=deny("Invalid server name");break;}
        decision={verdict:"allow",prepared:{integration:{ownerId:ctx.ownerId,id:rawArgs.id,server,name:typeof rawArgs.name==="string"?rawArgs.name:undefined,arguments:rawArgs.arguments as Record<string,unknown>|undefined}}};break;
      }
      case "memory_recall": {
        // Explicit owner opt-in required before putting even pre-classified
        // CLOUD_APPROVED memory into a model observation. Private memories
        // always remain on-device and cannot be requested via this tool.
        if(process.env.JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED!=="1"){
          decision=deny("owner has not enabled model-visible memory recall");break;
        }
        if(!ctx.ownerId){decision=deny("authenticated owner required");break;}
        if(Object.keys(rawArgs).some(k=>!["query","limit"].includes(k))){
          decision=deny("memory_recall supports query and limit only");break;
        }
        const query=rawArgs.query;
        const limit=rawArgs.limit===undefined?5:rawArgs.limit;
        if(typeof query!=="string" || query.trim().length<2 ||
            query.length>160 || /[\x00-\x1f\x7f]/.test(query) ||
            !Number.isInteger(limit) || (limit as number)<1 || (limit as number)>5){
          decision=deny("bounded memory query and 1-5 results required");break;
        }
        decision={verdict:"allow",prepared:{memory:{
          ownerId:ctx.ownerId,query:query.trim(),limit:limit as number
        }}};
        break;
      }
      case "world_recall": {
        // World Model is temporal context, never an action authority. The
        // same explicit opt-in is required before observations reach a model.
        if(process.env.JARVIS_MEMORY_RECALL_TO_MODEL_ENABLED!=="1"){
          decision=deny("owner has not enabled model-visible world recall");break;
        }
        if(!ctx.ownerId){decision=deny("authenticated owner required");break;}
        if(Object.keys(rawArgs).some(k=>!["query","limit"].includes(k))){
          decision=deny("world_recall supports query and limit only");break;
        }
        const query=rawArgs.query;
        const limit=rawArgs.limit===undefined?5:rawArgs.limit;
        if(typeof query!=="string" || query.trim().length<2 ||
            query.length>160 || /[\x00-\x1f\x7f]/.test(query) ||
            !Number.isInteger(limit) || (limit as number)<1 || (limit as number)>5){
          decision=deny("bounded world query and 1-5 results required");break;
        }
        decision={verdict:"allow",prepared:{world:{
          ownerId:ctx.ownerId,query:query.trim(),limit:limit as number
        }}};
        break;
      }
      case "create_folder":
      case "read_file":
      case "list_dir": {
        const p = resolveScopedPath(rawArgs.path);
        if (!p.ok || !p.abs || !p.rel) {
          decision = deny(p.reason ?? "invalid path");
          break;
        }
        const within = await assertWithinRoot(p.abs);
        if (!within.ok) {
          decision = deny(within.reason ?? "path containment failed");
          break;
        }
        decision = {
          verdict: "allow",
          prepared: { path: p.abs, relPath: p.rel },
        };
        break;
      }

      case "write_file": {
        const p = resolveScopedPath(rawArgs.path);
        if (!p.ok || !p.abs || !p.rel) {
          decision = deny(p.reason ?? "invalid path");
          break;
        }
        if (typeof rawArgs.content !== "string") {
          decision = deny("content must be a string");
          break;
        }
        if (Buffer.byteLength(rawArgs.content, "utf8") > MAX_WRITE_BYTES) {
          decision = deny(`content exceeds ${MAX_WRITE_BYTES} byte limit`);
          break;
        }
        const within = await assertWithinRoot(p.abs);
        if (!within.ok) {
          decision = deny(within.reason ?? "path containment failed");
          break;
        }
        decision = {
          verdict: "allow",
          prepared: { path: p.abs, relPath: p.rel, content: rawArgs.content },
        };
        break;
      }

      case "edit_file": {
        const expectedKeys=["path","expectedSha256","oldText","newText"];
        if (Object.keys(rawArgs).some(k=>!expectedKeys.includes(k))) {
          decision=deny("edit_file accepts only path, expectedSha256, oldText and newText");break;
        }
        const p=resolveScopedPath(rawArgs.path);
        if (!p.ok || !p.abs || !p.rel) {
          decision=deny(p.reason??"invalid scoped edit path");break;
        }
        const expected=rawArgs.expectedSha256, oldText=rawArgs.oldText, newText=rawArgs.newText;
        if (typeof expected!=="string" || !/^[a-f0-9]{64}$/.test(expected) ||
            typeof oldText!=="string" || !oldText.length ||
            typeof newText!=="string" ||
            /\0/.test(oldText) || /\0/.test(newText) ||
            Buffer.byteLength(oldText,"utf8")>1500 ||
            Buffer.byteLength(newText,"utf8")>1500) {
          decision=deny("edit_file requires a full SHA-256 and text fragments of at most 1500 bytes each");break;
        }
        const within=await assertWithinRoot(p.abs);
        if (!within.ok) {
          decision=deny(within.reason??"edit target leaves workspace");break;
        }
        decision={verdict:"allow",prepared:{
          path:p.abs,relPath:p.rel,expectedSha256:expected,oldText,newText
        }};
        break;
      }
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
      case "minecraft_companion_spawn": {
        // This context flag is set ONLY by runTask's exact explicit-spawn
        // intent parser. A model-selected spawn tool cannot assert it.
        if(ctx.coreSpawnIntent!==true || !ctx.ownerId || !ctx.taskId ||
           Object.keys(rawArgs).length!==0){
          decision=deny("Explicit Core-authored owner spawn intent required");break;
        }
        const validated=validateDesktopTool(tool,rawArgs);
        decision=validated.ok
          ? {verdict:"allow",prepared:{desktop:validated.prepared}}
          : deny(validated.reason);
        break;
      }
      case "minecraft_companion_command":
      case "minecraft_companion_join":
      case "minecraft_companion_stop": {
        if(tool==="minecraft_companion_command" &&
           rawArgs.command==="enchant_item" &&
           ctx.coreOwnerXpConsent!==true){
          decision=deny("Real owner XP spending requires explicit consent bound to the original Core objective");break;
        }
        const d = validateDesktopTool(tool, rawArgs);
        decision = d.ok ? {verdict:"allow",prepared:{desktop:d.prepared}} : deny(d.reason);
        break;
      }
      case "local_project_build": {
        if (!ctx.ownerId) { decision = deny("Authenticated owner required for local project build"); break; }
        const p = await prepareLocalProjectBuild(rawArgs);
        decision = p.ok && p.prepared
          ? { verdict: "allow", prepared: { localProjectBuild: p.prepared } }
          : deny(p.reason ?? "Local project build is not authorized");
        break;
      }
      case "run_command": {
        const c = await validateCommand(rawArgs.command, rawArgs.args);
        if (!c.ok || !c.command) {
          decision = deny(c.reason ?? "invalid command");
          break;
        }
        decision = {
          verdict: "allow",
          prepared: { command: c.command, args: c.args ?? [] },
        };
        break;
      }
    }
  }

  // Mandatory durable audit. If the audit trail is unavailable → DENY.
  const audited = await writeAudit(
    ctx.taskId,
    tool,
    rawArgs,
    decision.verdict,
    decision.reason ?? "authorized within permitted scope",
  );
  if (!audited) {
    return deny("guardian audit trail unavailable — action blocked (fail-closed)");
  }
  return decision;
}

export { WORKSPACE_ROOT };
