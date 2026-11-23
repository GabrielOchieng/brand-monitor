// One-off, after the move off Clerk: emails every user who has no password yet a link to set
// one. Their ids, memberships and assignments are unchanged (the Clerk ids stay as plain ids).
//
//   npm run auth:migrate-from-clerk            # dry run: lists who would get an email
//   npm run auth:migrate-from-clerk -- --send  # sends them
//
// Safe to re-run: users who already set a password are skipped, and a re-send replaces the
// previous link. Users with a placeholder email (<id>@unknown.local, from Clerk webhook events
// that arrived without one) are listed and never emailed; fix their email in SQL first.
import { adminPrisma } from "../src/adminDb";
import { issueToken, revokeTokens } from "../src/auth/tokens";
import { sendSetPasswordEmail } from "../src/auth/emails";

const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function main() {
  const send = process.argv.includes("--send");
  const users = await adminPrisma.user.findMany({
    include: { auth: true, memberships: { include: { organization: true } } },
    orderBy: { createdAt: "asc" },
  });

  const pending = users.filter((u) => !u.auth?.passwordHash);
  const placeholder = pending.filter((u) => u.email.endsWith("@unknown.local"));
  const toEmail = pending.filter((u) => !u.email.endsWith("@unknown.local"));

  console.log(`${users.length} users, ${users.length - pending.length} already have a password.`);
  for (const u of toEmail) {
    const orgs = u.memberships.map((m) => `${m.organization.name} (${m.role})`).join(", ") || "no org";
    console.log(`  ${send ? "emailing" : "would email"} ${u.email}  [${orgs}]`);
  }
  for (const u of placeholder) console.log(`  SKIPPED ${u.id}: placeholder email ${u.email}`);
  if (!send) {
    console.log("\nDry run. Re-run with --send to email them.");
    return;
  }

  let sent = 0;
  for (const u of toEmail) {
    await adminPrisma.userAuth.upsert({
      where: { userId: u.id },
      // Clerk verified these addresses at sign-up.
      create: { userId: u.id, emailVerifiedAt: new Date() },
      update: {},
    });
    await revokeTokens({ purpose: "reset_password", userId: u.id });
    const token = await issueToken("reset_password", { userId: u.id, email: u.email }, LINK_TTL_MS);
    try {
      await sendSetPasswordEmail(u.email, token);
      sent++;
    } catch (err) {
      console.error(`  FAILED ${u.email}:`, err instanceof Error ? err.message : err);
    }
    // Gentle on the SMTP account's sending limits.
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`\nSent ${sent} of ${toEmail.length}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => adminPrisma.$disconnect());
