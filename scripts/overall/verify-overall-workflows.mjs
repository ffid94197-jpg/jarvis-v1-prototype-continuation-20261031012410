/** Cross-system offline workflow/property stress. Does not execute a real agent or a Windows desktop. */
import assert from 'node:assert/strict';
import {categoryOf,makePlan,taskPrompt,nextAfterOutcome,nextSchedule,findBoundedPath} from '../../src/lib/agent/longrun/planner.mjs';
const prompts=[
 ['Inspect the Windows desktop and open Settings','desktop'],
 ['Open Chrome and play a YouTube video','browser'],
 ['Join Minecraft LAN and follow the player','minecraft'],
 ['Create a CSV report and read the file','files'],
 ['Compare apple and banana nutrition','general'],
 ['Research Appalachian trails','general'],
 ['Open my installed apps','desktop'],
 ['Use the keyboard to enter the report','desktop'],
 ['Plan a novel research investigation','general'],
 ['Review the agent model strategy','general'],
];
let state=20261028;
function rnd(){state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;}
const rounds=Math.min(25,Math.max(1,Number(process.env.OVERALL_ROUNDS||6)));
const per=Math.min(30000,Math.max(10,Number(process.env.OVERALL_CASES||5000)));
let checks=0,scenarios=0,graphCases=0,scheduleCases=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++};
const ok=(a,label)=>{assert.ok(a,label);checks++};
for(let r=0;r<rounds;r++){
 for(let i=0;i<per;i++){
  const [goal,cat]=prompts[rnd()%prompts.length];
  const plan=makePlan(goal);
  eq(plan[0].category,cat,'classification '+goal);
  eq(categoryOf(goal),cat,'category '+goal);
  ok(taskPrompt(plan,0,0,goal).includes('verify'),'prompt evidence condition');
  const f=nextAfterOutcome(plan,0,0,'failed');
  eq(f.kind,'retry_alternative','bounded recovery alternative');
  eq(nextAfterOutcome(plan,0,plan[0].strategies.length-1,'failed').kind,'blocked','bounded exhaustion');
  eq(nextAfterOutcome(plan,0,0,'effect_unknown').kind,'blocked','uncertain effect must not retry');
  eq(nextAfterOutcome(plan,0,0,'denied').kind,'blocked','guardian denied must not retry');
  eq(nextAfterOutcome(plan,0,0,'completed').kind,'cycle_complete','one-goal completion');
  scenarios++;
  const first=Date.UTC(2026,9,28,0,0,0)+((rnd()%1000)*60_000);
  const interval=(5+rnd()%60)*60_000;
  const now=first+((rnd()%400)-60)*60_000;
  const wanted=now<first?first:first+(Math.floor((now-first)/interval)+1)*interval;
  eq(+nextSchedule('interval',new Date(first),interval/60_000,new Date(now)),wanted,'schedule time property');
  scheduleCases++;
 }
 console.log(`ROUND ${r+1}/${rounds} scenarios=${per} PASS`);
}
const nodes=['start','a','b','c','d','end'];
function reference(start,end,edges){
 const d=new Map(nodes.map(n=>[n,n===start?0:Infinity]));
 for(let k=0;k<nodes.length;k++)for(const e of edges){const v=(d.get(e.from)??Infinity)+e.cost;if(v<(d.get(e.to)??Infinity))d.set(e.to,v);}
 return d.get(end);
}
for(let i=0;i<2000;i++){
 const edges=[];
 for(let j=0;j<13;j++){
  const from=nodes[rnd()%nodes.length],to=nodes[rnd()%nodes.length];
  if(from!==to)edges.push({id:`${i}-${j}`,from,to,cost:1+rnd()%30});
 }
 const got=findBoundedPath('start','end',edges,[],512),expected=reference('start','end',edges);
 eq(got.found,Number.isFinite(expected),'bounded path existence');
 if(got.found)eq(got.cost,expected,'bounded graph optimality');
 graphCases++;
}
assert.throws(()=>nextSchedule('interval','invalid date',30),/Invalid schedule timestamp/);checks++;
assert.throws(()=>makePlan(''),/Objective/);checks++;
console.log(JSON.stringify({pass:true,mode:'synthetic planner/state transitions, no agent execution',rounds,perRound:per,scenarios,scheduleCases,graphCases,assertions:checks,simulationOnly:true}));
