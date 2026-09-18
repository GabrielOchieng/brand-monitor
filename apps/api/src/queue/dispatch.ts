import { fromPrisma } from "pg-boss";
import { env } from "../env";
import { adminPrisma } from "../adminDb";
import { withTenant } from "../lib/tenant";
import {
  boss,
  QUEUE_DISCOVERY,
  QUEUE_RECHECK,
  QUEUE_CT_MONITOR,
  QUEUE_APP_STORE_MONITOR,
  QUEUE_DISPATCH_DISCOVERY,
  QUEUE_DISPATCH_RECHECK,
  QUEUE_DISPATCH_CT_MONITOR,
  QUEUE_DISPATCH_APP_STORE_MONITOR,
} from "./boss";
import { runDiscoveryJob, type DiscoveryJobData } from "../pipeline/discoveryJob";
import { runRecheckJob, type RecheckJobData } from "../pipeline/recheckJob";
import { runCtMonitorJob, type CtMonitorJobData } from "../pipeline/ctMonitorJob";
import { runAppStoreMonitorJob, type AppStoreMonitorJobData } from "../pipeline/appStoreMonitorJob";

// Deliberate, narrow RLS bypass -- same documented category as adminDb.ts's Clerk
// webhook sync. A "find everything due, across every org" query is inherently
// cross-tenant; no single request context could ever express it. Kept to exactly these
// two auditable, read-only, id-only selects -- never used to read/write tenant content.

async function listAllBrandsForDispatch(): Promise<Array<{ brandId: string; organizationId: string }>> {
  const brands = await adminPrisma.brand.findMany({ select: { id: true, organizationId: true } });
  return brands.map((b) => ({ brandId: b.id, organizationId: b.organizationId }));
}

async function listDueFindingsForDispatch(): Promise<Array<{ findingId: string; organizationId: string }>> {
  const findings = await adminPrisma.finding.findMany({
    where: {
      nextScanAt: { lte: new Date() },
      status: { notIn: ["false_positive", "resolved"] },
    },
    select: { id: true, brand: { select: { organizationId: true } } },
  });
  return findings.map((f) => ({ findingId: f.id, organizationId: f.brand.organizationId }));
}

// Enqueues one discovery job per brand, creating its PipelineRun row in the SAME
// transaction as the enqueue (via pg-boss's fromPrisma adapter) -- a crash between the
// two is impossible, unlike the manual-trigger route's necessarily-separate calls (see
// routes/pipeline.ts) which can't share a transaction with a request that arrives later.
async function dispatchDiscoveryForBrand(brandId: string, organizationId: string): Promise<void> {
  await withTenant(organizationId, async (tx) => {
    const run = await tx.pipelineRun.create({ data: { brandId, status: "running" } });
    const data: DiscoveryJobData = { runId: run.id, brandId, organizationId };
    await boss.send(QUEUE_DISCOVERY, data, { db: fromPrisma(tx), singletonKey: brandId });
  });
}

export async function registerQueueWorkers(): Promise<void> {
  await boss.work<DiscoveryJobData>(QUEUE_DISCOVERY, async ([job]) => {
    await runDiscoveryJob(job.data);
  });

  // localConcurrency caps how many recheck jobs run at once (per node) -- deliberately
  // small since WHOIS servers rate-limit aggressively per source IP, and many parallel
  // per-finding rechecks would otherwise hammer them. Also the only concurrency knob that
  // triggers Chromium launches (via scanWebsite in each recheck job) -- see env.ts.
  await boss.work<RecheckJobData>(QUEUE_RECHECK, { localConcurrency: env.recheckConcurrency }, async ([job]) => {
    await runRecheckJob(job.data);
  });

  await boss.work(QUEUE_DISPATCH_DISCOVERY, async () => {
    const brands = await listAllBrandsForDispatch();
    for (const { brandId, organizationId } of brands) {
      await dispatchDiscoveryForBrand(brandId, organizationId);
    }
  });

  await boss.work(QUEUE_DISPATCH_RECHECK, async () => {
    const findings = await listDueFindingsForDispatch();
    for (const { findingId, organizationId } of findings) {
      const data: RecheckJobData = { findingId, organizationId, triggeredBy: "scheduled" };
      await boss.send(QUEUE_RECHECK, data, { singletonKey: findingId });
    }
  });

  await boss.work<CtMonitorJobData>(QUEUE_CT_MONITOR, async ([job]) => {
    await runCtMonitorJob(job.data);
  });

  // No PipelineRun-equivalent tracking row to make atomic with the enqueue (unlike
  // dispatchDiscoveryForBrand) -- a plain inline loop, same shape as the recheck
  // dispatcher above.
  await boss.work(QUEUE_DISPATCH_CT_MONITOR, async () => {
    const brands = await listAllBrandsForDispatch();
    for (const { brandId, organizationId } of brands) {
      const data: CtMonitorJobData = { brandId, organizationId };
      await boss.send(QUEUE_CT_MONITOR, data, { singletonKey: brandId });
    }
  });

  await boss.work<AppStoreMonitorJobData>(QUEUE_APP_STORE_MONITOR, async ([job]) => {
    await runAppStoreMonitorJob(job.data);
  });

  await boss.work(QUEUE_DISPATCH_APP_STORE_MONITOR, async () => {
    const brands = await listAllBrandsForDispatch();
    for (const { brandId, organizationId } of brands) {
      const data: AppStoreMonitorJobData = { brandId, organizationId };
      await boss.send(QUEUE_APP_STORE_MONITOR, data, { singletonKey: brandId });
    }
  });
}

export async function scheduleDispatchers(): Promise<void> {
  await boss.schedule(QUEUE_DISPATCH_DISCOVERY, "0 */4 * * *");
  await boss.schedule(QUEUE_DISPATCH_RECHECK, "*/5 * * * *");
  // Every 30 min, deliberately conservative -- crt.sh documents no formal rate limit, but
  // it's a free, shared, community-run service; nothing requires hammering it either.
  await boss.schedule(QUEUE_DISPATCH_CT_MONITOR, "*/30 * * * *");
  // Every 4h, matching discovery's own cadence -- app store listings change far more
  // slowly than DNS registrations (Apple's review process alone takes time), so a faster
  // cadence has no real freshness benefit. Well within the ~20 req/min iTunes rate limit
  // either way.
  await boss.schedule(QUEUE_DISPATCH_APP_STORE_MONITOR, "0 */4 * * *");
}

export { dispatchDiscoveryForBrand };
