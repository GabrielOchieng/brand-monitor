import path from "node:path";
import fs from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import { SCANNER_USER_AGENT } from "@brand-monitor/shared";
import { withTenant } from "../lib/tenant";
import { generateCandidates } from "./permutations";
import { checkDnsExistence } from "../lib/dnsCheck";
import { lookupRdap } from "../lib/rdap";
import { lookupWhois } from "../lib/whois";
import { fetchFaviconHash, hammingDistance, FAVICON_MATCH_THRESHOLD } from "../lib/favicon";
import { scanWebsite } from "../lib/scannerClient";
import { computeScore } from "./scoring";
import { mapWithConcurrency } from "../lib/concurrency";

const CONCURRENCY = 5;
const SCREENSHOT_DIR = path.join(process.cwd(), "screenshots");

// Every DB call below is its own short-lived withTenant() transaction rather than one
// transaction wrapping the whole run -- this pipeline does minutes of network I/O (DNS,
// WHOIS, website scans) between writes, and holding a single Postgres transaction/
// connection open across all of that would tie up a pool connection for the run's
// entire duration and risk idle-in-transaction timeouts. Each call pays a small extra
// round-trip for that isolation; worth it at this volume.

async function ensureBrandFaviconHash(orgId: string, brandId: string, primaryDomain: string): Promise<string | null> {
  const existing = await withTenant(orgId, (tx) => tx.brandAsset.findFirst({ where: { brandId, type: "favicon" } }));
  if (existing) return existing.hash;

  const hash = await fetchFaviconHash(primaryDomain, SCANNER_USER_AGENT);
  if (!hash) return null;

  await withTenant(orgId, (tx) =>
    tx.brandAsset.create({
      data: { brandId, type: "favicon", sourceUrl: `https://${primaryDomain}/favicon.ico`, hash },
    })
  );
  return hash;
}

async function saveScreenshot(findingId: string, base64: string): Promise<string> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const filename = `${findingId}.png`;
  await fs.writeFile(path.join(SCREENSHOT_DIR, filename), Buffer.from(base64, "base64"));
  return `/screenshots/${filename}`;
}

export async function runPipelineForBrand(organizationId: string, brandId: string): Promise<string> {
  const brand = await withTenant(organizationId, (tx) =>
    tx.brand.findUniqueOrThrow({
      where: { id: brandId },
      include: { keywords: true, domains: true },
    })
  );

  const run = await withTenant(organizationId, (tx) => tx.pipelineRun.create({ data: { brandId, status: "running" } }));

  // Fire-and-forget: the API route returns the run id immediately and the frontend polls.
  processRun(organizationId, run.id, brand).catch(async (err) => {
    await withTenant(organizationId, (tx) =>
      tx.pipelineRun.update({
        where: { id: run.id },
        data: { status: "failed", error: String(err?.message ?? err), finishedAt: new Date() },
      })
    );
  });

  return run.id;
}

type BrandWithRelations = Prisma.BrandGetPayload<{ include: { keywords: true; domains: true } }>;

async function processRun(organizationId: string, runId: string, brand: BrandWithRelations) {
  const brandRoot = brand.primaryDomain.split(".")[0].toLowerCase();
  const concatKeywords = brand.keywords.filter((k) => k.type === "concat_term").map((k) => k.keyword.toLowerCase());
  const allowlist = new Set(brand.domains.map((d) => d.domain.toLowerCase()));

  const brandFaviconHash = await ensureBrandFaviconHash(organizationId, brand.id, brand.primaryDomain);

  const allCandidates = generateCandidates(brandRoot, concatKeywords).filter(
    (c) => !allowlist.has(c.domain)
  );

  await withTenant(organizationId, (tx) =>
    tx.pipelineRun.update({ where: { id: runId }, data: { candidatesTotal: allCandidates.length } })
  );

  let checked = 0;
  let created = 0;

  await mapWithConcurrency(allCandidates, CONCURRENCY, async (candidate) => {
    try {
      const dns = await checkDnsExistence(candidate.domain);
      if (!dns.exists) return;

      const registration = (await lookupRdap(candidate.domain)) ?? (await lookupWhois(candidate.domain));

      let websiteResult: Awaited<ReturnType<typeof scanWebsite>> | null = null;
      if (dns.a.length > 0 || dns.aaaa.length > 0) {
        websiteResult = await scanWebsite(`https://${candidate.domain}`, SCANNER_USER_AGENT);
        if (websiteResult.skipped) {
          websiteResult = await scanWebsite(`http://${candidate.domain}`, SCANNER_USER_AGENT);
        }
      }

      let faviconMatch = false;
      if (brandFaviconHash) {
        const candidateHash = await fetchFaviconHash(candidate.domain, SCANNER_USER_AGENT);
        if (candidateHash) faviconMatch = hammingDistance(candidateHash, brandFaviconHash) <= FAVICON_MATCH_THRESHOLD;
      }

      const scoring = computeScore({
        domain: candidate.domain,
        brandRoot,
        isHomoglyph: candidate.isHomoglyph,
        registeredAt: registration?.registeredAt ? new Date(registration.registeredAt) : null,
        faviconMatch,
        hasLoginForm: Boolean(websiteResult?.hasLoginForm),
        hasPaymentForm: Boolean(websiteResult?.hasPaymentForm),
        looksParked: Boolean(websiteResult?.looksParked),
        isAllowlisted: false, // already filtered out above; kept for rule completeness
      });

      const finding = await withTenant(organizationId, (tx) =>
        tx.finding.upsert({
          where: { brandId_identifier: { brandId: brand.id, identifier: candidate.domain } },
          create: {
            brandId: brand.id,
            identifier: candidate.domain,
            type: "domain",
            source: "pipeline",
            riskScore: scoring.score,
            severity: scoring.severity,
          },
          update: {
            riskScore: scoring.score,
            severity: scoring.severity,
            lastScannedAt: new Date(),
          },
        })
      );

      await withTenant(organizationId, (tx) =>
        tx.domainIntel.upsert({
          where: { findingId: finding.id },
          create: {
            findingId: finding.id,
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
        })
      );

      if (websiteResult && !websiteResult.skipped) {
        let screenshotPath: string | null = null;
        if (websiteResult.screenshotBase64) {
          screenshotPath = await saveScreenshot(finding.id, websiteResult.screenshotBase64);
        }

        await withTenant(organizationId, (tx) =>
          tx.websiteIntel.upsert({
            where: { findingId: finding.id },
            create: {
              findingId: finding.id,
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
          })
        );
      }

      // NOTE: still delete-and-recreate (matches POC behavior). Making this append-only
      // is Stage B work (required there for alerting/timeline, not needed for Stage A's
      // tenant-isolation goal) -- tracked in the approved plan, not forgotten.
      await withTenant(organizationId, (tx) => tx.findingScoreEvent.deleteMany({ where: { findingId: finding.id } }));
      await withTenant(organizationId, (tx) =>
        tx.findingScoreEvent.createMany({
          data: scoring.events.map((e) => ({ findingId: finding.id, delta: e.delta, reason: e.reason, ruleCode: e.ruleCode })),
        })
      );

      await withTenant(organizationId, (tx) => tx.findingEvidence.deleteMany({ where: { findingId: finding.id } }));
      const positiveEvents = scoring.events.filter((e) => e.delta > 0);
      if (positiveEvents.length > 0) {
        await withTenant(organizationId, (tx) =>
          tx.findingEvidence.createMany({
            data: positiveEvents.map((e) => ({ findingId: finding.id, description: e.reason })),
          })
        );
      }

      created += 1;
    } finally {
      checked += 1;
      if (checked % 10 === 0 || checked === allCandidates.length) {
        await withTenant(organizationId, (tx) =>
          tx.pipelineRun.update({ where: { id: runId }, data: { candidatesChecked: checked } })
        );
      }
    }
  });

  await withTenant(organizationId, (tx) =>
    tx.pipelineRun.update({
      where: { id: runId },
      data: { status: "completed", candidatesChecked: checked, findingsCreated: created, finishedAt: new Date() },
    })
  );
}
