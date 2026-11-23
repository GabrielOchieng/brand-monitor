import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

// TOTP (RFC 6238): HMAC-SHA1, 6 digits, 30-second steps -- what Google Authenticator, Microsoft
// Authenticator, 1Password, Authy etc. all default to. Built on node:crypto, no dependency.
const STEP_SECONDS = 30;
const DIGITS = 6;
// Accept the previous and next step too, for phone clocks that drift a little.
const WINDOW = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// 160-bit secret, the size RFC 4226 recommends.
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function currentStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

// HOTP (RFC 4226) at a given counter; `digits` is a parameter only so the RFC test vectors
// (8 digits) can be checked.
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return binary.toString().padStart(digits, "0");
}

// The time step the code matches (so the caller can store it and refuse a replay), or null.
// Steps at or before `lastUsedStep` are never accepted.
export function verifyTotp(secretBase32: string, code: string, lastUsedStep: number | null, nowMs = Date.now()): number | null {
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits)) return null;
  const secret = base32Decode(secretBase32);
  const now = currentStep(nowMs);
  for (let step = now - WINDOW; step <= now + WINDOW; step++) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (hotp(secret, step) === digits) return step;
  }
  return null;
}

export function otpauthUrl(secretBase32: string, accountEmail: string, issuer = "Brand Monitor"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// Recovery codes: 10 single-use codes like "k7mq-2xpf". No 0/1/o/l/i, to avoid misreading
// a printed copy. ~41 bits each; they're also behind the password and the login rate limits.
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const RECOVERY_CODE_COUNT = 10;

export function newRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const one = () => Array.from({ length: 8 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join("");
  return Array.from({ length: count }, () => {
    const c = one();
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  });
}

// Typed back case- and dash-insensitively.
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");
}
