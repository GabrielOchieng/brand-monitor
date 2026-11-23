import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { env } from "../env";
import { base32Decode, base32Encode, hashRecoveryCode, hotp, newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from "./totp";
import { decryptSecret, encryptSecret, encryptionConfigured } from "./secretBox";

// RFC 6238 appendix B, SHA-1 rows: seed "12345678901234567890", 8 digits.
const RFC_SEED = Buffer.from("12345678901234567890");
const RFC_VECTORS: Array<[number, string]> = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

describe("TOTP", () => {
  it("matches the RFC 6238 test vectors", () => {
    for (const [t, expected] of RFC_VECTORS) expect(hotp(RFC_SEED, Math.floor(t / 30), 8)).toBe(expected);
  });

  it("round-trips base32", () => {
    const buf = randomBytes(20);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(base32Encode(RFC_SEED)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode("gezd gnbv-gy3t qojq gezd gnbv gy3t qojq").equals(RFC_SEED)).toBe(true);
  });

  it("accepts the current step and one either side, nothing further", () => {
    const secret = base32Encode(RFC_SEED);
    const now = 1111111111 * 1000;
    const step = Math.floor(1111111111 / 30);
    const codeAt = (s: number) => hotp(RFC_SEED, s);
    expect(verifyTotp(secret, codeAt(step), null, now)).toBe(step);
    expect(verifyTotp(secret, codeAt(step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, codeAt(step + 1), null, now)).toBe(step + 1);
    expect(verifyTotp(secret, codeAt(step - 2), null, now)).toBeNull();
    expect(verifyTotp(secret, codeAt(step + 2), null, now)).toBeNull();
  });

  it("refuses a code from a step already used (replay)", () => {
    const secret = base32Encode(RFC_SEED);
    const now = 1111111111 * 1000;
    const step = Math.floor(1111111111 / 30);
    expect(verifyTotp(secret, hotp(RFC_SEED, step), step, now)).toBeNull();
    expect(verifyTotp(secret, hotp(RFC_SEED, step - 1), step, now)).toBeNull();
    expect(verifyTotp(secret, hotp(RFC_SEED, step + 1), step, now)).toBe(step + 1);
  });

  it("ignores spaces and rejects anything that isn't 6 digits", () => {
    const secret = base32Encode(RFC_SEED);
    const now = 59 * 1000;
    const code = hotp(RFC_SEED, 1);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, null, now)).toBe(1);
    expect(verifyTotp(secret, "12345", null, now)).toBeNull();
    expect(verifyTotp(secret, "abcdef", null, now)).toBeNull();
  });

  it("makes 160-bit secrets and a standard otpauth URL", () => {
    const s = newTotpSecret();
    expect(base32Decode(s)).toHaveLength(20);
    const url = new URL(otpauthUrl(s, "a@b.com"));
    expect(url.protocol).toBe("otpauth:");
    expect(url.host).toBe("totp");
    expect(decodeURIComponent(url.pathname)).toBe("/Brand Monitor:a@b.com");
    expect(url.searchParams.get("secret")).toBe(s);
    expect(url.searchParams.get("issuer")).toBe("Brand Monitor");
  });
});

describe("recovery codes", () => {
  it("makes 10 distinct, readable codes", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/);
  });

  it("matches regardless of case, dashes and spaces", () => {
    expect(hashRecoveryCode("K7MQ 2XPF")).toBe(hashRecoveryCode("k7mq-2xpf"));
    expect(hashRecoveryCode("k7mq-2xpf")).not.toBe(hashRecoveryCode("k7mq-2xpg"));
  });
});

describe("secretBox", () => {
  it("encrypts and decrypts with AUTH_ENCRYPTION_KEY, and detects tampering", () => {
    const original = env.authEncryptionKey;
    env.authEncryptionKey = randomBytes(32).toString("base64");
    try {
      expect(encryptionConfigured()).toBe(true);
      const box = encryptSecret("JBSWY3DPEHPK3PXP");
      expect(box).toMatch(/^v1\./);
      expect(box).not.toContain("JBSWY3DPEHPK3PXP");
      expect(decryptSecret(box)).toBe("JBSWY3DPEHPK3PXP");
      expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
      const parts = box.split(".");
      parts[3] = Buffer.from("tampered").toString("base64url");
      expect(() => decryptSecret(parts.join("."))).toThrow();
      env.authEncryptionKey = randomBytes(32).toString("base64");
      expect(() => decryptSecret(box)).toThrow();
    } finally {
      env.authEncryptionKey = original;
    }
  });

  it("reports when no key is set", () => {
    const original = env.authEncryptionKey;
    env.authEncryptionKey = "";
    try {
      expect(encryptionConfigured()).toBe(false);
    } finally {
      env.authEncryptionKey = original;
    }
  });
});
