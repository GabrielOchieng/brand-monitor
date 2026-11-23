import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { adminPrisma } from "../adminDb";
import { authenticateUser } from "../lib/auth";
import { createRateLimiter } from "../lib/rateLimit";
import { PASSWORD_MAX_LENGTH, hashPassword, normalizeEmail, verifyPassword } from "../auth/crypto";
import { revokeUserSessions } from "../auth/sessions";
import { consumeToken, issueToken, revokeTokens } from "../auth/tokens";
import { sendConfirmNewEmail, sendEmailChangedNotice, sendPasswordChangedNotice } from "../auth/emails";
import { NewPassword, describeUser } from "./auth";
import QRCode from "qrcode";
import { decryptSecret, encryptSecret, encryptionConfigured } from "../auth/secretBox";
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from "../auth/totp";
import { TOTP_OFF, consumeSecondFactor } from "../auth/mfa";

const MINUTE = 60 * 1000;
// Changing password or email asks for the current password: limit guesses per user, since a
// stolen session could otherwise brute-force it here.
const allowPasswordCheck = createRateLimiter(10, 15 * MINUTE);
const allowEmailChange = createRateLimiter(5, 60 * MINUTE);
const allowConfirmForIp = createRateLimiter(20, 60 * MINUTE);

const CurrentPassword = z.string().min(1).max(PASSWORD_MAX_LENGTH);
const ProfileSchema = z.object({ name: z.string().trim().max(100) });
const ChangePasswordSchema = z.object({ currentPassword: CurrentPassword, newPassword: NewPassword });
const ChangeEmailSchema = z.object({ newEmail: z.string().trim().min(3).max(254).email(), currentPassword: CurrentPassword });
const ConfirmEmailSchema = z.object({ token: z.string().min(1).max(200) });
const PasswordOnlySchema = z.object({ currentPassword: CurrentPassword });
const TotpCodeSchema = z.object({ code: z.string().min(6).max(20) });
const DisableTotpSchema = z.object({
  currentPassword: CurrentPassword,
  code: z.string().max(20).optional(),
  recoveryCode: z.string().max(40).optional(),
});


function rateLimited(reply: FastifyReply) {
  return reply.status(429).header("retry-after", "900").send({ error: "rate_limited" });
}

async function checkCurrentPassword(userId: string, password: string): Promise<"ok" | "wrong" | "no_password"> {
  const auth = await adminPrisma.userAuth.findUnique({ where: { userId } });
  if (!auth?.passwordHash) return "no_password";
  return (await verifyPassword(password, auth.passwordHash)) ? "ok" : "wrong";
}

// The signed-in user's own account. Everything here works without an active organization.
export async function accountRoutes(app: FastifyInstance) {
  app.patch("/auth/profile", { preHandler: authenticateUser }, async (request, reply) => {
    const parsed = ProfileSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const { userId, activeOrgId } = request.user!;
    await adminPrisma.user.update({ where: { id: userId }, data: { name: parsed.data.name || null } });
    return reply.send(await describeUser(userId, activeOrgId));
  });

  // Keeps this session, signs out every other one, and tells the user by email.
  app.post("/auth/password", { preHandler: authenticateUser }, async (request, reply) => {
    const parsed = ChangePasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const { userId, sessionId } = request.user!;
    if (!allowPasswordCheck(userId)) return rateLimited(reply);
    const check = await checkCurrentPassword(userId, parsed.data.currentPassword);
    if (check === "no_password") return reply.status(400).send({ error: "no_password" });
    if (check === "wrong") return reply.status(400).send({ error: "wrong_password" });

    await adminPrisma.userAuth.update({
      where: { userId },
      data: { passwordHash: await hashPassword(parsed.data.newPassword), passwordChangedAt: new Date() },
    });
    await revokeUserSessions(userId, sessionId);
    await revokeTokens({ purpose: "reset_password", userId });
    const user = await adminPrisma.user.findUnique({ where: { id: userId } });
    if (user) sendPasswordChangedNotice(user.email).catch((err) => request.log.error({ err }, "password-changed email failed"));
    return reply.status(204).send();
  });

  // Step 1 of 2: a link goes to the NEW address; nothing changes until it's used.
  app.post("/auth/email", { preHandler: authenticateUser }, async (request, reply) => {
    const parsed = ChangeEmailSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const { userId } = request.user!;
    if (!allowPasswordCheck(userId) || !allowEmailChange(userId)) return rateLimited(reply);
    const check = await checkCurrentPassword(userId, parsed.data.currentPassword);
    if (check === "no_password") return reply.status(400).send({ error: "no_password" });
    if (check === "wrong") return reply.status(400).send({ error: "wrong_password" });

    const newEmail = normalizeEmail(parsed.data.newEmail);
    const user = await adminPrisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.status(401).send({ error: "unauthorized" });
    if (newEmail === user.email) return reply.status(400).send({ error: "same_email" });
    // Says whether the address is taken, but only to someone who just proved their password.
    if (await adminPrisma.user.findUnique({ where: { email: newEmail } })) return reply.status(409).send({ error: "email_taken" });

    await revokeTokens({ purpose: "change_email", userId });
    const token = await issueToken("change_email", { userId, email: user.email, newEmail });
    try {
      await sendConfirmNewEmail(newEmail, token);
    } catch (err) {
      request.log.error({ err }, "confirm-email email failed");
      await revokeTokens({ purpose: "change_email", userId });
      return reply.status(502).send({ error: "email_failed" });
    }
    return reply.status(202).send({ newEmail });
  });

  // Step 2 of 2: following the link proves the new address. No sign-in needed (the link may be
  // opened on another device). The old address gets a notice.
  app.post("/auth/email/confirm", async (request, reply) => {
    if (!allowConfirmForIp(request.ip)) return rateLimited(reply);
    const parsed = ConfirmEmailSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const row = await consumeToken("change_email", parsed.data.token);
    if (!row?.userId || !row.newEmail) return reply.status(400).send({ error: "invalid_or_expired_token" });
    if (await adminPrisma.user.findUnique({ where: { email: row.newEmail } })) return reply.status(409).send({ error: "email_taken" });

    const before = await adminPrisma.user.findUnique({ where: { id: row.userId } });
    if (!before) return reply.status(400).send({ error: "invalid_or_expired_token" });
    await adminPrisma.user.update({ where: { id: row.userId }, data: { email: row.newEmail } });
    await adminPrisma.userAuth.upsert({
      where: { userId: row.userId },
      create: { userId: row.userId, emailVerifiedAt: new Date() },
      update: { emailVerifiedAt: new Date() },
    });
    // A pending reset link was sent to the old address; it shouldn't outlive the change.
    await revokeTokens({ purpose: "reset_password", userId: row.userId });
    sendEmailChangedNotice(before.email, row.newEmail).catch((err) => request.log.error({ err }, "email-changed notice failed"));
    return reply.send({ email: row.newEmail });
  });

  // 2FA, step 1 of 2: a fresh secret is stored (encrypted) but not active until a code from the
  // app proves it was scanned. Re-running setup replaces a pending secret.
  app.post("/auth/totp/setup", { preHandler: authenticateUser }, async (request, reply) => {
    const parsed = PasswordOnlySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    if (!encryptionConfigured()) return reply.status(503).send({ error: "totp_not_configured" });
    const { userId } = request.user!;
    if (!allowPasswordCheck(userId)) return rateLimited(reply);
    const check = await checkCurrentPassword(userId, parsed.data.currentPassword);
    if (check === "no_password") return reply.status(400).send({ error: "no_password" });
    if (check === "wrong") return reply.status(400).send({ error: "wrong_password" });
    const auth = await adminPrisma.userAuth.findUnique({ where: { userId }, include: { user: true } });
    if (auth?.totpEnabledAt) return reply.status(400).send({ error: "totp_already_enabled" });

    const secret = newTotpSecret();
    await adminPrisma.userAuth.update({ where: { userId }, data: { totpSecretEnc: encryptSecret(secret), totpLastStep: null } });
    const url = otpauthUrl(secret, auth!.user.email);
    return reply.send({ secret, otpauthUrl: url, qrCodeDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
  });

  // 2FA, step 2 of 2: turns it on and returns the recovery codes, shown once. Other sessions
  // are signed out (they never passed the second factor).
  app.post("/auth/totp/enable", { preHandler: authenticateUser }, async (request, reply) => {
    const parsed = TotpCodeSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const { userId, sessionId } = request.user!;
    if (!allowPasswordCheck(userId)) return rateLimited(reply);
    const auth = await adminPrisma.userAuth.findUnique({ where: { userId } });
    if (auth?.totpEnabledAt) return reply.status(400).send({ error: "totp_already_enabled" });
    if (!auth?.totpSecretEnc) return reply.status(400).send({ error: "totp_setup_required" });
    const step = verifyTotp(decryptSecret(auth.totpSecretEnc), parsed.data.code, null);
    if (step === null) return reply.status(400).send({ error: "invalid_totp" });

    const codes = newRecoveryCodes();
    await adminPrisma.userAuth.update({
      where: { userId },
      data: { totpEnabledAt: new Date(), totpLastStep: BigInt(step), recoveryCodeHashes: codes.map(hashRecoveryCode) },
    });
    await revokeUserSessions(userId, sessionId);
    return reply.send({ recoveryCodes: codes });
  });

  // Needs the password AND a current code (or a recovery code, for someone who lost the phone
  // but is still signed in).
  app.post("/auth/totp/disable", { preHandler: authenticateUser }, async (request, reply) => {
    const parsed = DisableTotpSchema.safeParse(request.body);
    if (!parsed.success || (!parsed.data.code && !parsed.data.recoveryCode)) return reply.status(400).send({ error: "invalid_request" });
    const { userId } = request.user!;
    if (!allowPasswordCheck(userId)) return rateLimited(reply);
    const check = await checkCurrentPassword(userId, parsed.data.currentPassword);
    if (check === "no_password") return reply.status(400).send({ error: "no_password" });
    if (check === "wrong") return reply.status(400).send({ error: "wrong_password" });
    const auth = await adminPrisma.userAuth.findUnique({ where: { userId } });
    if (!auth?.totpEnabledAt) return reply.status(400).send({ error: "totp_not_enabled" });
    const result = await consumeSecondFactor(userId, { code: parsed.data.code, recoveryCode: parsed.data.recoveryCode });
    if (result !== "ok") return reply.status(400).send({ error: parsed.data.recoveryCode ? "invalid_recovery_code" : "invalid_totp" });

    await adminPrisma.userAuth.update({ where: { userId }, data: TOTP_OFF });
    return reply.status(204).send();
  });

  // New set of recovery codes; the old ones stop working.
  app.post("/auth/totp/recovery-codes", { preHandler: authenticateUser }, async (request, reply) => {
    const parsed = PasswordOnlySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "invalid_request" });
    const { userId } = request.user!;
    if (!allowPasswordCheck(userId)) return rateLimited(reply);
    const check = await checkCurrentPassword(userId, parsed.data.currentPassword);
    if (check === "no_password") return reply.status(400).send({ error: "no_password" });
    if (check === "wrong") return reply.status(400).send({ error: "wrong_password" });
    const auth = await adminPrisma.userAuth.findUnique({ where: { userId } });
    if (!auth?.totpEnabledAt) return reply.status(400).send({ error: "totp_not_enabled" });
    const codes = newRecoveryCodes();
    await adminPrisma.userAuth.update({ where: { userId }, data: { recoveryCodeHashes: codes.map(hashRecoveryCode) } });
    return reply.send({ recoveryCodes: codes });
  });

  app.get("/auth/sessions", { preHandler: authenticateUser }, async (request, reply) => {
    const { userId, sessionId } = request.user!;
    const sessions = await adminPrisma.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
    });
    return reply.send(
      sessions.map((s) => ({
        id: s.id,
        current: s.id === sessionId,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        ip: s.ip,
        userAgent: s.userAgent,
      }))
    );
  });

  // Own sessions only: the userId filter is what stops revoking someone else's.
  app.delete("/auth/sessions/:id", { preHandler: authenticateUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId, sessionId } = request.user!;
    if (id === sessionId) return reply.status(400).send({ error: "cannot_revoke_current_session" });
    const { count } = await adminPrisma.session.deleteMany({ where: { id, userId } });
    if (count === 0) return reply.status(404).send({ error: "not_found" });
    return reply.status(204).send();
  });

  app.post("/auth/sessions/revoke-others", { preHandler: authenticateUser }, async (request, reply) => {
    const { userId, sessionId } = request.user!;
    await revokeUserSessions(userId, sessionId);
    return reply.status(204).send();
  });
}
