import assert from 'node:assert/strict';
import net from 'node:net';
import {validateLocalWindowsEnvironment,assertPortAvailable,assertWindowsServicesFree} from './windows-startup-preflight.mjs';

const baseline={NODE_ENV:'development',JARVIS_LOCAL_DEV_NO_LOGIN:'1',
 JARVIS_LOCAL_DEV_BIND:'127.0.0.1',JARVIS_PUBLIC_ORIGIN:'http://127.0.0.1:3000',
 DATABASE_URL:'file:./jarvis-local-minecraft-test.db',JARVIS_MINECRAFT_LAN_ENABLED:'0'};
let checked=0;
function accepted(env){assert.equal(validateLocalWindowsEnvironment({...baseline,...env}),true);checked++;}
function denied(env){assert.throws(()=>validateLocalWindowsEnvironment({...baseline,...env}));checked++;}
accepted({});
for(const [name,value] of [
 ['NODE_ENV','production'],['JARVIS_LOCAL_DEV_NO_LOGIN','0'],
 ['JARVIS_LOCAL_DEV_BIND','0.0.0.0'],['JARVIS_PUBLIC_ORIGIN','http://localhost:3000'],
 ['DATABASE_URL','file:./production.db']])denied({[name]:value});
const mc={JARVIS_MINECRAFT_LAN_ENABLED:'1',JARVIS_MINECRAFT_LAN_PORT:'54321',
 JARVIS_MINECRAFT_LAN_HOST:'127.0.0.1',JARVIS_MINECRAFT_PLAYER:'ActualOwner'};
accepted(mc);
accepted({...mc,JARVIS_MINECRAFT_LAN_HOST:'localhost'});
for(const bad of [
 {...mc,JARVIS_MINECRAFT_LAN_PORT:'0'}, {...mc,JARVIS_MINECRAFT_LAN_PORT:'65536'},
 {...mc,JARVIS_MINECRAFT_LAN_PORT:'54321x'}, {...mc,JARVIS_MINECRAFT_PLAYER:'JarvisBuddy'},
 {...mc,JARVIS_MINECRAFT_PLAYER:'jarvisbuddy'}, {...mc,JARVIS_MINECRAFT_PLAYER:'bad owner'},
 {...mc,JARVIS_MINECRAFT_PLAYER:''}, {...mc,JARVIS_MINECRAFT_LAN_HOST:'192.168.0.5'},
 {...mc,JARVIS_MINECRAFT_LAN_HOST:'example.com'}
])denied(bad);
const bound=net.createServer();
await new Promise((resolve,reject)=>{bound.once('error',reject);bound.listen(0,'127.0.0.1',resolve);});
const port=bound.address().port;
await assert.rejects(assertPortAvailable(port));checked++;
await new Promise((resolve)=>bound.close(resolve));
await assertPortAvailable(port);checked++;
await assertWindowsServicesFree([port]);checked++;
console.log(`WINDOWS_STARTUP_PREFLIGHT ${checked}/${checked} PASS (offline policies and loopback socket checks)`);
