import { NextRequest } from 'next/server';
import { clearSessionCookieHeader, revokeCurrentSession } from '@/lib/agent/auth/session';
import { mutationOriginError } from '@/lib/agent/auth/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const originError = mutationOriginError(req.headers);
  if (originError) return Response.json({ error: originError }, { status: 403 });
  await revokeCurrentSession(req);
  return Response.json({ ok: true }, {
    headers: { 'Set-Cookie': clearSessionCookieHeader(), 'Cache-Control': 'no-store' },
  });
}
