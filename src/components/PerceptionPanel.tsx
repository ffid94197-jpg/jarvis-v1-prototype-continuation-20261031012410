"use client";
import { useEffect, useRef, useState } from "react";

type Result = {ok:boolean;error?:string;code?:string;transcript?:string;matched?:boolean;similarity?:number;enrolled?:boolean;deleted?:boolean;faceModelsPresent?:boolean;voskModelPresent?:boolean;faceEnrollmentKeyPresent?:boolean};

async function request(action:string, extra:Record<string,unknown> = {}): Promise<Result> {
  const response = await fetch("/api/jarvis/perception", {method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({action,...extra})});
  const result = await response.json() as Result;
  if(!response.ok || !result.ok) throw new Error(result.error || result.code || `Perception failed (${response.status})`);
  return result;
}

export function wav16k(audio:Float32Array, sourceRate:number): string {
  const len = Math.floor(audio.length * 16000 / sourceRate);
  const view = new DataView(new ArrayBuffer(44 + len*2));
  const ascii = (offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  ascii(0,"RIFF");view.setUint32(4,36+len*2,true);ascii(8,"WAVE");ascii(12,"fmt ");view.setUint32(16,16,true);
  view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,"data");view.setUint32(40,len*2,true);
  for(let i=0;i<len;i++) {
    const src = i*sourceRate/16000; const p=Math.floor(src);
    const sample = (audio[p] || 0)*(1-(src-p))+(audio[p+1] || 0)*(src-p);
    view.setInt16(44+i*2,Math.max(-32768,Math.min(32767,Math.round(sample*32767))),true);
  }
  const u8 = new Uint8Array(view.buffer);
  let result="";
  for(let i=0;i<u8.length;i+=8192) result+=String.fromCharCode(...u8.subarray(i,i+8192));
  return btoa(result);
}

export default function PerceptionPanel({onClose,onCommand,busyTask}:{onClose:()=>void;onCommand:(text:string)=>void;busyTask:boolean}) {
  const video = useRef<HTMLVideoElement|null>(null);
  const camera = useRef<MediaStream|null>(null);
  const [cameraOn,setCameraOn]=useState(false);
  const [recording,setRecording]=useState(false);
  const [working,setWorking]=useState(false);
  const [status,setStatus]=useState("Camera and microphone are OFF until you enable them.");
  const [transcript,setTranscript]=useState("");
  const [lastMatch,setLastMatch]=useState<string|null>(null);
  const recorder = useRef<{stream:MediaStream;context:AudioContext;node:ScriptProcessorNode;source:MediaStreamAudioSourceNode;parts:Float32Array[];stopTimer:number}|null>(null);
  useEffect(()=>()=>{
    camera.current?.getTracks().forEach(t=>t.stop());
    const r=recorder.current;if(r){window.clearTimeout(r.stopTimer);r.node.disconnect();r.source.disconnect();r.stream.getTracks().forEach(t=>t.stop());void r.context.close();}
  },[]);
  const run = async (action:string, extra:Record<string,unknown>={})=>{
    setWorking(true);
    try {const r=await request(action,extra);return r;}
    catch(e){setStatus(e instanceof Error?e.message:"Perception request failed.");return null;}
    finally{setWorking(false);}
  };
  const startCamera = async ()=>{
    try {
      if(!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not available in this browser.");
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:640},height:{ideal:480}},audio:false});
      camera.current=stream;
      if(video.current){video.current.srcObject=stream;await video.current.play();}
      setCameraOn(true);setStatus("Camera active locally. No image uploaded until you press ENROLL or CHECK.");
    } catch(e){setStatus(e instanceof Error?e.message:"Camera unavailable.");}
  };
  useEffect(()=>{if(video.current&&camera.current&&cameraOn){video.current.srcObject=camera.current;void video.current.play();}},[cameraOn]);
  const stopCamera=()=>{camera.current?.getTracks().forEach(t=>t.stop());camera.current=null;if(video.current)video.current.srcObject=null;setCameraOn(false);};
  const snapshot=()=>{
    const v=video.current;
    if(!v || !camera.current || !v.videoWidth)throw new Error("Camera frame not ready.");
    const canvas=document.createElement("canvas");const scale=Math.min(1,640/v.videoWidth);
    canvas.width=Math.round(v.videoWidth*scale);canvas.height=Math.round(v.videoHeight*scale);
    canvas.getContext("2d")!.drawImage(v,0,0,canvas.width,canvas.height);
    return canvas.toDataURL("image/jpeg",0.78).split(",")[1];
  };
  const faceAction=async(action:"face_enroll"|"face_check"|"face_delete")=>{
    try {
      if(action==="face_delete"&&!window.confirm("Delete your local face enrollment?"))return;
      const res=await run(action,action==="face_delete"?{}:{image:snapshot()});if(!res)return;
      if(action==="face_enroll")setStatus("One face enrolled; embedding encrypted locally. This does not change login access.");
      else if(action==="face_delete"){setLastMatch(null);setStatus("Face enrollment deleted.");}
      else{setLastMatch(`${res.matched?"MATCH":"NO MATCH"} (${res.similarity?.toFixed(3)??"?"} similarity)`);setStatus("Informational face comparison complete — not secure authentication.");}
    } catch(e){setStatus(e instanceof Error?e.message:"Camera capture failed.");}
  };
  const stopRecording=async()=>{
    const r=recorder.current; if(!r)return;
    recorder.current=null;window.clearTimeout(r.stopTimer);
    r.node.disconnect();r.source.disconnect();r.stream.getTracks().forEach(t=>t.stop());
    await r.context.close();setRecording(false);
    const total=r.parts.reduce((n,p)=>n+p.length,0);if(total<1600){setStatus("Recording too short.");return;}
    const combined=new Float32Array(total);let at=0;for(const part of r.parts){combined.set(part,at);at+=part.length;}
    const res=await run("voice_transcribe",{audio:wav16k(combined,r.context.sampleRate)});
    if(res){setTranscript(res.transcript??"");setStatus(res.transcript?"Transcript ready. Review before sending to JARVIS.":"No recognized words. Try speaking clearly.");}
  };
  const startRecording=async()=>{
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error("Microphone access unavailable.");
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
      const context=new AudioContext();const source=context.createMediaStreamSource(stream);
      const node=context.createScriptProcessor(4096,1,1);const parts:Float32Array[]=[];
      node.onaudioprocess=e=>parts.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      source.connect(node);node.connect(context.destination);
      const stopTimer=window.setTimeout(()=>void stopRecording(),6000);
      recorder.current={stream,context,source,node,parts,stopTimer};setRecording(true);setStatus("Listening for up to 6 seconds. Click STOP when finished.");
    }catch(e){setStatus(e instanceof Error?e.message:"Microphone unavailable.");}
  };
  return <section className="assist-perception" aria-label="Local face and voice controls" style={{overflowY:"auto",padding:16,display:"grid",gap:12}}>
    <header style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><strong>◉ FACE / VOICE — LOCAL PERCEPTION</strong><button type="button" onClick={onClose}>CLOSE</button></header>
    <p style={{fontSize:12}}>Opt-in camera and microphone tools. Face matches are informational, not login or security authorization. Speech stays local when Vosk is installed.</p>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><button type="button" disabled={working} onClick={async()=>{const r=await run("health");if(r)setStatus(`Face models: ${r.faceModelsPresent?"ready":"missing"}; speech model: ${r.voskModelPresent?"ready":"missing"}; face vault key: ${r.faceEnrollmentKeyPresent?"ready":"missing"}`);}}>CHECK MODELS</button></div>
    <div><strong>Camera / Face recognition</strong></div>
    {cameraOn?<video ref={video} muted playsInline autoPlay style={{width:"100%",maxHeight:230,objectFit:"contain"}}/>:<p style={{fontSize:12}}>Camera OFF</p>}
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      <button type="button" onClick={cameraOn?stopCamera:()=>void startCamera()}>{cameraOn?"STOP CAMERA":"START CAMERA"}</button>
      <button type="button" disabled={!cameraOn||working} onClick={()=>void faceAction("face_enroll")}>ENROLL FACE</button>
      <button type="button" disabled={!cameraOn||working} onClick={()=>void faceAction("face_check")}>CHECK FACE</button>
      <button type="button" disabled={working} onClick={()=>void faceAction("face_delete")}>DELETE FACE DATA</button>
    </div>
    {lastMatch&&<p role="status">{lastMatch}</p>}
    <div><strong>Microphone / Speech recognition</strong></div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      <button type="button" disabled={working} onClick={()=>recording?void stopRecording():void startRecording()}>{recording?"■ STOP & TRANSCRIBE":"● RECORD VOICE (6s)"}</button>
    </div>
    <textarea aria-label="Recognized voice command" style={{minHeight:80,width:"100%",color:"inherit",background:"transparent"}} value={transcript} onChange={e=>setTranscript(e.target.value)} placeholder="Recognized words appear here for review…" maxLength={1500}/>
    <button type="button" disabled={!transcript.trim()||busyTask||recording||working} onClick={()=>{onCommand(transcript.trim());setTranscript("");onClose();}}>SEND TRANSCRIPT AS JARVIS TASK</button>
    <p role="status" style={{fontSize:12}}>{status}</p>
  </section>;
}
