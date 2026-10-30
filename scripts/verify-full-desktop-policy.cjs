'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */
const fs=require('fs'),path=require('path'),vm=require('vm'),ts=require('typescript');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/lib/agent/windows/policy.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
if(compiled.diagnostics?.length)throw Error('TypeScript syntax invalid');
function load(env){const exports={};vm.runInNewContext(compiled.outputText,{exports,URL,process:{platform:'win32',env,cwd:()=>root},require},{timeout:1000});return exports.validateDesktopTool;}
const base={JARVIS_WINDOWS_AGENT_ENABLED:'1',JARVIS_LOCAL_DEV_NO_LOGIN:'1',JARVIS_LOCAL_DEV_BIND:'127.0.0.1',JARVIS_WINDOWS_COMPANION_TOKEN:'a'.repeat(64),JARVIS_MINECRAFT_LAN_ENABLED:'1',JARVIS_EXPERIMENTAL_DESKTOP_CONTROL:'1'};
const yes=load(base),no=load({...base,JARVIS_EXPERIMENTAL_DESKTOP_CONTROL:'0'});
let n=0;function check(ok,label){if(!ok)throw Error('FAIL '+label);n++;console.log('PASS',label);}
const cases=[
 ['windows_desktop_state',{}],['windows_desktop_windows',{}],
 ['windows_desktop_focus',{windowId:'a'.repeat(24)}],
 ['windows_desktop_click',{x:200,y:70,button:'left'}],
 ['windows_desktop_move',{x:100,y:80}],
 ['windows_desktop_type',{text:'Hello'}],
 ['windows_desktop_keys',{keys:['ctrl','a']}],
 ['windows_desktop_scroll',{amount:2}],
 ['windows_launch_installed',{appId:'start-'+'f'.repeat(12)}],
 ['minecraft_companion_command',{command:'move',directionInput:'forward',durationMs:200}]
];
const gameEnv=load({...base,JARVIS_MINECRAFT_GAME_INPUT_ENABLED:'1'});
for(const [name,args] of cases){check(yes(name,args).ok,name+' permitted under test mode');if(name!=='minecraft_companion_command')check(!no(name,args).ok,name+' denied without explicit operator flag');}
check(!yes('windows_desktop_type',{text:'X'.repeat(500)}).ok,'oversized typing denied');
check(!yes('windows_desktop_keys',{keys:['powershell']}).ok,'unknown key rejected');
check(!yes('windows_desktop_click',{x:-1,y:20,button:'left'}).ok,'negative coordinate rejected');
check(!yes('windows_launch_installed',{appId:'C:\\app.exe'}).ok,'arbitrary app path denied');
check(!yes('minecraft_companion_command',{command:'move',directionInput:'forward',durationMs:10000}).ok,'unbounded game movement denied');
check(!load({...base,JARVIS_LOCAL_DEV_BIND:'0.0.0.0'})('windows_desktop_state',{}).ok,'network-bound server denied');
check(yes('minecraft_companion_command',{command:'follow'}).ok,'minecraft follow admitted');
check(gameEnv('windows_minecraft_input',{action:'forward',durationMs:700}).ok,'bounded Minecraft foreground input admitted');
check(!yes('windows_minecraft_input',{action:'forward',durationMs:700}).ok,'Minecraft game input opt-in enforced');
check(!gameEnv('windows_minecraft_input',{action:'forward',durationMs:5000}).ok,'unbounded Minecraft input rejected');
check(!gameEnv('windows_minecraft_input',{action:'open_shell',durationMs:200}).ok,'unknown game action rejected');
check(fs.readFileSync(path.join(root,'scripts/start-windows-agent.mjs'),'utf8').includes("'JARVIS_MINECRAFT_GAME_INPUT_ENABLED'"),'Minecraft input opt-in forwarded to Python companion');
check(!load({...base,JARVIS_MINECRAFT_LAN_ENABLED:'0'})('minecraft_companion_command',{command:'follow'}).ok,'minecraft opt-out denies');
for(const f of ['src/lib/agent/guardian/guardian.ts','src/lib/agent/tools/executor.ts','src/lib/agent/core/prompts.ts','windows-companion/companion.py']){
 const s=fs.readFileSync(path.join(root,f),'utf8');
 for(const name of ['windows_desktop_click','minecraft_companion_command']){
   if(f.endsWith('companion.py'))break;
   check(s.includes(name),`${name} present in ${f}`);
 }
}
console.log(`FULL_DESKTOP_WIRING ${n}/${n} PASS (offline only)`);
