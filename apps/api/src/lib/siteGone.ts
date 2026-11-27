import type { Prisma } from "@prisma/client";
import { isOnHold } from "./rdap";

// A domain finding whose site is gone: the registry has it on hold (a registrar suspension,
// what a successful takedown looks like) or it stopped resolving after having resolved.
// Gone findings score low and leave "Needs action", but keep being rechecked: a hold can be
// lifted and a domain can be re-pointed (registrationChanges.ts, takedownWatch.ts).
export type SiteGone = "suspended" | "unresolved";

export const HOLD_STATUS_CODES = ["clientHold", "serverHold"];

// "unresolved" needs two failed lookups in a row (this scan and the one before), so a single
// DNS blip can't drop the score and fire a severity alert when it comes back. A hold is read
// from the registry record, which is authoritative, so one reading is enough.
export function siteGoneState(input: {
  statusCodes: string[];
  everResolved: boolean;
  resolvesNow: boolean;
  resolvedLastScan: boolean | null;
}): SiteGone | null {
  if (isOnHold(input.statusCodes)) return "suspended";
  if (input.everResolved && !input.resolvesNow && input.resolvedLastScan === false) return "unresolved";
  return null;
}

// Same idea for lists, from the stored domain_intel of the latest scan. It doesn't wait for the
// second failed lookup: a list says what the last scan saw.
export const SITE_GONE_WHERE: Prisma.FindingWhereInput = {
  domainIntel: {
    is: {
      OR: [{ statusCodes: { hasSome: HOLD_STATUS_CODES } }, { currentlyResolves: false, firstResolvedAt: { not: null } }],
    },
  },
};
