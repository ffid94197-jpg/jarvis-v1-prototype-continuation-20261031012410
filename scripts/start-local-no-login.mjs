/** JARVIS local developer UI: private SQLite OWNER test session only.
 * Never expose on LAN, tunnel, or cloud. Production uses real authentication.
 *
 * COMPANION DELEGATION
 * This launcher provides the loopback development *session* contract only. The
 * Windows companion gate in src/lib/agent/windows/policy.ts additionally
 * requires JARVIS_WINDOWS_AGENT_ENABLED=1, a >=32-character companion token and
 * a spawned sidecar — none of which this file provides on its own. Starting here
 * with companion features configured therefore produced a session that
 * authenticated fine (HTTP 200) but DENIED every companion tool, including an
 * otherwise authorized minecraft_companion_join.
 *
 * So when companion features are configured on Windows, this launcher hands over
 * to scripts/start-windows-agent.mjs — the single supported workflow that
 * coordinates NEXUS, JARVIS Core, the Windows companion, the tool bridge and the
 * Minecraft capability. Nothing is weakened: the same isolated loopback contract
 * applies, and the handover is announced on the console.
 */
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {companionFeatureRequested,ensureLocalDevDatabase,localDevEnvironment} from './local-dev-bootstrap.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const require=createRequire(import.meta.url);

// Load .env BEFORE deciding anything, exactly as the Windows launcher does,
// otherwise companion flags configured in .env are invisible here and the
// delegation decision would be made against an incomplete environment.
try { require('@next/env').loadEnvConfig(root, true); }
catch (err) { console.error('[JARVIS V1] '+err.message); process.exit(1); }

function forwardSignals(child){
  for(const sig of ['SIGINT','SIGTERM']) process.on(sig,()=>{ if(child.exitCode===null) child.kill(sig); });
}

async function delegateToWindowsLauncher(){
  const target=join(root,'scripts','start-windows-agent.mjs');
  console.log('[JARVIS V1] Windows companion capability is configured, so this launcher is handing over to');
  console.log('[JARVIS V1] scripts/start-windows-agent.mjs (npm run dev:windows) — the single supported');
  console.log('[JARVIS V1] workflow that starts NEXUS, JARVIS Core, the Windows companion and the tool bridge.');
  console.log('[JARVIS V1] Without that handover the companion and minecraft_companion_join would be DENIED.');
  const child=spawn(process.execPath,[target],{cwd:root,stdio:'inherit',windowsHide:true});
  forwardSignals(child);
  child.on('error',err=>{ console.error('[JARVIS V1] handover failed:',err.message); process.exitCode=1; });
  const code=await new Promise(resolve=>{
    child.on('exit',c=>resolve(c===null?1:c));
  });
  process.exitCode=code;
}

async function startPlainDevelopmentConsole(){
  let env,paths;
  try {
    env=localDevEnvironment(process.env);
    paths=ensureLocalDevDatabase(root,env);
  }catch(err){console.error('[JARVIS V1] '+err.message);process.exit(1);}
  env.JARVIS_TTS_ENABLED='1';
  env.JARVIS_PERCEPTION_ENABLED='1';
  console.log('JARVIS V1 DEVELOPMENT — 127.0.0.1 only, isolated test database, local owner session.');
  console.log('Production/remote launches require authentication.');
  if (process.platform==='win32') {
    // Not an error: this mode is correct for UI/Core work without a companion.
    console.log('Windows companion, native desktop and Minecraft LAN tools are NOT authorized in this mode.');
    console.log('Use npm run dev:windows when you need them; they will be DENIED here by design.');
  }
  const child=spawn(process.execPath,[paths.nextCli,'dev','-p','3000','-H','127.0.0.1'],
    {cwd:root,env,stdio:'inherit',windowsHide:true});
  forwardSignals(child);
  child.on('error',err=>{console.error('NEXUS startup failed:',err.message);process.exitCode=1;});
  child.on('exit',code=>{process.exitCode=code??1;});
}

if (process.platform==='win32' && companionFeatureRequested(process.env)) {
  await delegateToWindowsLauncher();
} else {
  await startPlainDevelopmentConsole();
}
