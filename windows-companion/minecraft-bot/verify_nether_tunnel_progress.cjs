'use strict';
const assert=require('node:assert/strict');
const {createLateSkills}=require('./late_skills.cjs');
class Vec3 {
  constructor(x,y,z){this.x=x;this.y=y;this.z=z;}
  offset(x,y,z){return new Vec3(this.x+x,this.y+y,this.z+z);}
  clone(){return new Vec3(this.x,this.y,this.z);}
  distanceTo(other){return Math.hypot(this.x-other.x,this.y-other.y,this.z-other.z);}
}
function mockGame(moves){
  const excavated=new Set();
  const key=p=>[Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)].join(':');
  const pos=new Vec3(.5,16,.5);
  const bot={entity:{position:pos},game:{dimension:'minecraft:the_nether'},
    inventory:{items:()=>[{name:'diamond_pickaxe',count:1}]},
    blockAt(p){const name=p.y>16||excavated.has(key(p))?'air':'netherrack';
      return {name,boundingBox:name==='air'?'empty':'block',position:new Vec3(p.x,p.y,p.z)};},
    canDigBlock:()=>true,
    async dig(block){excavated.add(key(block.position));},
    async equip(){},async lookAt(){},
    setControlState(key,enabled){if(key==='forward' && enabled && moves)this.entity.position.x+=1;},
    findBlock:()=>null,
  };
  const api=createLateSkills({bot,navigate:async()=>{},craftNamed:async()=>{},getEpoch:()=>1,getOwner:()=>'',digest:()=>({inventory:{raw:{}}}),Vec3});
  return {api,bot};
}
(async()=>{
 const stalled=mockGame(false);
 const no=await stalled.api.run({kind:'mine_ancient_debris'},1);
 assert.equal(no.verified,false,'Dig without actual forward movement cannot be certified');
 assert.match(no.detail,/movement was not verified/);
 const moving=mockGame(true);
 const yes=await moving.api.run({kind:'mine_ancient_debris'},1);
 assert.equal(yes.verified,true,'Server-modeled block changes AND position progress count');
 assert.ok(moving.bot.entity.position.x>=1.5);
 console.log('NETHER_TUNNEL_PROGRESS 4/4 PASS (mock movement, not server gameplay)');
})().catch(err=>{console.error(err);process.exitCode=1;});
