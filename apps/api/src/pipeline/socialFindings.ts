import { fromPrisma } from "pg-boss";
import type { Prisma } from "@prisma/client";
import { withTenant } from "../lib/tenant";
import { parseSocialUrl, normalizeHandle, type SocialAccount } from "../lib/socialUrls";
import { extractIndicators, withoutOwnIndicators, indicatorKey, type Indicator } from "../lib/indicators";
import { ensureBrandOwnIndicators, findMostSharedIndicator } from "./enrichmentShared";
import { brandMatcher } from "./nrdMonitorJob";
import { computeScore } from "./scoring";
import { boss, QUEUE_ALERT_DISPATCH } from "../queue/boss";
import type { AlertDispatchJobData } from "../queue/alertDispatch";

// Social-media accounts as findings. The platforms block automated access (the scanner
// got nothing back from TikTok or Facebook, 2026-10-19) and their terms forbid scraping,
// so a social finding is never scanned: it's scored on what a search engine showed about
// it (pipeline/socialSearchMonitorJob.ts) plus the contact details found there.

const DAY_MS = 24 * 60 * 60 * 1000;

export function isOfficialAccount(officialSocialUrls: string[], account: SocialAccount): boolean {
  return officialSocialUrls.some((u) => parseSocialUrl(u)?.profileUrl === account.profileUrl);
}

// The brand's own contact details as far as social posts go: what its website shows
// (ensureBrandOwnIndicators) plus any wa.me / t.me link in its official-accounts list --
// jambojet.com answers the scanner with a blank page, so the site alone can miss the real
// WhatsApp number. A WhatsApp number counts as the same number when quoted as a phone.
export async function socialOwnIndicatorKeys(
  organizationId: string,
  brand: { id: string; primaryDomain: string; officialSocialUrls: string[] }
): Promise<Set<string>> {
  const keys = await ensureBrandOwnIndicators(organizationId, brand.id, brand.primaryDomain);
  const all = new Set(keys);
  for (const i of extractIndicators("", brand.officialSocialUrls)) {
    all.add(indicatorKey(i));
    if (i.kind === "whatsapp") all.add(indicatorKey({ kind: "phone", value: i.value }));
  }
  for (const key of keys) {
    if (key.startsWith("whatsapp:")) all.add(`phone:${key.slice("whatsapp:".length)}`);
  }
  return all;
}

export function handleImpersonatesBrand(account: SocialAccount, brandRoot: string): boolean {
  return Boolean(account.handle) && brandMatcher(brandRoot)(normalizeHandle(account.handle!));
}

export interface SearchResultLike {
  url: string;
  title?: string | null;
  content?: string | null;
}

export interface SocialCandidate {
  account: SocialAccount;
  postUrl: string;
  title: string | null;
  snippet: string | null;
  indicators: Indicator[];
  handleImpersonation: boolean;
}

// Decides whether one search hit is worth a finding. A brand mention alone isn't --
// travel vlogs and "how I booked my Jambojet flight" posts mention it too. It has to
// either call itself by the brand's name (and not be an official account), or give a
// contact number that isn't the brand's.
export function classifySocialResult(
  result: SearchResultLike,
  brand: { brandRoot: string; officialSocialUrls: string[]; ownKeys: ReadonlySet<string>; ownDomains: string[] }
): SocialCandidate | null {
  const account = parseSocialUrl(result.url, result.title);
  if (!account || isOfficialAccount(brand.officialSocialUrls, account)) return null;

  const title = result.title?.trim() || null;
  const snippet = result.content?.trim() || null;
  const text = `${title ?? ""}\n${snippet ?? ""}`;
  const handleImpersonation = handleImpersonatesBrand(account, brand.brandRoot);
  const mentionsBrand = handleImpersonation || brandMatcher(brand.brandRoot)(text.toLowerCase().replace(/[\s._-]+/g, ""));
  if (!mentionsBrand) return null;

  const indicators = withoutOwnIndicators(extractIndicators(text), brand.ownKeys, brand.ownDomains);
  if (!handleImpersonation && indicators.length === 0) return null;

  return { account, postUrl: result.url, title, snippet, indicators, handleImpersonation };
}

// Creates the finding (or refreshes an existing one) for a sighting of a social account.
// Returns true when there's something new to score: a new finding, or a contact detail
// this account hadn't shown before.
export async function recordSocialSighting(
  tx: Prisma.TransactionClient,
  brandId: string,
  source: string,
  sighting: { account: SocialAccount; postUrl?: string | null; title?: string | null; snippet?: string | null; indicators?: Indicator[] }
): Promise<{ findingId: string; created: boolean; needsRescore: boolean }> {
  const { account } = sighting;
  const now = new Date();
  const existing = await tx.finding.findUnique({ where: { brandId_identifier: { brandId, identifier: account.profileUrl } } });
  const finding =
    existing ??
    (await tx.finding.create({
      data: { brandId, type: "social", identifier: account.profileUrl, source, riskScore: 0, severity: "low", nextScanAt: now },
    }));

  // A sighting without search evidence (a manual submission) mustn't blank out the
  // title/snippet an earlier search found.
  const evidence = {
    ...(sighting.postUrl ? { postUrl: sighting.postUrl } : {}),
    ...(sighting.title ? { title: sighting.title } : {}),
    ...(sighting.snippet ? { snippet: sighting.snippet } : {}),
  };
  await tx.socialIntel.upsert({
    where: { findingId: finding.id },
    create: { findingId: finding.id, brandId, platform: account.platform, handle: account.handle, ...evidence, firstSeenAt: now, lastSeenAt: now },
    update: { ...evidence, lastSeenAt: now },
  });

  let newIndicator = false;
  const indicators = sighting.indicators ?? [];
  if (indicators.length > 0) {
    const inserted = await tx.findingIndicator.createMany({
      data: indicators.map((i) => ({ findingId: finding.id, brandId, kind: i.kind, value: i.value, firstSeenAt: now, lastSeenAt: now })),
      skipDuplicates: true,
    });
    newIndicator = inserted.count > 0;
    await tx.findingIndicator.updateMany({
      where: { findingId: finding.id, OR: indicators.map((i) => ({ kind: i.kind, value: i.value })) },
      data: { lastSeenAt: now },
    });
  }

  const needsRescore = !existing || newIndicator;
  if (existing && newIndicator) await tx.finding.update({ where: { id: finding.id }, data: { nextScanAt: now } });
  return { findingId: finding.id, created: !existing, needsRescore };
}

// recheckJob.ts's path for a social finding: no network to the platform at all, just a
// re-score from stored evidence -- so it's cheap, and runs daily rather than on the
// domain cadence (new evidence arrives through the search job, which reschedules it).
export async function runSocialRecheck(
  organizationId: string,
  findingId: string,
  triggeredBy: "manual" | "scheduled"
): Promise<void> {
  const finding = await withTenant(organizationId, (tx) =>
    tx.finding.findUniqueOrThrow({ where: { id: findingId }, include: { brand: { include: { domains: true } }, indicators: true } })
  );
  const brand = finding.brand;
  const brandRoot = brand.primaryDomain.split(".")[0].toLowerCase();
  const account = parseSocialUrl(finding.identifier);

  const ownKeys = await socialOwnIndicatorKeys(organizationId, brand);
  const ownDomains = [brand.primaryDomain, ...brand.domains.map((d) => d.domain)].map((d) => d.toLowerCase());
  // Re-filtered every time: an official-accounts edit can turn a "foreign" number into
  // the brand's own after the fact.
  const indicators = withoutOwnIndicators(
    finding.indicators.map((i) => ({ kind: i.kind, value: i.value }) as Indicator),
    ownKeys,
    ownDomains
  );
  const sharedIndicator = indicators.length > 0 ? await findMostSharedIndicator(organizationId, brand.id, findingId, indicators) : null;
  const publicReportCount = await withTenant(organizationId, (tx) =>
    tx.publicReport.count({
      where: { status: { not: "dismissed" }, OR: [{ findingId }, { matchedFindingIds: { has: findingId } }] },
    })
  );

  const official = account ? isOfficialAccount(brand.officialSocialUrls, account) : false;
  const scoring = computeScore({
    domain: account ? account.profileUrl : finding.identifier,
    brandRoot,
    isHomoglyph: false,
    registeredAt: null,
    faviconMatch: false,
    visualSimilarity: false,
    hasLoginForm: false,
    hasPaymentForm: false,
    looksParked: false,
    isAllowlisted: official,
    appStoreImpersonation: false,
    sharedIndicator,
    publicReportCount,
    social: {
      handleImpersonation: !official && Boolean(account && handleImpersonatesBrand(account, brandRoot)),
      contactDetails: indicators.length > 0,
    },
  });

  await withTenant(organizationId, async (tx) => {
    const previous = await tx.finding.findUniqueOrThrow({ where: { id: findingId } });
    const scan = await tx.scan.create({
      data: { findingId, kind: "recheck", triggeredBy, score: scoring.score, severity: scoring.severity, finishedAt: new Date() },
    });
    await tx.findingScoreEvent.createMany({
      data: scoring.events.map((e) => ({ findingId, scanId: scan.id, delta: e.delta, reason: e.reason, ruleCode: e.ruleCode })),
    });
    const positiveEvents = scoring.events.filter((e) => e.delta > 0);
    if (positiveEvents.length > 0) {
      await tx.findingEvidence.createMany({
        data: positiveEvents.map((e) => ({ findingId, scanId: scan.id, description: e.reason })),
      });
    }
    await tx.finding.update({
      where: { id: findingId },
      data: {
        riskScore: scoring.score,
        severity: scoring.severity,
        lastScannedAt: new Date(),
        lastScanId: scan.id,
        nextScanAt: new Date(Date.now() + DAY_MS),
      },
    });

    const alertData: AlertDispatchJobData = {
      findingId,
      scanId: scan.id,
      organizationId,
      previousScore: previous.riskScore,
      previousSeverity: previous.severity,
      newScore: scoring.score,
      newSeverity: scoring.severity,
      isFirstScan: previous.lastScanId === null,
      justActivated: false,
      reactivated: false,
      registrationChanges: [],
    };
    await boss.send(QUEUE_ALERT_DISPATCH, alertData, { db: fromPrisma(tx) });
  });
}
