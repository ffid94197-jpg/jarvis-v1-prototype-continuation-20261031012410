#!/usr/bin/env node
'use strict';
/*
 * JARVIS Minecraft V1 code-level validation. OFFLINE ONLY.
 * This command MUST NOT launch GitHub Actions, a Mojang server, contact the
 * Internet, modify game worlds, run real combat, or claim end-to-end victory.
 *
 * On a developer PC after npm ci in this folder:
 *   node run_offline_minecraft_gates.cjs
 */
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const ROOT=__dirname;
const files=[
  'bot.cjs','autonomy_engine.cjs','late_game.cjs','late_skills.cjs','resource_goal.cjs','mission_sequence.cjs','retreat_access.cjs','friend_protocol.cjs',
  'drop_pickup.cjs','wood_navigation.cjs','stone_access.cjs','portal_layout.cjs',
  'crafting_site.cjs','inventory_settlement.cjs',
  'verify_real_java_server_wood.cjs','verify_real_java_full_campaign.cjs'
];
const tests=[
  'verify_progression.cjs',
  'verify_resource_goal.cjs',
  'verify_retreat_access.cjs',
  'verify_travel_goal.cjs',
  'verify_mission_sequence.cjs',
  'verify_late_game.cjs',
  'verify_late_skills.cjs',
  'verify_crafting_site.cjs',
  'verify_drop_pickup.cjs',
  'verify_inventory_settlement.cjs',
  'verify_stone_access.cjs',
  'verify_wood_pickup_access.cjs',
  'verify_portal_layout.cjs',
  'verify_mining_recovery.cjs',
  'verify_general_primitives.cjs',
  'verify_terrain_survey.cjs',
  'verify_survey_recovery.cjs'
];
let passed=0;const failures=[];
function run(label,args){
  const result=spawnSync(process.execPath,args,{
    cwd:ROOT,stdio:'pipe',encoding:'utf8',timeout:90000,
    windowsHide:true,env:{...process.env,
      // These tests may never silently opt into live acceptance.
      MINECRAFT_LIVE_ACCEPTANCE:'0',
      JARVIS_MC_TEST_STONE:'0',JARVIS_MC_TEST_IRON:'0'}
  });
  if(result.error||result.status!==0){
    failures.push(label);
    console.error('FAIL '+label+'\n'+
      (result.stdout||'').slice(-900)+'\n'+(result.stderr||'').slice(-1800)+
      '\n'+String(result.error||''));
  }else{passed++;console.log('PASS '+label+' '+(result.stdout||'').trim().slice(-190));}
}
for(const file of files)run('syntax '+file,['--check',path.join(ROOT,file)]);
for(const file of tests)run('offline '+file,[path.join(ROOT,file)]);
console.log('MINECRAFT_CODE_ONLY_GATE: '+passed+'/'+(files.length+tests.length)+
  ' passed. This does NOT verify real Java Iron, Dragon, Netherite, or universal play.');
if(failures.length){
 console.error('UNVERIFIED/FAILED: '+failures.join(', '));process.exitCode=1;
}
