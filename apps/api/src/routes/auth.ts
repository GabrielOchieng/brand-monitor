import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { adminPrisma } from "../adminDb";
import { authenticateUser } from "../lib/auth";
import { createRateLimiter } from "../lib/rateLimit";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  dummyPasswordHash,
  hashPassword,
  needsRehash,
  newId,
  normalizeEmail,
  verifyPassword,
} from "../auth/crypto";
import { clearSessionCookie, createSession, deleteSessionFromRequest, revokeUserSessions } from "../auth/sessions";
import { consumeToken, issueToken, peekToken, purgeOldTokens, revokeTokens } from "../auth/tokens";
import { sendResetPasswordEmail } from "../auth/emails";
import { consumeSecondFactor } from "../auth/mfa";
import { endAdminView } from "../auth/adminView";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// In memory, like every limiter here (one container). Per email AND per IP: the email limit
// stops guessing one account's password, the IP limit stops spraying many accounts.
const allowLoginForEmail = createRateLimiter(10, 15 * MINUTE);
const allowLoginForIp = createRateLimiter(30, 15 * MINUTE);
const allowResetForEmail = createRateLimiter(3, HOUR);
const allowResetForIp = createRateLimiter(10, HOUR);
const allowInviteAcceptForIp = createRateLimiter(20, HOUR);

const Email = z.string().trim().min(3).max(254).email();
export const NewPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH);

const LoginSchema = z.object({ email: Email, password: z.string().min(1).max(PASSWORD_MAX_LENGTH) });
const LoginTotpSchema = z.object({
  challenge: z.string().min(1).max(200),
  code: z.string().max(20).optional(),
  recoveryCode: z.string().max(40).optional(),
});
const MFA_ATTEMPTS = 5;
const ForgotSchema = z.object({ email: Email });
const ResetSchema = z.object({ token: z.string().min(1).max(200), password: NewPassword });
const SwitchOrgSchema = z.object({ orgId: z.string().min(1).max(100) });
const AcceptInviteSchema = z.object({
  token: z.string().min(1).max(200),
  password: NewPassword.optional(),
  name: z.string().trim().max(100).optional(),
});

function rateLimited(reply: FastifyReply) {
  return reply.status(429).header("retry-after", "900").send({ error: "rate_limited" });
}

// Everything the web app needs about the signed-in user, in one call.
export async function describeUser(userId: string, activeOrgId: string | null, adminViewOrgId: string | null = null) {
  const user = await adminPrisma.user.findUnique({
    where: { id: userId },
    include: { memberships: { include: { organization: true }, orderBy: { createdAt: "asc" } }, auth: true },
  });
  if (!user) return null;
  const organizations = user.memberships.map((m) => ({
    id: m.organizationId,
    name: m.organization.name,
    role: m.role,
    monitoringPaused: !!m.organization.monitoringPausedAt,
  }));
  // A platform admin's read-only view (auth/adminView.ts): the org they're looking at.
  const viewed = adminViewOrgId && user.platformRole ? await adminPrisma.organization.findUnique({ where: { id: adminViewOrgId } }) : null;
  return {
    user: { id: user.id, email: user.email, name: user.name },
    platformRole: user.platformRole,
    adminView: viewed ? { orgId: viewed.id, name: viewed.name, monitoringPaused: !!viewed.monitoringPausedAt } : null,
    activeOrgId: organizations.some((o) => o.id === activeOrgId) ? activeOrgId : null,
    organizations,
    security: {
      hasPassword: !!user.auth?.passwordHash,
      totpEnabled: !!user.auth?.totpEnabledAt,
      recoveryCodesLeft: user.auth?.totpEnabledAt ? user.auth.recoveryCodeHashes.length : 0,
      googleLinked: !!user.auth?.googleSub,
    },
  };
}

async function sendMe(request: FastifyRequest, reply: FastifyReply, userId: string, activeOrgId: string | null, adminViewOrgId: string | null = null) {
  const me = await describeUser(userId, activeOrgId, adminViewOrgId);
  if (!me) {
    clearSessionCookie(reply);
    return reply.status(401).send({ error: "unauthorized" });
  }
  return reply.send(me);
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const email = normalizeEmail(parsed.data.email);
    if (!allowLoginForIp(request.ip) || !allowLoginForEmail(email)) return rateLimited(reply);
    purgeOldTokens().catch((err) => request.log.error({ err }, "token purge failed"));

    const user = await adminPrisma.user.findUnique({ where: { email }, include: { auth: true } });
    const stored = user?.auth?.passwordHash ?? null;
    // Same work whether or not the account exists, so timing doesn't reveal it.
    const ok = await verifyPassword(parsed.data.password, stored ?? (await dummyPasswordHash()));
    if (!user || !stored || !ok) {
      return reply.status(401).send({ error: "invalid_credentials" });
    }
    if (needsRehash(stored)) {
      await adminPrisma.userAuth.update({ where: { userId: user.id }, data: { passwordHash: await hashPassword(parsed.data.password) } });
    }
    // 2FA on: no session yet. The password step earns a 5-minute challenge token, traded for a
    // session at /auth/login/totp together with a code.
    if (user.auth?.totpEnabledAt) {
      await revokeTokens({ purpose: "mfa_challenge", userId: user.id });
      const challenge = await issueToken("mfa_challenge", { userId: user.id });
      return reply.send({ mfaRequired: true, challenge });
    }
    const session = await createSession(request, reply, user.id);
    return sendMe(request, reply, user.id, session.activeOrgId);
  });

  app.post("/auth/login/totp", async (request, reply) => {
    const parsed = LoginTotpSchema.safeParse(request.body);
    if (!parsed.success || (!parsed.data.code && !parsed.data.recoveryCode)) {
      return reply.status(400).send({ error: "invalid_request" });
    }
    if (!allowLoginForIp(request.ip)) return rateLimited(reply);
    const { challenge, code, recoveryCode } = parsed.data;
    const row = await peekToken("mfa_challenge", challenge);
    if (!row?.userId) return reply.status(400).send({ error: "invalid_or_expired_token" });
    // Five tries per challenge; after that the password step has to be redone (and that one is
    // rate limited per email), so codes can't be guessed at speed.
    const { count } = await adminPrisma.authToken.updateMany({
      where: { id: row.id, attempts: { lt: MFA_ATTEMPTS }, usedAt: null },
      data: { attempts: { increment: 1 } },
    });
    if (count !== 1) {
      await revokeTokens({ id: row.id });
      return reply.status(400).send({ error: "invalid_or_expired_token" });
    }
    if ((await consumeSecondFactor(row.userId, { code, recoveryCode })) !== "ok") {
      return reply.status(401).send({ error: recoveryCode ? "invalid_recovery_code" : "invalid_totp" });
    }
    if (!(await consumeToken("mfa_challenge", challenge))) return reply.status(400).send({ error: "invalid_or_expired_token" });
    const session = await createSession(request, reply, row.userId);
    return sendMe(request, reply, row.userId, session.activeOrgId);
  });

  app.post("/auth/logout", async (request, reply) => {
    await deleteSessionFromRequest(request);
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  // Always 204, whether or not the email has an account. The email is sent without awaiting
  // it, so response time doesn't give that away either.
  app.post("/auth/forgot-password", async (request, reply) => {
    const parsed = ForgotSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const email = normalizeEmail(parsed.data.email);
    if (!allowResetForIp(request.ip)) return rateLimited(reply);
    if (allowResetForEmail(email)) {
      void (async () => {
        const user = await adminPrisma.user.findUnique({ where: { email } });
        if (!user) return;
        await revokeTokens({ purpose: "reset_password", userId: user.id });
        const token = await issueToken("reset_password", { userId: user.id, email });
        await sendResetPasswordEmail(email, token);
      })().catch((err) => request.log.error({ err }, "password reset email failed"));
    }
    return reply.status(204).send();
  });

  // Also used by existing users setting their first password after the move off Clerk.
  // Signs out every session; the user then signs in with the new password.
  app.post("/auth/reset-password", async (request, reply) => {
    const parsed = ResetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const row = await consumeToken("reset_password", parsed.data.token);
    if (!row?.userId) return reply.status(400).send({ error: "invalid_or_expired_token" });
    const passwordHash = await hashPassword(parsed.data.password);
    const now = new Date();
    await adminPrisma.userAuth.upsert({
      where: { userId: row.userId },
      // Following the emailed link proves the address.
      create: { userId: row.userId, passwordHash, passwordChangedAt: now, emailVerifiedAt: now },
      update: { passwordHash, passwordChangedAt: now, emailVerifiedAt: now },
    });
    await revokeUserSessions(row.userId);
    await revokeTokens({ purpose: "reset_password", userId: row.userId });
    return reply.status(204).send();
  });

  app.get("/auth/me", { preHandler: authenticateUser }, async (request, reply) => {
    return sendMe(request, reply, request.user!.userId, request.user!.activeOrgId, request.user!.adminViewOrgId);
  });

  app.post("/auth/switch-org", { preHandler: authenticateUser }, async (request, reply) => {
    const parsed = SwitchOrgSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const { userId, sessionId } = request.user!;
    const membership = await adminPrisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: parsed.data.orgId } },
    });
    if (!membership) return reply.status(404).send({ error: "not_found" });
    // Switching to one of your own orgs ends an admin view.
    await endAdminView(sessionId, userId);
    await adminPrisma.session.update({ where: { id: sessionId }, data: { activeOrgId: parsed.data.orgId } });
    return sendMe(request, reply, userId, parsed.data.orgId);
  });

  // Leaves the platform admin's read-only view. Not under /api/admin: it must work even if
  // the admin role was revoked mid-view.
  app.post("/auth/admin-view/exit", { preHandler: authenticateUser }, async (request, reply) => {
    const { userId, sessionId, activeOrgId } = request.user!;
    await endAdminView(sessionId, userId);
    return sendMe(request, reply, userId, activeOrgId);
  });

  // Organizations are created only by platform admins (routes/admin.ts).

  // What the accept-invite page shows before anything is used up.
  app.get("/auth/invite", async (request, reply) => {
    const token = (request.query as { token?: string }).token ?? "";
    if (!allowInviteAcceptForIp(request.ip)) return rateLimited(reply);
    const row = token ? await peekToken("invite", token) : null;
    if (!row?.organizationId || !row.email) return reply.status(404).send({ error: "invalid_or_expired_token" });
    const org = await adminPrisma.organization.findUnique({ where: { id: row.organizationId } });
    const user = await adminPrisma.user.findUnique({ where: { email: row.email }, include: { auth: true } });
    return reply.send({
      email: row.email,
      organizationName: org?.name ?? "",
      role: row.role,
      // An existing account with a password just joins; anyone else chooses a password here.
      needsPassword: !user?.auth?.passwordHash,
    });
  });

  app.post("/auth/invite/accept", async (request, reply) => {
    if (!allowInviteAcceptForIp(request.ip)) return rateLimited(reply);
    const parsed = AcceptInviteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const { token, password, name } = parsed.data;

    // Check everything that can fail before using the token up.
    const preview = await peekToken("invite", token);
    if (!preview?.organizationId || !preview.email || !preview.role) {
      return reply.status(400).send({ error: "invalid_or_expired_token" });
    }
    const existing = await adminPrisma.user.findUnique({ where: { email: preview.email }, include: { auth: true } });
    const needsPassword = !existing?.auth?.passwordHash;
    if (needsPassword && !password) return reply.status(400).send({ error: "password_required" });

    const row = await consumeToken("invite", token);
    if (!row?.organizationId || !row.email || !row.role) {
      return reply.status(400).send({ error: "invalid_or_expired_token" });
    }
    const orgId = row.organizationId;
    const now = new Date();

    let userId = existing?.id;
    if (!userId) {
      userId = newId("user");
      await adminPrisma.user.create({ data: { id: userId, email: row.email, name: name || null } });
    }
    await adminPrisma.membership.upsert({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      create: { userId, organizationId: orgId, role: row.role },
      update: {},
    });

    if (!needsPassword) {
      // Joined with an existing password: they sign in as usual (no session from an emailed
      // link, so 2FA can't be skipped this way).
      return reply.send({ joined: true, signInRequired: true });
    }
    const passwordHash = await hashPassword(password!);
    await adminPrisma.userAuth.upsert({
      where: { userId },
      create: { userId, passwordHash, passwordChangedAt: now, emailVerifiedAt: now },
      update: { passwordHash, passwordChangedAt: now, emailVerifiedAt: now },
    });
    if (name && existing && !existing.name) await adminPrisma.user.update({ where: { id: userId }, data: { name } });
    await revokeUserSessions(userId);
    await createSession(request, reply, userId, orgId);
    return sendMe(request, reply, userId, orgId);
  });
}
