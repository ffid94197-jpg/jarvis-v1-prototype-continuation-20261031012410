import { NextRequest } from 'next/server';
import { loginOwner, sessionCookieHeader } from '@/lib/agent/auth/session';
import { mutationOriginError } from '@/lib/agent/auth/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const originError = mutationOriginError(req.headers);
  if (originError) return Response.json({ error: originError }, { status: 403 });
  const body = await req.json().catch(() => null);
  const passphrase = body && typeof body.passphrase === 'string' ? body.passphrase : '';
  const result = await loginOwner(passphrase);
  if (!result.ok) return Response.json({ error: result.reason }, { status: result.status });
  return Response.json({ ok: true, principal: result.ctx }, {
    headers: { 'Set-Cookie': sessionCookieHeader(result.token), 'Cache-Control': 'no-store' },
  });
}
