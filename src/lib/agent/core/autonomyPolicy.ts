/**
 * JARVIS V1 — owner-configurable autonomy tiers (Part 2).
 *
 * WHAT THIS MODULE IS
 * A durable, owner-controlled profile governing how LONG and how PERSISTENTLY
 * the Core pursues an already-authorized objective. Exactly two runtime levers
 * are exposed, and both are genuinely consumed:
 *
 *   stepBudget   -> src/app/api/jarvis/task/route.ts via deriveStepBudget():
 *                   the continuous tool-step budget before a durable, resumable
 *                   pause. This replaces the previous hardcoded 12/24 defaults.
 *   replanBudget -> GoalProgressWatchdog: how many times the Core may replan
 *                   within scope after a strategy fails, instead of declaring
 *                   the objective blocked. Previously hardcoded to 2.
 *
 * Deliberately NOT exposed: per-capability, per-device, per-filesystem-path,
 * per-application or per-session grants. Those are Guardian's responsibility
 * (`src/lib/agent/guardian/guardian.ts`, `src/lib/agent/windows/policy.ts`) and
 * exposing them here as an "autonomy" preference would invite exactly the
 * bypass this module must not provide. If a field is not consumed by the
 * runtime it is not offered to NEXUS — decorative toggles are not settings.
 *
 * WHAT THIS MODULE IS *NOT* — read before changing it
 * It is NOT an authorization layer and must never become one. Guardian is
 * consulted independently for EVERY tool call regardless of tier. Therefore:
 *   - there is no `allow`, `permit`, `bypass` or `skipGuardian` field anywhere;
 *   - a tier cannot widen filesystem scope, network egress, device access,
 *     application access or an owner/session boundary;
 *   - destructive, irreversible, financial and out-of-scope actions require
 *     explicit authorization at EVERY tier including `full`;
 *   - `repeatLimit` (identical unverified actions before the run stops) is the
 *     SAME in all tiers and is not an owner knob. Stopping a spin loop is a
 *     safety property, not an autonomy preference;
 *   - MAX_STEPS_HARD_CEILING and GOAL_WATCHDOG_MAX_REVISIONS are absolute caps.
 *
 * "Full Autonomy" means "keep going within what is already authorized", never
 * "decide for yourself what is authorized".
 *
 * TRUST MODEL
 * Profiles live in owner-scoped `JarvisMemory` rows. Only rows whose `source` is
 * exactly OWNER_EXPLICIT are honoured, because memory can also be written from
 * model-derived or tool-observed content — untrusted text must never be able to
 * raise JARVIS's own autonomy. Malformed, out-of-range or untrusted values fail
 * CLOSED to the most restrictive tier (`normal`) and are reported in `warnings`.
 */

// Single source of truth for the durable replan bound lives with the watchdog
// that persists it, so the two can never drift apart.
import { GOAL_WATCHDOG_MAX_REVISIONS } from "./goalPlanner";

export { GOAL_WATCHDOG_MAX_REVISIONS };

/**
 * The Prisma client is imported LAZILY, and that is deliberate — do not hoist it
 * to a top-level import.
 *
 * loop.ts consumes only the PURE parts of this module (deriveStepBudget,
 * AUTONOMY_PROFILES). A top-level `@/lib/db` import would drag the database
 * client into every pure-policy consumer, including the offline security
 * harnesses that load loop.ts and its siblings in a sandbox with no database.
 * The same lazy-import convention is already used by
 * src/app/api/jarvis/models/route.ts.
 */
async function memoryStore() {
  const { db } = await import("@/lib/db");
  return db.jarvisMemory;
}

export const AUTONOMY_TIERS = ["normal", "advanced", "full"] as const;
export type AutonomyTier = (typeof AUTONOMY_TIERS)[number];

/** Durable memory key holding the owner's autonomy configuration. */
export const AUTONOMY_MEMORY_KEY = "jarvis.autonomy.profile";
/** Only this memory source may raise autonomy. Anything else is untrusted. */
export const OWNER_EXPLICIT_SOURCE = "OWNER_EXPLICIT";
/** Autonomy configuration is local-only; it must never be sent to a provider. */
export const AUTONOMY_DATA_CLASS = "LOCAL_PRIVATE";

/**
 * Absolute ceiling on tool steps in one continuous run. No tier, setting or
 * environment variable may exceed it.
 */
export const MAX_STEPS_HARD_CEILING = 48;
/**
 * Absolute ceiling on in-scope replans. See GOAL_WATCHDOG_MAX_REVISIONS above:
 * this is the DURABILITY bound, which must stay at least as large as the most
 * permissive tier so a tier downgrade can never make a legitimate checkpoint
 * unloadable.
 */
/**
 * Identical unverified-action limit, the same at every tier. Mirrors the
 * AutonomyGate watchdog so the two layers cannot disagree.
 */
export const REPEAT_LIMIT_ALL_TIERS = 3;

export type AutonomyProfile = {
  tier: AutonomyTier;
  /** Tool steps permitted in one continuous run before a durable, resumable pause. */
  stepBudget: number;
  /** In-scope replans permitted for one objective when a strategy fails. */
  replanBudget: number;
  /** Consecutive identical unverified actions before the run stops. NOT tier-tunable. */
  repeatLimit: number;
};

/**
 * `normal` reproduces the pre-existing runtime behaviour exactly (12-step
 * default budget, 2 replans), so adopting this system cannot regress a working
 * setup. `advanced` and `full` match ceilings that previously required the
 * JARVIS_EXPERIMENTAL_DESKTOP_CONTROL environment flag.
 */
export const AUTONOMY_PROFILES: Record<AutonomyTier, AutonomyProfile> = {
  normal: { tier: "normal", stepBudget: 12, replanBudget: 2, repeatLimit: REPEAT_LIMIT_ALL_TIERS },
  advanced: { tier: "advanced", stepBudget: 24, replanBudget: 3, repeatLimit: REPEAT_LIMIT_ALL_TIERS },
  full: { tier: "full", stepBudget: MAX_STEPS_HARD_CEILING, replanBudget: GOAL_WATCHDOG_MAX_REVISIONS, repeatLimit: REPEAT_LIMIT_ALL_TIERS },
};

export const DEFAULT_AUTONOMY_TIER: AutonomyTier = "normal";

export function isAutonomyTier(value: unknown): value is AutonomyTier {
  return typeof value === "string" && (AUTONOMY_TIERS as readonly string[]).includes(value);
}

export function autonomyProfile(tier: AutonomyTier): AutonomyProfile {
  // Structural copy so a caller cannot mutate the shared table.
  return { ...AUTONOMY_PROFILES[tier] };
}

export type AutonomySource = "owner-settings" | "environment" | "default";

export type ResolvedAutonomy = {
  profile: AutonomyProfile;
  /** Where the effective tier came from, for honest NEXUS reporting. */
  source: AutonomySource;
  /** Non-fatal reasons a requested value was rejected or clamped. */
  warnings: string[];
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/**
 * Resolve a profile from possibly-hostile input. Fail-closed rules:
 *  - unknown or absent tier -> `normal` (most restrictive);
 *  - every numeric field is clamped to its OWN tier maximum, so a hand-edited
 *    row cannot smuggle in a larger budget than the tier allows;
 *  - `repeatLimit` is always forced to REPEAT_LIMIT_ALL_TIERS.
 */
export function resolveAutonomyProfile(
  input: unknown,
  opts: { source?: AutonomySource } = {},
): ResolvedAutonomy {
  const warnings: string[] = [];
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const requested = record.tier;

  if (requested === undefined || requested === null || requested === "") {
    return { profile: autonomyProfile(DEFAULT_AUTONOMY_TIER), source: opts.source ?? "default", warnings };
  }
  if (!isAutonomyTier(requested)) {
    warnings.push(`Unrecognized autonomy tier ${JSON.stringify(requested)}; using the most restrictive tier "normal".`);
    return { profile: autonomyProfile(DEFAULT_AUTONOMY_TIER), source: opts.source ?? "default", warnings };
  }

  const base = AUTONOMY_PROFILES[requested];
  const clamped: AutonomyProfile = {
    tier: requested,
    stepBudget: clampInt(record.stepBudget, 1, base.stepBudget, base.stepBudget),
    replanBudget: clampInt(record.replanBudget, 0, base.replanBudget, base.replanBudget),
    // Not an owner knob. Forced, whatever the row says.
    repeatLimit: REPEAT_LIMIT_ALL_TIERS,
  };
  if (clamped.stepBudget > MAX_STEPS_HARD_CEILING) clamped.stepBudget = MAX_STEPS_HARD_CEILING;
  if (clamped.replanBudget > GOAL_WATCHDOG_MAX_REVISIONS) clamped.replanBudget = GOAL_WATCHDOG_MAX_REVISIONS;
  if (record.repeatLimit !== undefined && record.repeatLimit !== REPEAT_LIMIT_ALL_TIERS) {
    warnings.push(`repeatLimit is a safety property and was forced to ${REPEAT_LIMIT_ALL_TIERS}; the requested ${JSON.stringify(record.repeatLimit)} was ignored.`);
  }
  if (record.stepBudget !== undefined && clamped.stepBudget !== Number(record.stepBudget)) {
    warnings.push(`stepBudget was clamped to ${clamped.stepBudget}, the maximum for tier "${requested}".`);
  }
  if (record.replanBudget !== undefined && clamped.replanBudget !== Number(record.replanBudget)) {
    warnings.push(`replanBudget was clamped to ${clamped.replanBudget}, the maximum for tier "${requested}".`);
  }
  return { profile: clamped, source: opts.source ?? "owner-settings", warnings };
}

/** Environment override, used by launchers for isolated local development. */
export function autonomyTierFromEnvironment(env: NodeJS.ProcessEnv = process.env): AutonomyTier | null {
  const raw = env.JARVIS_AUTONOMY_TIER;
  if (raw === undefined || raw === "") return null;
  return isAutonomyTier(raw) ? raw : null;
}

export type OwnerAutonomyRecord = {
  profile: AutonomyProfile;
  source: AutonomySource;
  warnings: string[];
  /** True when a stored row existed but was ignored as untrusted. */
  untrustedRowIgnored: boolean;
  updatedAt: string | null;
};

function parseStored(content: string): { value: unknown; error?: string } {
  try { return { value: JSON.parse(content) }; }
  catch { return { value: null, error: "Stored autonomy configuration is not valid JSON." }; }
}

/**
 * Load the owner's durable autonomy profile.
 *
 * A row written by anything other than an explicit owner action is IGNORED
 * (reported via `warnings`/`untrustedRowIgnored`) rather than applied: model
 * output, tool observations and retrieved memories must never raise autonomy.
 */
export async function loadOwnerAutonomyProfile(
  principalId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OwnerAutonomyRecord> {
  const warnings: string[] = [];
  let untrustedRowIgnored = false;
  let updatedAt: string | null = null;

  const store = await memoryStore();
  const row = await store.findFirst({
    where: { principalId, key: AUTONOMY_MEMORY_KEY, deletedAt: null },
    orderBy: { updatedAt: "desc" },
  });

  if (row) {
    updatedAt = row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt);
    if (row.source !== OWNER_EXPLICIT_SOURCE) {
      untrustedRowIgnored = true;
      warnings.push(`Ignored a stored autonomy row with source "${row.source}"; only ${OWNER_EXPLICIT_SOURCE} may set autonomy.`);
    } else {
      const parsed = parseStored(row.content);
      if (parsed.error) warnings.push(parsed.error);
      else {
        const resolved = resolveAutonomyProfile(parsed.value, { source: "owner-settings" });
        return { profile: resolved.profile, source: "owner-settings", warnings: [...warnings, ...resolved.warnings], untrustedRowIgnored, updatedAt };
      }
    }
  }

  const envTier = autonomyTierFromEnvironment(env);
  if (envTier) {
    const resolved = resolveAutonomyProfile({ tier: envTier }, { source: "environment" });
    return { profile: resolved.profile, source: "environment", warnings: [...warnings, ...resolved.warnings], untrustedRowIgnored, updatedAt };
  }
  return { profile: autonomyProfile(DEFAULT_AUTONOMY_TIER), source: "default", warnings, untrustedRowIgnored, updatedAt };
}

export type AutonomyConfigInput = {
  tier: AutonomyTier;
  /** Optional narrowing within the tier. Values above the tier maximum are clamped. */
  stepBudget?: number;
  replanBudget?: number;
};

/**
 * Persist an owner autonomy choice, stamped OWNER_EXPLICIT / LOCAL_PRIVATE.
 *
 * No parameter here can widen a Guardian scope, so the worst an owner can do is
 * ask JARVIS to persist longer inside a policy that is already authorized.
 */
export async function saveOwnerAutonomyProfile(
  principalId: string,
  input: AutonomyConfigInput,
): Promise<OwnerAutonomyRecord> {
  if (!isAutonomyTier(input.tier)) {
    throw new Error(`Invalid autonomy tier ${JSON.stringify(input.tier)}; expected one of ${AUTONOMY_TIERS.join(", ")}.`);
  }
  const resolved = resolveAutonomyProfile(input, { source: "owner-settings" });
  const content = JSON.stringify(resolved.profile);
  const store = await memoryStore();
  const existing = await store.findFirst({
    where: { principalId, key: AUTONOMY_MEMORY_KEY, deletedAt: null },
  });
  const now = new Date();
  if (existing) {
    await store.update({
      where: { id: existing.id },
      data: { content, source: OWNER_EXPLICIT_SOURCE, dataClass: AUTONOMY_DATA_CLASS, version: existing.version + 1 },
    });
  } else {
    await store.create({
      data: {
        principalId, key: AUTONOMY_MEMORY_KEY, content,
        dataClass: AUTONOMY_DATA_CLASS, source: OWNER_EXPLICIT_SOURCE,
      },
    });
  }
  return {
    profile: resolved.profile,
    source: "owner-settings",
    warnings: resolved.warnings,
    untrustedRowIgnored: false,
    updatedAt: now.toISOString(),
  };
}

/** Legacy per-run ceiling when the experimental desktop flag is set. */
const LEGACY_DESKTOP_CEILING = 24;

/**
 * Derive the per-run step budget for one task.
 *
 * The owner tier is both the default and the ceiling, and the legacy
 * JARVIS_EXPERIMENTAL_DESKTOP_CONTROL behaviour is preserved as a FLOOR:
 *
 *   no explicit request -> max(legacy default, tier budget), clamped to ceiling
 *   explicit request    -> honoured, clamped DOWN to the ceiling
 *   ceiling             -> max(legacy ceiling, tier budget), <= MAX_STEPS_HARD_CEILING
 *
 * Taking the maximum against the legacy values means adopting this system can
 * never silently shorten a run that works today; it can only lengthen one the
 * owner has explicitly authorized to run longer.
 */
export function deriveStepBudget(opts: {
  requested?: unknown;
  profile: AutonomyProfile;
  env?: NodeJS.ProcessEnv;
}): { budget: number; ceiling: number } {
  const env = opts.env ?? process.env;
  const experimental = env.JARVIS_EXPERIMENTAL_DESKTOP_CONTROL === "1";
  const legacyCeiling = experimental ? MAX_STEPS_HARD_CEILING : LEGACY_DESKTOP_CEILING;
  const legacyDefault = experimental ? LEGACY_DESKTOP_CEILING : 12;

  const ceiling = Math.min(Math.max(legacyCeiling, opts.profile.stepBudget), MAX_STEPS_HARD_CEILING);
  const requested = typeof opts.requested === "number" && Number.isFinite(opts.requested) && opts.requested > 0
    ? Math.trunc(opts.requested)
    : null;
  const budget = requested === null
    ? Math.min(Math.max(legacyDefault, opts.profile.stepBudget), ceiling)
    : Math.max(1, Math.min(requested, ceiling));
  return { budget, ceiling };
}
