/** Safe user-facing provider error categories. Never return raw API tokens,
 * service error dumps, or internal endpoint URLs to NEXUS. */
export type ModelErrorCode =
  | "MODEL_RATE_LIMITED"
  | "MODEL_AUTH_FAILED"
  | "MODEL_TIMEOUT"
  | "MODEL_NETWORK_ERROR"
  | "MODEL_UNAVAILABLE"
  | "MODEL_PRIVACY_ROUTE_BLOCKED";

export interface ModelFailure { code: ModelErrorCode; publicMessage: string; retryable: boolean }

export function classifyModelFailure(err: unknown): ModelFailure {
  const value = err as { status?: unknown; code?: unknown; message?: unknown } | null;
  const status = typeof value?.status === "number" ? value.status : undefined;
  const raw = typeof value?.message === "string" ? value.message : String(err ?? "");
  const code = typeof value?.code === "string" ? value.code : "";
  const text = `${status ?? ""} ${code} ${raw}`.toLowerCase();
  if ((err as {name?:unknown} | null)?.name === "PrivacyRouteError") return {
    code:"MODEL_PRIVACY_ROUTE_BLOCKED",retryable:false,
    publicMessage:"No enabled model matches the requested provider type, or automatic privacy routing has no eligible model. Enable the requested cloud/local profile in Settings → AI MODELS, or explicitly choose an available model.",
  };
  if (status === 429 || /\b429\b|rate.?limit|quota|too many requests|resource exhausted/.test(text)) {
    return { code: "MODEL_RATE_LIMITED", retryable: true,
      publicMessage: "JARVIS is online, but the selected AI model is rate-limited or its quota is exhausted. Your request was not completed. Please try again later or configure another authorized provider." };
  }
  if (status === 401 || status === 403 || /unauthorized|invalid api.?key|authentication failed/.test(text)) {
    return { code: "MODEL_AUTH_FAILED", retryable: false,
      publicMessage: "JARVIS could not authenticate with the selected AI provider. Ask the owner to review provider credentials." };
  }
  if (status === 408 || status === 504 ||
      (err as {name?:unknown} | null)?.name === "TimeoutError" ||
      /timed? ?out|deadline exceeded|aborterror/.test(text)) {
    return { code: "MODEL_TIMEOUT", retryable: true,
      publicMessage: "The AI model did not respond before the configured deadline. Your task has not been verified as complete." };
  }
  if (/econnrefused|enotfound|econnreset|network|fetch failed|dns/.test(text)) {
    return { code: "MODEL_NETWORK_ERROR", retryable: true,
      publicMessage: "JARVIS could not reach the configured AI provider. Check the connection and provider settings." };
  }
  return { code: "MODEL_UNAVAILABLE", retryable: false,
    publicMessage: "The selected AI model is unavailable. JARVIS did not complete this request." };
}
