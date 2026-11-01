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

/**
 * Advisory-provider provenance.
 *
 * JARVIS Core owns the product identity; a provider adapter supplies
 * intelligence and reports WHICH intelligence it supplied. Before this existed
 * the bridge exposed only complete()/report(), so neither the Core nor the
 * operator could learn which provider was actually serving a task. That is why
 * a greeting was answered by the base model's own self-description ("I am GLM —
 * developed by Zhipu AI"): nothing told the model it was speaking as JARVIS,
 * and nothing let JARVIS disclose its real provider accurately when asked.
 *
 * These fields are metadata, never authority. They cannot authorize a tool,
 * alter routing, or prove a result. They must never contain an API key.
 */
export interface ModelIdentity {
  /** Adapter kind: "zai" | "ollama" | "openai-compatible" | "profile". */
  backend: string;
  /** Human-readable provider label, e.g. "Z.ai", "Ollama (local)", profile label. */
  provider: string;
  /** Actual configured model id, or an explicit "not specified" — never invented. */
  modelId: string;
  /** True when the endpoint is loopback-only. */
  local: boolean;
  /** Endpoint host, for operator diagnostics. Never includes credentials. */
  host?: string;
}

export interface ModelBridge {
  complete(messages: ModelMessage[]): Promise<string>;
  report(messages: ModelMessage[], onDelta: (delta: string) => void): Promise<string>;
  /**
   * Which advisory provider is CURRENTLY serving. Declared as a getter-capable
   * optional property so a failover wrapper can report the backend it actually
   * switched to, instead of the one it started with.
   */
  readonly identity?: ModelIdentity;
}

/**
 * Fold JARVIS's leading instruction messages into ONE real `system` message.
 *
 * ROOT CAUSE THIS FIXES (FIX 2). JARVIS Core encodes the planner contract, the
 * extension catalogue, the LAYA advisory and the JARVIS identity contract as
 * `role: "assistant"` messages, because the internal `ModelMessage` type only
 * allows "user" | "assistant". The OpenAI-compatible adapter already converted
 * that preface into a proper `system` message and the Anthropic adapter already
 * hoisted it into the top-level `system` field — but the Z.ai SDK bridge (the
 * DEFAULT backend, `JARVIS_MODEL_BACKEND=zai`) and the local Ollama bridge
 * passed the roles straight through. Those providers therefore received the
 * JARVIS identity contract as PRIOR ASSISTANT OUTPUT rather than as a system
 * instruction, which is precisely why the base model felt free to answer a
 * greeting with "I am GLM — a large language model developed by Zhipu AI": on
 * the default path the instruction carried no system authority at all.
 *
 * Safety rules, unchanged from the original compatible-adapter implementation:
 * only the assistant-only preface BEFORE the first user message is folded; later
 * assistant turns are real dialogue history and are left alone; user text is
 * never moved into system; a request with no user message is rejected.
 */
export function normalizeSystemInstructions(
  messages: ModelMessage[],
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const firstUser = messages.findIndex((m) => m.role === "user");
  if (firstUser < 0) throw new Error("Model request missing user message.");
  const prefix = messages.slice(0, firstUser);
  if (prefix.some((m) => m.role !== "assistant")) throw new Error("Unexpected model instruction roles.");
  const rest = messages.slice(firstUser).map((m) => ({ role: m.role, content: m.content }));
  if (!prefix.length) return rest;
  const instructions = prefix.map((m) => m.content).filter(Boolean).join("\n\n");
  return instructions ? [{ role: "system", content: instructions }, ...rest] : rest;
}

/**
 * Render the honest disclosure line the Core injects into the planner context.
 * Deterministic and secret-free: it never emits an API key, and it says so
 * explicitly when a model id was not configured rather than guessing one.
 */
export function modelIdentityContext(identity?: ModelIdentity): string {
  if (!identity) {
    return "CURRENT ADVISORY PROVIDER: unavailable (no bridge identity was reported). If asked which model is in use, say that JARVIS could not confirm the active provider rather than naming one.";
  }
  const parts = [
    `backend=${identity.backend}`,
    `provider="${identity.provider}"`,
    `model="${identity.modelId}"`,
    `scope=${identity.local ? "local loopback" : "cloud"}`,
  ];
  if (identity.host) parts.push(`host=${identity.host}`);
  return `CURRENT ADVISORY PROVIDER (accurate disclosure metadata — this is NOT your identity): ${parts.join(" ")}`;
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

// JSON Schema-constrained output for advisory long-horizon plans only. This
// asks the REAL local LLM for a schema-valid response; it never synthesizes a
// fake plan, authorizes tools, or relaxes Core's independent validation.
const GOAL_PLAN_OLLAMA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "integer", enum: [1] },
    milestones: {
      type: "array", minItems: 2, maxItems: 8,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          id: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,23}$" },
          description: { type: "string", minLength: 1, maxLength: 220 },
          dependsOn: { type: "array", items: { type: "string" }, maxItems: 8 },
          evidence: { type: "string", minLength: 1, maxLength: 200 },
        },
        required: ["id", "description", "dependsOn", "evidence"],
      },
    },
  },
  required: ["schemaVersion", "milestones"],
} as const;

export function isAdvisoryGoalPlanCall(messages: ModelMessage[]): boolean {
  return messages.length >= 2 && messages[0].role === "assistant" &&
    messages[0].content.includes("You are an advisory JARVIS goal decomposer");
}

function ollamaRequestDeadlineMs(): number {
  // Local CPU models may require longer bounded inference than cloud APIs.
  // This grants NO tool authority and does not change task completion rules.
  const raw = process.env.JARVIS_OLLAMA_REQUEST_TIMEOUT_MS;
  if (!raw) return modelRequestDeadlineMs();
  if (!/^[0-9]{5,6}$/.test(raw)) throw new Error("Invalid local inference deadline");
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 30000 || n > 300000)
    throw new Error("Local inference deadline outside the supported 30-300 seconds");
  return n;
}

function createOllamaBridge(): ModelBridge {
  const settings = resolveOllamaSettings();
  // Ollama's /api/chat honours role:"system", so the identity contract must be
  // delivered there rather than as a prior assistant turn.
  const body = (messages: ModelMessage[], stream: boolean, json: boolean) => {
    const goal = json && isAdvisoryGoalPlanCall(messages);
    // A small Ollama default context can truncate JARVIS's system contract or
    // the last half of a long user objective. The operator must explicitly
    // opt into a larger local context because KV-cache RAM is model-dependent.
    const requestedContext = process.env.JARVIS_OLLAMA_NUM_CTX;
    const parsedContext = requestedContext && /^\d{4,5}$/.test(requestedContext)
      ? Number(requestedContext) : 0;
    const context = parsedContext >= 4096 && parsedContext <= 32768
      ? parsedContext : undefined;
    // Bound the size of a single tool-call response on slower CPU models.
    // This is a completion-token budget, NEVER an effect/permission budget.
    const rawPredict=process.env.JARVIS_OLLAMA_NUM_PREDICT;
    const parsedPredict=rawPredict && /^\d{3,4}$/.test(rawPredict) ? Number(rawPredict) : 0;
    const predicted=parsedPredict>=384 && parsedPredict<=2048 ? parsedPredict : undefined;
    return JSON.stringify({
      model: settings.model,
      messages: normalizeSystemInstructions(messages),
      stream,
      ...(json ? { format: goal ? GOAL_PLAN_OLLAMA_SCHEMA : "json" } : {}),
      ...(context || goal ? { options: {
        ...(context ? { num_ctx: context } : {}),
        ...(goal ? { temperature: 0, num_predict: 1200 } : predicted ? { num_predict: predicted } : {}),
      } } : {}),
    });
  };
  return {
    identity: {
      backend: "ollama",
      provider: "Ollama (local loopback)",
      modelId: settings.model,
      local: true,
      host: new URL(settings.url).host,
    },
    async complete(messages) {
      const response = await fetch(settings.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body(messages, false, true),
        signal: AbortSignal.timeout(ollamaRequestDeadlineMs()),
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
        signal: AbortSignal.timeout(ollamaRequestDeadlineMs()),
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
    // The Z.ai SDK selects the concrete model itself; this call passes no model
    // id, so the honest disclosure is that it was not specified by JARVIS.
    // Never invent a version number here.
    identity: {
      backend: "zai",
      provider: "Z.ai",
      modelId: process.env.JARVIS_ZAI_MODEL?.trim() || "not specified (selected by the Z.ai SDK)",
      local: false,
    },
    async complete(messages) {
      const r = await client.chat.completions.create({
        // The Z.ai SDK speaks the OpenAI chat schema, which distinguishes a system
        // instruction from prior assistant output. Sending the JARVIS identity
        // contract as "assistant" is what let the base model answer a greeting
        // with its own vendor identity.
        messages: normalizeSystemInstructions(messages),
        thinking: { type: "disabled" },
      });
      const text = r?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text) throw new Error("Planning model returned an empty response.");
      return text;
    },
    async report(messages, onDelta) {
      const chunks = await client.chat.completions.create({
        // The Z.ai SDK speaks the OpenAI chat schema, which distinguishes a system
        // instruction from prior assistant output. Sending the JARVIS identity
        // contract as "assistant" is what let the base model answer a greeting
        // with its own vendor identity.
        messages: normalizeSystemInstructions(messages),
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
