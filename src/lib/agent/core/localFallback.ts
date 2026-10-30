/**
 * Explicit opt-in, one-way provider failover after a quota error.
 * Never fails over to a cloud provider automatically. The fallback bridge
 * must already be configured as a validated loopback-local service.
 * Fallback acts only on model inference (not OS effects or grants).
 */
import type { ModelBridge } from "./modelProvider";
import { classifyModelFailure } from "./modelErrors";

export function withLocalQuotaFallback(primary: ModelBridge, local: ModelBridge): ModelBridge {
  let active: ModelBridge = primary;
  return {
    async complete(messages) {
      try { return await active.complete(messages); }
      catch (error) {
        if (active !== primary || classifyModelFailure(error).code !== "MODEL_RATE_LIMITED") throw error;
        const result = await local.complete(messages);
        active = local; // switch only after the fallback request succeeds
        return result;
      }
    },
    async report(messages, onDelta) {
      let received = false;
      try { return await active.report(messages, delta => { received = true; onDelta(delta); }); }
      catch (error) {
        // Once any data was streamed, replay could duplicate output. Stop.
        if (active !== primary || received || classifyModelFailure(error).code !== "MODEL_RATE_LIMITED") throw error;
        const result = await local.report(messages, onDelta);
        active = local;
        return result;
      }
    },
  };
}
