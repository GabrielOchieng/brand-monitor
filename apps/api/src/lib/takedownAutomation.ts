import type { Prisma } from "@prisma/client";
import { env } from "../env";

// Automatic takedown reporting (TAKEDOWN_AUTOMATION_PLAN.md): whether an org (and a brand) may
// have reports sent automatically. Every switch must be on; each one that isn't is a "blocker",
// which the settings page lists so the owner can see what's missing. Websites only: the
// dispatcher (a later step) never picks social findings, whatever this says.

export type AutomationBlocker =
  | "platform_disabled" // AUTO_TAKEDOWN_ENABLED isn't "1"
  | "not_allowed" // a platform admin hasn't allowed this org
  | "no_sender" // no sender mailbox connected
  | "sender_untested" // the sender's current settings haven't passed a test send
  | "no_authorization" // no authorization in force (none, revoked, not started yet, or expired)
  | "not_enabled" // the owner hasn't turned it on
  | "stopped" // "Stop all sending" is on
  | "monitoring_paused" // org or brand paused by a platform admin
  | "brand_off"; // turned off for this brand

export interface AutomationState {
  platformEnabled: boolean;
  org: { autoTakedownAllowedAt: Date | null; monitoringPausedAt: Date | null };
  automation: { enabledAt: Date | null; stoppedAt: Date | null } | null;
  sender: { lastTestOk: boolean | null } | null;
  authorizations: Array<{ brandId: string | null; validFrom: Date; expiresAt: Date | null; revokedAt: Date | null }>;
}

export function authorizationInForce(
  a: { brandId: string | null; validFrom: Date; expiresAt: Date | null; revokedAt: Date | null },
  brandId: string | null,
  now: Date
): boolean {
  if (a.revokedAt) return false;
  if (a.validFrom > now) return false;
  if (a.expiresAt && a.expiresAt <= now) return false;
  // brandId null (org level): any authorization in force counts; a brand needs one for all
  // brands or for itself.
  return brandId === null || a.brandId === null || a.brandId === brandId;
}

// Blockers for the org as a whole (brand = null), or for one brand.
export function automationBlockers(
  state: AutomationState,
  brand: { id: string; autoTakedownEnabled: boolean; monitoringPausedAt: Date | null } | null = null,
  now = new Date()
): AutomationBlocker[] {
  const b: AutomationBlocker[] = [];
  if (!state.platformEnabled) b.push("platform_disabled");
  if (!state.org.autoTakedownAllowedAt) b.push("not_allowed");
  if (!state.sender) b.push("no_sender");
  else if (state.sender.lastTestOk !== true) b.push("sender_untested");
  if (!state.authorizations.some((a) => authorizationInForce(a, brand?.id ?? null, now))) b.push("no_authorization");
  if (!state.automation?.enabledAt) b.push("not_enabled");
  if (state.automation?.stoppedAt) b.push("stopped");
  if (state.org.monitoringPausedAt || brand?.monitoringPausedAt) b.push("monitoring_paused");
  if (brand && !brand.autoTakedownEnabled) b.push("brand_off");
  return b;
}

// What turning it on needs: the setup blockers, not the ones the switch itself controls.
export const ENABLE_REQUIRES: AutomationBlocker[] = ["not_allowed", "no_sender", "sender_untested", "no_authorization"];

// Loads the state inside a tenant transaction (or through adminPrisma for the admin panel).
export async function loadAutomationState(db: Prisma.TransactionClient, orgId: string): Promise<AutomationState> {
  const [org, automation, sender, authorizations] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { autoTakedownAllowedAt: true, monitoringPausedAt: true } }),
    db.takedownAutomation.findUnique({ where: { organizationId: orgId } }),
    db.takedownSender.findUnique({ where: { organizationId: orgId }, select: { lastTestOk: true } }),
    db.takedownAuthorization.findMany({
      where: { organizationId: orgId },
      select: { brandId: true, validFrom: true, expiresAt: true, revokedAt: true },
    }),
  ]);
  return { platformEnabled: env.autoTakedownEnabled, org, automation, sender, authorizations };
}

export async function recordAutomationEvent(
  db: Prisma.TransactionClient,
  orgId: string,
  actor: { userId: string | null; email: string | null },
  action: string,
  details?: Record<string, unknown>
): Promise<void> {
  await db.takedownAutomationEvent.create({
    data: {
      organizationId: orgId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action,
      details: (details ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}
