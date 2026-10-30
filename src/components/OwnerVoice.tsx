"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {wav16k} from "./PerceptionPanel";

type VoiceResult={ok:boolean;error?:string;code?:string;reason?:string;sampleCount?:number;enrolled?:boolean;verified?:boolean;engine?:string;ownerWakeReady?:boolean;matched?:boolean;score?:number;wakeDetected?:boolean;command?:string;transcript?:string;speaker?:{matched:boolean;verified?:boolean;enrolled:boolean;score?:number}};
async function postVoice(action:string,audio?:string):Promise<VoiceResult>{
  const r=await fetch("/api/jarvis/perception",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({action,...(audio?{audio}:{})})});
  const body=await r.json() as VoiceResult;
  if(!r.ok||!body.ok)throw new Error(body.error||`Owner voice backend error (${r.status}).`);
  return body;
}
/** A short bounded capture; tracks and AudioContext are always released. */
export async function captureVoice(seconds:number,signal?:AbortSignal):Promise<string>{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error("Microphone unavailable or permission denied.");
  if(signal?.aborted) throw new Error("Capture stopped.");
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:false},video:false});
  const ctx=new AudioContext();
  const source=ctx.createMediaStreamSource(stream);
  const node=ctx.createScriptProcessor(4096,1,1);
  const parts:Float32Array[]=[];
  node.onaudioprocess=e=>{if(!signal?.aborted)parts.push(new Float32Array(e.inputBuffer.getChannelData(0)));};
  source.connect(node);node.connect(ctx.destination);
  try{
    await new Promise<void>((resolve,reject)=>{
      const finish=()=>{window.clearTimeout(timer);signal?.removeEventListener("abort",aborted);resolve();};
      const aborted=()=>{window.clearTimeout(timer);signal?.removeEventListener("abort",aborted);reject(new Error("Capture stopped."));};
      const timer=window.setTimeout(finish,seconds*1000);
      signal?.addEventListener("abort",aborted,{once:true});
      if(signal?.aborted)aborted();
    });
  }finally{
    node.onaudioprocess=null;node.disconnect();source.disconnect();stream.getTracks().forEach(t=>t.stop());await ctx.close();
  }
  const len=parts.reduce((n,x)=>n+x.length,0);
  if(len<16000)throw new Error("Voice sample too short.");
  const combined=new Float32Array(len);let pos=0;
  for(const part of parts){combined.set(part,pos);pos+=part.length;}
  return wav16k(combined,ctx.sampleRate);
}
const btn={border:"1px solid #986c2b",background:"#2b1c09",color:"#ffca62",padding:"7px 10px",cursor:"pointer"} as const;

export function OwnerVoiceSettings(){
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("Enroll 3 clearly spoken samples. Recording is stored only as encrypted voice features on the local PC.");
  const abort=useRef<AbortController|null>(null);
  useEffect(()=>()=>abort.current?.abort(),[]);
  const action=async(kind:"voice_enroll_sample"|"voice_check"|"voice_delete")=>{
    if(busy)return;
    setBusy(true);
    const ctl=new AbortController();abort.current=ctl;
    try{
      if(kind==="voice_delete"&&!window.confirm("Erase your encrypted local owner voice profile?"))return;
      setStatus(kind==="voice_delete"?"Removing owner voice profile...":"Recording 3.5 seconds. Speak a natural sentence.");
      const pcm=kind==="voice_delete"?undefined:await captureVoice(3.5,ctl.signal);
      const r=await postVoice(kind,pcm);
      if(kind==="voice_delete")setStatus("Owner voice profile erased.");
      else if(kind==="voice_enroll_sample")setStatus(`Owner voice sample ${r.sampleCount}/3 saved. ${r.enrolled?(r.ownerWakeReady?"ECAPA enrollment ready for live testing.":"MFCC hint only: install local ECAPA weights and re-enroll for wake."):"Record the next sample."}`);
      else setStatus(`Voice result: ${r.verified?"SPEAKER SIMILARITY VERIFIED":r.matched?"UNVERIFIED MFCC HINT":"NOT MATCHED"}; score ${r.score??"unknown"}. Never authorizes desktop actions.`);
    }catch(e){setStatus(e instanceof Error?e.message:"Voice capture failed.");}
    finally{setBusy(false);abort.current=null;}
  };
  return <section aria-label="Owner voice enrollment" style={{display:"grid",gap:10,border:"1px solid #76501e",padding:12}}>
    <strong>OWNER VOICE PROFILE · LOCAL</strong>
    <small>Enroll three different natural phrases. The encrypted feature template is local; audio is discarded after processing. Legacy MFCC similarity is an unverified hint and never arms voice wake. Install local ECAPA speaker weights and re-enroll for speaker-gated wake. Even ECAPA is spoofable and never authenticates Guardian actions.</small>
    <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
      <button type="button" style={btn} disabled={busy} onClick={()=>void action("voice_enroll_sample")}>ENROLL NEXT VOICE SAMPLE</button>
      <button type="button" style={btn} disabled={busy} onClick={()=>void action("voice_check")}>CHECK MY VOICE</button>
      <button type="button" style={btn} disabled={busy} onClick={()=>void action("voice_delete")}>DELETE VOICE PROFILE</button>
    </div>
    <small role="status">{status}</small>
  </section>;
}

export function WakeStrip({onCommand,busyTask,latestReply}:{onCommand:(text:string)=>void;busyTask:boolean;latestReply?:string}){
  const [enabled,setEnabled]=useState(false);
  const [autoDispatch,setAutoDispatch]=useState(false);
  const [speakReplies,setSpeakReplies]=useState(false);
  const [status,setStatus]=useState("Wake microphone OFF. Enable to listen for 'Jarvis'.");
  const [pending,setPending]=useState("");
  const abort=useRef<AbortController|null>(null);
  const audio=useRef<HTMLAudioElement|null>(null);
  const currentUrl=useRef<string|null>(null);
  const speaking=useRef(false);
  const ttsRequest=useRef<AbortController|null>(null);
  const wakeHandler=useRef(onCommand);wakeHandler.current=onCommand;
  const armedUntil=useRef<number>(0);
  const stopAudio=useCallback(()=>{
    ttsRequest.current?.abort();ttsRequest.current=null;
    audio.current?.pause();audio.current=null;
    if(currentUrl.current){URL.revokeObjectURL(currentUrl.current);currentUrl.current=null;}
    speaking.current=false;
  },[]);
  const say=useCallback(async(text:string)=>{
    if(!text.trim())return;
    stopAudio();speaking.current=true;
    const request=new AbortController();ttsRequest.current=request;
    try{
      const r=await fetch("/api/jarvis/tts",{method:"POST",headers:{"Content-Type":"application/json"},signal:request.signal,body:JSON.stringify({text:text.slice(0,600)})});
      if(!r.ok)throw new Error(`Offline Piper TTS unavailable (${r.status}).`);
      const blob=await r.blob();
      if(request.signal.aborted)return;
      const url=URL.createObjectURL(blob);currentUrl.current=url;
      const a=new Audio(url);audio.current=a;
      a.onended=stopAudio;a.onerror=stopAudio;
      await a.play();
    }catch(e){stopAudio();setStatus(e instanceof Error?e.message:"Speech output unavailable.");}
  },[stopAudio]);
  const sayRef=useRef(say);sayRef.current=say;
  const lastSpoken=useRef<string>("");
  useEffect(()=>{
    if(!latestReply||!speakReplies||busyTask||latestReply===lastSpoken.current)return;
    lastSpoken.current=latestReply;
    void sayRef.current(latestReply);
  },[latestReply,speakReplies,busyTask]);
  useEffect(()=>()=>{abort.current?.abort();stopAudio();},[stopAudio]);
  useEffect(()=>{
    if(!enabled)return;
    let active=true;
    const controller=new AbortController();abort.current=controller;
    void(async()=>{
      while(active&&!controller.signal.aborted){
        if(busyTask||speaking.current){
          await new Promise(r=>window.setTimeout(r,500));continue;
        }
        try{
          setStatus("Listening locally for 'Jarvis' (3.5-second segments)...");
          const pcm=await captureVoice(3.5,controller.signal);
          if(controller.signal.aborted)break;
          const followup=Date.now()<armedUntil.current;
          const result=await postVoice(followup?"voice_followup":"wake_check",pcm);
          if(controller.signal.aborted)break;
          if(result.reason==="SPEAKER_NOT_VERIFIED")setStatus("Owner speaker verification unavailable or unmatched. Install ECAPA and re-enroll for wake.");
          if(result.wakeDetected || (followup&&result.speaker?.verified===true)){
            const cmd=(result.command||"").trim();
            armedUntil.current=cmd?0:Date.now()+12000;
            setStatus(cmd?"Owner speaker similarity matched. Review the recognized command.":"Jarvis heard. Say your command within 12 seconds.");
            if(cmd){
              if(autoDispatch){wakeHandler.current(cmd);setPending("");}
              else setPending(cmd);
            }
          }
        }catch(e){
          if(controller.signal.aborted)break;
          setStatus(e instanceof Error?e.message:"Wake processing failed.");
          // Avoid tight error loops on permission/model failures.
          await new Promise(r=>window.setTimeout(r,2500));
        }
      }
    })();
    return()=>{active=false;controller.abort();abort.current=null;};
  },[enabled,autoDispatch,busyTask]);
  return <div aria-label="JARVIS voice output and wake controls" style={{display:"flex",gap:6,padding:"5px 10px",flexWrap:"wrap",alignItems:"center",borderBottom:"1px solid #593811",fontSize:11}}>
    <button type="button" style={btn} aria-pressed={enabled} onClick={()=>setEnabled(!enabled)}>{enabled?"◉ STOP WAKE LISTENING":"◯ ENABLE JARVIS WAKE"}</button>
    <label><input type="checkbox" checked={autoDispatch} onChange={e=>setAutoDispatch(e.target.checked)}/> Auto-send recognized owner commands (experimental)</label>
    <label><input type="checkbox" checked={speakReplies} onChange={e=>setSpeakReplies(e.target.checked)}/> Speak replies</label>
    <button type="button" style={btn} onClick={()=>void sayRef.current("At your service. JARVIS is ready.")}>TEST VOICE</button>
    <button type="button" style={btn} onClick={stopAudio}>STOP SPEAKING</button>
    {pending&&<><input aria-label="Review wake voice command" style={{background:"transparent",color:"#ffca62",border:"1px solid #986c2b",padding:6}} value={pending} onChange={e=>setPending(e.target.value)}/><button type="button" style={btn} disabled={busyTask} onClick={()=>{onCommand(pending);setPending("");}}>SEND</button></>}
    <small role="status" style={{opacity:.8}}>{status}</small>

  </div>;
}
