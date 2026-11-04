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
 // Conversational vs actionable separation, operator-facing JARVIS identity, and
 // Windows companion gate diagnosability. Guards the fabricated-success class
 // where an actionable objective settled `completed` after zero tool calls.
 ['CORE-CONVERSATIONAL-SEPARATION',['scripts/verify-core-conversational-separation.cjs']],
 ['MINECRAFT-NATURAL-LANGUAGE',['scripts/verify-minecraft-natural-language-routing.cjs']],
 ['MINECRAFT-FREEFORM-OWNER-CHAT',['windows-companion/minecraft-bot/verify_freeform_owner_chat_offline.cjs']],
 ['MINECRAFT-GENERAL-PLAY-INTENT',['windows-companion/minecraft-bot/verify_general_play_intent_offline.cjs']],
 ['MINECRAFT-GENERAL-OBSERVATION',['windows-companion/minecraft-bot/verify_general_observation_offline.cjs']],
 ['MINECRAFT-GENERAL-GATHER',['windows-companion/minecraft-bot/verify_general_gather_offline.cjs']],
 // One launcher authorization context must satisfy BOTH the startup preflight
 // and the runtime companion gate. Guards the observed defect where an
 // owner-authorized minecraft_companion_join was denied three times because the
 // plain local-dev launcher supplied the session contract but not the companion
 // agent flag and token. Proves the repair without lowering any gate.
 ['COMPANION-LAUNCHER-AUTHORIZATION',['scripts/verify-companion-launcher-authorization.mjs']],
 // Owner autonomy tiers (Part 2). Proves the tier is genuinely consumed by the
 // task route, the Core loop and GoalProgressWatchdog (not a decorative toggle),
 // that the default tier is byte-for-byte non-regressive, and that the profile
 // can carry NO permission: absolute ceilings hold, the anti-spin repeat limit
 // is identical at every tier, and a memory row not stamped OWNER_EXPLICIT is
 // ignored so untrusted text cannot raise JARVIS's own autonomy.
 ['AUTONOMY-TIERS',['scripts/verify-autonomy-tiers.cjs']],
 // FIX 1: an authoritative numeric HTTP status must outrank provider message
 // text. Guards the misclassification where 401 + "quota exceeded" became
 // MODEL_RATE_LIMITED — which is retryable and a failover candidate, so a
 // credential fault caused retries, backend switching and a "try again later"
 // report instead of "fix your API key". Includes the six independent
 // reproduction cases and 20,000 seeded adversarial iterations.
 ['MODEL-ERROR-STATUS-PRECEDENCE',['scripts/verify-model-error-status-precedence.cjs']],
 // FIX 2: JARVIS product identity vs accurate provider disclosure. Guards the
 // owner-observed leak where "hi" answered "Hello! I am GLM — a large language
 // model developed by Zhipu AI." Covers three root causes: the identity guard
 // defeating itself on compound self-identification, the identity contract
 // reaching the default Z.ai backend and local Ollama as prior ASSISTANT output
 // instead of a system message, and the guard over-reaching into legitimate
 // factual discussion of third-party models. Disclosure is preserved, not
 // suppressed. Includes 4,000 seeded adversarial sentences in both directions.
 ['JARVIS-IDENTITY-DISCLOSURE',['scripts/verify-jarvis-identity-disclosure.cjs']],
 // FIX 3: Core must perform REAL actions for actionable objectives. Drives
 // runTask behaviourally against the REAL completion verifier and a REAL
 // temporary filesystem (not source contracts), covering the owner-observed
 // dead end where a premature completion proposal ended the task instead of
 // triggering bounded replanning. Proves the create-file / read-back /
 // verify-contents / report-success acceptance path, that a wrong result is NOT
 // reported as success, recovery from a transient tool failure, and that a
 // Guardian denial never executes and is bounded.
 ['CORE-ACTIONABLE-EXECUTION',['scripts/verify-core-actionable-execution.cjs']],
 // Repaired and newly wired: this functional Core-interaction harness had rotted
 // silently because it threw on any unmocked specifier and was never registered
 // in package.json, so no battery caught it.
 ['GOAL-LOOP-INTEGRATION',['scripts/verify-goal-loop-integration-offline.cjs']],
 // FIX 4: the Windows companion / Minecraft authorization workflow. Drives the
 // REAL Guardian gate for the exact tool the owner saw denied
 // (minecraft_companion_join) on a simulated win32 realm, proves every missing or
 // unsafe precondition is diagnosed by NAME, that the single supported workflow
 // reaches NEXUS + Core + companion + Minecraft bridge, and that the bridge
 // receives no secrets. Also pins the newly enforced host/port/player
 // constraints and their agreement with the startup preflight.
 ['COMPANION-BRIDGE-WORKFLOW',['scripts/verify-companion-bridge-workflow.cjs']],
 // FIX 5: autonomy reliability under real fault conditions. Drives runTask with
 // the REAL modelErrors classifier so FIX 1's decisions are exercised end to end:
 // a transient provider timeout is retried, a credential failure is attempted
 // exactly once and never echoed, a rate limit is retried, budget exhaustion
 // pauses durably and RESUMES from the persisted offset, and cancellation stops
 // execution without ever emitting a completed final event.
 ['AUTONOMY-RELIABILITY',['scripts/verify-autonomy-reliability.cjs']],
 // Additional native features and source-integrity gates. These must run in the same
 // local acceptance battery; isolated helper checks are not release certification.
 ['AUTONOMY-DEEP-WINDOWS',['scripts/verify-autonomy-deep-windows.cjs']],
 ['LOCAL-DEV-NO-LOGIN',['scripts/verify-local-dev-no-login.cjs']],
 ['INVENTORY-INTEGRITY',['scripts/verify-inventory-integrity.cjs']],
 ['NATIVE-CODE-EDIT',['scripts/verify-native-code-edit.cjs']],
 ['CUA-DRIVER-OFFLINE',['scripts/verify-cua-driver-offline.mjs']],
 ['LOCAL-PROJECT-BUILD-OFFLINE',['scripts/verify-local-project-build.cjs']],
 ['NATIVE-MEMORY-RECALL',['scripts/verify-native-memory-recall.cjs']],
 ['CORPUS-VALIDATOR',['scripts/autonomy/verify-corpus-validator.cjs']],
 ['WEBBENCH-CANDIDATE-IMPORT',['scripts/autonomy/verify-webbench-candidate-import.cjs']],
 ['WINDOWS-AGENT-ARENA-CANDIDATE',['scripts/autonomy/verify-windows-agent-arena-candidate.cjs']],
 ['MINECRAFT-EFFECT-IDENTITY',['scripts/verify-minecraft-effect-identity.cjs']],
 ['MINECRAFT-OWNER-IDENTITY',['windows-companion/minecraft-bot/verify_owner_identity_offline.cjs']],
 ['MINECRAFT-FRIEND-FIXTURE',['windows-companion/minecraft-bot/verify_friend_offline.cjs']],
 ['MINECRAFT-PATHFINDER-FIXTURE',['windows-companion/minecraft-bot/verify_pathfinder_regression_offline.cjs']],
 // High-fidelity replica of the mineflayer-pathfinder 2.4.5 cancellation state
 // machine, driving the REAL lib/goto.js and lib/goals.js. Guards the sticky
 // stopPathing latch defect that killed the first navigation of every manual
 // action and blocked the one-cobblestone live milestone.
 ['MINECRAFT-PATHFINDER-LIFECYCLE',['windows-companion/minecraft-bot/verify_pathfinder_lifecycle_offline.cjs']],
 ['MINECRAFT-MCP-BRIDGE-E2E',['windows-companion/minecraft-bot/verify_mine_ai_mcp_live_bridge.cjs']],
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
