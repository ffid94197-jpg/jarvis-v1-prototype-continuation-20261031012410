#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const script=path.join(__dirname,'validate-internet-corpus.cjs');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-corpus-validator-'));
const hash=s=>crypto.createHash('sha256').update(s,'utf8').digest('hex');
function record(i,prompt){
 return {
  id:'fixture:'+i,prompt,domain:'windows_desktop',difficulty:'very_hard',risk_class:'safe',
  origin:{kind:'internet_original'},
  source:{name:'fixture-source',record_id:String(i),url:'https://example.org/tasks/'+i,
   dataset_url:'https://example.org/dataset',revision:'a'.repeat(40),license_spdx:'CC0-1.0',
   license_url:'https://example.org/license',raw_prompt_sha256:hash(prompt)},
  environment:{kind:'fixture',setup_ref:'fixture-image@sha256:'+'b'.repeat(64)},
  verifier:{kind:'filesystem_state',spec:'Check the exact expected file state using a separate verifier.',independent:true}
 };
}
function run(rows,expected){
 const input=path.join(tmp,'corpus.jsonl'),manifest=path.join(tmp,'manifest.json');
 fs.writeFileSync(input,rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
 return spawnSync(process.execPath,[script,'--input',input,'--expected',String(expected),'--manifest',manifest],{encoding:'utf8'});
}
let failures=0;
function check(ok,label,detail=''){if(ok)console.log('PASS',label);else{failures++;console.error('FAIL',label,detail);}}
try{
 const valid=[record(1,'Create a complex report from multiple source files and independently verify every requested value.'),record(2,'Reconcile conflicting records across two applications and save a validated result with an audit trail.'),record(3,'Recover a partially completed multi-step task after a restart without duplicating any external effect.')];
 let r=run(valid,3);check(r.status===0,'valid original-source corpus accepted',r.stderr);
 r=run([valid[0],{...valid[1],id:'dup-id'},valid[2]],3);check(r.status!==0,'duplicate upstream record rejected',r.stderr);
 r=run([valid[0],{...valid[1],difficulty:'medium'},valid[2]],3);check(r.status!==0,'non-very-hard task rejected',r.stderr);
 r=run([valid[0],{...valid[1],prompt:valid[0].prompt,id:'dup-prompt'},valid[2]],3);check(r.status!==0,'duplicate prompt rejected',r.stderr);
 r=run([valid[0],{...valid[1],source:{...valid[1].source,raw_prompt_sha256:'0'.repeat(64)}},valid[2]],3);check(r.status!==0,'modified prompt hash rejected',r.stderr);
 r=run([valid[0],{...valid[1],verifier:{kind:'filesystem_state',spec:'Model says it is done.',independent:false}},valid[2]],3);check(r.status!==0,'model-authored completion is not an independent verifier',r.stderr);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
console.log(`CORPUS VALIDATOR SELF-TEST: ${6-failures}/6 PASS`);
if(failures)process.exitCode=1;
