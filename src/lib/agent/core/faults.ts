/**
 * JARVIS AGENT RUNTIME — TEST-ONLY fault injection (documented hook).
 *
 * Phase 02 requires live proof that journal/admission/settlement/audit
 * failures are handled fail-closed (DUR-01, DUR-02, DUR-07). This hook
 * lets a TEST harness throw at exactly those write boundaries so the
 * runtime's honest behavior can be exercised end-to-end.
 *
 * It NEVER bypasses Guardian, never fakes results, and is inert unless
 * the environment variable is explicitly set by the test operator:
 *
 *   JARVIS_TEST_FAULT=admission   → effect admission write fails (DUR-01)
 *   JARVIS_TEST_FAULT=settlement  → task settlement write fails (DUR-02)
 *   JARVIS_TEST_FAULT=audit       → Guardian audit write fails (DUR-07)
 *
 * Worst-case impact if a hostile operator sets it on their own server:
 * their own tasks fail closed. It cannot authorize anything.
 */

export type TestFault = "admission" | "settlement" | "audit";

export function injectedFault(): TestFault | null {
  const v = process.env.JARVIS_TEST_FAULT;
  return v === "admission" || v === "settlement" || v === "audit" ? v : null;
}
