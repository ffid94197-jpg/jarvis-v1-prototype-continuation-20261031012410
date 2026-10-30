'use strict';
const assert=require('node:assert/strict');
const {findExposedOre}=require('./ore_access.cjs');
const {createController}=require('./autonomy_engine.cjs');
const ore={name:'deepslate_diamond_ore',position:{x:0,y:-54,z:0}};
function world(extra={}){
 const bot={findBlocks:()=>[ore.position],blockAt:p=>{
   const key=`${p.x},${p.y},${p.z}`;
   if(key==='0,-54,0')return ore;
   if(extra[key])return extra[key];
   if(key==='1,-54,0'||key==='1,-53,0')return {name:'air',boundingBox:'empty'};
   return {name:'deepslate',boundingBox:'block'};
 }};
 return bot;
}
const exposed=findExposedOre(world(),['deepslate_diamond_ore']);
assert.equal(exposed?.block,ore);
assert.deepEqual(exposed.stance,{x:1,y:-54,z:0});
const danger=world({'2,-54,0':{name:'lava',boundingBox:'empty'}});
assert.equal(findExposedOre(danger,['deepslate_diamond_ore']),null,'Lava-adjacent mining stance rejected');
const buried=world({'1,-54,0':{name:'deepslate',boundingBox:'block'}});
assert.equal(findExposedOre(buried,['deepslate_diamond_ore']),null,'Buried ore not described as accessible');
const caveFloor=world({
 '1,-54,0':{name:'deepslate',boundingBox:'block'},
 '0,-53,0':{name:'air',boundingBox:'empty'},
 '1,-53,0':{name:'air',boundingBox:'empty'},
 '1,-52,0':{name:'air',boundingBox:'empty'}
});
assert.deepEqual(findExposedOre(caveFloor,['deepslate_diamond_ore'])?.stance,
 {x:1,y:-53,z:0},'Cave floor ore safely accessed from adjacent elevated stance');
const controller=createController({maxSeconds:43200});
controller.start('netherite_dragon_run',21600);
for(let j=0;j<6;j++)controller.record({kind:'survey_ore',ore:'diamond'},
 {ok:false,verified:false,detail:'No safe loaded corridor'});
assert.equal(controller.status().status,'running','Recoverable survey failure must not end full mission');
assert.equal(controller.status().failures.survey_ore,6);
console.log('MINING_RECOVERY 7/7 PASS (offline candidate selection; no Minecraft server)');
