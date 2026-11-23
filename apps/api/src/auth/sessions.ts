import type { FastifyReply, FastifyRequest } from "fastify";
import { adminPrisma } from "../adminDb";
import { env } from "../env";
import { hashToken, newToken } from "./crypto";

export const SESSION_COOKIE = "bm_session";
const ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
// last_seen_at is written at most this often, not on every request.
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionRow {
  id: string;
  userId: string;
  activeOrgId: string | null;
}

export function readCookie(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

// HttpOnly so page scripts can't read it; SameSite=Lax so other sites can't send it on
// cross-site POSTs. Subdomains of the same site still can, which is why server.ts also checks
// Origin on every state-changing request. Secure whenever the web app runs on https.
export function cookieAttributes(maxAgeSeconds: number): string {
  const parts = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (env.cookieDomain) parts.push(`Domain=${env.cookieDomain}`);
  if (env.webAppUrl.startsWith("https://")) parts.push("Secure");
  return parts.join("; ");
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.header("set-cookie", `${SESSION_COOKIE}=${token}; ${cookieAttributes(ABSOLUTE_LIFETIME_MS / 1000)}`);
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header("set-cookie", `${SESSION_COOKIE}=; ${cookieAttributes(0)}`);
}

// A fresh token on every sign-in (never reuse one from before login). The active org defaults
// to the user's oldest membership, so a single-org user lands straight in it.
export async function createSession(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  activeOrgId?: string
): Promise<SessionRow> {
  const token = newToken();
  const orgId =
    activeOrgId ??
    (
      await adminPrisma.membership.findFirst({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: { organizationId: true },
      })
    )?.organizationId ??
    null;
  const session = await adminPrisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      activeOrgId: orgId,
      expiresAt: new Date(Date.now() + ABSOLUTE_LIFETIME_MS),
      ip: request.ip,
      userAgent: (request.headers["user-agent"] ?? "").slice(0, 300) || null,
    },
  });
  setSessionCookie(reply, token);
  return { id: session.id, userId, activeOrgId: session.activeOrgId };
}

export async function findSession(request: FastifyRequest): Promise<SessionRow | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const session = await adminPrisma.session.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > IDLE_TIMEOUT_MS) {
    await adminPrisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await adminPrisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now), ip: request.ip } });
  }
  return { id: session.id, userId: session.userId, activeOrgId: session.activeOrgId };
}

export async function deleteSessionFromRequest(request: FastifyRequest): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await adminPrisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

// Password reset/change and 2FA changes sign the user out everywhere else.
export async function revokeUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await adminPrisma.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
}
