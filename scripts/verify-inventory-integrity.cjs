'use strict';
/** Inventory source, draft rejection, and actual readback verification. No live model. */
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const vm=require("node:vm");
const ts=require("typescript");
const root=path.resolve(__dirname,"..");
function compile(p, mocks={}){
 const src=fs.readFileSync(path.join(root,p),"utf8");
 const out=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const mod={exports:{}};
 const localRequire=name=>Object.hasOwn(mocks,name)?mocks[name]:require(name);
 vm.runInNewContext("(function(require,module,exports){"+out+"\n})",{},{timeout:3000})(localRequire,mod,mod.exports);
 return mod.exports;
}
const inventory=compile("src/lib/agent/core/inventoryIntegrity.ts");
const prior=compile("src/lib/agent/core/priorTaskContext.ts");
let count=0;
function test(label,fn){fn();count++;console.log("PASS",label);}
const original=[
 "Jarvis, I need a small inventory analysis for a fictional business.",
 "Here are six products with quantities and unit prices:",
 "- Keyboard: 3 units at ₹125 each",
 "- Mouse: 2 units at ₹240 each",
 "- Monitor: 5 units at ₹37 each",
 "- Headset: 1 unit at ₹999",
 "- Webcam: 4 units at ₹68 each",
 "- Speaker: 2 units at ₹150 each",
 "Plan and verify the output files."
].join("\n");
const source=inventory.parseInventorySource(original);
test("parse all original rows without changing values",()=>{
 assert.ok(source);assert.equal(source.rows.length,6);
 assert.equal(source.rows.find(x=>x.product==="Webcam").unitPaise,6800);
 assert.equal(source.totalUnits,17);assert.equal(source.totalPaise,261100);
});
test("parse explicit × source correction",()=>{
 const x=inventory.parseInventorySource("Inventory original rows:\n- Keyboard: 3 × ₹125\n- Mouse: 2 × ₹240\n- Monitor: 5 × ₹37\n- Headset: 1 × ₹999\n- Webcam: 4 × ₹68\n- Speaker: 2 × ₹150");
 assert.equal(x.totalPaise,261100);
});
test("parse comma separated original objective",()=>{
 const x=inventory.parseInventorySource("Inventory: Keyboard 3 units at 125, Mouse 2 at 240, Monitor 5 at 37, Headset 1 at 999, Webcam 4 at 68, Speaker 2 at 150.");
 assert.equal(x.totalPaise,261100);
});
test("unsupported data cannot become an invented source",()=>assert.equal(inventory.parseInventorySource("Please audit a previous inventory report."),null));
const csv="product,quantity,unit_price_inr,total_value_inr\nKeyboard,3,125,375\nMouse,2,240,480\nMonitor,5,37,185\nHeadset,1,999,999\nWebcam,4,68,272\nSpeaker,2,150,300\n";
const report="JARVIS INVENTORY ANALYSIS REPORT\n"+
 "Product | Qty | Unit Price (INR) | Total Value (INR)\n"+
 "Keyboard | 3 | 125 | 375\nMouse | 2 | 240 | 480\nMonitor | 5 | 37 | 185\n"+
 "Headset | 1 | 999 | 999\nWebcam | 4 | 68 | 272\nSpeaker | 2 | 150 | 300\n"+
 "TOTAL INVENTORY VALUE: INR 2,611\nTotal Units: 17\n";
const oldCsv=csv.replace("Webcam,4,68,272","Webcam,4,60,240");
const oldReport=report.replace("Webcam | 4 | 68 | 272","Webcam | 4 | 60 | 240").replace("INR 2,611","INR 2,579");
test("correct CSV independently matches original",()=>assert.equal(inventory.verifyInventoryCsv(csv,source),null));
test("correct report independently matches original",()=>assert.equal(inventory.verifyInventoryReport(report,source),null));
test("bad webcam unit price is rejected before write",()=>assert.match(inventory.validateInventoryDraft("inventory_analysis/inventory_data.csv",oldCsv,source),/Webcam: unit price/));
test("bad webcam report is rejected before write",()=>assert.match(inventory.validateInventoryDraft("inventory_analysis/inventory_report.txt",oldReport,source),/Webcam: unit price/));
test("incorrect grand total rejected even when all rows correct",()=>assert.match(inventory.verifyInventoryReport(report.replace("INR 2,611","INR 2,579"),source),/grand total/));
test("incorrect line total rejected",()=>assert.match(inventory.verifyInventoryCsv(csv.replace("Webcam,4,68,272","Webcam,4,68,240"),source),/line total/));
test("missing or extra rows are rejected",()=>{
 assert.match(inventory.verifyInventoryCsv(csv.replace("Speaker,2,150,300\n",""),source),/expected 6/);
 assert.match(inventory.verifyInventoryCsv(csv+"Printer,1,400,400\n",source),/expected 6/);
});
test("duplicate rows are rejected",()=>assert.match(inventory.verifyInventoryCsv(csv.replace("Speaker,2,150,300","Webcam,4,68,272"),source),/duplicate/));
test("unknown CSV format fails closed",()=>assert.match(inventory.verifyInventoryCsv("name,qty,price\nKeyboard,3,125\n",source),/header/));
test("invalid numeric field rejects before write",()=>assert.match(inventory.verifyInventoryCsv(csv.replace("Webcam,4,68,272","Webcam,4,abc,272"),source),/invalid monetary/));
test("unrelated tasks are not accidentally source-guarded",()=>assert.equal(inventory.validateInventoryDraft("notes.txt","a note",source),null));
test("without original owner rows drafts are not falsely marked bad",()=>assert.equal(inventory.validateInventoryDraft("inventory_data.csv",oldCsv,null),null));
test("prior selection skips nearer source-less recovery request",()=>{
 const previous={id:"most-recent",objective:"Audit my previous inventory analysis against the original instructions and correct it."};
 const first={id:"original",objective:original};
 assert.equal(prior.selectPriorTask("Audit previous inventory analysis against original request",[previous,first]).id,"original");
});
test("missing original in previous history is not fabricated",()=>{
 const prev={id:"latest",objective:"Please audit my previous inventory analysis."};
 assert.equal(prior.selectPriorTask("Audit previous inventory analysis against original request",[prev]),null);
});
test("Core enforces draft validation before Guardian admission",()=>{
 const loop=fs.readFileSync(path.join(root,"src/lib/agent/core/loop.ts"),"utf8");
 const idx=loop.indexOf("validateInventoryDraft(args.path, args.content, inventorySource)");
 const guardian=loop.indexOf("const guardian = await authorizeToolCall",idx);
 assert.ok(idx>0 && guardian>idx);
 assert.match(loop,/inventorySource:?\s*\}/);
});
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"jarvis-inventory-"));
const folder=path.join(tmp,"inventory_analysis");
fs.mkdirSync(folder);
const cPath=path.join(folder,"inventory_data.csv"),rPath=path.join(folder,"inventory_report.txt");
let effects=[];
const db={effectRecord:{findMany:async()=>effects}};
const policy={
 resolveScopedPath(input){
  if(typeof input!=="string" || input.includes("..") || path.isAbsolute(input) || input.includes(":") || input.includes("\0") || input===".")
   return {ok:false,reason:"invalid path"};
  const abs=path.resolve(tmp,input.replace(/\//g,path.sep));
  if(!abs.startsWith(tmp+path.sep))return {ok:false,reason:"outside scope"};
  return {ok:true,abs,rel:input};
 },
 async assertWithinRoot(abs){
  try {const rel=path.relative(tmp,abs);if(!rel || rel.startsWith("..") || path.isAbsolute(rel))return {ok:false};if(fs.lstatSync(abs).isSymbolicLink())return {ok:false};return {ok:true};}
  catch{return {ok:false};}
 }
};
const v=compile("src/lib/agent/core/verifier.ts",{"@/lib/db":{db},"../guardian/policy":policy,"./inventoryIntegrity":inventory});
function setEffects(mode="ok"){
 effects=["inventory_analysis/inventory_data.csv","inventory_analysis/inventory_report.txt"].map(rel=>({
  status:"SETTLED",tool:"write_file",argsJson:JSON.stringify({path:rel,content:"written"}),
  receiptJson:JSON.stringify({ok:true,tool:"write_file",detail:{path:rel,verified:true}})
 }));
 if(mode==="failed")effects.push({status:"FAILED",tool:"write_file",argsJson:"{}"});
 if(mode==="unknown")effects.push({status:"ADMITTED",tool:"write_file",argsJson:"{}"});
 if(mode==="missing")effects.pop();
}
async function asyncCases(){
 try{
  fs.writeFileSync(cPath,csv);fs.writeFileSync(rPath,report);
  setEffects();let a=await v.arbitrateCompletion({taskId:"t",objective:original,toolAssisted:true,inventorySource:source});
  if(a.verdict!=="verified")console.error("Initial arbitration evidence:",JSON.stringify(a.predicateLines));
  assert.equal(a.verdict,"verified");count++;console.log("PASS disk CSV+report exact input: VERIFIED");
  fs.writeFileSync(cPath,oldCsv);
  a=await v.arbitrateCompletion({taskId:"t",objective:original,toolAssisted:true,inventorySource:source});
  assert.equal(a.verdict,"partial");count++;console.log("PASS bad disk CSV: PARTIAL");
  fs.writeFileSync(cPath,csv);fs.writeFileSync(rPath,oldReport);
  a=await v.arbitrateCompletion({taskId:"t",objective:original,toolAssisted:true,inventorySource:source});
  assert.equal(a.verdict,"partial");count++;console.log("PASS bad disk report: PARTIAL");
  fs.writeFileSync(rPath,report);setEffects("missing");
  a=await v.arbitrateCompletion({taskId:"t",objective:original,toolAssisted:true,inventorySource:source});
  assert.equal(a.verdict,"partial");count++;console.log("PASS stale report not written this task: PARTIAL");
  setEffects("failed");a=await v.arbitrateCompletion({taskId:"t",objective:original,toolAssisted:true,inventorySource:source});
  assert.equal(a.verdict,"partial");count++;console.log("PASS failed effect not erased by valid files: PARTIAL");
  setEffects("unknown");a=await v.arbitrateCompletion({taskId:"t",objective:original,toolAssisted:true,inventorySource:source});
  assert.equal(a.verdict,"effect_unknown");count++;console.log("PASS unsettled effect: EFFECT_UNKNOWN");
  setEffects("ok");
  effects[1].receiptJson=JSON.stringify({ok:true,tool:"write_file",detail:{path:"other-report.txt",verified:true}});
  a=await v.arbitrateCompletion({taskId:"t",objective:original,toolAssisted:true,inventorySource:source});
  assert.equal(a.verdict,"partial");count++;console.log("PASS forged report receipt path rejected: PARTIAL");
  setEffects("ok");
  delete effects[1].receiptJson;
  a=await v.arbitrateCompletion({taskId:"t",objective:original,toolAssisted:true,inventorySource:source});
  assert.equal(a.verdict,"partial");count++;console.log("PASS stale report without verified receipt rejected: PARTIAL");
  setEffects("ok");fs.unlinkSync(cPath);
  a=await v.arbitrateCompletion({taskId:"t",objective:original,toolAssisted:true,inventorySource:source});
  assert.equal(a.verdict,"partial");count++;console.log("PASS missing disk file: PARTIAL");
  // No owner source => no deterministic inventory certification.
  fs.writeFileSync(cPath,csv);
  a=await v.arbitrateCompletion({taskId:"t",objective:"Audit the inventory analysis",toolAssisted:true,inventorySource:null});
  assert.equal(a.verdict,"partial");count++;console.log("PASS absent original source: PARTIAL");
  a=await v.arbitrateCompletion({taskId:"t",objective:"Create inventory_data.csv and inventory_report.txt",toolAssisted:true,inventorySource:null});
  assert.equal(a.verdict,"partial");assert.match(a.predicateLines.join("\\n"),/INVENTORY_SOURCE_UNAVAILABLE/);count++;console.log("PASS filename-only inventory artifacts without source: PARTIAL");
  console.log("INVENTORY_INTEGRITY",count+"/"+count,"PASS (real temp files + mocked durable effects; no live provider or Windows PC)");
 } finally{fs.rmSync(tmp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
asyncCases().catch(e=>{console.error(e);process.exitCode=1;});
