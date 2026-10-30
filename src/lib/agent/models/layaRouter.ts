/**
 * LAYA task-to-model routing. Privacy is deterministic and evaluated BEFORE
 * any model recommendation; Laya is a local, advisory choice model and cannot
 * authorize a cloud disclosure or an agent tool. No remote Laya endpoints.
 * Laya API: https://github.com/NandhaKishorM/laya (POST /v1/systemone).
 */
import { routingSnapshot } from "./vault";
import { defaultRatings, type ModelProfile, type RoutingSettings } from "./contracts";

export type TaskCategory = "coding" | "computer_use" | "research" | "creative" | "conversation";
export type TaskComplexity = "light" | "medium" | "heavy";
export type Decision = {
  pinnedId: string;
  modelId: string | null;
  source: "single-model" | "manual" | "laya-inference" | "deterministic-fallback" | "legacy-env" | "owner-instruction";
  category: TaskCategory;
  privacy: "local-only" | "cloud-allowed";
  reason: string;
};
export class PrivacyRouteError extends Error { constructor(message:string){super(message);this.name="PrivacyRouteError";} }

/**
 * Route directives are owner intent, not Laya advice.  Only inspect the
 * beginning of the task: later pasted files or page text must not be treated
 * as routing commands.  Strip quoted spans and fenced/inline code examples.
 * `strongest` uses task-relevant capability ratings only (never cost/speed).
 */
export type OwnerRouteDirective = "strongest" | "cloud" | "local" | "strongest-cloud" | "strongest-local" | null;
export function parseOwnerModelDirective(objective:string):OwnerRouteDirective {
  const lead=objective.slice(0,500)
    .replace(/```[\s\S]*?```/g," ").replace(/`[^`]*`/g," ")
    .replace(/"[^"\r\n]*"|'[^'\r\n]*'/g," ")
    .split(/\n\s*\n/)[0];
  // Do not infer a positive command from a negative one.
  const text=lead.replace(/\b(?:don't|do not|never|avoid|without|not)\s+(?:(?:try to|please)\s+)?(?:use|choose|select|pick)\s+(?:(?:the|a|an)\s+)?(?:strongest|most powerful|best|cloud|could|api|local|offline)(?:\s+(?:cloud|could|api|local|offline))?\s*(?:model|llm|ai)?\b/gi," ");
  const command=/\b(?:use|choose|select|pick|route(?:\s+(?:this|it))?\s+to|switch(?:\s+to)?)\s+(?:(?:the|a|an|my|only)\s+)?((?:(?:strongest|most powerful|most capable|highest[ -]quality|best)(?:\s+(?:available|connected|for\s+this\s+task|for\s+the\s+task))?)|(?:cloud|could|api|online|local|offline)(?:\s+(?:only|based))?)(?:\s+(?:(?:cloud|could|api|online|local|offline)\s+)?(?:ai\s+)?(?:model|llm|provider))?/i;
  const match=command.exec(text);
  if (!match) return null;
  // Mentions of a model command as a topic/question are not routing orders.
  // Example: "explain how to use cloud models" must not select cloud.
  if (/\b(?:how|ways|instructions)\s+to\s*$|\b(?:example|tutorial)\s+(?:of|on)\s*$/.test(text.slice(Math.max(0,match.index-64),match.index).toLowerCase())) return null;
  // A statement like "use no cloud model" is not an affirmative routing instruction.
  if (/\b(?:no|not|never)\s*$/.test(text.slice(Math.max(0,match.index-12),match.index))) return null;
  const matched=match[0].toLowerCase();
  const strongest=/\b(strongest|most powerful|most capable|highest[ -]quality|best)\b/.test(matched);
  const cloud=/\b(cloud|could|api|online)\b/.test(matched);
  const local=/\b(local|offline)\b/.test(matched);
  if (strongest) {
    // Prefer explicit locality on either side ("strongest cloud model", "cloud's strongest model").
    const window=text.slice(Math.max(0,match.index-18),match.index+match[0].length+32).toLowerCase();
    if(cloud || /\b(?:strongest|most capable|most powerful|best)\s+(?:cloud|could|api)\b|\b(?:cloud|api)\s+(?:strongest|best)\b/.test(window)) return "strongest-cloud";
    if(local || /\b(?:strongest|most capable|most powerful|best)\s+(?:local|offline)\b|\b(?:local|offline)\s+(?:strongest|best)\b/.test(window)) return "strongest-local";
    return "strongest";
  }
  if(cloud) return "cloud";
  if(local) return "local";
  return null;
}

/** Strength is task-relevant quality ONLY, not latency or affordability. */
export function strengthScore(p:ModelProfile, category:TaskCategory):number {
  const r={...defaultRatings(),...p.ratings};
  return category==="coding"?r.coding*0.75+r.reasoning*0.25:
    category==="computer_use"?r.vision*0.60+r.reasoning*0.40:
    category==="research"?r.reasoning*0.85+r.vision*0.15:
    r.reasoning;
}


// Privacy policy is a minimum boundary, NOT decided by untrusted model text.
export function classifyPrivacy(objective: string, settings: RoutingSettings): Decision["privacy"] {
  if (settings.privacy === "local-only") return "local-only";
  if (settings.privacy === "cloud-allowed") return "cloud-allowed"; // Explicit owner choice in Settings
  return /\b(password|passcode|otp|secret|private|confidential|credential|api[ -]?key|token|bank|account number|health|medical|financial|tax|salary|personal file|private file|personal document|private document|encryption key|ssh key|passport|credit[ -]?card|debit[ -]?card|card number|aadha?ar|upi(?:[ -]?pin)?|national[ -]?id|social[ -]?security|ssn|home[ -]?address|patient|insurance|contact list|inbox|personal email)\b/i.test(objective)
    ? "local-only" : "cloud-allowed";
}
export function classifyTask(objective: string): { category:TaskCategory; complexity:TaskComplexity } {
  const o=objective.slice(0,3000);
  const category:TaskCategory = /\b(code|coding|debug|compile|program|script|typescript|python|refactor|repository)\b/i.test(o) ? "coding" :
    /\b(click|mouse|screen|desktop|window|app|game|minecraft|notepad|keyboard|play video|open settings)\b/i.test(o) ? "computer_use" :
    /\b(research|search|browse|look up|source|article|compare websites)\b/i.test(o) ? "research" :
    /\b(write story|poem|creative|illustrate|brainstorm|design)\b/i.test(o) ? "creative" : "conversation";
  const complexity:TaskComplexity = /\b(complex|difficult|deep|multi-step|analy[sz]e|architecture|entire|complete|autonomous|full|many|thorough|project)\b/i.test(o) || o.length>700 ? "heavy" :
    o.length>120 || /\b(compare|explain|create|search|implement|review)\b/i.test(o) ? "medium" : "light";
  return {category,complexity};
}
export function rateModel(p:ModelProfile, category:TaskCategory, complexity:TaskComplexity, s:RoutingSettings):number {
  const r={...defaultRatings(),...p.ratings};
  const relevant = category==="coding"? r.coding : category==="computer_use"? (r.vision*0.55+r.reasoning*0.45) : r.reasoning;
  const workload = complexity==="heavy"? 1.6 : complexity==="medium"? 1.2 : 0.8;
  return relevant*s.weights.quality*workload + r.speed*s.weights.speed/(complexity==="heavy"?2:1) + r.cost*s.weights.cost;
}
function safeLabel(p:ModelProfile) { return p.label.slice(0,64).replace(/[\r\n]/g," "); }

export async function inferLayaChoice(objective:string, eligible:ModelProfile[], settings:RoutingSettings,
 category:TaskCategory, complexity:TaskComplexity,
 fetcher:typeof fetch=fetch):Promise<{id:string;confidence:number}|null> {
  if (eligible.length<2 || !settings.layaEnabled) return null;
  // Reject unsafe urls even if the stored data was manually tampered with.
  // Corrupt or stale settings must NEVER turn optional advice into a
  // routing outage or an external network request. Fall back locally.
  let u: URL;
  try { u = new URL(settings.layaUrl); } catch { return null; }
  if(u.protocol!=="http:" || !["127.0.0.1","localhost","[::1]"].includes(u.hostname) ||
    u.pathname!=="/" || u.search || u.hash || u.username || u.password) return null;
  // Present the 20 highest-scored candidates, not the first 20 saved profiles.
  const candidates=[...eligible].sort((a,b)=>rateModel(b,category,complexity,settings)-rateModel(a,category,complexity,settings)||a.id.localeCompare(b.id)).slice(0,20);
  const criteria=Object.fromEntries(candidates.map((p,i)=>[`m${i}`,`Model ${safeLabel(p)}: ${p.location}; reasoning ${p.ratings?.reasoning??3}/5, coding ${p.ratings?.coding??3}/5, vision ${p.ratings?.vision??3}/5, speed ${p.ratings?.speed??3}/5, affordability ${p.ratings?.cost??3}/5.`]));
  try {
    const response=await fetcher(`${u.origin}/v1/systemone`,{
      method:"POST",redirect:"error",signal:AbortSignal.timeout(6000),
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        state:{task:objective.slice(0,1200),category,complexity,priority:"privacy-respecting task-quality, then speed/cost",ownerWeights:settings.weights,options:criteria},
        questions:{model:{type:"choice",instructions:`Select the best capable model for the task using owner weightage: quality=${settings.weights.quality}, speed=${settings.weights.speed}, cost=${settings.weights.cost}. Compare reasoning/coding/vision for the task. Only the supplied candidate IDs are possible.`,criteria}},
      }),
    });
    if(!response.ok) return null;
    const raw=await response.text();if(raw.length>40_000)return null;
    const result=JSON.parse(raw) as {answers?:{model?:{choice?:unknown;confidence?:unknown;probabilities?:Record<string,number>}}};
    const a=result.answers?.model;
    const index=typeof a?.choice==="string" && /^m\d+$/.test(a.choice)?Number(a.choice.slice(1)):-1;
    const c=typeof a?.confidence==="number"?a.confidence:(typeof a?.probabilities?.[String(a?.choice)]==="number"?a.probabilities[String(a?.choice)]:0);
    if(index<0 || index>=candidates.length || !Number.isFinite(c) || c<0.55 || c>1) return null;
    return {id:candidates[index].id,confidence:c};
  } catch { return null; } // Runtime absent, offline, invalid response -> deterministic fallback
}
export async function selectTaskModel(ownerId:string, objective:string,
  deps:{fetcher?:typeof fetch}={}):Promise<Decision> {
  const {profiles,activeId,routing}=await routingSnapshot(ownerId);
  const {category,complexity}=classifyTask(objective);
  const directive=parseOwnerModelDirective(objective);
  const inferredPrivacy=classifyPrivacy(objective,routing);
  const enabled=profiles.filter(p=>p.enabled!==false);
  // If a model was explicitly configured in the legacy .env, it is the
  // owner's only model until Settings profiles are added.  Its connection
  // quality cannot be known here; actual HTTP failures are handled by Core.
  if (!profiles.length && routing.privacy==="local-only" &&
      process.env.JARVIS_MODEL_BACKEND!=="ollama") throw new PrivacyRouteError(
    "Local-only privacy is enabled, but no local model profile is configured. Add a local model in AI MODELS or explicitly change the owner privacy policy.");
  if (!profiles.length) return {
    pinnedId:"legacy-env",modelId:null,source:"legacy-env",privacy:routing.privacy==="local-only"?"local-only":"cloud-allowed",category,
    reason:"Only the configured legacy .env provider is available; attempting that provider.",
  };
  if (!enabled.length) throw new PrivacyRouteError("All configured models are disabled. Enable at least one model in Settings → AI Models.");
  let chosen:ModelProfile;
  let source:Decision["source"]="deterministic-fallback";
  let reason="Task-weighted capability, speed and cost score.";
  let privacy=inferredPrivacy;
  // One enabled profile is an explicit owner configuration.  No capability
  // threshold or inferred privacy classifier may reject it.
  if(enabled.length===1) {
    if(routing.privacy==="local-only" && enabled[0].location!=="local")
      throw new PrivacyRouteError("Local-only privacy policy denies the sole enabled cloud model. Enable a local model in AI MODELS.");
    chosen=enabled[0];source="single-model";
    reason="Only one enabled model is configured; using it regardless of location, workload or estimated capability.";
    privacy=chosen.location==="api"?"cloud-allowed":inferredPrivacy;
  } else if(directive) {
    if(routing.privacy==="local-only" && (directive==="cloud"||directive==="strongest-cloud"))
      throw new PrivacyRouteError("Explicit local-only privacy policy forbids cloud routing; change Settings deliberately before using a cloud model.");
    const wantsCloud=directive==="cloud"||directive==="strongest-cloud";
    const wantsLocal=directive==="local"||directive==="strongest-local";
    const pool=enabled.filter(p=>(routing.privacy!=="local-only"||p.location==="local") &&
      (!wantsCloud&&!wantsLocal || (wantsCloud?p.location==="api":p.location==="local")));
    if (!pool.length) throw new PrivacyRouteError(wantsCloud
      ? "Cloud requested, but no enabled cloud/API model is configured. Enable a cloud profile or choose an available model."
      : "Local requested, but no enabled local LLM is configured. Enable a local profile or choose an available model.");
    chosen=[...pool].sort((a,b)=>strengthScore(b,category)-strengthScore(a,category)||a.id.localeCompare(b.id))[0];
    source="owner-instruction";
    reason=`Owner requested ${directive}; selected by task-relevant model strength, bypassing automatic weightage, Laya inference and privacy-based provider preference.`;
    privacy=chosen.location==="api"?"cloud-allowed":inferredPrivacy;
  } else {
    const eligible=enabled.filter(p=>inferredPrivacy!=="local-only"||p.location==="local");
    if (!eligible.length) throw new PrivacyRouteError(
      "Automatic privacy routing requires a local LLM, but multiple enabled profiles are cloud-only. Choose a cloud model explicitly or change privacy in Settings.");
    if(routing.mode==="manual") {
      chosen=eligible.find(p=>p.id===activeId) ?? (()=>{throw new PrivacyRouteError("The manually selected model is disabled or filtered by automatic privacy routing. Explicitly request a model or change Settings.");})();
      source="manual";reason="Manual model selected in Settings.";
    } else if(eligible.length===1) {
      chosen=eligible[0];source="single-model";
      reason="Only one eligible model after automatic privacy routing; no inference needed.";
    } else {
      const ranked=[...eligible].sort((a,b)=>rateModel(b,category,complexity,routing)-rateModel(a,category,complexity,routing)||a.id.localeCompare(b.id));
      chosen=ranked[0];
      const laya=await inferLayaChoice(objective,eligible,routing,category,complexity,deps.fetcher);
      if(laya) {
        const suggested=eligible.find(p=>p.id===laya.id)!;
        const topScore=rateModel(chosen,category,complexity,routing);
        if(rateModel(suggested,category,complexity,routing)>=topScore*0.85) {
          chosen=suggested;source="laya-inference";
          reason=`Local Laya decision accepted (confidence ${laya.confidence.toFixed(2)}); automatic owner weightage enforced.`;
        } else reason="Laya suggestion below automatic capability/weight threshold; deterministic ranking chosen.";
      } else reason="Laya unavailable or low confidence; deterministic weightage used.";
    }
  }
  return {pinnedId:`${chosen.id}|${chosen.updatedAt}`,modelId:chosen.id,source,privacy,category,reason};
}
