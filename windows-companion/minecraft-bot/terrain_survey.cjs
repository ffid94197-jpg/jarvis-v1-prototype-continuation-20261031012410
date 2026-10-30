'use strict';
/** Conservative, finite cave-mining step selector for visible loaded blocks.
 * This selects an excavation step; it does NOT mine, navigate, or claim ore.
 * Safeguards prevent opening known liquids or tunneling into protected blocks.
 */
const MINEABLE=new Set([
  'stone','deepslate','tuff','calcite','granite','diorite','andesite',
  'dirt','coarse_dirt','rooted_dirt','gravel','clay','cobblestone',
  'mossy_cobblestone','dripstone_block','pointed_dripstone',
  'iron_ore','deepslate_iron_ore','diamond_ore','deepslate_diamond_ore'
]);
const AIR=new Set(['air','cave_air','void_air']);
const LIQUID=new Set(['lava','water','flowing_lava','flowing_water']);
const directions=[[1,0],[0,1],[-1,0],[0,-1]];
function planSurveyStep({position,ore,index=0,getBlock}) {
  if(!['iron','diamond'].includes(ore) || !position || typeof getBlock!=='function')
    return {ok:false,reason:'Invalid ore survey input'};
  const x=Math.floor(position.x),y=Math.floor(position.y),z=Math.floor(position.z);
  const targetY=ore==='diamond'?-54:16;
  // Rotate the preferred direction, but try the other cardinal corridors
  // before failing. A single blocked tunnel must not stall the whole mission.
  const down=y>targetY;
  const preferred=Math.floor(Math.max(0,index)/5)%4;
  const block=(p)=>getBlock(p.x,p.y,p.z);
  const rejects=[];
  for(let attempt=0;attempt<4;attempt++){
    const [dx,dz]=directions[(preferred+attempt)%4];
    const target={x:x+dx,y:y-(down?1:0),z:z+dz};
    const floor=block({x:target.x,y:target.y-1,z:target.z});
    if(!floor || floor.boundingBox==='empty' || LIQUID.has(floor.name) || AIR.has(floor.name)){
      rejects.push('unsafe floor');continue;
    }
    const feet=block(target),head=block({x:target.x,y:target.y+1,z:target.z});
    if(!feet || !head){rejects.push('unloaded corridor');continue;}
    const surrounding=[[-1,0,0],[1,0,0],[0,0,-1],[0,0,1],[0,2,0]];
    if(surrounding.some(([sx,sy,sz])=>{
      const adjacent=block({x:target.x+sx,y:target.y+sy,z:target.z+sz});
      return !adjacent || LIQUID.has(adjacent.name);
    })){rejects.push('unsafe neighbor');continue;}
    const dig=[];let forbidden=false;
    for(const b of [feet,head]){
      if(AIR.has(b.name))continue;
      if(!MINEABLE.has(b.name)){forbidden=true;break;}
      dig.push(b);
    }
    if(forbidden){rejects.push('protected block');continue;}
    return {ok:true,target,dig,down,attemptedDirections:attempt+1,
      why:'Survey actual '+ore+' terrain at Y '+target.y};
  }
  return {ok:false,reason:'All 4 bounded survey directions unsafe: '+[...new Set(rejects)].join(', ')};
}
module.exports={planSurveyStep,MINEABLE};
