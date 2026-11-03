/**
 * Shared, isolated localhost-only JARVIS development bootstrap.
 * Never reuse production/external DB settings, never run a destructive migration,
 * and never skip a failed Prisma initialization while starting the UI.
 */
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

/** Minimum companion token length enforced by src/lib/agent/windows/policy.ts. */
export const COMPANION_TOKEN_MIN_LENGTH = 32;

/** Environment keys that mean the operator intends to use companion features. */
const COMPANION_FEATURE_FLAGS = [
  'JARVIS_WINDOWS_AGENT_ENABLED',
  'JARVIS_MINECRAFT_LAN_ENABLED',
  'JARVIS_SCREEN_WATCH_ENABLED',
  'JARVIS_BROWSER_AGENT_ENABLED',
  'JARVIS_WINDOWS_UI_CONTROL_ENABLED',
  'JARVIS_EXPERIMENTAL_DESKTOP_CONTROL',
];

/**
 * True when the operator has configured any Windows-companion capability.
 * Used to stop the plain UI launcher from silently starting a session in which
 * every companion tool is denied.
 */
export function companionFeatureRequested(env = process.env) {
  if (COMPANION_FEATURE_FLAGS.some((key) => env[key] === '1')) return true;
  const token = typeof env.JARVIS_WINDOWS_COMPANION_TOKEN === 'string' ? env.JARVIS_WINDOWS_COMPANION_TOKEN : '';
  return token.length >= COMPANION_TOKEN_MIN_LENGTH;
}

/**
 * Single source of truth for the Windows companion authorization context.
 *
 * ROOT CAUSE THIS FIXES: the runtime gate in src/lib/agent/windows/policy.ts
 * requires JARVIS_WINDOWS_AGENT_ENABLED=1 and a >=32-character
 * JARVIS_WINDOWS_COMPANION_TOKEN *in addition to* the loopback development
 * contract that src/lib/agent/auth/session.ts checks. Only
 * start-windows-agent.mjs supplied them. So an owner who launched with
 * `npm run dev` / `dev:no-login` got a fully authenticated NEXUS session
 * (HTTP 200 from the local auth endpoint) in which EVERY companion tool —
 * including an otherwise authorized minecraft_companion_join — was permanently
 * denied. Two launchers produced two different authorization contexts and
 * nothing told the operator which one they were in.
 *
 * This weakens nothing. The token is generated fresh per launch when the
 * operator has not pinned one, it is never derived from model output, and the
 * loopback/origin/development contract is unchanged.
 */
export function companionAuthorizationContext(env = process.env) {
  const existing = typeof env.JARVIS_WINDOWS_COMPANION_TOKEN === 'string'
    ? env.JARVIS_WINDOWS_COMPANION_TOKEN.trim() : '';
  return {
    JARVIS_WINDOWS_AGENT_ENABLED: '1',
    JARVIS_WINDOWS_COMPANION_TOKEN: existing.length >= COMPANION_TOKEN_MIN_LENGTH
      ? existing
      : randomBytes(48).toString('hex'),
  };
}

export function localDevEnvironment(input=process.env) {
  if(input.NODE_ENV==='production') throw Error('Refusing passwordless development in production');
  return {
    ...input,
    NODE_ENV:'development',
    DATABASE_URL:'file:./jarvis-local-minecraft-test.db',
    JARVIS_PUBLIC_ORIGIN:'http://127.0.0.1:3000',
    JARVIS_LOCAL_DEV_NO_LOGIN:'1',
    JARVIS_LOCAL_DEV_BIND:'127.0.0.1',
    // The long-horizon planner is advisory only; Guardian still authorizes
    // every effect. Enable it by default in this loopback-only dev bootstrap,
    // while preserving an explicit operator opt-out with value "0".
    JARVIS_GOAL_PLANNER_ENABLED: typeof input.JARVIS_GOAL_PLANNER_ENABLED === 'string'
      ? input.JARVIS_GOAL_PLANNER_ENABLED : '1',
  };
}

export function ensureLocalDevDatabase(root,env,options={}) {
  const exists=options.exists ?? existsSync;
  const run=options.run ?? spawnSync;
  const node=options.node ?? process.execPath;
  if(env.NODE_ENV!=='development' || env.DATABASE_URL!=='file:./jarvis-local-minecraft-test.db' ||
     env.JARVIS_LOCAL_DEV_NO_LOGIN!=='1' || env.JARVIS_LOCAL_DEV_BIND!=='127.0.0.1' ||
     env.JARVIS_PUBLIC_ORIGIN!=='http://127.0.0.1:3000') {
    throw Error('Isolated development database requires exact localhost-only environment');
  }
  const nextCli=join(root,'node_modules','next','dist','bin','next');
  const prismaCli=join(root,'node_modules','prisma','build','index.js');
  const schema=join(root,'prisma','schema.prisma');
  const db=join(root,'prisma','jarvis-local-minecraft-test.db');
  const client=join(root,'node_modules','.prisma','client','index.js');
  const engine=join(root,'node_modules','.prisma','client','query_engine-windows.dll.node');
  if(!exists(nextCli)||!exists(prismaCli))throw Error('Dependencies missing. Run npm install first.');
  if(!exists(schema))throw Error('Prisma schema missing. Refusing to initialize database.');
  const prisma=(args,label)=>{
    const result=run(node,[prismaCli,...args,'--schema',schema],
      {cwd:root,env,stdio:'inherit',windowsHide:true});
    if(result.error || result.status!==0)throw Error(`${label} failed; inspect Prisma output before restarting JARVIS`);
  };
  if(!exists(client)||(options.platform??process.platform)==='win32'&&!exists(engine)) {
    prisma(['generate'],'Prisma client generation');
  }
  // Existing databases are *never* modified automatically; migration requires
  // an explicit reviewed, backed-up operation.
  if(!exists(db)) prisma(['db','push','--skip-generate'],'New local database initialization');
  return {nextCli,db};
}
