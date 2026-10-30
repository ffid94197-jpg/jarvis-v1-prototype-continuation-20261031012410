/**
 * Owner-managed, opt-in memory and reported World Model state.
 * This endpoint is deliberately NOT a model-context injector. Models cannot
 * request privileged access to local memory by calling this route.
 */
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getAuthContext } from "@/lib/agent/auth/session";
import { mutationOriginError } from "@/lib/agent/auth/origin";
import {
  boundedListLimit, InputValidationError, parseDeleteInput,
  parseMemoryInput, parseWorldInput,
} from "@/lib/agent/memory/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function deny(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
async function owner(req: NextRequest, mutation: boolean) {
  if (mutation) {
    const err = mutationOriginError(req.headers);
    if (err) return { ok: false as const, response: deny(403, err) };
  }
  const ctx = await getAuthContext(req);
  if (!ctx) return { ok: false as const, response: deny(401, "Authentication required.") };
  if (ctx.role !== "OWNER" || ctx.status !== "ACTIVE") {
    return { ok: false as const, response: deny(403, "Active owner authorization required.") };
  }
  return { ok: true as const, principalId: ctx.principalId };
}
function safeError(error: unknown) {
  return error instanceof InputValidationError ? deny(400, error.message) : deny(503, "Memory store unavailable.");
}

export async function GET(req: NextRequest) {
  const a = await owner(req, false);
  if (!a.ok) return a.response;
  const kind = new URL(req.url).searchParams.get("kind") ?? "memory";
  const limit = boundedListLimit(new URL(req.url).searchParams.get("limit"));
  try {
    if (kind === "memory") {
      const rows = await db.jarvisMemory.findMany({
        where: { principalId: a.principalId, deletedAt: null },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, key: true, content: true, dataClass: true, source: true,
          version: true, createdAt: true, updatedAt: true },
      });
      return Response.json({ kind, records: rows }, { headers: { "Cache-Control": "no-store" } });
    }
    if (kind === "world") {
      const rows = await db.jarvisWorldObservation.findMany({
        where: { principalId: a.principalId, retractedAt: null },
        orderBy: { observedAt: "desc" }, take: limit,
        select: { id: true, subject: true, predicate: true, value: true,
          source: true, provenance: true, confidence: true, observedAt: true, expiresAt: true },
      });
      const now = Date.now();
      return Response.json({ kind, records: rows.map(r => ({
        ...r, stale: r.expiresAt !== null && r.expiresAt.getTime() <= now,
      })) }, { headers: { "Cache-Control": "no-store" } });
    }
    return deny(400, "kind must be memory or world.");
  } catch { return deny(503, "Memory store unavailable."); }
}

export async function POST(req: NextRequest) {
  const a = await owner(req, true);
  if (!a.ok) return a.response;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return deny(400, "Invalid input.");
  } catch { return deny(400, "Invalid JSON body."); }
  try {
    if (body.kind === "memory") {
      const parsed = parseMemoryInput(body);
      // User-owned records can be corrected. Every update advances version.
      // This is intentionally opt-in; nothing is inserted from model responses.
      const row = await db.jarvisMemory.upsert({
        where: { principalId_key: { principalId: a.principalId, key: parsed.key } },
        create: { ...parsed, principalId: a.principalId, source: "OWNER_EXPLICIT" },
        update: { content: parsed.content, dataClass: parsed.dataClass,
          deletedAt: null, version: { increment: 1 } },
      });
      return Response.json({ ok: true, kind: "memory", id: row.id, version: row.version },
        { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    if (body.kind === "world") {
      const parsed = parseWorldInput(body);
      const row = await db.jarvisWorldObservation.create({
        data: { ...parsed, principalId: a.principalId },
      });
      return Response.json({ ok: true, kind: "world", id: row.id, source: row.source },
        { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    return deny(400, "kind must be memory or world.");
  } catch (error) { return safeError(error); }
}

export async function DELETE(req: NextRequest) {
  const a = await owner(req, true);
  if (!a.ok) return a.response;
  let input: unknown;
  try { input = await req.json(); } catch { return deny(400, "Invalid JSON body."); }
  try {
    const parsed = parseDeleteInput(input);
    if (parsed.kind === "memory") {
      const result = await db.jarvisMemory.updateMany({
        where: { id: parsed.id, principalId: a.principalId, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      if (!result.count) return deny(404, "Record not found.");
    } else {
      const result = await db.jarvisWorldObservation.updateMany({
        where: { id: parsed.id, principalId: a.principalId, retractedAt: null },
        data: { retractedAt: new Date() },
      });
      if (!result.count) return deny(404, "Record not found.");
    }
    return Response.json({ ok: true, retracted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return safeError(error); }
}
