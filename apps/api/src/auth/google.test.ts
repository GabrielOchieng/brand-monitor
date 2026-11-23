import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { env } from "../env";
import { decodeJwtPayload, googleAuthorizeUrl, newPkce, validateIdTokenClaims } from "./google";

const NOW = 1_800_000_000;
const good = {
  iss: "https://accounts.google.com",
  aud: "client-123",
  exp: NOW + 3600,
  nonce: "n-1",
  sub: "1234567890",
  email: "Someone@Example.com",
  email_verified: true,
  name: "Some One",
};
const expected = { clientId: "client-123", nonce: "n-1", nowSeconds: NOW };

describe("validateIdTokenClaims", () => {
  it("accepts a good token and lowercases the email", () => {
    expect(validateIdTokenClaims(good, expected)).toEqual({ sub: "1234567890", email: "someone@example.com", name: "Some One" });
    expect(validateIdTokenClaims({ ...good, iss: "accounts.google.com" }, expected).sub).toBe("1234567890");
  });

  it.each([
    ["another issuer", { iss: "https://evil.example" }],
    ["another client", { aud: "client-999" }],
    ["expired", { exp: NOW - 3600 }],
    ["a different login attempt", { nonce: "n-2" }],
    ["an unverified email", { email_verified: false }],
    ["no email", { email: undefined }],
    ["no subject", { sub: "" }],
  ])("rejects %s", (_label, patch) => {
    expect(() => validateIdTokenClaims({ ...good, ...patch }, expected)).toThrow();
  });
});

describe("decodeJwtPayload", () => {
  it("reads the middle segment and rejects malformed tokens", () => {
    const jwt = ["e30", Buffer.from(JSON.stringify(good)).toString("base64url"), "sig"].join(".");
    expect(decodeJwtPayload(jwt).sub).toBe("1234567890");
    expect(() => decodeJwtPayload("only.two")).toThrow();
  });
});

describe("authorize URL and PKCE", () => {
  it("uses S256 PKCE with a 43-char verifier", () => {
    const { verifier, challenge } = newPkce();
    expect(verifier).toMatch(/^[\w-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("asks only for basic scopes and carries state, nonce and the challenge", () => {
    const original = { id: env.googleClientId, api: env.apiPublicUrl };
    env.googleClientId = "client-123";
    env.apiPublicUrl = "https://brand-monitor-api.gabrielochieng.com";
    try {
      const url = new URL(googleAuthorizeUrl({ state: "s", nonce: "n", codeChallenge: "c", loginHint: "a@b.com" }));
      expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
      const p = url.searchParams;
      expect(p.get("scope")).toBe("openid email profile");
      expect(p.get("redirect_uri")).toBe("https://brand-monitor-api.gabrielochieng.com/auth/google/callback");
      expect([p.get("state"), p.get("nonce"), p.get("code_challenge"), p.get("code_challenge_method")]).toEqual(["s", "n", "c", "S256"]);
      expect(p.get("login_hint")).toBe("a@b.com");
      expect(p.get("client_id")).toBe("client-123");
    } finally {
      env.googleClientId = original.id;
      env.apiPublicUrl = original.api;
    }
  });
});
