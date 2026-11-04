'use strict';
// Regression: a restart lease must contain only valid owner-goal data,
// never fabricated progress, game state or previous victory evidence.
const assert=require('node:assert/strict');
const {extractGoal,makeLease,validateLease}=require('./mission_checkpoint.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
const {createController}=require('./autonomy_engine.cjs');
const now=1730700000000;
const identity={host:'localhost',port:25565,owner:'real-owner'};
let checks=0;
const pass=(condition,message)=>{assert.ok(condition,message);checks++;console.log('PASS '+message)};
const controller=createController({clock:()=>now,maxSeconds:43200,maxSteps:20000});
const spec={position:{x:1,y:64,z:2},block:'cobblestone',
 width:3,depth:3,height:2,shape:'walls'};
const started=controller.start('build_volume',3600,spec);
pass(started.status==='running'&&started.goal==='build_volume',
 'original finite build is a valid live-owner autonomous mission');
const extracted=extractGoal(started);
pass(extracted.goal==='build_volume'&&extracted.shape==='walls'&&
 extracted.height===2&&extracted.width===3&&extracted.depth===3,
 'restart extraction retains every bounded multi-layer structure parameter');
pass(Object.keys(extracted).sort().join(',')===
 ['block','depth','goal','height','position','shape','width'].sort().join(','),
 'only owner-authorized build parameters appear in recovery intent');
pass(validateCommand({command:'auto_goal',...extracted})===null,
 'extracted checkpoint revalidates through the normal Guardian entrypoint');
const lease=makeLease(started,identity,now);
pass(lease?.spec?.goal==='build_volume'&&lease.spec.height===2,
 'valid lease preserves bounded 3D build for owner-authorized restart');
const recovered=validateLease(lease,identity,now+1000);
pass(recovered.ok&&recovered.spec.goal==='build_volume'&&
 recovered.remainingSeconds>=3598&&recovered.remainingSeconds<=3599,
 'same connection and owner can recover only unexpired goal intent');
const resumed=createController({clock:()=>now+1000,maxSeconds:43200});
const reopened=resumed.start(recovered.spec.goal,recovered.remainingSeconds,
 recovered.spec);
pass(reopened.status==='running'&&reopened.steps===0&&
 Object.keys(reopened.failures).length===0 &&
 !Object.hasOwn(reopened.milestones,'dragonKilled'),
 'restart resets progress, failures and dragon-victory evidence');
pass(!validateLease(lease,{...identity,owner:'impostor'},now+1000).ok,
 'wrong owner cannot restore recorded mission');
pass(!validateLease(lease,identity,now+3600000).ok,
 'expired owner authorization cannot be revived');
const tampered={...lease,spec:{...lease.spec,height:4}};
pass(!validateLease(tampered,identity,now+1000).ok,
 'out-of-bounds height is rejected before restart');
const injected={...lease,spec:{...lease.spec,script:'op @p'}};
pass(!validateLease(injected,identity,now+1000).ok,
 'checkpoint may not contain a new unapproved executable field');
const forged={...lease,dragonKilled:true};
pass(validateLease(forged,identity,now+1000).ok &&
 !Object.hasOwn(validateLease(forged,identity,now+1000).spec,'dragonKilled'),
 'outside progress fields cannot resurrect a victory or action');
const nonBuild=controller.start('craft',3600,{item:'chest',targetCount:1});
pass(extractGoal(nonBuild).goal==='craft',
 'existing crafting checkpoint behavior remains intact');
const invalid={...started,shape:'secret',status:'running'};
pass(extractGoal(invalid)===null,
 'invalid checkpoint construction shape denied at source');
console.log('MINECRAFT_DURABLE_STRUCTURE '+checks+'/'+checks+
 ' PASS (source-level restart lease; not live Windows or Minecraft Java)');
