"use client";

import {useCallback,useEffect,useState,type CSSProperties} from "react";

type Skill={id:string;name:string;description:string;status:string;digest:string;stageCount:number;createdAt:string};
type Repair={id:string;path:string;state:string;diagnosis:string;beforeSha256:string;afterSha256:string;createdAt:string};
type Recovery={id:string;path:string;state:string;observed:string;requiresOwnerReconciliation:boolean};
type EvolutionState={skills:Skill[];repairs:Repair[];recovery:Recovery[];ownerApprovalRequired:boolean};
type Detail=Record<string,unknown>;

const panel:CSSProperties={display:"grid",gap:12,marginTop:18,padding:16,
  border:"1px solid rgba(100,175,210,.35)",borderRadius:12,
  background:"rgba(9,24,36,.72)",color:"#dbeef5"};
const button:CSSProperties={border:"1px solid #5d99b1",borderRadius:6,
  background:"#123344",color:"#e3f6ff",padding:"6px 10px",cursor:"pointer"};
const danger:CSSProperties={...button,borderColor:"#c68c51",background:"#402919"};
const small:CSSProperties={fontSize:12,opacity:.86,margin:0};
async function callApi(body:Record<string,unknown>):Promise<Detail>{
  const response=await fetch("/api/jarvis/evolution",{
    method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",
    cache:"no-store",body:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>({error:"Unreadable owner API response"}));
  if(!response.ok)throw Error(data.error||"Owner operation denied");
  return data as Detail;
}
export default function EvolutionPanel(){
  const [data,setData]=useState<EvolutionState>({skills:[],repairs:[],recovery:[],ownerApprovalRequired:true});
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [error,setError]=useState(""),[notice,setNotice]=useState("");
  const [details,setDetails]=useState<Detail|null>(null);
  const [skillDraft,setSkillDraft]=useState("");
  const [open,setOpen]=useState(false);
  const reload=useCallback(async()=>{
    const response=await fetch("/api/jarvis/evolution",{cache:"no-store",credentials:"same-origin"});
    const body=await response.json().catch(()=>({error:"Unavailable"}));
    if(!response.ok)throw Error(body.error||"Owner role/session required");
    setData({skills:Array.isArray(body.skills)?body.skills:[],
      repairs:Array.isArray(body.repairs)?body.repairs:[],
      recovery:Array.isArray(body.recovery)?body.recovery:[],ownerApprovalRequired:true});
  },[]);
  useEffect(()=>{let mounted=true;reload().catch(e=>{if(mounted)setError(String(e));})
    .finally(()=>{if(mounted)setLoading(false);});
    return()=>{mounted=false;};},[reload]);
  async function action(name:string,fields:Record<string,unknown>={}){
    setBusy(true);setError("");setNotice("");
    try{
      if(["apply_repair","rollback_repair"].includes(name)&&
         !window.confirm(name==="apply_repair"?
           "Apply this reviewed patch to a JARVIS workspace file? Its original will be retained for rollback.":
           "Rollback the selected exact-match JARVIS workspace repair?"))
         return;
      const result=await callApi({action:name,...fields});
      if(name==="repair_details"||name==="skill_details"||name==="expand_skill")setDetails(result);
      else{
        setDetails(null);
        setNotice(name.replaceAll("_"," ")+" succeeded. "+
          (name==="stage_skill"?"Candidate staged; owner approval required.":
            name==="approve_skill"?"Skill is available as advisory steps; Guardian still checks actions.":
            name==="apply_repair"?"Patch readback reported; final acceptance remains separate.":""));
      }
      await reload();
    }catch(e){setError(e instanceof Error?e.message:"Action failed");}
    finally{setBusy(false);}
  }
  return <section aria-label="JARVIS native evolution control plane" style={panel}>
    <button type="button" onClick={()=>setOpen(v=>!v)} aria-expanded={open}
      style={{...button,justifySelf:"start",fontWeight:600}}>
      {open?"HIDE":"OPEN"} NATIVE SKILL FORGE & REPAIR VAULT
    </button>
    <p style={small}>Original JARVIS capabilities: staged skill recipes, owner-approved reuse,
      bounded repair candidates and exact-match rollback. No independent agent,
      automatic code execution, or external Brahma source.</p>
    {open&&<>
      {loading&&<p>Reading owner registry…</p>}
      {error&&<p role="alert" style={{color:"#f8c08a"}}>{error}</p>}
      {notice&&<p role="status" style={{color:"#a9e0c1"}}>{notice}</p>}
      {data.recovery.length>0&&<div role="alert" style={{border:"1px solid #db9759",
        borderRadius:8,padding:10,background:"rgba(102,53,12,.28)"}}>
        <strong>Recovery required: {data.recovery.length} uncertain patch operation(s)</strong>
        <p style={small}>JARVIS has not replayed or auto-applied them. Review the current
          file state, then use explicit owner rollback where the exact file hash allows it.</p>
        {data.recovery.map(entry=><p key={entry.id} style={small}>
          {entry.path}: {entry.state} · disk: {entry.observed}
        </p>)}
      </div>}
      <div style={{display:"grid",gap:8}}>
        <h4 style={{margin:0}}>Skill Forge</h4>
        <p style={small}>A model may stage a declarative skill. Review each proposed tool and
          its arguments before approving. Expansion does not execute anything.</p>
        {data.skills.length===0&&<p style={small}>No owner skills staged.</p>}
        {data.skills.map(skill=><div key={skill.id} style={{padding:10,
          border:"1px solid rgba(130,175,190,.25)",borderRadius:8}}>
          <div style={{fontWeight:600}}>{skill.name} · {skill.status}</div>
          <p style={small}>{skill.description} · {skill.stageCount} steps</p>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
            <button type="button" disabled={busy} style={button}
              onClick={()=>action("skill_details",{id:skill.id})}>REVIEW STEPS</button>
            {skill.status==="staged"&&<button type="button" disabled={busy}
              style={button} onClick={()=>action("approve_skill",{id:skill.id})}>APPROVE</button>}
            {skill.status==="approved"&&<>
              <button type="button" disabled={busy} style={button}
                onClick={()=>action("expand_skill",{id:skill.id,inputs:{}})}>PREVIEW PLAN</button>
              <button type="button" disabled={busy} style={danger}
                onClick={()=>action("disable_skill",{id:skill.id})}>DISABLE</button>
            </>}
          </div>
        </div>)}
        <label style={{fontSize:12}}>Stage a skill manifest (JSON; optional alternative to asking JARVIS)
          <textarea value={skillDraft} onChange={e=>setSkillDraft(e.target.value)}
            rows={4} spellCheck={false} style={{display:"block",width:"100%",boxSizing:"border-box",
            background:"#071923",border:"1px solid #4b8296",color:"#e7f2fb",padding:8,borderRadius:6}}
            placeholder='{"name":"Inspect reports","description":"Review file names before analysis","steps":[{"tool":"list_dir","args":{"path":"reports"},"why":"Find available files"}]}' />
        </label>
        <button type="button" style={button} disabled={busy||!skillDraft.trim()}
          onClick={()=>{
            try{const manifest=JSON.parse(skillDraft);void action("stage_skill",{manifest}).then(()=>setSkillDraft(""));}
            catch{setError("Skill manifest must be valid JSON");}
          }}>STAGE FOR APPROVAL</button>
      </div>
      <div style={{display:"grid",gap:8,marginTop:14}}>
        <h4 style={{margin:0}}>Self-Repair Candidate Vault</h4>
        <p style={small}>JARVIS proposes exact SHA-pinned workspace edits. A separate
          owner approval and explicit apply action are required. No automatic repair of the JARVIS
          security core is allowed.</p>
        {data.repairs.length===0&&<p style={small}>No staged repairs.</p>}
        {data.repairs.map(repair=><div key={repair.id} style={{padding:10,
          border:"1px solid rgba(130,175,190,.25)",borderRadius:8}}>
          <div style={{fontWeight:600}}>{repair.path} · {repair.state}</div>
          <p style={small}>{repair.diagnosis}</p>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
            <button type="button" disabled={busy} style={button}
              onClick={()=>action("repair_details",{id:repair.id})}>REVIEW PATCH</button>
            {repair.state==="staged"&&<button type="button" disabled={busy} style={button}
              onClick={()=>action("approve_repair",{id:repair.id})}>APPROVE</button>}
            {repair.state==="approved"&&<button type="button" disabled={busy} style={danger}
              onClick={()=>action("apply_repair",{id:repair.id})}>APPLY REVIEWED PATCH</button>}
            {["applied","applying","effect_unknown","rolling_back"].includes(repair.state)&&
              <button type="button" disabled={busy} style={danger}
                onClick={()=>action("rollback_repair",{id:repair.id})}>ROLL BACK</button>}
          </div>
        </div>)}
      </div>
      {details&&<div style={{display:"grid",gap:6}}>
        <h4>Owner review / advisory preview</h4>
        <pre style={{fontSize:11,overflow:"auto",maxHeight:260,whiteSpace:"pre-wrap",
          overflowWrap:"anywhere",padding:12,background:"#051620",borderRadius:8}}>
          {JSON.stringify(details,null,2)}
        </pre>
        <button type="button" style={button} onClick={()=>setDetails(null)}>CLOSE PREVIEW</button>
      </div>}
    </>}
  </section>;
}
