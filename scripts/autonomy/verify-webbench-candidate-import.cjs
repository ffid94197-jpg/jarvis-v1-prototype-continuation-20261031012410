#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const shards=[1,2,3,4].map(n=>path.join(root,`benchmarks/autonomy/candidates/webbench-open-candidate-${n}.jsonl`));
const expected={total:2647,hard:61,easy:254,unrated:2332};
const seenIds=new Set(),seenPrompts=new Set(),difficulty={};
let total=0,failures=[],urlSchemes={http:0,https:0};
for(const file of shards){
 if(!fs.existsSync(file)){failures.push('missing shard '+path.relative(root,file));continue;}
 const lines=fs.readFileSync(file,'utf8').split(/\r?\n/);
 for(let i=0;i<lines.length;i++){
  if(!lines[i].trim())continue;
  let r;try{r=JSON.parse(lines[i]);}catch(e){failures.push(`${path.basename(file)}:${i+1} invalid JSON`);continue;}
  total++;
  if(!r.record_id||seenIds.has(r.record_id))failures.push('missing/duplicate upstream ID '+r.record_id);
  seenIds.add(r.record_id);
  const prompt=String(r.prompt||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
  if(prompt.length<80||seenPrompts.has(prompt))failures.push('short/duplicate prompt '+r.record_id);
  seenPrompts.add(prompt);
  difficulty[r.difficulty]=(difficulty[r.difficulty]||0)+1;
  if(r.origin?.kind!=='internet_original'||r.origin?.acceptance_eligible!==false)failures.push('candidate incorrectly marked accepted '+r.record_id);
  if(r.verifier_status!=='not_mapped'||r.execution_status!=='candidate_only')failures.push('candidate eligibility metadata mismatch '+r.record_id);
  if(r.source?.name!=='Halluminate/WebBench'||r.source?.license_spdx!=='MIT'||r.source?.repository_revision!=='ea7a1628443321363989f354401f0653e0cba6f4')failures.push('source provenance mismatch '+r.record_id);
  if(/^https:\/\//.test(r.start_url||''))urlSchemes.https++;else if(/^http:\/\//.test(r.start_url||''))urlSchemes.http++;else failures.push('invalid starting URL '+r.record_id);
 }
}
if(total!==expected.total)failures.push(`expected ${expected.total} records, got ${total}`);
for(const k of ['hard','easy','unrated'])if(difficulty[k]!==expected[k])failures.push(`difficulty ${k}: expected ${expected[k]}, got ${difficulty[k]}`);
const report={total,uniqueIds:seenIds.size,uniquePrompts:seenPrompts.size,difficulty,urlSchemes,acceptedInto200k:0,failures:failures.slice(0,50)};
console.log(JSON.stringify(report,null,2));
if(failures.length){console.error('WEBBENCH CANDIDATE IMPORT VALIDATION FAILED');process.exitCode=1;}
else console.log('WEBBENCH CANDIDATE IMPORT VALIDATION PASS (candidate-only; not part of accepted 200K corpus)');
