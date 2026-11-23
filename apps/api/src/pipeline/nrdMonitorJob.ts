import { listMonitoredBrands } from "../lib/monitoredBrands";
import { withTenant } from "../lib/tenant";
import { fetchNrdList } from "../lib/nrdFeed";
import { fetchHageziNrd } from "../lib/hageziNrd";
import { fetchIscRecentDomains } from "../lib/iscRecentDomains";
import { checkDnsExistence } from "../lib/dnsCheck";
import { markSourceSuccess } from "../queue/health";
import { typoVariants } from "./permutations";

// Third domain source, alongside discoveryJob.ts (guess names, DNS-check them) and
// ctMonitorJob.ts (read CT logs). Added after flyjambojetkenya.store went undetected:
// no guessing pattern produced it and crt.sh (the old CT source) was down.
//
// One download serves every brand, so this is a single global job, not a per-brand
// fan-out like the others.

const DAYS_BACK = 4; // the feed only keeps ~4 days

// In-memory: a restart re-downloads at most DAYS_BACK files (~2 MB), and findings are
// deduplicated by the (brandId, identifier) unique key anyway -- not worth a table.
const processedDates = new Set<string>();

// hagezi rebuilds its 7-day list at 08:00 UTC; downloading ~48 MB once a day after that is
// enough. In-memory like processedDates: a restart costs one extra download at most.
const HAGEZI_READY_HOUR_UTC = 9;
let hageziProcessedDate: string | null = null;

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
  // Paused brands (platform admin) are skipped -- lib/monitoredBrands.ts.
  const brands = await listMonitoredBrands();

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
      const ctx = await loadBrandMatch(brandId, organizationId);
      await createFindings(ctx, result.domains.filter(ctx.keep), "nrd");
    }
    processedDates.add(date);
    // A new file every day keeps this fresh; if whoisds stops publishing, nrd goes stale
    // on /health/jobs after 48h.
    markSourceSuccess("nrd");
  }

  await runHagezi(brands, now);
  await runIsc(brands);
}

// Third feed (lib/iscRecentDomains.ts): ~3 MB, so it is simply re-read every run (every 6h)
// rather than tracked by date; already-known domains are skipped by createFindings.
async function runIsc(brands: { id: string; organizationId: string }[]): Promise<void> {
  if (brands.length === 0) return;
  const contexts = await Promise.all(brands.map((b) => loadBrandMatch(b.id, b.organizationId)));
  const result = await fetchIscRecentDomains((d) => contexts.some((c) => c.keep(d)));
  if (result.status === "error") {
    console.warn(`[nrd-isc] download failed: ${result.error}`);
    return;
  }
  for (const ctx of contexts) {
    await createFindings(ctx, result.matched.filter(ctx.keep), "isc_recent");
  }
  console.log(`[nrd-isc] scanned ${result.total} domains first seen ${result.firstSeen}, ${result.matched.length} matched a brand`);
  markSourceSuccess("isc_recent");
}

// Second, larger feed (lib/hageziNrd.ts). One streamed pass checks every brand at once.
async function runHagezi(brands: { id: string; organizationId: string }[], now: Date): Promise<void> {
  const today = utcDate(0, now);
  if (hageziProcessedDate === today || now.getUTCHours() < HAGEZI_READY_HOUR_UTC || brands.length === 0) return;

  const contexts = await Promise.all(brands.map((b) => loadBrandMatch(b.id, b.organizationId)));
  const result = await fetchHageziNrd((d) => contexts.some((c) => c.keep(d)));
  if (result.status === "error") {
    console.warn(`[nrd-hagezi] download failed: ${result.error}`);
    return;
  }
  for (const ctx of contexts) {
    await createFindings(ctx, result.matched.filter(ctx.keep), "nrd_hagezi");
  }
  hageziProcessedDate = today;
  console.log(`[nrd-hagezi] scanned ${result.lines} domains, ${result.matched.length} matched a brand`);
  markSourceSuccess("nrd_hagezi");
}

export type BrandMatch = { brandId: string; organizationId: string; keep: (domain: string) => boolean };

export async function loadBrandMatch(brandId: string, organizationId: string): Promise<BrandMatch> {
  const brand = await withTenant(organizationId, (tx) =>
    tx.brand.findUniqueOrThrow({ where: { id: brandId }, include: { domains: true } })
  );
  const brandRoot = brand.primaryDomain.split(".")[0].toLowerCase();
  const ownDomains = [brand.primaryDomain.toLowerCase(), ...brand.domains.map((d) => d.domain.toLowerCase())];
  const isOwn = (d: string) => ownDomains.some((o) => d === o || d.endsWith(`.${o}`));
  const matches = brandMatcher(brandRoot);
  return { brandId, organizationId, keep: (d) => matches(d) && !isOwn(d) };
}

export async function createFindings({ brandId, organizationId }: BrandMatch, domains: string[], source: string): Promise<void> {
  for (const domain of domains) {
    await withTenant(organizationId, async (tx) => {
      const existing = await tx.finding.findUnique({ where: { brandId_identifier: { brandId, identifier: domain } } });
      if (existing) return;

      // Created regardless of DNS, like ctMonitorJob.ts: a fresh registration is signal in
      // itself, and the dormant-recheck cadence picks it up once it starts resolving.
      const finding = await tx.finding.create({
        data: { brandId, identifier: domain, type: "domain", source, riskScore: 0, severity: "low", nextScanAt: new Date() },
      });
      const dns = await checkDnsExistence(domain);
      if (dns.exists) {
        await tx.domainIntel.create({ data: { findingId: finding.id, firstResolvedAt: new Date(), currentlyResolves: true } });
      }
    });
  }
}
