/**
 * PROTOTYPE ONLY: CI runner project build bridge.
 *
 * No general shell command is exposed. Disabled on owner PCs by default.
 * Runs untrusted generated project code ONLY on an explicitly enabled
 * disposable native Windows GitHub Actions runner with workspace inside
 * RUNNER_TEMP. The runner is the isolation boundary, NOT this process.
 * This is not LPAC, AppContainer, signing or production security certification.
 */
import fs from "fs/promises";
import path from "path";
import { execFile, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import { resolveScopedPath, assertWithinRoot, WORKSPACE_ROOT } from "../guardian/policy";

export type CIProjectAction = "install" | "build";
export interface CIProjectPrepared { action: CIProjectAction; abs: string; rel: string; }
export interface CIProjectDecision { ok: boolean; reason?: string; prepared?: CIProjectPrepared; }

const START_FLAG = "JARVIS_CI_PROJECT_BUILD_ENABLED";
function within(parent:string, child:string):boolean {
  const relative=path.relative(parent,child);
  return relative!=="" && relative!==".." && !relative.startsWith(".."+path.sep) && !path.isAbsolute(relative);
}

export async function prepareCIProjectBuild(args:Record<string,unknown>):Promise<CIProjectDecision> {
  if (process.platform!=="win32" || process.env.GITHUB_ACTIONS!=="true" ||
      process.env.RUNNER_OS!=="Windows" || process.env[START_FLAG]!=="1")
    return {ok:false,reason:"CI project build disabled outside explicitly authorized disposable native Windows runner"};
  if (args.action!=="install" && args.action!=="build")
    return {ok:false,reason:"Only structured install/build actions are supported"};
  const rel=resolveScopedPath(args.project);
  if (!rel.ok || !rel.abs || !rel.rel) return {ok:false,reason:rel.reason??"Invalid project path"};
  if (!process.env.RUNNER_TEMP) return {ok:false,reason:"Runner temp root missing"};
  try {
    const temp=await fs.realpath(process.env.RUNNER_TEMP);
    const work=await fs.realpath(WORKSPACE_ROOT);
    if (!within(temp,work)) return {ok:false,reason:"Agent workspace is not inside isolated CI runner temp"};
    const boundary=await assertWithinRoot(rel.abs);
    if(!boundary.ok) return {ok:false,reason:boundary.reason??"Project path is out of scope"};
    const actual=await fs.realpath(rel.abs);
    const stat=await fs.lstat(rel.abs);
    if(!within(work,actual) || !stat.isDirectory() || stat.isSymbolicLink())
      return {ok:false,reason:"Project must be a real directory strictly within agent workspace"};
    const packageFile=path.join(actual,"package.json");
    const pkgStat=await fs.lstat(packageFile);
    if(!pkgStat.isFile() || pkgStat.isSymbolicLink())
      return {ok:false,reason:"Project requires a regular package.json"};
    if(args.action==="install"){
      const lockStat=await fs.lstat(path.join(actual,"package-lock.json"));
      if(!lockStat.isFile() || lockStat.isSymbolicLink())
        return {ok:false,reason:"Install requires a regular committed package-lock.json"};
    }
    if(args.action==="build"){
      const cli=await fs.realpath(path.join(actual,"node_modules","vite","bin","vite.js"));
      if(!within(actual,cli)) return {ok:false,reason:"Vite CLI escapes project scope"};
    }
    return {ok:true,prepared:{action:args.action,abs:actual,rel:rel.rel}};
  } catch {
    return {ok:false,reason:"Project prerequisites unavailable or unverified"};
  }
}

export interface CIProjectResult {
 ok:boolean; tool:string; evidence:string; detail?:Record<string,unknown>; error?:string;
}
export async function executeCIProjectBuild(
  prepared:CIProjectPrepared,
  isCancelled:()=>boolean,
  register:(child:ChildProcess)=>void
):Promise<CIProjectResult> {
 const tool="ci_project_build";
 if(isCancelled())return {ok:false,tool,evidence:"",error:"Task cancelled before CI project build"};
 // Use a minimal, non-secret environment. The project must run in a disposable
 // VM; generated Vite configs may still execute arbitrary JS within that VM.
 const env:NodeJS.ProcessEnv={};
 for(const key of ["PATH","SystemRoot","WINDIR","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA"])
   if(process.env[key])env[key]=process.env[key];
 env.HOME=prepared.abs;
 env.CI="1";
 env.NODE_ENV="production";
 env.GIT_TERMINAL_PROMPT="0";
 env.npm_config_audit="false";
 env.npm_config_fund="false";
 env.npm_config_cache=path.join(prepared.abs,".npm-cache");
 const install=prepared.action==="install";
 const binary=install?"npm.cmd":process.execPath;
 const args=install
   ? ["ci","--ignore-scripts","--no-audit","--no-fund"]
   : [path.join(prepared.abs,"node_modules","vite","bin","vite.js"),"build"];
 const timeoutMs=install?600000:300000;
 return new Promise<CIProjectResult>(resolve=>{
   let cancelled=false;
   let child:ChildProcess;
   let watchdog:ReturnType<typeof setInterval> | undefined;
   let hardDeadline:ReturnType<typeof setTimeout> | undefined;
   const endTree=()=>{
     if(cancelled)return;
     cancelled=true;
     if(process.platform==="win32" && child?.pid) {
       execFile("taskkill",["/PID",String(child.pid),"/T","/F"],{
         shell:false,windowsHide:true,timeout:8000,env
       },()=>{});
     }
     try{child?.kill()}catch{/* already exited */}
   };
   try {
     child=execFile(binary,args,{
       cwd:prepared.abs,env,encoding:"utf8",shell:install,
       timeout:timeoutMs,maxBuffer:65536,windowsHide:true,
     },async(error,stdout,stderr)=>{
       if(watchdog)clearInterval(watchdog);
       if(hardDeadline)clearTimeout(hardDeadline);
       const code=error?typeof (error as {code?:unknown}).code==="number"
         ? (error as {code:number}).code:1:0;
       const detail:Record<string,unknown>={
         project:prepared.rel,action:prepared.action,exitCode:code,
         stdout:(stdout??"").slice(-3000),stderr:(stderr??"").slice(-2000),
         cancelled,
       };
       if(cancelled || error || code!==0) {
         resolve({ok:false,tool,evidence:"No verified successful project operation",
           detail,error:cancelled?"CI project operation cancelled or timed out":"CI operation failed (exit code "+code+")"});
         return;
       }
       if(install) {
         // A successful dependency install is NOT proof that the project builds.
         resolve({ok:true,tool,evidence:"Dependency installation returned exit 0 in isolated CI; build NOT verified",detail});
         return;
       }
       try {
         const output=path.join(prepared.abs,"dist","index.html");
         const real=await fs.realpath(output);
         if(!within(prepared.abs,real))throw Error("Build output outside project");
         const html=await fs.readFile(real);
         if(html.byteLength<30)throw Error("Build output too small");
         detail.artifact="dist/index.html";
         detail.artifactSha256=createHash("sha256").update(html).digest("hex");
         detail.artifactBytes=html.byteLength;
         detail.buildArtifactVerified=true;
         resolve({ok:true,tool,evidence:"Vite build exited 0; dist/index.html independently read and hashed",detail});
       } catch {
         resolve({ok:false,tool,evidence:"",detail,error:"Build output missing or unverified"});
       }
     });
     register(child);
     hardDeadline=setTimeout(endTree,timeoutMs);
     hardDeadline.unref?.();
     watchdog=setInterval(()=>{if(isCancelled())endTree();},250);
     watchdog.unref?.();
   } catch {
     if(watchdog)clearInterval(watchdog);
     if(hardDeadline)clearTimeout(hardDeadline);
     resolve({ok:false,tool,evidence:"",error:"Unable to launch fixed CI project operation"});
   }
 });
}
