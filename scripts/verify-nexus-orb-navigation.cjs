/* Source-backed orb landing navigation contract; not a live-browser test. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const page=read('src/app/page.tsx'),orb=read('src/components/JarvisOrb.tsx'),chat=read('src/components/AssistantPanel.tsx'),css=read('src/app/globals.css'),scene=read('src/lib/orbScene.ts'),models=read('src/components/ModelManager.tsx');
let passed=0;const test=(label,fn)=>{fn();passed++;console.log('PASS '+label)};
test('landing view is orb (not console)',()=>assert.match(page,/const \[view, setView\] = useState<"orb" \| "console">\("orb"\)/));
test('exact existing Three.js scene is used',()=>{assert.match(orb,/createOrbScene\(container\)/);assert.match(scene,/new THREE\.WebGLRenderer/);});
test('orb mounted only when owner ready and home selected',()=>assert.match(page,/authState === "ready" && view === "orb"/));
test('orb action enters console',()=>{assert.match(page,/onToggleMode=\{\(\) => setView\("console"\)\}/);assert.match(orb,/>\s*CONSOLE\s*<\/button>/);});
test('orb screen has no settings control',()=>assert.doesNotMatch(orb,/SETTINGS|onOpenSettings|ModelManager/));
test('console only appears after entering console',()=>assert.match(page,/open=\{authState === "ready" && view === "console"\}/));
test('chat has return to orb control',()=>{assert.match(chat,/onReturnHome: \(\) => void/);assert.match(chat,/onClick=\{onReturnHome\}/);assert.match(page,/onReturnHome=\{\(\) => \{setSettingsOpen\(false\);setView\("orb"\);\}\}/);});
test('settings only available from chat',()=>{assert.match(chat,/onClick=\{onOpenSettings\}/);assert.match(page,/onOpenSettings=\{\(\) => setSettingsOpen\(true\)\}/);});
test('settings scroll behavior remains intact',()=>{assert.match(css,/\.nexus-settings-content \{[^}]*overflow-y:auto/s);assert.match(models,/id="nexus-api-key"/);});
test('orb button centered below hologram at all sizes',()=>{assert.match(css,/\.nexus-orb-home \.hud-switch \{[^}]*left:50%;bottom:/s);assert.match(css,/translateX\(-50%\)/);});
test('existing orb scene not replaced with an image',()=>assert.doesNotMatch(page,/<img[^>]+orb|<svg[^>]+orb/i));
console.log(`NEXUS_ORB_NAVIGATION ${passed}/${passed} PASS (source contract; live rendering not tested)`);
