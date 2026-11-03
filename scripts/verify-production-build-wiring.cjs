#!/usr/bin/env node
/** Source contract test only; this does NOT compile Next. */
const fs=require('node:fs'); const path=require('node:path');
const app=path.resolve(__dirname,'..');
// The release scripts historically lived one level ABOVE the app in the owner's
// Windows layout (...\JARVIS-V1-Developer\app), so they were never committed and
// this gate could not run from the repository alone. They are now committed at
// the repo root as well; accept either location, preferring the repository.
const bundle=[app,path.resolve(app,'..')].find(dir=>fs.existsSync(path.join(dir,'BUILD_JARVIS_PRODUCTION.ps1')));
if(!bundle)throw Error('BUILD_JARVIS_PRODUCTION.ps1 not found in the repository root or its parent directory');
const pkg=JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8'));
const build=fs.readFileSync(path.join(bundle,'BUILD_JARVIS_PRODUCTION.ps1'),'utf8');
const install=fs.readFileSync(path.join(bundle,'INSTALL_JARVIS_V1.ps1'),'utf8');
const cli=fs.readFileSync(path.join(bundle,'INSTALL_JARVIS_V1.cmd'),'utf8');
const guard=fs.readFileSync(path.join(app,'scripts/verify-production-build.mjs'),'utf8');
let n=0;const t=(cond,label)=>{if(!cond)throw Error(label);n++;console.log('PASS '+label);};
t(pkg.scripts.build.includes('next build')&&pkg.scripts.build.includes('verify-production-build.mjs'),'Next build includes artifact gate');
t(pkg.scripts.typecheck==='tsc --noEmit','typecheck strict command');
t(build.includes('npm.cmd run db:generate'),'Prisma generation in production build');
t(build.includes('npm.cmd run build'),'real Next build invoked');
t(build.includes('npm.cmd run typecheck'),'real TypeScript typecheck invoked');
t(build.includes("WriteStatus 'FAIL'"),'failure records non-PASS attestation');
t(build.includes("$env:JARVIS_LOCAL_DEV_NO_LOGIN='0'"),'development login bypass disabled');
t(install.includes('BUILD_JARVIS_PRODUCTION.ps1')&&install.includes('SkipProductionBuild'),'main installer attempts build');
t(cli.includes('%*'),'installer arguments reach PowerShell');
t(guard.includes('required-server-files.json')&&guard.includes('standalone'),'guard requires compiled output');
console.log(`PRODUCTION_BUILD_WIRING ${n}/${n} PASS (source contracts, not real build)`);
