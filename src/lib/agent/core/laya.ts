/**
 * Deterministic, bounded LAYA advisory fallback. This is NOT the full LAYA
 * model or a policy authority. It is intentionally non-effectful and cannot
 * choose permissions or execute tools. It can be replaced by a reviewed
 * inference-backed LAYA implementation without changing Core contracts.
 */
export interface LayaAdvice {
  classification: "conversation" | "file_task" | "research" | "computer_use" | "unknown";
  urgency: "normal" | "urgent";
  privacy: "requires_user_review" | "ordinary";
  candidateCapabilities: readonly string[];
  provenance: "deterministic_local_v1";
}
export function adviseTask(objective: string): LayaAdvice {
  const s = objective.slice(0, 4096).toLowerCase();
  const files = /\b(file|folder|directory|document|save|create|write|rename|organize)\b/.test(s);
  const computer = /\b(app|application|screen|window|desktop|click|type|scroll|game)\b/.test(s);
  const research = /\b(search|research|look up|browse|website|webpage)\b/.test(s);
  const sensitive = /\b(password|secret|api key|credential|bank|payment|medical|private)\b/.test(s);
  const urgent = /\b(urgent|immediately|emergency|right now)\b/.test(s);
  const classification = files ? "file_task" : computer ? "computer_use" : research ? "research" : s.trim() ? "conversation" : "unknown";
  const candidateCapabilities = files ? ["filesystem"] : computer ? ["computer_use"] : research ? ["web"] : [];
  return {
    classification,
    urgency: urgent ? "urgent" : "normal",
    privacy: sensitive ? "requires_user_review" : "ordinary",
    candidateCapabilities,
    provenance: "deterministic_local_v1",
  };
}
