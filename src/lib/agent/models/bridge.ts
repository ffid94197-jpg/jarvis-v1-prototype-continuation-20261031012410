/** Connect selected owner model to the existing JARVIS Core; never executes tools. */
import type { ModelBridge, ModelMessage } from "../core/modelProvider";
import { createCompatibleBridge } from "../core/compatProvider";
import { modelRequestUrl, type ModelProfile } from "./contracts";

import { modelRequestDeadlineMs } from "../core/modelDeadline";
const MAX_REPLY = 1024 * 1024;
const MAX_STREAM = 2 * 1024 * 1024;
function httpError(response: Response): never {
  const e = new Error(`Model provider returned HTTP ${response.status}`) as Error & { status?: number };
  e.status = response.status;
  throw e;
}
async function readBounded(response: Response, max = MAX_REPLY): Promise<unknown> {
  if (!response.ok) httpError(response);
  if (Number(response.headers.get("content-length") || 0) > max) throw new Error("Model response too large.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Provider response has no body.");
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const v = await reader.read();
      if (v.done) break;
      bytes += v.value.length;
      if (bytes > max) throw new Error("Model response too large.");
      parts.push(v.value);
    }
  } finally { reader.releaseLock(); }
  const buf = new Uint8Array(bytes);
  let i = 0;
  for (const p of parts) { buf.set(p,i); i += p.length; }
  return JSON.parse(new TextDecoder().decode(buf));
}
function startRequest(url: string, key: string, body: unknown, headers: Record<string,string> = {}) {
  return fetch(url, {
    method:"POST", redirect:"error", signal:AbortSignal.timeout(modelRequestDeadlineMs()),
    headers:{"Content-Type":"application/json", ...(key ? { Authorization:`Bearer ${key}` } : {}), ...headers},
    body:JSON.stringify(body),
  });
}
/**
 * Owner-profile provenance. The profile LABEL is the operator's own name for the
 * provider, so it is the accurate disclosure value; the API key is never
 * included. `location` already distinguishes loopback from cloud.
 */
function profileIdentity(p: ModelProfile, backend: string) {
  let host: string | undefined;
  try { host = new URL(p.baseUrl).host; } catch { host = undefined; }
  return {
    backend,
    provider: p.label || `Model profile ${p.id}`,
    modelId: p.model || "not specified in the owner model profile",
    local: p.location === "local",
    host,
  };
}
function createLocalOllama(p: ModelProfile): ModelBridge {
  const url = modelRequestUrl(p);
  const payload = (messages: ModelMessage[], stream: boolean) => ({model:p.model,messages,stream});
  return {
    identity: profileIdentity(p, "ollama"),
    async complete(messages) {
      const response = await startRequest(url,p.apiKey,payload(messages,false));
      const data = await readBounded(response) as {message?:{content?:unknown};error?:unknown};
      if (data.error || typeof data.message?.content !== "string" || !data.message.content) throw new Error("Local Ollama returned no valid text.");
      return data.message.content;
    },
    async report(messages,onDelta) {
      const response = await startRequest(url,p.apiKey,payload(messages,true));
      if (!response.ok) httpError(response);
      if (!response.body) throw new Error("Local Ollama returned no stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", full = "", bytes = 0;
      const feed = (line: string) => {
        if (!line.trim()) return;
        const d = JSON.parse(line) as { message?: {content?:unknown};error?:unknown };
        if (d.error) throw new Error("Local Ollama generation failed.");
        const chunk = d.message?.content;
        if (chunk !== undefined && typeof chunk !== "string") throw new Error("Invalid Ollama stream data.");
        if (chunk) { full += chunk; onDelta(chunk); }
      };
      try {
        while (true) {
          const v = await reader.read(); if (v.done) break;
          bytes += v.value.byteLength; if (bytes > MAX_STREAM) throw new Error("Local model stream too large.");
          buffer += decoder.decode(v.value,{stream:true});
          let i = buffer.indexOf("\n");
          while (i >= 0) { feed(buffer.slice(0,i)); buffer = buffer.slice(i+1); i=buffer.indexOf("\n"); }
        }
        buffer += decoder.decode(); if (buffer.trim()) feed(buffer);
        if (!full) throw new Error("Local Ollama returned an empty stream.");
        return full;
      } finally { reader.releaseLock(); }
    },
  };
}
function createAnthropic(p: ModelProfile): ModelBridge {
  const url = modelRequestUrl(p);
  const complete = async (messages: ModelMessage[]) => {
    const system = messages.filter(m => m.role === "assistant").map(m => m.content).join("\n\n");
    const dialogue = messages.filter(m => m.role === "user").map(m => ({role:"user" as const, content:m.content}));
    if (!dialogue.length) throw new Error("Anthropic requires a user message.");
    const r = await startRequest(url,"",{model:p.model,max_tokens:1024,system,messages:dialogue}, {
      "x-api-key":p.apiKey,"anthropic-version":"2023-06-01",
    });
    const d = await readBounded(r) as {content?:Array<{type?:string;text?:unknown}>};
    const result = d.content?.filter(c => c.type === "text" && typeof c.text === "string").map(c=>c.text).join("\n");
    if (!result) throw new Error("Anthropic returned no text.");
    return result;
  };
  // The bridge supports report by delivering one verified complete result.
  // It does not pretend to offer token-by-token Anthropic streaming.
  return { identity: profileIdentity(p, "anthropic"), complete, async report(messages,onDelta){ const t=await complete(messages); onDelta(t); return t; } };
}
export function createProfileBridge(profile: ModelProfile): ModelBridge {
  if (profile.protocol === "ollama") return createLocalOllama(profile);
  if (profile.protocol === "anthropic") return createAnthropic(profile);
  return createCompatibleBridge(
    {url:modelRequestUrl(profile),model:profile.model,key:profile.apiKey},
    fetch,
    { provider: profile.label, local: profile.location === "local" },
  );
}
