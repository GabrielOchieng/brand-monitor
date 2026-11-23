import { adminPrisma } from "../adminDb";
import { recordAdminAction } from "./audit";

// A platform admin's read-only view into an organization lives on their session
// (sessions.admin_view_org_id); lib/auth.ts enforces it. Starting and ending it are audit-logged.

export async function startAdminView(sessionId: string, admin: { userId: string; email: string }, org: { id: string; name: string }): Promise<void> {
  await adminPrisma.$transaction(async (tx) => {
    await tx.session.update({ where: { id: sessionId }, data: { adminViewOrgId: org.id } });
    await recordAdminAction(admin, "org.view_start", { type: "org", id: org.id }, { name: org.name }, tx);
  });
}

// No-op when the session isn't viewing anything.
export async function endAdminView(sessionId: string, userId: string): Promise<void> {
  const session = await adminPrisma.session.findUnique({ where: { id: sessionId } });
  if (!session?.adminViewOrgId) return;
  const [user, org] = await Promise.all([
    adminPrisma.user.findUnique({ where: { id: userId } }),
    adminPrisma.organization.findUnique({ where: { id: session.adminViewOrgId } }),
  ]);
  await adminPrisma.$transaction(async (tx) => {
    await tx.session.update({ where: { id: sessionId }, data: { adminViewOrgId: null } });
    if (user) {
      await recordAdminAction({ userId, email: user.email }, "org.view_end", { type: "org", id: session.adminViewOrgId! }, { name: org?.name ?? "(deleted)" }, tx);
    }
  });
}
