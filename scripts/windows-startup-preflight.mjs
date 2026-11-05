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
  // The runtime companion gate (src/lib/agent/windows/policy.ts) also requires
  // these two. Asserting them here means a misconfiguration fails at STARTUP
  // with an actionable message instead of mid-task as a Guardian denial that
  // reads like a policy rejection. Neither check relaxes anything: both were
  // already enforced at tool-call time.
  if (env.JARVIS_WINDOWS_AGENT_ENABLED !== '1') {
    throw new Error('Windows launcher requires JARVIS_WINDOWS_AGENT_ENABLED=1 before spawning the companion');
  }
  if (typeof env.JARVIS_WINDOWS_COMPANION_TOKEN !== 'string' ||
      env.JARVIS_WINDOWS_COMPANION_TOKEN.length < 32) {
    throw new Error('Windows launcher requires a companion token of at least 32 characters (JARVIS_WINDOWS_COMPANION_TOKEN)');
  }
  const minecraftVariables = ['JARVIS_MINECRAFT_LAN_PORT','JARVIS_MINECRAFT_LAN_HOST','JARVIS_MINECRAFT_PLAYER'];
  const configuredMinecraft = minecraftVariables.filter((key) => env[key] !== undefined && env[key] !== '');
  if (env.JARVIS_MINECRAFT_LAN_ENABLED !== '1' && configuredMinecraft.length > 0) {
    // The classic trap: the operator configured the LAN world but never flipped
    // the enable flag, so minecraft_companion_join was denied at runtime while
    // the launcher had started "successfully".
    throw new Error(
      `Minecraft is half-configured: ${configuredMinecraft.join(', ')} set but JARVIS_MINECRAFT_LAN_ENABLED is not '1'. ` +
      `Set JARVIS_MINECRAFT_LAN_ENABLED=1 to authorize the companion join, or remove those variables.`);
  }
  if (env.JARVIS_MINECRAFT_LAN_ENABLED === '1') {
    const owner=String(env.JARVIS_MINECRAFT_PLAYER ?? '');
    const engine=String(env.JARVIS_MINECRAFT_ENGINE || 'jarvis');
    if (!ownerPattern.test(owner) || owner.toLowerCase()==='jarvisbuddy') {
      throw new Error('Minecraft owner must be the human Java player, not JarvisBuddy');
    }
    if (!['jarvis','mine-ai-mcp','ai-companion'].includes(engine)) {
      throw new Error('Unsupported JARVIS_MINECRAFT_ENGINE selector');
    }
    if (engine === 'ai-companion') {
      const config=String(env.JARVIS_MINECRAFT_AI_COMPANION_CONFIG ?? '');
      if (!config && !env.APPDATA) {
        throw new Error('AI Companion mode requires JARVIS_MINECRAFT_AI_COMPANION_CONFIG or APPDATA for config/jarvis-bridge.json');
      }
    } else {
      const port=String(env.JARVIS_MINECRAFT_LAN_PORT ?? '');
      const host=String(env.JARVIS_MINECRAFT_LAN_HOST ?? '127.0.0.1');
      if (!/^[0-9]+$/.test(port) || Number(port)<1024 || Number(port)>65535 ||
          !Number.isSafeInteger(Number(port))) {
        throw new Error('Minecraft requires an explicit Java LAN port between 1024 and 65535');
      }
      if (host !== '127.0.0.1' && host !== 'localhost') {
        throw new Error('This localhost-only development launcher permits Minecraft LAN host on this PC only');
      }
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
