// Grants or revokes the platform admin role (the admin panel, above every organization).
// The only way to make an admin: deliberately not possible through the API.
//
//   npm run auth:make-admin -- --email you@example.com
//   npm run auth:make-admin -- --email you@example.com --revoke
//
// The panel also requires two-factor sign-in on the account; this script warns when it's off.
// A later "superadmin" role (allowed to make admins from the panel) goes in the same column.
import { adminPrisma } from "../src/adminDb";
import { normalizeEmail } from "../src/auth/crypto";

async function main() {
  const i = process.argv.indexOf("--email");
  const email = i === -1 ? undefined : process.argv[i + 1];
  if (!email) throw new Error("Usage: --email <email> [--revoke]");
  const revoke = process.argv.includes("--revoke");
  const user = await adminPrisma.user.findUnique({ where: { email: normalizeEmail(email) }, include: { auth: true } });
  if (!user) throw new Error(`No user ${email}`);

  await adminPrisma.user.update({ where: { id: user.id }, data: { platformRole: revoke ? null : "admin" } });
  if (revoke) {
    console.log(`${user.email} is no longer a platform admin.`);
    return;
  }
  console.log(`${user.email} is now a platform admin.`);
  if (!user.auth?.totpEnabledAt) {
    console.log("Two-factor sign-in is OFF for this account: the admin panel stays locked until it's turned on (Account and security).");
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => adminPrisma.$disconnect());
