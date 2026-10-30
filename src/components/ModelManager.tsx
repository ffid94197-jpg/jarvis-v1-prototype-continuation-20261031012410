"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import PerceptionPanel from "./PerceptionPanel";
import IntegrationsPanel from "./IntegrationsPanel";
import {OwnerVoiceSettings, WakeStrip} from "./OwnerVoice";
import MemoryManager from "./MemoryManager";
import RoutineManager from "./RoutineManager";
import DeviceManager from "./DeviceManager";
type Protocol = "openai-compatible" | "ollama" | "anthropic";
type Location = "api" | "local";
type Ratings={reasoning:number;coding:number;vision:number;speed:number;cost:number};
type Routing={mode:"auto"|"manual";privacy:"auto"|"local-only"|"cloud-allowed";layaEnabled:boolean;layaUrl:string;weights:{quality:number;speed:number;cost:number}};
const ratingsDefault:Ratings={reasoning:3,coding:3,vision:3,speed:3,cost:3};
const routingDefault:Routing={mode:"auto",privacy:"auto",layaEnabled:true,layaUrl:"http://127.0.0.1:8000",weights:{quality:5,speed:3,cost:2}};
type Profile = {id:string;label:string;location:Location;protocol:Protocol;baseUrl:string;model:string;hasApiKey:boolean;ratings?:Ratings;enabled?:boolean};
type ModelList = {activeId:string|null;profiles:Profile[];routing:Routing};
type Input = {id?:string;label:string;location:Location;protocol:Protocol;baseUrl:string;model:string;apiKey:string;ratings:Ratings;enabled:boolean};
const templates = {
  gemini: {label:"Google Gemini",location:"api" as const,protocol:"openai-compatible" as const,baseUrl:"https://generativelanguage.googleapis.com/v1beta/openai",model:"gemini-3.5-flash-lite"},
  openai: {label:"OpenAI",location:"api" as const,protocol:"openai-compatible" as const,baseUrl:"https://api.openai.com/v1",model:"gpt-4.1-mini"},
  anthropic: {label:"Anthropic",location:"api" as const,protocol:"anthropic" as const,baseUrl:"https://api.anthropic.com/v1",model:"claude-sonnet-4-5"},
  ollama: {label:"Local Ollama",location:"local" as const,protocol:"ollama" as const,baseUrl:"http://127.0.0.1:11434",model:"qwen3:4b"},
  lmstudio: {label:"Local OpenAI-compatible",location:"local" as const,protocol:"openai-compatible" as const,baseUrl:"http://127.0.0.1:1234/v1",model:"your-loaded-model-id"},
};
const blank: Input = {label:"",location:"api",protocol:"openai-compatible",baseUrl:"",model:"",apiKey:"",ratings:ratingsDefault,enabled:true};
export default function ModelManager({settingsOpen,onClose,busyTask,onCommand,latestReply}:{settingsOpen:boolean;onClose:()=>void;busyTask:boolean;onCommand:(text:string)=>void;latestReply?:string}) {
  const [state,setState] = useState<ModelList>({activeId:null,profiles:[],routing:routingDefault});
  const [form,setForm] = useState<Input>({...templates.gemini,apiKey:"",ratings:ratingsDefault,enabled:true});
  const [working,setWorking] = useState(false);
  const [tab,setTab] = useState<"routing"|"models"|"owner"|"integrations"|"system"|"memory"|"routines"|"voice"|"screen"|"guardian">("models");
  const [screenVisible,setScreenVisible] = useState(false);
  const [routing,setRouting] = useState<Routing>(routingDefault);
  const [message,setMessage] = useState("");
  const [testing,setTesting] = useState<string|null>(null);
  const [previewTask,setPreviewTask] = useState("Debug a complex TypeScript application");
  const [previewResult,setPreviewResult] = useState("");
  const [diagnostics,setDiagnostics] = useState("");
  const [testVoiceBusy,setTestVoiceBusy] = useState(false);
  const closeSettings = () => {setForm(current => ({...current,apiKey:""}));setScreenVisible(false);onClose();};
  // The persistent modal keeps wake recognition alive, but must never keep
  // unfinished provider credentials or an open screen feed after dismissal.
  useEffect(()=>{if(!settingsOpen){setForm(current=>current.apiKey?{...current,apiKey:""}:current);setScreenVisible(false);}},[settingsOpen]);
  const reload = useCallback(async () => {
    const r=await fetch("/api/jarvis/models",{cache:"no-store"});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error || "Model manager unavailable.");
    setState(d);
    setRouting(d.routing ?? routingDefault);
  },[]);
  useEffect(()=>{void reload().catch(e=>setMessage(e.message));},[reload]);
  async function action(b:Record<string,unknown>) {
    const r=await fetch("/api/jarvis/models", {method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});
    const d=await r.json(); if(!r.ok) throw new Error(d.error || "Model operation failed.");
    return d;
  }
  async function save(ev:FormEvent<HTMLFormElement>) {
    ev.preventDefault();if(working||busyTask)return;
    setWorking(true);setMessage("");
    try { await action({action:"save",profile:form});setForm(blank);await reload();setMessage("Model profile saved. LAYA evaluates it for new tasks when Auto is selected."); }
    catch(e){setMessage(e instanceof Error?e.message:"Save failed.");}
    finally{setWorking(false);}
  }
  async function mutate(actionName:"activate"|"delete",id:string|null) {
    if(working||busyTask)return;
    setWorking(true);setMessage("");
    try {await action({action:actionName,id});await reload();setMessage(actionName==="activate"?"Manual pick updated. Switch routing mode to MANUAL to use this pick; AUTO uses LAYA.":"Model profile deleted.");}
    catch(e){setMessage(e instanceof Error?e.message:"Operation failed.");}
    finally{setWorking(false);}
  }
  async function saveRouting(ev:FormEvent<HTMLFormElement>){
    ev.preventDefault(); if(working||busyTask)return;
    setWorking(true);setMessage("");
    try {await action({action:"routing",routing});await reload();setMessage("LAYA routing settings saved. New tasks use these preferences; resumed tasks retain their original model.");}
    catch(e){setMessage(e instanceof Error?e.message:"Routing settings rejected.");}
    finally{setWorking(false);}
  }
  async function test(id:string) {
    if(testing || working) return;
    setTesting(id);setMessage("Sending one small model request. This may consume API quota.");
    try {const d=await action({action:"test",id});setMessage(d.ok?`Connection verified in ${d.latencyMs} ms.`:"Model did not respond.");}
    catch(e){setMessage(e instanceof Error?e.message:"Connection test failed.");}
    finally{setTesting(null);}
  }
  const inputStyle = {background:"#140e09",color:"#ffce71",border:"1px solid #986c2b",padding:"9px",width:"100%"} as const;
  const buttonStyle = {background:"#2b1c09",border:"1px solid #986c2b",color:"#ffca62",padding:"7px 10px",cursor:"pointer"} as const;
  return <section aria-label="JARVIS Settings workspace" className="nexus-settings-shell">
    <header className="nexus-settings-topbar">
      <div className="nexus-settings-brand"><span className="nexus-settings-emblem" aria-hidden="true">⚙</span><div><strong>JARVIS / SETTINGS</strong><small>Personalize your autonomous assistant</small></div></div>
      <button type="button" onClick={closeSettings} className="nexus-settings-return" aria-label="Return to chat">← RETURN TO CHAT</button>
    </header>
    <div className="nexus-settings-layout">
    <nav aria-label="Settings sections" className="nexus-settings-nav">
      {([
        ["models","◈", "AI Providers & API Keys"],
        ["routing","◇", "LAYA Model Routing"],
        ["owner","◎", "Face & Voice Identity"],
        ["voice","◉", "Voice & Wake Word"],
        ["integrations","⌘", "Skills, MCP & Tools"],
        ["memory","▤", "Memory Management"],
        ["routines","◷", "Autonomy & Routines"],
        ["screen","▣", "Screen & Devices"],
        ["guardian","◆", "Guardian & Security"],
        ["system","⚙", "System & Diagnostics"],
      ] as const).map(([key,icon,label])=><button key={key} type="button" className="nexus-settings-nav-item" aria-current={tab===key?"page":undefined} aria-pressed={tab===key} onClick={()=>{setTab(key);if(key!=="screen")setScreenVisible(false);}}><span aria-hidden="true">{icon}</span>{label}</button>)}
      <p className="nexus-settings-nav-note">Changes are saved through authenticated JARVIS APIs. Guardian permissions remain enforced.</p>
    </nav>
    <div className="nexus-settings-content" role="region" aria-label="Active settings page" tabIndex={0}>
      <div className="nexus-settings-page-head">
        <span className="nexus-settings-eyebrow">CONTROL CENTER / {tab.toUpperCase()}</span>
        <h2>{({models:"AI Providers & API Keys",routing:"LAYA Intelligence Router",owner:"Owner Face & Voice Enrollment",voice:"Speech & Wake Controls",integrations:"Agent Skills & Integrations",memory:"Memory Management",routines:"Autonomous Routines",screen:"Screen & Device Controls",guardian:"Guardian & Security",system:"System Health & Voice Output"} as const)[tab]}</h2>
        <p>Configure JARVIS without leaving the chat console. All real operations use the existing protected backend.</p>
      </div>
    {busyTask && <p role="status">Finish or cancel the current task before switching models.</p>}
    {message && <p role="status" aria-live="polite" className="nexus-settings-status">{message}</p>}
    {tab==="integrations" && <IntegrationsPanel/>}
    {tab==="memory" && <MemoryManager onClose={closeSettings}/>}
    {tab==="routines" && <RoutineManager onClose={closeSettings}/>}
    <div hidden={tab!=="voice"} className="nexus-settings-section"><h3>Wake Word & Spoken Replies</h3><p>Enable listening to “Jarvis”, review recognized requests, control spoken replies, or interrupt speech. Microphone access requires your permission. When enabled, wake listening continues after closing Settings until you disable it here.</p><WakeStrip onCommand={onCommand} busyTask={busyTask} latestReply={latestReply}/><OwnerVoiceSettings/></div>
    {tab==="screen" && <div className="nexus-settings-section"><h3>Local Screen Feed</h3><p>Screen streaming requires a valid owner session and the Windows companion. The feed starts only when you open it.</p><button type="button" style={buttonStyle} onClick={()=>setScreenVisible(v=>!v)} aria-expanded={screenVisible}>{screenVisible?"STOP LIVE SCREEN":"OPEN LIVE SCREEN"}</button>{screenVisible&&<img alt="Live Windows screen preview" src="/api/jarvis/windows/live" className="nexus-settings-screen"/>}<small>Only the real Windows companion can supply screen frames. This view does not grant screen-control permissions.</small><DeviceManager/></div>}
    {tab==="guardian" && <div className="nexus-settings-section" aria-label="Guardian security status"><h3>Guardian-protected execution</h3><p>Every task remains bound to an authenticated owner session and server-side authorization policies. The development login is loopback-only; it does not disable Guardian permission checks or authorize remote access.</p><p>Policy editing is deliberately unavailable: the current project does not expose an authenticated policy-management API. Review the actual task trace and Windows companion security gates before approving elevated actions.</p><button type="button" style={buttonStyle} onClick={()=>setTab("system")}>OPEN RUNTIME DIAGNOSTICS</button></div>}
    {tab==="system" && <section aria-label="JARVIS runtime diagnostics" style={{display:"grid",gap:14,padding:12,border:"1px solid #6b471c"}}>
      <h3>JARVIS · System & Voice Output</h3>
      <p style={{fontSize:12}}>Settings are backed by the current owner session. Local V1 no-passphrase mode is restricted to 127.0.0.1 and never enables production or network access.</p>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        <button type="button" style={buttonStyle} onClick={async()=>{
          setDiagnostics("Checking owner session and configured model manager...");
          try {
            const [session,models]=await Promise.all([fetch("/api/jarvis/auth/session",{cache:"no-store"}),fetch("/api/jarvis/models",{cache:"no-store"})]);
            const s=await session.json(); const m=await models.json();
            setDiagnostics(`Owner session: ${s.authenticated?"ACTIVE":"NOT AUTHENTICATED"} · Local test: ${s.localDevelopment===true?"YES":"NO"} · Model manager: ${models.ok?`${m.profiles?.length??0} profiles`:m.error??`HTTP ${models.status}`}`);
          }catch(e){setDiagnostics(e instanceof Error?e.message:"Diagnostics unavailable.");}
        }}>CHECK SESSION & PROVIDERS</button>
        <button type="button" style={buttonStyle} disabled={testVoiceBusy} onClick={async()=>{
          setTestVoiceBusy(true);setDiagnostics("Testing locally configured Piper voice...");
          try {
            const r=await fetch("/api/jarvis/tts",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:"At your service. JARVIS is ready."})});
            if(!r.ok){const data=await r.json().catch(()=>({error:`HTTP ${r.status}`}));throw Error(data.error??`HTTP ${r.status}`);}
            const url=URL.createObjectURL(await r.blob());
            try{const audio=new Audio(url);await audio.play();audio.onended=()=>URL.revokeObjectURL(url);audio.onerror=()=>URL.revokeObjectURL(url);}
            catch(e){URL.revokeObjectURL(url);throw e;}
            setDiagnostics("Piper speech generated. Audio test started.");
          }catch(e){setDiagnostics(e instanceof Error?e.message:"Speech output not ready.");}
          finally{setTestVoiceBusy(false);}
        }}>{testVoiceBusy?"TESTING PIPER…":"TEST JARVIS VOICE"}</button>
      </div>
      <p role="status" style={{overflowWrap:"anywhere"}}>{diagnostics}</p>
      <a href="/JARVIS_V1_project.zip" download="JARVIS_V1_project.zip" className="nexus-settings-project-download">↓ DOWNLOAD PROJECT BUILD (IF AVAILABLE)</a>
      <small>Face and owner voice sample enrollment are available under OWNER IDENTITY. Provider API keys remain encrypted and are never displayed in browser responses. Guardian settings are enforced by the backend, not bypassed by this panel.</small>
    </section>}
    {tab==="routing" && <form onSubmit={ev=>void saveRouting(ev)} style={{display:"grid",gap:12,border:"1px solid #6b471c",padding:12}}>
      <h3>LAYA · Autonomous Model Selection</h3>
      <label>Selection mode<select style={inputStyle} value={routing.mode} onChange={e=>setRouting({...routing,mode:e.target.value as Routing["mode"]})}>
        <option value="auto">AUTO — LAYA chooses by task weightage and privacy</option>
        <option value="manual">MANUAL — use selected AI model only</option>
      </select></label>
      <label>Privacy policy<select style={inputStyle} value={routing.privacy} onChange={e=>setRouting({...routing,privacy:e.target.value as Routing["privacy"]})}>
        <option value="auto">AUTO — prefer local for sensitive tasks (unless explicitly overridden or single model)</option>
        <option value="local-only">LOCAL ONLY — automatic routing only; explicit owner commands override</option>
        <option value="cloud-allowed">CLOUD ALLOWED — explicitly permit cloud even for sensitive work</option>
      </select></label>
      <label><input type="checkbox" checked={routing.layaEnabled} onChange={e=>setRouting({...routing,layaEnabled:e.target.checked})}/> Use real local Laya decision inference when available</label>
      <label>Laya server (loopback only)<input style={inputStyle} value={routing.layaUrl} onChange={e=>setRouting({...routing,layaUrl:e.target.value})}/></label>
      <small>Laya is a *decision model*, not a chat model. Install and start the official laya-serve separately. If absent or uncertain, JARVIS uses its deterministic capability-weighted router. Explicit owner commands such as “use cloud model” override automatic privacy preference for this task; Guardian still authorizes actions.</small>
      {(["quality","speed","cost"] as const).map(key=><label key={key}>{key.toUpperCase()} PRIORITY · {routing.weights[key]}/5
        <input style={{width:"100%"}} type="range" min={1} max={5} value={routing.weights[key]} onChange={e=>setRouting({...routing,weights:{...routing.weights,[key]:Number(e.target.value)}})}/>
      </label>)}
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button type="submit" style={buttonStyle} disabled={working||busyTask}>SAVE LAYA SETTINGS</button>
        <button type="button" style={buttonStyle} disabled={working} onClick={async()=>{
          setMessage("Checking saved local LAYA server...");
          try {const result=await action({action:"laya-test"});setMessage(result.ok?"Local Laya server is reachable. An actual routing decision still requires a loaded Laya checkpoint.":"Laya server unavailable; deterministic model routing remains active.");}
          catch(e){setMessage(e instanceof Error?e.message:"Laya health check failed.");}
        }}>TEST LOCAL LAYA SERVER</button>
      </div>
      <div style={{display:"grid",gap:6,borderTop:"1px solid #6b471c",paddingTop:10}}>
        <strong>PREVIEW LAYA MODEL SELECTION</strong>
        <input style={inputStyle} maxLength={500} value={previewTask} onChange={e=>setPreviewTask(e.target.value)} placeholder="Describe a task to see which model JARVIS would select"/>
        <button style={buttonStyle} type="button" disabled={!previewTask.trim()||working} onClick={async()=>{
          setPreviewResult("Evaluating saved routing policy...");
          try {const r=await action({action:"preview",objective:previewTask});setPreviewResult(r.blocked?`BLOCKED · ${r.reason}`:`${r.selectedLabel} · ${r.source} · ${r.category} · ${r.privacy} · ${r.reason}`);}
          catch(e){setPreviewResult(e instanceof Error?e.message:"Preview unavailable.");}
        }}>PREVIEW SELECTION</button>
        {previewResult&&<small role="status">{previewResult}</small>}
      </div>
      <small>PRIORITY: your explicit task instruction (“use strongest model”, “use cloud model”, or “use local LLM”) → sole enabled model → manual setting → LAYA automatic weighting/privacy. Strongest means highest configured task-relevant capability rating, not a measured benchmark. If there is only one enabled model, it is selected even for sensitive tasks. Explicit cloud selection can send task context to your configured cloud provider. Guardian permissions are independent.</small>
    </form>}
    {tab==="owner" && <div style={{display:"grid",gap:12,marginTop:10}}>
      <OwnerVoiceSettings/>
      <PerceptionPanel onClose={closeSettings} onCommand={onCommand} busyTask={busyTask}/>
      <small>Face and voice recognition are convenience features, not login. Delete data locally at any time. Owner voice samples and face templates are encrypted using your locally configured vault key.</small>
    </div>}
    {tab==="models" && <div className="nexus-models-layout">
      <section className="nexus-model-editor" aria-label="Add or edit model provider">
        <div className="nexus-model-editor-head"><span className="nexus-settings-eyebrow">STEP 1 / CHOOSE A PROVIDER</span><h3>Connect your AI</h3><p>Select a provider, enter its private API key, and save a model. Keys are never returned to the browser after saving.</p></div>
    <h3 className="nexus-form-subtitle">{form.id?"EDIT MODEL CONNECTION":"ADD MODEL CONNECTION"}</h3>
    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBlock:10}}>
      {Object.entries(templates).map(([key,val])=><button key={key} style={buttonStyle} type="button" onClick={()=>{setForm({...val,apiKey:"",ratings:ratingsDefault,enabled:true});document.getElementById("nexus-api-key")?.focus();}}>{key==="lmstudio"?"LM Studio / vLLM / llama.cpp":val.label}</button>)}
    </div>
    <form onSubmit={ev=>void save(ev)} className="nexus-provider-form">
      <div className="nexus-key-card" role="group" aria-label="Provider credentials">
        <span className="nexus-settings-eyebrow">STEP 2 / PRIVATE CREDENTIALS</span>
        <label htmlFor="nexus-api-key">{form.label.toLowerCase().includes("gemini")?"GEMINI API KEY":form.location==="local"?"LOCAL API KEY (OPTIONAL)":"PROVIDER API KEY"}
          <input id="nexus-api-key" style={inputStyle} type="password" autoComplete="off" required={form.location==="api"&&!form.id} value={form.apiKey} onChange={e=>setForm({...form,apiKey:e.target.value})} placeholder={form.id?"Leave blank to keep the existing encrypted key":"Paste your secret key here"}/>
        </label>
        <small>{form.id?"Leave blank to retain your saved key. ":""}The key is sent only to the JARVIS provider API when you choose Save Model; it is not echoed into chat.</small>
      </div>
      <span className="nexus-settings-eyebrow">STEP 3 / CONNECTION DETAILS</span>
      <label>Connection type
        <select style={inputStyle} value={form.location} onChange={e=>setForm({...form,location:e.target.value as Location,protocol:e.target.value==="local"?"ollama":"openai-compatible",baseUrl:e.target.value==="local"?"http://127.0.0.1:11434":"https://api.openai.com/v1",apiKey:""})}>
          <option value="api">Cloud API</option><option value="local">Local LLM</option>
        </select>
      </label>
      <label>Protocol
        <select style={inputStyle} value={form.protocol} onChange={e=>setForm({...form,protocol:e.target.value as Protocol})}>
          <option value="openai-compatible">OpenAI-compatible (OpenAI, Gemini, OpenRouter, Z.ai, LM Studio, vLLM, llama.cpp...)</option>
          {form.location==="api"?<option value="anthropic">Anthropic native</option>:<option value="ollama">Ollama native</option>}
        </select>
      </label>
      <label>Connection name<input style={inputStyle} required maxLength={64} value={form.label} onChange={e=>setForm({...form,label:e.target.value})} placeholder="e.g. Gemini Flash or Local Qwen" /></label>
      <label>Provider API base URL<input style={inputStyle} required maxLength={512} value={form.baseUrl} onChange={e=>setForm({...form,baseUrl:e.target.value})} placeholder={form.location==="local"?"http://127.0.0.1:11434":"https://api.provider.com/v1"}/></label>
      <label>Model ID<input style={inputStyle} required maxLength={160} value={form.model} onChange={e=>setForm({...form,model:e.target.value})} placeholder="Exact model name reported by your provider" /></label>
      <label><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/> Enabled for LAYA auto-selection</label>
      <fieldset style={{border:"1px solid #6b471c",display:"grid",gap:8,padding:10}}>
        <legend>Model capability ratings (1 = low, 5 = high). Set these based on your own tests.</legend>
        {(["reasoning","coding","vision","speed","cost"] as const).map(key=><label key={key}>{key.toUpperCase()} · {form.ratings[key]}/5
          <input type="range" min={1} max={5} style={{width:"100%"}} value={form.ratings[key]} onChange={e=>setForm({...form,ratings:{...form.ratings,[key]:Number(e.target.value)}})}/>
        </label>)}
      </fieldset>
      <small>Remote providers must support an implemented protocol and use public HTTPS. Local LLM connections are limited to this PC (loopback); no model data is sent to remote LAN services. Switching affects new tasks only.</small>
      <div style={{display:"flex",gap:8}}>
        <button style={buttonStyle} disabled={working||busyTask} type="submit">{working?"SAVING…":"SAVE MODEL"}</button>
        {form.id&&<button style={buttonStyle} type="button" onClick={()=>setForm({...templates.gemini,apiKey:"",ratings:ratingsDefault,enabled:true})}>CANCEL EDIT</button>}
      </div>
    </form>
      </section>
      <aside className="nexus-saved-models" aria-label="Saved AI provider connections">
        <h3>Saved Connections</h3>
        <p className="nexus-saved-hint">Choose EDIT to update a provider. A blank API key on edit keeps its stored secret.</p>

    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBlock:12}}>
      <button style={buttonStyle} type="button" disabled={busyTask||working} onClick={()=>void mutate("activate",null)}>CLEAR MANUAL PICK {state.activeId===null?"✓":""}</button>
    </div>
    <ul style={{padding:0,listStyle:"none",display:"grid",gap:8}}>
      {state.profiles.map(p=><li key={p.id} style={{padding:10,border:"1px solid #5f3d0d",display:"grid",gap:6}}>
        <strong>{p.label} {state.activeId===p.id?"· ACTIVE":""}</strong>
        <small>{p.location==="local"?"LOCAL LLM":"CLOUD API"} · {p.protocol} · {p.model}</small>
        <small style={{overflowWrap:"anywhere"}}>{p.baseUrl} · Key: {p.hasApiKey?"stored privately":"not required"} · {p.enabled===false?"DISABLED":"ENABLED"}</small>
        <small>Reasoning {p.ratings?.reasoning??3}/5 · Coding {p.ratings?.coding??3}/5 · Vision {p.ratings?.vision??3}/5 · Speed {p.ratings?.speed??3}/5 · Affordability {p.ratings?.cost??3}/5</small>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <button type="button" style={buttonStyle} disabled={working||busyTask} onClick={()=>void mutate("activate",p.id)}>SET MANUAL PICK</button>
          <button type="button" style={buttonStyle} disabled={!!testing||working} onClick={()=>void test(p.id)}>{testing===p.id?"TESTING…":"TEST CONNECTION"}</button>
          <button type="button" style={buttonStyle} disabled={working||busyTask} onClick={()=>{setForm({id:p.id,label:p.label,location:p.location,protocol:p.protocol,baseUrl:p.baseUrl,model:p.model,apiKey:"",ratings:{...ratingsDefault,...p.ratings},enabled:p.enabled!==false});document.getElementById("nexus-api-key")?.focus();}}>EDIT</button>
          <button type="button" style={buttonStyle} disabled={working||busyTask} onClick={()=>{if(window.confirm(`Delete ${p.label}?`))void mutate("delete",p.id);}}>DELETE</button>
        </div>
      </li>)}
    </ul>

      </aside>
    </div>}
    </div></div>
  </section>;
}
