#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const p=path.join(__dirname,'../src/lib/agent/core/autonomyGate.ts');
const js=ts.transpileModule(fs.readFileSync(p,'utf8'),{
 fileName:p,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText;
const m={exports:{}};
new Function('module','exports',js)(m,m.exports);
const check=m.exports.desktopObjectiveRequiresActions;
let n=0;
for(const [task,expected] of [
 ['Defeat the Ender Dragon',true],
 ['Start the netherite_dragon_run in Minecraft',true],
 ['Collect wood in Minecraft',true],
 ['Go to the stronghold and enter End portal',true],
 ['Craft full netherite armor',true],
 ['Get full netherite armor',true],
 ['Kill the dragon',true],
 ['Locate the Minecraft stronghold',true],
 ['Please gather logs',true],
 ['Open Windows Settings',true],
 ['Launch File Explorer on my PC',true],
 ['How do I defeat the Ender Dragon?',false],
 ['Explain how to craft diamond armor in Minecraft',false],
 ['Tell me about the Nether',false],
 ['Hi',false],
 ['Explain TypeScript promises',false],
 ]){
 assert.equal(check(task),expected,task);
 n++;
 console.log('PASS',task,'=>',expected?'requires real actions':'conversational');
}
const loop=fs.readFileSync(path.join(__dirname,'../src/lib/agent/core/loop.ts'),'utf8');
// The loop's gate is now a disjunction:
//   if (desktopObjectiveRequiresActions(objective) || requiresExternalActionEvidence(objective)) {
// Matching the historical closed form `...(objective))` rejected the stricter
// source. Assert the guard exists AND that both disjuncts are enforced.
assert.match(loop,/if \(desktopObjectiveRequiresActions\(objective\)/);
n++;
console.log('PASS agent loop enforces action gate before conversational completion');
assert.match(loop,/desktopObjectiveRequiresActions\(objective\)\s*\|\|\s*requiresExternalActionEvidence\(objective\)/);
n++;
console.log('PASS action gate is widened by requiresExternalActionEvidence (no weaker than before)');
assert.match(loop,/requiresExternalActionEvidence\(objective\)\s*&&\s*arbitration\.verdict === "conversational"/);
n++;
console.log('PASS grounded verdict still overrides a conversational arbitration for actionable objectives');
console.log(`CORE_GAME_ACTION_GATE ${n}/${n} PASS (offline source policy)`);
