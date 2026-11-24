import type { Prisma, PrismaClient } from "@prisma/client";
import { adminPrisma } from "../adminDb";

export type AdminAction =
  | "org.create"
  | "org.invite_owner"
  | "org.pause"
  | "org.resume"
  | "brand.pause"
  | "brand.resume"
  | "org.delete"
  | "org.view_start"
  | "org.view_end"
  | "user.sign_out_all"
  | "user.reset_2fa"
  | "user.send_password_link"
  | "user.remove_from_org"
  | "user.delete"
  | "org.auto_takedown_allow"
  | "org.auto_takedown_disallow"
  | "platform_contact.create"
  | "platform_contact.update"
  | "platform_contact.delete";

type Db = PrismaClient | Prisma.TransactionClient;

// One row per platform-admin action (admin_audit_log). Pass the transaction client when the
// action itself runs in a transaction, so the change and its record commit together.
export async function recordAdminAction(
  admin: { userId: string; email: string },
  action: AdminAction,
  target: { type: "org" | "user" | "brand" | "contact"; id: string },
  details?: Record<string, unknown>,
  db: Db = adminPrisma
): Promise<void> {
  await db.adminAuditLog.create({
    data: {
      adminUserId: admin.userId,
      adminEmail: admin.email,
      action,
      targetType: target.type,
      targetId: target.id,
      details: (details ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
