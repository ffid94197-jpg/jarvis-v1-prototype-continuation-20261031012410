#!/usr/bin/env node
"use strict";
// Apply JARVIS-specific source overlay to an exact, clean AI Companion submodule.
// No GitHub Actions. Does not touch D:\jarvis_pc_work or replace existing Mineflayer.
const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");
const bridge=__dirname,upstream=path.resolve(bridge,"../ai-companion");
const PIN="6bb1df1a06258ca712b66f1404dd05204f25b9c7";
function fatal(message){ throw new Error("JARVIS overlay refused: "+message); }
function run(cmd,args){return cp.execFileSync(cmd,args,{cwd:upstream,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();}
function read(rel){return fs.readFileSync(path.join(upstream,rel),"utf8");}
function editOnce(text,from,to){if(text.includes(to))return text;if(!text.includes(from))fatal("upstream code seam missing: "+from);return text.replace(from,to);}
if(!fs.existsSync(path.join(upstream,"aicompanion","build.gradle"))) fatal("initialize integrations/ai-companion submodule first");
if(run("git",["rev-parse","HEAD"])!==PIN)fatal("upstream commit does not match pinned audited revision");
const mainRel="aicompanion/src/main/java/com/neovetta/aicompanion/AiCompanion.java";
const engRel="engine/src/autoclef/java/adris/altoclef/AltoClefController.java";
const serviceRel="engine/src/autoclef/java/adris/altoclef/player2api/Player2APIService.java";
const overlayNames=["JarvisBridgeServer.java","JarvisEndgameTask.java"];
const overlayRoot="aicompanion/src/main/java/com/neovetta/aicompanion/jarvis";
const originalMain=read(mainRel),originalEngine=read(engRel),originalService=read(serviceRel);
const mainCall="        ConversationManager.init();";
const brainCall='        registerBrainReceivers();';
const brainPatch='        if (!com.neovetta.aicompanion.jarvis.JarvisBridgeServer.enabled()) registerBrainReceivers();';
const mainPatch="        if (!com.neovetta.aicompanion.jarvis.JarvisBridgeServer.enabled()) ConversationManager.init();\n        com.neovetta.aicompanion.jarvis.JarvisBridgeServer.install();";
const idleCall='if ((!this.getUserTaskChain().isActive() || this.getUserTaskChain().isRunningIdleTask())';
const idlePatch='if (!"1".equals(System.getenv("JARVIS_MC_BRIDGE_ENABLE")) && (!this.getUserTaskChain().isActive() || this.getUserTaskChain().isRunningIdleTask())';
const engineCall="      ConversationManager.injectOnTick(server);";
const serviceCall='   private Map<String, JsonElement> chatCompletion(JsonObject requestBody) throws Exception {';
const servicePatch='   private Map<String, JsonElement> chatCompletion(JsonObject requestBody) throws Exception {\n      if ("1".equals(System.getenv("JARVIS_MC_BRIDGE_ENABLE"))) throw new SecurityException("JARVIS-only mode disables independent companion LLM requests");';
const enginePatch='      if (!"1".equals(System.getenv("JARVIS_MC_BRIDGE_ENABLE"))) ConversationManager.injectOnTick(server);';
if(!originalMain.includes(mainCall)&&!originalMain.includes(mainPatch))fatal("main source no longer matches pinned API");
if(!originalMain.includes(brainCall)&&!originalMain.includes(brainPatch))fatal("brain packet receiver seam changed");
if(!originalEngine.includes(engineCall)&&!originalEngine.includes(enginePatch))fatal("engine source no longer matches pinned API");
if(!originalEngine.includes(idleCall)&&!originalEngine.includes(idlePatch))fatal("independent idle task source seam changed");
if(!originalService.includes(serviceCall)&&!originalService.includes(servicePatch))fatal("LLM service source no longer matches pinned API");
const clean=run("git",["status","--porcelain","--untracked-files=all"]);
if(clean && !(originalMain.includes(mainPatch)&&originalEngine.includes(enginePatch)&&originalService.includes(servicePatch)))fatal("submodule contains existing edits; preserve them before overlay");
const overlayFiles=overlayNames.map(name=>({
 target:path.join(upstream,overlayRoot,name),
 content:fs.readFileSync(path.join(bridge,"overlay/com/neovetta/aicompanion/jarvis",name),"utf8")
}));
if(originalMain.includes(mainPatch)&&originalMain.includes(brainPatch)&&originalEngine.includes(enginePatch)&&originalEngine.includes(idlePatch)&&originalService.includes(servicePatch)) {
 if(overlayFiles.some(file=>!fs.existsSync(file.target)||
    fs.readFileSync(file.target,"utf8")!==file.content))
     fatal("existing overlay differs; refusing overwrite");
 console.log("JARVIS AI Companion overlay already applied");
 process.exit(0);
}
const nextMain=editOnce(editOnce(originalMain,mainCall,mainPatch),brainCall,brainPatch),
      nextEngine=editOnce(editOnce(originalEngine,engineCall,enginePatch),idleCall,idlePatch),
      nextService=editOnce(originalService,serviceCall,servicePatch);
const engProps=read("engine/gradle.properties"),appProps=read("aicompanion/gradle.properties");
if(!/minecraft_version\s*=\s*1\.20\.1/.test(engProps) ||
   !/minecraft_version\s*=\s*1\.20\.1/.test(appProps) ||
   !/mod_version\s*=\s*1\.1\.19/.test(engProps))fatal("unsupported Fabric/PlayerEngine build version");
if(!fs.existsSync(path.join(upstream,overlayRoot)))
    fs.mkdirSync(path.join(upstream,overlayRoot),{recursive:true});
// All preconditions checked before modifying upstream. Original tracked files remain recoverable by Git.
fs.writeFileSync(path.join(upstream,engRel),nextEngine,"utf8");
fs.writeFileSync(path.join(upstream,serviceRel),nextService,"utf8");
fs.writeFileSync(path.join(upstream,mainRel),nextMain,"utf8");
for(const file of overlayFiles)fs.writeFileSync(file.target,file.content,"utf8");
console.log("Overlay applied to pinned 1.20.1 source; build with JDK 17.");
console.log("No tests or game sessions were run. Do not mark gameplay accepted.");
