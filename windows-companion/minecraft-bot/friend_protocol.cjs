/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
/** Pure command validation; identical contract for stdin and in-game chat. */
const {RESOURCES}=require('./resource_goal.cjs');
const {validSequence}=require('./mission_sequence.cjs');
const {validBuildSpec,validVolumeSpec}=require('./structure_goal.cjs');
const {validFarmSpec}=require('./wheat_goal.cjs');
const {validCraftSpec,validEquipSpec}=require('./general_goal.cjs');
const SIMPLE = new Set(['follow','stop','jump','look','status','come','stay','guard','collect_wood','inventory','observe','auto_status','auto_stop','auto_checkpoint','auto_resume']);
function validateCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Invalid command';
  if (typeof input.command !== 'string') return 'Missing command';
  if(input.command==='natural_goal')
    return Object.keys(input).length===2 && typeof input.text==='string' &&
      input.text.trim().length>0 && input.text.length<=600 &&
      !/[\x00-\x1f\x7f]/.test(input.text)
      ?null:'Natural owner instruction must be 1-600 printable characters with no extra fields';
  // Every entrypoint (stdin, owner chat, Core tool) must reject unexpected
  // fields. The correlation ID belongs to the transport envelope, never to
  // the typed game command (bot.cjs already strips it before validation).
  const exactFields=fields=>Object.keys(input).every(k=>k==='command'||fields.includes(k));
  if (SIMPLE.has(input.command))
    return exactFields([])?null:'Unexpected parameter on simple game command';
  if (input.command === 'auto_goal') {
    const fixed=['survive','wood','tools','explore','follow','guard','stone_age','iron_age',
      'dragon_run','netherite_dragon_run','dragon_then_netherite_run','companion'];
    const position=target=>target && typeof target==='object' &&
      !Array.isArray(target) && Object.keys(target).length===3 &&
      ['x','y','z'].every(k=>Number.isInteger(target[k]) &&
        Math.abs(target[k])<=30000000);
    const validTravel=input.goal==='travel' && position(input.destination) &&
      Number.isInteger(input.arrivalRange) &&
      input.arrivalRange>=1 && input.arrivalRange<=8;
    const validBuild=input.goal==='build' && validBuildSpec({goal:'build',position:input.position,
      length:input.length,axis:input.axis,block:input.block});
    const validVolume=input.goal==='build_volume'&&validVolumeSpec({goal:'build_volume',
      position:input.position,block:input.block,width:input.width,depth:input.depth,
      height:input.height,shape:input.shape});
    const validFarm=input.goal==='farm_wheat'&&validFarmSpec({goal:'farm_wheat',
      position:input.position,width:input.width,depth:input.depth,targetCount:input.targetCount});
    const validGoal=fixed.includes(input.goal)||validTravel||validBuild||validVolume||validFarm||
      (input.goal==='craft' && validCraftSpec({goal:'craft',item:input.item,targetCount:input.targetCount}))||
      (input.goal==='equip' && validEquipSpec({goal:'equip',item:input.item,destination:input.destinationSlot}))||
      (input.goal==='gather' && RESOURCES.has(input.resource) &&
        Number.isInteger(input.targetCount) &&
        input.targetCount>=1&&input.targetCount<=64)||
      (input.goal==='sequence' && validSequence(input.steps));
    const allowedKeys=new Set(['command','goal','durationSeconds','resource','targetCount',
      'destination','arrivalRange','steps','position','block','axis','length','width','depth','height','shape','item','destinationSlot']);
    if(Object.keys(input).some(key=>!allowedKeys.has(key)))return 'Unexpected autonomous parameter';
    const noUnrelatedParameters=
      (input.goal==='craft' && input.steps===undefined&&input.destination===undefined&&
        input.arrivalRange===undefined&&input.position===undefined&&input.resource===undefined&&
        input.block===undefined&&input.axis===undefined&&input.length===undefined&&
        input.width===undefined&&input.depth===undefined&&input.destinationSlot===undefined) ||
      (input.goal==='equip' && input.steps===undefined&&input.destination===undefined&&
        input.arrivalRange===undefined&&input.position===undefined&&input.resource===undefined&&
        input.block===undefined&&input.axis===undefined&&input.length===undefined&&
        input.width===undefined&&input.depth===undefined&&input.targetCount===undefined) ||
      (input.goal==='gather' && input.steps===undefined&&input.destination===undefined&&input.arrivalRange===undefined) ||
      (input.goal==='travel' && input.resource===undefined&&input.targetCount===undefined&&input.steps===undefined) ||
      (input.goal==='sequence' && input.resource===undefined&&input.targetCount===undefined&&
        input.destination===undefined&&input.arrivalRange===undefined) ||
      (input.goal==='farm_wheat' && input.steps===undefined&&input.resource===undefined &&
        input.destination===undefined&&input.arrivalRange===undefined&&input.block===undefined&&
        input.axis===undefined&&input.length===undefined) ||
      (input.goal==='build_volume' && input.steps===undefined&&input.resource===undefined &&
        input.targetCount===undefined&&input.destination===undefined&&input.arrivalRange===undefined&&
        input.axis===undefined&&input.length===undefined&&input.destinationSlot===undefined&&
        input.item===undefined) ||
      (input.goal==='build' && input.steps===undefined&&input.resource===undefined &&
        input.targetCount===undefined&&input.destination===undefined&&input.arrivalRange===undefined) ||
      (fixed.includes(input.goal) && input.steps===undefined&&input.resource===undefined &&
        input.targetCount===undefined&&input.destination===undefined &&
        input.arrivalRange===undefined);
    return validGoal && noUnrelatedParameters &&
      (['craft','equip'].includes(input.goal)||input.item===undefined) &&
      (input.goal==='equip'||input.destinationSlot===undefined) &&
      (['craft','gather','farm_wheat'].includes(input.goal)||input.targetCount===undefined) &&
      (input.goal==='build_volume'||['height','shape'].every(k=>input[k]===undefined)) &&
      (['build','build_volume'].includes(input.goal)||['block','axis','length'].every(k=>input[k]===undefined)) &&
      (input.goal==='build_volume'||input.height===undefined&&input.shape===undefined) &&
      (['farm_wheat','build_volume'].includes(input.goal)||['width','depth'].every(k=>input[k]===undefined)) &&
      (['build','build_volume','farm_wheat'].includes(input.goal)||input.position===undefined) &&
      (input.durationSeconds===undefined ||
        (Number.isInteger(input.durationSeconds) && input.durationSeconds>=10 &&
          input.durationSeconds<=43200)) ? null :
      'Autonomous goal invalid. Gather needs quantity 1-64; travel needs coordinates/radius 1-8; sequence allows 1-8 validated steps; duration 10-43200';
  }
  // Bounded general-purpose player primitives. All IDs/names are validated before I/O.
  const primitiveFields={
    navigate:['position','range'],dig_block:['position'],inspect_block:['position'],
    interact_block:['position'],equip_item:['item','destination'],
    craft_item:['item','count'],place_block:['item','reference','face'],
    use_item:['hand'],interact_entity:['entityId'],
    move:['directionInput','durationMs'],say:['text'],
    inspect_villager:['entityId'],trade_villager:['entityId','tradeIndex','times'],
    transfer_container:['position','item','count','operation'],
    enchant_item:['position','item','choice']
  };
  if(Object.hasOwn(primitiveFields,input.command)&&!exactFields(primitiveFields[input.command]))
    return 'Unexpected parameter on game primitive';
  const itemName = v => typeof v === 'string' && /^[a-z0-9_]{1,64}$/.test(v);
  const pos = v => v && typeof v === 'object' && !Array.isArray(v) &&
    Object.keys(v).length===3 &&
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
  if(input.command==='inspect_villager')
    return Number.isInteger(input.entityId)&&input.entityId>=0&&input.entityId<=200000?
      null:'Villager inspect needs one observed entity ID';
  if(input.command==='trade_villager')
    return Number.isInteger(input.entityId)&&input.entityId>=0&&input.entityId<=200000 &&
      Number.isInteger(input.tradeIndex)&&input.tradeIndex>=0&&input.tradeIndex<=31 &&
      Number.isInteger(input.times)&&input.times>=1&&input.times<=4?
      null:'Trade needs observed villager ID, offer index 0-31 and repetitions 1-4';
  if(input.command==='transfer_container')
    return pos(input.position)&&itemName(input.item)&&
      Number.isInteger(input.count)&&input.count>=1&&input.count<=64 &&
      ['deposit','withdraw'].includes(input.operation)?
      null:'Container transfer needs exact coordinates, item, count 1-64 and direction';
  if(input.command==='enchant_item')
    return pos(input.position)&&itemName(input.item)&&
      Number.isInteger(input.choice)&&input.choice>=0&&input.choice<=2?
      null:'Enchant requires loaded table coordinates, item and option 0-2';
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
