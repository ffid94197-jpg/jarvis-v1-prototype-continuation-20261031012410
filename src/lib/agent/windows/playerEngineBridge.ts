/**
 * Opt-in, fail-closed PlayerEngine executor behind the existing Core ->
 * Guardian -> executor chain. NEVER callable directly from an LLM.
 * This is not evidence of completed Minecraft autonomy/Dragon acceptance.
 */
import {randomUUID} from "node:crypto";
import {db} from "@/lib/db";
import type {GuardianDecision} from "../guardian/guardian";
import type {DesktopPrepared} from "./policy";
import {verifyNativeCraftReceipt} from "../core/minecraftCraftProof";
import {MINECRAFT_SAFE_BUILD_MATERIALS,MINECRAFT_SAFE_GATHER_RESOURCES} from "../core/minecraftResources";
type Packet = {version:number;taskId:string;idempotencyKey:string;nonce:string;worldId:string;
  observedAt:number;status:string;observations?:Record<string,unknown>};
type SendRequest={taskId:string;idempotencyKey:string;operation:string;worldId:string;
  arguments:Record<string,unknown>;budgetMs:number;guardian:{receiptId:string;coreTaskId:string;approved:true;taskId:string;worldId:string;operation:string}};
const client = require("../../../../integrations/ai-companion-bridge/guardian-ipc-client.cjs") as
  {sendAuthorizedObjective(request:SendRequest,options:{port:number;host:"127.0.0.1";secret:string;timeoutMs:number}):Promise<Packet>};
export type PlayerEngineResult={ok:boolean;evidence?:Record<string,unknown>;error?:string};
type NativeRun={runId:string;operation:string;item?:string;before?:number;
  destination?:{x:number;y:number;z:number};equipDestination?:string;blockName?:string;
  missionGoal?:string;missionSince?:number};
const active = new Map<string,NativeRun>();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Settings={port:number;secret:string;worldId:string;ownerUuid:string;companionUuid:string};
function settings(ownerId:string):Settings {
  if(process.platform!=="win32" || process.env.JARVIS_MC_BRIDGE_ENABLE!=="1" ||
     process.env.JARVIS_MC_BACKEND!=="playerengine")throw Error("PlayerEngine disabled");
  if(!ownerId || process.env.JARVIS_MC_BRIDGE_OWNER_PRINCIPAL!==ownerId)
    throw Error("PlayerEngine JARVIS owner mismatch");
  const port=Number(process.env.JARVIS_MC_BRIDGE_PORT||"48251");
  const secret=process.env.JARVIS_MC_BRIDGE_SECRET||"";
  const worldId=process.env.JARVIS_MC_BRIDGE_WORLD||"";
  const ownerUuid=process.env.JARVIS_MC_BRIDGE_OWNER_UUID||"";
  const companionUuid=process.env.JARVIS_MC_BRIDGE_COMPANION_UUID||"";
  if(!Number.isInteger(port)||port<1024||port>65535||Buffer.byteLength(secret)<32 ||
      !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(worldId)||!UUID.test(ownerUuid)||!UUID.test(companionUuid))
    throw Error("PlayerEngine owner/world/secret settings unavailable");
  return {port,secret,worldId,ownerUuid,companionUuid};
}
/**
 * Restore ONLY the original Core task's native mission identity, never
 * executable authority. The source is the OWNER'S durably SETTLED effect,
 * not a model message, process-local cache or guessed game entity ID.
 * A signed native status read is still required before any progress proof.
 */
async function restoreNativeMissionFromCore(
  coreTaskId:string,ownerId:string,cfg:Settings
):Promise<NativeRun|undefined>{
  const task=await db.agentTask.findUnique({
    where:{id:coreTaskId},select:{ownerId:true}
  });
  if(!task || task.ownerId!==ownerId)
    throw Error("Native mission owner provenance unavailable");
  const uncertain=await db.effectRecord.count({
    where:{taskId:coreTaskId,tool:"minecraft_companion_command",
      status:{in:["ADMITTED","EFFECT_UNKNOWN"]}}
  });
  if(uncertain>0)
    throw Error("Native mission has unsettled Core effects; reconcile before restoring");
  const rows=await db.effectRecord.findMany({
    where:{taskId:coreTaskId,tool:"minecraft_companion_command",status:"SETTLED"},
    orderBy:{admittedAt:"desc"},take:40,
    select:{argsJson:true,receiptJson:true}
  });
  for(const row of rows){
    try{
      const args=JSON.parse(row.argsJson||"{}") as Record<string,unknown>;
      const receipt=JSON.parse(row.receiptJson||"{}") as Record<string,unknown>;
      const proof=receipt.detail as Record<string,unknown>|undefined;
      if(args.command!=="auto_goal" || typeof args.goal!=="string" ||
         receipt.ok!==true || !proof || proof.botAcknowledged!==true ||
         proof.command!=="auto_goal" || proof.goal!==args.goal ||
         proof.missionStartedOnly!==true ||
         !UUID.test(String(proof.nativeRunId||"")) ||
         proof.worldId!==cfg.worldId || proof.ownerUuid!==cfg.ownerUuid ||
         proof.companionUuid!==cfg.companionUuid ||
         typeof proof.nativeOperation!=="string" ||
         !["endgame","farm","smelt","sequence","transfer","gather","shelter","build_volume"].includes(proof.nativeOperation) ||
         typeof proof.nativeSince!=="number" ||
         !Number.isSafeInteger(proof.nativeSince) ||
         proof.nativeSince>Date.now()+30000 ||
         Date.now()-proof.nativeSince>14*60*60*1000)continue;
      const restored={runId:String(proof.nativeRunId),operation:proof.nativeOperation,
        missionGoal:args.goal,missionSince:proof.nativeSince};
      active.set(coreTaskId,restored);
      return restored;
    }catch{/* Unknown or damaged receipt cannot restore authority. */}
  }
  return undefined;
}
function extract(o:Packet):{health:number;hunger:number;position:{x:number;y:number;z:number};
  items:Record<string,number>;armor:Set<string>;armorSlots:string[];mainHand:string} {
  const s=o.observations;
  if(!s || s.companionUuid===undefined)throw Error("Missing server observation");
  const p={x:Number(s.x),y:Number(s.y),z:Number(s.z)};
  if(!Object.values(p).every(Number.isFinite)||!Number.isFinite(Number(s.health))||!Number.isFinite(Number(s.hunger)) ||
      !Array.isArray(s.inventory)||!Array.isArray(s.armor))throw Error("Invalid server observation");
  const items:Record<string,number>={};
  function normalizedName(entry:unknown) {
    if(!entry || typeof entry!=="object")throw Error("Invalid inventory entry");
    const raw=entry as Record<string,unknown>;
    const item=String(raw.item||"").replace(/^minecraft:/,"");
    const count=raw.count;
    if(!/^[a-z0-9_]{1,64}$/.test(item)||typeof count!=="number"||
       !Number.isInteger(count)||count<1||count>64)
      throw Error("Untrusted inventory entry");
    return {item,count:Number(count)};
  }
  for(const entry of s.inventory){const {item,count}=normalizedName(entry);items[item]=(items[item]||0)+count;}
  const armor=new Set<string>();
  for(const entry of s.armor){const {item}=normalizedName(entry);armor.add(item);}
  if(!Array.isArray(s.armorSlots)||s.armorSlots.length!==4 ||
     s.armorSlots.some(v=>typeof v!=="string"||!/^[a-z0-9_]{0,64}$/.test(v)) ||
     typeof s.mainHand!=="string"||!/^[a-z0-9_]{0,64}$/.test(s.mainHand))
      throw Error("Missing accurate equipment-slot observations");
  return {health:Number(s.health),hunger:Number(s.hunger),position:p,items,armor,
    armorSlots:s.armorSlots as string[],mainHand:s.mainHand};
}
function observation(p:Packet) {
  const state=extract(p), inv=state.items;
  const netheriteBySlot=["netherite_boots","netherite_leggings","netherite_chestplate","netherite_helmet"];
  const s=p.observations||{};
  const isWorldPoint=(b:unknown):b is {x:number;y:number;z:number}=>{
    if(!b||typeof b!=="object"||Array.isArray(b))return false;
    const o=b as Record<string,unknown>;
    return ["x","y","z"].every(k=>typeof o[k]==="number"&&Number.isFinite(o[k] as number));
  };
  const nearbyBlocks=(Array.isArray(s.nearbyBlocks)?s.nearbyBlocks:[])
    .filter((v:unknown)=>v&&typeof v==="object"&&
      /^[a-z_]{1,64}$/.test(String((v as Record<string,unknown>).name||""))&&
      isWorldPoint(v)&&["x","y","z"].every(k=>Number.isInteger(Number((v as Record<string,unknown>)[k]))))
    .slice(0,12);
  const threats=(Array.isArray(s.threats)?s.threats:[])
    .filter((v:unknown)=>v&&typeof v==="object"&&
      Number.isInteger(Number((v as Record<string,unknown>).id))&&
      typeof (v as Record<string,unknown>).name==="string"&&
      /^[a-z_]{1,64}$/.test(String((v as Record<string,unknown>).name))&&
      typeof (v as Record<string,unknown>).distance==="number"&&
      Number.isFinite(Number((v as Record<string,unknown>).distance))&&
      Number((v as Record<string,unknown>).distance)<=16)
    .slice(0,6);
  const villagers=(Array.isArray(s.villagers)?s.villagers:[])
    .filter((v:unknown)=>v&&typeof v==="object"&&
      Number.isInteger(Number((v as Record<string,unknown>).id))&&
      (v as Record<string,unknown>).name==="villager"&&
      typeof (v as Record<string,unknown>).distance==="number"&&
      Number((v as Record<string,unknown>).distance)<=10)
    .slice(0,3);
  return {
    position:state.position,inventory:{raw:inv,logs:Object.keys(inv).filter(k=>/_log$/.test(k)).reduce((n,k)=>n+inv[k],0),
      woodenPickaxe:inv.wooden_pickaxe||0},health:state.health,hunger:state.hunger,
    joined:true,busy:p.status==="running"||p.status==="accepted"||
      (typeof p.observations?.activeTaskId==="string" && UUID.test(p.observations.activeTaskId)),
    dimension:typeof s.dimension==="string" &&
      ["minecraft:overworld","minecraft:the_nether","minecraft:the_end"].includes(s.dimension)?
      s.dimension:"unknown",
    nativeGoal:typeof s.nativeGoal==="string" && /^[a-z_]{3,64}$/.test(s.nativeGoal)?s.nativeGoal:null,
    wornNetherite:netheriteBySlot.every((item,index)=>state.armorSlots[index]===item),
    heldNetheriteSword:state.mainHand==="netherite_sword",
    dragonDeadObserved:s.dragonDeadObserved===true,
    exitPortalPresent:s.exitPortalPresent===true,
    nativeRecoveryRequired:s.recoveryRequired===true,
    nativeSafetyStopped:s.safetyStopped===true,nearbyBlocks,villagers,threats,
    lastAction:"PlayerEngine game-server observation; no inferred scenery or victory"
  };
}
function operationPacket(op:string, runId:string, c:Settings,
  auth:{auditId:string;coreTaskId:string},extra:Record<string,unknown>={},budgetMs=30000):SendRequest {
  return {taskId:runId,idempotencyKey:randomUUID(),operation:op,worldId:c.worldId,
    arguments:{ownerUuid:c.ownerUuid,companionUuid:c.companionUuid,...extra},budgetMs,
    // This object is constructed ONLY inside the audited allow branch. The
    // shared key authenticates JARVIS as the source; the server checks the live owner.
    guardian:{approved:true,receiptId:auth.auditId,coreTaskId:auth.coreTaskId,
      taskId:runId,worldId:c.worldId,operation:op}};
}
async function send(op:string, id:string, c:Settings,
  auth:{auditId:string;coreTaskId:string},extra:Record<string,unknown>={},budgetMs=30000) {
  const response=await client.sendAuthorizedObjective(operationPacket(op,id,c,auth,extra,budgetMs),{
    port:c.port,host:"127.0.0.1",secret:c.secret,timeoutMs:Math.min(30000,Math.max(2000,budgetMs))
  });
  // The client separately authenticates the reply, task ID, nonce and world.
  extract(response);
  if(response.observations?.companionUuid!==c.companionUuid)throw Error("Wrong companion in signed server receipt");
  return response;
}
function physicalCount(items:Record<string,number>,item:string):number {
  if(item==="log")return Object.keys(items).filter(k=>k.endsWith("_log")).reduce((n,k)=>n+(items[k]||0),0);
  return items[item]||0;
}
function authorizedCoords(v:unknown):v is {x:number;y:number;z:number} {
  if(!v || typeof v!=="object" || Array.isArray(v))return false;
  const p=v as Record<string,unknown>;
  return Object.keys(p).length===3 && ["x","y","z"].every(k=>Number.isInteger(p[k] as number)&&
    Math.abs(p[k] as number)<=29999984);
}
function observedEquipment(packet:Packet,item:string,destination:string):boolean {
  const snapshot=extract(packet);
  const slots:Record<string,number>={feet:0,legs:1,torso:2,head:3};
  return destination==="hand"?snapshot.mainHand===item:
    Object.hasOwn(slots,destination)&&snapshot.armorSlots[slots[destination]]===item;
}
function distance(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number}) {
  return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
}
/** Must be called by the existing Core executor with its already-audited allow decision. */
export async function runGuardianApprovedPlayerEngine(
  coreTaskId:string, ownerId:string, desktop:DesktopPrepared, decision:GuardianDecision,
  isCancelled:()=>boolean=()=>false
):Promise<PlayerEngineResult> {
  try {
    if(!UUID.test(coreTaskId)||decision.verdict!=="allow"||
      decision.prepared?.desktop!==desktop||(typeof decision.auditId!=="string" || !UUID.test(decision.auditId))||
      decision.auditedTaskId!==coreTaskId)
      throw Error("Real audited Core/Guardian authorization required");
    const auth={auditId:decision.auditId,coreTaskId};
    const cfg=settings(ownerId);
    const cmd=desktop.operation==="minecraft_command"?desktop.command:
      desktop.operation==="minecraft_join"?"join":
      desktop.operation==="minecraft_spawn"?"spawn":
      desktop.operation==="minecraft_stop"?"auto_stop":null;
    if(!cmd)throw Error("Unsupported PlayerEngine tool");
    if(isCancelled() && !["auto_stop","stop","stay"].includes(cmd))throw Error("Operator cancellation before admission");
    let current=active.get(coreTaskId);
    if(!current && cmd==="auto_status")
      current=await restoreNativeMissionFromCore(coreTaskId,ownerId,cfg);
    if(cmd==="spawn"){
      if(current)throw Error("Native task active; explicit reconciliation needed before spawn");
      if(process.env.JARVIS_MC_BRIDGE_SPAWN_ENABLED!=="1")
        throw Error("Operator has disabled native companion spawning");
      if(isCancelled())throw Error("Operator cancelled before spawn");
      const runId=randomUUID();
      active.set(coreTaskId,{runId,operation:"spawn"});
      // An absent reply means UNKNOWN, not a clean failure or permission
      // to create a second companion. The Fabric journal quarantines it.
      const receipt=await send("spawn",runId,cfg,auth,{},5000);
      const scene=receipt.observations;
      const paired=receipt.status==="observed" &&
        scene?.companionUuid===cfg.companionUuid &&
        scene?.ownerUuid===cfg.ownerUuid && scene?.ownerPaired===true &&
        scene?.dimension==="minecraft:overworld" &&
        scene?.recoveryRequired!==true && scene?.safetyStopped!==true;
      if(paired)active.delete(coreTaskId);
      return {ok:paired,evidence:{
        backend:"playerengine",command:"spawn",nativeSpawnVerified:paired,
        joinedVerified:paired,ownerPaired:paired,
        worldId:cfg.worldId,ownerUuid:cfg.ownerUuid,
        companionUuid:cfg.companionUuid,realWorldReadback:paired},
        error:paired?undefined:
          "Signed native spawn/owner pairing not verified; do not retry an unknown world mutation"};
    }
    if(["join","observe","status","inventory","auto_status"].includes(cmd)){
      const packet=await send(current?"status":"inspect",current?.runId||randomUUID(),cfg,auth,{},2500);
      if(packet.status==="failed" && current)throw Error("Native task status failed");
      const world=observation(packet);
      if(current && !world.busy && !current.missionGoal)active.delete(coreTaskId);
      if(cmd==="join")return {ok:true,evidence:{joinedVerified:true,botAcknowledged:true,
        backend:"playerengine",worldId:cfg.worldId,companionUuid:cfg.companionUuid}};
      if(cmd==="auto_status") {
        const summary=packet.observations?.missionStatus;
        if(!summary || typeof summary!=="object" || Array.isArray(summary))
          return {ok:false,error:"No live native mission status for this authorized Core task"};
        const state=summary as Record<string,unknown>;
        if(!current?.missionGoal || state.goal!==current.missionGoal ||
           typeof state.status!=="string" ||
           !Number.isSafeInteger(state.since) ||
           !Number.isSafeInteger(current.missionSince) ||
           Math.abs(Number(state.since)-current.missionSince)>60000 ||
           !state.milestones || typeof state.milestones!=="object" ||
           Array.isArray(state.milestones))
          return {ok:false,error:"Native mission receipt does not belong to this Core task"};
        const encoded=JSON.stringify(state);
        if(encoded.length>1800)return {ok:false,error:"Native status exceeds bounded Core evidence parser"};
        return {ok:true,evidence:{botAcknowledged:true,command:"auto_status",
          backend:"playerengine",status:encoded,realWorldReadback:true}};
      }
      return {ok:true,evidence:{botAcknowledged:true,command:cmd,backend:"playerengine",
        status:JSON.stringify(world),verifiedGameReadback:true}};
    }
    if(cmd==="auto_stop"||cmd==="stop"||cmd==="stay") {
      // Emergency stop addresses the verified owner/companion, NOT the original
      // JS process's task map. It remains effective after a Node restart.
      const scope=desktop.operation==="minecraft_stop"?"task":"companion";
      const stopped=await send("stop",randomUUID(),cfg,auth,{scope},2500);
      if(stopped.status==="cancelled")active.delete(coreTaskId);
      return {ok:stopped.status==="cancelled",evidence:{backend:"playerengine",
        status:stopped.status,cancellationObserved:stopped.status==="cancelled"}};
    }
    if(cmd==="auto_resume") {
      if(current)throw Error("Native task must settle or be cancelled before restart");
      const restored=await send("resume",randomUUID(),cfg,auth,{},2500);
      return {ok:restored.status==="observed",
        evidence:{backend:"playerengine",resumeLatchCleared:restored.status==="observed",
          oldTaskRestarted:false,physicalReceipt:restored.observations},
        error:restored.status==="observed"?undefined:"Safety latch was not cleared"};
    }
    if(cmd==="inspect_block" && authorizedCoords(desktop.position)) {
      const block=await send("inspect_block",randomUUID(),cfg,auth,{...desktop.position},2500);
      const scene=block.observations?.inspectedBlock;
      if(block.status!=="observed" || !scene || typeof scene!=="object" ||
          Array.isArray(scene))throw Error("No verified native block observation");
      const value=scene as Record<string,unknown>;
      if(value.x!==desktop.position.x||value.y!==desktop.position.y||
         value.z!==desktop.position.z||typeof value.name!=="string")
        throw Error("Block observation target differs from Guardian-approved coordinate");
      return {ok:true,evidence:{botAcknowledged:true,backend:"playerengine",
        command:"inspect_block",status:JSON.stringify(value),
        blockObserved:true}};
    }
    if(cmd==="inspect_villager") {
      if(typeof desktop.entityId!=="number"||!Number.isInteger(desktop.entityId) ||
         desktop.entityId<0||desktop.entityId>200000)
        throw Error("Villager inspection needs a grounded bounded entity ID");
      const snapshot=await send("villager_offers",randomUUID(),cfg,auth,
        {entityId:desktop.entityId},2500);
      if(snapshot.status!=="observed" ||
         snapshot.observations?.inspectedVillagerId!==desktop.entityId ||
         !Array.isArray(snapshot.observations?.villagerOffers))
        throw Error("No bound live villager trade observation");
      const offers=snapshot.observations.villagerOffers.slice(0,8);
      return {ok:true,evidence:{botAcknowledged:true,command:"inspect_villager",
        entityId:desktop.entityId,offers,backend:"playerengine",
        tradeExecuted:false,status:JSON.stringify({entityId:desktop.entityId,offers})}};
    }
    if(cmd==="trade_villager") {
      if(current)throw Error("Existing native effect must settle before a villager transaction");
      const entityId=desktop.entityId,tradeIndex=desktop.tradeIndex,times=desktop.times;
      if(!Number.isInteger(entityId) || typeof entityId!=="number" ||
         entityId<0||entityId>200000 || !Number.isInteger(tradeIndex) ||
         typeof tradeIndex!=="number"||tradeIndex<0||tradeIndex>7 ||
         !Number.isInteger(times)||typeof times!=="number"||times<1||times>4)
        throw Error("Trade requires a bounded observed villager, offer index and quantity");
      const observed=await send("villager_offers",randomUUID(),cfg,auth,{entityId},2500);
      if(observed.status!=="observed" ||
         observed.observations?.inspectedVillagerId!==entityId ||
         !Array.isArray(observed.observations?.villagerOffers))
        throw Error("Live villager offers could not be inspected");
      const offers=observed.observations.villagerOffers as Array<Record<string,unknown>>;
      const selected=offers.find(o=>o && o.index===tradeIndex);
      if(!selected || selected.disabled!==false ||
         !Number.isInteger(selected.uses) || !Number.isInteger(selected.maxUses) ||
         Number(selected.uses)+times>Number(selected.maxUses))
        throw Error("Requested villager offer is missing, exhausted or ungrounded");
      for(const key of ["firstItem","secondItem","outputItem"])
        if(typeof selected[key]!=="string" ||
           !/^(?:minecraft:[a-z0-9_]{1,64})?$/.test(String(selected[key])))
          throw Error("Villager offer item identity malformed");
      for(const key of ["firstCount","secondCount","outputCount"])
        if(typeof selected[key]!=="number"|| !Number.isInteger(selected[key])||
           Number(selected[key])<0||Number(selected[key])>64)
          throw Error("Villager offer count malformed");
      if(Number(selected.firstCount)<1||Number(selected.outputCount)<1||
         !selected.firstItem||!selected.outputItem)
        throw Error("Villager offer lacks valid currency or output");
      const initial=extract(observed);
      if(observed.observations?.recoveryRequired===true ||
         observed.observations?.safetyStopped===true ||
         typeof observed.observations?.activeTaskId==="string")
        throw Error("Native companion is running, stopped or needs reconciliation");
      if(isCancelled())throw Error("Owner cancelled villager trade before admission");
      const runId=randomUUID();
      active.set(coreTaskId,{runId,operation:"trade",missionGoal:"trade",
        missionSince:Date.now()}); // admit locally BEFORE remote mutation
      const receipt=await send("trade",runId,cfg,auth,{
        entityId,offerIndex:tradeIndex,times,
        expectedFirstItem:selected.firstItem,expectedFirstCount:selected.firstCount,
        expectedSecondItem:selected.secondItem,expectedSecondCount:selected.secondCount,
        expectedOutputItem:selected.outputItem,expectedOutputCount:selected.outputCount,
        expectedUses:selected.uses
      },10000);
      if(receipt.status!=="observed")
        return {ok:false,error:"Native trade not durably confirmed; effect may be unknown"};
      const trade=receipt.observations?.missionStatus as Record<string,unknown>|undefined;
      const steps=trade?.milestones as Record<string,unknown>|undefined;
      const currentInventory=extract(receipt).items;
      const countAt=(items:Record<string,number>,name:string)=>
        name?items[name.replace(/^minecraft:/,"")]||0:0;
      const first=String(selected.firstItem),second=String(selected.secondItem),
        output=String(selected.outputItem);
      const expectedDelta=(name:string)=>{
        let delta=0;
        if(first===name)delta-=Number(selected.firstCount)*times;
        if(second===name)delta-=Number(selected.secondCount)*times;
        if(output===name)delta+=Number(selected.outputCount)*times;
        return delta;
      };
      const inventoryMatches=[first,second,output].every(name=>
        !name || countAt(currentInventory,name)===countAt(initial.items,name)+expectedDelta(name));
      const verified=trade?.goal==="trade" && trade.status==="complete" &&
        trade.entityId===entityId&&trade.tradeIndex===tradeIndex&&trade.times===times &&
        trade.outputItem===output&&
        trade.outputCount===Number(selected.outputCount)*times &&
        steps?.tradeDone===true &&
        Number(steps.usesBefore)===Number(selected.uses) &&
        Number(steps.usesAfter)===Number(selected.uses)+times &&
        inventoryMatches;
      if(verified){
        active.delete(coreTaskId);
        return {ok:true,evidence:{backend:"playerengine",command:"trade_villager",
          villagerId:entityId,tradeIndex,times,outputItem:output,
          outputCount:Number(selected.outputCount)*times,
          tradeVerified:true,offerUsesVerified:true,
          physicalInventoryVerified:true,durablySettled:true,
          status:JSON.stringify(trade)}};
      }
      return {ok:false,error:"Native villager trade receipt/inventory mismatch; reconcile before retry"};
    }
    if(cmd==="enchant_item"){
      if(current)throw Error("Native mutation already pending; owner must reconcile first");
      if(process.env.JARVIS_MC_BRIDGE_OWNER_XP_ENCHANT_ENABLE!=="1")
        throw Error("Owner has not opted in to native XP enchanting");
      const position=desktop.position,item=desktop.item,choice=desktop.choice;
      if(!authorizedCoords(position)||typeof item!=="string" ||
         !/^[a-z0-9_]{1,64}$/.test(item) ||
         !Number.isInteger(choice)||typeof choice!=="number"||
         choice<0||choice>2)
        throw Error("Enchant requires exact live table, source item and owner-chosen option");
      const inspection=await send("inspect_block",randomUUID(),cfg,auth,
        {...position},2500);
      const table=inspection.observations?.inspectedBlock;
      if(inspection.status!=="observed" || !table || typeof table!=="object" ||
         Array.isArray(table) ||
         (table as Record<string,unknown>).name!=="minecraft:enchanting_table" ||
         (table as Record<string,unknown>).x!==position.x ||
         (table as Record<string,unknown>).y!==position.y ||
         (table as Record<string,unknown>).z!==position.z)
        throw Error("Requested enchanting table is not freshly server-observed");
      const before=extract(inspection);
      if(before.items[item]!==1 ||
         (before.items.lapis_lazuli||0)<choice+1 ||
         inspection.observations?.recoveryRequired===true ||
         inspection.observations?.safetyStopped===true ||
         typeof inspection.observations?.activeTaskId==="string")
        throw Error("Enchantment source item, lapis, or native recovery precondition failed");
      if(isCancelled())throw Error("Owner cancelled before enchanted item mutation");
      const runId=randomUUID();
      active.set(coreTaskId,{runId,operation:"enchant",
        missionGoal:"enchant",missionSince:Date.now()});
      const response=await send("enchant",runId,cfg,auth,{
        ...position,item,choice
      },10000);
      if(response.status!=="observed")
        return {ok:false,error:"Vanilla enchanting did not settle; actual XP/item outcome may be unknown"};
      const state=response.observations?.missionStatus as Record<string,unknown>|undefined;
      const metrics=state?.milestones as Record<string,unknown>|undefined;
      const after=extract(response);
      const output=item==="book"?"enchanted_book":item;
      const physicallyMatched=(before.items.lapis_lazuli||0)-
        (after.items.lapis_lazuli||0)===choice+1 &&
        (item==="book"?
          (after.items.book||0)===0 &&
          (after.items.enchanted_book||0)===(before.items.enchanted_book||0)+1:
          after.items[item]===before.items[item]);
      const proved=state?.goal==="enchant" &&
        state?.status==="complete" &&
        state.inputItem===item && state.outputItem===output &&
        state.choice===choice && metrics?.enchantDone===true &&
        typeof metrics.xpBefore==="number" && typeof metrics.xpAfter==="number" &&
        metrics.xpBefore-metrics.xpAfter===choice+1 &&
        typeof metrics.lapisBefore==="number"&&typeof metrics.lapisAfter==="number"&&
        metrics.lapisBefore-metrics.lapisAfter===choice+1 &&
        typeof metrics.enchantmentCount==="number" &&
        Number.isInteger(metrics.enchantmentCount) && metrics.enchantmentCount>=1 &&
        physicallyMatched;
      if(proved){
        active.delete(coreTaskId);
        return {ok:true,evidence:{
          backend:"playerengine",command:"enchant_item",
          item,outputItem:output,choice,ownerXpSpent:choice+1,
          companionLapisSpent:choice+1,
          enchantmentCount:metrics!.enchantmentCount,
          genuineVanillaEnchantmentObserved:true,
          ownerAssistedXp:true,realWorldReadback:true,
          status:JSON.stringify(state)}};
      }
      return {ok:false,error:"Enchanted item/owner XP/lapis receipt mismatch; no retry without reconciliation"};
    }
    if(cmd==="auto_goal") {
      const endgames=new Set(["dragon_run","netherite_armor_run","netherite_gear_run",
        "netherite_dragon_run","dragon_then_netherite_run"]);
      const farms=new Set(["farm_crop","farm_wheat"]);
      const smelts=new Set(["smelt"]);
      const sequenced=new Set(["sequence"]);
      const transfers=new Set(["transfer"]);
      const gathered=new Set(["gather"]);
      const construction=new Set(["shelter","build_volume"]);
      const crafts=new Set(["craft"]),equips=new Set(["equip"]),travels=new Set(["travel"]),
        hostile=new Set(["defeat_hostile"]);
      const goal=String(desktop.goal||"");
      const seconds=desktop.durationSeconds===undefined?
        (endgames.has(goal)?21600:3600):desktop.durationSeconds;
      if((!endgames.has(goal)&&!farms.has(goal)&&!smelts.has(goal)&&!sequenced.has(goal)&&!transfers.has(goal)&&!gathered.has(goal)&&!construction.has(goal)&&!crafts.has(goal)&&!equips.has(goal)&&!travels.has(goal)&&!hostile.has(goal))||!Number.isInteger(seconds) ||
         (seconds as number)<10||(seconds as number)>43200)
        throw Error("Unsupported or unbounded owner mission");
      if(current)throw Error("Active native mission unresolved; inspect before any new mission");
      const before=await send("inspect",randomUUID(),cfg,auth,{},2500);
      if(before.observations?.recoveryRequired===true ||
         before.observations?.safetyStopped===true)
        throw Error("Native recovery or E-stop latch active: explicitly reconcile before new mission");
      if(typeof before.observations?.activeTaskId==="string")
        throw Error("Previous game-server task must be reconciled before starting a mission");
      if(isCancelled())throw Error("Owner cancellation before native mission admission");
      let op="endgame";
      let details:Record<string,unknown>={goal,durationSeconds:seconds};
      if(crafts.has(goal)) {
        const spec=desktop as unknown as Record<string,unknown>;
        const safe=new Set(["stick","crafting_table","chest","furnace","ladder","bread","shield","torch"]);
        if(typeof spec.item!=="string"||!safe.has(spec.item)||
           !Number.isInteger(spec.targetCount)||Number(spec.targetCount)<1||Number(spec.targetCount)>16)
          throw Error("Native craft requires an explicitly requested safe item and count 1-16");
        op="craft";
        details={goal,item:spec.item,count:spec.targetCount,durationSeconds:seconds};
      }
      if(equips.has(goal)) {
        const spec=desktop as unknown as Record<string,unknown>;
        const slot=String(spec.destinationSlot||"");
        const slots:Record<string,string[]>={
          hand:["wooden_pickaxe","stone_pickaxe","iron_pickaxe","diamond_pickaxe","netherite_pickaxe",
            "wooden_sword","stone_sword","iron_sword","diamond_sword","netherite_sword","bow","crossbow","trident","shield","torch"],
          head:["leather_helmet","iron_helmet","golden_helmet","diamond_helmet","netherite_helmet","turtle_helmet"],
          torso:["leather_chestplate","iron_chestplate","golden_chestplate","diamond_chestplate","netherite_chestplate","elytra"],
          legs:["leather_leggings","iron_leggings","golden_leggings","diamond_leggings","netherite_leggings"],
          feet:["leather_boots","iron_boots","golden_boots","diamond_boots","netherite_boots"],
        };
        if(typeof spec.item!=="string"||!Object.hasOwn(slots,slot)||!slots[slot].includes(spec.item))
          throw Error("Native equip item and destination are not in the owner-safe equipment catalogue");
        op="equip";
        details={goal,item:spec.item,destination:slot,durationSeconds:seconds};
      }
      if(travels.has(goal)) {
        const spec=desktop as unknown as Record<string,unknown>;
        if(!authorizedCoords(spec.destination)||!Number.isInteger(spec.arrivalRange)||
           Number(spec.arrivalRange)<1||Number(spec.arrivalRange)>8)
          throw Error("Native travel requires an exact bounded owner destination and arrival range");
        op="travel";
        details={goal,...(spec.destination as Record<string,number>),
          arrivalRange:spec.arrivalRange,durationSeconds:seconds};
      }
      if(hostile.has(goal)) {
        const spec=desktop as unknown as Record<string,unknown>;
        const allowed=new Set(["zombie","husk","drowned","skeleton","stray","spider","cave_spider",
          "witch","pillager","blaze","endermite","silverfish","slime","magma_cube",
          "zoglin","hoglin","phantom","wither_skeleton"]);
        if(typeof spec.mob!=="string"||!allowed.has(spec.mob)||
           !Number.isInteger(spec.entityId)||Number(spec.entityId)<0||Number(spec.entityId)>200000)
          throw Error("Native combat requires one exact freshly observed allowlisted hostile target");
        op="combat";
        details={goal,mob:spec.mob,entityId:spec.entityId,durationSeconds:seconds};
      }
      if(sequenced.has(goal)){
        const spec=desktop as unknown as Record<string,unknown>;
        if(!Array.isArray(spec.steps) || spec.steps.length<1 || spec.steps.length>8 ||
           spec.steps.some(step=>!step||typeof step!=="object"||Array.isArray(step)||
             !["gather","craft","smelt","equip","travel","tools","stone_age","iron_age","build","farm_wheat","farm_crop","build_volume","shelter","defeat_hostile","transfer","trade","enchant"].includes(String(
               (step as Record<string,unknown>).goal||""))))
          throw Error("Unsupported native sequence stage or invalid owner-declared plan");
        op="sequence";
        details={goal,steps:spec.steps,durationSeconds:seconds};
      }
      if(construction.has(goal)){
        const spec=desktop as unknown as Record<string,unknown>;
        const width=spec.width===undefined&&goal==="shelter"?3:spec.width;
        const depth=spec.depth===undefined&&goal==="shelter"?3:spec.depth;
        if(!Number.isInteger(width)||!Number.isInteger(depth)||
           Number(width)<(goal==="shelter"?3:1) ||
           Number(depth)<(goal==="shelter"?3:1) ||
           Number(width)>4||Number(depth)>4)
          throw Error("Native geometry exceeds the explicit owner footprint");
        if(goal==="shelter"){
          if(spec.position!==undefined || spec.block!==undefined ||
             spec.shape!==undefined || spec.height!==undefined)
            throw Error("Owner shelter may not inject arbitrary site/material coordinates");
          op="shelter";
          details={goal,width,depth,durationSeconds:seconds};
        }else {
          const shapes=new Set(["floor","roof","walls","solid"]);
          const materials=new Set<string>(MINECRAFT_SAFE_BUILD_MATERIALS);
          if(!authorizedCoords(spec.position) ||
             !Number.isInteger(spec.height) || Number(spec.height)<1 ||
             Number(spec.height)>3 || !shapes.has(String(spec.shape)) ||
             !materials.has(String(spec.block)) ||
             Number(width)*Number(depth)*Number(spec.height)>64 ||
             (["roof","floor"].includes(String(spec.shape)) &&
                spec.height!==1))
            throw Error("Native build_volume requires an exact bounded owner layout");
          op="build_volume";
          details={goal,position:spec.position,block:spec.block,
            width,depth,height:spec.height,shape:spec.shape,
            durationSeconds:seconds};
        }
      }
      if(gathered.has(goal)){
        const spec=desktop as unknown as Record<string,unknown>;
        const allow=new Set<string>(MINECRAFT_SAFE_GATHER_RESOURCES);
        if(typeof spec.resource!=="string" || !allow.has(spec.resource) ||
           typeof spec.targetCount!=="number" ||
           !Number.isInteger(spec.targetCount) || spec.targetCount<1 ||
           spec.targetCount>64)
          throw Error("Native resource mission must be an exact allowed resource and 1–64 new items");
        op="gather";
        details={goal,resource:spec.resource,targetCount:spec.targetCount,
          durationSeconds:seconds};
      }
      if(smelts.has(goal)) {
        const spec=desktop as unknown as Record<string,unknown>;
        const permitted=new Set(["iron_ingot","gold_ingot","glass","charcoal",
          "netherite_scrap","cooked_beef","cooked_porkchop","cooked_chicken"]);
        if(typeof spec.item!=="string" || !permitted.has(spec.item) ||
           typeof spec.targetCount!=="number" || !Number.isInteger(spec.targetCount) ||
           spec.targetCount<1 || spec.targetCount>16)
          throw Error("Unapproved or unbounded native furnace goal");
        op="smelt";
        details={goal,item:spec.item,targetCount:spec.targetCount,
          durationSeconds:seconds};
      }
      if(transfers.has(goal)){
        const spec=desktop as unknown as Record<string,unknown>;
        if(!authorizedCoords(spec.position) ||
           typeof spec.item!=="string" || !/^[a-z0-9_]{1,64}$/.test(spec.item) ||
           typeof spec.targetCount!=="number" || !Number.isInteger(spec.targetCount) ||
           spec.targetCount<1 || spec.targetCount>64 ||
           !["deposit","withdraw"].includes(String(spec.operationDirection)))
          throw Error("Native transfer requires exact observed container, item, quantity and direction");
        op="transfer";
        details={goal,item:spec.item,targetCount:spec.targetCount,
          direction:spec.operationDirection,...spec.position,durationSeconds:seconds};
      }
      if(farms.has(goal)){
        const spec=desktop as unknown as Record<string,unknown>;
        if(!authorizedCoords(spec.position) ||
           !Number.isInteger(spec.width)||!Number.isInteger(spec.depth)||
           !Number.isInteger(spec.targetCount) ||
           Number(spec.width)<1||Number(spec.width)>4 ||
           Number(spec.depth)<1||Number(spec.depth)>4 ||
           Number(spec.targetCount)<1||Number(spec.targetCount)>16)
          throw Error("Native farm requires exact owner field and bounded target");
        const crop=goal==="farm_wheat"?"wheat":String(spec.crop);
        if(!["wheat","carrots","potatoes","beetroot"].includes(crop)||
           (goal==="farm_crop"&&crop==="wheat"))throw Error("Invalid owner crop");
        op="farm";
        details={goal,durationSeconds:seconds,crop,...spec.position,
          width:spec.width,depth:spec.depth,targetCount:spec.targetCount};
      }
      const runId=randomUUID();
      const nativeSince=Date.now();
      // Record intent before the remote effect. Lost acknowledgement does not
      // confer permission to retry a potentially active long-running mission.
      active.set(coreTaskId,{runId,operation:op,missionGoal:goal,
        missionSince:nativeSince});
      const receipt=await send(op,runId,cfg,auth,details,30000);
      const admitted=["accepted","running","observed"].includes(receipt.status);
      return {ok:admitted,
        evidence:{botAcknowledged:admitted,backend:"playerengine",
          command:"auto_goal",goal,status:receipt.status,
          nativeRunId:runId,nativeSince,nativeOperation:op,worldId:cfg.worldId,
          ownerUuid:cfg.ownerUuid,companionUuid:cfg.companionUuid,
          missionStartedOnly:true,missionReceipt:receipt.observations?.missionStatus},
        error:admitted?undefined:
          "Native mission not admitted; reconcile game state before a retry"};
    }
    if(current)throw Error("Previous native action remains unresolved: inspect/status before another effect");
    let op:string, extra:Record<string,unknown>, requestedCount=0,item:string|undefined;
    let blockName:string|undefined,equipDestination:string|undefined;
    let target:{x:number;y:number;z:number}|undefined;
    if(cmd==="collect_wood"){
      op="gather";item="log";requestedCount=1;extra={item,count:1};
    }else if(cmd==="transfer_container"&&authorizedCoords(desktop.position)&&
      typeof desktop.item==="string" && /^[a-z0-9_]{1,64}$/.test(desktop.item) &&
      typeof desktop.count==="number" && Number.isInteger(desktop.count) &&
      desktop.count>=1 && desktop.count<=64 &&
      ["deposit","withdraw"].includes(String((desktop as unknown as Record<string,unknown>).operationDirection))){
      op="transfer";item=desktop.item;requestedCount=desktop.count;
      target=desktop.position;
      extra={goal:"transfer",item,targetCount:requestedCount,
        direction:(desktop as unknown as Record<string,unknown>).operationDirection,...target};
    }else if(cmd==="craft_item"&&typeof desktop.item==="string"&&
      typeof desktop.count==="number"&&Number.isInteger(desktop.count)&&
      desktop.count>=1&&desktop.count<=16){
      op="craft";item=desktop.item;requestedCount=desktop.count;extra={item,count:requestedCount};
    }else if(cmd==="navigate"&&authorizedCoords(desktop.position)){
      op="travel";target=desktop.position;extra={...target};
    }else if(cmd==="interact_block"&&authorizedCoords(desktop.position)){
      op="interact";target=desktop.position;extra={...target};
    }else if(cmd==="dig_block"&&authorizedCoords(desktop.position)){
      op="dig";target=desktop.position;extra={...target};
    }else if(cmd==="place_block"&&typeof desktop.item==="string"&&
      authorizedCoords(desktop.reference)&&authorizedCoords(desktop.face)){
      const face=desktop.face;
      if(Math.abs(face.x)+Math.abs(face.y)+Math.abs(face.z)!==1)
        throw Error("Only one adjacent block face is supported");
      target={x:desktop.reference.x+face.x,y:desktop.reference.y+face.y,z:desktop.reference.z+face.z};
      if(!authorizedCoords(target))throw Error("Block placement target outside world");
      op="build";blockName=desktop.item;extra={...target,block:blockName};
    }else if(cmd==="equip_item"&&typeof desktop.item==="string"&&
      ["hand","head","torso","legs","feet"].includes(String(desktop.destination))){
      op="equip";item=desktop.item;equipDestination=String(desktop.destination);
      extra={item,destination:equipDestination};
    }else if(cmd==="attack_hostile"&&typeof desktop.entityId==="number"&&Number.isInteger(desktop.entityId)&&
      (desktop.entityId as number)>=0&&(desktop.entityId as number)<=200000){
      op="combat";extra={entityId:desktop.entityId};
    }else throw Error("PlayerEngine operation unsupported; no mixed Mineflayer fallback in this backend");
    const baseline=await send("inspect",randomUUID(),cfg,auth,{},2500);
    if(baseline.observations?.recoveryRequired===true ||
       baseline.observations?.safetyStopped===true)
      throw Error("Unreconciled native operation or safety stop; owner must explicitly resume");
    if (typeof baseline.observations?.activeTaskId==="string")
      throw Error("Another native task is running on this companion; reconcile or emergency-stop it before another effect");
    const before=item?physicalCount(extract(baseline).items,item):undefined;
    if(isCancelled())throw Error("Cancelled before native task dispatch");
    const runId=randomUUID();
    // Record the operation BEFORE submitting it; a dropped reply is an
    // ambiguous external mutation and must never enable a blind retry.
    active.set(coreTaskId,{runId,operation:op,item,before,destination:target,
      equipDestination,blockName});
    const started=await send(op,runId,cfg,auth,extra,30000);
    if(!["accepted","running","observed"].includes(started.status))
      throw Error("Native task admission failed; inspect status before any retry");
    const until=Date.now()+29500;
    while(Date.now()<until) {
      if(isCancelled()) {
        try {await send("cancel",runId,cfg,auth,{},2500);}catch{}
        return {ok:false,error:"Cancelled; final game effects may need reconciliation"};
      }
      await new Promise(resolve=>setTimeout(resolve,500));
      const polled=await send("status",runId,cfg,auth,{},2500);
      if(polled.status==="running"||polled.status==="accepted")continue;
      active.delete(coreTaskId);
      const after=extract(polled);
      const physicallyAdded=item?physicalCount(after.items,item):0;
      const arrived=target?distance(after.position,target)<=2.5:false;
      const targetBlock=polled.observations?.targetBlock;
      const observedBlock=targetBlock && typeof targetBlock==="object" ?
        (targetBlock as Record<string,unknown>).block:null;
      const blockedResult=op==="dig"?observedBlock==="air":
        op==="build"?observedBlock===blockName:
        op==="interact" && targetBlock && typeof targetBlock==="object" ?
          (targetBlock as Record<string,unknown>).interactionChanged===true:false;
      const equipped=op==="equip" && item && equipDestination ?
        observedEquipment(polled,item,equipDestination) : false;
      const defeated=op==="combat" && polled.observations?.targetAlive===false;
      const nativeTransfer=polled.observations?.missionStatus as Record<string,unknown>|undefined;
      const transferProof=Boolean(op==="transfer" && nativeTransfer &&
        nativeTransfer.goal==="transfer" && nativeTransfer.status==="complete" &&
        nativeTransfer.item===item &&
        nativeTransfer.targetCount===requestedCount &&
        nativeTransfer.operation===(desktop as unknown as Record<string,unknown>).operationDirection &&
        (nativeTransfer.milestones as Record<string,unknown>|undefined)?.transferDone===true &&
        (String((desktop as unknown as Record<string,unknown>).operationDirection)==="deposit"?
          physicallyAdded===Number(before)-requestedCount:
          physicallyAdded===Number(before)+requestedCount));
      const nativeCraft=polled.observations?.missionStatus;
      const craftVerified=op==="craft" && typeof item==="string" &&
        Number.isSafeInteger(before) &&
        verifyNativeCraftReceipt(nativeCraft,{
          item,count:requestedCount,inventoryBefore:Number(before),
          inventoryAfter:physicallyAdded});
      const physicalProof=op==="travel"?arrived:
        op==="transfer"?transferProof:
        op==="dig"||op==="build"||op==="interact"?blockedResult:
        op==="equip"?equipped:
        op==="combat"?defeated:
        op==="craft"?craftVerified:
        Boolean(item && physicallyAdded>=Number(before)+requestedCount);
      const proved=polled.status==="observed" && physicalProof;
      return {ok:proved,evidence:{backend:"playerengine",status:polled.status,
          observed:proved,inventory:after.items,position:after.position,
          craftVerified:op==="craft"?craftVerified:undefined,
          missionStatus:op==="craft"?nativeCraft:undefined},
        error:proved?undefined:(op==="craft"?
          "Native craft lacks same-task craft-task output witness and inventory-delta proof":
          "Native completion was not verified from actual game state")};
    }
    // Deliberately leave active until a later authenticated status query settles it.
    return {ok:false,error:"Native task timed out; effect outcome unknown, do not retry"};
  }catch(err) {
    return {ok:false,error:"PlayerEngine rejected/unavailable: "+(err instanceof Error?err.message:"unknown")};
  }
}
