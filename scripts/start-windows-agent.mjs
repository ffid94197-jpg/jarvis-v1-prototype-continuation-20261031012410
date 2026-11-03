/** Development-only supervisor. Dedicated localhost desktop sidecar + NEXUS.
 * Opt-in screen capture and offline auth test ONLY, never production.
 */
import {spawn} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {companionAuthorizationContext,ensureLocalDevDatabase,localDevEnvironment} from './local-dev-bootstrap.mjs';
import {validateLocalWindowsEnvironment,assertWindowsServicesFree} from './windows-startup-preflight.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const require=createRequire(import.meta.url);
try { require('@next/env').loadEnvConfig(root, true); }
catch(err) { console.error('JARVIS dependencies unavailable. Run npm install before dev:windows:',err.message); process.exit(1); }
if (process.platform !== 'win32' || process.env.NODE_ENV === 'production') {
  console.error('Windows companion is available on Windows development machines only.');process.exit(1);
}
const python=process.env.JARVIS_PYTHON || 'python';
let env,paths;
try {
  // One authorization context, shared with the plain launcher so the two can
  // never disagree about what an authorized companion session looks like.
  env={...localDevEnvironment(process.env),...companionAuthorizationContext(process.env)};
  validateLocalWindowsEnvironment(env);
  // Detect an already-running JARVIS or another process occupying either service.
  // A transient port race can still occur after the preflight check.
  await assertWindowsServicesFree();
  paths=ensureLocalDevDatabase(root,env);
} catch(err) { console.error('[JARVIS V1] '+err.message);process.exit(1); }
// Never hand the Python/Chromium companion owner credentials, DB URL or AI keys.
const desktopEnv={};
for(const key of ['PATH','Path','SystemRoot','WINDIR','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','COMSPEC','PROGRAMFILES','ProgramFiles','PROGRAMFILES(X86)','ProgramFiles(x86)','PYTHONPATH','PYTHONUTF8']) {
  if(process.env[key]) desktopEnv[key]=process.env[key];
}
for(const key of ['JARVIS_WINDOWS_AGENT_ENABLED','JARVIS_WINDOWS_COMPANION_TOKEN',
    'JARVIS_SCREEN_WATCH_ENABLED','JARVIS_TLAUNCHER_PATH','JARVIS_MINECRAFT_LAN_ENABLED',
    'JARVIS_MINECRAFT_LAN_HOST','JARVIS_MINECRAFT_LAN_PORT','JARVIS_MINECRAFT_PLAYER', 'JARVIS_MINECRAFT_GAME_INPUT_ENABLED', 'JARVIS_BROWSER_AGENT_ENABLED', 'JARVIS_WINDOWS_UI_CONTROL_ENABLED', 'JARVIS_EXPERIMENTAL_DESKTOP_CONTROL']) {
  if(env[key]) desktopEnv[key]=env[key];
}
if (process.env.JARVIS_CUA_DRIVER_ENABLED === '1') {
  if (desktopEnv.JARVIS_EXPERIMENTAL_DESKTOP_CONTROL !== '1') {
    console.error('Cua Driver requires JARVIS_EXPERIMENTAL_DESKTOP_CONTROL=1.');
    process.exit(1);
  }
  desktopEnv.JARVIS_CUA_DRIVER_ENABLED = '1';
}
const selectedMinecraftEngine = process.env.JARVIS_MINECRAFT_ENGINE;
if (selectedMinecraftEngine !== undefined) {
  if (!['jarvis', 'mine-ai-mcp'].includes(selectedMinecraftEngine)) {
    console.error('Invalid JARVIS_MINECRAFT_ENGINE');
    process.exit(1);
  }
  desktopEnv.JARVIS_MINECRAFT_ENGINE = selectedMinecraftEngine;
}
const sidecar=spawn(python,['-u',join(root,'windows-companion','companion.py')],
  {cwd:root,env:desktopEnv,stdio:'inherit',windowsHide:true});
const nexus=spawn(process.execPath,[paths.nextCli,
  'dev','-p','3000','-H','127.0.0.1'],{cwd:root,env,stdio:'inherit'});
const longrun = env.JARVIS_LONGRUN_ENABLED === '1'
  ? spawn('bun',['--env-file=.env',join(root,'scripts','longrun','worker.ts')],
      {cwd:root,env,stdio:'inherit',windowsHide:true}) : null;
let shutdown=false;
function stopAll(){if(shutdown)return;shutdown=true;
  if(nexus.exitCode===null) nexus.kill();
  if(sidecar.exitCode===null) sidecar.kill();
  if(longrun && longrun.exitCode===null) longrun.kill();
}
process.on('SIGINT',stopAll);process.on('SIGTERM',stopAll);
sidecar.on('error',e=>{console.error('Companion could not start:',e.message);stopAll();process.exitCode=1;});
longrun?.on('error',e=>{console.error('Long-run worker could not start:',e.message);stopAll();process.exitCode=1;});
longrun?.on('exit',c=>{if(!shutdown){console.error('Long-run worker exited:',c);stopAll();process.exitCode=1;}});
nexus.on('error',e=>{console.error('NEXUS could not start:',e.message);stopAll();process.exitCode=1;});
sidecar.on('exit',c=>{if(!shutdown){console.error('Windows companion exited:',c);stopAll();process.exitCode=1;}});
nexus.on('exit',c=>{if(!shutdown){stopAll();process.exitCode=c??1;}});
console.log('JARVIS Windows development mode: NEXUS 127.0.0.1:3000 + private local companion.');
console.log('Never tunnel/expose; use only on your private Windows PC.');

console.log('Routine worker:',longrun?'ENABLED — finite owner-authored schedules':'DISABLED — set JARVIS_LONGRUN_ENABLED=1 to opt in');
