import { NextRequest } from 'next/server';
import { bootstrapOwner, sessionCookieHeader } from '@/lib/agent/auth/session';
import { mutationOriginError } from '@/lib/agent/auth/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const originError = mutationOriginError(req.headers);
  if (originError) return Response.json({ error: originError }, { status: 403 });
  const body = await req.json().catch(() => null);
  const setupToken = body && typeof body.setupToken === 'string' ? body.setupToken : '';
  const result = await bootstrapOwner(setupToken);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 403 });
  return Response.json({ ok: true, principal: result.ctx }, {
    headers: { 'Set-Cookie': sessionCookieHeader(result.token), 'Cache-Control': 'no-store' },
  });
}
