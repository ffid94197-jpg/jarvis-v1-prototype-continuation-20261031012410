/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
/** Pure command validation; identical contract for stdin and in-game chat. */
const SIMPLE = new Set(['follow','stop','jump','look','status','come','stay','guard','collect_wood','inventory','observe','auto_status','auto_stop']);
function validateCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Invalid command';
  if (typeof input.command !== 'string') return 'Missing command';
  if (SIMPLE.has(input.command)) return null;
  if (input.command === 'auto_goal')
    return ['survive','wood','tools','explore','follow','guard','stone_age','iron_age','dragon_run','netherite_dragon_run','dragon_then_netherite_run','companion'].includes(input.goal) &&
      (input.durationSeconds===undefined || (Number.isInteger(input.durationSeconds) &&
       input.durationSeconds>=10 && input.durationSeconds<=43200))
      ? null : 'Autonomous goal needs valid goal and optional duration 10–43200 seconds';
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
