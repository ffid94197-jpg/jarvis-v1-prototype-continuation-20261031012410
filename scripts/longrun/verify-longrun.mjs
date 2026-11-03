import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {makePlan, nextAfterOutcome, advanceFromPersistedCheckpoint, nextSchedule, taskPrompt, findBoundedPath, nextStrategyPath, categoryOf} from '../../src/lib/agent/longrun/planner.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
let checks=0;
const check=(condition,msg)=>{assert.ok(condition,msg);checks++;};
const same=(a,b,msg)=>{assert.deepEqual(a,b,msg);checks++;};
const throws=(fn,msg)=>{assert.throws(fn,undefined,msg);checks++;};
const fixtures=[
 'Open Windows Settings, navigate Display settings and verify page',
 'Use Chrome to play an oldest YouTube video and confirm playback',
 'Join my Minecraft LAN server, follow me, gather 4 logs and check inventory',
 'Create a CSV report, verify rows and save to workspace',
 'Solve the task using an appropriate tool with evidence',
];
for(const phrase of fixtures){
 const plan=makePlan(phrase);same(plan.length,1,'one default subgoal');
 check(plan[0].strategies.length>=2,'alternatives present');
 const prompt=taskPrompt(plan,0,0,phrase);check(prompt.includes(phrase)&&prompt.includes('verify'),'task purpose retained');
 const next=nextAfterOutcome(plan,0,0,'failed');same(next.kind,'retry_alternative','failed plan reroutes');
 const last=nextAfterOutcome(plan,0,plan[0].strategies.length-1,'failed');same(last.kind,'blocked','no infinite retry');
 const completed=nextAfterOutcome(plan,0,0,'completed');same(completed.kind,'cycle_complete','goal cycle completes');
 for(const bad of ['denied','effect_unknown','cancelled','unsafe_interrupted'])same(nextAfterOutcome(plan,0,0,bad).kind,'blocked','unsafe outcomes never auto retry');
}
same(categoryOf('Minecraft bot follow player'),'minecraft');
same(categoryOf('browser youtube video'),'browser');
throws(()=>makePlan(''),'empty objective');
throws(()=>makePlan('x',[{goal:''}]),'empty subgoal');
throws(()=>makePlan('x',Array.from({length:9},(_,i)=>({goal:`g${i}`}))),'too many subgoals');
throws(()=>makePlan('x',[{goal:'hi',strategies:['']}]),'blank strategy');
throws(()=>makePlan('x',[{goal:'hi',strategies:Array.from({length:5},()=> 'hi')}]),'too many strategies');
const two=makePlan('task',['stage 1','stage 2']);
const checkpoint={routineId:'routine_123456',taskId:'task_12345678',
  stepIndex:0,routeIndex:0,outcome:'verified'};
same(advanceFromPersistedCheckpoint(two,checkpoint,{...checkpoint}).kind,'advance',
  'LangGraph-style committed checkpoint advances the correct task only');
for (const mutation of [{taskId:'stale_12345678'}, {routineId:'other_12345678'},
   {stepIndex:1},{routeIndex:1},{outcome:'completed'}]) {
  same(advanceFromPersistedCheckpoint(two,checkpoint,{...checkpoint,...mutation}).kind,
    'blocked','persisted checkpoint mismatch cannot advance another task');
}
same(advanceFromPersistedCheckpoint(two,{...checkpoint,outcome:'effect_unknown'},
 {...checkpoint,outcome:'effect_unknown'}).kind,'blocked',
 'uncertain effect checkpoint cannot grant progress');

same(nextAfterOutcome(two,0,0,'completed').stepIndex,1,'advance on verified completion');
for(const outcome of ['partial','watchdog_pause'])same(nextAfterOutcome(two,0,0,outcome).kind,'retry_alternative');
for(const mode of ['once','interval']){
 const next=nextSchedule(mode,new Date('2026-01-01T00:00:00Z'),5,new Date('2026-01-01T12:34:00Z'));
 if(mode==='once')same(next,null);else check(+next>+new Date('2026-01-01T12:34:00Z'),'skip missed intervals');
}
for(const m of [-1,0,4,10081,1.1])throws(()=>nextSchedule('interval',new Date(),m),'interval limits');
const cyc=[{id:'a',from:'s',to:'x',cost:1},{id:'b',from:'x',to:'s',cost:1},{id:'c',from:'x',to:'g',cost:2},{id:'d',from:'s',to:'g',cost:10}];
same(findBoundedPath('s','g',cyc).edges,['a','c'],'shortest path with cycle');
same(findBoundedPath('s','g',cyc,['a']).edges,['d'],'avoid disabled edge');
same(findBoundedPath('s','g',cyc,['a','d']).found,false,'unreachable');
same(findBoundedPath('s','g',[{id:'z',from:'s',to:'s',cost:1}],[],8).found,false,'bounded cyclic search');
// 50,000 independent simulated routing decisions across 20 test rounds.
const rounds=20, perRound=2500;
let decisions=0,recoveries=0, blocked=0, cycles=0;
for(let round=0;round<rounds;round++){
 for(let i=0;i<perRound;i++){
  const phrase=fixtures[(i+round)%fixtures.length];
  const plan=makePlan(phrase);
  const number=plan[0].strategies.length;
  const failed=(i*31+round)%number;
  const chosen=nextStrategyPath(plan[0],failed);
  same(chosen,failed+1<number?failed+1:null,'find alternative or stop');
  const result=nextAfterOutcome(plan,0,failed,'failed');
  same(result.kind,chosen===null?'blocked':'retry_alternative','deterministic failover');
  if(chosen===null)blocked++;else recoveries++;
  const success=nextAfterOutcome(plan,0,0,'completed');same(success.kind,'cycle_complete','terminal goal');cycles++;
  const unsafe=nextAfterOutcome(plan,0,0,'effect_unknown');same(unsafe.kind,'blocked','never repeat uncertain effect');
  decisions++;
 }
}
// Verify the production worker has owner checks, CAS lease, atomic creation,
// pause replay, and no-effect-unknown retry. These are static integration
// checks; the real Prisma/Windows worker must still be tested on-device.
const worker=readFileSync(resolve(root,'scripts/longrun/worker.ts'),'utf8');
for(const invariant of ['status !== \'ACTIVE\'','db.$transaction','leaseOwner:WORKER_ID','buildReplayFromJournal','runTask({','reconcileCrashedTasks','pendingGuiVerification>0','activeTaskId:null','maxTotalSteps','Unsafe interrupted task state'])check(worker.includes(invariant),`worker invariant ${invariant}`);
const api=readFileSync(resolve(root,'src/app/api/jarvis/routines/route.ts'),'utf8');
for(const invariant of ['requireActiveSession','role!==\'OWNER\'','ownerId:auth.ctx.principalId','maxRuns>10000','maxTotalSteps>384','where:{id:body.id,ownerId:auth.ctx.principalId}'])check(api.includes(invariant),`API invariant ${invariant}`);
console.log(JSON.stringify({pass:true,rounds,perRound,decisions,recoveries,blocked,cycles,assertions:checks, simulated:true,realWindows:false,realPrisma:false}));
