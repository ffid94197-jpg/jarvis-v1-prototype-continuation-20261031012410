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
  JARVIS_MINECRAFT_LAN_HOST:'127.0.0.1',JARVIS_MINECRAFT_LAN_PORT:'25565',
  JARVIS_MINECRAFT_PLAYER:'OwnerPlayer',
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
// The runtime gate must not be weaker than the launcher preflight: it validates
// host, port and player itself, so a server started without the preflight cannot
// authorize a join to a remote host or an arbitrary port.
for (const host of ['192.168.1.50','mc.example.com','0.0.0.0','::1']) {
  assert(!make({...base,JARVIS_MINECRAFT_LAN_HOST:host})('minecraft_companion_join',{}).ok,
    'non-loopback Minecraft host denied: '+host);
}
assert(make({...base,JARVIS_MINECRAFT_LAN_HOST:'localhost'})('minecraft_companion_join',{}).ok,
  'localhost is an accepted loopback spelling');
for (const port of ['','25565abc','80','1023','65536','-1','99999999999999999999']) {
  assert(!make({...base,JARVIS_MINECRAFT_LAN_PORT:port})('minecraft_companion_join',{}).ok,
    'invalid Minecraft LAN port denied: '+JSON.stringify(port));
}
assert(make({...base,JARVIS_MINECRAFT_LAN_PORT:'1024'})('minecraft_companion_join',{}).ok,'port lower bound accepted');
assert(make({...base,JARVIS_MINECRAFT_LAN_PORT:'65535'})('minecraft_companion_join',{}).ok,'port upper bound accepted');
for (const player of ['','JarvisBuddy','jarvisbuddy','JARVISBUDDY','  JarvisBuddy  ','a name with spaces','x'.repeat(17),'Owner;rm']) {
  assert(!make({...base,JARVIS_MINECRAFT_PLAYER:player})('minecraft_companion_join',{}).ok,
    'invalid or impersonating Minecraft player denied: '+JSON.stringify(player));
}
// Halting a running companion must stay possible even with a broken config.
assert(make({...base,JARVIS_MINECRAFT_LAN_PORT:'nonsense'})('minecraft_companion_stop',{}).ok,
  'minecraft_companion_stop stays available with an invalid connection config');
assert(make({...base,JARVIS_MINECRAFT_LAN_HOST:'10.0.0.9'})('minecraft_companion_stop',{}).ok,
  'minecraft_companion_stop stays available with a non-loopback host');
assert(!decide('windows_delete_all_files',{}).ok,'unknown tool denied');

// Cua Driver element clicks must be bound to one exact observed window and
// retain the existing explicit desktop-control opt-in.
const cuaDecide = make({...base,JARVIS_EXPERIMENTAL_DESKTOP_CONTROL:'1',JARVIS_CUA_DRIVER_ENABLED:'1'});
const cuaElementArgs = {
  pid:4242,cuaWindowId:'987654321',elementToken:'s0000002a:3',button:'left',
};
const cuaElement = cuaDecide('windows_desktop_click',cuaElementArgs);
assert(cuaElement.ok && cuaElement.prepared.operation === 'desktop_click' &&
  cuaElement.prepared.pid === 4242 && cuaElement.prepared.cuaWindowId === '987654321' &&
  cuaElement.prepared.elementToken === 's0000002a:3',
  'fresh CUA element click is Guardian-prepared with exact PID/window/token');
for (const bad of [
  {...cuaElementArgs,pid:0},
  {...cuaElementArgs,pid:true},
  {...cuaElementArgs,pid:2**32},
  {...cuaElementArgs,cuaWindowId:'0'},
  {...cuaElementArgs,cuaWindowId:'0987654321'},
  {...cuaElementArgs,cuaWindowId:'../987654321'},
  {...cuaElementArgs,cuaWindowId:'18446744073709551616'},
  {...cuaElementArgs,elementToken:'stale token'},
  {...cuaElementArgs,elementToken:'x'.repeat(129)},
]) assert(!cuaDecide('windows_desktop_click',bad).ok,'malformed CUA element target denied');
assert(!make(base)('windows_desktop_click',cuaElementArgs).ok,
  'CUA element click still requires experimental desktop-control opt-in');
assert(!make({...base,JARVIS_EXPERIMENTAL_DESKTOP_CONTROL:'1'})('windows_desktop_click',cuaElementArgs).ok,
  'CUA element click requires explicit CUA backend opt-in');
assert(cuaDecide('windows_desktop_click',{x:200,y:150,button:'left'}).ok,
  'legacy coordinate click remains supported with CUA opt-in');
const cuaWindowTarget = {pid:4242,cuaWindowId:'987654321'};
const backgroundType = cuaDecide('windows_desktop_type',{text:'hello',...cuaWindowTarget});
assert(backgroundType.ok && backgroundType.prepared.pid === 4242 &&
  backgroundType.prepared.cuaWindowId === '987654321',
  'exact-window background text input is Guardian-prepared');
const backgroundKeys = cuaDecide('windows_desktop_keys',{keys:['ctrl','s'],...cuaWindowTarget});
assert(backgroundKeys.ok && backgroundKeys.prepared.pid === 4242,
  'exact-window background keyboard input is Guardian-prepared');
assert(!cuaDecide('windows_desktop_type',{text:'hello',pid:4242}).ok,
  'partial exact-window text target denied');
assert(!cuaDecide('windows_desktop_keys',{keys:['ctrl','s'],cuaWindowId:'987654321'}).ok,
  'partial exact-window key target denied');
assert(!make({...base,JARVIS_EXPERIMENTAL_DESKTOP_CONTROL:'1'})(
  'windows_desktop_type',{text:'hello',...cuaWindowTarget}).ok,
  'exact-window text input requires CUA opt-in');

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
