/**
 * Authenticated owner-only autonomy configuration (Part 2 / Part 9).
 *
 * GET  -> the profile that is ACTUALLY in effect for this principal, where it
 *         came from, and any warning explaining a rejected or clamped value.
 * POST -> change the tier.
 *
 * This endpoint changes how persistently JARVIS pursues an already-authorized
 * objective. It does NOT and cannot grant a permission: Guardian authorizes
 * every individual tool call independently of the tier, and the response
 * contains no capability grant.
 */
import type { NextRequest } from "next/server";
import { getAuthContext } from "@/lib/agent/auth/session";
import { mutationOriginError } from "@/lib/agent/auth/origin";
import {
  AUTONOMY_TIERS,
  AUTONOMY_PROFILES,
  MAX_STEPS_HARD_CEILING,
  REPEAT_LIMIT_ALL_TIERS,
  isAutonomyTier,
  loadOwnerAutonomyProfile,
  saveOwnerAutonomyProfile,
  type AutonomyTier,
} from "@/lib/agent/core/autonomyPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };
function deny(status: number, error: string) { return Response.json({ error }, { status, headers }); }

async function gate(req: NextRequest, mutation: boolean) {
  if (mutation) { const error = mutationOriginError(req.headers); if (error) return { ok: false as const, response: deny(403, error) }; }
  const principal = await getAuthContext(req);
  if (!principal) return { ok: false as const, response: deny(401, "Authentication required.") };
  if (principal.status !== "ACTIVE" || principal.role !== "OWNER") return { ok: false as const, response: deny(403, "Owner required.") };
  return { ok: true as const, id: principal.principalId };
}

export async function GET(req: NextRequest) {
  const g = await gate(req, false);
  if (!g.ok) return g.response;
  try {
    const record = await loadOwnerAutonomyProfile(g.id);
    return Response.json({
      tier: record.profile.tier,
      profile: record.profile,
      source: record.source,
      warnings: record.warnings,
      untrustedRowIgnored: record.untrustedRowIgnored,
      updatedAt: record.updatedAt,
      // Published so NEXUS can show the real limits instead of invented ones.
      availableTiers: AUTONOMY_TIERS,
      tierPreviews: AUTONOMY_TIERS.map((t) => ({ ...AUTONOMY_PROFILES[t] })),
      limits: {
        maxStepsHardCeiling: MAX_STEPS_HARD_CEILING,
        // Surfaced explicitly: the operator can see this is NOT adjustable.
        repeatLimitFixedAcrossAllTiers: REPEAT_LIMIT_ALL_TIERS,
      },
      // Honest statement of what this endpoint cannot do.
      notice: "The autonomy tier governs how long JARVIS persists within an already-authorized policy. It grants no permission; Guardian authorizes every tool call independently, and destructive, irreversible, financial or out-of-scope actions still require explicit authorization at every tier.",
    }, { headers });
  } catch { return deny(503, "Autonomy configuration unavailable."); }
}

export async function POST(req: NextRequest) {
  const g = await gate(req, true);
  if (!g.ok) return g.response;

  let body: Record<string, unknown>;
  try {
    const size = Number(req.headers.get("content-length") || 0);
    if (size > 4000) return deny(400, "Request too large.");
    const raw = await req.text();
    if (raw.length > 4000) return deny(400, "Request too large.");
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return deny(400, "Invalid request.");
    body = data as Record<string, unknown>;
  } catch { return deny(400, "Invalid JSON."); }

  const tier = body.tier;
  if (!isAutonomyTier(tier)) {
    return deny(400, `tier must be one of: ${AUTONOMY_TIERS.join(", ")}.`);
  }

  try {
    // Only fields the runtime actually consumes are accepted. Anything else is
    // rejected rather than silently stored, so NEXUS can never present a
    // control that has no effect.
    const unknown = Object.keys(body).filter((k) => !["tier", "stepBudget", "replanBudget"].includes(k));
    if (unknown.length > 0) {
      return deny(400, `Unsupported autonomy field(s): ${unknown.join(", ")}. Only tier, stepBudget and replanBudget are wired to the runtime.`);
    }
    const record = await saveOwnerAutonomyProfile(g.id, {
      tier: tier as AutonomyTier,
      stepBudget: typeof body.stepBudget === "number" ? body.stepBudget : undefined,
      replanBudget: typeof body.replanBudget === "number" ? body.replanBudget : undefined,
    });
    return Response.json({
      ok: true,
      tier: record.profile.tier,
      profile: record.profile,
      warnings: record.warnings,
      notice: "Saved. The new tier applies to the next task run; an in-flight run keeps the budget it was admitted with.",
    }, { headers });
  } catch (err) {
    return deny(400, err instanceof Error ? err.message : "Could not save the autonomy configuration.");
  }
}
