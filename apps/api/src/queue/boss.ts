import { PgBoss } from "pg-boss";
import { env } from "../env";

// Connects via the restricted brandmonitor_app role (env.databaseAppUrl) -- safe only
// after `npm run queue:bootstrap` has created pg-boss's schema and granted this role
// access to it (see scripts/bootstrapQueue.ts). Started once in server.ts at boot.
//
// Every interval here is slowed down from pg-boss's defaults to save bandwidth, not CPU:
// each poll is a round-trip to Neon over the public internet, and Render's free workspace
// gets only 5 GB/month of outbound traffic, then suspends every service until the 1st
// (that's what stopped production Sept 25 -> Oct 6). Measured through a byte-counting
// proxy with this app's 9 queues idle: defaults sent ~400 MB/day to Postgres (the whole
// budget is ~165 MB/day); these settings send ~30 MB/day. None of our jobs need
// sub-minute pickup -- the fastest schedule is every 5 minutes.
//
// cronMonitorIntervalSeconds is deliberately LEFT at its default (30s): pg-boss only
// treats a cron tick as due within 60s of it, and the monitor's DB-side throttle
// rejects a timer that fires a few ms early, so 45s in practice means a check every
// ~90s -- verified to silently skip every scheduled job. Don't raise it.
export const boss = new PgBoss({
  connectionString: env.databaseAppUrl,
  cronWorkerIntervalSeconds: 30,
  flowIntervalSeconds: 300,
  superviseIntervalSeconds: 300,
  monitorIntervalSeconds: 300,
  queueCacheIntervalSeconds: 300,
  bamIntervalSeconds: 300,
});

// Passed to every boss.work() call -- see the bandwidth note above. The default (2s)
// is per worker, and localConcurrency multiplies it (one poller per concurrent slot).
export const WORKER_POLLING = { pollingIntervalSeconds: 60 } as const;

export const QUEUE_DISCOVERY = "discovery";
export const QUEUE_RECHECK = "recheck";
export const QUEUE_CT_MONITOR = "ct-monitor";
export const QUEUE_APP_STORE_MONITOR = "app-store-monitor";
export const QUEUE_DISPATCH_DISCOVERY = "dispatch-discovery";
export const QUEUE_DISPATCH_RECHECK = "dispatch-recheck";
export const QUEUE_DISPATCH_CT_MONITOR = "dispatch-ct-monitor";
export const QUEUE_DISPATCH_APP_STORE_MONITOR = "dispatch-app-store-monitor";
export const QUEUE_ALERT_DISPATCH = "alert-dispatch";

// Queues must exist (createQueue) before send()/work() -- this is idempotent, safe to
// call every boot.
//
// policy: "exclusive" is what actually enforces the "only one outstanding job per
// brand/finding" dedup -- passing `singletonKey` on send() does nothing by itself on
// pg-boss's default "standard" queue policy (verified directly: two sends with the same
// singletonKey against a standard-policy queue both succeeded with distinct job ids).
// "exclusive" + singletonKey allows at most one job (queued OR active) per key at a
// time, which is exactly "don't double-run a discovery pass for the same brand, or a
// recheck for the same finding, while one is already outstanding."
// A queue's policy can't be changed after creation (updateQueue's options type
// explicitly excludes `policy`) -- if an earlier boot already created one of these with
// the wrong policy, delete and recreate it rather than silently keeping the stale,
// non-deduping "standard" default forever.
async function ensureExclusiveQueue(name: string, options: Omit<Parameters<typeof boss.createQueue>[1] & {}, "policy">) {
  const existing = await boss.getQueue(name);
  if (existing && existing.policy !== "exclusive") {
    await boss.deleteQueue(name);
  }
  await boss.createQueue(name, { ...options, policy: "exclusive" });
}

export async function ensureQueues(): Promise<void> {
  await ensureExclusiveQueue(QUEUE_DISCOVERY, { retryLimit: 1 });
  await ensureExclusiveQueue(QUEUE_RECHECK, { expireInSeconds: 300, retryLimit: 1 });
  await ensureExclusiveQueue(QUEUE_CT_MONITOR, { retryLimit: 1 });
  await ensureExclusiveQueue(QUEUE_APP_STORE_MONITOR, { retryLimit: 1 });
  await boss.createQueue(QUEUE_DISPATCH_DISCOVERY);
  await boss.createQueue(QUEUE_DISPATCH_RECHECK);
  await boss.createQueue(QUEUE_DISPATCH_CT_MONITOR);
  await boss.createQueue(QUEUE_DISPATCH_APP_STORE_MONITOR);
  // Standard policy (no exclusivity needed): dedup for alerts happens at the
  // AlertDelivery-row level (see queue/alertDispatch.ts), not the job-queue level --
  // concurrent alert-dispatch jobs for different findings should run freely.
  await boss.createQueue(QUEUE_ALERT_DISPATCH, { retryLimit: 1 });
}
