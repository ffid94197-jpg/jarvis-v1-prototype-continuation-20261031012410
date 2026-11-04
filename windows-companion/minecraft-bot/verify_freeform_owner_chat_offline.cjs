/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
// Offline deterministic test of the native JARVIS Minecraft owner chat router.
// No real game, model, network, or GitHub Actions minutes. Does NOT prove live gameplay.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {directIntent}=require('./language_goal.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const {normalizeResource}=require('./resource_goal.cjs');
let checks=0;
function check(ok,label){assert.ok(ok,label);checks++;console.log('PASS',label);}

const natural=[
 ['Can you mine six diamonds?','gather',6],
 ['please make two chests','craft',2],
 ['hey Jarvis, craft a chest','craft',1],
 ['Defeat the Ender Dragon','dragon_run'],
 ['Get full netherite armor and beat the Ender Dragon','netherite_dragon_run'],
 ['Beat the Ender Dragon then obtain full netherite gear','dragon_then_netherite_run'],
 ['Explore the cave','explore'],
 ['Mine 64 diamonds','gather',64],
 ['Craft sixteen chests','craft',16],
 ['Gather 2 cobblestone','gather',2]
];
for(const [phrase,goal,quantity] of natural){
 const result=directIntent(phrase);
 check(result?.ok===true && result.command?.goal===goal &&
   (quantity===undefined || result.command.targetCount===quantity) &&
   validateCommand(result.command)===null,'natural owner instruction: '+phrase);
}
for(const phrase of [
 "Don't gather diamonds",'How do I defeat the Dragon?',
 'Get full Netherite armor','Craft seventeen chests','Mine 65 diamonds'
]){
 const r=directIntent(phrase);
 check(!r?.ok,'ambiguous, negative, or out-of-range instruction has no direct action: '+phrase);
}

const source=fs.readFileSync(path.join(__dirname,'bot.cjs'),'utf8');
const from=source.indexOf('const CHAT_KEYWORDS=');
const until=source.indexOf('const reader=readline.createInterface',from);
check(from>=0 && until>from,'chat routing excerpt available');
const snippet=source.slice(from,until);
const calls=[],responses=[];
let chatHandler;
const bot={on(event,fn){if(event==='chat')chatHandler=fn;}};
vm.runInNewContext(snippet,{
 bot,leader:'Owner',spawned:true,
 say:message=>responses.push(message),
 action:payload=>{calls.push(payload);return Promise.resolve({ok:true,status:'STARTED; not verified'});},
 normalizeResource,validateCommand,Promise
},{timeout:1000});
check(typeof chatHandler==='function','native owner chat handler registered');
const chats=[
 ['jarvis craft me two chests','natural_goal','craft me two chests'],
 ['jarvis gather six diamonds','natural_goal','gather six diamonds'],
 ['jarvis goal defeat the ender dragon','natural_goal','defeat the ender dragon'],
 ['jarvis auto beat the ender dragon','natural_goal','beat the ender dragon'],
 ['jarvis craft 2 chests','natural_goal','craft 2 chests'],
 ['jarvis craft 2 chest','auto_goal'],
 ['jarvis gather 6 diamonds','auto_goal'],
 ['jarvis follow the dragon','natural_goal','follow the dragon'],
 ['jarvis follow','follow'],
 ['jarvis resume previous mission','natural_goal','resume previous mission'],
 ['jarvis gather 65 diamonds','natural_goal','gather 65 diamonds'],
 ['jarvis build a castle','natural_goal','build a castle'],
 ['jarvis farm wheat near my house','natural_goal','farm wheat near my house'],
 ['jarvis travel 999999999999 64 0','natural_goal','travel 999999999999 64 0']
];
for(const [message,command,text] of chats){
 const prior=calls.length;
 chatHandler('Owner',message);
 const action=calls[prior];
 check(calls.length===prior+1 && action.command===command &&
  (text===undefined||action.text===text),
  'chat dispatched the right typed or natural instruction: '+message);
}
let prior=calls.length;
chatHandler('OtherPlayer','jarvis beat the ender dragon');
check(calls.length===prior,'untrusted player cannot issue owner chat commands');
prior=calls.length;
chatHandler('Owner','How do I defeat the ender dragon?');
check(calls.length===prior,'non-wake chat never triggers player effects');
console.log('MINECRAFT_FREEFORM_OWNER_CHAT '+checks+'/'+checks+
 ' PASS (offline parser/dispatcher; real Minecraft victory NOT tested)');
