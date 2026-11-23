import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Password hashing with scrypt (Node built-in). Stored as scrypt$N$r$p$salt$hash (base64url),
// so the cost parameters can be raised later without breaking existing hashes: verify reads
// them back from the stored string, and needsRehash says when to upgrade one at login.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 32;
// 128 * N * r bytes = 32 MiB for these parameters, just over Node's 32 MiB default maxmem.
const MAX_MEM = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

function scrypt(password: string, salt: Buffer, keyLen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, keyLen, options, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: MAX_MEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64url");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAX_MEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function needsRehash(stored: string): boolean {
  return !stored.startsWith(`scrypt$${N}$${R}$${P}$`);
}

// A real hash of a random password, computed once: login runs verifyPassword against it when
// the email has no account (or no password), so response time doesn't reveal which emails exist.
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

// Session cookies and emailed links: 32 random bytes. Only the SHA-256 of a token is stored, so
// a database leak doesn't hand out live sessions or reset links. A fast hash is enough here
// (unlike passwords): the input has 256 bits of entropy.
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Ids for new rows, same prefixed shape as the Clerk ids already in the database.
export function newId(prefix: "user" | "org"): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
