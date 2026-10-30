'use strict';
const assert = require('node:assert/strict');
const {digest,decide,createController,resolveOwnerEntity} = require('./autonomy_engine.cjs');
const {validateCommand} = require('./friend_protocol.cjs');
let checks=0; const ok=(condition,label)=>{assert.ok(condition,label);checks++;};
function pos(x,y,z){return {x,y,z,distanceTo(other){return Math.hypot(x-other.x,y-other.y,z-other.z);}}}
const player={position:pos(3,64,0)};
const bot={username:'JarvisBuddy',entity:{position:pos(0,64,0)},players:{AsLaM0704:{entity:player}},
  entities:{},health:20,food:20,time:{timeOfDay:1000},game:{dimension:'minecraft:overworld'},
  inventory:{items:()=>[]},findBlock:()=>null};
ok(resolveOwnerEntity(bot,'aslam0704')===player,'mixed-case owner resolves');
ok(resolveOwnerEntity(bot,'JARVISBUDDY')===null,'bot cannot follow itself');
ok(resolveOwnerEntity(bot,'stranger')===null,'unlisted player not treated as owner');
const observed=digest(bot,'aslam0704');
ok(observed.ownerVisible===true && observed.ownerDistance===3,'autonomy and manual status share owner perception');
ok(decide('follow',observed).kind==='follow','real follow plan with near owner');
ok(validateCommand({command:'auto_goal',goal:'companion',durationSeconds:21600})===null,'high-level companion allowed');
ok(decide('companion',observed).kind==='collect_wood','companion independently starts survival progression');
ok(decide('companion',{...observed,ownerVisible:false}).kind==='wait','no player => do not wander blindly');
ok(decide('companion',{...observed,ownerDistance:25}).kind==='follow','companion catches up with owner');
const equipped={...observed,ownerDistance:10,inventory:{...observed.inventory,stonePickaxe:1,stoneSword:1,ironPickaxe:1}};
ok(decide('companion',equipped).kind==='follow','equipped companion returns to teammate');
const free={...equipped,ownerDistance:3};
ok(decide('companion',free).kind==='explore','equipped companion scouts nearby independently');
let now=123456789;const ctl=createController({clock:()=>now,maxSeconds:43200,maxSteps:10000});
ctl.start('companion',21600);
let action=ctl.next(observed);
ok(action.kind==='collect_wood' && ctl.status().status==='running','companion continues until stopped');
ctl.record(action,{ok:true,verified:true,detail:'actual inventory delta'});
ok(ctl.status().successes===1,'verified actions are tracked');
ctl.stop('Owner stop');ok(ctl.status().status==='paused' && ctl.next(observed).kind==='idle','owner stop actually halts decisions');
ctl.start('netherite_dragon_run',21600);
ok(ctl.next(observed).kind==='collect_wood','dragon attempt starts from observed empty inventory');
ok(ctl.status().status==='running' && !ctl.status().milestones.dragonKilled,'no fake dragon victory from a STARTED receipt');
console.log(`ONE_WORD_MINECRAFT_MISSIONS ${checks}/${checks} PASS (offline; not live game)`);
