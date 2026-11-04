'use strict';
/** Normalize authorized typed goal parameters for the existing JARVIS controller.
 * Travel uses coordinates as 'destination'; equip uses 'destinationSlot'.
 * An old duplicated key silently overwrote travel coordinates with an armor slot.
 */
const GOAL_FIELDS=Object.freeze({
 gather:['resource','targetCount'],
 travel:['destination','arrivalRange'],
 craft:['item','targetCount'],
 smelt:['item','targetCount'],
 equip:['item','destinationSlot'],
 defeat_hostile:['mob','entityId'],
 build:['position','block','axis','length'],
 build_volume:['position','block','width','depth','height','shape'],
 farm_wheat:['position','width','depth','targetCount'],
 sequence:['steps']
});
function goalSpecFromCommand(command){
 if(!command || command.command!=='auto_goal' || typeof command.goal!=='string')
  throw Error('Expected a typed JARVIS auto_goal instruction');
 const fields=Object.hasOwn(GOAL_FIELDS,command.goal)?GOAL_FIELDS[command.goal]:[];
 const spec={};
 for(const field of fields){
  if(command[field]===undefined)continue;
  const value=command[field];
  const output=typeof value==='object'&&value!==null?JSON.parse(JSON.stringify(value)):value;
  spec[field==='destinationSlot'?'destination':field]=output;
 }
 return spec;
}
module.exports={goalSpecFromCommand,GOAL_FIELDS};
