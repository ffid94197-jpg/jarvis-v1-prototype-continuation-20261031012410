#!/usr/bin/env node
/** Offline fixture only. Fake Prisma, do not modify the actual owner database. */
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {ensureLocalDevDatabase,localDevEnvironment} from './local-dev-bootstrap.mjs';
const root=mkdtempSync(join(tmpdir(),'jarvis-dev-bootstrap-'));
const create=(p)=>{const f=join(root,p);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,'fixture');};
let n=0;
const check=(name,fn)=>{fn();n++;console.log('PASS',name);};
const db='prisma/jarvis-local-minecraft-test.db';
const client='node_modules/.prisma/client/index.js';
const engine='node_modules/.prisma/client/query_engine-windows.dll.node';
try{
  check('production passwordless launch explicitly rejected',()=>assert.throws(()=>localDevEnvironment({NODE_ENV:'production'})));
  const env=localDevEnvironment({DATABASE_URL:'postgres://production.example/db',JARVIS_PUBLIC_ORIGIN:'https://unsafe.test',JARVIS_LOCAL_DEV_BIND:'0.0.0.0'});
  check('production database overridden with local-only test DB',()=>assert.equal(env.DATABASE_URL,'file:./jarvis-local-minecraft-test.db'));
  check('origin and bind forced to loopback',()=>{assert.equal(env.JARVIS_PUBLIC_ORIGIN,'http://127.0.0.1:3000');assert.equal(env.JARVIS_LOCAL_DEV_BIND,'127.0.0.1');});
  check('no startup against mismatched env',()=>assert.throws(()=>ensureLocalDevDatabase(root,{...env,DATABASE_URL:'file:../prod.db'})));
  check('missing dependencies fail before DB touched',()=>{assert.throws(()=>ensureLocalDevDatabase(root,env));assert.equal(existsSync(join(root,db)),false);});
  create('node_modules/next/dist/bin/next');create('node_modules/prisma/build/index.js');create('prisma/schema.prisma');
  const calls=[];
  const run=(node,args)=>{calls.push(args.slice(1));return {status:0};};
  check('first boot generates client and initializes isolated database only',()=>{
    ensureLocalDevDatabase(root,env,{platform:'win32',run});
    assert.equal(calls.length,2);
    assert.equal(calls[0][0],'generate');assert.deepEqual(calls[1].slice(0,3),['db','push','--skip-generate']);
    assert.ok(calls.every(a=>a.includes('--schema') && a.includes(join(root,'prisma','schema.prisma'))));
    assert.ok(!calls.flat().includes('--accept-data-loss'));
  });
  create(client);create(engine);create(db);
  check('existing database never modified automatically',()=>{
    calls.length=0;ensureLocalDevDatabase(root,env,{platform:'win32',run});assert.equal(calls.length,0);
  });
  check('missing client regenerates without changing existing DB',()=>{
    const virtualExists=p=>p===join(root,client)?false:existsSync(p);
    calls.length=0;ensureLocalDevDatabase(root,env,{platform:'win32',exists:virtualExists,run});
    assert.equal(calls.length,1);assert.equal(calls[0][0],'generate');
  });
  check('Prisma failures abort startup',()=>{
    const virtualExists=p=>p===join(root,client)?false:existsSync(p);
    assert.throws(()=>ensureLocalDevDatabase(root,env,{platform:'win32',exists:virtualExists,run:()=>({status:1})}),/generation failed/);
  });
  check('Prisma spawn errors abort startup',()=>{
    const virtualExists=p=>p===join(root,db)?false:existsSync(p);
    assert.throws(()=>ensureLocalDevDatabase(root,env,{platform:'win32',exists:virtualExists,run:()=>({error:new Error('ENOENT')})}),/initialization failed/);
  });
  console.log(`LOCAL_DEV_BOOTSTRAP ${n}/${n} PASS (mocked Prisma)`);
}finally{rmSync(root,{recursive:true,force:true});}
