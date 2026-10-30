'use strict';
/** Experimental JARVIS protocol bridge to a separately running Mine AI MCP host.
 * It does NOT silently download executable code, start a second Mineflayer player,
 * claim a dragon win, or bypass JARVIS Guardian/operator controls.
 * Upstream MIT (c) 2026 AI Bengineering: https://github.com/aibengineering/mine-ai-mcp
 */
const readline=require('node:readline');
const {MineAiMcp}=require('./mine_ai_mcp_transport.cjs');
const {GroundedMcpMission}=require('./mine_ai_mcp_mission.cjs');
const client=new MineAiMcp();
let mode='stay', current=null, lastAction='idle', directFollowController=null;
const owner=String(process.env.JARVIS_MINECRAFT_PLAYER||'');
let busy=false;
const gameplay=new GroundedMcpMission(client);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function ack(id,ok,status,error){process.stdout.write('BOT_ACK '+JSON.stringify({id,ok,status:String(status||'').slice(0,1900),error})+'\n');}
function situation(v){
  // Live status has an action result envelope. Never trust stale/partial results.
  const r=v?.response?.result||v?.result||v;
  return r?.status==='succeeded'&&r?.situation&&typeof r.situation==='object'?r.situation:null;
}
function hasLivePosition(s){
 const seen=Date.parse(s?.observedAt||'');
 return !!s&&typeof s.botId==='string'&&s.botId.length>0&&
   Number.isFinite(s.position?.x)&&Number.isFinite(s.position?.y)&&Number.isFinite(s.position?.z)&&
   typeof s.dimension==='string'&&Number.isFinite(seen)&&Math.abs(Date.now()-seen)<30000;
}
function ownerPosition(s){return (s?.nearby?.players||[]).find(x=>x?.username?.toLowerCase()===owner.toLowerCase()&&x?.position)?.position||null;}
async function status(){
  const s=situation(await client.observe());
  if(!hasLivePosition(s))throw Error('MCP did not provide a current successful in-game status');
  return s;
}
function snapshot(s){
 const ownerP=ownerPosition(s);
 return {mode,engine:'mine-ai-mcp',botName:s.botId,position:s.position,dimension:s.dimension,
  ownerName:owner,ownerVisible:!!ownerP,ownerPosition:ownerP,
  health:s.vitals?.health,food:s.vitals?.food,inventory:s.inventory?.stacks||[],
  lastAction,autonomy:current?.status||'idle',autoGoal:current?.goal||null};
}
async function followOnce(abortSignal,onUpdate=()=>{}){
  const s=await status();const target=ownerPosition(s);
  if(!target)return {state:'waiting_for_owner',why:'Owner not in live nearby player tracking'};
  const dx=s.position.x-target.x,dz=s.position.z-target.z;
  if(Math.hypot(dx,dz)<=5)return {state:'near_owner',why:'Already near owner'};
  if(!client.tools.has('navigate'))return {state:'blocked',why:'Mine AI MCP navigate tool unavailable'};
  const outcome=await client.action('navigate',{x:Math.floor(target.x),y:Math.floor(target.y),z:Math.floor(target.z),range:4,rationale:'Stay near the JARVIS owner during cooperative Minecraft play'},
    {signal:abortSignal,maxWaitMs:60000,onUpdate});
  if(outcome?.state!=='settled')return {state:'pending',why:'Movement continues in Mine AI MCP',actionId:outcome.actionId};
  const result=outcome.output?.result;
  if(result?.status!=='succeeded')return {state:'blocked',why:'Navigate did not succeed: '+String(result?.error||'unknown').slice(0,140)};
  const after=await status();const ownerNow=ownerPosition(after);
  return ownerNow && Math.hypot(after.position.x-ownerNow.x,after.position.z-ownerNow.z)<=7 ?
    {state:'moved',why:'Observed owner proximity after navigation'}:
    {state:'unverified',why:'Navigation settled but owner proximity was not independently observed'};
}
async function runMission(goal,limitSeconds){
  const aborter=new AbortController();
  const mission={goal,status:'running',steps:0,successes:0,failures:[],lastDecision:null,startedAt:new Date().toISOString(),aborter};
  current=mission;mode='auto';
  const deadline=Date.now()+limitSeconds*1000;
  try{
    while(!aborter.signal.aborted && Date.now()<deadline){
      const next=['netherite_dragon_run','wood'].includes(goal)?await gameplay.step({signal:aborter.signal}):await followOnce(aborter.signal);
      mission.lastDecision=next;mission.steps++;
      if(next.state==='moved'||next.state==='near_owner'||next.verified===true)mission.successes++;
      else if(next.status?.status==='paused' || next.status?.status==='blocked' || next.status?.status==='complete'){
        mission.status=next.status.status==='complete'?'complete':'blocked';mission.failures.push(next.reason||'Unverified Minecraft mission state');break;
      }
      else if(next.state==='blocked'||next.state==='unverified'||next.state==='pending'){
        mission.failures.push(next.why);mission.status=next.state==='pending'?'effect_unknown':'blocked';break;
      }
      await pause(2500);
    }
    if(aborter.signal.aborted){gameplay.stop();mission.status='cancelled';}
    else if(mission.status==='running')mission.status='expired';
  }catch(e){mission.status='failed';mission.failures.push(String(e.message||e).slice(0,180));}
  lastAction='mission '+mission.status;mode='stay';
}
async function perform(x){
 const name=x.command,id=x.id;
 try{
  if(name==='status'||name==='inventory'||name==='observe'){
   const s=await status();const snapshotData=snapshot(s);
   ack(id,true,JSON.stringify(name==='inventory'?snapshotData.inventory:snapshotData));return;
  }
  if(name==='auto_status'){
   const m=current;
   ack(id,true,JSON.stringify(m?{goal:m.goal,status:m.status,steps:m.steps,successes:m.successes,failures:m.failures.slice(-3),lastDecision:m.lastDecision}:
     {goal:null,status:'idle',steps:0,successes:0}));return;
  }
  if(name==='stop'||name==='auto_stop'||name==='stay'){
   if(current?.status==='running'){current.aborter.abort();gameplay.stop();}if(directFollowController)directFollowController.abort();
   mode='stay';lastAction='stop requested';ack(id,true,'Stop requested; physical action cancellation is asynchronous');return;
  }
  if(name==='follow'||name==='come'){
   const controller=new AbortController();directFollowController=controller;
    let acknowledged=false;
    const onUpdate=({state,actionId})=>{
      if(!acknowledged && (state==='accepted'||state==='pending') && typeof actionId==='string' && actionId){
        acknowledged=true;
        lastAction='follow pending MCP settlement ('+actionId+')';
        ack(id,true,JSON.stringify({state:'pending',actionId,completed:false,verified:false,
          note:'Navigation accepted by MCP; final in-game outcome not yet verified'}));
      }
    };
    try{
      const result=await followOnce(controller.signal,onUpdate);
      lastAction='follow '+result.state+': '+String(result.why||'').slice(0,140);
      if(!acknowledged)ack(id,result.state==='moved'||result.state==='near_owner',JSON.stringify(result),result.why);
    }catch(e){
      lastAction='follow failed: '+String(e.message||e).slice(0,140);
      if(!acknowledged)throw e;
    }finally{if(directFollowController===controller)directFollowController=null;}
    return;
  }
  if(name==='auto_goal'){
   if(current?.status==='running')throw Error('An autonomous goal is already running');
   if(!['companion','follow','netherite_dragon_run','wood'].includes(x.goal))throw Error('Unsupported Mine AI MCP mission');
   if(!Number.isInteger(x.durationSeconds)||x.durationSeconds<10||x.durationSeconds>43200)throw Error('Invalid duration');
   if(['netherite_dragon_run','wood'].includes(x.goal))gameplay.start(x.goal,x.durationSeconds);
   void runMission(x.goal,x.durationSeconds);
   ack(id,true,'Grounded MCP mission accepted, NOT completed; use auto_status and observed game state for progress');return;
  }
  throw Error('Command not implemented for Mine AI MCP adapter; no action executed');
 }catch(e){ack(id,false,'',String(e.message||e).slice(0,260));}
}
(async()=>{
  if(!/^[A-Za-z0-9_]{1,16}$/.test(owner))throw Error('Missing configured Minecraft owner');
  await client.connect();const s=await status();
  if(!hasLivePosition(s))throw Error('No verified Minecraft player position');
  // Distinct from the existing Mineflayer spawn event marker.
  process.stdout.write('MINECRAFT_MCP_JOINED (live connected status observed)\n');
  // If the JARVIS adapter is stopped while an action is active, request a
  // cooperative cancellation from the upstream host. This does NOT certify
  // that the separate Mine AI MCP server/bot process has stopped.
  process.on('SIGTERM',()=>{
    if(current?.status==='running'){current.aborter.abort();gameplay.stop();}if(directFollowController)directFollowController.abort();
    setTimeout(()=>process.exit(0),250);
  });
  const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  rl.on('line',line=>{
    let x;try{x=JSON.parse(line);}catch{return;}
    if(!x||typeof x.id!=='string')return;
    if(busy){
      if(['status','inventory','observe','auto_status','stop','auto_stop','stay'].includes(x.command)){
        void perform(x);return;
      }
      ack(x.id,false,'','Mine AI MCP bridge busy; do not enqueue competing body actions');return;
    }
    busy=true;Promise.resolve(perform(x)).finally(()=>{busy=false;});
  });
})().catch(err=>{process.stderr.write('Mine AI MCP adapter unavailable: '+String(err.message||err)+'\n');process.exitCode=2;});
module.exports={situation,hasLivePosition,ownerPosition};
