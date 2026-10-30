"use client";

import { useCallback, useEffect, useState } from "react";

type Device = {id:string;role:"OWNER"|"DEVICE";status:"ACTIVE"|"PENDING"|"REVOKED";label:string;sessionCount:number};
export default function DeviceManager() {
  const [devices,setDevices] = useState<Device[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const load=useCallback(async()=>{
    const response=await fetch("/api/jarvis/auth/devices",{credentials:"same-origin",cache:"no-store"});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||`Device list HTTP ${response.status}`);
    setDevices((result.principals||[]).filter((p:Device)=>p.role==="DEVICE"));
  },[]);
  useEffect(()=>{void load().catch(e=>setError(e instanceof Error?e.message:"Unable to load devices"));},[load]);
  const change=async (device:Device,action:"approve"|"revoke")=>{
    if(busy || !window.confirm(`${action.toUpperCase()} device: ${device.label}?`))return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/jarvis/auth/devices",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({principalId:device.id,action})
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||`Device update HTTP ${response.status}`);
      await load();
    }catch(e){setError(e instanceof Error?e.message:"Device update failed");}
    finally{setBusy(false);}
  };
  return <section className="nexus-device-manager" aria-label="Paired device management">
    <div className="nexus-device-manager-header"><h3>Paired devices</h3>
      <button type="button" disabled={busy} onClick={()=>void load().catch(e=>setError(e.message))}>REFRESH DEVICES</button></div>
    <p>Approve new devices only after confirming the pairing request belongs to you. Revocation ends their existing sessions. Device access never bypasses Guardian.</p>
    {error&&<p role="alert">{error}</p>}
    {devices.length===0&&<p>No paired or pending devices are currently reported.</p>}
    <div className="nexus-device-list">
      {devices.map(d=><article key={d.id}>
        <strong>{d.label}</strong><small>{d.status} · {d.sessionCount} sessions</small>
        {d.status==="PENDING"&&<button type="button" disabled={busy} onClick={()=>void change(d,"approve")}>APPROVE DEVICE</button>}
        {d.status!=="REVOKED"&&<button type="button" disabled={busy} onClick={()=>void change(d,"revoke")}>REVOKE DEVICE</button>}
      </article>)}
    </div>
  </section>;
}
