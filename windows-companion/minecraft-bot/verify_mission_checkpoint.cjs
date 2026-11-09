#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createCheckpoint,makeLease,validateLease}=require('./mission_checkpoint.cjs');
const {createController}=require('./autonomy_engine.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-mc-checkpoint-'));
const file=path.join(dir,'mission.json');
const identity={host:'127.0.0.1',port:25565,owner:'MinecraftOwner'};
const clock=()=>1000000;
let count=0;
function ok(v,label){assert.ok(v,label);count++;}
try{
 const c=createCheckpoint(file,identity,{clock});
 const controller=createController({clock,maxSeconds:43200,maxSteps:100});
 controller.start('sequence',3600,{steps:[
  {goal:'build',block:'cobblestone',position:{x:3,y:65,z:7},axis:'z+',length:2},
  {goal:'travel',destination:{x:40,y:64,z:-5},arrivalRange:2}
 ]});
 const cropController=createController({clock,maxSeconds:43200,maxSteps:40});
 cropController.start('farm_crop',2400,{crop:'beetroot',
   position:{x:4,y:65,z:8},width:2,depth:1,targetCount:3});
 ok(c.save(cropController.status())&&c.load().ok&&
   c.load().spec.crop==='beetroot'&&c.load().spec.position.x===4,
   'Owner-approved crop intent can survive a disconnect without claiming harvest');
 const recoveredCrop=createController({clock,maxSeconds:43200,maxSteps:40});
 recoveredCrop.start('farm_crop',c.load().remainingSeconds,c.load().spec);
 ok(recoveredCrop.status().status==='running' &&
    Object.keys(recoveredCrop.status().milestones).length===0,
   'Crop recovery starts without stale harvesting, planting or inventory receipts');
 const forged=makeLease(cropController.status(),identity,clock());
 ok(!validateLease({...forged,spec:{...forged.spec,crop:'lava'}},identity,clock()).ok,
   'Unknown crop in persisted lease cannot gain authority');
 ok(!validateLease({...forged,spec:{...forged.spec,unsafeScript:'x'}},identity,clock()).ok,
   'Persisted crop lease forbids extra executable-shaped metadata');
 const buildController=createController({clock,maxSeconds:43200,maxSteps:40});
 buildController.start('build',1200,{block:'cobblestone',length:2,axis:'z+',
   position:{x:3,y:65,z:7}});
 ok(c.save(buildController.status())&&c.load().spec.block==='cobblestone' &&
   c.load().spec.position.z===7,
   'Owner-authorized construction intent can be restored without prior block proof');
 const active=controller.status();
 ok(c.save(active),'Authorized running sequence is stored');
 const saved=c.load();
 ok(saved.ok&&saved.remainingSeconds===3600,'Lease retains bounded original deadline');
 ok(saved.spec.steps.length===2&&saved.spec.steps[0].block==='cobblestone','Restart-safe stage specification survives');
 saved.spec.steps[0].block='tnt';
 ok(c.load().spec.steps[0].block==='cobblestone','Caller cannot mutate stored sequence');
 const fresh=createController({clock,maxSeconds:43200});
 fresh.start(c.load().spec.goal,c.load().remainingSeconds,c.load().spec);
 ok(fresh.status().sequenceIndex===0&&Object.keys(fresh.status().milestones).length===0,
   'Restart-safe sequence starts with no previously completed stage proof');
 const unsafe=createController({clock,maxSeconds:43200,maxSteps:40});
 unsafe.start('sequence',1200,{steps:[
  {goal:'gather',resource:'logs',targetCount:8},
  {goal:'travel',destination:{x:40,y:64,z:-5},arrivalRange:2}
 ]});
 ok(!c.save(unsafe.status())&&!c.load().ok,
   'Non-idempotent gathering stage prevents a sequence restart and clears stale lease');
 ok(c.save(active)&&c.load().ok,
   'An owner-approved safe sequence can be saved again after rejected replay');
 ok(!createCheckpoint(file,{...identity,port:25566},{clock}).load().ok,
   'Different server port is rejected');
 ok(!createCheckpoint(file,{...identity,owner:'Stranger'},{clock}).load().ok,
   'Different owner is rejected');
 const valid=makeLease(active,identity,clock());
 ok(!validateLease({...valid,deadline:clock()+43200001},identity,clock()).ok,
   'Unbounded duration is rejected');
 fs.writeFileSync(file,JSON.stringify({...valid,spec:{goal:'sequence',steps:[{goal:'eval',code:'evil'}]}}));
 ok(!c.load().ok,'Unsupported code-shaped sequence cannot be restored');
 ok(c.save(active),'Atomic overwrite repairs invalid file without trusting contents');
 ok(c.clear()&&!c.load().ok,'Owner stop removes checkpoint');
 ok(c.save(active)&&!createCheckpoint(file,identity,{clock:()=>clock()+4000000}).load().ok,
   'An expired lease cannot be replayed');
 controller.stop('Owner stop');
 ok(!c.save(controller.status()),'Stopped missions cannot be re-saved');
 ok(makeLease({...active,deadline:clock()+9000},identity,clock())===null,
   'Near-expired lease never silently becomes new authorization');
 console.log('MINECRAFT_MISSION_CHECKPOINT '+count+'/'+count+' PASS (offline only; not Java)');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
