'use strict';
/** Owner-scoped one-shot container logistics.
 * No automatic stale mutation replay, third-party chest discovery, script,
 * item-name guessing or inferred ownership. The shared native transaction
 * verifies BOTH live player and container slot changes before settlement.
 */
const CONTAINERS=new Set(['chest','trapped_chest','barrel']);
const pos=p=>p&&typeof p==='object'&&!Array.isArray(p)&&
 Object.keys(p).length===3&&['x','y','z'].every(k=>
 Number.isInteger(p[k])&&Math.abs(p[k])<=30000000);
const exact=(s,keys)=>!!s&&typeof s==='object'&&!Array.isArray(s)&&
 Object.keys(s).every(k=>keys.includes(k));
function validTransferSpec(s){
 return exact(s,['goal','position','item','targetCount','operation'])&&
 s.goal==='transfer'&&pos(s.position)&&
 typeof s.item==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(s.item)&&
 Number.isInteger(s.targetCount)&&s.targetCount>=1&&s.targetCount<=64&&
 ['deposit','withdraw'].includes(s.operation);
}
function transferPlan(world,progress){
 const spec={goal:'transfer',position:progress?.position,item:progress?.item,
   targetCount:progress?.targetCount,operation:progress?.operation};
 if(!validTransferSpec(spec))
  return {kind:'blocked',why:'Container transfer parameters are not owner-validated'};
 if(progress?.milestones?.transferDone===true)
  return {kind:'complete',why:'Current task has a dual-inventory container transfer receipt'};
 const observed=world?.transferBlock;
 if(!observed||!CONTAINERS.has(observed.name)||
    !['x','y','z'].every(k=>observed.position?.[k]===spec.position[k]))
  return {kind:'blocked',why:'Owner-named container is not actually observed and loaded'};
 const here=world?.position;
 if(!here||!['x','y','z'].every(k=>Number.isFinite(here[k])))
  return {kind:'blocked',why:'No measured player position for container route'};
 const dist=Math.hypot(here.x-spec.position.x,here.y-spec.position.y,
   here.z-spec.position.z);
 if(dist>16)return {kind:'blocked',
   why:'Container more than sixteen blocks from current observed player; no blind travel'};
 if(dist>4)return {kind:'approach_container',position:spec.position,
   why:'Reach the exact owner-named, loaded container before a transactional transfer'};
 if(spec.operation==='deposit' &&
    (world?.inventory?.raw?.[spec.item]||0)<spec.targetCount)
  return {kind:'blocked',why:'Not enough real player inventory to deposit requested amount'};
 // Withdrawals are NEVER assumed to exist from item names or random chests.
 // The native container's actual observed slots decide whether they exist.
 return {kind:'transfer_inventory',position:spec.position,item:spec.item,
   count:spec.targetCount,operation:spec.operation,
   why:'One bounded dual-inventory transaction against explicit owner target'};
}
module.exports={CONTAINERS,validTransferSpec,transferPlan};
