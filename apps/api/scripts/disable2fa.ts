// Turns 2FA off for a user who lost both their authenticator and their recovery codes (or after
// AUTH_ENCRYPTION_KEY was changed). Signs them out everywhere. Run it only after confirming the
// request really comes from that person, out of band.
//
//   npm run auth:disable-2fa -- --email someone@example.com
import { adminPrisma } from "../src/adminDb";
import { normalizeEmail } from "../src/auth/crypto";
import { TOTP_OFF } from "../src/auth/mfa";
import { revokeUserSessions } from "../src/auth/sessions";

async function main() {
  const i = process.argv.indexOf("--email");
  const email = i === -1 ? undefined : process.argv[i + 1];
  if (!email) throw new Error("Usage: --email <email>");
  const user = await adminPrisma.user.findUnique({ where: { email: normalizeEmail(email) }, include: { auth: true } });
  if (!user) throw new Error(`No user ${email}`);
  if (!user.auth?.totpEnabledAt && !user.auth?.totpSecretEnc) {
    console.log(`${user.email} doesn't have 2FA on. Nothing changed.`);
    return;
  }
  await adminPrisma.userAuth.update({ where: { userId: user.id }, data: TOTP_OFF });
  await revokeUserSessions(user.id);
  console.log(`2FA turned off for ${user.email}, and all their sessions were signed out. They can turn it on again from their account page.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => adminPrisma.$disconnect());
