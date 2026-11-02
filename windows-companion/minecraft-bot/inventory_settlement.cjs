'use strict';
/**
 * A successful recipe dispatch is not verified crafting.
 * Mineflayer may resolve craft() before the inventory update packet arrives.
 * Require a subsequent increase in server-observed inventory; bounded and
 * owner-cancellable. Reuse for tools, workstations and higher-tier items.
 */
async function waitForInventoryIncrease({before,read,check,wait,deadline,now=Date.now}){
 if(!Number.isFinite(before)||typeof read!=='function'||
   typeof check!=='function'||typeof wait!=='function'||
   !Number.isFinite(deadline))throw Error('Missing valid crafting settlement inputs');
 let after=read();
 while(now()<deadline && after<=before){
   check();
   await wait(Math.min(175,Math.max(1,deadline-now())));
   check();
   after=read();
 }
 return {ok:after>before,after};
}
module.exports={waitForInventoryIncrease};
