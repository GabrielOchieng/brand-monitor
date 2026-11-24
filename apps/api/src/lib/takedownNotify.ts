import { withTenant } from "./tenant";
import { sendMail } from "./email";
import { env } from "../env";

// Alerts about takedown reports (queued for veto, sent, failed, a reply came, sender broken):
// the org's "takedown_activity" alert rule, in-app by default. Email goes to the org's owners
// and admins, through the platform's own SMTP (it's a notice to the team, not a report).

export async function notifyTakedown(orgId: string, findingId: string | null, message: string, opts: { important?: boolean } = {}): Promise<void> {
  const { channels, emails } = await withTenant(orgId, async (tx) => {
    const rule = await tx.alertRule.findFirst({ where: { organizationId: orgId, kind: "takedown_activity" } });
    // No rule yet (orgs created before it existed): in-app only.
    const channels = rule ? (rule.enabled ? rule.channels : []) : ["in_app"];
    if (channels.includes("in_app")) {
      await tx.notification.create({ data: { organizationId: orgId, findingId, message: message.slice(0, 300) } });
    }
    const emails =
      channels.includes("email") && opts.important
        ? (await tx.membership.findMany({ where: { organizationId: orgId, role: { in: ["owner", "admin"] } }, include: { user: true } })).map((m) => m.user.email)
        : [];
    return { channels, emails };
  });
  if (channels.includes("email") && emails.length) {
    const link = findingId ? `${env.webAppUrl}/threats/${findingId}` : `${env.webAppUrl}/takedowns`;
    await sendMail({ to: emails.join(","), subject: `[Brand Monitor] ${message.slice(0, 120)}`, text: `${message}\n\n${link}`, html: `<p>${escape(message)}</p><p><a href="${link}">Open in Brand Monitor</a></p>` }).catch(() => {});
  }
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
