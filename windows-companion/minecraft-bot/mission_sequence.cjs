'use strict';
/** A bounded sequence of validated autonomous subgoals.
 * This is declarative data, not a script evaluator. It never executes a
 * chat-supplied function, tool name, shell command or arbitrary Minecraft ID.
 */
const {RESOURCES}=require('./resource_goal.cjs');
const {validBuildSpec}=require('./structure_goal.cjs');
const {validFarmSpec}=require('./wheat_goal.cjs');
const {validCraftSpec,validEquipSpec}=require('./general_goal.cjs');
const SIMPLE_STEPS=new Set(['tools','stone_age','iron_age']);
function validPosition(p){
 return !!p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===3&&
   ['x','y','z'].every(k=>Number.isInteger(p[k])&&Math.abs(p[k])<=30000000);
}
function validStep(s){
 if(!s||typeof s!=='object'||Array.isArray(s)||typeof s.goal!=='string')
   return false;
 if(SIMPLE_STEPS.has(s.goal))
   return Object.keys(s).length===1;
 if(s.goal==='craft')return validCraftSpec(s);
 if(s.goal==='equip')return validEquipSpec(s);
 if(s.goal==='build')return validBuildSpec(s);
 if(s.goal==='farm_wheat')return validFarmSpec(s);
 if(s.goal==='gather')
   return Object.keys(s).every(k=>['goal','resource','targetCount'].includes(k)) &&
     RESOURCES.has(s.resource)&&Number.isInteger(s.targetCount)&&
     s.targetCount>=1&&s.targetCount<=64;
 if(s.goal==='travel')
   return Object.keys(s).every(k=>['goal','destination','arrivalRange'].includes(k)) &&
     validPosition(s.destination)&&Number.isInteger(s.arrivalRange)&&
     s.arrivalRange>=1&&s.arrivalRange<=8;
 return false;
}
function validSequence(steps){
 return Array.isArray(steps)&&steps.length>=1&&steps.length<=8&&steps.every(validStep);
}
function canonicalSequence(steps){
 if(!validSequence(steps))throw Error('Invalid bounded autonomous goal sequence');
 return steps.map(s=>JSON.parse(JSON.stringify(s)));
}
module.exports={SIMPLE_STEPS,validStep,validSequence,canonicalSequence,validPosition};
