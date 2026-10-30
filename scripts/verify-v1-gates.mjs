#!/usr/bin/env node
/**
 * Portable, deliberately fail-closed V1 release assessment.
 * Offline tests are evidence for slices, never substitutes for live Windows,
 * game, mic/camera, real providers, red-team or independent owner acceptance.
 * Exits nonzero while ANY mandatory release gate lacks native evidence.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const evidence=join(root,'evidence','current_v1_release_assessment');
const ids=Array.from({length:18},(_,i)=>`G${String(i).padStart(2,'0')}`);
const descriptions=[
 'Source/toolchain, production build','Owner enrollment and session security',
 'Fail-closed release gate','Core Guardian durable effects and real postconditions',
 'Windows-native LPAC/RLM and IPC','Actual cloud/local BYOK model connection',
 'LAYA bounded model selection','Persistent owner-scoped memory and World Model',
 'Trusted Skills/MCP connectors','Real Windows app/browser actions',
 'Consented screen video/game control','Microphone, speech, face, gesture and TTS',
 'Real NEXUS orb/console/settings','Durable schedules and cross-device pairing',
 'REA isolated repair and rollback','Windows red-team and fault injection',
 'Signed/integrity-checked Windows installer and recovery',
 'Independent acceptance with owner sign-off'
];
if (process.argv.includes('--self-test')) {
 const all=ids.map((id)=>({id,status:'PASS'}));
 const acceptable=(rows)=>rows.length===ids.length && ids.every(id=>rows.some(g=>g.id===id&&g.status==='PASS'));
 if(!acceptable(all)||acceptable(all.slice(1))||acceptable(all.map((v,i)=>i===3?{...v,status:'BLOCKED'}:v))||acceptable(all.map((v,i)=>i===2?{...v,status:'FAIL'}:v))) {
  console.error('Release gate failure-injection test FAILED');process.exit(1);
 }
 console.log('RELEASE_GATE_FAIL_CLOSED 4/4 PASS (in-memory status logic only)');process.exit(0);
}
mkdirSync(evidence,{recursive:true});
const codeHash=createHash('sha256').update(readFileSync(join(root,'src','lib','agent','core','verifier.ts'))).digest('hex');
const checks=[
 ['CORE-OUTCOME-HONESTY',['scripts/verify-task-outcome-honesty.cjs']],
 ['CORE-GAME-ACTION-GATE',['scripts/verify-core-goal-action-gate.cjs']],
 ['MINECRAFT-EFFECT-IDENTITY',['scripts/verify-minecraft-effect-identity.cjs']],
 ['MINECRAFT-OWNER-IDENTITY',['windows-companion/minecraft-bot/verify_owner_identity_offline.cjs']],
 ['MINECRAFT-FRIEND-FIXTURE',['windows-companion/minecraft-bot/verify_friend_offline.cjs']],
 ['MINECRAFT-PATHFINDER-FIXTURE',['windows-companion/minecraft-bot/verify_pathfinder_regression_offline.cjs']],
];
const offline=[];
for(const [id,args] of checks){
 const proc=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024});
 const ok=proc.status===0 && !proc.error;
 const text=`COMMAND: node ${args.join(' ')}\nEXIT: ${proc.status}\n${proc.error?String(proc.error):''}\n${proc.stdout||''}\n${proc.stderr||''}`;
 writeFileSync(join(evidence,`${id}.log`),text);
 offline.push({id,status:ok?'PASS':'FAIL',exitCode:proc.status,log:`${id}.log`,logSha256:createHash('sha256').update(text).digest('hex')});
 console.log(`${ok?'PASS':'FAIL'} ${id}`);
}
const allOfflineOk=offline.every(c=>c.status==='PASS');
// None of these local fixtures certify an external platform release gate.
const gates=ids.map((id,i)=>({id,requirement:descriptions[i],status:'BLOCKED',
 reason: id==='G03' && allOfflineOk?'Core receipt/verifier fixtures passed; integrated native effects and crash recovery remain unverified':
 id==='G17'?'Independent final review and owner acceptance not yet supplied':
 `Mandatory real integration/production evidence for ${id} is not present in this isolated assessment` }));
if(!allOfflineOk){gates[3].status='FAIL';gates[3].reason='One or more targeted offline regressions failed';}
const result={schemaVersion:1,releaseVerdict:'NOT_COMPLETE',generatedAt:new Date().toISOString(),
 platform:process.platform,sourceVerifierSha256:codeHash,offline,gates,
 caveat:'Isolated candidate only; does not inspect or alter live Windows checkout. PASS of offline checks does not certify V1.'};
writeFileSync(join(evidence,'V1_RELEASE_ASSESSMENT.json'),JSON.stringify(result,null,2)+'\n');
console.log(`V1 RELEASE: NOT COMPLETE — ${gates.filter(g=>g.status!=='PASS').length}/18 mandatory release gates not independently accepted.`);
process.exitCode=1; // Deliberate: cannot print an overall PASS from only offline fixtures.
