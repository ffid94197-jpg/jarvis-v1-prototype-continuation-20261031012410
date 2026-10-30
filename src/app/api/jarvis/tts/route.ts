/** Owner-only offline Piper speech synthesis; never uses cloud TTS. */
import type { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { getAuthContext } from "@/lib/agent/auth/session";
import { mutationOriginError } from "@/lib/agent/auth/origin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers={"Cache-Control":"no-store"};
function reject(status:number,error:string){return Response.json({ok:false,error},{status,headers});}
export async function POST(req:NextRequest){
  if(process.env.JARVIS_TTS_ENABLED!=="1")return reject(403,"Offline speech output disabled.");
  const error=mutationOriginError(req.headers);
  if(error)return reject(403,error);
  const owner=await getAuthContext(req);
  if(!owner||owner.status!=="ACTIVE"||owner.role!=="OWNER")return reject(403,"Owner session required.");
  let text="";
  try{
    const body=await req.json() as {text?:unknown};
    if(typeof body.text!=="string"||body.text.length>600||!body.text.trim())return reject(400,"Text length must be 1–600 characters.");
    text=body.text;
  }catch{return reject(400,"Invalid JSON.");}
  const python=process.env.JARVIS_PYTHON_EXE||(process.platform==="win32"?"python":"python3");
  const script=join(process.cwd(),"windows-companion","perception","piper_speak.py");
  try{
    const output=await new Promise<string>((resolve,rejectRun)=>{
      const child=spawn(python,[script],{stdio:["pipe","pipe","ignore"],windowsHide:true});
      let out="",done=false;
      let timer:ReturnType<typeof setTimeout>;
      const abort=()=>end(new Error("Speech request cancelled"));
      const cleanup=()=>{clearTimeout(timer);req.signal.removeEventListener("abort",abort);};
      const end=(e:Error)=>{if(!done){done=true;cleanup();child.kill();rejectRun(e);}};
      timer=setTimeout(()=>end(new Error("Speech synthesis timed out")),45000);
      req.signal.addEventListener("abort",abort,{once:true});
      if(req.signal.aborted){abort();return;}
      child.stdout.on("data",(c:Buffer)=>{out+=c.toString("utf8");if(out.length>7_000_000)end(new Error("Output too long"));});
      child.on("error",end);
      child.on("close",code=>{cleanup();if(done)return;done=true; if(code===0)resolve(out);else rejectRun(new Error("Piper backend failed"));});
      child.stdin.on("error",()=>{});
      child.stdin.end(JSON.stringify({text}));
    });
    const parsed=JSON.parse(output) as {ok:boolean;audioBase64?:string;error?:string};
    if(!parsed.ok||!parsed.audioBase64)return reject(503,parsed.error||"Speech output unavailable.");
    const wav=Buffer.from(parsed.audioBase64,"base64");
    if(wav.length>5_000_000||wav.toString("ascii",0,4)!=="RIFF")return reject(503,"Malformed Piper audio.");
    return new Response(new Uint8Array(wav),{headers:{"Content-Type":"audio/wav","Cache-Control":"no-store","Content-Length":String(wav.length)}});
  }catch{return reject(503,"Piper speech engine unavailable. Install model and piper-tts.");}
}
