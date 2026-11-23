import { createHash, randomBytes } from "node:crypto";
import { env } from "../env";

// Sign in with Google: OpenID Connect authorization-code flow with PKCE. No library: the ID token
// comes straight from Google's token endpoint over TLS in a server-to-server call, which OIDC
// Core 3.1.3.7 accepts in place of checking its signature; its claims are still checked below.
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export function googleConfigured(): boolean {
  return !!(env.googleClientId && env.googleClientSecret);
}

// Must match an "Authorized redirect URI" on the Google OAuth client exactly.
export function googleRedirectUri(): string {
  return `${env.apiPublicUrl}/auth/google/callback`;
}

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function googleAuthorizeUrl(params: { state: string; nonce: string; codeChallenge: string; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state: params.state,
    nonce: params.nonce,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  if (params.loginHint) q.set("login_hint", params.loginHint);
  return `${GOOGLE_AUTH_URL}?${q.toString()}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
}

// The ID token's claims, decoded but deliberately not signature-checked (see the header).
export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("malformed id_token");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

// Everything that makes the token ours and current: from Google, for this client, unexpired,
// for this login attempt (nonce), with an address Google has verified.
export function validateIdTokenClaims(
  claims: Record<string, unknown>,
  expected: { clientId: string; nonce: string; nowSeconds?: number }
): GoogleProfile {
  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!ISSUERS.has(String(claims.iss))) throw new Error("wrong issuer");
  const aud = claims.aud;
  if (!(aud === expected.clientId || (Array.isArray(aud) && aud.includes(expected.clientId)))) throw new Error("wrong audience");
  if (typeof claims.exp !== "number" || claims.exp < now - 60) throw new Error("expired");
  if (claims.nonce !== expected.nonce) throw new Error("nonce mismatch");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("no subject");
  if (typeof claims.email !== "string" || claims.email_verified !== true) throw new Error("email not verified");
  return { sub: claims.sub, email: claims.email.trim().toLowerCase(), name: typeof claims.name === "string" ? claims.name : null };
}

export async function exchangeCode(code: string, codeVerifier: string, nonce: string): Promise<GoogleProfile> {
  const res = await fetch(env.googleTokenUrlOverride || GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      code_verifier: codeVerifier,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!res.ok || !body.id_token) throw new Error(`token exchange failed: ${res.status} ${body.error ?? ""}`.trim());
  return validateIdTokenClaims(decodeJwtPayload(body.id_token), { clientId: env.googleClientId, nonce });
}
