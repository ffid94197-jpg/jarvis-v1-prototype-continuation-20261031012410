/**
 * Shared, isolated localhost-only JARVIS development bootstrap.
 * Never reuse production/external DB settings, never run a destructive migration,
 * and never skip a failed Prisma initialization while starting the UI.
 */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

export function localDevEnvironment(input=process.env) {
  if(input.NODE_ENV==='production') throw Error('Refusing passwordless development in production');
  return {
    ...input,
    NODE_ENV:'development',
    DATABASE_URL:'file:./jarvis-local-minecraft-test.db',
    JARVIS_PUBLIC_ORIGIN:'http://127.0.0.1:3000',
    JARVIS_LOCAL_DEV_NO_LOGIN:'1',
    JARVIS_LOCAL_DEV_BIND:'127.0.0.1',
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
