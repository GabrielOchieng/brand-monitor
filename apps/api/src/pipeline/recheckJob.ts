import { fromPrisma } from "pg-boss";
import { SCANNER_USER_AGENT } from "@brand-monitor/shared";
import { withTenant } from "../lib/tenant";
import { checkDnsExistence } from "../lib/dnsCheck";
import { lookupRdap, lookupIpRdap } from "../lib/rdap";
import { lookupWhois } from "../lib/whois";
import { fetchFaviconHash, hammingDistance, FAVICON_MATCH_THRESHOLD } from "../lib/favicon";
import { computeRegionalHashes, deserializeRegionalHashes, regionalHashesMatch } from "../lib/visualSimilarity";
import { scanWebsite } from "../lib/scannerClient";
import { computeScore } from "./scoring";
import { computeNextScanAt } from "./cadence";
import { ensureBrandFaviconHash, ensureBrandScreenshotHash, saveScreenshot } from "./enrichmentShared";
import { diffRegistration, describeChange } from "./registrationChanges";
import { isDefinitelyDown, isGoneStatus, isLiveContent, nextTakedownWatch } from "./takedownWatch";
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
    tx.finding.findUniqueOrThrow({ where: { id: findingId }, include: { brand: true, domainIntel: true } })
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
  // Also looked up for a domain that used to resolve but doesn't now: a registrar
  // suspension (clientHold) pulls the domain out of DNS, and the registry record is the only
  // place that shows it. Never-resolved candidates are still skipped.
  const wasEverRegistered = Boolean(finding.domainIntel?.firstResolvedAt);
  const registration =
    isDomainType && (dns.exists || wasEverRegistered) ? (await lookupRdap(hostname)) ?? (await lookupWhois(hostname)) : null;

  const ip = dns.a[0] ?? dns.aaaa[0] ?? null;
  const hosting = isDomainType && ip && ip !== finding.domainIntel?.hostingLookupIp ? await lookupIpRdap(ip) : null;

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
  let candidateFaviconHash: string | null = null;
  if (brandFaviconHash) {
    candidateFaviconHash = await fetchFaviconHash(hostname, SCANNER_USER_AGENT);
    if (candidateFaviconHash) faviconMatch = hammingDistance(candidateFaviconHash, brandFaviconHash) <= FAVICON_MATCH_THRESHOLD;
  }

  // Unlike favicon/DNS/WHOIS (domain-level concepts skipped entirely for a non-domain
  // finding, since they'd describe a third-party platform, not the specific fake
  // content), visual similarity is about the PAGE ITSELF -- a fake social-media profile
  // cloning the brand's login page is exactly as comparable as a cloned domain would be.
  // Computed for every finding type when a screenshot exists. ensureBrandScreenshotHash
  // is cheap to call every recheck -- it's cached (BrandAsset + TTL), so this is a cheap
  // DB read on every call after the first real capture per brand.
  const brandScreenshotHashes = await ensureBrandScreenshotHash(organizationId, brand.id, brand.primaryDomain);
  let visualSimilarity = false;
  let candidateScreenshotHashSerialized: string | null = null;
  if (websiteResult?.screenshotBase64) {
    const candidateRegionalHashes = await computeRegionalHashes(Buffer.from(websiteResult.screenshotBase64, "base64"));
    if (candidateRegionalHashes) {
      candidateScreenshotHashSerialized = candidateRegionalHashes.join("|");
      if (brandScreenshotHashes) {
        visualSimilarity = regionalHashesMatch(candidateRegionalHashes, deserializeRegionalHashes(brandScreenshotHashes));
      }
    }
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
    visualSimilarity,
    hasLoginForm: Boolean(websiteResult?.hasLoginForm),
    hasPaymentForm: Boolean(websiteResult?.hasPaymentForm),
    pageTitle: websiteResult?.title,
    pageText: websiteResult?.extractedText,
    looksParked: Boolean(websiteResult?.looksParked),
    isAllowlisted: false,
    // Deliberate, permanent, never-re-verified credit -- unlike every other input above,
    // which is a live signal re-derived fresh on every recheck, this trusts the
    // classification appStoreMonitorJob.ts already made at discovery time (source is a
    // write-once field, never mutated after creation). Accepted tradeoff: if Apple later
    // removes/renames the offending app, score stays pinned at "high" forever -- a human
    // resolving/false-positiving the finding already handles that the same way it does
    // everywhere else in this app.
    appStoreImpersonation: finding.source === "app_store",
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

    // Read BEFORE the upsert below overwrites it, and unconditionally (not just when
    // websiteResult exists) -- needed on every round, including a skipped one, so a
    // dormant -> skipped -> skipped -> active sequence still compares against the real
    // dormant baseline from before the skip streak, not something poisoned in between.
    const previousWebsiteIntel = await tx.websiteIntel.findUnique({ where: { findingId } });
    const previouslyActive =
      previousWebsiteIntel !== null && !previousWebsiteIntel.looksParked && !isGoneStatus(previousWebsiteIntel.httpStatus);
    const currentlyActive = isLiveContent(websiteResult);
    // Dormant = not currently showing real, non-parked content -- keeps getting rechecked
    // on the aggressive cadence (see cadence.ts) until it does, rather than backing off
    // with age like an already-resolved-one-way-or-the-other finding would.
    const isDormant = !currentlyActive;

    let registrationChanges: ReturnType<typeof diffRegistration> = [];

    const scan = await tx.scan.create({
      data: { findingId, kind: "recheck", triggeredBy, score: scoring.score, severity: scoring.severity, finishedAt: new Date() },
    });

    // Skipped entirely for a non-domain finding -- there is no meaningful domain
    // intelligence for a specific page on someone else's platform, and writing a row of
    // (someone else's) WHOIS/DNS facts here would show up in the UI's "domain
    // intelligence" panel as if it described the threat itself.
    if (isDomainType) {
      // Read BEFORE the upsert overwrites it -- firstResolvedAt is a first-ever fact
      // (mirrors previousWebsiteIntel's "read before overwrite" just above), never
      // clobbered by a later recheck that finds the domain no longer resolving.
      // discoveryJob.ts already sets this at creation time for an auto-discovered
      // finding (it only creates one after its own DNS check confirms dns.exists), so
      // preserving it forward here is what actually makes a later "lapsed" state
      // (dns.exists false now, but firstResolvedAt is set) detectable at all.
      const previousDomainIntel = await tx.domainIntel.findUnique({ where: { findingId } });
      const firstResolvedAt = dns.exists ? (previousDomainIntel?.firstResolvedAt ?? new Date()) : previousDomainIntel?.firstResolvedAt ?? null;

      const previousARecords = ((previousDomainIntel?.dnsRecords as { a?: string[] } | null)?.a ?? []).filter(Boolean);
      registrationChanges = diffRegistration(
        previousDomainIntel
          ? {
              registrar: previousDomainIntel.registrar,
              nameservers: previousDomainIntel.nameservers,
              whoisSource: previousDomainIntel.whoisSource,
              lastChangedAt: previousDomainIntel.lastChangedAt,
              expiresAt: previousDomainIntel.expiresAt,
              statusCodes: previousDomainIntel.statusCodes,
              aRecords: previousARecords,
            }
          : null,
        registration,
        dns.a
      );

      // A failed lookup keeps the previous registry facts instead of blanking them -- one
      // WHOIS timeout used to wipe the registrar and creation date until the next scan.
      const registrationFields = registration
        ? {
            registrar: registration.registrar,
            registeredAt: registration.registeredAt ? new Date(registration.registeredAt) : null,
            nameservers: registration.nameservers,
            whoisSource: registration.source,
            lastChangedAt: registration.lastChangedAt ? new Date(registration.lastChangedAt) : null,
            expiresAt: registration.expiresAt ? new Date(registration.expiresAt) : null,
            statusCodes: registration.statusCodes,
            registrarAbuseEmail: registration.registrarAbuseEmail,
            registrarAbusePhone: registration.registrarAbusePhone,
          }
        : {};
      const hostingFields = hosting && ip ? { hostingOrg: hosting.org, hostingAbuseEmail: hosting.abuseEmail, hostingLookupIp: ip } : {};

      await tx.domainIntel.upsert({
        where: { findingId },
        create: {
          findingId,
          nameservers: [],
          whoisSource: "unavailable",
          ...registrationFields,
          ...hostingFields,
          ip,
          dnsRecords: { a: dns.a, aaaa: dns.aaaa, ns: dns.ns, mx: dns.mx },
          firstResolvedAt,
          currentlyResolves: dns.exists,
        },
        update: {
          ...registrationFields,
          ...hostingFields,
          ip,
          dnsRecords: { a: dns.a, aaaa: dns.aaaa, ns: dns.ns, mx: dns.mx },
          firstResolvedAt,
          currentlyResolves: dns.exists,
        },
      });
    }

    // Post-takedown watch -- see takedownWatch.ts. Resolved findings keep being rechecked
    // (queue/dispatch.ts) precisely so this can catch a taken-down site coming back.
    const completedTakedowns = await tx.takedown.count({ where: { findingId, status: "completed" } });
    const watch = nextTakedownWatch({
      underWatch: previous.status === "resolved" || completedTakedowns > 0,
      downSince: previous.downSince,
      definitelyDown: isDefinitelyDown({ isDomainType, dnsExists: dns.exists, hasAddress: ip !== null, result: websiteResult }),
      live: currentlyActive,
      now: new Date(),
    });

    const changeRows: Array<{ findingId: string; scanId: string; field: string; oldValue: string; newValue: string }> =
      registrationChanges.map((c) => ({ findingId, scanId: scan.id, field: c.field, oldValue: c.oldValue, newValue: c.newValue }));
    if (watch.reactivated) {
      changeRows.push({
        findingId,
        scanId: scan.id,
        field: "site",
        oldValue: `down since ${previous.downSince!.toISOString()}`,
        newValue: "live again",
      });
    }
    if (changeRows.length > 0) await tx.findingChange.createMany({ data: changeRows });

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
          httpStatus: websiteResult.httpStatus ?? null,
          // Was hardcoded to null despite candidateFaviconHash already being computed
          // above for the match check -- a real, pre-existing, unrelated bug fixed here
          // since the value was sitting right there and just never got persisted.
          faviconHash: candidateFaviconHash,
          redirectChain: websiteResult.redirectChain ?? [],
          screenshotHash: candidateScreenshotHashSerialized,
          visualSimilarityMatch: visualSimilarity,
        },
        update: {
          screenshotPath: screenshotPath ?? undefined,
          title: websiteResult.title ?? null,
          metaDescription: websiteResult.metaDescription ?? null,
          extractedText: websiteResult.extractedText ?? null,
          hasLoginForm: Boolean(websiteResult.hasLoginForm),
          hasPaymentForm: Boolean(websiteResult.hasPaymentForm),
          looksParked: Boolean(websiteResult.looksParked),
          httpStatus: websiteResult.httpStatus ?? null,
          faviconHash: candidateFaviconHash,
          screenshotHash: candidateScreenshotHashSerialized,
          visualSimilarityMatch: visualSimilarity,
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
        nextScanAt: computeNextScanAt(previous.firstDetectedAt, new Date(), isDormant),
        downSince: watch.downSince,
        // Back into the triage queue: it needs a new takedown.
        ...(watch.reactivated && previous.status === "resolved" ? { status: "new" } : {}),
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
      justActivated: !previouslyActive && currentlyActive,
      reactivated: watch.reactivated,
      registrationChanges: registrationChanges.filter((c) => c.alert).map(describeChange),
    };
    await boss.send(QUEUE_ALERT_DISPATCH, alertData, { db: fromPrisma(tx) });
  });
}
