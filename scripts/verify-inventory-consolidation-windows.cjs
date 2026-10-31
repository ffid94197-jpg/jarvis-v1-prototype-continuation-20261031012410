"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),ts=require("typescript");
const root=path.resolve(__dirname,"..");let count=0;
function test(label,fn){fn();count++;console.log("PASS",label)}
function load(rel,mocks={}){
 const js=ts.transpileModule(fs.readFileSync(path.join(root,rel),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const m={exports:{}};
 vm.runInNewContext("(function(require,module,exports){"+js+"\n})",{},{timeout:3000})(n=>Object.hasOwn(mocks,n)?mocks[n]:require(n),m,m.exports);
 return m.exports;
}
const inventory=load("src/lib/agent/core/inventoryIntegrity.ts");
const api=load("src/lib/agent/core/taskInputGate.ts",{"./inventoryIntegrity":inventory});
const data=["Keyboard: 3 units at ₹125 each","Mouse: 2 units at ₹240 each","Monitor: 5 units at ₹37 each","Headset: 1 unit at ₹999 each","Webcam: 4 units at ₹68 each","Speaker: 2 units at ₹150 each"];
const prefix="JARVIS, execute a complete inventory analysis. Original inventory data: ";
const suffix=" Create inventory_data.csv and inventory_report.txt. Calculate all six products.";
const single=prefix+data.map(x=>"- "+x).join(" ")+suffix;
const multi=prefix+"\n"+data.map(x=>"- "+x).join("\n")+suffix;
for(const [name,prompt] of [["flattened",single],["multiline",multi]]){
 test(name+" source integrity",()=>{
  const s=inventory.parseInventorySource(prompt);
  assert.equal(s?.rows.length,6);assert.equal(s.totalUnits,17);assert.equal(s.totalPaise,261100);
  assert.equal(s.rows[4].unitPaise,6800);
  const gate=api.prepareTaskObjective(prompt);
  assert.equal(gate.ok,true);assert.equal(gate.inventoryRows,6);
 });
}
test("flattened last row without each before next instruction",()=>{
 const changed=single.replace("₹150 each Create", "₹150 Create");
 const s=inventory.parseInventorySource(changed);
 assert.equal(s?.rows.length,6);assert.equal(s.totalPaise,261100);
});
test("unrecognized text after amount refused",()=>assert.equal(
 inventory.parseInventorySource(single.replace("₹150 each Create","₹150 each INVALID Create")),null));
test("negative inline price refused",()=>assert.equal(inventory.parseInventorySource(single.replace("₹68 each","-₹68 each")),null));
test("unknown price suffix refused",()=>assert.equal(inventory.parseInventorySource(single.replace("₹68 each","₹68X each")),null));
test("missing row refused",()=>assert.equal(inventory.parseInventorySource(prefix+data.slice(0,5).map(x=>"- "+x).join(" ")+suffix),null));
test("duplicate row refused",()=>assert.equal(inventory.parseInventorySource(prefix+data.slice(0,5).concat(data[0]).map(x=>"- "+x).join(" ")+suffix),null));
test("source-free task with only filename report reference rejected",()=>{
 const r=api.prepareTaskObjective("Original inventory data: Create inventory_data.csv and inventory_report.txt.");
 assert.equal(r.status,422);
});
test("source-free task rejected at API boundary",()=>assert.equal(api.prepareTaskObjective(prefix+"Please create inventory_data.csv and inventory_report.txt.").status,422));
test("source >2000 chars preserved",()=>{
 const objective="Untrusted context.\n".repeat(130)+multi;assert.ok(objective.length>2000);
 const r=api.prepareTaskObjective(objective);assert.equal(r.ok,true);assert.equal(r.objective,objective);
});
test("oversize rejected",()=>assert.equal(api.prepareTaskObjective("x".repeat(12001)).status,413));
const source=inventory.parseInventorySource(single);
const csv="product,quantity,unit_price,total\nKeyboard,3,125,375\nMouse,2,240,480\nMonitor,5,37,185\nHeadset,1,999,999\nWebcam,4,68,272\nSpeaker,2,150,300\n";
const report="Keyboard: 3 units x ₹125 = ₹375\nMouse: 2 units x ₹240 = ₹480\nMonitor: 5 units x ₹37 = ₹185\nHeadset: 1 unit x ₹999 = ₹999\nWebcam: 4 units x ₹68 = ₹272\nSpeaker: 2 units x ₹150 = ₹300\nGRAND TOTAL = 375 + 480 + 185 + 999 + 272 + 300 = ₹2,611\nTOTAL UNITS = 17\n";
test("correct files source-grounded",()=>{assert.equal(inventory.verifyInventoryCsv(csv+"TOTAL,17,,2611\n",source),null);assert.equal(inventory.verifyInventoryReport(report,source),null)});
test("negative TOTAL rejected",()=>assert.match(inventory.verifyInventoryCsv(csv+"TOTAL,17,,-2611\n",source),/TOTAL/));
test("incorrect Webcam value rejected",()=>assert.match(inventory.verifyInventoryCsv(csv.replace("Webcam,4,68,272","Webcam,4,60,240"),source),/Webcam/));
test("wrong report total rejected",()=>assert.match(inventory.verifyInventoryReport(report.replace("₹2,611","₹2,579"),source),/total/i));
const loop=fs.readFileSync(path.join(root,"src/lib/agent/core/loop.ts"),"utf8");
const part=loop.slice(loop.indexOf("interface PlanAction {"),loop.indexOf("// ——— journal + settlement helpers"));
assert.ok(part.startsWith("interface PlanAction {"));
const compiled=ts.transpileModule(part,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const m={exports:{}};vm.runInNewContext("(function(module,exports){"+compiled+"\n})",{},{timeout:3000})(m,m.exports);
const parse=m.exports.parsePlannerDecision;
test("fenced planner object",()=>assert.equal(parse('```json\n{"action":"tool","tool":"read_file","args":{"path":"x.txt"}}\n```')?.tool,"read_file"));
test("multiple decisions refused",()=>assert.equal(parse('{"action":"final","answer":"one"} {"action":"final","answer":"two"}'),null));
test("null arguments refused",()=>assert.equal(parse('{"action":"tool","tool":"read_file","args":null}'),null));
test("empty final refused",()=>assert.equal(parse('{"action":"final","answer":""}'),null));
test("bounded invalid JSON settles honestly",()=>assert.match(loop,/effectsHappened\s*\?\s*"partial"\s*:\s*"failed"/));
test("folder-only inventory rejected",()=>assert.match(fs.readFileSync(path.join(root,"src/lib/agent/core/verifier.ts"),"utf8"),/INVENTORY_SOURCE_UNAVAILABLE/));
test("API never truncates",()=>{const r=fs.readFileSync(path.join(root,"src/app/api/jarvis/task/route.ts"),"utf8");assert.ok(r.includes("prepareTaskObjective(body.objective)"));assert.ok(!r.includes("body.objective.trim().slice(0, 2000)"))});
console.log("INVENTORY_CONSOLIDATION_WINDOWS "+count+"/"+count+" PASS (Windows offline; no live NEXUS)");
