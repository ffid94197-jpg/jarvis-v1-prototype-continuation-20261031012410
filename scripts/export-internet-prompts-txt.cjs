"use strict";
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");
const sourceUrl="https://raw.githubusercontent.com/f/prompts.chat/main/prompts.csv";
const originalHash="d222868a2eadb38ea4a63f4a4707e0aa82ce6987785940e8c1d2d61b96e21042";
const expectedRun=41222234176;
const evidencePath=path.resolve("sample-evidence","internet-prompts-10min.json");
const outDir=path.resolve("prompt-export");
function sha(bytes){return crypto.createHash("sha256").update(bytes).digest("hex");}
function parseCSV(input){
  const rows=[];let current=[],field="",quoted=false;
  const push=()=>{current.push(field);field="";if(current.some(x=>x.trim()))rows.push(current);current=[];};
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(quoted){
      if(ch==='"'&&input[i+1]==='"'){field+='"';i++;}
      else if(ch==='"')quoted=false;
      else field+=ch;
    }else if(ch==='"'){quoted=true;}
    else if(ch===","){current.push(field);field="";}
    else if(ch==="\n"){push();}
    else if(ch!=="\r"){field+=ch;}
  }
  if(quoted)throw Error("Unterminated quoted field");
  if(field||current.length)push();
  return rows;
}
async function main(){
  const report=JSON.parse(fs.readFileSync(evidencePath,"utf8"));
  if(report.source!==sourceUrl||report.corpus?.sha256!==originalHash
    ||report.totalFailures!==0||report.elapsedSeconds<600
    ||report.iterations!==22864||report.uniquePromptCount!==2790)
      throw Error("Expected original validated stress run evidence missing or mismatched");
  const response=await fetch(sourceUrl,{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error("Failed to retrieve original dataset: HTTP "+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(sha(bytes)!==originalHash)
    throw Error("Original 10-minute test dataset SHA256 changed: cannot recreate its source pool faithfully");
  const csv=parseCSV(bytes.toString("utf8").replace(/^\uFEFF/,""));
  const header=csv.shift().map(x=>x.toLowerCase().trim());
  const promptIndex=header.findIndex(x=>x==="prompt");
  if(promptIndex<0)throw Error("Missing prompt CSV column");
  const prompts=csv.map(r=>r[promptIndex]).filter(p=>typeof p==="string"&&p.trim().length>=30);
  if(prompts.length!==2792)throw Error("Source pool row count differs from original stress test");
  const samples=report.randomSampleHashes;
  if(!Array.isArray(samples)||samples.length!==32)
    throw Error("Missing first 32 selected prompt hashes in original run evidence");
  const selections=[];
  for(let i=0;i<samples.length;i++){
    const entry=samples[i];
    if(!Number.isInteger(entry.row)||entry.row<0||entry.row>=prompts.length)
      throw Error("Invalid random sample row "+i);
    const prompt=prompts[entry.row];
    if(sha(Buffer.from(prompt,"utf8"))!==entry.sha256)
      throw Error("Original sample hash mismatch at draw "+(i+1));
    selections.push({draw:i+1,row:entry.row,prompt,sha256:entry.sha256});
  }
  fs.mkdirSync(outDir,{recursive:true});
  const head=[
    "JARVIS — ORIGINAL INTERNET PROMPT SOURCE POOL (TXT)",
    "Source: "+sourceUrl,
    "Original Windows test run: "+expectedRun,
    "Original dataset SHA-256: "+originalHash,
    "License: CC0 1.0 Universal — https://github.com/f/prompts.chat",
    "Source-pool prompts: "+prompts.length,
    "Distinct randomly sampled in 10-minute test: "+report.uniquePromptCount,
    "Total random selections during 600-second test: "+report.iterations,
    "",
    "IMPORTANT: The run recorded the first 32 random choices and aggregate counts,",
    "but not all 22864 selections or the identities of the two unsampled prompts.",
    "This document is the COMPLETE ORIGINAL SOURCE POOL, not the precise",
    "chronological selection sequence. All text below comes from the downloaded CSV.",
    "------------------------------------------------------------",
    ""
  ];
  const full=head.concat(prompts.flatMap((text,i)=>[
    "==== SOURCE ROW "+i+" ====",
    text,
    "==== END ROW "+i+" ====",
    ""
  ])).join("\n");
  fs.writeFileSync(path.join(outDir,"complete-original-prompt-pool.txt"),full,"utf8");
  const h2=[
    "JARVIS — FIRST 32 RECORDED RANDOM PROMPTS (VERIFIED FROM TEST EVIDENCE)",
    "Run: "+expectedRun,
    "Test duration (seconds): "+report.elapsedSeconds,
    "Source dataset SHA-256: "+originalHash,
    "Each prompt hash was checked against the downloaded CSV row.",
    ""
  ];
  const first32=h2.concat(selections.flatMap(e=>[
    "==== SAMPLE "+e.draw+" | SOURCE ROW "+e.row+" | SHA256 "+e.sha256+" ====",
    e.prompt,
    "==== END SAMPLE "+e.draw+" ====",
    ""
  ])).join("\n");
  fs.writeFileSync(path.join(outDir,"first-32-recorded-sampled-prompts.txt"),first32,"utf8");
  const readme=[
    "PROMPTS USED IN JARVIS 10-MINUTE RANDOM INTERNET TEST",
    "",
    "Recorded original test: "+expectedRun,
    "Source dataset: "+sourceUrl,
    "Dataset SHA-256: "+originalHash,
    "Public domain: CC0 1.0 Universal.",
    "Tested 22864 selections over "+report.elapsedSeconds+" seconds with zero assertion failures.",
    "Randomly sampled 2790 distinct entries out of 2792 eligible prompts.",
    "",
    "FILES:",
    "first-32-recorded-sampled-prompts.txt: Exact first 32 prompts verified against",
    "the run artifact's stored row indices and SHA-256 hashes.",
    "complete-original-prompt-pool.txt: All 2792 eligible source prompts.",
    "",
    "LIMITATION:",
    "The original test did not save the ordered list of all 22864 selections.",
    "The identity of the two source prompts not selected is also unknown.",
    "The whole pool is provided so you can inspect the prompts the tester sampled from.",
    "",
    "These were tested as read-only inputs to Core parsing/intent logic, not",
    "as 22864 autonomous executions against a live model or desktop."
  ].join("\n")+"\n";
  fs.writeFileSync(path.join(outDir,"READ-ME-FIRST.txt"),readme,"utf8");
  console.log("TXT_PROMPT_EXPORT_PASS sourceRows="+prompts.length+
    " exactRecordedSamples="+selections.length+
    " uniqueSampled="+report.uniquePromptCount+
    " originalSelections="+report.iterations+
    " hash="+originalHash);
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1});
