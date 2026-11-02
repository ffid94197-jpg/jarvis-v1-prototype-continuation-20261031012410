#!/usr/bin/env node
'use strict';
/**
 * Verifies the actual TypeScript Core verifier in isolation. No external API,
 * Windows automation, or Minecraft world is simulated as a completed mission.
 * Results are OFFLINE ONLY, not end-to-end evidence.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-verifier-'));
let effectRows = [];
const db = { effectRecord: { findMany: async () => effectRows } };
const containment = {
  resolveScopedPath(rel) {
    if (typeof rel !== 'string' || rel.startsWith('/') || rel.includes('..')) return {ok:false};
    return {ok:true, rel, abs:path.join(workspace, rel)};
  },
  async assertWithinRoot(abs) {
    const base = await fs.promises.realpath(workspace);
    const real = await fs.promises.realpath(abs).catch(() => null);
    if (!real) return {ok:true}; // readback will determine existence
    return {ok:real === base || real.startsWith(base + path.sep)};
  },
};
function loadTsModule(file, cache = new Map()) {
  const absolute = path.resolve(file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const mod = {exports:{}};
  cache.set(absolute, mod);
  const output = ts.transpileModule(fs.readFileSync(absolute,'utf8'), {
    fileName:absolute,
    compilerOptions:{ target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS, esModuleInterop:true },
  }).outputText;
  const mockRequire = (name) => {
    if (name === '@/lib/db') return {db};
    if (name === '../guardian/policy') return containment;
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(absolute), name);
      for (const candidate of [base+'.ts', path.join(base,'index.ts')]) {
        if (fs.existsSync(candidate)) return loadTsModule(candidate, cache);
      }
    }
    return require(name);
  };
  new Function('require','module','exports',output)(mockRequire,mod,mod.exports);
  return mod.exports;
}
function loadVerifier() {
  return loadTsModule(path.join(root, 'src/lib/agent/core/verifier.ts'));
}
const {arbitrateCompletion} = loadVerifier();
const ack = (tool,detail,args) => ({status:'SETTLED',tool,argsJson:JSON.stringify(args ?? {}),
  receiptJson:JSON.stringify({ok:true,tool,detail})});
const writeAck = (rel,content) => ack('write_file',{path:rel,verified:true},{path:rel,content});
const folderAck = rel => ack('create_folder',{path:rel,isDirectory:true},{path:rel});
let checks = 0;
async function check(label,objective,toolAssisted,rows,expected,contains) {
  effectRows = rows;
  const r = await arbitrateCompletion({taskId:'offline-task',objective,toolAssisted});
  assert.equal(r.verdict,expected,label);
  if(contains)assert.match(r.predicateLines.join(' '),contains,label);
  console.log('PASS',label,'=>' ,r.verdict);
  checks++;
}
async function main() {
 try {
  await check('plain chat stays conversational','Hi',false,[],'conversational');
  await check('tool-assisted with no durable effect cannot be VERIFIED','Check Minecraft status',true,[],'partial',/UNVERIFIED OUTCOME/);
  await check('Minecraft STARTED acknowledgment is not victory','Defeat the Ender Dragon',true,
    [ack('minecraft_companion_command',{command:'auto_goal',botAcknowledged:true,inGameOutcomeVerified:false,status:'STARTED'})],'partial',/UNVERIFIED OUTCOME/);
  await check('wood STARTED acknowledgment is not inventory proof','Collect wood in Minecraft',true,
    [ack('minecraft_companion_command',{command:'collect_wood',botAcknowledged:true,inGameOutcomeVerified:false})],'partial');
  await check('Minecraft join receipt does not prove broader dragon goal','Join Minecraft and defeat the dragon',true,
    [ack('minecraft_companion_join',{joinedVerified:true})],'partial');
  await check('generic acknowledged desktop action not a postcondition','Open Windows Settings',true,
    [ack('windows_open_settings',{accepted:true})],'partial');
  await check('several dispatched effects not proof of goal','Win Minecraft',true,
    [ack('minecraft_companion_command',{status:'STARTED'}),ack('minecraft_companion_command',{status:'running'})],'partial');
  await check('failed tool cannot cause VERIFIED','Collect wood',true,
    [{status:'FAILED',tool:'minecraft_companion_command'}],'partial');
  await check('ADMITTED uncompleted effect remains unknown','Collect wood',true,
    [{status:'ADMITTED'}],'effect_unknown',/admitted-unsettled/);
  await check('uncertain external effect remains unknown','Collect wood',true,
    [{status:'EFFECT_UNKNOWN'}],'effect_unknown',/unknown effect/);
  // Real blocked routine reproduction: direct filename, unquoted exact text,
  // and the strategy wrapper that the Windows worker sends to Core.
  fs.writeFileSync(path.join(workspace,'jarvis_routine_probe.txt'),'JARVIS_ROUTINE_PASS');
  const directRoutine = 'Create jarvis_routine_probe.txt inside my authorized workspace, write exactly JARVIS_ROUTINE_PASS, then read it back and verify the contents.';
  await check('natural routine wording independently verifies exact content', directRoutine, true,
    [writeAck('jarvis_routine_probe.txt','JARVIS_ROUTINE_PASS')],'verified',/exact content/);
  const {taskPrompt,makePlan} = await import('../src/lib/agent/longrun/planner.mjs');
  const plan = makePlan(directRoutine);
  await check('background strategy wrapper preserves verifiable file objective',taskPrompt(plan,0,0,directRoutine),true,
    [writeAck('jarvis_routine_probe.txt','JARVIS_ROUTINE_PASS')],'verified',/VERDICT: VERIFIED/);
  fs.writeFileSync(path.join(workspace,'jarvis_routine_probe.txt'),'WRONG_DATA');
  await check('background routine mismatched content stays unverified',taskPrompt(plan,0,0,directRoutine),true,
    [writeAck('jarvis_routine_probe.txt','JARVIS_ROUTINE_PASS')],'partial',/content mismatch/);
  fs.writeFileSync(path.join(workspace,'jarvis_routine_probe.txt'),'JARVIS_ROUTINE_PASS');
  await check('background routine unknown effect cannot verify',taskPrompt(plan,0,0,directRoutine),true,
    [writeAck('jarvis_routine_probe.txt','JARVIS_ROUTINE_PASS'),{status:'EFFECT_UNKNOWN'}],'effect_unknown');
  await check('background routine failed effect cannot verify',taskPrompt(plan,0,0,directRoutine),true,
    [writeAck('jarvis_routine_probe.txt','JARVIS_ROUTINE_PASS'),{status:'FAILED'}],'partial');
  await check('read-only check does not become a create predicate', 'Read jarvis_routine_probe.txt; do not modify it.', true,
    [ack('read_file',{content:'JARVIS_ROUTINE_PASS'})],'partial',/UNVERIFIED OUTCOME/);
  fs.writeFileSync(path.join(workspace,'other.txt'),'JARVIS_ROUTINE_PASS');
  await check('ambiguous multi-file exact write is not verified','Create jarvis_routine_probe.txt and other.txt, write exactly JARVIS_ROUTINE_PASS',true,
    [writeAck('jarvis_routine_probe.txt','JARVIS_ROUTINE_PASS')],'partial',/UNVERIFIED OUTCOME/);
  fs.writeFileSync(path.join(workspace,'sample.txt'),'expected');
  await check('real file content matches completion predicate','Create file sample.txt containing "expected"',true,
    [writeAck('sample.txt','expected')],'verified',/VERDICT: VERIFIED/);
  await check('failed side effect prevents full success despite matching file','Create file sample.txt containing "expected"',true,
    [writeAck('sample.txt','expected'),{status:'FAILED',tool:'create_folder'}],'partial',/VERDICT: PARTIAL/);
  await check('uncertain effect blocks otherwise matching file','Create file sample.txt containing "expected"',true,
    [writeAck('sample.txt','expected'),{status:'EFFECT_UNKNOWN'}],'effect_unknown');
  await check('wrong file content does not become verified','Create file sample.txt containing "different"',true,
    [writeAck('sample.txt','expected')],'partial',/content mismatch/);
  await check('nonexistent artifact fails','Create file absent.txt',true,[],'failed');
  console.log(`CORE_OUTCOME_HONESTY ${checks}/${checks} PASS (isolated/mock DB and actual temporary filesystem)`);
 } finally { fs.rmSync(workspace,{recursive:true,force:true}); }
}
main().catch(err => {console.error(err.stack || err);process.exitCode=1});
