import { describe, expect, it } from "vitest";
import { hashPassword, hashToken, needsRehash, newId, newToken, normalizeEmail, verifyPassword } from "./crypto";
import { isAllowedOrigin } from "./origin";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"));
  });

  it("treats visually identical unicode forms as the same password", async () => {
    const stored = await hashPassword("café au lait!");
    expect(await verifyPassword("café au lait!", stored)).toBe(true);
  });

  it("rejects malformed stored values instead of throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
  });

  it("flags hashes made with older parameters for upgrade", async () => {
    expect(needsRehash(await hashPassword("abcdefghijk"))).toBe(false);
    expect(needsRehash("scrypt$16384$8$1$c2FsdA$aGFzaA")).toBe(true);
  });

  it("still verifies a hash made with older parameters", async () => {
    // Same format, cheaper N: parameters are read back from the stored string.
    const { scryptSync, randomBytes } = await import("node:crypto");
    const salt = randomBytes(16);
    const key = scryptSync("old password!", salt, 32, { N: 16384, r: 8, p: 1 });
    const stored = `scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
    expect(await verifyPassword("old password!", stored)).toBe(true);
  });
});

describe("tokens and ids", () => {
  it("makes 256-bit url-safe tokens and stores only a sha256", () => {
    const t = newToken();
    expect(t).toMatch(/^[\w-]{43}$/);
    expect(newToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).toBe(hashToken(t));
  });

  it("keeps the prefixed id shape of the old Clerk ids", () => {
    expect(newId("user")).toMatch(/^user_[0-9a-f]{32}$/);
    expect(newId("org")).toMatch(/^org_[0-9a-f]{32}$/);
  });

  it("normalizes emails", () => {
    expect(normalizeEmail("  Gabriel.Ochieng@Example.COM ")).toBe("gabriel.ochieng@example.com");
  });
});

describe("isAllowedOrigin", () => {
  const prod = "https://brand-monitor.gabrielochieng.com";
  it("accepts only the web app in production", () => {
    expect(isAllowedOrigin(prod, prod)).toBe(true);
    expect(isAllowedOrigin("https://panel.gabrielochieng.com", prod)).toBe(false);
    expect(isAllowedOrigin("http://brand-monitor.gabrielochieng.com", prod)).toBe(false);
    expect(isAllowedOrigin("http://localhost:3000", prod)).toBe(false);
    expect(isAllowedOrigin("https://brand-monitor.gabrielochieng.com.evil.com", prod)).toBe(false);
  });

  it("accepts any localhost port when the web app is local", () => {
    expect(isAllowedOrigin("http://localhost:3005", "http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:3000", "http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("https://evil.com", "http://localhost:3000")).toBe(false);
  });
});
