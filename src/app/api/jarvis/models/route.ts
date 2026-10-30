/** Authenticated owner-only model configuration and connectivity test. */
import type { NextRequest } from "next/server";
import { getAuthContext } from "@/lib/agent/auth/session";
import { mutationOriginError } from "@/lib/agent/auth/origin";
import { validateRoutingSettings, ModelSettingsError } from "@/lib/agent/models/contracts";
import { activateModel, getModel, listModels, removeModel, saveModel, setRouting } from "@/lib/agent/models/vault";
import { createProfileBridge } from "@/lib/agent/models/bridge";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {"Cache-Control":"no-store"};
function deny(status:number,error:string) { return Response.json({error},{status,headers}); }
async function gate(req:NextRequest,mutation:boolean) {
  if (mutation) { const error=mutationOriginError(req.headers); if(error) return {ok:false as const,response:deny(403,error)}; }
  const principal=await getAuthContext(req);
  if (!principal) return {ok:false as const,response:deny(401,"Authentication required.")};
  if (principal.status !== "ACTIVE" || principal.role !== "OWNER") return {ok:false as const,response:deny(403,"Owner required.")};
  return {ok:true as const,id:principal.principalId};
}
function problem(error:unknown) {
  return error instanceof ModelSettingsError ? deny(400,error.message) : deny(503,"Model configuration unavailable.");
}
async function bodyOf(req:NextRequest):Promise<Record<string,unknown>> {
  const size = Number(req.headers.get("content-length") || 0);
  if (size > 16000) throw new ModelSettingsError("Request too large.");
  const raw = await req.text();
  if (raw.length > 16000) throw new ModelSettingsError("Request too large.");
  const data:unknown=JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ModelSettingsError("Invalid request.");
  return data as Record<string,unknown>;
}
export async function GET(req:NextRequest) {
  const gateResult=await gate(req,false); if(!gateResult.ok) return gateResult.response;
  try { return Response.json(await listModels(gateResult.id),{headers}); }
  catch {return deny(503,"Model profiles unavailable.");}
}
export async function POST(req:NextRequest) {
  const g=await gate(req,true); if(!g.ok) return g.response;
  let b:Record<string,unknown>;
  try{ b=await bodyOf(req); }catch(e){return e instanceof ModelSettingsError ? problem(e) : deny(400,"Invalid JSON.");}
  try {
    if(b.action==="routing") return Response.json(await setRouting(g.id,b.routing),{headers});
    if(b.action==="preview") {
      if(typeof b.objective!=="string" || !b.objective.trim() || b.objective.length>500) return deny(400,"Enter a task description of at most 500 characters.");
      const {selectTaskModel,PrivacyRouteError}=await import("@/lib/agent/models/layaRouter");
      try {
        const choice=await selectTaskModel(g.id,b.objective);
        const selected=choice.modelId?await getModel(g.id,choice.modelId):null;
        return Response.json({selectedLabel:selected?.label ?? "Legacy .env provider",source:choice.source,
          category:choice.category,privacy:choice.privacy,reason:choice.reason},{headers});
      } catch(err) {
        if(err instanceof PrivacyRouteError) return Response.json({blocked:true,reason:err.message},{headers});
        throw err;
      }
    }
    if(b.action==="laya-test") {
      const {routing}=await listModels(g.id);
      const checked=validateRoutingSettings(routing);
      try {
        const response=await fetch(`${checked.layaUrl}/healthz`,{method:"GET",redirect:"error",signal:AbortSignal.timeout(5000)});
        return Response.json({ok:response.ok,kind:response.ok?"LOCAL_LAYA_SERVER_REACHABLE":"LOCAL_LAYA_SERVER_UNHEALTHY",status:response.status},{headers});
      } catch {return Response.json({ok:false,kind:"LOCAL_LAYA_SERVER_UNREACHABLE"},{headers});}
    }
    if(b.action==="save") return Response.json({profile:await saveModel(g.id,b.profile)},{headers});
    if(b.action==="activate") {
      if(b.id !== null && typeof b.id !== "string") return deny(400,"Invalid profile ID.");
      return Response.json(await activateModel(g.id,b.id as string|null),{headers});
    }
    if(b.action==="delete") {
      if(typeof b.id !== "string") return deny(400,"Invalid profile ID.");
      return Response.json(await removeModel(g.id,b.id),{headers});
    }
    if(b.action==="test") {
      if(typeof b.id !== "string") return deny(400,"Invalid profile ID.");
      const profile = await getModel(g.id,b.id);
      if(!profile) return deny(404,"Profile not found.");
      const start=Date.now();
      try {
        // Costed, explicit button action; no user files or task state sent.
        const text = await createProfileBridge(profile).complete([{role:"user",content:"Reply with exactly: JARVIS_MODEL_OK"}]);
        return Response.json({ok:!!text,latencyMs:Date.now()-start,responded:!!text},{headers});
      } catch(e) {
        const status=(e as {status?:number}).status;
        return Response.json({ok:false,httpStatus:typeof status==="number"?status:null,
          error:"Model connection failed. Check the model ID, endpoint, credentials and provider availability."}, {status:502,headers});
      }
    }
    return deny(400,"Unknown action.");
  } catch(e) { return problem(e); }
}
