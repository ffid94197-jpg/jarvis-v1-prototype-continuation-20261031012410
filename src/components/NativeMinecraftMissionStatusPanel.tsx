"use client";

import {useCallback,useState} from "react";

/** Read-only OWNER view of an existing, original JARVIS Core Minecraft task.
 * Never spawns, retries, resumes, stops, mutates or grants any game authority.
 */
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
type Status={
  taskId?:string;goal?:string;status?:string;
  verifiedLiveObservation?:boolean;
  inGameMissionReportedComplete?:boolean;
  independentlyAccepted?:boolean;
  milestones?:Record<string,unknown>;error?:string;
};
export default function NativeMinecraftMissionStatusPanel(){
  const [taskId,setTaskId]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [status,setStatus]=useState<Status|null>(null);
  const refresh=useCallback(async()=>{
    const id=taskId.trim();
    if(!uuid.test(id)){setError("Enter the original JARVIS Core task UUID.");return;}
    setLoading(true);setError("");setStatus(null);
    try{
      const controller=new AbortController();
      const response=await fetch(
        "/api/jarvis/minecraft/mission-status?taskId="+encodeURIComponent(id),
        {credentials:"same-origin",cache:"no-store",signal:controller.signal});
      const data=(await response.json()) as Status;
      setStatus(data);
      if(!response.ok)setError(data.error||"No signed native mission status available.");
    }catch(e){setError(e instanceof Error?e.message:"Status request unavailable");}
    finally{setLoading(false);}
  },[taskId]);
  const button:React.CSSProperties={
    background:"#123344",color:"#e3f6ff",border:"1px solid #5d99b1",
    borderRadius:6,padding:"7px 12px",cursor:"pointer"
  };
  return <section aria-label="Native Minecraft mission monitor"
    style={{padding:16,marginTop:14,borderRadius:12,
      border:"1px solid rgba(100,175,210,.35)",color:"#dbeef5",
      background:"rgba(9,24,36,.72)"}}>
    <strong>Native Minecraft mission status</strong>
    <p style={{fontSize:12,opacity:.85,marginBottom:12}}>
      Read the live progress of an existing owner-authorized native Minecraft
      mission after the JARVIS chat task has settled. This does not execute,
      resume, start, or repeat any gameplay action.
    </p>
    <label style={{display:"grid",gap:5,fontSize:12}}>
      Original JARVIS Core task UUID
      <input value={taskId} onChange={e=>setTaskId(e.target.value)}
        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" spellCheck={false}
        style={{color:"#e7f2fb",background:"#071923",padding:8,
          borderRadius:6,border:"1px solid #4b8296"}}/>
    </label>
    <button type="button" style={{...button,marginTop:10}}
      disabled={loading||!uuid.test(taskId.trim())}
      onClick={()=>void refresh()}>
      {loading?"READING LIVE SERVER…":"READ SIGNED LIVE STATUS"}
    </button>
    {error&&<p role="alert" style={{fontSize:12,color:"#f8c08a"}}>{error}</p>}
    {status?.verifiedLiveObservation&&
      <div role="status" style={{marginTop:10,fontSize:12}}>
        <p style={{margin:"4px 0"}}><b>Goal:</b> {status.goal||"unknown"}</p>
        <p style={{margin:"4px 0"}}><b>Game-server report:</b> {status.status||"unverified"}</p>
        <p style={{margin:"4px 0"}}>
          A signed live game observation was verified.
          {status.inGameMissionReportedComplete?
            " The server reports mission completion; independent field acceptance is still outstanding.":
            " This is not evidence that the full objective was completed."}
        </p>
        <pre style={{overflowWrap:"anywhere",whiteSpace:"pre-wrap",padding:10,
          background:"#051620",borderRadius:8,fontSize:11,maxHeight:230,overflow:"auto"}}>
          {JSON.stringify(status.milestones||{},null,2)}
        </pre>
      </div>}
  </section>;
}
