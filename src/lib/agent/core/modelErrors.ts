/** Safe user-facing provider error categories. Never return raw API tokens,
 * service error dumps, or internal endpoint URLs to NEXUS.
 *
 * CLASSIFICATION ORDER (FIX 1 — status precedence)
 * 1. PrivacyRouteError short-circuits: a privacy boundary refusal must stay a
 *    refusal and can never be relabelled as something retryable.
 * 2. An AUTHORITATIVE numeric HTTP status decides the fault class on its own.
 * 3. Only when there is no authoritative status do message-text heuristics run.
 * 4. Anything unexplained fails closed to MODEL_UNAVAILABLE.
 *
 * Why step 2 must come before step 3: a provider's HTTP status is definitive
 * evidence about what went wrong, while its message text is free-form, often
 * quoted from an upstream log, and frequently mentions a condition that is NOT
 * the actual fault. The previous implementation tested rate-limit TEXT first, so
 * `401 + "quota exceeded"` was classified MODEL_RATE_LIMITED. That is not a
 * cosmetic mislabel: MODEL_RATE_LIMITED is retryable and a failover candidate
 * while MODEL_AUTH_FAILED is neither, so a credential fault caused JARVIS to
 * retry and switch backends — burning quota, hammering a provider that had
 * already refused us, and telling the owner "try again later" when the real fix
 * was a bad API key.
 */
export type ModelErrorCode =
  | "MODEL_RATE_LIMITED"
  | "MODEL_AUTH_FAILED"
  | "MODEL_TIMEOUT"
  | "MODEL_NETWORK_ERROR"
  | "MODEL_UNAVAILABLE"
  | "MODEL_PRIVACY_ROUTE_BLOCKED";

export interface ModelFailure { code: ModelErrorCode; publicMessage: string; retryable: boolean }

/**
 * Single source of truth for retryability and the owner-facing wording of each
 * code, so the two can never drift apart between branches. `publicMessage` is
 * always a fixed string: raw provider text is never echoed, which is what keeps
 * keys, tokens and internal endpoint URLs out of NEXUS and the audit log.
 */
const FAILURE_TAXONOMY: Record<ModelErrorCode, { retryable: boolean; publicMessage: string }> = {
  MODEL_RATE_LIMITED: {
    retryable: true,
    publicMessage: "JARVIS is online, but the selected AI model is rate-limited or its quota is exhausted. Your request was not completed. Please try again later or configure another authorized provider.",
  },
  MODEL_AUTH_FAILED: {
    retryable: false,
    publicMessage: "JARVIS could not authenticate with the selected AI provider. Ask the owner to review provider credentials.",
  },
  MODEL_TIMEOUT: {
    retryable: true,
    publicMessage: "The AI model did not respond before the configured deadline. Your task has not been verified as complete.",
  },
  MODEL_NETWORK_ERROR: {
    retryable: true,
    publicMessage: "JARVIS could not reach the configured AI provider. Check the connection and provider settings.",
  },
  MODEL_UNAVAILABLE: {
    retryable: false,
    publicMessage: "The selected AI model is unavailable. JARVIS did not complete this request.",
  },
  MODEL_PRIVACY_ROUTE_BLOCKED: {
    retryable: false,
    publicMessage: "No enabled model matches the requested provider type, or automatic privacy routing has no eligible model. Enable the requested cloud/local profile in Settings → AI MODELS, or explicitly choose an available model.",
  },
};

function failureFor(code: ModelErrorCode): ModelFailure {
  const entry = FAILURE_TAXONOMY[code];
  return { code, publicMessage: entry.publicMessage, retryable: entry.retryable };
}

/**
 * HTTP status codes that are DEFINITIVE about the fault class, and therefore
 * outrank anything the message text happens to say.
 *
 * Deliberately minimal: only statuses whose meaning is unambiguous across
 * providers. 400/404/422/500/502/503 are NOT listed, because their text really
 * does carry the discriminating information (a 500 saying "quota exhausted" is a
 * rate limit; a 503 saying "ECONNRESET" is a transport fault). Those still fall
 * through to the text heuristics, exactly as before.
 */
const STATUS_DECISIONS: ReadonlyMap<number, ModelErrorCode> = new Map<number, ModelErrorCode>([
  [401, "MODEL_AUTH_FAILED"],
  [403, "MODEL_AUTH_FAILED"],
  [429, "MODEL_RATE_LIMITED"],
  [408, "MODEL_TIMEOUT"],
  [504, "MODEL_TIMEOUT"],
]);

/**
 * Read an authoritative HTTP status off an unknown error shape.
 *
 * Accepts a finite number, or a finite numeric string, because different HTTP
 * clients type `status` differently and the signal is equally authoritative
 * either way. NaN, Infinity, booleans, objects and arrays are NOT authoritative
 * and are ignored, so the text heuristics still get their turn. Also reads
 * `statusCode`, the convention used by Node's http module.
 */
function authoritativeStatus(value: { status?: unknown; statusCode?: unknown } | null): number | undefined {
  for (const candidate of [value?.status, value?.statusCode]) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed !== "" && /^-?\d+$/.test(trimmed)) {
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }
  return undefined;
}

/** The only error shape this module inspects. Every field is optional/unknown
 * because a provider SDK can hand us anything at all. */
type ErrorLike = {
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  message?: unknown;
  name?: unknown;
} | null;

export function classifyModelFailure(err: unknown): ModelFailure {
  // Every property read is defensive: this runs inside catch blocks, so throwing
  // here would mask the real provider fault. A getter that throws, a
  // null-prototype object, or a non-object error must all degrade gracefully.
  let value: ErrorLike = null;
  try {
    value = (err && typeof err === "object" ? err : null) as ErrorLike;
  } catch {
    value = null;
  }

  let name = "";
  let raw = "";
  let code = "";
  try {
    name = typeof value?.name === "string" ? value.name : "";
  } catch { name = ""; }
  try {
    raw = typeof value?.message === "string" ? value.message : String(err ?? "");
  } catch { raw = ""; }
  try {
    code = typeof value?.code === "string" ? value.code : "";
  } catch { code = ""; }

  let status: number | undefined;
  try {
    status = authoritativeStatus(value);
  } catch { status = undefined; }

  // 1. A privacy routing refusal is never relabelled, whatever else is attached.
  if (name === "PrivacyRouteError") return failureFor("MODEL_PRIVACY_ROUTE_BLOCKED");

  // 2. AUTHORITATIVE STATUS. This precedes every text heuristic on purpose.
  if (status !== undefined) {
    const decided = STATUS_DECISIONS.get(status);
    if (decided) return failureFor(decided);
  }

  // 3. Text heuristics — reached only when there is no authoritative status.
  const text = `${status ?? ""} ${code} ${raw}`.toLowerCase();
  if (/\b429\b|rate.?limit|quota|too many requests|resource exhausted/.test(text)) {
    return failureFor("MODEL_RATE_LIMITED");
  }
  if (/unauthorized|invalid api.?key|authentication failed/.test(text)) {
    return failureFor("MODEL_AUTH_FAILED");
  }
  if (name === "TimeoutError" || name === "AbortError" ||
      /timed? ?out|deadline exceeded|aborterror/.test(text)) {
    return failureFor("MODEL_TIMEOUT");
  }
  if (/econnrefused|enotfound|econnreset|network|fetch failed|dns/.test(text)) {
    return failureFor("MODEL_NETWORK_ERROR");
  }

  // 4. Fail closed: never claim a cause we could not establish.
  return failureFor("MODEL_UNAVAILABLE");
}
