/**
 * Owner-scoped, read-only JARVIS runtime diagnosis.
 *
 * The diagnostic reads durable task, step, effect and Guardian audit records.
 * It returns classifications and evidence references, never raw objectives,
 * arguments, file contents, provider payloads or secrets. A classification is
 * an observed signal, not proof of a root cause or permission to repair.
 */
import crypto from "node:crypto";

const MAX_TASKS = 30;
const MAX_STEPS = 240;
const MAX_EFFECTS = 180;
const MAX_AUDITS = 120;

const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const shortTask = id => typeof id === "string" ? id.slice(-8) : "unknown";
const safeDate = value => value instanceof Date ? value.toISOString() :
  typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
const parseObject = value => {
  if (typeof value !== "string" || value.length > 8000) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
};

function classifyFailure(value) {
  const text = String(value ?? "").slice(0, 2000).toLowerCase();
  if (/model_rate_limited|\b429\b|rate.?limit|quota|resource exhausted/.test(text))
    return { code: "MODEL_RATE_LIMITED", category: "provider_quota", repairable: false };
  if (/model_auth_failed|unauthorized|invalid api.?key|authentication failed/.test(text))
    return { code: "MODEL_AUTH_FAILED", category: "provider_authentication", repairable: false };
  if (/model_privacy_route_blocked|privacy route|privacy boundary/.test(text))
    return { code: "MODEL_PRIVACY_ROUTE_BLOCKED", category: "privacy_policy", repairable: false };
  if (/model_timeout|timeout|timed out|deadline exceeded|aborterror/.test(text))
    return { code: "TIMEOUT", category: "timeout", repairable: false };
  if (/model_network_error|econnreset|econnrefused|enotfound|dns|fetch failed|network/.test(text))
    return { code: "NETWORK_FAILURE", category: "network", repairable: false };
  if (/guardian|policy denial|authorization denied|not authorized|permission denied|eacces|eperm/.test(text))
    return { code: "AUTHORIZATION_DENIAL", category: "guardian_or_permission", repairable: false };
  if (/invalid json|planner.*parse|parse error|unexpected token|syntaxerror/.test(text))
    return { code: "PLANNER_OR_SYNTAX_ERROR", category: "planner_or_syntax", repairable: true };
  if (/enoent|no such file|file not found|path does not exist/.test(text))
    return { code: "MISSING_RESOURCE", category: "missing_resource", repairable: false };
  if (/typeerror|referenceerror|cannot read properties|is not a function/.test(text))
    return { code: "RUNTIME_TYPE_ERROR", category: "runtime_code_failure", repairable: true };
  if (/build failed|tsc|typescript|compilation failed|module not found/.test(text))
    return { code: "BUILD_OR_MODULE_ERROR", category: "build_or_module_failure", repairable: true };
  if (/effect_unknown|outcome unknown|ambiguous mutation|not blindly replay/.test(text))
    return { code: "UNCERTAIN_EFFECT", category: "effect_reconciliation", repairable: false };
  return { code: "UNCLASSIFIED_FAILURE", category: "unclassified", repairable: false };
}

function recommendation(signal) {
  switch (signal.code) {
    case "MODEL_RATE_LIMITED": return "Wait for provider capacity or select another owner-authorized provider; do not edit code.";
    case "MODEL_AUTH_FAILED": return "Review the selected provider credential through the owner credential settings; do not retry or expose secrets.";
    case "MODEL_PRIVACY_ROUTE_BLOCKED": return "Review the explicit privacy/model routing choice; never bypass the privacy boundary.";
    case "TIMEOUT": return "Inspect the bounded timeout and service health; retry only after confirming no external effect is unsettled.";
    case "NETWORK_FAILURE": return "Check network/DNS/provider availability; this is not evidence of a code defect.";
    case "AUTHORIZATION_DENIAL": return "Review the exact Guardian decision and owner intent; never weaken or bypass Guardian.";
    case "PLANNER_OR_SYNTAX_ERROR": return "Inspect the relevant prompt/parser or source file, then stage a narrowly scoped repair only with a fresh full-file SHA.";
    case "RUNTIME_TYPE_ERROR": return "Inspect the failing tool and source path; establish a reproducible root cause before staging a repair.";
    case "BUILD_OR_MODULE_ERROR": return "Inspect the build output and dependency provenance; do not change package manifests or install dependencies automatically.";
    case "MISSING_RESOURCE": return "Verify the requested workspace path and expected inputs; do not create or overwrite a substitute without owner intent.";
    case "UNCERTAIN_EFFECT": return "Reconcile the exact durable effect and real external state before any retry; never replay an ambiguous mutation.";
    default: return "Collect a fresh, bounded reproduction and inspect source evidence; root cause is not established.";
  }
}

/**
 * @param {string} ownerId Server-derived authenticated principal ID.
 * @param {object} db Server-owned Prisma client.
 */
export async function diagnoseOwnerRuntime(ownerId, db) {
  if (typeof ownerId !== "string" || ownerId.length < 3 || ownerId.length > 250)
    return { status: "unavailable", reason: "authenticated owner required", patterns: [] };

  try {
    const tasks = await db.agentTask.findMany({
      where: { ownerId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: MAX_TASKS,
      select: { id: true, status: true, stepsUsed: true, updatedAt: true, createdAt: true },
    });
    if (!tasks.length) {
      return {
        schemaVersion: 1, status: "no_recent_tasks", generatedAt: new Date().toISOString(),
        sample: { tasks: 0, steps: 0, effects: 0, guardianDenials: 0 },
        summary: { failedTasks: 0, uncertainEffects: 0, patterns: 0 },
        patterns: [], recent: [],
        safety: { readOnly: true, rawObjectivesExposed: false, fileContentsExposed: false, automaticRetry: false },
      };
    }
    const ids = tasks.map(task => task.id);
    const [steps, effects, audits] = await Promise.all([
      db.agentStep.findMany({
        where: { taskId: { in: ids } },
        orderBy: [{ createdAt: "desc" }, { seq: "desc" }],
        take: MAX_STEPS,
        select: { taskId: true, seq: true, kind: true, tool: true, resultJson: true, note: true, createdAt: true },
      }),
      db.effectRecord.findMany({
        where: { taskId: { in: ids } },
        orderBy: { admittedAt: "desc" },
        take: MAX_EFFECTS,
        select: { taskId: true, status: true, tool: true, admittedAt: true, settledAt: true },
      }),
      db.auditLog.findMany({
        where: { taskId: { in: ids }, verdict: "DENY" },
        orderBy: { createdAt: "desc" },
        take: MAX_AUDITS,
        select: { taskId: true, tool: true, verdict: true, reason: true, createdAt: true },
      }),
    ]);

    const byTask = new Map(ids.map(id => [id, { steps: [], effects: [], audits: [] }]));
    for (const row of steps) byTask.get(row.taskId)?.steps.push(row);
    for (const row of effects) byTask.get(row.taskId)?.effects.push(row);
    for (const row of audits) byTask.get(row.taskId)?.audits.push(row);

    const grouped = new Map();
    const recent = [];
    let failedTasks = 0, uncertainEffects = 0;
    const add = (task, signal) => {
      const key = [signal.code, signal.category, signal.tool || "none"].join("|");
      let item = grouped.get(key);
      if (!item) {
        item = {
          id: "diag_" + hash(key).slice(0, 20),
          code: signal.code, category: signal.category, tool: signal.tool || null,
          occurrences: 0, taskRefs: new Set(), latestAt: null, repairableSignal: signal.repairable,
        };
        grouped.set(key, item);
      }
      item.occurrences++;
      item.taskRefs.add(shortTask(task.id));
      const at = safeDate(signal.at || task.updatedAt);
      if (at && (!item.latestAt || at > item.latestAt)) item.latestAt = at;
    };

    for (const task of tasks) {
      const bucket = byTask.get(task.id) || { steps: [], effects: [], audits: [] };
      const signals = [];
      const addLocal = signal => {
        if (!signals.some(x => x.code === signal.code && x.tool === (signal.tool || null)))
          signals.push({ ...signal, tool: signal.tool || null });
      };
      const uncertain = bucket.effects.filter(e => ["ADMITTED", "EFFECT_UNKNOWN"].includes(String(e.status).toUpperCase()));
      if (uncertain.length || task.status === "effect_unknown") {
        addLocal({ code: "UNCERTAIN_EFFECT", category: "effect_reconciliation", repairable: false,
          tool: uncertain[0]?.tool || null, at: uncertain[0]?.admittedAt });
        uncertainEffects += uncertain.length || 1;
      }
      const denials = bucket.audits.length + bucket.steps.filter(s => s.kind === "guardian_deny").length;
      if (denials || task.status === "denied") {
        addLocal({ code: "AUTHORIZATION_DENIAL", category: "guardian_or_permission", repairable: false,
          tool: bucket.audits[0]?.tool || bucket.steps.find(s => s.kind === "guardian_deny")?.tool || null,
          at: bucket.audits[0]?.createdAt });
      }
      for (const step of bucket.steps) {
        if (step.kind === "error") {
          const classified = classifyFailure(step.note);
          addLocal({ ...classified, tool: step.tool, at: step.createdAt });
        } else if (step.kind === "tool_result") {
          const receipt = parseObject(step.resultJson);
          if (receipt && receipt.ok === false) {
            const classified = classifyFailure(receipt.error || receipt.evidence || "");
            addLocal({ ...classified, tool: receipt.tool || step.tool, at: step.createdAt });
          }
        }
      }
      if (["failed", "denied", "effect_unknown", "partial"].includes(String(task.status))) {
        failedTasks++;
        if (!signals.length) addLocal({
          code: "UNCLASSIFIED_FAILURE", category: "unclassified", repairable: false, tool: null, at: task.updatedAt,
        });
      }
      for (const signal of signals) add(task, signal);
      if (signals.length || ["failed", "denied", "effect_unknown", "partial"].includes(String(task.status))) {
        recent.push({
          taskRef: shortTask(task.id), status: task.status, stepsUsed: task.stepsUsed,
          updatedAt: safeDate(task.updatedAt), signals: signals.map(s => ({
            code: s.code, category: s.category, tool: s.tool || null,
          })),
        });
      }
    }

    const patterns = [...grouped.values()].map(item => ({
      ...item,
      taskRefs: [...item.taskRefs].slice(0, 8),
      distinctTasks: item.taskRefs.size,
      confidence: item.code === "UNCERTAIN_EFFECT" || item.code === "AUTHORIZATION_DENIAL" ? "observed" : "signal_only",
      rootCause: item.code === "UNCERTAIN_EFFECT"
        ? "A durable effect is unsettled or explicitly uncertain; the external outcome is not established."
        : item.code === "AUTHORIZATION_DENIAL"
          ? "Guardian recorded a denial; this is a policy boundary, not proof of a software defect."
          : item.code === "MODEL_RATE_LIMITED" || item.code === "MODEL_AUTH_FAILED" || item.code === "MODEL_PRIVACY_ROUTE_BLOCKED"
            ? "The recorded failure points to provider capacity, credentials or privacy routing rather than application code."
            : "The recorded error category is a diagnostic signal; source-level root cause has not yet been independently established.",
      recommendedAction: recommendation(item),
      requiresSourceInspection: item.repairableSignal === true,
      eligibleForAutomaticRepair: false,
    })).sort((a, b) => b.occurrences - a.occurrences || String(b.latestAt).localeCompare(String(a.latestAt)));

    return {
      schemaVersion: 1, status: "diagnosed", generatedAt: new Date().toISOString(),
      sample: { tasks: tasks.length, steps: steps.length, effects: effects.length, guardianDenials: audits.length },
      summary: { failedTasks, uncertainEffects, patterns: patterns.length },
      patterns: patterns.slice(0, 20),
      recent: recent.slice(0, 12),
      safety: { readOnly: true, rawObjectivesExposed: false, fileContentsExposed: false, automaticRetry: false },
    };
  } catch {
    return { schemaVersion: 1, status: "unavailable", reason: "owner-scoped diagnostic records could not be read", patterns: [] };
  }
}
