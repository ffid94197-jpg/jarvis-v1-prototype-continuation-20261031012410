/* eslint-disable @typescript-eslint/no-require-imports */
/** Isolated unit+route probes. Not proof of live Windows/browser security. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.join(__dirname, '..');
let sequence = 0;
let principals = [];
const sessions = new Map();
const db = {
  principal: {
    findMany: async ({where}) => principals.filter(p => p.role === where.role),
    findFirst: async ({where}) => principals.find(p => p.role === where.role) ?? null,
    create: async ({data}) => {
      if (principals.some(p => p.id === data.id)) throw Error('duplicate owner');
      const p = { ...data }; principals.push(p); return p;
    },
    findUnique: async ({where}) => principals.find(p => p.id === where.id) ?? null,
    count: async ({where}) => principals.filter(p => p.role === where.role).length,
  },
  session: {
    create: async ({data}) => {
      const item = { id: `test-session-${++sequence}`, ...data, revokedAt: null, lastSeenAt: new Date() };
      sessions.set(item.tokenHash, item); return item;
    },
    findUnique: async ({where}) => {
      const s = sessions.get(where.tokenHash);
      return s && { ...s, principal: principals.find(p => p.id === s.principalId) } || null;
    },
    update: async ({where}) => [...sessions.values()].find(s => s.id === where.id),
  },
};
function load(relative, mocks={}) {
  const file=path.join(root,relative);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true},fileName:file,
  }).outputText;
  const m={exports:{}};
  new Function('require','module','exports',code)((name)=> Object.hasOwn(mocks,name) ? mocks[name] : require(name),m,m.exports);
  return m.exports;
}
const initialEnv = { ...process.env };
function restoreEnv(){
  for(const name of ['NODE_ENV','JARVIS_LOCAL_DEV_NO_LOGIN','JARVIS_LOCAL_DEV_BIND','JARVIS_PUBLIC_ORIGIN']){
    if(initialEnv[name] === undefined) delete process.env[name]; else process.env[name] = initialEnv[name];
  }
}
let passed=0;
function pass(name){passed++;console.log('PASS',name)}
function setGood(){
  process.env.NODE_ENV='development';
  process.env.JARVIS_LOCAL_DEV_NO_LOGIN='1';
  process.env.JARVIS_LOCAL_DEV_BIND='127.0.0.1';
  process.env.JARVIS_PUBLIC_ORIGIN='http://localhost:3000';
}
function request(headers={},token=null){
  const h=new Headers({host:'localhost:3000','sec-fetch-site':'same-origin',...headers});
  return {headers:h,cookies:{get(name){return name==='jarvis_session' && token?{value:token}:undefined}}};
}
(async()=>{
  try {
    setGood();
    const origin=load('src/lib/agent/auth/origin.ts');
    const auth=load('src/lib/agent/auth/session.ts',{'./origin':origin,'@/lib/db':{db}});
    const route=load('src/app/api/jarvis/auth/session/route.ts',{'@/lib/agent/auth/session':auth});
    assert.equal(auth.localDevNoLoginAllowed(request()),true);pass('dedicated localhost dev permitted');
    process.env.NODE_ENV='production';
    assert.equal(auth.localDevNoLoginAllowed(request()),false);pass('production never passwordless');
    setGood(); delete process.env.JARVIS_LOCAL_DEV_NO_LOGIN;
    assert.equal(auth.localDevNoLoginAllowed(request()),false);pass('opt-in absent denies');
    setGood(); delete process.env.JARVIS_LOCAL_DEV_BIND;
    assert.equal(auth.localDevNoLoginAllowed(request()),false);pass('unbound dev launcher denied');
    setGood();process.env.JARVIS_PUBLIC_ORIGIN='https://preview.example.test';
    assert.equal(auth.localDevNoLoginAllowed(request()),false);pass('public preview denied');
    setGood();assert.equal(auth.localDevNoLoginAllowed(request({host:'0.0.0.0:3000'})),false);pass('non-local host rejected');
    assert.equal(auth.localDevNoLoginAllowed(request({origin:'https://evil.example'})),false);pass('foreign origin rejected');
    assert.equal(auth.localDevNoLoginAllowed(request({'sec-fetch-site':'cross-site'})),false);pass('cross-site request rejected');
    assert.equal(auth.localDevNoLoginAllowed(request({'x-forwarded-host':'preview.example.test'})),false);pass('proxy host mismatch rejected');
    assert.equal(auth.localDevNoLoginAllowed(request({'x-forwarded-proto':'https'})),false);pass('proxy HTTPS rewrite rejected');
    assert.equal(auth.localDevNoLoginAllowed(request({referer:'https://evil.example/page'})),false);pass('foreign referer rejected');
    let result=await route.GET(request());
    assert.equal(result.status,200);
    const body=await result.json();
    assert.equal(body.authenticated,true);assert.equal(body.localDevelopment,true);
    assert.equal(body.principal.role,'OWNER');assert.equal(principals.length,1);
    const cookie=result.headers.get('set-cookie');assert.ok(cookie?.includes('HttpOnly'));
    assert.ok(cookie.includes('jarvis_session=jarvis_local_dev_'));
    pass('session GET creates one owner and HttpOnly dev cookie');
    const token=cookie.split('=')[1].split(';')[0];
    const verified=await auth.getAuthContext(request({},token));
    assert.equal(verified?.principalId,principals[0].id);pass('dev cookie runs through real session validation');
    delete process.env.JARVIS_LOCAL_DEV_NO_LOGIN;
    assert.equal(await auth.getAuthContext(request({},token)),null);pass('dev cookie revoked logically when mode disabled');
    setGood();
    const result2=await route.GET(request());
    assert.equal(result2.status,200);assert.equal(principals.length,1);pass('existing owner reused; no duplicate enrollment');
    const protectedReq=request({},token);
    assert.equal((await auth.requireActiveSession(protectedReq)).ok,true);pass('task guard accepts a real dev session only in local mode');
    const crossTask=await auth.requireActiveSession(request({origin:'https://evil.example'},token));
    assert.equal(crossTask.ok,false);pass('task guard still rejects foreign-origin effects');
    const remote=await route.GET(request({host:'remote.example'}));
    assert.equal(remote.status,401);pass('remote GET does not auto-login');
    principals[0].status='REVOKED';
    const denied=await route.GET(request());
    assert.equal(denied.status,503);pass('revoked owner remains revoked');
    principals[0].status='ACTIVE';
    principals.push({id:'conflicting-owner',role:'OWNER',status:'ACTIVE',label:'other'});
    const conflict=await route.GET(request());
    assert.equal(conflict.status,503);pass('conflicting owners never auto-login');
    console.log(`LOCAL_DEV_NO_LOGIN: ${passed}/20 PASS (mock database and HTTP route, not Windows integration)`);
  } finally { restoreEnv(); }
})().catch(err=>{console.error(err);process.exitCode=1});
