'use client';
import {useCallback,useEffect,useState,type FormEvent} from 'react';
interface Run {id:string;taskId:string;stepIndex:number;routeIndex:number;outcome:string;startedAt:string;summary?:string|null}
interface Routine {id:string;title:string;objective:string;status:string;mode:string;enabled:boolean;activeTaskId?:string|null;runCount:number;maxRuns:number;stepIndex:number;routeIndex:number;nextRunAt:string;lastError?:string|null;subgoals:{goal:string}[];runs:Run[]}
export default function RoutineManager({onClose}:{onClose:()=>void}) {
  const [items,setItems]=useState<Routine[]>([]);
  const [enabled,setEnabled]=useState(false);
  const [healthy,setHealthy]=useState(false);
  const [title,setTitle]=useState('');
  const [objective,setObjective]=useState('');
  const [subgoals,setSubgoals]=useState('');
  const [mode,setMode]=useState<'once'|'interval'>('once');
  const [interval,setIntervalMinutes]=useState(60);
  const [maxRuns,setMaxRuns]=useState(10);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{
    try{
      const res=await fetch('/api/jarvis/routines',{cache:'no-store'});
      const body=await res.json();
      if(!res.ok)throw Error(body.error??`HTTP ${res.status}`);
      setItems(body.routines??[]);setEnabled(Boolean(body.workerEnabled));setHealthy(Boolean(body.workerHealthy));
    }catch(err){setError(err instanceof Error?err.message:'Routine service unavailable.');}
  },[]);
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),7000);return()=>window.clearInterval(timer);},[refresh]);
  const create=async(e:FormEvent)=>{
    e.preventDefault();if(busy)return;setBusy(true);setError('');
    try{
      const res=await fetch('/api/jarvis/routines',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        title,objective,mode,intervalMinutes:interval,maxRuns:mode==='once'?1:maxRuns,
        subgoals:subgoals.split('\n').map(s=>s.trim()).filter(Boolean),
      })});
      const data=await res.json();
      if(!res.ok)throw Error(data.error??'Unable to schedule.');
      setTitle('');setObjective('');setSubgoals('');await refresh();
    }catch(err){setError(err instanceof Error?err.message:'Unable to schedule.');}finally{setBusy(false);}
  };
  const change=async(id:string,action:'enable'|'disable')=>{
    setBusy(true);setError('');
    try{
      const res=await fetch('/api/jarvis/routines',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,action})});
      const data=await res.json();if(!res.ok)throw Error(data.error??'Change refused.');await refresh();
    }catch(err){setError(err instanceof Error?err.message:'Change failed.');}finally{setBusy(false);}
  };
  return <section className="p-4 overflow-y-auto space-y-4" aria-label="Long-running autonomous routines" style={{maxHeight:'72vh'}}>
    <div className="flex items-center justify-between gap-3"><strong>LONG-RUN TASKS & ROUTINES</strong><button onClick={onClose} aria-label="Close routines">✕</button></div>
    <p className="text-sm opacity-80">Persisted routines run in a separate local worker, even after closing the Console. Every run is bounded, recorded, and resumable only from a safe paused checkpoint.</p>
    {(!enabled||!healthy)&&<p role="status" className="text-amber-300 text-sm">{!enabled?'Worker OFF. Set JARVIS_LONGRUN_ENABLED=1 in your private .env and restart JARVIS.':'Worker heartbeat is unavailable or stale. Scheduled tasks may not be executing.'}</p>}
    <form onSubmit={create} className="space-y-2 border border-white/20 rounded-lg p-3">
      <strong>Create owner-authorized routine</strong>
      <input required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Routine title" className="w-full p-2 bg-black/40 rounded" aria-label="Routine title" />
      <textarea required maxLength={2000} rows={3} value={objective} onChange={e=>setObjective(e.target.value)} placeholder="Goal / objective" className="w-full p-2 bg-black/40 rounded" aria-label="Routine objective" />
      <textarea rows={3} value={subgoals} onChange={e=>setSubgoals(e.target.value)} placeholder="Optional subgoals, one per line; otherwise JARVIS plans steps during execution" className="w-full p-2 bg-black/40 rounded" aria-label="Subgoals" />
      <label className="text-sm block">Schedule <select className="ml-2 p-2 bg-slate-900" value={mode} onChange={e=>setMode(e.target.value as 'once'|'interval')}><option value="once">Run once</option><option value="interval">Repeat every N minutes</option></select></label>
      {mode==='interval'&&<div className="flex flex-wrap gap-3 text-sm"><label>Every (5–10080 minutes) <input type="number" min={5} max={10080} value={interval} onChange={e=>setIntervalMinutes(Number(e.target.value))} className="w-24 bg-black/40 p-1"/></label><label>Max cycles <input type="number" min={1} max={10000} value={maxRuns} onChange={e=>setMaxRuns(Number(e.target.value))} className="w-20 bg-black/40 p-1"/></label></div>}
      <button disabled={busy||!title.trim()||!objective.trim()} className="border rounded px-3 py-2 disabled:opacity-40">Schedule routine</button>
    </form>
    {error&&<p role="alert" className="text-red-300">{error}</p>}
    <div className="space-y-2"><strong>Task queue & history</strong>{items.length===0&&<p className="text-sm opacity-70">No routines scheduled yet.</p>}
      {items.map(item=><article key={item.id} className="rounded-lg border border-white/20 p-3 space-y-1 text-sm">
        <div className="flex justify-between gap-2"><strong>{item.title}</strong><span>{item.status.toUpperCase()}</span></div>
        <div className="opacity-80">{item.objective}</div>
        <div className="opacity-70">Subgoal {item.stepIndex+1}/{item.subgoals.length}, path {item.routeIndex+1} · cycles {item.runCount}/{item.maxRuns} · next {new Date(item.nextRunAt).toLocaleString()}</div>
        {item.lastError&&<p className="text-amber-200">{item.lastError}</p>}
        {item.runs[0]&&<p className="opacity-70">Latest task: {item.runs[0].outcome} · {item.runs[0].summary?.slice(0,180)??item.runs[0].taskId}</p>}
        {item.enabled?<button disabled={busy} onClick={()=>void change(item.id,'disable')} className="underline">Disable / stop</button>:item.status==='disabled'&&!item.activeTaskId?<button disabled={busy} onClick={()=>void change(item.id,'enable')} className="underline">Enable</button>:null}
      </article>)}
    </div>
  </section>;
}
