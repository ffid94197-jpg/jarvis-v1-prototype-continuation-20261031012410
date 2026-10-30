"use client";
import {useCallback,useEffect,useState} from 'react';
type Skill={name:string;description:string;path:string};
type Entry={id:string;name:string;kind:string;source:string;status:string;capabilities:{skills?:Skill[];mcp?:{path:string;serverNames:string[]}[];endpoint?:string;plugins?:{name:string}[];fileCount?:number;requirements?:{node?:string[];python?:string[];runtimes?:string[]}}};
const btn:React.CSSProperties={background:'#2b1c09',border:'1px solid #986c2b',color:'#ffca62',padding:'7px 10px',cursor:'pointer'};
const field:React.CSSProperties={background:'#140e09',color:'#ffce71',border:'1px solid #986c2b',padding:9,width:'100%'};
export default function IntegrationsPanel(){
 const [items,setItems]=useState<Entry[]>([]),[url,setUrl]=useState(''),[remote,setRemote]=useState(false),[label,setLabel]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[output,setOutput]=useState('');
 const load=useCallback(async()=>{const r=await fetch('/api/jarvis/integrations',{cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to load integrations');setItems(d.integrations||[]);},[]);
 useEffect(()=>{void load().catch(e=>setMessage(e.message));},[load]);
 async function action(body:Record<string,unknown>){setBusy(true);setMessage('');try{const r=await fetch('/api/jarvis/integrations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'same-origin'});const d=await r.json();if(!r.ok)throw new Error(d.error||'Integration operation failed');await load();setMessage(`Operation succeeded: ${body.action}`);setOutput(JSON.stringify(d,null,2).slice(0,13000));return d;}catch(e){setMessage(e instanceof Error?e.message:'Operation failed');return null;}finally{setBusy(false);}}
 return <section aria-label="MCP skills and tools integrations" style={{display:'grid',gap:14}}>
   <h3>Universal Skills · MCP · Tools</h3>
   <p>Install from a public GitHub repository or register an MCP HTTP endpoint. A repository is <strong>staged first</strong>; inspect its capabilities, then select APPROVE. No downloaded scripts run during staging. Enabled MCP tools can be called by JARVIS through Guardian.</p>
   <form onSubmit={ev=>{ev.preventDefault();void action(remote?{action:'stage_remote',url,name:label}:{action:'stage_github',url});}} style={{border:'1px solid #725223',padding:12,display:'grid',gap:9}}>
     <label><input type="checkbox" checked={remote} onChange={e=>setRemote(e.target.checked)}/> Direct MCP HTTP endpoint instead of GitHub repository</label>
     {remote&&<label>Friendly name<input value={label} onChange={e=>setLabel(e.target.value)} style={field}/></label>}
     <label>{remote?'MCP endpoint (HTTPS or local loopback HTTP)':'GitHub repository /tree/branch/subfolder URL'}<input required value={url} onChange={e=>setUrl(e.target.value)} style={field} placeholder={remote?'https://mcp.example.com/mcp':'https://github.com/owner/repository'}/></label>
     <button disabled={busy} style={btn}>{busy?'PROCESSING…':'DOWNLOAD / STAGE FOR REVIEW'}</button>
   </form>
   {message&&<p role="status" style={{border:'1px solid #986c2b',padding:8}}>{message}</p>}
   {items.map(i=><article key={i.id} style={{padding:12,border:'1px solid #795629',display:'grid',gap:8}}>
     <strong>{i.name} · {i.kind} · {i.status.toUpperCase()}</strong>
     <small style={{overflowWrap:'anywhere'}}>{i.source}</small>
     <small>Skills: {(i.capabilities.skills||[]).length} · MCP configs: {(i.capabilities.mcp||[]).length} · Repository files: {i.capabilities.fileCount??'N/A'} · Declared runtimes: {(i.capabilities.requirements?.runtimes||[]).join(', ')||'not declared'} · Node packages: {i.capabilities.requirements?.node?.length||0} · Python requirements: {i.capabilities.requirements?.python?.length||0}</small>
     {(i.capabilities.skills||[]).map(s=><div key={s.path} style={{padding:'5px 0'}}><strong>{s.name}</strong> — {s.description} <button style={btn} disabled={busy||i.status!=='enabled'} onClick={()=>void action({action:'activate_skill',id:i.id,name:s.name})}>VIEW SKILL</button></div>)}
     {(i.capabilities.mcp||[]).map(m=><div key={m.path}><small>{m.path}</small> {m.serverNames.map(name=><button key={name} disabled={busy||i.status!=='enabled'} style={btn} onClick={()=>void action({action:'mcp_test',id:i.id,server:name})}>TEST {name}</button>)}</div>)}
     {i.kind==='remote-mcp'&&<button disabled={busy||i.status!=='enabled'} style={btn} onClick={()=>void action({action:'mcp_test',id:i.id})}>TEST REMOTE MCP CONNECTION</button>}
     <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
       {i.status!=='enabled'&&<button style={btn} disabled={busy} onClick={()=>void action({action:'approve',id:i.id})}>APPROVE / ENABLE</button>}
       {i.status==='enabled'&&<button style={btn} disabled={busy} onClick={()=>void action({action:'disable',id:i.id})}>DISABLE</button>}
       <button style={btn} disabled={busy} onClick={()=>{if(window.confirm(`Remove integration ${i.name}?`))void action({action:'remove',id:i.id});}}>REMOVE</button>
     </div>
   </article>)}
   {items.length===0&&<p>No extensions installed. Enter a GitHub URL to stage one.</p>}
   {output&&<details><summary>Last operation / connection receipt</summary><pre style={{whiteSpace:'pre-wrap',maxHeight:330,overflowY:'auto',overflowWrap:'anywhere',fontSize:11}}>{output}</pre></details>}
   <small>Installation does not grant third-party instructions, hooks, tools or executable files authority to bypass JARVIS Guardian. Some MCP servers require npm/uv, credentials, OAuth, network permissions or a compatible adapter. These are diagnosed rather than silently installed.</small>
 </section>;
}
