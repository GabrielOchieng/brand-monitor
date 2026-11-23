import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env";

// AES-256-GCM for secrets we must be able to read back (TOTP seeds), unlike passwords, which
// are only ever hashed. The key is AUTH_ENCRYPTION_KEY (32 random bytes, base64) and never sits
// in the database, so a database dump alone doesn't expose anyone's 2FA seed.
// Stored as v1.<iv>.<tag>.<ciphertext> (base64url); the version allows a later key rotation.

function key(): Buffer {
  const k = Buffer.from(env.authEncryptionKey, "base64");
  if (k.length !== 32) throw new Error("AUTH_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function encryptionConfigured(): boolean {
  return Buffer.from(env.authEncryptionKey, "base64").length === 32;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, ct] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}
