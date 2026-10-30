/**
 * Preflight for the isolated Windows developer launcher.
 * This DOES NOT certify native LPAC isolation or production security.
 * It rejects unsafe dev config before spawning a privileged Windows companion
 * and reserves / tests the expected localhost service addresses.
 */
import net from 'node:net';

const expectedOrigin='http://127.0.0.1:3000';
const ownerPattern=/^[A-Za-z0-9_]{1,16}$/;

export function validateLocalWindowsEnvironment(env) {
  if (env.NODE_ENV !== 'development' || env.JARVIS_LOCAL_DEV_NO_LOGIN !== '1' ||
      env.JARVIS_LOCAL_DEV_BIND !== '127.0.0.1' ||
      env.JARVIS_PUBLIC_ORIGIN !== expectedOrigin ||
      env.DATABASE_URL !== 'file:./jarvis-local-minecraft-test.db') {
    throw new Error('Development Windows launcher requires exact isolated localhost configuration');
  }
  if (env.JARVIS_MINECRAFT_LAN_ENABLED === '1') {
    const port=String(env.JARVIS_MINECRAFT_LAN_PORT ?? '');
    const owner=String(env.JARVIS_MINECRAFT_PLAYER ?? '');
    const host=String(env.JARVIS_MINECRAFT_LAN_HOST ?? '127.0.0.1');
    if (!/^[0-9]+$/.test(port) || Number(port)<1024 || Number(port)>65535 ||
        !Number.isSafeInteger(Number(port))) {
      throw new Error('Minecraft requires an explicit Java LAN port between 1024 and 65535');
    }
    if (!ownerPattern.test(owner) || owner.toLowerCase()==='jarvisbuddy') {
      throw new Error('Minecraft owner must be the human Java player, not JarvisBuddy');
    }
    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error('This localhost-only development launcher permits Minecraft LAN host on this PC only');
    }
  }
  return true;
}

export function assertPortAvailable(port, host='127.0.0.1', timeoutMs=1500) {
  return new Promise((resolve,reject)=>{
    const server=net.createServer();
    let completed=false;
    let timer;
    const finish=(error)=>{
      if(completed)return;completed=true;
      if(timer)clearTimeout(timer);
      try { server.close(); } catch {}
      if(error)reject(error);else resolve();
    };
    server.once('error',(e)=>finish(new Error(`Local port ${host}:${port} unavailable (${e.code || e.message}); stop the other process or choose a clean session`)));
    server.once('listening',()=>finish());
    timer=setTimeout(()=>finish(new Error(`Local port ${host}:${port} did not respond to preflight in time`)),timeoutMs);
    timer.unref();
    server.listen({port,host,exclusive:true});
  });
}

export async function assertWindowsServicesFree(ports=[3000,20189]) {
  for (const port of ports) await assertPortAvailable(port);
  return true;
}
