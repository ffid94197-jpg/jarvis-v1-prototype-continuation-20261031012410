/**
 * Operator-configured OpenAI-compatible chat bridge.
 * This is an opt-in provider adapter; it does not store BYOK credentials or
 * authorize tools. Core/Guardian remain responsible for every effect.
 * WARNING: egress filtering must also be enforced by the deployment network.
 */
import type { ModelBridge, ModelMessage } from "./modelProvider";

import { modelRequestDeadlineMs } from "./modelDeadline";
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_STREAM_BYTES = 2 * 1024 * 1024;

export interface CompatibleSettings {
  url: string;
  model: string;
  key: string;
}

export function getCompatibleSettings(env: NodeJS.ProcessEnv = process.env): CompatibleSettings {
  const base = env.JARVIS_COMPAT_BASE_URL;
  const model = env.JARVIS_COMPAT_MODEL;
  const key = env.JARVIS_COMPAT_API_KEY;
  if (!base || !model || !key) throw new Error("Compatible provider configuration is incomplete.");
  let u: URL;
  try { u = new URL(base); } catch { throw new Error("Invalid compatible model endpoint configuration."); }
  // Only the trusted server operator configures this URL. Disallow common
  // unsafe host forms and accidental credentials/redirects in the URI.
  const hostname = u.hostname.toLowerCase();
  const privateIPv4 = /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/;
  if (u.protocol !== "https:" || u.username || u.password || u.hash || u.search ||
      hostname === "localhost" || hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") || hostname.endsWith(".internal") ||
      hostname === "[::1]" || privateIPv4.test(hostname) ||
      /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ||
      !/^[-a-z0-9.]+$/.test(hostname) || !hostname.includes(".")) {
    throw new Error("Compatible model endpoint must be an approved public HTTPS hostname.");
  }
  if (!/^[\w.\-:/]{1,160}$/.test(model)) throw new Error("Invalid configured model identifier.");
  if (key.length > 8192 || key.includes("\r") || key.includes("\n")) throw new Error("Invalid provider credential configuration.");
  const root = u.pathname.replace(/\/+$/, "");
  if (root && root !== "/v1" && !/^\/[-a-zA-Z0-9/_]+$/.test(root)) {
    throw new Error("Invalid compatible endpoint path.");
  }
  // Endpoint must be an origin or a deliberate API prefix; never trust a
  // caller-provided URL from an LLM action or browser payload.
  u.pathname = (root || "/v1") + "/chat/completions";
  return { url: u.toString(), model, key };
}

/** Static, credential-safe failure stage. No provider bodies, URLs, model names or keys. */
type BoundaryStage =
  | "REQUEST_PREPARE" | "REQUEST_TIMEOUT" | "REQUEST_TRANSPORT" | "HTTP_REJECTED"
  | "RESPONSE_LIMIT" | "RESPONSE_NO_BODY" | "RESPONSE_READ" | "RESPONSE_JSON"
  | "RESPONSE_MISSING_CHOICE" | "RESPONSE_TRUNCATED" | "RESPONSE_FILTERED"
  | "RESPONSE_TOOL_ONLY" | "RESPONSE_EMPTY_TEXT" | "RESPONSE_EMPTY_RETRY_EXHAUSTED" | "RESPONSE_CONTENT_SHAPE";

function boundaryFailure(stage: BoundaryStage, status?: number): Error {
  const e = new Error(stage === "REQUEST_TIMEOUT" ? "Provider request timed out." :
    stage === "REQUEST_TRANSPORT" ? "Provider network request failed." :
    "Provider returned a response JARVIS could not use.") as Error & { safeStage?: BoundaryStage; status?: number };
  e.safeStage = stage;
  if (status !== undefined) e.status = status;
  return e;
}

function assertSuccess(r: Response): void {
  if (!r.ok) throw boundaryFailure("HTTP_REJECTED", r.status);
}

function contentFromChoice(body: unknown): string {
  const response = body as { choices?: Array<{
    finish_reason?: unknown;
    message?: { content?: unknown; tool_calls?: unknown; refusal?: unknown }
  }> } | null;
  const choice = response && Array.isArray(response.choices) ? response.choices[0] : undefined;
  if (!choice || !choice.message) throw boundaryFailure("RESPONSE_MISSING_CHOICE");
  const content = choice.message.content;
  if (typeof content === "string" && content.trim()) return content;
  // OpenAI-compatible APIs may use text parts rather than a scalar string.
  // Accept text only: never interpret tool-call payloads as executable actions.
  if (Array.isArray(content) && content.length > 0 && content.length <= 16 &&
      content.every(p => p && typeof p === "object" && p.type === "text" && typeof p.text === "string")) {
    const joined = content.map(p => p.text as string).join("\n");
    if (joined.trim()) return joined;
  }
  if (choice.finish_reason === "length" || choice.finish_reason === "max_tokens")
    throw boundaryFailure("RESPONSE_TRUNCATED");
  if (choice.finish_reason === "content_filter" || choice.finish_reason === "safety")
    throw boundaryFailure("RESPONSE_FILTERED");
  if (choice.finish_reason === "tool_calls" || (Array.isArray(choice.message.tool_calls) && choice.message.tool_calls.length > 0))
    throw boundaryFailure("RESPONSE_TOOL_ONLY");
  if (typeof choice.message.refusal === "string" && choice.message.refusal.length > 0)
    throw boundaryFailure("RESPONSE_FILTERED");
  throw boundaryFailure(content === undefined || content === null || content === "" ?
    "RESPONSE_EMPTY_TEXT" : "RESPONSE_CONTENT_SHAPE");
}

/**
 * JARVIS Core historically encodes initial planner/Guardian instructions as
 * assistant messages. OpenAI-compatible APIs distinguish instructions from
 * previous model output: normalize ONLY the initial assistant-only preface
 * to a system message, leaving the user and actual dialogue history intact.
 * Do not change later assistant replies; never put user text into system.
 */
export function normalizeCompatibleMessages(messages: ModelMessage[]): Array<{role: "system" | "user" | "assistant";content: string}> {
  const firstUser = messages.findIndex(m => m.role === "user");
  if (firstUser < 0) throw new Error("Model request missing user message.");
  const prefix = messages.slice(0, firstUser);
  if (prefix.some(m => m.role !== "assistant")) throw new Error("Unexpected model instruction roles.");
  const rest = messages.slice(firstUser).map(m => ({role:m.role,content:m.content}));
  if (!prefix.length) return rest;
  const instructions = prefix.map(m => m.content).filter(Boolean).join("\n\n");
  return instructions ? [{role:"system",content:instructions},...rest] : rest;
}

export function createCompatibleBridge(
  settings: CompatibleSettings = getCompatibleSettings(),
  request: typeof fetch = fetch,
): ModelBridge {
  // A single repeat is permitted only for a *read-only model completion* whose
  // prior HTTP response was valid but omitted text. No tools are sent here.
  // This provider-specific request option must never reach generic BYOK endpoints.
  const isGemini3 = (() => {
    try { return new URL(settings.url).hostname === "generativelanguage.googleapis.com" &&
      /^gemini-3\./.test(settings.model); } catch { return false; }
  })();
  const payload = (messages: ModelMessage[], stream: boolean, emptyRecovery = false) => JSON.stringify({
    model: settings.model, messages: normalizeCompatibleMessages(messages), stream,
    ...(emptyRecovery && isGemini3 ? { reasoning_effort: "low" } : {}),
  });
  const send = async (messages: ModelMessage[], stream: boolean, emptyRecovery = false) => {
    let body: string;
    try { body = payload(messages, stream, emptyRecovery); }
    catch { throw boundaryFailure("REQUEST_PREPARE"); }
    try {
      return await request(settings.url, {
        method: "POST",
        headers: {"Content-Type":"application/json", Authorization:`Bearer ${settings.key}`},
        body,
        redirect: "error", // never forward credentials to a redirect target
        signal: AbortSignal.timeout(modelRequestDeadlineMs()),
      });
    } catch (err) {
      const name = (err as {name?: unknown} | null)?.name;
      throw boundaryFailure(name === "AbortError" || name === "TimeoutError" ?
        "REQUEST_TIMEOUT" : "REQUEST_TRANSPORT");
    }
  };
  return {
    async complete(messages) {
      const readOnce = async (emptyRecovery: boolean) => {
      const r = await send(messages, false, emptyRecovery);
      assertSuccess(r);
      const contentLength = Number(r.headers.get("content-length") || 0);
      if (contentLength > MAX_JSON_BYTES) throw boundaryFailure("RESPONSE_LIMIT");
      const reader = r.body?.getReader();
      if (!reader) throw boundaryFailure("RESPONSE_NO_BODY");
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          let next: ReadableStreamReadResult<Uint8Array>;
          try { next = await reader.read(); }
          catch { throw boundaryFailure("RESPONSE_READ"); }
          if (next.done) break;
          size += next.value.byteLength;
          if (size > MAX_JSON_BYTES) throw boundaryFailure("RESPONSE_LIMIT");
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let cursor = 0;
      for (const c of chunks) { bytes.set(c, cursor); cursor += c.byteLength; }
      let decoded: unknown;
      try { decoded = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw boundaryFailure("RESPONSE_JSON"); }
      return contentFromChoice(decoded);
      };
      try { return await readOnce(false); }
      catch (firstErr) {
        // Do not retry HTTP, transport, timeouts, truncation, safety filters,
        // malformed JSON, tool-only replies or non-Gemini providers.
        if (!isGemini3 || (firstErr as {safeStage?: unknown} | null)?.safeStage !== "RESPONSE_EMPTY_TEXT")
          throw firstErr;
      }
      try { return await readOnce(true); }
      catch (secondErr) {
        if ((secondErr as {safeStage?: unknown} | null)?.safeStage === "RESPONSE_EMPTY_TEXT")
          throw boundaryFailure("RESPONSE_EMPTY_RETRY_EXHAUSTED");
        throw secondErr;
      }
    },
    async report(messages, onDelta) {
      const r = await send(messages, true);
      assertSuccess(r);
      if (!r.body) throw new Error("Provider returned no stream.");
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let bytes = 0;
      let finished = false;
      let full = "";
      const ingest = (event: string) => {
        const data = event.split(/\r?\n/).filter(x => x.startsWith("data:")).map(x => x.slice(5).trim()).join("\n");
        if (!data) return;
        if (data === "[DONE]") { finished = true; return; }
        const parsed = JSON.parse(data) as { choices?: Array<{ delta?: {content?: unknown} }> };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta != null && typeof delta !== "string") throw new Error("Provider streamed malformed content.");
        if (typeof delta === "string") { full += delta; onDelta(delta); }
      };
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > MAX_STREAM_BYTES) throw new Error("Provider stream exceeded size limit.");
          buffer += decoder.decode(next.value, { stream: true });
          buffer = buffer.replace(/\r\n/g, "\n");
          let at = buffer.indexOf("\n\n");
          while (at >= 0) {
            const event = buffer.slice(0,at);
            buffer = buffer.slice(at + 2);
            ingest(event);
            at = buffer.indexOf("\n\n");
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) ingest(buffer);
      } finally { reader.releaseLock(); }
      if (!finished && full.length === 0) throw new Error("Provider stream ended before generating content.");
      return full;
    },
  };
}
