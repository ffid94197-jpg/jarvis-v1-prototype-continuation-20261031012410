'use strict';
/** State-grounded Minecraft Java vanilla progression from diamond gear to the
 * End exit. Pure planner: not proof of a live playthrough. No cheats or server
 * admin access, no arbitrary command execution or trusting player chat.
 */
const NETHERITE=['netherite_helmet','netherite_chestplate','netherite_leggings','netherite_boots','netherite_sword'];
const DIAMOND=['diamond_helmet','diamond_chestplate','diamond_leggings','diamond_boots','diamond_sword'];
const action=(kind,why,other={})=>({kind,why,...other});
const qty=(i,k)=>Number.isFinite(i?.raw?.[k])?i.raw[k]:Number.isFinite(i?.[k])?i[k]:0;
const has=(i,k)=>qty(i,k)>0;
// Minecraft Java's real item ID is "ender_eye"; historical model snapshots
// use "eye_of_ender". Read the raw inventory first to avoid double-counting
// the same item through a normalized alias added by digest().
const eyeCount=i=>{
  const raw=i?.raw;
  if(raw && (Object.hasOwn(raw,'ender_eye')||Object.hasOwn(raw,'eye_of_ender')))
    return (Number.isFinite(raw.ender_eye)?Math.max(0,raw.ender_eye):0)+
      (Number.isFinite(raw.eye_of_ender)?Math.max(0,raw.eye_of_ender):0);
  return Math.max(qty(i,'ender_eye'),qty(i,'eye_of_ender'));
};
function lateGamePlan(world,progress={}){
  const i=world.inventory||{},m=progress.milestones||{};
  const dimension=String(world.dimension||'minecraft:overworld').replace(/^minecraft:/,'');
  const dragonFirst=progress.goal==='dragon_then_netherite_run';
  const dragonVictory=m.dragonKilled===true && m.exitPortalObserved===true;
  // This separate user-authorized mission enforces a strict temporal order:
  // dragon death and the End exit portal FIRST, full worn Netherite LAST.
  // It never accepts entity disappearance or a planner receipt as proof.
  if(dragonFirst && !dragonVictory){
    if(dimension==='the_end'){
      if(world.wornDiamond!==true && world.wornNetherite!==true)
        return action('equip_diamond','Equip and verify four diamond armor slots before the Dragon fight');
      if(world.dragonDeadObserved===true && m.dragonSeen===true && world.exitPortalPresent===true)
        return action('verify_dragon','Verify real dragon death event plus generated End exit portal');
      if(world.dragonPresent){
        if(!m.dragonSeen)return action('observe_dragon','Record live dragon entity before combat');
        if(world.crystalsNearby>0)return action('destroy_end_crystal','Destroy actual healing crystals');
        return action('fight_dragon','Damage observed dragon until death event',{dragonId:world.dragonId});
      }
      return action('search_dragon','Dragon absent but no death+portal proof; search rather than claim victory');
    }
    if(dimension==='the_nether'){
      if(qty(i,'blaze_rod')+Math.floor(qty(i,'blaze_powder')/2)<8)return action('hunt_blazes','Collect actual blaze rods');
      if(qty(i,'ender_pearl')+eyeCount(i)<16)return action('hunt_endermen','Collect actual pearls');
      return action('enter_overworld','Return from Nether to locate End portal');
    }
    if(dimension!=='overworld')return action('blocked','Unknown game dimension '+dimension);
    if(!m.netherPortalBuilt && !world.netherPortalNearby){
      if(qty(i,'obsidian')<14)return action('mine_obsidian','Collect actual obsidian');
      if(!has(i,'flint_and_steel')){
        if(!has(i,'flint'))return action('collect_flint','Mine gravel for flint');
        if(!has(i,'iron_ingot'))return action('collect_iron','Smelt iron for flint and steel');
        return action('craft_flint_steel','Craft a verified flint and steel');
      }
      return action('build_nether_portal','Build and ignite a verified obsidian portal');
    }
    // Count crafted eyes as already secured: turning rods and pearls into
    // blaze powder/eyes must never send the planner back to Nether forever.
    // Before the stronghold, budget 16 possible eyes (travel breakage).
    // Once portal frames are found, require 12 at hand for an empty frame ring.
    // An already-active portal needs no extra Eyes; sending a player back
    // to the Nether at this point can make a completed portal unreachable.
    if(world.endPortalPresent && world.endPortalActivated){
      if(!has(i,'bow') || qty(i,'arrow')<32)
        return action('prepare_archery','Prepare for real End combat before entering open portal');
      return action('enter_end','Enter actual already-open End portal');
    }
    const neededInFrames=world.strongholdPortalFrameNearby &&
      Number.isInteger(world.strongholdMissingEyes) &&
      world.strongholdMissingEyes>=0 && world.strongholdMissingEyes<=12
      ? world.strongholdMissingEyes : 12;
    const minEyes=world.strongholdPortalFrameNearby||world.endPortalPresent
      ?neededInFrames:(m.strongholdSearchStarted?12:16);
    const availableEyes=eyeCount(i)+
      Math.min(qty(i,'ender_pearl'),qty(i,'blaze_powder')+2*qty(i,'blaze_rod'));
    if(availableEyes<minEyes)
      return action('enter_nether','Replenish actual Eye of Ender supplies');
    if(!has(i,'bow') || qty(i,'arrow')<32)
      return action('prepare_archery','Acquire bow and 32 actual arrows');
    // Activating frames requires PHYSICAL crafted Eyes, not just raw pearls
    // and Blaze powder. Apply this even after the frames are discovered.
    if(eyeCount(i)<minEyes){
      if(qty(i,'blaze_powder')<1)return action('craft_blaze_powder','Create blaze powder from real rods');
      return action('craft_eyes','Create Eyes of Ender from observed ingredients');
    }
    if(world.strongholdPortalFrameNearby || world.endPortalPresent)
      return action('activate_end_portal','Activate twelve observed stronghold portal frames');
    return action('track_stronghold','Locate a real stronghold using Eyes of Ender');
  }
  if(dragonFirst && dragonVictory && dimension==='the_end')
    return action('exit_end','Use the observed End exit portal to return to Overworld; dragon already verified');
  if(dragonFirst && dragonVictory && dimension==='overworld' && m.endReturned!==true)
    return action('blocked','Dragon death and exit portal were verified, but the physical End-to-Overworld return receipt is missing');

  // Only an entityDead event observed after the live dragon was seen PLUS the
  // generated End portal may prove a kill; a disappearing entity cannot.
  // A historical equip receipt is NOT proof that the armor is still worn.
  // Require the current server-observed equipment slots at final settlement.
  if(m.dragonKilled && m.exitPortalObserved && m.netheriteEquipped &&
     (!dragonFirst || (m.endReturned===true && dimension==='overworld')) &&
     world.wornNetherite===true)
    return action('complete','Actual Ender Dragon death, End return (when required), and currently worn full Netherite armor confirmed');
  if(dimension==='the_end'){
    if(!m.netheriteEquipped || world.wornNetherite!==true)
      return action('equip_netherite','Reverify all worn armor slots and sword before End battle or victory');
    if(world.dragonDeadObserved && m.dragonSeen && world.exitPortalPresent)
      return action('verify_dragon','Verify server dragon death and End exit portal');
    if(world.dragonPresent){
      if(!m.dragonSeen)return action('observe_dragon','Record live dragon entity before combat');
      if(world.crystalsNearby>0)return action('destroy_end_crystal','Destroy observed healing crystals before dragon damage');
      return action('fight_dragon','Damage observed dragon; require actual death event to certify win',{dragonId:world.dragonId});
    }
    return action('search_dragon','Scout End island for real dragon or exit portal');
  }
  if(dimension==='the_nether'){
    // Bring all five upgrade ingots' ingredients, template, pearls and rods
    // back home; Overworld is safer for crafting and smithing workstations.
    if(!has(i,'netherite_upgrade_smithing_template'))
      return action('loot_bastion_template','Find Bastion Remnant and withdraw one actual Netherite upgrade template');
    // Track what is STILL missing, not 20 new scraps/gold every time.
    // Previously a partially upgraded inventory (four Netherite pieces and
    // one pre-crafted ingot) restarted the 20-debris grind indefinitely.
    const upgradesRemaining=NETHERITE.filter(n=>!has(i,n)).length;
    const uncraftedIngotCount=Math.max(0,upgradesRemaining-qty(i,'netherite_ingot'));
    const materialUnits=uncraftedIngotCount*4;
    if(qty(i,'netherite_scrap')+qty(i,'ancient_debris')<materialUnits)
      return action('mine_ancient_debris','Collect only the remaining actual Ancient Debris for uncrafted upgrades');
    // Carry verified raw ore/nuggets home rather than being forced to
    // smelt or craft in a dangerous Nether biome with no workstation.
    const convertibleGold=qty(i,'gold_ingot')+qty(i,'raw_gold')+
      Math.floor(qty(i,'gold_nugget')/9);
    if(convertibleGold<materialUnits)
      return action('collect_gold','Acquire '+(materialUnits-convertibleGold)+
        ' additional real gold ingot equivalents');
    if(!(dragonFirst && dragonVictory) && qty(i,'blaze_rod')+Math.floor(qty(i,'blaze_powder')/2)<8)
      return action('hunt_blazes','Locate Nether fortress and collect eight actual Blaze rods');
    if(!(dragonFirst && dragonVictory) && qty(i,'ender_pearl')+eyeCount(i)<16)
      return action('hunt_endermen','Collect Ender pearls through real mob drops or trading');
    if(qty(i,'netherrack')<4)return action('mine_netherrack','Carry at least four netherrack for smithing template duplication');
    return action('enter_overworld','Take observed Nether portal back to Overworld with loot');
  }
  if(dimension!=='overworld')return action('blocked','Unknown game dimension: '+dimension);
  const missing=NETHERITE.filter(n=>!has(i,n));
  if(missing.length){
    // Existing portal may be reconstructed from saved position after returning.
    if(!m.netherPortalBuilt && !world.netherPortalNearby){
      if(qty(i,'obsidian')<14)return action('mine_obsidian','Mine fourteen actual obsidian blocks with diamond pickaxe');
      if(!has(i,'flint_and_steel')){
        if(!has(i,'flint'))return action('collect_flint','Mine gravel until real flint drops');
        if(!has(i,'iron_ingot'))return action('collect_iron','Mine/smelt an iron ingot for flint and steel');
        return action('craft_flint_steel','Craft flint and steel with observed recipe');
      }
      return action('build_nether_portal','Build and ignite 14-block obsidian Nether portal; verify portal blocks');
    }
    // Still missing actual loot? Go to Nether, don't fabricate anything.
    if(!has(i,'netherite_upgrade_smithing_template') ||
      qty(i,'ancient_debris')+qty(i,'netherite_scrap')+4*qty(i,'netherite_ingot') < 4*missing.length ||
      qty(i,'gold_ingot')+qty(i,'raw_gold')+Math.floor(qty(i,'gold_nugget')/9)+
       4*qty(i,'netherite_ingot') < 4*missing.length ||
      (!(dragonFirst && dragonVictory) && (qty(i,'blaze_rod')+Math.floor(qty(i,'blaze_powder')/2)<8 ||
      qty(i,'ender_pearl')+eyeCount(i)<16)))
      return action('enter_nether','Collect missing Netherite/End progression materials in Nether');
    if(qty(i,'ancient_debris')>0){
      if(!world.furnaceNearby){
        if(has(i,'furnace'))return action('place_furnace','Place furnace for Netherite scrap');
        if(qty(i,'cobblestone')<8)return action('mine_cobblestone','Collect furnace stone in Overworld');
        if(!world.workbenchNearby)return has(i,'crafting_table')?action('place_table','Place crafting table'):action('craft_table','Make crafting table');
        return action('craft_furnace','Create verified furnace');
      }
      if(!has(i,'coal') && !has(i,'charcoal') && qty(i,'planks')<1)return qty(i,'logs')>0?action('craft_planks','Convert existing logs to smelting fuel'):action('collect_wood','Gather fuel for smelting ancient debris');
      return action('smelt_resource','Smelt ancient debris into Netherite scrap',{input:'ancient_debris',output:'netherite_scrap'});
    }
    const uncraftedUpgrades=Math.max(0,missing.length-qty(i,'netherite_ingot'));
    const neededGold=4*uncraftedUpgrades;
    if(qty(i,'gold_ingot')<neededGold){
      if(qty(i,'raw_gold')>0){
        if(!world.furnaceNearby){
          if(has(i,'furnace'))return action('place_furnace','Place owned gold-refining furnace');
          if(qty(i,'cobblestone')<8)return action('mine_cobblestone','Acquire eight furnace stones');
          if(!world.workbenchNearby)
            return has(i,'crafting_table')?action('place_table','Place gold furnace workbench'):
              action('craft_table','Create crafting station for furnace');
          return action('craft_furnace','Craft a verified furnace for raw gold');
        }
        if(!has(i,'coal')&&!has(i,'charcoal')&&qty(i,'planks')<1)
          return qty(i,'logs')>0?action('craft_planks','Convert wood into gold furnace fuel'):
            action('collect_wood','Gather gold furnace fuel in Overworld');
        return action('smelt_resource','Refine real raw gold into gold ingots',
          {input:'raw_gold',output:'gold_ingot'});
      }
      if(qty(i,'gold_nugget')>=9){
        if(!world.workbenchNearby)return has(i,'crafting_table')
          ?action('place_table','Place gold ingot workstation'):
            action('craft_table','Craft gold ingot workstation');
        return action('collect_gold','Convert observed nine gold nuggets into a physical ingot');
      }
      return action('enter_nether','Still missing actual gold for Netherite upgrades');
    }
    if(qty(i,'netherite_ingot')<missing.length){
      if(qty(i,'netherite_scrap')>=4 && qty(i,'gold_ingot')>=4){
        if(!world.workbenchNearby){
          if(has(i,'crafting_table'))return action('place_table','Place owned 3x3 Netherite crafting workstation');
          if(qty(i,'planks')>=4)return action('craft_table','Create Netherite crafting station from planks');
          if(qty(i,'logs')>0)return action('craft_planks','Produce planks for Netherite crafting station');
          return action('collect_wood','Gather wood for Netherite crafting station');
        }
        return action('craft_netherite_ingot','Use real 3x3 table to combine four scrap and four gold');
      }
      return action('blocked','Insufficient actual Netherite materials after Nether return');
    }
    const templates=qty(i,'netherite_upgrade_smithing_template');
    if(templates<missing.length){
      if(qty(i,'diamond')<7)return action('mine_diamond','Get seven diamonds to duplicate smithing template');
      if(qty(i,'netherrack')<1)return action('enter_nether','Collect netherrack for smithing template duplication');
      if(!world.workbenchNearby)return has(i,'crafting_table')?action('place_table','Place crafting table'):action('craft_table','Make crafting table');
      return action('duplicate_template','Duplicate original upgrade template using seven diamonds and netherrack');
    }
    if(!world.smithingTableNearby){
      if(has(i,'smithing_table'))return action('place_smithing_table','Place owned smithing workstation');
      if(qty(i,'iron_ingot')<2)return action('collect_iron','Mine and smelt iron for smithing table');
      if(qty(i,'planks')<4)return qty(i,'logs')>0?action('craft_planks','Convert existing logs to smithing table planks'):action('collect_wood','Acquire timber for smithing table');
      if(!world.workbenchNearby)return has(i,'crafting_table')?action('place_table','Place crafting table'):action('craft_table','Make crafting table');
      return action('craft_smithing_table','Craft smithing table using server recipe');
    }
    const idx=NETHERITE.findIndex(n=>!has(i,n));
    return action('smith_netherite','Upgrade diamond equipment using ingot and template at smithing table',{item:NETHERITE[idx],base:DIAMOND[idx]});
  }
  if(!m.netheriteEquipped || world.wornNetherite!==true)
    return action('equip_netherite','Equip and reverify four Netherite armor slots and sword');
  // An activated portal requires no more Eyes. Still verify the bow.
  const alreadyOpen=world.endPortalPresent && world.endPortalActivated;
  const missingInFrames=world.strongholdPortalFrameNearby &&
    Number.isInteger(world.strongholdMissingEyes) &&
    world.strongholdMissingEyes>=0 && world.strongholdMissingEyes<=12
    ?world.strongholdMissingEyes:12;
  const neededEyes=world.strongholdPortalFrameNearby?missingInFrames:12;
  if(!alreadyOpen &&
    (eyeCount(i)+qty(i,'blaze_powder')+2*qty(i,'blaze_rod')<neededEyes ||
      qty(i,'ender_pearl')+eyeCount(i)<neededEyes))
    return action('enter_nether','Obtain remaining blaze rods and pearls for Eyes of Ender');
  if(!has(i,'bow') || qty(i,'arrow')<32){
    if(!world.workbenchNearby && !has(i,'bow'))
      return has(i,'crafting_table')?action('place_table','Place crafting station for bow'):
        action('craft_table','Craft bow workbench');
    return action('prepare_archery','Prepare physical bow and at least thirty-two arrows before dragon fight');
  }
  if(alreadyOpen)return action('enter_end','Enter actual activated portal; verify End dimension');
  if(eyeCount(i)<neededEyes){
    if(qty(i,'blaze_powder')<1)return action('craft_blaze_powder','Craft blaze powder from real rods');
    return action('craft_eyes','Craft Eye of Ender with pearl and powder');
  }
  if(world.endPortalPresent)return action('activate_end_portal','Fill observed End portal frames');
  if(world.strongholdPortalFrameNearby)return action('activate_end_portal','Fill actual loaded End portal frames');
  return action('track_stronghold','Follow observed thrown-eye direction and search for stronghold');
}
module.exports={lateGamePlan,NETHERITE,DIAMOND,eyeCount};
