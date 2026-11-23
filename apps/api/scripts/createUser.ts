// Creates (or reuses) a user, adds them to an org, and prints a one-time "set your password"
// link. For local dev and for production emergencies (e.g. every owner locked out). Sign-up is
// invite-only, so this is the only way to create the very first account.
//
//   npm run auth:create-user -- --email you@example.com --org <orgId> [--role owner]
//   npm run auth:create-user -- --email you@example.com --new-org "Acme" [--send-email]
//
// The password is never passed on the command line (shell history); the user sets it from the
// printed link, or from the email with --send-email.
import { adminPrisma } from "../src/adminDb";
import { env } from "../src/env";
import { newId, normalizeEmail } from "../src/auth/crypto";
import { createOrganization } from "../src/auth/orgs";
import { issueToken, revokeTokens } from "../src/auth/tokens";
import { sendSetPasswordEmail } from "../src/auth/emails";
import { VALID_ROLES } from "../src/lib/auth";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const emailArg = arg("email");
  const orgArg = arg("org");
  const newOrgName = arg("new-org");
  const role = arg("role") ?? "owner";
  if (!emailArg || (!orgArg && !newOrgName) || (orgArg && newOrgName)) {
    throw new Error('Usage: --email <email> (--org <orgId> | --new-org "<name>") [--role owner|admin|analyst|viewer] [--send-email]');
  }
  if (!(VALID_ROLES as readonly string[]).includes(role)) throw new Error(`--role must be one of ${VALID_ROLES.join(", ")}`);
  const email = normalizeEmail(emailArg);

  let user = await adminPrisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await adminPrisma.user.create({ data: { id: newId("user"), email } });
    console.log(`Created user ${user.id} <${email}>`);
  } else {
    console.log(`Using existing user ${user.id} <${email}>`);
  }

  let orgId: string;
  if (newOrgName) {
    orgId = (await createOrganization(newOrgName, user.id)).id;
    console.log(`Created org ${orgId} "${newOrgName}" with ${email} as owner`);
  } else {
    const org = await adminPrisma.organization.findUnique({ where: { id: orgArg! } });
    if (!org) throw new Error(`No organization ${orgArg}`);
    orgId = org.id;
    await adminPrisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: orgId } },
      create: { userId: user.id, organizationId: orgId, role },
      update: { role },
    });
    console.log(`${email} is ${role} of ${orgId} "${org.name}"`);
  }

  await revokeTokens({ purpose: "reset_password", userId: user.id });
  const token = await issueToken("reset_password", { userId: user.id, email }, 7 * 24 * 60 * 60 * 1000);
  if (process.argv.includes("--send-email")) {
    await sendSetPasswordEmail(email, token);
    console.log(`Set-password email sent to ${email}`);
  } else {
    console.log(`Set-password link (works once, 7 days):\n${env.webAppUrl}/reset-password?token=${token}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => adminPrisma.$disconnect());
