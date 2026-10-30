/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Offline AUTH CONTRACT PROBE against the real session module with a small
 * in-memory Prisma mock. This does NOT prove actual DB concurrency or live
 * HTTP/browser login. Run after reviewed npm installation:
 *   node scripts/gpt6-auth-contract-probe.cjs
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.join(__dirname,'..');
const principals = new Map(); const sessions = new Map();
let sequence=0;
const db={
  principal:{
    findFirst:async ({where})=>[...principals.values()].find(p=>p.role===where.role)||null,
    create:async ({data})=>{const id=data.id||`owner-${++sequence}`;if(principals.has(id))throw Error('duplicate');const p={id,...data};principals.set(id,p);return p;},
    count:async ({where})=>[...principals.values()].filter(p=>p.role===where.role).length,
    findMany:async ({where})=>[...principals.values()].filter(p=>p.role===where.role),
    findUnique:async ({where})=>principals.get(where.id)||null,
    update:async ({where,data})=>{const p=principals.get(where.id);if(!p)throw Error('missing');Object.assign(p,data);return p;},
  },
  session:{
    create:async ({data})=>{const id=`session-${++sequence}`; const s={id,...data,revokedAt:null};sessions.set(data.tokenHash,s);return s;},
    findUnique:async ({where})=>{const s=sessions.get(where.tokenHash);return s?{...s,principal:principals.get(s.principalId)}:null;},
    update:async ({where,data})=>{let s=[...sessions.values()].find(s=>s.id===where.id);if(!s)throw Error('missing');Object.assign(s,data);return s;},
    updateMany:async ({where,data})=>{let s=sessions.get(where.tokenHash);if(s&&!s.revokedAt){Object.assign(s,data);return {count:1}};return {count:0}},
  },
};
function load(relative, mocks={}){
 const file=path.join(root,relative);
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{
   compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true},fileName:file
 }).outputText;
 const m={exports:{}};
 const localRequire=(name)=>Object.hasOwn(mocks,name)?mocks[name]:require(name);
 new Function('require','module','exports',code)(localRequire,m,m.exports);
 return m.exports;
}
const original={...process.env};
let completed=0;
function success(name){console.log('PASS AUTH',name);completed++}
(async()=>{
 try{
  const origin=load('src/lib/agent/auth/origin.ts');
  const session=load('src/lib/agent/auth/session.ts',{'./origin':origin,'@/lib/db':{db}});
  const password='A unique 2026 test passphrase!';
  const setup='LOCAL_FIXTURE_TEST_TOKEN_NEVER_DEPLOY';
  const salt=crypto.randomBytes(16);
  process.env.JARVIS_PUBLIC_ORIGIN='https://preview.example.test';
  process.env.JARVIS_SETUP_TOKEN_SHA256=crypto.createHash('sha256').update(setup).digest('hex');
  process.env.JARVIS_OWNER_SCRYPT_HASH=`scrypt:${salt.toString('hex')}:${crypto.scryptSync(password,salt,64).toString('hex')}`;
  assert.equal(session.enrollmentConfigured(),true);success('enrollment requires explicit private config');
  let invalid=await session.bootstrapOwner('BAD_TOKEN');assert.equal(invalid.ok,false);assert.equal(principals.size,0);success('unknown setup credential rejected');
  const enrolled=await session.bootstrapOwner(setup);assert.equal(enrolled.ok,true);assert.equal(principals.size,1);success('authorized first owner enrolled');
  const repeated=await session.bootstrapOwner(setup);assert.equal(repeated.ok,false);assert.equal(principals.size,1);success('repeat first-owner claim blocked');
  const wrong=await session.loginOwner('badpassphrase999');assert.equal(wrong.ok,false);assert.equal(wrong.status,401);success('invalid owner password rejected');
  const login=await session.loginOwner(password);assert.equal(login.ok,true);success('correct owner passphrase yields session');
  const secureCookie=session.sessionCookieHeader(login.token);assert.ok(secureCookie.includes('HttpOnly'));assert.ok(secureCookie.includes('Secure'));success('HTTPS session cookie hardened');
  const req={cookies:{get:(k)=>k===session.SESSION_COOKIE?{value:login.token}:undefined}};
  const owner=await session.getAuthContext(req);assert.equal(owner.principalId,login.ctx.principalId);success('opaque cookie authenticates active owner');
  await session.revokeCurrentSession(req);const revoked=await session.getAuthContext(req);assert.equal(revoked,null);success('logout revokes the exact session');
  console.log(`AUTH CONTRACT PROBES: ${completed}/9 PASS (mock DB only; live E2E NOT TESTED)`);
 }finally{
  for(const k of ['JARVIS_PUBLIC_ORIGIN','JARVIS_SETUP_TOKEN_SHA256','JARVIS_OWNER_SCRYPT_HASH']){if(original[k]===undefined)delete process.env[k];else process.env[k]=original[k]}
 }
})().catch(e=>{console.error(e);process.exitCode=1})
