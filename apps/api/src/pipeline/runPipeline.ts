import path from "node:path";
import fs from "node:fs/promises";
import type { Prisma } from "@prisma/client";
import { SCANNER_USER_AGENT } from "@brand-monitor/shared";
import { prisma } from "../db";
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

async function ensureBrandFaviconHash(brandId: string, primaryDomain: string): Promise<string | null> {
  const existing = await prisma.brandAsset.findFirst({ where: { brandId, type: "favicon" } });
  if (existing) return existing.hash;

  const hash = await fetchFaviconHash(primaryDomain, SCANNER_USER_AGENT);
  if (!hash) return null;

  await prisma.brandAsset.create({
    data: { brandId, type: "favicon", sourceUrl: `https://${primaryDomain}/favicon.ico`, hash },
  });
  return hash;
}

async function saveScreenshot(findingId: string, base64: string): Promise<string> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const filename = `${findingId}.png`;
  await fs.writeFile(path.join(SCREENSHOT_DIR, filename), Buffer.from(base64, "base64"));
  return `/screenshots/${filename}`;
}

export async function runPipelineForBrand(brandId: string): Promise<string> {
  const brand = await prisma.brand.findUniqueOrThrow({
    where: { id: brandId },
    include: { keywords: true, domains: true },
  });

  const run = await prisma.pipelineRun.create({ data: { brandId, status: "running" } });

  // Fire-and-forget: the API route returns the run id immediately and the frontend polls.
  processRun(run.id, brand).catch(async (err) => {
    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: { status: "failed", error: String(err?.message ?? err), finishedAt: new Date() },
    });
  });

  return run.id;
}

type BrandWithRelations = Prisma.BrandGetPayload<{ include: { keywords: true; domains: true } }>;

async function processRun(runId: string, brand: BrandWithRelations) {
  const brandRoot = brand.primaryDomain.split(".")[0].toLowerCase();
  const concatKeywords = brand.keywords.filter((k) => k.type === "concat_term").map((k) => k.keyword.toLowerCase());
  const allowlist = new Set(brand.domains.map((d) => d.domain.toLowerCase()));

  const brandFaviconHash = await ensureBrandFaviconHash(brand.id, brand.primaryDomain);

  const allCandidates = generateCandidates(brandRoot, concatKeywords).filter(
    (c) => !allowlist.has(c.domain)
  );

  await prisma.pipelineRun.update({
    where: { id: runId },
    data: { candidatesTotal: allCandidates.length },
  });

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

      const finding = await prisma.finding.upsert({
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
      });

      await prisma.domainIntel.upsert({
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
      });

      if (websiteResult && !websiteResult.skipped) {
        let screenshotPath: string | null = null;
        if (websiteResult.screenshotBase64) {
          screenshotPath = await saveScreenshot(finding.id, websiteResult.screenshotBase64);
        }

        await prisma.websiteIntel.upsert({
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
        });
      }

      await prisma.findingScoreEvent.deleteMany({ where: { findingId: finding.id } });
      await prisma.findingScoreEvent.createMany({
        data: scoring.events.map((e) => ({ findingId: finding.id, delta: e.delta, reason: e.reason, ruleCode: e.ruleCode })),
      });

      await prisma.findingEvidence.deleteMany({ where: { findingId: finding.id } });
      const positiveEvents = scoring.events.filter((e) => e.delta > 0);
      if (positiveEvents.length > 0) {
        await prisma.findingEvidence.createMany({
          data: positiveEvents.map((e) => ({ findingId: finding.id, description: e.reason })),
        });
      }

      created += 1;
    } finally {
      checked += 1;
      if (checked % 10 === 0 || checked === allCandidates.length) {
        await prisma.pipelineRun.update({ where: { id: runId }, data: { candidatesChecked: checked } });
      }
    }
  });

  await prisma.pipelineRun.update({
    where: { id: runId },
    data: { status: "completed", candidatesChecked: checked, findingsCreated: created, finishedAt: new Date() },
  });
}
