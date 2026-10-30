import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext } from "@/lib/agent/auth/session";
import { mutationOriginError } from "@/lib/agent/auth/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deny(status: number, error: string) {
  return Response.json({ error }, { status });
}

/**
 * OWNER-ONLY device management.
 *  GET  → list all principals + status
 *  POST → { principalId, action: "approve" | "revoke" }
 *         approve: PENDING → ACTIVE (grant)
 *         revoke : ACTIVE/PENDING → REVOKED + all its sessions revoked
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) return deny(401, "Authentication required.");
  if (ctx.role !== "OWNER" || ctx.status !== "ACTIVE")
    return deny(403, "Owner authorization required.");
  const principals = await db.principal.findMany({
    orderBy: { createdAt: "asc" },
    include: { sessions: { select: { id: true, expiresAt: true, revokedAt: true } } },
  });
  return Response.json({
    ok: true,
    principals: principals.map((p) => ({
      id: p.id,
      role: p.role,
      status: p.status,
      label: p.label,
      createdAt: p.createdAt,
      sessionCount: p.sessions.length,
    })),
  });
}

export async function POST(req: NextRequest) {
  const originError = mutationOriginError(req.headers);
  if (originError) return deny(403, originError);
  const ctx = await getAuthContext(req);
  if (!ctx) return deny(401, "Authentication required.");
  if (ctx.role !== "OWNER" || ctx.status !== "ACTIVE")
    return deny(403, "Owner authorization required.");

  let body: { principalId?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return deny(400, "Invalid JSON body.");
  }
  const id = typeof body.principalId === "string" ? body.principalId : null;
  const action = body.action === "approve" || body.action === "revoke" ? body.action : null;
  if (!id || !action) return deny(400, "principalId and action (approve|revoke) required.");

  const target = await db.principal.findUnique({ where: { id } });
  if (!target) return deny(404, "Principal not found.");
  if (target.id === ctx.principalId) return deny(403, "Owners cannot approve/revoke themselves.");

  if (action === "approve") {
    if (target.status !== "PENDING")
      return deny(409, `Principal is ${target.status}, not PENDING — nothing to approve.`);
    await db.principal.update({ where: { id }, data: { status: "ACTIVE" } });
    return Response.json({ ok: true, principalId: id, status: "ACTIVE" });
  }

  // revoke — also kills every session of that principal
  await db.principal.update({ where: { id }, data: { status: "REVOKED" } });
  await db.session.updateMany({
    where: { principalId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return Response.json({ ok: true, principalId: id, status: "REVOKED" });
}
