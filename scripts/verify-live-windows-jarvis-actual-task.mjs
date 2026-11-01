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
 sseFinal:null,sseErrors:[],toolAttempts:[],taskEvents:0,taskRuns:[],startedAt:new Date().toISOString(),
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
 // Pinned from the original public CSV and prior SHA-verified Windows test
 // artifact (run 41230393594). Never silently swap in a newer CSV row:
 // the internet dataset is mutable and changed after the original test.
 const fixtureB64=await fs.readFile(join(root,"scripts/fixtures/original-tvs-digital-showroom-prompt.b64"),"utf8");
 const bytes=Buffer.from(fixtureB64.trim(),"base64");
 if(sha(bytes)!==expectedTaskHash)throw Error("Archived external prompt SHA-256 differs; refusing task substitution.");
 const prompt=bytes.toString("utf8");
 if(Buffer.byteLength(prompt,"utf8")!==bytes.length)throw Error("Original source cannot be decoded losslessly.");
 result.corpusSha256=expectedDatasetHash;
 result.originalPromptSha256=sha(bytes);
 result.promptChars=prompt.length;result.promptUnmodified=true;
 result.originalSnapshot="Archived public dataset prompt, reproduced from prior successful Windows test artifact 41230393594";
 await fs.mkdir(evidence,{recursive:true});
 await fs.writeFile(join(evidence,"source-prompt.txt"),prompt,"utf8");
 console.log("PUBLIC_PROMPT_VERIFIED archivedSourceSha="+expectedTaskHash+" chars="+prompt.length);
 return prompt;
}
async function fetchLatestDatasetForReferenceOnly(){
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
  const content=j?.choices?.[0]?.message?.content;
  const answer=typeof content==="string"?content:
    Array.isArray(content)?content.filter(x=>x?.type==="text"&&typeof x.text==="string").map(x=>x.text).join(""):"";
  console.log("MODEL_PROBE_SHAPE model="+model+" answerType="+typeof content+
    " answerLength="+answer.length+" choices="+(Array.isArray(j?.choices)?j.choices.length:0));
  // A 200 reply is not enough; require a complete, actual nonempty model response.
  // Verbatim sentinel compliance is not required for this model connectivity test.
  if(answer.trim().length>=3){
    result.realModelCalled=true;result.modelId=model;result.modelProbeResponseSha256=sha(answer);
    console.log("REAL_MODEL_PROBE_PASS model="+model+" chars="+answer.length);
    return model;
  }
 }
 throw Error("No authorized working GitHub Models inference provider: "+result.providerStatus);
}
async function probeLocalOllama(){
 const model=process.env.JARVIS_OLLAMA_MODEL||"qwen2.5-coder:3b";
 const res=await fetch("http://127.0.0.1:11434/api/chat",{
   method:"POST",
   headers:{"Content-Type":"application/json"},
   body:JSON.stringify({model,messages:[{role:"user",content:"Reply READY"}],stream:false,options:{num_predict:24}}),
   signal:AbortSignal.timeout(120000)
 });
 result.providerStatus=res.status;
 if(!res.ok)throw Error("Ollama local inference HTTP "+res.status);
 const j=await res.json();
 const answer=j?.message?.content;
 if(typeof answer!=="string"||!answer.trim())throw Error("Local Ollama returned no model-generated response");
 result.realModelCalled=true;result.modelId=model;result.modelProbeResponseSha256=sha(answer);
 result.notes.push("Real Windows local Ollama model inference returned "+answer.length+" characters.");
 console.log("REAL_LOCAL_MODEL_PASS model="+model+" responseChars="+answer.length);
 return model;
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
function safeProjectEnv(){
 return {PATH:process.env.PATH||"",SystemRoot:process.env.SystemRoot||"",WINDIR:process.env.WINDIR||"",
  TEMP:process.env.TEMP||workspace,TMP:process.env.TMP||workspace,HOME:workspace,USERPROFILE:workspace,
  APPDATA:join(workspace,".appdata"),LOCALAPPDATA:join(workspace,".local"),
  npm_config_cache:join(workspace,".npm-cache"),CI:"1",NODE_ENV:"development"};
}
async function killProcessTree(pid){
 if(!pid)return;
 await new Promise(resolve=>{
  let finished=false,timer;
  const done=()=>{if(finished)return;finished=true;if(timer)clearTimeout(timer);resolve();};
  const killer=spawn("taskkill.exe",["/PID",String(pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});
  timer=setTimeout(done,5000);killer.once("close",done);killer.once("error",done);
 });
}
function runFixedNpm(command,timeoutMs=600000){
 return new Promise(resolve=>{
  const child=spawn(process.env.ComSpec||"cmd.exe",["/d","/s","/c",command],{
   cwd:workspace,env:safeProjectEnv(),windowsHide:true,stdio:["ignore","pipe","pipe"]});
  let stdout="",stderr="",timedOut=false,finished=false,timer;
  const append=(old,data)=>(old+data.toString("utf8")).slice(-5000);
  const finish=code=>{if(finished)return;finished=true;if(timer)clearTimeout(timer);
   resolve({ok:!timedOut&&code===0,code,timedOut,stdout,stderr});};
  child.stdout.on("data",d=>{stdout=append(stdout,d);});
  child.stderr.on("data",d=>{stderr=append(stderr,d);});
  child.once("error",()=>finish(-1));child.once("close",code=>finish(code));
  timer=setTimeout(()=>{timedOut=true;void killProcessTree(child.pid).finally(()=>finish(-1));},timeoutMs);
 });
}
async function verifyPreview(){
 const child=spawn(process.env.ComSpec||"cmd.exe",["/d","/s","/c","npm run preview -- --host 127.0.0.1 --port 4173"],{
  cwd:workspace,env:safeProjectEnv(),windowsHide:true,stdio:["ignore","ignore","pipe"]});
 let stderr="";child.stderr.on("data",d=>{stderr=(stderr+d.toString("utf8")).slice(-3000);});
 let observed=null;const deadline=Date.now()+30000;
 while(Date.now()<deadline){
  try{
   const response=await fetch("http://127.0.0.1:4173/",{signal:AbortSignal.timeout(2500)});
   const body=await response.text(),contentType=response.headers.get("content-type")||"";
   if(response.status===200&&/text\/html/i.test(contentType)){
    observed={status:response.status,contentType,htmlHasTVS:/TVS/i.test(body),htmlBytes:Buffer.byteLength(body,"utf8")};break;
   }
  }catch{}
  await pause(900);
 }
 await killProcessTree(child.pid);
 if(child.exitCode===null){try{child.kill("SIGKILL");}catch{}}
 return {ok:Boolean(observed&&observed.htmlHasTVS),...(observed||{}),stderr};
}
async function verifySite(files,before){
 const beforeMap=new Map(before.filter(x=>x.type==="file").map(x=>[x.path,x.sha256]));
 const created=files.filter(f=>f.type==="file"&&beforeMap.get(f.path)!==f.sha256);
 const paths=created.map(f=>f.path.toLowerCase()),has=re=>paths.some(x=>re.test(x));
 const packagePath=join(workspace,"package.json");let packageJson=null,packageError=null;
 if(fss.existsSync(packagePath)){try{packageJson=JSON.parse(await fs.readFile(packagePath,"utf8"));}catch(e){packageError=String(e?.message||e);}}
 const scripts=packageJson?.scripts&&typeof packageJson.scripts==="object"?packageJson.scripts:{};
 const verdict={
  realFiles:paths.length,existingBaselineFileCount:before.filter(f=>f.type==="file").length,
  changedFileHashes:created.map(f=>({path:f.path,sha256:f.sha256})),
  frontendPackage:has(/(^|\/)package\.json$/),reactCode:has(/\.(tsx|jsx)$/),styling:has(/\.(css|scss)$/),
  backendCode:has(/(?:server|backend|api|routes).*\.(ts|js|py)$/),
  databaseSchema:has(/(?:schema\.prisma|migrations|\.sql)$/),
  threeD:has(/(?:three|scene|motorcycle|bike).*\.(tsx|jsx|ts|js)$/),
  originalSourceMaterialized:paths.length>0,
  packageScripts:{build:typeof scripts.build==="string",test:typeof scripts.test==="string",preview:typeof scripts.preview==="string"},
  packageJsonError:packageError,dependencyInstall:null,build:null,tests:null,preview:null,
  frontendBuildVerified:false,postgresRuntimeVerified:false,productionSiteVerified:false
 };
 if(packageJson&&verdict.packageScripts.build&&verdict.packageScripts.preview){
  const hasLock=fss.existsSync(join(workspace,"package-lock.json"));
  verdict.dependencyInstall=await runFixedNpm(hasLock?
   "npm ci --no-audit --no-fund --ignore-scripts":"npm install --no-audit --no-fund --ignore-scripts",600000);
  if(verdict.dependencyInstall.ok){
   verdict.build=await runFixedNpm("npm run build",600000);
   if(verdict.build.ok){
    verdict.tests=verdict.packageScripts.test?await runFixedNpm("npm run test",300000):
     {ok:false,skipped:true,reason:"package.json has no test script"};
    verdict.preview=await verifyPreview();
   }
  }
 }
 verdict.frontendBuildVerified=Boolean(verdict.frontendPackage&&verdict.reactCode&&verdict.styling&&
  verdict.dependencyInstall?.ok&&verdict.build?.ok&&verdict.tests?.ok&&verdict.preview?.ok);
 // This runner does not start a PostgreSQL service; a schema file is not DB integration proof.
 verdict.productionSiteVerified=Boolean(verdict.frontendBuildVerified&&verdict.backendCode&&
  verdict.databaseSchema&&verdict.threeD&&verdict.postgresRuntimeVerified);
 verdict.reason="PostgreSQL runtime integration is unverified: this Windows hosted-runner test did not start a real PostgreSQL service.";
 return verdict;
}
async function waitReady(url,timeoutMs){
 const end=Date.now()+timeoutMs;
 while(Date.now()<end){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(2500)});
   if(r.status!==502&&r.status!==503)return {ready:true,status:r.status,sessionCookie:r.headers.get("set-cookie")?.split(";")[0]||null};}
  catch{}
  await pause(1800);
 }
 return {ready:false};
}
async function streamLiveTask(prompt,abortSignal,sessionCookie,options={}){
 const stepBudget=Number.isInteger(options.stepBudget)?options.stepBudget:36;
 const payload=options.resumeTaskId?{resumeTaskId:options.resumeTaskId,stepBudget}:{objective:prompt,stepBudget};
 const response=await fetch("http://127.0.0.1:3000/api/jarvis/task",{
  method:"POST",headers:{"Content-Type":"application/json","Origin":"http://127.0.0.1:3000","Cookie":sessionCookie},
  body:JSON.stringify(payload),signal:abortSignal});
 result.taskApiCalled=true;result.taskHttpStatus=response.status;
 if(!response.ok){
  let detail="";try{const j=await response.json();detail=String(j?.code||j?.error||"").slice(0,180);}catch{}
  result.notes.push("Task API rejected HTTP "+response.status+" "+detail);
  console.log("REAL_TASK_API_REJECTED status="+response.status+" reason="+detail);
  result.taskRuns.push({taskId:options.resumeTaskId||null,status:"api-rejected",stepBudget,httpStatus:response.status,reason:detail});
  return {final:null,httpStatus:response.status,taskId:options.resumeTaskId||null};
 }
 const reader=response.body?.getReader();if(!reader)throw Error("No SSE task stream");
 const decoder=new TextDecoder();let buffer="",finalEvent=null;
 const ingest=segment=>{
  const name=segment.match(/^event:\s*(.*)$/m)?.[1],data=segment.match(/^data:\s*(.*)$/m)?.[1];
  if(!data)return;let json;try{json=JSON.parse(data);}catch{return;}
  result.taskEvents++;
  if(name==="final"){finalEvent={status:json.status,taskId:json.taskId,text:String(json.text||"").slice(0,5000)};result.sseFinal=finalEvent;}
  if(name==="error"&&result.sseErrors.length<30)result.sseErrors.push(String(json.message||"error").slice(0,500));
  if(name==="step"&&result.toolAttempts.length<300){
   const step=json.step||{};
   if(["tool_call","tool_result","guardian_deny","error"].includes(step.kind))
    result.toolAttempts.push({seq:step.seq,kind:step.kind,tool:step.tool,ok:step.ok,
     note:String(step.note||"").slice(0,200),result:String(step.result||"").slice(0,230)});
  }
 };
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   buffer+=decoder.decode(value,{stream:true}).replace(/\r\n/g,"\n");
   let ix;while((ix=buffer.indexOf("\n\n"))>=0){const part=buffer.slice(0,ix);buffer=buffer.slice(ix+2);ingest(part);}
   if(finalEvent)break;
  }
 }finally{reader.releaseLock();}
 const taskId=finalEvent?.taskId||options.resumeTaskId||null;
 result.taskRuns.push({taskId,status:finalEvent?.status||"no-final",stepBudget,httpStatus:response.status});
 return {final:finalEvent,httpStatus:response.status,taskId};
}
function safeExcerpt(x){return String(x||"").replace(/(Bearer\s+)[^\s]+/gi,"$1[REDACTED]").slice(-10000);}
async function run(){
 if(process.platform!=="win32")throw Error("Not a genuine Windows runner.");
 await fs.mkdir(evidence,{recursive:true});
 const prompt=await fetchExactPrompt();
 const initialWorkspace=await collectFiles(workspace);
 result.initialWorkspaceFiles=initialWorkspace.filter(f=>f.type==="file").length;
 const useLocalModel=process.env.JARVIS_LIVE_LOCAL_MODEL==="1";
 const model=useLocalModel?await probeLocalOllama():await probeProvider();
 const env={...process.env,
  JARVIS_MODEL_BACKEND:useLocalModel?"ollama":"openai-compatible",
  JARVIS_OLLAMA_MODEL:useLocalModel?model:"",
  JARVIS_OLLAMA_BASE_URL:"http://127.0.0.1:11434",
  JARVIS_COMPAT_BASE_URL:"https://models.github.ai/inference",
  JARVIS_COMPAT_MODEL:model,
  JARVIS_COMPAT_API_KEY:process.env.GITHUB_TOKEN,
  JARVIS_GOAL_PLANNER_ENABLED:"1",
  JARVIS_AGENT_WORKSPACE:workspace,
  JARVIS_MINECRAFT_LAN_ENABLED:"0",
  JARVIS_SCREEN_WATCH_ENABLED:"0",
  JARVIS_BROWSER_AGENT_ENABLED:"0",
  JARVIS_WINDOWS_UI_CONTROL_ENABLED:"0",
  JARVIS_EXPERIMENTAL_DESKTOP_CONTROL:"1",
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
 const timeout=setTimeout(()=>abort.abort(),42*60*1000);
 try{
  const app=await waitReady("http://127.0.0.1:3000/api/jarvis/auth/session",180000);
  result.nexusReady=app.ready;result.authStatus=app.status;
  const sessionCookie=app.sessionCookie;
  result.localOwnerSessionIssued=typeof sessionCookie==="string"&&sessionCookie.startsWith("jarvis_session=");
  if(!result.localOwnerSessionIssued)throw Error("Local authenticated session cookie not issued; refusing unauthenticated task POST.");
  const companion=await waitReady("http://127.0.0.1:20189/health",3000);
  result.windowsCompanionListening=companion.ready;
  console.log("ACTUAL_WIN_RUNTIME nexus="+app.ready+" companion="+companion.ready+" authHTTP="+app.status);
  if(!app.ready)throw Error("NEXUS never became ready. Actual full Windows runtime startup failed.");
  // Do not pretend a hosted runner can emulate an interactive owner desktop.
  result.notes.push("GitHub Windows hosted runner uses a service session, not the user's Lenovo LOQ interactive desktop.");
   let taskRun=await streamLiveTask(prompt,abort.signal,sessionCookie,{stepBudget:36});
   if(taskRun.final?.status==="paused"&&taskRun.taskId){
    taskRun=await streamLiveTask(null,abort.signal,sessionCookie,{resumeTaskId:taskRun.taskId,stepBudget:12});
   }
   let produced=await collectFiles(workspace);
   let siteVerification=await verifySite(produced,initialWorkspace);
   const needsRepair=Boolean(!siteVerification.frontendBuildVerified||
    !siteVerification.backendCode||!siteVerification.databaseSchema||!siteVerification.threeD);
   if(needsRepair&&taskRun.final){
    const report={
     missing:Object.entries({
      frontendPackage:siteVerification.frontendPackage,reactCode:siteVerification.reactCode,
      styling:siteVerification.styling,backendCode:siteVerification.backendCode,
      databaseSchema:siteVerification.databaseSchema,threeD:siteVerification.threeD
     }).filter(entry=>!entry[1]).map(entry=>entry[0]),
     dependencyInstall:siteVerification.dependencyInstall?.ok??false,
     installError:String(siteVerification.dependencyInstall?.stderr||siteVerification.dependencyInstall?.stdout||"").slice(-500),
     buildOk:siteVerification.build?.ok??false,
     buildError:String(siteVerification.build?.stderr||siteVerification.build?.stdout||"").slice(-900),
     testsOk:siteVerification.tests?.ok??false,
     previewOk:siteVerification.preview?.ok??false,
     previewError:String(siteVerification.preview?.stderr||"").slice(-300)
    };
    const repairPrompt=[
     "Continue and finish the existing TVS Motor digital showroom in the current isolated workspace. Preserve valid files and inspect them before editing.",
     "ORIGINAL TASK REQUIREMENTS (verbatim):",
     prompt,
     "INDEPENDENT VERIFIER REPORT (factual diagnostics, not permission to weaken Guardian):",
     JSON.stringify(report),
     "Repair the actual missing or broken implementation. Do not create placeholders, do not overwrite working code without reason, and do not claim success unless the required project files and runtime checks genuinely pass."
    ].join("\n");
    result.notes.push("A bounded second real-model repair task was submitted with independent build/HTTP diagnostics.");
    taskRun=await streamLiveTask(repairPrompt,abort.signal,sessionCookie,{stepBudget:24});
    if(taskRun.final?.status==="paused"&&taskRun.taskId){
     taskRun=await streamLiveTask(null,abort.signal,sessionCookie,{resumeTaskId:taskRun.taskId,stepBudget:12});
    }
    produced=await collectFiles(workspace);
    siteVerification=await verifySite(produced,initialWorkspace);
   }
   result.artifacts=produced.slice(0,800);
   result.siteVerification=siteVerification;
   console.log("REAL_TASK_OBSERVED http="+(result.taskHttpStatus??"none")+" final="+(result.sseFinal?.status||"none")+
    " taskRuns="+result.taskRuns.length+" events="+result.taskEvents+" tools="+result.toolAttempts.length+
    " files="+result.siteVerification.realFiles+" frontendBuild="+result.siteVerification.frontendBuildVerified+
    " postgres="+result.siteVerification.postgresRuntimeVerified);
   result.completed=Boolean(result.sseFinal?.status==="completed"&&result.siteVerification.productionSiteVerified);
   // No pass by self-declaration: require real files, independent build/test/HTTP,
   // backend/schema/3D artifacts and a live PostgreSQL integration check.
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
