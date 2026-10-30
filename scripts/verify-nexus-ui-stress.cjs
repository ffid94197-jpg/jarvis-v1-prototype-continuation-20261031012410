/* Seeded, abstract UI-state stress model; does NOT execute React or a live browser.
 * Source contracts must be run first so this model is anchored to actual handlers.
 */
'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');const models=fs.readFileSync(path.join(root,'src/components/ModelManager.tsx'),'utf8');const page=fs.readFileSync(path.join(root,'src/app/page.tsx'),'utf8');
const tabs=['models','routing','owner','voice','integrations','memory','routines','screen','guardian','system'];
for(const t of tabs)assert.ok(models.includes(`["${t}"`) || models.includes(`"${t}",`),`missing tab ${t}`);
assert.match(page,/nexus-settings-overlay--closed/);assert.match(page,/<JarvisOrb activity=\{activity\} mode="orb"/);assert.match(models,/id="nexus-api-key"/);
const templates=['gemini','openai','anthropic','ollama','lmstudio'];
for(const t of templates)assert.ok(models.includes(`${t}: {label:`),`missing template ${t}`);
let seed=0x91cafe23;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
const randomInt=n=>rnd()%n;
let scenarios=0, transitions=0,closed=0,secrets=0,nav=0,requests=0, guarded=0,orbEntries=0,consoleEntries=0,blockedOrbSettings=0;
for(let i=0;i<100000;i++){
  const s={ready:true,view:'orb',open:false,tab:'models',apiKey:'',provider:'gemini',cloud:true,busy:false,wake:false,screen:false};
  for(let j=0;j<12;j++){
    let event=randomInt(12);transitions++;
    switch(event){
      case 0:if(s.ready && s.view==='console')s.open=true;else blockedOrbSettings++;break;
      case 1:s.open=false;s.apiKey='';s.screen=false;closed++;break;
      case 2:if(s.open){s.tab=tabs[randomInt(tabs.length)];nav++;}break;
      case 3:if(s.open && s.tab==='models'){s.provider=templates[randomInt(templates.length)];s.apiKey='';s.cloud=!['ollama','lmstudio'].includes(s.provider);}break;
      case 4:if(s.open && s.tab==='models'){s.apiKey='test_secret_must_not_leak';secrets++;}break;
      case 5:if(s.open && s.tab==='models'){let valid=!s.cloud||s.apiKey.length>0;if(valid&&!s.busy)requests++;else guarded++;}break;
      case 6:if(s.open && s.tab==='voice')s.wake=!s.wake;break;
      case 7:if(s.open && s.tab==='screen')s.screen=!s.screen;break;
      case 8:s.busy=!s.busy;break;
      case 9:if(s.open && s.tab==='system')requests++;break;
      case 10:if(s.ready && s.view==='orb'){s.view='console';consoleEntries++;}break;
      case 11:if(s.view==='console'&&!s.open){s.view='orb';orbEntries++;}break;
    }
    assert.ok(tabs.includes(s.tab));
    assert.ok(['orb','console'].includes(s.view));
    if(s.view==='orb')assert.equal(s.open,false,'Settings must not open over orb home');
    if(!s.open){assert.equal(s.apiKey,'','Unsaved credentials persist after close');assert.equal(s.screen,false,'Closing settings should stop screen preview');}
    if(s.provider==='ollama'||s.provider==='lmstudio')assert.equal(s.cloud,false);
  }
  scenarios++;
}
console.log(JSON.stringify({test:'NEXUS_UI_STATE_MODEL_STRESS',scenarios,transitions,settingsClosed:closed,orbEntries,consoleEntries,blockedOrbSettings,secretEntries:secrets,tabNavigation:nav,simulatedRequests:requests,guardedRequests:guarded,verdict:'PASS',limitations:'Abstract state model + source contracts. Not React rendering, real browser, live credentials, or API network'},null,2));
