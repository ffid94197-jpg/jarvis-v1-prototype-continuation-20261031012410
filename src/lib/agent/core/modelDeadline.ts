/** Per-request timeout for supported model HTTP bridges. This is NOT a
 * background-task runtime limit and does not bypass Guardian or privacy.
 * Finite operator overrides are permitted: 30–300 seconds, default 90.
 */
export function modelRequestDeadlineMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.JARVIS_MODEL_REQUEST_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 90_000;
  if (!/^[0-9]{5,6}$/.test(raw)) {
    throw new Error("JARVIS_MODEL_REQUEST_TIMEOUT_MS must be an integer from 30000 to 300000.");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 30_000 || value > 300_000) {
    throw new Error("JARVIS_MODEL_REQUEST_TIMEOUT_MS must be an integer from 30000 to 120000.");
  }
  return value;
}
