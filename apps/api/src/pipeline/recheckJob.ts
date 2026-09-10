import { fromPrisma } from "pg-boss";
import { SCANNER_USER_AGENT } from "@brand-monitor/shared";
import { withTenant } from "../lib/tenant";
import { checkDnsExistence } from "../lib/dnsCheck";
import { lookupRdap } from "../lib/rdap";
import { lookupWhois } from "../lib/whois";
import { fetchFaviconHash, hammingDistance, FAVICON_MATCH_THRESHOLD } from "../lib/favicon";
import { scanWebsite } from "../lib/scannerClient";
import { computeScore } from "./scoring";
import { computeNextScanAt } from "./cadence";
import { ensureBrandFaviconHash, saveScreenshot } from "./enrichmentShared";
import { boss, QUEUE_ALERT_DISPATCH } from "../queue/boss";
import type { AlertDispatchJobData } from "../queue/alertDispatch";

export interface RecheckJobData {
  findingId: string;
  organizationId: string;
  triggeredBy?: "manual" | "scheduled";
}

// The only place enrichment logic lives (RDAP/WHOIS, website scan, favicon match,
// scoring) -- discoveryJob.ts deliberately does none of this, so a brand-new finding
// gets its first real score here, typically within minutes via the recheck dispatcher.
export async function runRecheckJob(data: RecheckJobData): Promise<void> {
  const { findingId, organizationId, triggeredBy = "scheduled" } = data;

  const finding = await withTenant(organizationId, (tx) =>
    tx.finding.findUniqueOrThrow({ where: { id: findingId }, include: { brand: true } })
  );

  const brand = finding.brand;
  const brandRoot = brand.primaryDomain.split(".")[0].toLowerCase();
  const domain = finding.identifier;

  // All network I/O happens before the write transaction below -- never hold a Postgres
  // transaction open across DNS/WHOIS/website-scan calls that can take many seconds.
  const brandFaviconHash = await ensureBrandFaviconHash(organizationId, brand.id, brand.primaryDomain);
  const dns = await checkDnsExistence(domain);
  const registration = dns.exists ? (await lookupRdap(domain)) ?? (await lookupWhois(domain)) : null;

  let websiteResult: Awaited<ReturnType<typeof scanWebsite>> | null = null;
  if (dns.a.length > 0 || dns.aaaa.length > 0) {
    websiteResult = await scanWebsite(`https://${domain}`, SCANNER_USER_AGENT);
    if (websiteResult.skipped) {
      websiteResult = await scanWebsite(`http://${domain}`, SCANNER_USER_AGENT);
    }
  }

  let faviconMatch = false;
  if (brandFaviconHash) {
    const candidateHash = await fetchFaviconHash(domain, SCANNER_USER_AGENT);
    if (candidateHash) faviconMatch = hammingDistance(candidateHash, brandFaviconHash) <= FAVICON_MATCH_THRESHOLD;
  }

  // Homoglyph credit is a discovery-time-only concept (from permutations.ts's candidate
  // generation) -- a recheck has no candidate metadata, only the domain string itself.
  // That's fine: score events are point-in-time facts about that scan, not required to
  // replicate exactly what an earlier scan found.
  const scoring = computeScore({
    domain,
    brandRoot,
    isHomoglyph: false,
    registeredAt: registration?.registeredAt ? new Date(registration.registeredAt) : null,
    faviconMatch,
    hasLoginForm: Boolean(websiteResult?.hasLoginForm),
    hasPaymentForm: Boolean(websiteResult?.hasPaymentForm),
    looksParked: Boolean(websiteResult?.looksParked),
    isAllowlisted: false,
  });

  let screenshotPath: string | null = null;
  if (websiteResult && !websiteResult.skipped && websiteResult.screenshotBase64) {
    screenshotPath = await saveScreenshot(findingId, websiteResult.screenshotBase64);
  }

  // One transaction for the whole write sequence: Scan + its child rows are created
  // first, and the Finding's pointer fields (riskScore/severity/lastScanId/nextScanAt)
  // are flipped last, in the same transaction -- a crash or error anywhere in here rolls
  // back entirely, leaving the finding showing its previous, still-self-consistent scan
  // rather than a half-updated one. The alert-dispatch job is enqueued inside this same
  // transaction (via fromPrisma(tx)) for the same reason: the recheck queue has
  // retryLimit=1, and if anything AFTER this transaction threw, pg-boss would retry this
  // entire expensive job -- redoing all the network I/O above and creating a SECOND
  // duplicate Scan for what should be one logical check, while corrupting the "previous
  // score" baseline the retry would compute. Keeping the enqueue inside the transaction
  // means it either commits atomically with the scan or the whole thing rolls back
  // cleanly, so a pg-boss retry is always safe (nothing was partially committed).
  await withTenant(organizationId, async (tx) => {
    // Re-read fresh rather than reusing the `finding` fetched at the top of this
    // function (minutes ago, before all the network I/O) -- not needed for correctness
    // today (the recheck queue's "exclusive" policy already prevents a concurrent writer
    // for this finding), but makes "previous score" correct independent of any future
    // code path that might touch riskScore/severity outside this job.
    const previous = await tx.finding.findUniqueOrThrow({ where: { id: findingId } });

    const scan = await tx.scan.create({
      data: { findingId, kind: "recheck", triggeredBy, score: scoring.score, severity: scoring.severity, finishedAt: new Date() },
    });

    await tx.domainIntel.upsert({
      where: { findingId },
      create: {
        findingId,
        registrar: registration?.registrar ?? null,
        registeredAt: registration?.registeredAt ? new Date(registration.registeredAt) : null,
        nameservers: registration?.nameservers ?? [],
        ip: dns.a[0] ?? dns.aaaa[0] ?? null,
        dnsRecords: { a: dns.a, aaaa: dns.aaaa, ns: dns.ns, mx: dns.mx },
        whoisSource: registration?.source ?? "unavailable",
      },
      update: {
        registrar: registration?.registrar ?? null,
        registeredAt: registration?.registeredAt ? new Date(registration.registeredAt) : null,
        nameservers: registration?.nameservers ?? [],
        ip: dns.a[0] ?? dns.aaaa[0] ?? null,
        dnsRecords: { a: dns.a, aaaa: dns.aaaa, ns: dns.ns, mx: dns.mx },
        whoisSource: registration?.source ?? "unavailable",
      },
    });

    if (websiteResult && !websiteResult.skipped) {
      await tx.websiteIntel.upsert({
        where: { findingId },
        create: {
          findingId,
          screenshotPath,
          title: websiteResult.title ?? null,
          metaDescription: websiteResult.metaDescription ?? null,
          extractedText: websiteResult.extractedText ?? null,
          hasLoginForm: Boolean(websiteResult.hasLoginForm),
          hasPaymentForm: Boolean(websiteResult.hasPaymentForm),
          looksParked: Boolean(websiteResult.looksParked),
          faviconHash: null,
          redirectChain: websiteResult.redirectChain ?? [],
        },
        update: {
          screenshotPath: screenshotPath ?? undefined,
          title: websiteResult.title ?? null,
          metaDescription: websiteResult.metaDescription ?? null,
          extractedText: websiteResult.extractedText ?? null,
          hasLoginForm: Boolean(websiteResult.hasLoginForm),
          hasPaymentForm: Boolean(websiteResult.hasPaymentForm),
          looksParked: Boolean(websiteResult.looksParked),
          scannedAt: new Date(),
        },
      });
    }

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
        nextScanAt: computeNextScanAt(previous.firstDetectedAt, new Date()),
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
    };
    await boss.send(QUEUE_ALERT_DISPATCH, alertData, { db: fromPrisma(tx) });
  });
}
