/**
 * JARVIS-owned bounded model bridge: external models are advisory, never tool
 * executors. Default is existing Z.ai SDK. Optional local-only Ollama backend
 * avoids requiring cloud quota while preserving the same Guardian/Core path.
 *
 * This is a foundation adapter, NOT universal BYOK or a reviewed privacy proof.
 * Only an explicitly selected loopback Ollama service is reachable.
 */
export interface ModelMessage {
  role: "user" | "assistant";
  content: string;
}
export interface ModelBridge {
  complete(messages: ModelMessage[]): Promise<string>;
  report(messages: ModelMessage[], onDelta: (delta: string) => void): Promise<string>;
}

import { modelRequestDeadlineMs } from "./modelDeadline";

export function resolveOllamaSettings(env: NodeJS.ProcessEnv = process.env): {
  url: string;
  model: string;
} {
  const raw = env.JARVIS_OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Invalid local Ollama base URL configuration."); }
  if (url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Local Ollama endpoint must be a bare loopback HTTP origin.");
  }
  const model = env.JARVIS_OLLAMA_MODEL || "";
  if (!model || model.length > 128 || !/^[\w.:-]+$/.test(model)) {
    throw new Error("Configure JARVIS_OLLAMA_MODEL to an installed local model ID.");
  }
  return { url: new URL("/api/chat", url).toString(), model };
}

interface OllamaChatResponse {
  message?: { content?: unknown };
  error?: unknown;
  done?: boolean;
}
function checkHttpStatus(response: Response) {
  if (response.ok) return;
  const err = new Error(`Local model returned HTTP ${response.status}`) as Error & { status?: number };
  err.status = response.status;
  throw err;
}

function createOllamaBridge(): ModelBridge {
  const settings = resolveOllamaSettings();
  const body = (messages: ModelMessage[], stream: boolean, json: boolean) => JSON.stringify({
    model: settings.model,
    messages,
    stream,
    ...(json ? { format: "json" } : {}),
  });
  return {
    async complete(messages) {
      const response = await fetch(settings.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body(messages, false, true),
        signal: AbortSignal.timeout(modelRequestDeadlineMs()),
      });
      checkHttpStatus(response);
      const result = await response.json() as OllamaChatResponse;
      if (result.error || typeof result.message?.content !== "string" || !result.message.content) {
        throw new Error("Local model returned a malformed planning response.");
      }
      return result.message.content;
    },
    async report(messages, onDelta) {
      const response = await fetch(settings.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body(messages, true, false),
        signal: AbortSignal.timeout(modelRequestDeadlineMs()),
      });
      checkHttpStatus(response);
      if (!response.body) throw new Error("Local model streaming response had no body.");
      let full = "";
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const ingest = (line: string) => {
        if (!line.trim()) return;
        const item = JSON.parse(line) as OllamaChatResponse;
        if (item.error) throw new Error("Local model reported a generation failure.");
        const chunk = item.message?.content;
        if (chunk !== undefined && typeof chunk !== "string") {
          throw new Error("Local model stream returned invalid content.");
        }
        if (chunk) { full += chunk; onDelta(chunk); }
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let i: number;
          while ((i = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, i).trim();
            buffer = buffer.slice(i + 1);
            ingest(line);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) ingest(buffer.trim());
        return full;
      } finally {
        reader.releaseLock();
      }
    },
  };
}

async function createZaiBridge(): Promise<ModelBridge> {
  // Lazy initialization: a local-only JARVIS should not initialize a cloud SDK.
  const { default: ZAI } = await import("z-ai-web-dev-sdk");
  const client = await ZAI.create();
  return {
    async complete(messages) {
      const r = await client.chat.completions.create({
        messages: messages.map(m => ({role: m.role, content: m.content})),
        thinking: { type: "disabled" },
      });
      const text = r?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text) throw new Error("Planning model returned an empty response.");
      return text;
    },
    async report(messages, onDelta) {
      const chunks = await client.chat.completions.create({
        messages: messages.map(m => ({role: m.role, content: m.content})),
        stream: true,
        thinking: { type: "disabled" },
      });
      let full = "";
      let buffer = "";
      const parseLine = (line: string) => {
        if (!line.startsWith("data:")) return;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") return;
        const parsed = JSON.parse(data);
        const delta: unknown = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content;
        if (typeof delta === "string" && delta) { full += delta; onDelta(delta); }
      };
      for await (const chunk of chunks as AsyncIterable<unknown>) {
        buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk as ArrayBufferLike).toString("utf8");
        let i: number;
        while ((i = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i+1);
          if (!line) continue;
          try { parseLine(line); } catch { /* SDK may split a partial SSE event */ }
        }
      }
      return full;
    },
  };
}

export async function createModelBridge(ownerId?: string, pinnedId?: string): Promise<ModelBridge> {
  if (ownerId) {
    const { selectedModel, getModel } = await import("../models/vault");
    if (pinnedId && pinnedId !== "legacy-env") {
      // Resume must never re-route a saved task to another cloud provider.
      const [profileId, frozenVersion] = pinnedId.split("|", 2);
      const pinned = await getModel(ownerId, profileId);
      if (!pinned || !frozenVersion || pinned.updatedAt !== frozenVersion) {
        throw new Error("The original task model was removed or changed. Resume is blocked to prevent unintended provider disclosure.");
      }
      // Re-check current owner policy when resuming a durable task. A saved
      // provider pin preserves identity, but MUST NOT grant permanent cloud
      // permission after the owner switches privacy to local-only or disables
      // that provider. Never construct a cloud bridge before this check.
      if (pinned.enabled === false) {
        throw new Error("Pinned model is now disabled. Task resume is blocked.");
      }
      const { routingSnapshot } = await import("../models/vault");
      const { routing } = await routingSnapshot(ownerId);
      if (routing.privacy === "local-only" && pinned.location !== "local") {
        throw new Error("Owner local-only privacy policy blocks this pinned cloud model. Task resume is blocked.");
      }
      const { createProfileBridge } = await import("../models/bridge");
      return createProfileBridge(pinned);
    }
    if (!pinnedId) {
      const active = await selectedModel(ownerId);
      if (active) {
        const { createProfileBridge } = await import("../models/bridge");
        return createProfileBridge(active);
      }
    }
  }
  const backend = (process.env.JARVIS_MODEL_BACKEND || "zai").trim().toLowerCase();
  // Legacy .env routing is pinned to a provider *type*, not an encrypted
  // profile version. On resume, recheck the owner's current hard privacy
  // boundary before initializing any cloud SDK or sending task context.
  if (ownerId && pinnedId === "legacy-env") {
    const { routingSnapshot } = await import("../models/vault");
    const { routing } = await routingSnapshot(ownerId);
    if (routing.privacy === "local-only" && backend !== "ollama") {
      throw new Error("Owner local-only privacy policy denies this legacy cloud provider. Resume is blocked.");
    }
  }
  if (backend === "ollama") return createOllamaBridge();
  if (backend === "openai-compatible") {
    const { createCompatibleBridge } = await import("./compatProvider");
    return createCompatibleBridge();
  }
  if (backend === "zai") {
    // Strictly opt-in local fallback on QUOTA failures, never a silent
    // fallback to another cloud provider. The operator's local Ollama
    // must run next to this server; browser localhost is not the server.
    const { withLocalQuotaFallback } = await import("./localFallback");
    if (process.env.JARVIS_OLLAMA_FALLBACK !== "1") return createZaiBridge();
    const local = createOllamaBridge(); // fail closed if no valid local config
    try { return withLocalQuotaFallback(await createZaiBridge(), local); }
    catch (error) {
      // Cloud client initialization can itself fail with quota problems.
      const { classifyModelFailure } = await import("./modelErrors");
      if (classifyModelFailure(error).code === "MODEL_RATE_LIMITED") return local;
      throw error;
    }
  }
  throw new Error("Unsupported JARVIS_MODEL_BACKEND; use a reviewed configured provider.");
}
