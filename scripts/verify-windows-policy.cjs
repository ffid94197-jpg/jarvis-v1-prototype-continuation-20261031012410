'use strict';
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname,'../src/lib/agent/windows/policy.ts'),'utf8');
const compiled = ts.transpileModule(source,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true,
});
if (compiled.diagnostics?.length) throw new Error('TypeScript syntax errors in desktop policy.');
let checks=0;
function assert(v,name){if(!v)throw Error('FAIL '+name);checks++;process.stdout.write('PASS '+name+'\n');}
function make(env,platform='win32',root=process.cwd()){
  const exports={};
  vm.runInNewContext(compiled.outputText,{exports,URL,process:{platform,env,cwd:()=>root},require}, {timeout:500});
  return exports.validateDesktopTool;
}
const base={JARVIS_WINDOWS_AGENT_ENABLED:'1',JARVIS_LOCAL_DEV_NO_LOGIN:'1',
  JARVIS_LOCAL_DEV_BIND:'127.0.0.1',JARVIS_WINDOWS_COMPANION_TOKEN:'a'.repeat(64),
  JARVIS_SCREEN_WATCH_ENABLED:'1',JARVIS_MINECRAFT_LAN_ENABLED:'1',
  JARVIS_TLAUNCHER_PATH:'C:\\Games\\TLauncher.exe',
  JARVIS_BROWSER_AGENT_ENABLED:'1',JARVIS_WINDOWS_UI_CONTROL_ENABLED:'1'};
const decide = make(base);
assert(decide('windows_open_url',{url:'https://www.youtube.com/'}).ok,'public https allowed');
for (const url of ['http://youtube.com/','https://localhost:20189','https://127.0.0.1',
 'https://user:pass@www.youtube.com','https://192.168.1.2','https://internal.local',
 'https://www.youtube.com:444','https://www.youtube.com/#fragment','file:///C:/Windows/system32',
 'javascript:alert(1)','https://foo.test']) {
 assert(!decide('windows_open_url',{url}).ok,`unsafe URL denied ${url.slice(0,40)}`);
}
assert(decide('windows_open_app',{app:'explorer'}).ok,'explorer allowlisted');
assert(decide('windows_open_app',{app:'chrome'}).ok,'Chrome alias available');
const operatorRoot = fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-app-policy-'));
try {
 fs.mkdirSync(path.join(operatorRoot,'windows-companion'));
 fs.writeFileSync(path.join(operatorRoot,'windows-companion','approved_apps.json'),
  JSON.stringify({music:'D:\\Apps\\Music\\music.exe', shell:'C:\\Windows\\System32\\cmd.exe'}));
 const withOwner=make(base,'win32',operatorRoot);
 assert(withOwner('windows_open_app',{app:'music'}).ok,'explicit operator-approved app admitted');
 assert(!withOwner('windows_open_app',{app:'shell'}).ok,'custom shell target denied');
} finally {fs.rmSync(operatorRoot,{recursive:true,force:true});}
assert(decide('windows_open_app',{app:'edge'}).ok,'Edge alias available');
assert(decide('windows_open_app',{app:'settings'}).ok,'Settings app alias available');
assert(decide('windows_open_settings',{page:'home'}).ok,'Settings home tool available');
assert(decide('windows_open_settings',{page:'display'}).ok,'Settings display tool available');
assert(!decide('windows_open_settings',{page:'ms-settings:evil'}).ok,'arbitrary Settings URI denied');
assert(decide('windows_discover_apps',{}).ok,'app availability discovery tool');
assert(decide('windows_open_app',{app:'tlauncher'}).ok,'configured launcher allowlisted');
assert(!decide('windows_open_app',{app:'powershell'}).ok,'PowerShell denied');
assert(!decide('windows_open_app',{app:'C:\\Windows\\System32\\cmd.exe'}).ok,'arbitrary app path denied');
assert(decide('windows_youtube_oldest',{channel:'MrBeast'}).ok,'valid channel allowed');
assert(!decide('windows_youtube_oldest',{channel:'\"; rm -rf /'}).ok,'malicious channel rejected');
assert(decide('windows_watch_screen',{seconds:10}).ok,'bounded live observation allowed');
assert(!decide('windows_watch_screen',{seconds:100}).ok,'unbounded observation rejected');
assert(!decide('windows_watch_screen',{seconds:-1}).ok,'negative observation rejected');
assert(!make({...base,JARVIS_SCREEN_WATCH_ENABLED:'0'})('windows_watch_screen',{seconds:5}).ok,'watch opt-out enforced');
assert(!make({...base,JARVIS_TLAUNCHER_PATH:''})('windows_open_app',{app:'tlauncher'}).ok,'TLauncher path required');
assert(!make({...base,JARVIS_WINDOWS_AGENT_ENABLED:'0'})('windows_open_url',{url:'https://youtube.com'}).ok,'requires opt-in');
assert(!make({...base,JARVIS_LOCAL_DEV_NO_LOGIN:'0'})('windows_open_url',{url:'https://youtube.com'}).ok,'passwordless isolation required');
assert(!make({...base,JARVIS_WINDOWS_COMPANION_TOKEN:'a'})('windows_open_url',{url:'https://youtube.com'}).ok,'weak companion token denied');
assert(!make(base,'linux')('windows_open_url',{url:'https://youtube.com'}).ok,'Linux denied');
assert(!make({...base,JARVIS_MINECRAFT_LAN_ENABLED:'0'})('minecraft_companion_join',{}).ok,'Minecraft opt-out enforced');
assert(decide('minecraft_companion_join',{}).ok,'local Minecraft opt-in permitted');
assert(!decide('windows_delete_all_files',{}).ok,'unknown tool denied');

assert(decide('windows_browser_search',{query:'MrBeast oldest video'}).ok,'bounded web search accepted');
assert(!decide('windows_browser_search',{query:'\nsecret'}).ok,'control characters rejected from search');
assert(!decide('windows_browser_search',{query:'X'.repeat(300)}).ok,'large web search rejected');
assert(decide('windows_browser_inspect',{}).ok,'read-only DOM inspect accepted');
assert(decide('windows_browser_read_page',{}).ok,'read page accepted');
const goodToken='a'.repeat(24);
assert(decide('windows_browser_click_link',{index:0,pageToken:goodToken}).ok,'indexed public link click accepted');
assert(!decide('windows_browser_click_link',{index:40,pageToken:goodToken}).ok,'out-of-range click denied');
assert(!decide('windows_browser_click_link',{index:0,pageToken:'stale'}).ok,'invalid token rejected');
assert(decide('windows_browser_fill_search',{index:2,pageToken:goodToken,text:'Minecraft'}).ok,'inspected search-only input accepted');
assert(!decide('windows_browser_fill_search',{index:2,pageToken:goodToken,text:'ab\ncd'}).ok,'unsafe form payload denied');
assert(decide('windows_browser_scroll',{direction:'down',pages:3,pageToken:goodToken}).ok,'bounded scroll accepted');
assert(!decide('windows_browser_scroll',{direction:'down',pages:500,pageToken:goodToken}).ok,'unbounded scroll denied');
assert(!make({...base,JARVIS_BROWSER_AGENT_ENABLED:'0'})('windows_browser_search',{query:'cats'}).ok,'browser automation opt-in enforced');
assert(decide('windows_list_windows',{}).ok,'allowlisted window enumeration accepted');
assert(decide('windows_focus_app',{app:'notepad'}).ok,'approved app focus allowed');
assert(!decide('windows_focus_app',{app:'powershell'}).ok,'terminal focus denied');
assert(!make({...base,JARVIS_WINDOWS_UI_CONTROL_ENABLED:'0'})('windows_focus_app',{app:'notepad'}).ok,'window control opt-in enforced');
console.log('WINDOWS_POLICY:',checks+'/' +checks+' offline assertions PASS; native Windows runtime NOT tested');
