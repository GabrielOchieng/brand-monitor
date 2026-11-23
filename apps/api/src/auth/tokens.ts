import type { AuthToken, Prisma } from "@prisma/client";
import { adminPrisma } from "../adminDb";
import { hashToken, newToken } from "./crypto";

export type TokenPurpose = "reset_password" | "invite" | "change_email" | "mfa_challenge" | "oauth_state";

export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  reset_password: 60 * 60 * 1000,
  invite: 7 * 24 * 60 * 60 * 1000,
  change_email: 60 * 60 * 1000,
  mfa_challenge: 5 * 60 * 1000,
  oauth_state: 10 * 60 * 1000,
};

type TokenFields = Omit<Prisma.AuthTokenUncheckedCreateInput, "id" | "tokenHash" | "purpose" | "expiresAt">;

// Returns the raw token (goes in the link or cookie); only its hash is stored.
export async function issueToken(purpose: TokenPurpose, fields: TokenFields, ttlMs = TOKEN_TTL_MS[purpose]): Promise<string> {
  const token = newToken();
  await adminPrisma.authToken.create({
    data: { ...fields, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
  });
  return token;
}

// Reads a live token without using it up (e.g. to show an invite before it's accepted).
export async function peekToken(purpose: TokenPurpose, token: string): Promise<AuthToken | null> {
  const row = await adminPrisma.authToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

// Single use, race-safe: the conditional update means two concurrent requests with the same
// token can't both succeed. Returns the row as it was, or null if missing/used/expired.
export async function consumeToken(purpose: TokenPurpose, token: string): Promise<AuthToken | null> {
  const tokenHash = hashToken(token);
  const { count } = await adminPrisma.authToken.updateMany({
    where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (count !== 1) return null;
  return adminPrisma.authToken.findUnique({ where: { tokenHash } });
}

// Older unused tokens of the same kind stop working when a new one is issued (a second
// "forgot password" email kills the first link).
export async function revokeTokens(where: Prisma.AuthTokenWhereInput): Promise<void> {
  await adminPrisma.authToken.updateMany({ where: { ...where, usedAt: null }, data: { usedAt: new Date() } });
}

// Expired and used tokens are kept a day for debugging, then dropped. Called from the
// login route at most hourly rather than as a scheduled job.
let lastPurge = 0;
export async function purgeOldTokens(): Promise<void> {
  if (Date.now() - lastPurge < 60 * 60 * 1000) return;
  lastPurge = Date.now();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await adminPrisma.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] } });
  await adminPrisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
