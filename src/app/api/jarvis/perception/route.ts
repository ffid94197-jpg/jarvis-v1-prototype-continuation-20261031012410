/** Owner-only, local-only, opt-in camera/voice perception; separate from login. */
import type { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { getAuthContext } from "@/lib/agent/auth/session";
import { mutationOriginError } from "@/lib/agent/auth/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cache = { "Cache-Control": "no-store" };
const reject = (status: number, error: string) => Response.json({ok:false,error},{status,headers:cache});

export async function POST(req: NextRequest) {
  if (process.env.JARVIS_PERCEPTION_ENABLED !== "1") return reject(403,"Camera/voice perception is disabled by the operator.");
  const originError = mutationOriginError(req.headers);
  if (originError) return reject(403,originError);
  const owner = await getAuthContext(req);
  if (!owner || owner.status !== "ACTIVE" || owner.role !== "OWNER") return reject(403,"Active owner session required.");
  const advertisedSize = Number(req.headers.get("content-length") || 0);
  if (advertisedSize > 3_600_000) return reject(413,"Media payload too large.");
  let input: Record<string,unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 3_600_000) return reject(413,"Media payload too large.");
    const parsed:unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reject(400,"Invalid request.");
    input = parsed as Record<string,unknown>;
  } catch { return reject(400,"Invalid JSON."); }
  if (!["health","face_enroll","face_check","face_delete","voice_transcribe","voice_enroll_sample","voice_check","voice_delete","wake_check","voice_followup"].includes(String(input.action)))
    return reject(400,"Invalid action.");
  if (input.action === "face_enroll" && input.replace === true)
    return reject(400,"To replace enrollment, explicitly delete it first.");
  const name = process.platform === "win32" ? (process.env.JARVIS_PYTHON_EXE || "python") : (process.env.JARVIS_PYTHON_EXE || "python3");
  const script = join(process.cwd(), "windows-companion", "perception", "biometric_cli.py");
  const payload = JSON.stringify({action:input.action,owner:owner.principalId,image:input.image,audio:input.audio});
  try {
    const result = await new Promise<string>((resolve,rejectProcess) => {
      const child = spawn(name,[script],{stdio:["pipe","pipe","ignore"],windowsHide:true});
      let out = "";
      let ended = false;
      const stop = (error:Error) => { if(!ended){ended=true; child.kill(); rejectProcess(error);} };
      const timer = setTimeout(()=>stop(new Error("Timeout")), 25000);
      child.stdout.on("data",(chunk:Buffer)=>{
        out += chunk.toString("utf8");
        if(out.length > 16384) stop(new Error("Output too large"));
      });
      child.on("error",(err)=>stop(err));
      child.on("close",(code)=>{
        clearTimeout(timer);
        if(ended) return;
        ended = true;
        if(code===0) resolve(out);
        else rejectProcess(new Error("Backend failed"));
      });
      child.stdin.on("error",()=>{});
      child.stdin.end(payload);
    });
    return Response.json(JSON.parse(result),{headers:cache});
  } catch {
    return reject(503,"Perception backend unavailable. Confirm local Python and model installation.");
  }
}
