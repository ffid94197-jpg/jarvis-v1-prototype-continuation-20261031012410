/**
 * Windows-native LIVE JARVIS evaluation, not a mocked planner.
 * Real GitHub Models inference, real Next API SSE, real Guardian, actual disk
 * effects. All outputs stay within runner temp/agent-workspace. No GitHub writes.
 */
import fs from "node:fs/promises";
import fss from "node:fs";
import {spawn} from "node:child_process";
import {createHash} from "node:crypto";
import {join,relative} from "node:path";
import {setTimeout as pause} from "node:timers/promises";
const root=process.cwd(), evidence=join(root,"live-windows-evidence");
const workspace=join(root,"agent-workspace");
const sourceUrl="https://raw.githubusercontent.com/f/prompts.chat/main/prompts.csv";
const expectedDatasetHash="d222868a2eadb38ea4a63f4a4707e0aa82ce6987785940e8c1d2d61b96e21042";
const expectedTaskHash="9276f5938fe8280e0cc39bda1f74b45489f47f97f211478a837ff50968a4a792";
const result={
 version:1,mode:"REAL_CORE_REAL_PROVIDER_REAL_WINDOWS_WORKSPACE",
 objectiveSource:sourceUrl,sourceRow:2323,originalPromptSha256:expectedTaskHash,
 requested:"Production-ready TVS Motor digital showroom, unchanged internet source",
 realModelCalled:false,providerStatus:null,fullRuntimeLaunched:false,
 windowsCompanionListening:false,nexusReady:false,taskApiCalled:false,
 sseFinal:null,sseErrors:[],toolAttempts:[],taskEvents:0,startedAt:new Date().toISOString(),
 artifacts:[],siteVerification:null,notes:[],completed:false
};
const sha=x=>createHash("sha256").update(x).digest("hex");
async function logResult(){await fs.mkdir(evidence,{recursive:true});result.endedAt=new Date().toISOString();await fs.writeFile(join(evidence,"live-windows-result.json"),JSON.stringify(result,null,2)+"\n");}
async function parseRows(input){
 const rows=[];let r=[],field="",quote=false;
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(quote){if(c==='"'&&input[i+1]==='"'){field+='"';i++;}
    else if(c==='"')quote=false;else field+=c;}
  else if(c==='"')quote=true;
  else if(c===","){r.push(field);field="";}
  else if(c==="\n"){r.push(field);if(r.some(v=>v.trim()))rows.push(r);r=[];field="";}
  else if(c!=="\r")field+=c;
 }
 if(quote)throw Error("Source CSV parse failed");
 if(field||r.length){r.push(field);rows.push(r);}
 return rows;
}
async function fetchExactPrompt(){
 const res=await fetch(sourceUrl,{signal:AbortSignal.timeout(90_000)});
 if(!res.ok)throw Error("Public dataset unavailable HTTP "+res.status);
 const bytes=Buffer.from(await res.arrayBuffer());
 const datasetHash=sha(bytes);
 if(datasetHash!==expectedDatasetHash)throw Error("Public dataset changed. Refusing to substitute a new prompt.");
 const rows=await parseRows(bytes.toString("utf8").replace(/^\uFEFF/,""));
 const heads=rows.shift().map(x=>x.trim().toLowerCase());
 const index=heads.indexOf("prompt");
 if(index<0)throw Error("Original dataset prompt column absent");
 const original=rows.map(r=>r[index]).filter(x=>typeof x==="string"&&x.trim().length>=30);
 const prompt=original[2323];
 if(sha(prompt)!==expectedTaskHash)throw Error("Exact sampled external prompt hash mismatch.");
 result.corpusSha256=datasetHash;result.promptChars=prompt.length;result.promptUnmodified=true;
 await fs.mkdir(evidence,{recursive:true});
 await fs.writeFile(join(evidence,"source-prompt.txt"),prompt,"utf8");
 console.log("PUBLIC_PROMPT_VERIFIED datasetSha="+datasetHash+" originalTaskSha="+sha(prompt)+" chars="+prompt.length);
 return prompt;
}
async function probeProvider(){
 const token=process.env.GITHUB_TOKEN;
 if(!token||token.length<20)throw Error("GitHub Actions provider token missing");
 const url="https://models.github.ai/inference/chat/completions";
 const models=["openai/gpt-4.1-mini","openai/gpt-4.1"];
 for(const model of models){
  let response;
  try{
   response=await fetch(url,{method:"POST",headers:{
     "Authorization":"Bearer "+token,"Content-Type":"application/json",
     "Accept":"application/vnd.github+json"},body:JSON.stringify({
     model,messages:[{role:"user",content:"Reply exactly with MODEL_READY"}],max_tokens:32,stream:false
   }),signal:AbortSignal.timeout(45_000)});
  }catch(e){result.notes.push("Provider transport "+String(e?.name||"unknown"));continue;}
  result.providerStatus=response.status;
  if(!response.ok){console.log("MODEL_PROBE_STATUS model="+model+" HTTP="+response.status);continue;}
  let j;try{j=await response.json();}catch{continue;}
  const answer=j?.choices?.[0]?.message?.content;
  if(typeof answer==="string"&&answer.includes("MODEL_READY")){
    result.realModelCalled=true;result.modelId=model;console.log("REAL_MODEL_PROBE_PASS model="+model);
    return model;
  }
 }
 throw Error("No authorized working GitHub Models inference provider: "+result.providerStatus);
}
async function collectFiles(dir,relativePrefix="",depth=0){
 if(depth>9)return [];
 let names;try{names=await fs.readdir(dir,{withFileTypes:true});}catch{return [];}
 const records=[];
 for(const n of names){
  if(records.length>700)break;
  const rel=relativePrefix?relativePrefix+"/"+n.name:n.name;
  const abs=join(dir,n.name);
  if(n.isSymbolicLink()){records.push({path:rel,type:"symlink"});continue;}
  if(n.isDirectory()){
   records.push({path:rel,type:"directory"});
   records.push(...await collectFiles(abs,rel,depth+1));
  }else if(n.isFile()){
   const bytes=await fs.readFile(abs);records.push({path:rel,type:"file",size:bytes.length,sha256:sha(bytes)});
  }
 }
 return records;
}
async function verifySite(files){
 const paths=files.filter(f=>f.type==="file").map(f=>f.path.toLowerCase());
 const has=(re)=>paths.some(x=>re.test(x));
 const verdict={
  realFiles:paths.length,
  frontendPackage:has(/(^|\/)package\.json$/),
  reactCode:has(/\.(tsx|jsx)$/),
  styling:has(/\.(css|scss)$/),
  backendCode:has(/(?:server|backend|api|routes).*\.(ts|js|py)$/),
  databaseSchema:has(/(?:schema\.prisma|migrations|\.sql)$/),
  threeD:has(/(?:three|scene|motorcycle|bike).*\.(tsx|jsx|ts|js)$/),
  originalSourceMaterialized:paths.length>0
 };
 verdict.productionSiteVerified=false; // an artifact inventory is NOT a running production site
 return verdict;
}
async function waitReady(url,timeoutMs){
 const end=Date.now()+timeoutMs;
 while(Date.now()<end){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(2500)});
   if(r.status!==502&&r.status!==503)return {ready:true,status:r.status};}
  catch{}
  await pause(1800);
 }
 return {ready:false};
}
async function streamLiveTask(prompt,abortSignal){
 const response=await fetch("http://127.0.0.1:3000/api/jarvis/task",{
  method:"POST",headers:{"Content-Type":"application/json","Origin":"http://127.0.0.1:3000"},
  body:JSON.stringify({objective:prompt,stepBudget:24}),
  signal:abortSignal
 });
 result.taskApiCalled=true;
 result.taskHttpStatus=response.status;
 if(!response.ok){result.notes.push("Task API rejected HTTP "+response.status);return;}
 const reader=response.body?.getReader();if(!reader)throw Error("No SSE task stream");
 const decoder=new TextDecoder();let buffer="";
 const ingest=segment=>{
  const name=segment.match(/^event:\s*(.*)$/m)?.[1];
  const data=segment.match(/^data:\s*(.*)$/m)?.[1];
  if(!data)return;
  let json;try{json=JSON.parse(data);}catch{return;}
  result.taskEvents++;
  if(name==="final")result.sseFinal={status:json.status,taskId:json.taskId,text:String(json.text||"").slice(0,5000)};
  if(name==="error"&&result.sseErrors.length<30)result.sseErrors.push(String(json.message||"error").slice(0,500));
  if(name==="step"&&result.toolAttempts.length<200){
   const s=json.step||{};
   if(["tool_call","tool_result","guardian_deny","error"].includes(s.kind))
    result.toolAttempts.push({seq:s.seq,kind:s.kind,tool:s.tool,ok:s.ok,
      note:String(s.note||"").slice(0,200),result:String(s.result||"").slice(0,230)});
  }
 };
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   buffer+=decoder.decode(value,{stream:true}).replace(/\r\n/g,"\n");
   let ix;while((ix=buffer.indexOf("\n\n"))>=0){
    const part=buffer.slice(0,ix);buffer=buffer.slice(ix+2);ingest(part);
   }
   if(result.sseFinal)break;
  }
 }finally{reader.releaseLock();}
}
function safeExcerpt(x){return String(x||"").replace(/(Bearer\s+)[^\s]+/gi,"$1[REDACTED]").slice(-10000);}
async function run(){
 if(process.platform!=="win32")throw Error("Not a genuine Windows runner.");
 await fs.mkdir(evidence,{recursive:true});
 const prompt=await fetchExactPrompt();
 const model=await probeProvider();
 const env={...process.env,
  JARVIS_MODEL_BACKEND:"openai-compatible",
  JARVIS_COMPAT_BASE_URL:"https://models.github.ai/inference",
  JARVIS_COMPAT_MODEL:model,
  JARVIS_COMPAT_API_KEY:process.env.GITHUB_TOKEN,
  JARVIS_GOAL_PLANNER_ENABLED:"1",
  JARVIS_AGENT_WORKSPACE:workspace,
  JARVIS_MINECRAFT_LAN_ENABLED:"0",
  JARVIS_SCREEN_WATCH_ENABLED:"0",
  JARVIS_BROWSER_AGENT_ENABLED:"0",
  JARVIS_WINDOWS_UI_CONTROL_ENABLED:"0",
  JARVIS_EXPERIMENTAL_DESKTOP_CONTROL:"0",
  // Use the exact localhost-only owner development contract, never internet exposure.
  JARVIS_LOCAL_DEV_NO_LOGIN:"1",JARVIS_LOCAL_DEV_BIND:"127.0.0.1",
  JARVIS_PUBLIC_ORIGIN:"http://127.0.0.1:3000",
  DATABASE_URL:"file:./jarvis-local-minecraft-test.db",
 };
 // If an unsupported/contaminating configuration is carried from host, it may
 // force login/remote bindings. Fail closed, never override repository security.
 const child=spawn(process.execPath,["scripts/start-windows-agent.mjs"],
  {cwd:root,env,windowsHide:true,stdio:["ignore","pipe","pipe"]});
 result.fullRuntimeLaunched=true;let output="";
 child.stdout.on("data",d=>{output=safeExcerpt(output+d.toString("utf8"));});
 child.stderr.on("data",d=>{output=safeExcerpt(output+d.toString("utf8"));});
 const abort=new AbortController();
 const timeout=setTimeout(()=>abort.abort(),13*60*1000);
 try{
  const app=await waitReady("http://127.0.0.1:3000/api/jarvis/auth/session",180000);
  result.nexusReady=app.ready;result.authStatus=app.status;
  const companion=await waitReady("http://127.0.0.1:20189/health",3000);
  result.windowsCompanionListening=companion.ready;
  console.log("ACTUAL_WIN_RUNTIME nexus="+app.ready+" companion="+companion.ready+" authHTTP="+app.status);
  if(!app.ready)throw Error("NEXUS never became ready. Actual full Windows runtime startup failed.");
  // Do not pretend a hosted runner can emulate an interactive owner desktop.
  result.notes.push("GitHub Windows hosted runner uses a service session, not the user's Lenovo LOQ interactive desktop.");
  await streamLiveTask(prompt,abort.signal);
  const produced=await collectFiles(workspace);
  result.artifacts=produced.slice(0,800);
  result.siteVerification=await verifySite(produced);
  console.log("REAL_TASK_OBSERVED final="+(result.sseFinal?.status||"none")+
    " events="+result.taskEvents+" tools="+result.toolAttempts.length+
    " files="+result.siteVerification.realFiles);
  result.completed=Boolean(result.sseFinal?.status==="completed"&&result.siteVerification.productionSiteVerified);
  // No pass by self-declaration: full external prompt demands a real running site.
  if(!result.completed)throw Error("FULL_AUTONOMOUS_PRODUCTION_SITE_NOT_VERIFIED");
 }finally{
  clearTimeout(timeout);
  result.runtimeLogExcerpt=safeExcerpt(output);
  try{child.kill("SIGTERM");}catch{}
  await pause(2000);
  try{if(child.exitCode===null)child.kill("SIGKILL");}catch{}
 }
}
try{await run();}
catch(e){result.failure=String(e?.message||e);console.error("LIVE_WINDOWS_JARVIS_ACCEPTANCE_FAILED",result.failure);process.exitCode=1;}
finally{await logResult();console.log("LIVE_WINDOWS_EVIDENCE="+join(evidence,"live-windows-result.json"));}
