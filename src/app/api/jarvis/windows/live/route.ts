import { NextRequest } from "next/server";
import { requireActiveSession } from "@/lib/agent/auth/session";
import { companionLiveFeed } from "@/lib/agent/windows/bridge";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Owner-only live MJPEG feed. Browser cannot call the secret-bearing companion directly. */
export async function GET(req: NextRequest) {
  const auth = await requireActiveSession(req);
  if (!auth.ok) return auth.response;
  if (process.env.JARVIS_SCREEN_WATCH_ENABLED !== "1")
    return Response.json({error:"Live screen feed disabled."},{status:403});
  try { return await companionLiveFeed(); }
  catch { return Response.json({error:"Windows screen capture is not running."},{status:503}); }
}
