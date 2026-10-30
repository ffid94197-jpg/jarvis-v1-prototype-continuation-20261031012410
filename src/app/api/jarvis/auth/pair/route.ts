import { pairDevice, sessionCookieHeader } from "@/lib/agent/auth/session";
import { mutationOriginError } from "@/lib/agent/auth/origin";
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Device pairing request. Creates a PENDING DEVICE principal with a
 * session — identity is established, but it can do NOTHING until the
 * owner approves it (Playbook §4.2 authorization grant).
 */
export async function POST(req: NextRequest) {
  const originError = mutationOriginError(req.headers);
  if (originError) return Response.json({ error: originError }, { status: 403 });
  const { token, ctx } = await pairDevice();
  return Response.json(
    {
      ok: true,
      principal: {
        id: ctx.principalId,
        role: ctx.role,
        status: ctx.status,
        label: ctx.label,
      },
      note: "Paired as PENDING device — awaiting owner approval.",
    },
    { headers: { "Set-Cookie": sessionCookieHeader(token) } },
  );
}
