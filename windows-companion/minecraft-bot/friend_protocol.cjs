/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
/** Pure command validation; identical contract for stdin and in-game chat. */
const {RESOURCES}=require('./resource_goal.cjs');
const {validSequence}=require('./mission_sequence.cjs');
const {validBuildSpec}=require('./structure_goal.cjs');
const {validFarmSpec}=require('./wheat_goal.cjs');
const SIMPLE = new Set(['follow','stop','jump','look','status','come','stay','guard','collect_wood','inventory','observe','auto_status','auto_stop','auto_checkpoint','auto_resume']);
function validateCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Invalid command';
  if (typeof input.command !== 'string') return 'Missing command';
  if (SIMPLE.has(input.command)) return null;
  if (input.command === 'auto_goal') {
    const fixed=['survive','wood','tools','explore','follow','guard','stone_age','iron_age',
      'dragon_run','netherite_dragon_run','dragon_then_netherite_run','companion'];
    const position=target=>target && typeof target==='object' &&
      !Array.isArray(target) &&
      ['x','y','z'].every(k=>Number.isInteger(target[k]) &&
        Math.abs(target[k])<=30000000);
    const validTravel=input.goal==='travel' && position(input.destination) &&
      Number.isInteger(input.arrivalRange) &&
      input.arrivalRange>=1 && input.arrivalRange<=8;
    const validBuild=input.goal==='build' && validBuildSpec({goal:'build',position:input.position,
      length:input.length,axis:input.axis,block:input.block});
    const validFarm=input.goal==='farm_wheat'&&validFarmSpec({goal:'farm_wheat',
      position:input.position,width:input.width,depth:input.depth,targetCount:input.targetCount});
    const validGoal=fixed.includes(input.goal)||validTravel||validBuild||validFarm||
      (input.goal==='gather' && RESOURCES.has(input.resource) &&
        Number.isInteger(input.targetCount) &&
        input.targetCount>=1&&input.targetCount<=64)||
      (input.goal==='sequence' && validSequence(input.steps));
    const allowedKeys=new Set(['command','goal','durationSeconds','resource','targetCount',
      'destination','arrivalRange','steps','position','block','axis','length','width','depth']);
    if(Object.keys(input).some(key=>!allowedKeys.has(key)))return 'Unexpected autonomous parameter';
    const noUnrelatedParameters=
      (input.goal==='gather' && input.steps===undefined&&input.destination===undefined&&input.arrivalRange===undefined) ||
      (input.goal==='travel' && input.resource===undefined&&input.targetCount===undefined&&input.steps===undefined) ||
      (input.goal==='sequence' && input.resource===undefined&&input.targetCount===undefined&&
        input.destination===undefined&&input.arrivalRange===undefined) ||
      (input.goal==='farm_wheat' && input.steps===undefined&&input.resource===undefined &&
        input.destination===undefined&&input.arrivalRange===undefined&&input.block===undefined&&
        input.axis===undefined&&input.length===undefined) ||
      (input.goal==='build' && input.steps===undefined&&input.resource===undefined &&
        input.targetCount===undefined&&input.destination===undefined&&input.arrivalRange===undefined) ||
      (fixed.includes(input.goal) && input.steps===undefined&&input.resource===undefined &&
        input.targetCount===undefined&&input.destination===undefined &&
        input.arrivalRange===undefined);
    return validGoal && noUnrelatedParameters &&
      (input.goal==='build'||['block','axis','length'].every(k=>input[k]===undefined)) &&
      (input.goal==='farm_wheat'||['width','depth'].every(k=>input[k]===undefined)) &&
      (['build','farm_wheat'].includes(input.goal)||input.position===undefined) &&
      (input.durationSeconds===undefined ||
        (Number.isInteger(input.durationSeconds) && input.durationSeconds>=10 &&
          input.durationSeconds<=43200)) ? null :
      'Autonomous goal invalid. Gather needs quantity 1-64; travel needs coordinates/radius 1-8; sequence allows 1-8 validated steps; duration 10-43200';
  }
  // Bounded general-purpose player primitives. All IDs/names are validated before I/O.
  const itemName = v => typeof v === 'string' && /^[a-z0-9_]{1,64}$/.test(v);
  const pos = v => v && typeof v === 'object' && !Array.isArray(v) &&
    ['x','y','z'].every(k=>Number.isInteger(v[k]) && Math.abs(v[k])<=30000000);
  if (input.command === 'navigate')
    return pos(input.position) && (input.range===undefined || (Number.isInteger(input.range) && input.range>=1 && input.range<=8))
      ? null : 'Navigate needs integer position and optional range 1–8';
  if (['dig_block','inspect_block','interact_block'].includes(input.command))
    return pos(input.position)?null:'Block command needs integer position';
  if (input.command === 'equip_item')
    return itemName(input.item) && ['hand','head','torso','legs','feet','off-hand'].includes(input.destination||'hand')
      ? null:'Equip needs item and valid destination';
  if (input.command === 'craft_item')
    return itemName(input.item) && Number.isInteger(input.count) && input.count>=1 && input.count<=16
      ? null:'Craft needs item and count 1–16';
  if (input.command === 'place_block')
    return itemName(input.item) && pos(input.reference) &&
      pos(input.face) && ['x','y','z'].reduce((n,k)=>n+Math.abs(input.face[k]),0)===1 &&
      ['x','y','z'].every(k=>Math.abs(input.face[k])<=1)
      ? null:'Place needs item, reference block and unit face';
  if (input.command === 'use_item')
    return input.hand===undefined || ['hand','off-hand'].includes(input.hand) ? null:'Invalid use hand';
  if (input.command === 'interact_entity')
    return Number.isInteger(input.entityId) && input.entityId>=0 ? null:'Invalid entity ID';
  if (input.command === 'move')
    return ['forward','back','left','right'].includes(input.directionInput) &&
      Number.isInteger(input.durationMs) && input.durationMs >= 100 && input.durationMs <= 3000
      ? null : 'Movement must specify direction and 100–3000ms';
  if (input.command === 'say')
    return typeof input.text === 'string' && input.text.trim().length >= 1 &&
      input.text.length <= 120 && !/[\x00-\x1f\x7f]/.test(input.text)
      ? null : 'Say requires 1–120 printable characters';
  return 'Unsupported Minecraft friend action';
}
function inventorySummary(bot) {
  const items = bot.inventory?.items?.() || [];
  return items.slice(0,8).map(i=>i.name + ':' + i.count).join(', ') || 'empty';
}
module.exports={validateCommand,inventorySummary,SIMPLE};
