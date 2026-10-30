/** Owner-selected model profiles. Only the operator's settings enter this module. */
export type ModelProtocol = "openai-compatible" | "ollama" | "anthropic";
export type ModelLocation = "api" | "local";
export type ModelRatings = { reasoning: number; coding: number; vision: number; speed: number; cost: number };
export type RoutingSettings = {
  mode: "auto" | "manual";
  privacy: "auto" | "local-only" | "cloud-allowed";
  layaEnabled: boolean;
  layaUrl: string;
  weights: { quality: number; speed: number; cost: number };
};
export const DEFAULT_ROUTING: RoutingSettings = {
  mode: "auto", privacy: "auto", layaEnabled: true, layaUrl: "http://127.0.0.1:8000",
  weights: { quality: 5, speed: 3, cost: 2 },
};
export function defaultRatings(): ModelRatings { return {reasoning:3,coding:3,vision:3,speed:3,cost:3}; }
function boundedRating(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? v : fallback;
}
export function validateRatings(raw: unknown): ModelRatings {
  if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) fail("Invalid capability ratings.");
  const r = (raw ?? {}) as Record<string,unknown>;
  for (const key of Object.keys(r)) if (!["reasoning","coding","vision","speed","cost"].includes(key)) fail("Unknown model rating.");
  for (const val of Object.values(r)) if (typeof val !== "number" || !Number.isInteger(val) || val<1 || val>5) fail("Ratings must be integers from 1 to 5.");
  return {...defaultRatings(),...r} as ModelRatings;
}
export function validateRoutingSettings(raw:unknown): RoutingSettings {
  if(!raw || typeof raw!=="object" || Array.isArray(raw)) fail("Invalid LAYA routing settings.");
  const r=raw as Record<string,unknown>;
  if (r.mode!=="auto" && r.mode!=="manual") fail("Routing mode must be auto or manual.");
  if (!["auto","local-only","cloud-allowed"].includes(String(r.privacy))) fail("Invalid privacy policy.");
  if (typeof r.layaEnabled!=="boolean") fail("Invalid LAYA enable flag.");
  const url=String(r.layaUrl ?? "");
  let u:URL;try{u=new URL(url);}catch{return fail("Invalid LAYA endpoint.");}
  if(u.protocol!=="http:" || !["localhost","127.0.0.1","[::1]"].includes(u.hostname) || u.username || u.password || u.pathname!=="/" || u.search || u.hash) fail("LAYA must use an HTTP loopback origin only.");
  const w=r.weights;
  if(!w || typeof w!=="object" || Array.isArray(w)) fail("Invalid routing weights.");
  const weights=w as Record<string,unknown>;
  for(const x of ["quality","speed","cost"]) if(typeof weights[x]!=="number" || !Number.isInteger(weights[x]) || (weights[x] as number)<1 || (weights[x] as number)>5) fail("Weights must be integers from 1 to 5.");
  return {mode:r.mode,privacy:r.privacy as RoutingSettings["privacy"],layaEnabled:r.layaEnabled,layaUrl:u.origin,weights:{quality:weights.quality as number,speed:weights.speed as number,cost:weights.cost as number}};
}
export type ModelProfile = {
  id: string; label: string; location: ModelLocation; protocol: ModelProtocol;
  baseUrl: string; model: string; apiKey: string; createdAt: string; updatedAt: string; ratings?: ModelRatings; enabled?: boolean;
};
export type PublicModelProfile = Omit<ModelProfile, "apiKey"> & { hasApiKey: boolean };
export class ModelSettingsError extends Error {}

function fail(reason: string): never { throw new ModelSettingsError(reason); }
export function publicProfile(profile: ModelProfile): PublicModelProfile {
  const { apiKey, ...rest } = profile;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}
function safeHost(u: URL, location: ModelLocation): void {
  const host = u.hostname.toLowerCase();
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (location === "local") {
    // API keys must not silently travel over LAN. Local servers on another PC
    // need a deliberately reviewed TLS front-end / connector in a later release.
    if (!loopback || (u.protocol !== "http:" && u.protocol !== "https:")) fail("Local LLM endpoints must be loopback localhost/127.0.0.1 URLs.");
  } else {
    if (u.protocol !== "https:" || loopback ||
        host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
        host.endsWith(".test") || !/^[a-z0-9.-]+$/.test(host) || !host.includes(".") ||
        /^\d+\.\d+\.\d+\.\d+$/.test(host)) fail("Cloud provider requires a public HTTPS DNS hostname.");
    if (u.port && u.port !== "443") fail("Cloud provider must use HTTPS port 443.");
  }
}
export function validateModelSettings(input: unknown): Pick<ModelProfile,"label"|"location"|"protocol"|"baseUrl"|"model"|"apiKey"|"ratings"|"enabled"> {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Invalid model profile.");
  const x = input as Record<string,unknown>;
  const label = typeof x.label === "string" ? x.label.trim() : "";
  const location = x.location;
  const protocol = x.protocol;
  const model = typeof x.model === "string" ? x.model.trim() : "";
  const apiKey = typeof x.apiKey === "string" ? x.apiKey.trim() : "";
  if (label.length < 1 || label.length > 64 || /[\x00-\x1f]/.test(label)) fail("Label must contain 1–64 printable characters.");
  if (location !== "api" && location !== "local") fail("Select Cloud API or Local LLM.");
  if (protocol !== "openai-compatible" && protocol !== "ollama" && protocol !== "anthropic") fail("Unsupported provider protocol.");
  if (protocol === "ollama" && location !== "local") fail("Ollama native protocol is local-only.");
  if (protocol === "anthropic" && location !== "api") fail("Anthropic native protocol is cloud-only.");
  if (!model || model.length > 160 || !/^[a-zA-Z0-9_.:/+\-]+$/.test(model)) fail("Invalid model identifier.");
  if (apiKey.length > 8192 || /[\r\n]/.test(apiKey)) fail("Invalid API key value.");
  if (location === "api" && !apiKey) fail("A cloud API key is required.");
  const raw = typeof x.baseUrl === "string" ? x.baseUrl.trim() : "";
  if (!raw || raw.length > 512) fail("Provider URL is missing or too long.");
  let u: URL;
  try { u = new URL(raw); } catch { return fail("Provider URL is invalid."); }
  if (u.username || u.password || u.search || u.hash) fail("Provider URL must not contain credentials, query or fragment.");
  safeHost(u, location);
  if (!/^\/[a-zA-Z0-9/_\-.]*$/.test(u.pathname) || u.pathname.includes("..") || u.pathname.includes("//")) fail("Invalid provider API path.");
  if (protocol === "ollama" && u.pathname !== "/" && u.pathname !== "/api") fail("Ollama native URL must be the server root (or /api).");
  if (protocol === "anthropic" && !["/", "/v1"].includes(u.pathname)) fail("Anthropic URL must be the server origin or /v1.");
  if (protocol === "openai-compatible") {
    // Accept an origin or provider-specific API prefix, not a complete endpoint.
    const clean = u.pathname.replace(/\/+$/, "");
    if (clean.endsWith("/chat/completions")) fail("Enter the API base URL, not /chat/completions.");
  }
  const baseUrl = u.toString().replace(/\/+$/, "");
  if (x.enabled!==undefined && typeof x.enabled!=="boolean") fail("Invalid model enabled setting.");
  return { label, location, protocol, baseUrl, model, apiKey, ratings:validateRatings(x.ratings), enabled:x.enabled!==false };
}

export function modelRequestUrl(profile: ModelProfile): string {
  const u = new URL(profile.baseUrl + "/");
  const base = u.pathname.replace(/\/+$/, "");
  u.pathname = profile.protocol === "ollama"
    ? "/api/chat"
    : profile.protocol === "anthropic"
      ? "/v1/messages"
      : (base || "/v1") + "/chat/completions";
  return u.toString();
}
