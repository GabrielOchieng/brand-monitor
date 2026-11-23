import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { adminPrisma } from "../adminDb";
import { env } from "../env";
import { authenticateUser } from "../lib/auth";
import { createRateLimiter } from "../lib/rateLimit";
import { hashToken, newId, newToken } from "../auth/crypto";
import { createSession, findSession, readCookie } from "../auth/sessions";
import { consumeToken, issueToken, peekToken, revokeTokens } from "../auth/tokens";
import { exchangeCode, googleAuthorizeUrl, googleConfigured, newPkce, type GoogleProfile } from "../auth/google";
import { describeUser } from "./auth";

// Ties the OAuth state to the browser that started the flow. Without it, someone could start a
// Google sign-in for their own account and send the victim the callback link, signing the victim
// in as them (login CSRF). Host-only, 10 minutes, only sent to /auth/google/*.
const OAUTH_COOKIE = "bm_oauth";
// Per IP, on /start only: 30 Google sign-ins per 15 minutes, same as password logins.
const allowGoogleForIp = createRateLimiter(30, 15 * 60 * 1000);

type Mode = "login" | "link" | "invite";
interface StateData {
  verifier: string;
  nonce: string;
  mode: Mode;
  next: string;
  invite?: string;
  browser: string;
}

function oauthCookie(value: string, maxAge: number): string {
  const parts = [`${OAUTH_COOKIE}=${value}`, "Path=/auth/google", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (env.apiPublicUrl.startsWith("https://")) parts.push("Secure");
  return parts.join("; ");
}

function safePath(next: unknown, fallback: string): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

function toWeb(reply: FastifyReply, path: string) {
  return reply.redirect(`${env.webAppUrl}${path}`, 302);
}

// Where a failure lands depends on where the flow started.
function failPath(mode: Mode, code: string, invite?: string): string {
  if (mode === "link") return `/account?google=${code}`;
  if (mode === "invite" && invite) return `/invite?token=${encodeURIComponent(invite)}&error=${code}`;
  return `/login?error=${code}`;
}

// Same rule as password login: with 2FA on, Google only gets you to the code step.
async function finishSignIn(request: FastifyRequest, reply: FastifyReply, userId: string, next: string, orgId?: string) {
  const auth = await adminPrisma.userAuth.findUnique({ where: { userId } });
  if (auth?.totpEnabledAt) {
    await revokeTokens({ purpose: "mfa_challenge", userId });
    const challenge = await issueToken("mfa_challenge", { userId });
    return toWeb(reply, `/login?mfa=${encodeURIComponent(challenge)}&next=${encodeURIComponent(next)}`);
  }
  await createSession(request, reply, userId, orgId);
  return toWeb(reply, next);
}

export async function googleRoutes(app: FastifyInstance) {
  // Public: tells the sign-in page whether to show the Google button.
  app.get("/auth/providers", async () => ({ google: googleConfigured() }));

  // A top-level navigation from the web app (not fetch), so it can redirect to Google.
  app.get("/auth/google/start", async (request, reply) => {
    const q = request.query as { mode?: string; next?: string; invite?: string };
    const mode: Mode = q.mode === "link" ? "link" : q.mode === "invite" ? "invite" : "login";
    if (!googleConfigured()) return toWeb(reply, failPath(mode, "google_not_configured", q.invite));
    if (!allowGoogleForIp(request.ip)) return toWeb(reply, failPath(mode, "rate_limited", q.invite));

    let userId: string | undefined;
    let loginHint: string | undefined;
    if (mode === "link") {
      const session = await findSession(request);
      if (!session) return toWeb(reply, "/login?next=/account");
      userId = session.userId;
    }
    if (mode === "invite") {
      const invite = q.invite ? await peekToken("invite", q.invite) : null;
      if (!invite?.email) return toWeb(reply, failPath(mode, "invalid_or_expired_token", q.invite));
      loginHint = invite.email;
    }

    const browser = newToken();
    const { verifier, challenge } = newPkce();
    const nonce = newToken();
    const data: StateData = {
      verifier,
      nonce,
      mode,
      next: safePath(q.next, mode === "link" ? "/account" : "/dashboard"),
      invite: q.invite,
      browser: hashToken(browser),
    };
    const state = await issueToken("oauth_state", { userId, data: data as object });
    reply.header("set-cookie", oauthCookie(browser, 600));
    return reply.redirect(googleAuthorizeUrl({ state, nonce, codeChallenge: challenge, loginHint }), 302);
  });

  app.get("/auth/google/callback", async (request, reply) => {
    const q = request.query as { code?: string; state?: string; error?: string };
    reply.header("set-cookie", oauthCookie("", 0));
    // Not rate limited here: a callback is useless without a fresh state from /start, which is.

    const row = q.state ? await consumeToken("oauth_state", q.state) : null;
    const data = row?.data as StateData | undefined;
    if (!row || !data) return toWeb(reply, "/login?error=google_failed");
    const browser = readCookie(request, OAUTH_COOKIE);
    if (!browser || hashToken(browser) !== data.browser) return toWeb(reply, failPath(data.mode, "google_failed", data.invite));
    // The person cancelled on Google's screen (or Google refused).
    if (q.error || !q.code) return toWeb(reply, failPath(data.mode, "google_cancelled", data.invite));

    let profile: GoogleProfile;
    try {
      profile = await exchangeCode(q.code, data.verifier, data.nonce);
    } catch (err) {
      request.log.warn({ err }, "google sign-in failed");
      return toWeb(reply, failPath(data.mode, "google_failed", data.invite));
    }

    const bySub = await adminPrisma.userAuth.findUnique({ where: { googleSub: profile.sub } });

    if (data.mode === "link") {
      const userId = row.userId!;
      if (bySub && bySub.userId !== userId) return toWeb(reply, failPath("link", "google_in_use"));
      await adminPrisma.userAuth.upsert({
        where: { userId },
        create: { userId, googleSub: profile.sub },
        update: { googleSub: profile.sub },
      });
      return toWeb(reply, "/account?google=linked");
    }

    if (data.mode === "invite") {
      // Same checks as accepting by password, plus: the Google address must be the invited one.
      const invite = data.invite ? await peekToken("invite", data.invite) : null;
      if (!invite?.organizationId || !invite.email || !invite.role) return toWeb(reply, failPath("invite", "invalid_or_expired_token", data.invite));
      if (invite.email !== profile.email) return toWeb(reply, failPath("invite", "google_email_mismatch", data.invite));
      let user = await adminPrisma.user.findUnique({ where: { email: profile.email }, include: { auth: true } });
      // Checked before the invite is used up, so this failure doesn't burn it.
      if (bySub && bySub.userId !== user?.id) return toWeb(reply, failPath("invite", "google_in_use", data.invite));
      if (!(await consumeToken("invite", data.invite!))) return toWeb(reply, failPath("invite", "invalid_or_expired_token", data.invite));

      if (!user) {
        const id = newId("user");
        await adminPrisma.user.create({ data: { id, email: profile.email, name: profile.name } });
        user = await adminPrisma.user.findUniqueOrThrow({ where: { id }, include: { auth: true } });
      }
      await adminPrisma.userAuth.upsert({
        where: { userId: user.id },
        create: { userId: user.id, googleSub: profile.sub, emailVerifiedAt: new Date() },
        update: { googleSub: profile.sub, emailVerifiedAt: user.auth?.emailVerifiedAt ?? new Date() },
      });
      await adminPrisma.membership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId: invite.organizationId } },
        create: { userId: user.id, organizationId: invite.organizationId, role: invite.role },
        update: {},
      });
      return finishSignIn(request, reply, user.id, "/dashboard", invite.organizationId);
    }

    // Sign-in: the linked account, or on first use the account with this (Google-verified)
    // email, which then gets linked. Accounts only come from invites, so no match = no entry.
    if (bySub) return finishSignIn(request, reply, bySub.userId, data.next);
    const byEmail = await adminPrisma.user.findUnique({ where: { email: profile.email }, include: { auth: true } });
    if (!byEmail) return toWeb(reply, "/login?error=google_no_account");
    if (byEmail.auth?.googleSub && byEmail.auth.googleSub !== profile.sub) return toWeb(reply, "/login?error=google_in_use");
    await adminPrisma.userAuth.upsert({
      where: { userId: byEmail.id },
      create: { userId: byEmail.id, googleSub: profile.sub, emailVerifiedAt: new Date() },
      update: { googleSub: profile.sub },
    });
    return finishSignIn(request, reply, byEmail.id, data.next);
  });

  // Only with a password to fall back on, so nobody unlinks their only way in.
  app.post("/auth/google/unlink", { preHandler: authenticateUser }, async (request, reply) => {
    const { userId, activeOrgId } = request.user!;
    const auth = await adminPrisma.userAuth.findUnique({ where: { userId } });
    if (!auth?.googleSub) return reply.status(400).send({ error: "google_not_linked" });
    if (!auth.passwordHash) return reply.status(400).send({ error: "no_password" });
    await adminPrisma.userAuth.update({ where: { userId }, data: { googleSub: null } });
    return reply.send(await describeUser(userId, activeOrgId));
  });
}
