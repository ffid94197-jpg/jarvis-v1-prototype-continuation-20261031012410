/**
 * Explicit opt-in, one-way provider failover after a transient provider fault.
 * Never fails over to a cloud provider automatically. The fallback bridge
 * must already be configured as a validated loopback-local service.
 * Fallback acts only on model inference (not OS effects or grants).
 *
 * DIRECTION IS A PRIVACY INVARIANT: cloud -> local only. Failing over toward a
 * local loopback model can never widen data egress, so broadening the trigger
 * set below does not weaken the LAYA privacy boundary.
 *
 * The primary is attempted exactly ONCE per call before failing over. That is
 * deliberate: immediately re-hammering a provider that just returned 429/quota
 * is both useless and abusive. Bounded retry with backoff lives in the Core
 * loop, which can also replan; this wrapper only switches backends.
 */
import type { ModelBridge, ModelIdentity } from "./modelProvider";
import { classifyModelFailure, type ModelErrorCode } from "./modelErrors";

/**
 * Transient faults worth switching backend for.
 *
 * Previously this was hard-coded to MODEL_RATE_LIMITED alone, so the failures
 * the owner actually observed — MODEL_UNAVAILABLE, timeouts, transport errors
 * and empty/malformed responses — discarded the whole task instead of using the
 * authorized local model that was already configured and running.
 *
 * Deliberately EXCLUDED, because they are not transient and failing over would
 * hide a real configuration or authorization problem:
 *   MODEL_AUTH_FAILED          — credentials are wrong; the owner must fix them
 *   MODEL_PRIVACY_ROUTE_BLOCKED— a privacy boundary refusal must stay a refusal
 */
const FAILOVER_CODES: ReadonlySet<ModelErrorCode> = new Set([
  "MODEL_RATE_LIMITED",
  "MODEL_TIMEOUT",
  "MODEL_NETWORK_ERROR",
  "MODEL_UNAVAILABLE",
]);

export function isFailoverCandidate(err: unknown): boolean {
  const failure = classifyModelFailure(err);
  return FAILOVER_CODES.has(failure.code) || failure.retryable;
}

export interface FailoverBridge extends ModelBridge {
  /** Provenance of the backend CURRENTLY serving, so disclosure stays accurate
   * after a failover instead of naming the provider that started the task. */
  readonly identity?: ModelIdentity;
  /** How many times this bridge switched from primary to local. */
  readonly failovers: number;
  /** The last provider fault code seen, for NEXUS diagnostics. Null if none. */
  readonly lastFailureCode: ModelErrorCode | null;
}

export function withLocalQuotaFallback(primary: ModelBridge, local: ModelBridge): FailoverBridge {
  let active: ModelBridge = primary;
  let failovers = 0;
  let lastFailureCode: ModelErrorCode | null = null;

  const record = (error: unknown) => {
    lastFailureCode = classifyModelFailure(error).code;
  };

  return {
    // Getter, not a snapshot: identity must follow the active backend.
    get identity() { return active.identity; },
    get failovers() { return failovers; },
    get lastFailureCode() { return lastFailureCode; },

    async complete(messages) {
      try {
        return await active.complete(messages);
      } catch (error) {
        record(error);
        if (active !== primary || !isFailoverCandidate(error)) throw error;
        const result = await local.complete(messages);
        active = local; // switch only after the fallback request succeeds
        failovers++;
        return result;
      }
    },

    async report(messages, onDelta) {
      let received = false;
      try {
        return await active.report(messages, delta => { received = true; onDelta(delta); });
      } catch (error) {
        record(error);
        // Once any data was streamed, replay could duplicate output. Stop.
        if (active !== primary || received || !isFailoverCandidate(error)) throw error;
        const result = await local.report(messages, onDelta);
        active = local;
        failovers++;
        return result;
      }
    },
  };
}
