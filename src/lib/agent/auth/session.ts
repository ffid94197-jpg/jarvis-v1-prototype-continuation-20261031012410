/**
 * JARVIS AGENT RUNTIME — Phase 01: identity, sessions, ownership.
 *
 * SECURITY MODEL (Playbook §4):
 *  - Opaque server-side sessions. The cookie carries a random 256-bit
 *    token; ONLY its SHA-256 hash is persisted. No custom cryptography.
 *  - The server ALWAYS derives the authoritative principal from the
 *    validated session — a client-subplied owner id is never trusted.
 *  - Sessions expire; principals can be REVOKED (device unpairing).
 *  - State-changing requests additionally pass a same-origin check
 *    (defense-in-depth against CSRF alongside the SameSite=Lax cookie).
 *  - Legacy rows (ownerId=null) are QUARANTINED history: no principal,
 *    including the OWNER, may resume/cancel them (Playbook §4.3 —
 *    legacy tasks are never assigned to an arbitrary user).
 */

import { createHash, randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { publicOrigin, mutationOriginError } from "./origin";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "jarvis_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const ROOT_OWNER_ID = 'jarvis-primary-owner-v1';
/** Local test sessions are never valid when the explicit localhost dev mode is off. */
const LOCAL_DEV_TOKEN_PREFIX = 'jarvis_local_dev_';

/**
 * Temporary isolated-PC development exception, NOT production authentication.
 * In addition to this check, the dedicated launcher binds Next to 127.0.0.1.
 * Never trust proxy headers as proof that a connection originated locally.
 */
export function localDevNoLoginAllowed(req: Pick<NextRequest, 'headers'>): boolean {
  if (process.env.NODE_ENV !== 'development' ||
      process.env.JARVIS_LOCAL_DEV_NO_LOGIN !== '1' ||
      process.env.JARVIS_LOCAL_DEV_BIND !== '127.0.0.1') return false;
  const origin = publicOrigin();
  if (origin !== 'http://localhost:3000' && origin !== 'http://127.0.0.1:3000') return false;
  const host = req.headers.get('host')?.toLowerCase();
  if (!host || host !== new URL(origin).host) return false;
  // Do not enable automatic login via a tunneled/reverse-proxied hostname.
  const forwardedHost = req.headers.get('x-forwarded-host')?.toLowerCase();
  if (forwardedHost && forwardedHost !== host) return false;
  const forwardedProto = req.headers.get('x-forwarded-proto')?.toLowerCase();
  if (forwardedProto && forwardedProto !== 'http') return false;
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return false;
  const submittedOrigin = req.headers.get('origin');
  if (submittedOrigin && submittedOrigin !== origin) return false;
  const referer = req.headers.get('referer');
  if (referer) {
    try { if (new URL(referer).origin !== origin) return false; }
    catch { return false; }
  }
  return true;
}

const scryptAsync = promisify(scrypt);
const loginThrottle = { failures: 0, lockedUntil: 0 }; // provisional single-process mitigation


export type PrincipalRole = "OWNER" | "DEVICE";
export type PrincipalStatus = "ACTIVE" | "PENDING" | "REVOKED";

export interface AuthContext {
  principalId: string;
  sessionId: string;
  role: PrincipalRole;
  status: PrincipalStatus;
  label: string;
}

// ——— token helpers ———

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ——— cookie helpers (plain Response headers — no custom crypto) ———

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${publicOrigin()?.startsWith("https://") ? "; Secure" : ""}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${publicOrigin()?.startsWith("https://") ? "; Secure" : ""}`;
}

// ——— principal / session lifecycle ———

/** Is there an unrevoked OWNER principal already enrolled? */
export async function ownerExists(): Promise<boolean> {
  const owner = await db.principal.findFirst({
    where: { role: "OWNER" },
  });
  return owner !== null;
}

/**
 * Verify a private operator-issued bootstrap credential. Only the SHA-256
 * digest is configured on the server; the raw token is never stored there.
 */
export function enrollmentConfigured(): boolean {
  return Boolean(process.env.JARVIS_SETUP_TOKEN_SHA256 &&
    process.env.JARVIS_OWNER_SCRYPT_HASH && publicOrigin());
}

function verifySetupToken(token: string): boolean {
  const expected = process.env.JARVIS_SETUP_TOKEN_SHA256;
  if (!expected || !/^[0-9a-f]{64}$/i.test(expected) || !token || token.length > 512) return false;
  return timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(expected, 'hex'));
}

/** Verify an scrypt password hash generated locally by the operator. */
async function verifyOwnerPassword(passphrase: string): Promise<boolean> {
  const configured = process.env.JARVIS_OWNER_SCRYPT_HASH ?? '';
  const match = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/i.exec(configured);
  if (!match || typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 256) return false;
  const candidate = (await scryptAsync(passphrase, Buffer.from(match[1], 'hex'), 64)) as Buffer;
  const expected = Buffer.from(match[2], 'hex');
  return timingSafeEqual(candidate, expected);
}

/**
 * The owner ID is a fixed database primary key so concurrent bootstrap
 * requests cannot create two owners. Existing historical owners block
 * enrollment even if revoked. A valid setup token is mandatory.
 */
export async function bootstrapOwner(setupToken: string): Promise<
  { ok: true; token: string; ctx: AuthContext } | { ok: false; reason: string }
> {
  if (!enrollmentConfigured() || !verifySetupToken(setupToken)) {
    return { ok: false, reason: 'Owner enrollment is not authorized.' };
  }
  if (await ownerExists()) {
    return { ok: false, reason: 'Owner already enrolled — bootstrap closed.' };
  }
  let created: { id: string };
  try {
    created = await db.principal.create({
      data: { id: ROOT_OWNER_ID, role: 'OWNER', status: 'ACTIVE', label: 'JARVIS OWNER' },
    });
  } catch {
    return { ok: false, reason: 'Owner claim unavailable or already enrolled.' };
  }
  // Fail closed if another owner appeared due to an older incompatible server.
  const count = await db.principal.count({ where: { role: 'OWNER' } });
  if (count !== 1) {
    await db.principal.update({ where: { id: created.id }, data: { status: 'REVOKED' } });
    return { ok: false, reason: 'Conflicting owner identity; manual review required.' };
  }
  const { token, ctx } = await issueSession(created.id);
  return { ok: true, token, ctx };
}

/** Returning owner access requires the operator-configured password hash. */
export async function loginOwner(passphrase: string): Promise<
  { ok: true; token: string; ctx: AuthContext } | { ok: false; reason: string; status: number }
> {
  if (!process.env.JARVIS_OWNER_SCRYPT_HASH || !publicOrigin()) {
    return { ok: false, reason: 'Owner login is not configured.', status: 503 };
  }
  if (Date.now() < loginThrottle.lockedUntil) {
    return { ok: false, reason: 'Too many attempts; try again later.', status: 429 };
  }
  if (!await verifyOwnerPassword(passphrase)) {
    loginThrottle.failures += 1;
    if (loginThrottle.failures >= 5) {
      loginThrottle.lockedUntil = Date.now() + 15 * 60 * 1000;
      loginThrottle.failures = 0;
    }
    return { ok: false, reason: 'Invalid credentials.', status: 401 };
  }
  const owners = await db.principal.findMany({ where: { role: 'OWNER' } });
  if (owners.length !== 1 || owners[0].status !== 'ACTIVE') {
    return { ok: false, reason: 'Owner identity unavailable; manual recovery required.', status: 403 };
  }
  loginThrottle.failures = 0;
  loginThrottle.lockedUntil = 0;
  const { token, ctx } = await issueSession(owners[0].id);
  return { ok: true, token, ctx };
}

/** Revoke a single session without changing the owner principal. */
export async function revokeCurrentSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  const row = await db.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return row.count > 0;
}

/** Pair a new DEVICE principal. It starts PENDING (quarantined) until
 *  the owner approves it — a paired device cannot act on its own. */
export async function pairDevice(): Promise<{ token: string; ctx: AuthContext }> {
  const created = await db.principal.create({
    data: {
      role: "DEVICE",
      status: "PENDING",
      label: `DEVICE-${randomBytes(4).toString("hex").toUpperCase()}`,
    },
  });
  const { token, ctx } = await issueSession(created.id);
  return { token, ctx };
}

async function issueSession(principalId: string, localDev = false): Promise<{ token: string; ctx: AuthContext }> {
  const token = localDev ? LOCAL_DEV_TOKEN_PREFIX + newSessionToken() : newSessionToken();
  const session = await db.session.create({
    data: {
      principalId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  const p = (await db.principal.findUnique({ where: { id: principalId } }))!;
  return {
    token,
    ctx: {
      principalId,
      sessionId: session.id,
      role: p.role as PrincipalRole,
      status: p.status as PrincipalStatus,
      label: p.label,
    },
  };
}

/**
 * Issue an ordinary, database-backed owner session without a password ONLY in
 * opt-in, loopback-bound development. No identity is selected from client data.
 * Existing revoked/conflicting owners are never revived or overwritten.
 * If no owner exists in the isolated test DB, create the canonical one.
 */
export async function openLocalDevOwnerSession(req: NextRequest): Promise<
  { ok: true; token: string; ctx: AuthContext } | { ok: false; reason: string }
> {
  if (!localDevNoLoginAllowed(req)) return { ok: false, reason: 'Local development auto-login disabled.' };
  let owners = await db.principal.findMany({ where: { role: 'OWNER' } });
  if (owners.length === 0) {
    // Fixed primary key prevents creating additional owners in concurrent requests.
    try {
      await db.principal.create({
        data: { id: ROOT_OWNER_ID, role: 'OWNER', status: 'ACTIVE', label: 'JARVIS LOCAL TEST OWNER' },
      });
    } catch {
      // Other concurrent request may have created the owner. Re-check below.
    }
    owners = await db.principal.findMany({ where: { role: 'OWNER' } });
  }
  if (owners.length !== 1 || owners[0].status !== 'ACTIVE') {
    return { ok: false, reason: 'Owner identity conflict or revocation; refusing local auto-login.' };
  }
  const { token, ctx } = await issueSession(owners[0].id, true);
  return { ok: true, token, ctx };
}

// ——— request authentication ———

/**
 * Derive the authoritative principal from the request's session cookie.
 * Returns null when: no cookie, unknown token, expired session,
 * revoked session, or revoked principal.
 * (PENDING devices DO resolve here — callers decide authorization;
 * the route guard rejects them from task routes with 403.)
 */
export async function getAuthContext(req: NextRequest): Promise<AuthContext | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || token.length < 16 || token.length > 512) return null;
  // Dev-mode sessions must never become reusable production credentials.
  if (token.startsWith(LOCAL_DEV_TOKEN_PREFIX) && !localDevNoLoginAllowed(req)) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { principal: true },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (session.principal.status === "REVOKED") return null;
  // Touch lastSeen (best-effort; never blocks the request).
  db.session
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});
  return {
    principalId: session.principalId,
    sessionId: session.id,
    role: session.principal.role as PrincipalRole,
    status: session.principal.status as PrincipalStatus,
    label: session.principal.label,
  };
}

/** Guard for task-family routes: authenticated + ACTIVE principal. */
export type GuardResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; response: Response };

export async function requireActiveSession(req: NextRequest): Promise<GuardResult> {
  const ctx = await getAuthContext(req);
  if (!ctx) {
    return {
      ok: false,
      response: Response.json(
        { error: "Authentication required. No valid session." },
        { status: 401 },
      ),
    };
  }
  if (ctx.status !== "ACTIVE") {
    return {
      ok: false,
      response: Response.json(
        {
          error: `Principal ${ctx.label} is ${ctx.status} — owner approval required before task operations.`,
        },
        { status: 403 },
      ),
    };
  }
  // Trust operator-configured public origin, not internal proxy Host.
  const originError = mutationOriginError(req.headers);
  if (originError) {
    return { ok: false, response: Response.json({ error: originError }, { status: 403 }) };
  }
  return { ok: true, ctx };
}

/**
 * Ownership check for an existing task.
 *  - foreign task → 404 (existence is NOT disclosed to other principals)
 *  - legacy quarantined task (ownerId=null) → 403 for everyone
 *  - owned → ok
 */
export async function requireOwnedTask(
  ctx: AuthContext,
  taskId: string,
): Promise<
  | { ok: true; task: { id: string; status: string; objective: string } }
  | { ok: false; response: Response }
> {
  const task = await db.agentTask.findUnique({ where: { id: taskId } });
  if (!task) {
    return {
      ok: false,
      response: Response.json({ error: "Task not found." }, { status: 404 }),
    };
  }
  if (task.ownerId === null) {
    return {
      ok: false,
      response: Response.json(
        {
          error:
            "This task predates identity (legacy record) and is quarantined history — not actionable by any principal.",
        },
        { status: 403 },
      ),
    };
  }
  if (task.ownerId !== ctx.principalId) {
    // Do not disclose other principals' task existence.
    return {
      ok: false,
      response: Response.json({ error: "Task not found." }, { status: 404 }),
    };
  }
  return { ok: true, task };
}
