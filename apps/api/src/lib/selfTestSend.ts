import type { Prisma } from "@prisma/client";
import { withTenant } from "./tenant";
import { decryptSecret } from "../auth/secretBox";
import { MailSendError, sendOrgMail, SenderSecretsSchema, type OrgMailMessage } from "./orgMailer";
import { recordAutomationEvent } from "./takedownAutomation";

// Test sends through the org's sender mailbox. A template test or a draft test only ever goes to
// the member who asked (their own account email), never to a report's real recipients. All test
// sends (sender, template, draft) share one daily limit per org.

export const TESTS_PER_DAY = 20;
export const TEST_ACTIONS = ["sender.test", "template.test", "draft.test"];

export async function testsToday(tx: Prisma.TransactionClient, orgId: string): Promise<number> {
  return tx.takedownAutomationEvent.count({
    where: { organizationId: orgId, action: { in: TEST_ACTIONS }, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
  });
}

export type SelfTestResult =
  | { status: "sent"; to: string }
  | { status: "failed"; to: string; error: string }
  | { status: "no_sender" }
  | { status: "too_many" }
  | { status: "unreadable" };

export async function sendTestToSelf(
  orgId: string,
  userId: string,
  action: "template.test" | "draft.test",
  message: Omit<OrgMailMessage, "to" | "cc" | "bcc">,
  details: Record<string, unknown>
): Promise<SelfTestResult> {
  const prep = await withTenant(orgId, async (tx) => ({
    sender: await tx.takedownSender.findUnique({ where: { organizationId: orgId } }),
    recent: await testsToday(tx, orgId),
    user: await tx.user.findUnique({ where: { id: userId }, select: { email: true } }),
  }));
  if (!prep.sender || !prep.user) return { status: "no_sender" };
  if (prep.recent >= TESTS_PER_DAY) return { status: "too_many" };
  let secrets;
  try {
    secrets = SenderSecretsSchema.parse(JSON.parse(decryptSecret(prep.sender.config)));
  } catch {
    return { status: "unreadable" };
  }
  const to = prep.user.email;
  const s = prep.sender;
  let error: string | null = null;
  try {
    // No archive BCC on tests: they aren't reports.
    await sendOrgMail(secrets, { fromAddress: s.fromAddress, fromName: s.fromName, replyTo: s.replyTo, bccArchive: null }, { ...message, to: [to] });
  } catch (err: any) {
    const cause = err?.cause?.code ?? err?.cause?.message;
    error = err instanceof MailSendError ? err.message : `Sending failed: ${String(err?.message ?? err)}${cause ? ` (${cause})` : ""}`.slice(0, 300);
  }
  await withTenant(orgId, (tx) => recordAutomationEvent(tx, orgId, { userId, email: to }, action, { ...details, to, ok: !error, ...(error ? { error } : {}) }));
  return error ? { status: "failed", to, error } : { status: "sent", to };
}
