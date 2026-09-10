import { withTenant } from "../lib/tenant";
import { generateCandidates } from "./permutations";
import { checkDnsExistence } from "../lib/dnsCheck";
import { mapWithConcurrency } from "../lib/concurrency";

const CONCURRENCY = 5;

export interface DiscoveryJobData {
  runId: string;
  brandId: string;
  organizationId: string;
}

// Deliberately minimal: candidate generation + DNS existence check + bare Finding
// creation only. No WHOIS/website-scan/scoring here at all -- that's recheckJob.ts's
// job, kept in exactly one place rather than duplicated. A brand-new finding is created
// with nextScanAt=now() so the recheck dispatcher (queue/dispatch.ts, every 5 min) picks
// it up for its first real enrichment almost immediately, rather than discovery doing
// the expensive work itself.
export async function runDiscoveryJob(data: DiscoveryJobData): Promise<void> {
  const { runId, brandId, organizationId } = data;

  try {
    const brand = await withTenant(organizationId, (tx) =>
      tx.brand.findUniqueOrThrow({
        where: { id: brandId },
        include: { keywords: true, domains: true },
      })
    );

    const brandRoot = brand.primaryDomain.split(".")[0].toLowerCase();
    const concatKeywords = brand.keywords.filter((k) => k.type === "concat_term").map((k) => k.keyword.toLowerCase());
    const allowlist = new Set(brand.domains.map((d) => d.domain.toLowerCase()));

    const allCandidates = generateCandidates(brandRoot, concatKeywords).filter((c) => !allowlist.has(c.domain));

    await withTenant(organizationId, (tx) =>
      tx.pipelineRun.update({ where: { id: runId }, data: { candidatesTotal: allCandidates.length } })
    );

    let checked = 0;
    let created = 0;

    await mapWithConcurrency(allCandidates, CONCURRENCY, async (candidate) => {
      try {
        const dns = await checkDnsExistence(candidate.domain);
        if (!dns.exists) return;

        const alreadyTracked = await withTenant(organizationId, (tx) =>
          tx.finding.findUnique({ where: { brandId_identifier: { brandId, identifier: candidate.domain } } })
        );
        if (alreadyTracked) return; // recheck's own cadence keeps it fresh; discovery doesn't touch it

        await withTenant(organizationId, async (tx) => {
          const finding = await tx.finding.create({
            data: {
              brandId,
              identifier: candidate.domain,
              type: "domain",
              source: "pipeline",
              riskScore: 0,
              severity: "low",
              nextScanAt: new Date(),
            },
          });
          // Capture "confirmed resolving" right now, at the moment it's actually true --
          // the DNS check above (dns.exists) is the only proof of that we'll ever have at
          // this precise instant. Deferring this to the finding's first recheck (which
          // does its own, later, independent DNS check) would miss it entirely for a
          // domain that goes non-resolving again before that first recheck runs -- exactly
          // the "briefly registered, then lapsed" case this field exists to capture.
          await tx.domainIntel.create({
            data: { findingId: finding.id, firstResolvedAt: new Date(), currentlyResolves: true },
          });
        });
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
  } catch (err: any) {
    await withTenant(organizationId, (tx) =>
      tx.pipelineRun.update({
        where: { id: runId },
        data: { status: "failed", error: String(err?.message ?? err), finishedAt: new Date() },
      })
    );
    throw err; // let pg-boss record the job failure too
  }
}
