import { NextRequest } from "next/server";
import { getAuthContext, ownerExists, enrollmentConfigured, localDevNoLoginAllowed, openLocalDevOwnerSession, sessionCookieHeader } from "@/lib/agent/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Current session introspection.
 *  200 → authenticated (principal info in body)
 *  401 → no valid session; body says whether bootstrap is still open.
 */
export async function GET(req: NextRequest) {
  const ctx = await getAuthContext(req);
  if (!ctx) {
    if (localDevNoLoginAllowed(req)) {
      // This endpoint is called by NEXUS at first load. Autologin only in
      // dedicated loopback-bound development; normal auth remains untouched.
      try {
        const issued = await openLocalDevOwnerSession(req);
        if (issued.ok) {
          return Response.json(
            { authenticated: true, principal: issued.ctx, localDevelopment: true },
            { headers: {
              'Set-Cookie': sessionCookieHeader(issued.token),
              'Cache-Control': 'no-store',
            } },
          );
        }
        return Response.json({ authenticated: false, error: issued.reason, localDevelopment: true },
          { status: 503, headers: { 'Cache-Control': 'no-store' } });
      } catch {
        return Response.json({ authenticated: false, error: 'Local test session database unavailable.', localDevelopment: true },
          { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
    }
    const bootstrapOpen = enrollmentConfigured() && !(await ownerExists().catch(() => true));
    return Response.json(
      { authenticated: false, bootstrapOpen },
      { status: 401 },
    );
  }
  return Response.json({ authenticated: true, principal: ctx }, { headers: { "Cache-Control": "no-store" } });
}
