'use strict';
/** Exact vanilla food pairings for one observed passive animal. */
const ANIMAL_FOOD=Object.freeze({
 cow:Object.freeze(['wheat']),
 sheep:Object.freeze(['wheat']),
 pig:Object.freeze(['carrot','potato','beetroot']),
 chicken:Object.freeze(['wheat_seeds','beetroot_seeds','pumpkin_seeds','melon_seeds'])
});
const FEED_ITEMS=Object.freeze([...new Set(Object.values(ANIMAL_FOOD).flat())]);
function validFeedPair(animal,item){
 return typeof animal==='string'&&typeof item==='string'&&
  Object.hasOwn(ANIMAL_FOOD,animal)&&ANIMAL_FOOD[animal].includes(item);
}
function validFeedArgs(command){
 return command&&typeof command==='object'&&!Array.isArray(command)&&
  Object.keys(command).length===3&&command.command==='feed_animal'&&
  Number.isSafeInteger(command.entityId)&&command.entityId>=0&&command.entityId<=200000&&
  FEED_ITEMS.includes(command.item);
}
module.exports={ANIMAL_FOOD,FEED_ITEMS,validFeedPair,validFeedArgs};
