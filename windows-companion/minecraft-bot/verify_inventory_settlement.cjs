#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const {waitForInventoryIncrease}=require('./inventory_settlement.cjs');
(async()=>{
 let n=0,now=1000,count=1;
 const a=await waitForInventoryIncrease({
  before:1,read:()=>count,check:()=>{},
  wait:async()=>{now+=100;count=5},deadline:2000,now:()=>now
 });
 assert.deepEqual(a,{ok:true,after:5});n++;
 const b=await waitForInventoryIncrease({
  before:1,read:()=>1,check:()=>{},
  wait:async()=>{now+=100},deadline:1300,now:()=>now
 });
 assert.equal(b.ok,false);assert.equal(b.after,1);n+=2;
 let cancelled=false;
 try{await waitForInventoryIncrease({
   before:0,read:()=>0,check:()=>{throw Error('owner E-stop')},
   wait:async()=>{throw Error('should not wait')},deadline:5000,now:()=>1000
 });}catch(e){cancelled=e.message==='owner E-stop';}
 assert(cancelled);n++;
 let reads=0;
 const already=await waitForInventoryIncrease({
   before:0,read:()=>{reads++;return 2},check:()=>{},
   wait:async()=>{throw Error('should not wait if settled')},deadline:5000,now:()=>1000
 });
 assert(already.ok&&reads===1);n++;
 console.log('MINECRAFT_CRAFT_SETTLEMENT '+n+'/'+n+' PASS (offline packet-timing simulation, live validation required)');
})().catch(e=>{console.error(e);process.exitCode=1;});
