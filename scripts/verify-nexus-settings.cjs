/* Source-backed NEXUS console-first/settings integration gates. Not a live-browser test. */
'use strict';
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), read=p=>fs.readFileSync(path.join(root,p),'utf8');
const page=read('src/app/page.tsx'), chat=read('src/components/AssistantPanel.tsx'), models=read('src/components/ModelManager.tsx'), devices=read('src/components/DeviceManager.tsx');
const css=read('src/app/globals.css'), auth=read('src/lib/agent/auth/session.ts'), local=read('scripts/start-local-no-login.mjs'), pkg=JSON.parse(read('package.json'));
let pass=0;const check=(title,fn)=>{fn();pass++;console.log('PASS',title)};
check('NEXUS defaults to original orb, console appears only after navigation',()=>{assert.match(page,/useState<"orb" \| "console">\("orb"\)/);assert.match(page,/<JarvisOrb activity=\{activity\} mode="orb"/);assert.match(page,/view === "console"/);assert.match(page,/<AssistantPanel/);assert.doesNotMatch(page,/nexus-settings-launcher/);});
check('Chat header provides orb return and settings trigger',()=>{assert.match(chat,/className="nexus-chat-orb-button"/);assert.match(chat,/onClick={onReturnHome}/);assert.match(chat,/className="nexus-chat-settings-button"/);assert.match(chat,/onClick={onOpenSettings}/);assert.doesNotMatch(chat,/showSettings|showMemory|showRoutines|assist-dl/);});
check('Chat keeps send, cancel, durable resume and execution traces',()=>{for(const token of ['onSend(value)','onCancel','onResume(m.taskId','aria-label="Task execution trace"','assist-input-row'])assert.ok(chat.includes(token),token)});
check('Settings modal is labelled and dismissible',()=>{assert.match(page,/aria-modal="true"/);assert.match(page,/onMouseDown/);assert.match(page,/setSettingsOpen\(false\)/)});
check('Focus trap and scroll lock',()=>{assert.match(page,/dialog.querySelectorAll/);assert.match(page,/document.body.style.overflow = 'hidden'/);});
check('Settings persists without exposing hidden controls',()=>{assert.match(page,/nexus-settings-overlay--closed/);assert.match(page,/inert={!settingsOpen}/);assert.match(css,/\.nexus-settings-overlay--closed \{display:none!important/)});
check('Settings scrolls within flex layout',()=>{assert.match(css,/\.nexus-settings-content \{[^}]*overflow-y:auto/s);assert.match(css,/\.nexus-settings-layout \{[^}]*min-height:0/s);});
check('Settings mobile navigation scrolls horizontally',()=>assert.match(css,/\.nexus-settings-nav\{display:flex;flex-direction:row;overflow-x:auto/));
check('Model editor uses responsive two-column layout',()=>{assert.match(css,/\.nexus-models-layout \{display:grid/);assert.match(css,/@media\(max-width:900px\)\{\.nexus-models-layout/);});
check('Gemini selected as initial template',()=>assert.match(models,/useState<Input>\(\{\.\.\.templates.gemini/));
check('Gemini API key highlighted before connection fields',()=>{let key=models.indexOf('id="nexus-api-key"');let url=models.indexOf('<label>Provider API base URL');assert.ok(key>0&&url>key)});
check('Secret input is masked',()=>assert.match(models,/id="nexus-api-key"[^>]*type="password"/));
check('Secret required for newly added cloud accounts',()=>assert.match(models,/required={form.location==="api"&&!form.id}/));
check('Existing encrypted key retained on edit',()=>assert.match(models,/form.id\?"Leave blank to keep the existing encrypted key"/));
check('Secret cleared on Settings close',()=>{assert.match(models,/setForm\(current => \(\{\.\.\.current,apiKey:""\}\)\)/);assert.match(models,/if\(!settingsOpen\)/);});
check('Save and provider test use current backend',()=>{assert.match(models,/fetch\("\/api\/jarvis\/models"/);assert.match(models,/action:"save",profile:form/);assert.match(models,/action:"test",id/)});
check('LAYA settings use existing backend',()=>{assert.match(models,/action:"routing",routing/);assert.match(models,/action:"laya-test"/)});
check('Owner voice & face enrollment remains available',()=>{assert.match(models,/<OwnerVoiceSettings\/>/);assert.match(models,/<PerceptionPanel/)});
check('Voice wake controls mounted when Settings hidden',()=>{assert.match(models,/<div hidden={tab!=="voice"}/);assert.match(models,/<WakeStrip/);assert.match(page,/aria-hidden={!settingsOpen}/)});
check('Voice test uses real TTS route',()=>assert.match(models,/fetch\("\/api\/jarvis\/tts"/));
check('Memory management moved into Settings',()=>{assert.match(models,/<MemoryManager/);assert.doesNotMatch(chat,/<MemoryManager/)});
check('Routines moved into Settings',()=>{assert.match(models,/<RoutineManager/);assert.doesNotMatch(chat,/<RoutineManager/)});
check('Skills and MCP moved into Settings',()=>assert.match(models,/<IntegrationsPanel/));
check('Screen preview stays opt-in and protected by API',()=>{assert.match(models,/screenVisible&&<img/);assert.match(models,/\/api\/jarvis\/windows\/live/)});
check('Devices use real authenticated API',()=>{assert.match(devices,/fetch\("\/api\/jarvis\/auth\/devices"/);assert.match(devices,/principalId:device.id,action/)});
check('Device mutations require human confirmation',()=>assert.match(devices,/window.confirm/));
check('Guardian policies not faked as editable',()=>assert.match(models,/Policy editing is deliberately unavailable/));
check('System provider/session diagnostics exist',()=>{assert.match(models,/CHECK SESSION & PROVIDERS/);assert.match(models,/\/api\/jarvis\/auth\/session/)});
check('Project download moved to Settings',()=>{assert.match(models,/nexus-settings-project-download/);assert.doesNotMatch(chat,/JARVIS_V1_project.zip/)});
check('Local dev defaults passwordless but production separated',()=>{assert.equal(pkg.scripts.dev,'node scripts/start-local-no-login.mjs');assert.notEqual(pkg.scripts.start,pkg.scripts.dev);assert.match(local,/localDevEnvironment\(process\.env\)/);assert.match(fs.readFileSync(path.join(root,'scripts/local-dev-bootstrap.mjs'),'utf8'),/NODE_ENV==='production'/);assert.match(local,/'-H','127\.0\.0\.1'/);});
check('Isolated local SQLite DB provisioned without overwrite',()=>{assert.match(local,/ensureLocalDevDatabase/);assert.match(fs.readFileSync(path.join(root,'scripts/local-dev-bootstrap.mjs'),'utf8'),/if\(!exists\(db\)\) prisma/)});
check('Guardian session validation retained',()=>assert.match(auth,/getAuthContext/));
check('No plaintext secrets or credentials added to UI',()=>{assert.doesNotMatch(models,/console\.log\([^)]*apiKey/);assert.doesNotMatch(page,/(?:AIza[A-Za-z0-9_-]{30,})/)});
check('Detailed responsive mobile layout',()=>assert.match(css,/@media\(max-width:700px\)/));
// ——— Part 9: the autonomy tier control must be wired to the runtime ————————
const autonomyPanel=fs.readFileSync(path.join(root,'src/components/AutonomyTierPanel.tsx'),'utf8');
check('Autonomy tier control is mounted inside the existing Autonomy & Routines tab',()=>{
  assert.match(models,/import AutonomyTierPanel from "\.\/AutonomyTierPanel"/);
  assert.match(models,/\{tab==="routines" && <><AutonomyTierPanel\/><RoutineManager/);
});
check('Mounting the panel does not displace the routines manager or the orb',()=>{
  assert.match(models,/<RoutineManager onClose=\{closeSettings\}\/>/);
  assert.match(page,/useState<"orb" \| "console">\("orb"\)/);
});
check('Autonomy panel reads and writes the real runtime endpoint',()=>{
  assert.match(autonomyPanel,/fetch\('\/api\/jarvis\/autonomy',\s*\{\s*cache:\s*'no-store'\s*\}\)/);
  assert.match(autonomyPanel,/method: 'POST'/);
  assert.match(autonomyPanel,/JSON\.stringify\(\{ tier: chosen, stepBudget, replanBudget \}\)/);
});
check('Autonomy panel reports the profile ACTUALLY in effect, not the requested one',()=>{
  assert.match(autonomyPanel,/In effect now:/);
  assert.match(autonomyPanel,/state\.profile\.stepBudget/);
  assert.match(autonomyPanel,/state\.source/);
  assert.match(autonomyPanel,/await refresh\(\)/);
});
check('Autonomy panel states plainly that it grants no permission',()=>{
  assert.match(autonomyPanel,/What this does not do\./);
  assert.match(autonomyPanel,/repeatLimitFixedAcrossAllTiers/);
  assert.match(autonomyPanel,/not adjustable here/);
  assert.match(autonomyPanel,/durably <em>paused<\/em>, not failed/);
});
check('Autonomy panel surfaces server-side clamping and ignored untrusted rows',()=>{
  assert.match(autonomyPanel,/untrustedRowIgnored/);
  assert.match(autonomyPanel,/cannot raise autonomy/);
  assert.match(autonomyPanel,/clamped server-side/);
  assert.match(autonomyPanel,/state\.warnings\.map/);
});
check('Autonomy panel keeps honest loading and error states',()=>{
  assert.match(autonomyPanel,/Autonomy service unavailable\./);
  assert.match(autonomyPanel,/role="alert"/);
  assert.match(autonomyPanel,/RETRY/);
});
check('Autonomy panel exposes no permission-like control',()=>{
  for(const forbidden of ['skipGuardian','bypassGuardian','allowAll','disableGuardian','grantPermission'])
    assert.ok(!autonomyPanel.includes(forbidden),forbidden);
});
console.log(`NEXUS_CONSOLE_SETTINGS ${pass}/${pass} PASS (source contracts; not live browser)`);
