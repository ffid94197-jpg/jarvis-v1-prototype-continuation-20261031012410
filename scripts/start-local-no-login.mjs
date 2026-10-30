/** JARVIS local developer UI: private SQLite OWNER test session only.
 * Never expose on LAN, tunnel, or cloud. Production uses real authentication.
 */
import {spawn} from 'node:child_process';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ensureLocalDevDatabase,localDevEnvironment} from './local-dev-bootstrap.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
let env,paths;
try {
  env=localDevEnvironment(process.env);
  paths=ensureLocalDevDatabase(root,env);
}catch(err){console.error('[JARVIS V1] '+err.message);process.exit(1);}
env.JARVIS_TTS_ENABLED='1';
env.JARVIS_PERCEPTION_ENABLED='1';
console.log('JARVIS V1 DEVELOPMENT — 127.0.0.1 only, isolated test database, local owner session.');
console.log('Production/remote launches require authentication.');
const child=spawn(process.execPath,[paths.nextCli,'dev','-p','3000','-H','127.0.0.1'],
  {cwd:root,env,stdio:'inherit',windowsHide:true});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{if(child.exitCode===null)child.kill(sig);});
child.on('error',err=>{console.error('NEXUS startup failed:',err.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
