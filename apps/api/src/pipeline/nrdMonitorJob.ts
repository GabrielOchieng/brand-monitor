import { adminPrisma } from "../adminDb";
import { withTenant } from "../lib/tenant";
import { fetchNrdList } from "../lib/nrdFeed";
import { checkDnsExistence } from "../lib/dnsCheck";
import { markSourceSuccess } from "../queue/health";
import { typoVariants } from "./permutations";

// Third domain source, alongside discoveryJob.ts (guess names, DNS-check them) and
// ctMonitorJob.ts (search CT logs). Added after flyjambojetkenya.store went undetected:
// no guessing pattern produced it and crt.sh was down. A registration feed needs neither.
//
// One download serves every brand, so this is a single global job, not a per-brand
// fan-out like the others.

const DAYS_BACK = 4; // the feed only keeps ~4 days

// In-memory: a restart re-downloads at most DAYS_BACK files (~2 MB), and findings are
// deduplicated by the (brandId, identifier) unique key anyway -- not worth a table.
const processedDates = new Set<string>();

// Variants shorter than this match too much unrelated text ("jambo" alone hits
// "jamboreekindy.com.au"); the exact brand root is always matched regardless.
const MIN_VARIANT_LENGTH = 6;

export function brandMatcher(brandRoot: string): (domain: string) => boolean {
  const needles = [brandRoot, ...typoVariants(brandRoot).filter((v) => v.length >= MIN_VARIANT_LENGTH)];
  return (domain) => needles.some((n) => domain.includes(n));
}

function utcDate(daysAgo: number, now: Date): string {
  return new Date(now.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);
}

export async function runNrdMonitorJob(now: Date = new Date()): Promise<void> {
  // Cross-tenant by nature (one feed, every brand) -- id-only select, same narrow RLS
  // bypass as queue/dispatch.ts's listAllBrandsForDispatch. Brand content is then read
  // and written per tenant through withTenant.
  const brands = await adminPrisma.brand.findMany({ select: { id: true, organizationId: true } });

  for (let daysAgo = 1; daysAgo <= DAYS_BACK; daysAgo++) {
    const date = utcDate(daysAgo, now);
    if (processedDates.has(date)) continue;

    const result = await fetchNrdList(date);
    if (result.status === "unavailable") continue; // not published yet -- next run retries
    if (result.status === "error") {
      console.warn(`[nrd] download for ${date} failed: ${result.error}`);
      continue;
    }

    for (const { id: brandId, organizationId } of brands) {
      await matchBrand(brandId, organizationId, result.domains);
    }
    processedDates.add(date);
    // A new file every day keeps this fresh; if whoisds stops publishing, nrd goes stale
    // on /health/jobs after 48h.
    markSourceSuccess("nrd");
  }
}

async function matchBrand(brandId: string, organizationId: string, domains: string[]): Promise<void> {
  const brand = await withTenant(organizationId, (tx) =>
    tx.brand.findUniqueOrThrow({ where: { id: brandId }, include: { domains: true } })
  );
  const brandRoot = brand.primaryDomain.split(".")[0].toLowerCase();
  const ownDomains = [brand.primaryDomain.toLowerCase(), ...brand.domains.map((d) => d.domain.toLowerCase())];
  const isOwn = (d: string) => ownDomains.some((o) => d === o || d.endsWith(`.${o}`));
  const matches = brandMatcher(brandRoot);

  for (const domain of domains) {
    if (!matches(domain) || isOwn(domain)) continue;

    await withTenant(organizationId, async (tx) => {
      const existing = await tx.finding.findUnique({ where: { brandId_identifier: { brandId, identifier: domain } } });
      if (existing) return;

      // Created regardless of DNS, like ctMonitorJob.ts: a fresh registration is signal in
      // itself, and the dormant-recheck cadence picks it up once it starts resolving.
      const finding = await tx.finding.create({
        data: { brandId, identifier: domain, type: "domain", source: "nrd", riskScore: 0, severity: "low", nextScanAt: new Date() },
      });
      const dns = await checkDnsExistence(domain);
      if (dns.exists) {
        await tx.domainIntel.create({ data: { findingId: finding.id, firstResolvedAt: new Date(), currentlyResolves: true } });
      }
    });
  }
}
