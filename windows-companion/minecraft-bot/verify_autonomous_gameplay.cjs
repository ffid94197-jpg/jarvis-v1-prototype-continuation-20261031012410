/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
const assert=require('node:assert/strict');
const {GOALS,decide,digest,createController}=require('./autonomy_engine.cjs');
const {validateCommand}=require('./friend_protocol.cjs');
let passed=0;function ok(cond,label){assert.ok(cond,label);passed++;}
let seed=432109;function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
function world(overrides={}){return {joined:true,health:20,hunger:20,ownerVisible:true,ownerDistance:4,threats:[],workbenchNearby:false,
 inventory:{logs:0,planks:0,sticks:0,table:0,woodenPickaxe:0,food:0,raw:{}},...overrides};}
function inv(overrides={}){return {...world().inventory,...overrides};}
const parameterized={
 gather:{resource:'logs',targetCount:3},
 travel:{destination:{x:3,y:64,z:7},arrivalRange:2},
 build:{position:{x:3,y:64,z:7},length:2,axis:'x+',block:'cobblestone'},
 farm_wheat:{position:{x:3,y:64,z:7},width:2,depth:2,targetCount:4},
 sequence:{steps:[{goal:'stone_age'}]},
 craft:{item:'chest',targetCount:2},
 equip:{item:'iron_helmet',destinationSlot:'head'}
};
for(const goal of GOALS)
 ok(validateCommand({command:'auto_goal',goal,...(parameterized[goal]||{}),durationSeconds:300})===null,
 'valid typed goal '+goal);
for(const command of [{command:'auto_goal',goal:'mine_everything'}, {command:'auto_goal',goal:'survive',durationSeconds:100000},
 {command:'auto_goal',goal:'wood',durationSeconds:0},{command:'auto_goal',goal:'wood',durationSeconds:'20'},
 {command:'auto_goal',goal:'survive',durationSeconds:10.2}])ok(!!validateCommand(command),'denied malformed goal');
ok(validateCommand({command:'observe'})===null,'observation is read-only');
ok(validateCommand({command:'auto_status'})===null,'progress observation');
ok(validateCommand({command:'auto_stop'})===null,'stop allowed');
ok(decide('wood',world({inventory:inv({logs:4})})).kind==='complete','wood ends by inventory proof');
ok(decide('wood',world({inventory:inv({logs:2})})).kind==='collect_wood','wood needs pickup');
ok(decide('tools',world({inventory:inv({logs:3,planks:0})})).kind==='craft_planks','can craft planks');
ok(decide('tools',world({inventory:inv({planks:9})})).kind==='craft_sticks','sticks before table');
ok(decide('tools',world({inventory:inv({planks:7,sticks:4})})).kind==='craft_table','workbench after sticks');
ok(decide('tools',world({inventory:inv({table:1,planks:3,sticks:2})})).kind==='place_table','table placement');
ok(decide('tools',world({inventory:inv({table:0,planks:3,sticks:2}),workbenchNearby:true})).kind==='craft_pickaxe','already placed table honored');
ok(decide('tools',world({inventory:inv({woodenPickaxe:1})})).kind==='complete','pickaxe inventory proof');
ok(decide('survive',world({ownerVisible:false,inventory:inv({planks:4})})).kind==='collect_wood',
  'Independent survival continues with safe tool prerequisites even when owner is absent');
ok(decide('guard',world({threats:[{name:'creeper',distance:3}],health:16})).kind==='retreat','creeper retreat');
ok(decide('guard',world({threats:[{name:'zombie',distance:3,id:1}],health:18})).kind==='defend','defend hostile');
ok(decide('guard',world({threats:[{name:'zombie',distance:3,id:1}],health:6})).kind==='retreat','critical health retreat');
ok(decide('survive',world({hunger:9,inventory:inv({food:2})})).kind==='eat','hunger priority');
ok(decide('explore',world({ownerVisible:false})).kind==='wait','no blind exploration');
ok(decide('explore',world({ownerDistance:28})).kind==='follow','owner proximity guard');
const fakeBot={entity:{position:{x:0,y:64,z:0,distanceTo:p=>Math.hypot(p.x,p.z)}},
 players:{Owner:{entity:{position:{x:4,y:64,z:3}}}},health:17,food:18,
 entities:{a:{id:10,name:'zombie',position:{x:2,y:64,z:0,distanceTo:p=>Math.hypot(2-p.x,p.z)}}},
 inventory:{items:()=>[{name:'oak_log',count:2},{name:'bread',count:1}]},findBlock:()=>null};
let sample=digest(fakeBot,'Owner');ok(sample.inventory.logs===2,'real inventory items observed');
ok(sample.ownerDistance===5,'real owner distance observed');ok(sample.threats[0]?.name==='zombie','hostiles observed');
ok(sample.inventory.food===1,'edible inventory observed');
let now=100000;const c=createController({clock:()=>now,maxSteps:4,maxSeconds:100});c.start('wood',10);
ok(c.next(world({inventory:inv({logs:4})})).kind==='complete','verified goal completion');
ok(c.status().status==='complete','completion durable state');
c.start('wood',10);for(let i=0;i<3;i++){const d=c.next(world());c.record(d,{verified:false,detail:'no log pickup'});}
ok(c.status().status==='running' && c.status().lastDecision?.kind==='survey_wood',
  'Repeated wood failures switch to bounded survey instead of claiming success');
// Bound continuation by the ORIGINAL 12-hour owner authorization, not
// an infinite series of newly fabricated 6-hour leases.
let missionClock=1000000;
const long=createController({clock:()=>missionClock,maxSeconds:43200,maxSteps:120});
long.start('dragon_then_netherite_run',21600);
missionClock+=21600*1000;
ok(long.next(world()).kind==='idle'&&long.status().status==='expired',
 'Initial long mission expires at its requested window');
ok(long.renewMission(21600),'One bounded six-hour mission continuation permitted');
ok(long.status().deadline===1000000+43200*1000,
 'Second window cannot exceed original 12-hour authority boundary');
missionClock+=21600*1000;
ok(long.next(world()).kind==='idle'&&long.status().status==='expired',
 'Long mission expires at absolute 12-hour limit');
ok(!long.renewMission(21600),'Renewal denied after owner authority has expired');
const paused=createController({clock:()=>missionClock,maxSeconds:43200});
paused.start('dragon_run',300);paused.stop('Owner stop');
ok(!paused.renewMission(21600),'Explicit owner stop cannot be renewed');
c.start('follow',10);ok(c.next(world()).kind==='follow','follow chosen');now+=11000;ok(c.next(world()).kind==='idle','deadline stops bot');
ok(c.status().status==='expired','expiry recorded');c.start('explore',10);c.stop();ok(c.next(world()).kind==='idle','manual pause prevents action');
for(let i=0;i<60000;i++){
  const type=['survive','wood','tools','explore','follow','guard'][Math.floor(random()*6)];
  const w=world({health:Math.floor(random()*21),hunger:Math.floor(random()*21),ownerVisible:random()>.18,
    ownerDistance:Math.floor(random()*35),workbenchNearby:random()<.3,
    threats:random()<.3?[{name:random()<.2?'creeper':'zombie',distance:1+Math.floor(random()*15),id:123}]:[],
    inventory:inv({logs:Math.floor(random()*5),planks:Math.floor(random()*8),sticks:Math.floor(random()*5),
      table:Math.floor(random()*2),woodenPickaxe:Math.floor(random()*2),food:Math.floor(random()*4)})});
  const action=decide(type,w,{},{});
  ok(typeof action.kind==='string' && typeof action.why==='string','scenario '+i+' produced typed plan');
  ok(!['attack_player','mine_anything','run_command'].includes(action.kind),'scenario '+i+' never unsafe tool');
  if(w.health<=8 && w.threats[0]?.distance<=10)ok(action.kind==='retreat','scenario '+i+' low health retreat');
  else if(w.hunger<=12 && w.inventory.food>0)ok(action.kind==='eat','scenario '+i+' hungry with food');
  if(type==='explore' && !w.ownerVisible && !(w.health<=8&&w.threats[0]?.distance<=10) && !(w.hunger<=12&&w.inventory.food>0) && !(w.threats[0]?.name==='creeper'&&w.threats[0]?.distance<=7))
    ok(action.kind==='wait','scenario '+i+' cannot explore without owner');
}
console.log(`MINECRAFT_AUTONOMY_STRESS ${passed}/${passed} PASS 60,000 diverse world states (pure engine; not live server)`);
