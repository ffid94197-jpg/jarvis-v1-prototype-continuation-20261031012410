#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const file=path.resolve(__dirname,'../../benchmarks/autonomy/candidates/windows-agent-arena-diverse-12.jsonl');
const rows=fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const failures=[];
const ids=new Set(),prompts=new Set(),apps=new Set();
for(const r of rows){
 if(!r.record_id||ids.has(r.record_id))failures.push('missing/duplicate id '+r.record_id);ids.add(r.record_id);
 const p=String(r.prompt||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
 if(p.length<30||prompts.has(p))failures.push('missing/duplicate prompt '+r.record_id);prompts.add(p);
 if(!r.evaluator||!r.verifier_status?.startsWith('raw_evaluator'))failures.push('missing raw evaluator '+r.record_id);
 if(r.origin?.kind!=='internet_original'||r.origin?.acceptance_eligible!==false)failures.push('candidate incorrectly accepted '+r.record_id);
 if(r.source?.name!=='microsoft/WindowsAgentArena'||r.source?.license_spdx!=='MIT'||r.source?.revision!=='eb220c4dcf64babefc1bfc287edda91ab04132ed')failures.push('source provenance mismatch '+r.record_id);
 if(r.environment?.kind!=='windows_vm_snapshot')failures.push('missing Windows environment '+r.record_id);
 for(const a of r.related_apps||[])apps.add(a);
}
if(rows.length!==12)failures.push('expected 12 diverse task records; got '+rows.length);
const summary={records:rows.length,uniqueIds:ids.size,uniquePrompts:prompts.size,withRawEvaluator:rows.filter(x=>x.evaluator).length,apps:[...apps].sort(),acceptedInto200k:0,failures};
console.log(JSON.stringify(summary,null,2));
if(failures.length){console.error('WINDOWS AGENT ARENA CANDIDATE VALIDATION FAILED');process.exitCode=1;}
else console.log('WINDOWS AGENT ARENA CANDIDATE VALIDATION PASS (raw evaluator retained; candidate-only)');
