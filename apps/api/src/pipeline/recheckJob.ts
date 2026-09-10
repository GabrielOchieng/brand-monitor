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

  // A "domain" finding (auto-discovered, or a manually-submitted bare domain) is a
  // registrable name we own the full context of -- DNS/WHOIS/favicon-vs-root all make
  // sense against it. Any other type (currently just "url", from manual submission of a
  // path-bearing link like a social-media profile) is a specific page on infrastructure
  // we don't control -- WHOIS/DNS/favicon data about e.g. instagram.com says nothing
  // about one fake profile hosted there, and would be actively misleading if displayed
  // as "domain intelligence." Skip those steps entirely for non-domain types; still scan
  // and score the actual submitted URL, and still enroll it in the normal recheck
  // cadence below so an active phishing page keeps getting re-checked, not just scored once.
  const isDomainType = finding.type === "domain";
  const hostname = isDomainType ? finding.identifier : new URL(finding.identifier).hostname;

  // All network I/O happens before the write transaction below -- never hold a Postgres
  // transaction open across DNS/WHOIS/website-scan calls that can take many seconds.
  const brandFaviconHash = isDomainType ? await ensureBrandFaviconHash(organizationId, brand.id, brand.primaryDomain) : null;
  const dns = isDomainType ? await checkDnsExistence(hostname) : { exists: false, a: [], aaaa: [], ns: [], mx: [] };
  const registration = isDomainType && dns.exists ? (await lookupRdap(hostname)) ?? (await lookupWhois(hostname)) : null;

  let websiteResult: Awaited<ReturnType<typeof scanWebsite>> | null = null;
  if (isDomainType) {
    if (dns.a.length > 0 || dns.aaaa.length > 0) {
      websiteResult = await scanWebsite(`https://${hostname}`, SCANNER_USER_AGENT);
      if (websiteResult.skipped) {
        websiteResult = await scanWebsite(`http://${hostname}`, SCANNER_USER_AGENT);
      }
    }
  } else {
    // Already a full, validated URL (checked at submission time) -- scan it directly,
    // no DNS gate and no scheme guessing.
    websiteResult = await scanWebsite(finding.identifier, SCANNER_USER_AGENT);
  }

  let faviconMatch = false;
  if (brandFaviconHash) {
    const candidateHash = await fetchFaviconHash(hostname, SCANNER_USER_AGENT);
    if (candidateHash) faviconMatch = hammingDistance(candidateHash, brandFaviconHash) <= FAVICON_MATCH_THRESHOLD;
  }

  // Homoglyph credit is a discovery-time-only concept (from permutations.ts's candidate
  // generation) -- a recheck has no candidate metadata, only the domain string itself.
  // That's fine: score events are point-in-time facts about that scan, not required to
  // replicate exactly what an earlier scan found.
  const scoring = computeScore({
    domain: hostname,
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

    // Skipped entirely for a non-domain finding -- there is no meaningful domain
    // intelligence for a specific page on someone else's platform, and writing a row of
    // (someone else's) WHOIS/DNS facts here would show up in the UI's "domain
    // intelligence" panel as if it described the threat itself.
    if (isDomainType) {
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
    }

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
