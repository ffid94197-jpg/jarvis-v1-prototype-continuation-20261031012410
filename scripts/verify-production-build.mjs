#!/usr/bin/env node
/** Validate a REAL Next standalone production build; offline self-test creates fixtures only. */
import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function digest(filename) { return createHash('sha256').update(readFileSync(filename)).digest('hex'); }
function fileOk(filename) { return existsSync(filename) && statSync(filename).isFile() && statSync(filename).size > 0; }
function hasNonemptyFile(dir) { if(!existsSync(dir) || !statSync(dir).isDirectory())return false; for(const e of readdirSync(dir,{withFileTypes:true})){const f=join(dir,e.name);if(e.isFile() && fileOk(f))return true;if(e.isDirectory() && hasNonemptyFile(f))return true;}return false; }
export function inspectProductionBuild(projectRoot, opts={}) {
  const prefix=join(projectRoot,'.next');
  const required={
    nextBuildId:join(prefix,'BUILD_ID'),
    standaloneServer:join(prefix,'standalone','server.js'),
    nextRuntimeManifest:join(prefix,'required-server-files.json'),
    staticAssets:join(prefix,'standalone','.next','static'),
    prismaSchema:join(projectRoot,'prisma','schema.prisma'),
    dependencyLock:join(projectRoot,'package-lock.json'),
  };
  const checks=Object.fromEntries(Object.entries(required).map(([k,v])=>[k,k==='staticAssets' ? hasNonemptyFile(v) : fileOk(v)]));
  if(checks.nextBuildId) {
    const id=readFileSync(required.nextBuildId,'utf8').trim();
    checks.nextBuildId=/^[a-zA-Z0-9_-]{6,128}$/.test(id);
  }
  let manifestsValid=false;
  if(checks.nextRuntimeManifest){try{const f=JSON.parse(readFileSync(required.nextRuntimeManifest,'utf8'));manifestsValid=!!f&&typeof f==='object';}catch{}}
  checks.manifestParses=manifestsValid;
  const passed=Object.values(checks).every(Boolean);
  return {passed,checks,artifacts:Object.fromEntries(Object.entries(required).filter(([k,v])=>k!=='staticAssets' && fileOk(v)).map(([k,v])=>[k,{sha256:digest(v),bytes:statSync(v).size}]))};
}
function test(){
  const t=mkdtempSync(join(tmpdir(),'jarvis-prod-gate-'));
  const req=['.next/BUILD_ID','.next/standalone/server.js','.next/required-server-files.json','prisma/schema.prisma','package-lock.json','.next/standalone/.next/static/hello.txt'];
  let cases=0;
  try{
    if(inspectProductionBuild(t).passed)throw Error('missing artifacts accepted');cases++;
    for(const r of req){const f=join(t,r);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,r.endsWith('BUILD_ID')?'fixtureB1':r.endsWith('.json')?'{}':'fixture');}
    if(!inspectProductionBuild(t).passed)throw Error('valid fixture rejected');cases++;
    for(const r of req){const f=join(t,r);const original=readFileSync(f);writeFileSync(f,'');if(inspectProductionBuild(t).passed)throw Error('empty '+r+' accepted');writeFileSync(f,original);cases++;}
    writeFileSync(join(t,'.next/BUILD_ID'),'invalid with spaces');if(inspectProductionBuild(t).passed)throw Error('invalid build id accepted');cases++;
    writeFileSync(join(t,'.next/BUILD_ID'),'fixtureB1');
    writeFileSync(join(t,'.next/required-server-files.json'),'{oops');if(inspectProductionBuild(t).passed)throw Error('invalid manifest accepted');cases++;
    if (process.env.JARVIS_LOCAL_DEV_NO_LOGIN==='1' && process.env.NODE_ENV==='production') { /* production auth guard belongs to runtime */ }
    console.log(`JARVIS_PRODUCTION_BUILD_ARTIFACT_GATE ${cases}/${cases} PASS (synthetic fixtures, NOT a real production build)`);
  } finally { rmSync(t,{recursive:true,force:true}); }
}
const args=process.argv.slice(2);
if(args.includes('--self-test'))test();
else if(args.includes('--check')) {
  const target=resolve(args[args.indexOf('--check')+1]||root);
  const report=inspectProductionBuild(target);
  const data={schemaVersion:1,kind:'next-standalone-artifact-check',projectPath:target,generatedAtUtc:new Date().toISOString(),...report,
    limitation:'Standalone build artifacts only; no native LPAC, full application functionality, release signing or V1 certification.'};
  if(args.includes('--output')) {const out=resolve(args[args.indexOf('--output')+1]);mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(data,null,2)+'\n');}
  console.log(JSON.stringify(data,null,2));if(!report.passed)process.exitCode=2;
} else { console.error('Usage: node scripts/verify-production-build.mjs --self-test | --check <root> [--output <file>]');process.exitCode=2; }
