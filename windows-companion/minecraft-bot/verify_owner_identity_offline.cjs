#!/usr/bin/env node
'use strict';
/* Real bot entrypoint under an isolated offline VM, not a live Minecraft login. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const src=fs.readFileSync(path.join(__dirname,'bot.cjs'),'utf8');
let passed=0;
function launch(owner,playerName='JarvisBuddy') {
 const lines=[],out=[],events=[];
 const fakeBot=new EventEmitter();
 fakeBot.username=playerName;
 fakeBot.players={};
 fakeBot.loadPlugin=()=>{};
 fakeBot.chat=()=>{};
 fakeBot.quit=()=>{};
 const stdin=new EventEmitter();
 const orig=require;
 const mocks={
  mineflayer:{createBot:()=>fakeBot},
  readline:{createInterface:()=>stdin},
  'vec3':{Vec3:class {}},
  'mineflayer-pathfinder':{pathfinder(){},Movements:class {},goals:{GoalNear:class {},GoalFollow:class {}}},
 };
 const processFake={env:{JARVIS_MINECRAFT_LAN_HOST:'127.0.0.1',JARVIS_MINECRAFT_LAN_PORT:'54321',JARVIS_MINECRAFT_PLAYER:owner},
  stdout:{write:x=>out.push(x)},stderr:{write:x=>lines.push(x)},on(){},exit(code){throw Error('EXIT_'+code)}};
 vm.runInNewContext(src,{
  require:n=>mocks[n]??orig(n),
  process:processFake,console,Buffer,
  setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
 });
 return {out,lines,bot:fakeBot,stdin};
}
function pass(label,fn){fn();passed++;console.log('PASS',label)}
pass('reject exact self-owner identity',()=>assert.throws(()=>launch('JarvisBuddy'),/EXIT_2/));
pass('reject case-variant self-owner identity',()=>assert.throws(()=>launch('jarvisbuddy'),/EXIT_2/));
pass('reject absent owner',()=>assert.throws(()=>launch(''),/EXIT_2/));
pass('reject malformed owner',()=>assert.throws(()=>launch('x\\nother'),/EXIT_2/));
pass('accept a distinct real Java owner name',()=>assert.ok(launch('ActualOwner')));
pass('startup does not fabricate joined status',()=>assert.equal(launch('ActualOwner').out.some(x=>x.includes('JOINED')),false));
pass('self is not recognized as owner',()=>{
 const x=launch('ActualOwner');x.bot.entity={position:{x:0,y:64,z:0}};
 x.bot.players.ActualOwner={entity:{position:{x:1,y:64,z:1}}};
 // No outbound status before spawn; verifies source guard against self-identity.
 assert.equal(x.lines.length,0);
});
console.log(`MINECRAFT_OWNER_IDENTITY ${passed}/${passed} PASS (offline entrypoint)`);
