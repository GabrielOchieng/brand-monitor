import { PgBoss } from "pg-boss";
import { env } from "../env";

// Connects via the restricted brandmonitor_app role (env.databaseAppUrl) -- safe only
// after `npm run queue:bootstrap` has created pg-boss's schema and granted this role
// access to it (see scripts/bootstrapQueue.ts). Started once in server.ts at boot.
export const boss = new PgBoss(env.databaseAppUrl);

export const QUEUE_DISCOVERY = "discovery";
export const QUEUE_RECHECK = "recheck";
export const QUEUE_DISPATCH_DISCOVERY = "dispatch-discovery";
export const QUEUE_DISPATCH_RECHECK = "dispatch-recheck";
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
  await boss.createQueue(QUEUE_DISPATCH_DISCOVERY);
  await boss.createQueue(QUEUE_DISPATCH_RECHECK);
  // Standard policy (no exclusivity needed): dedup for alerts happens at the
  // AlertDelivery-row level (see queue/alertDispatch.ts), not the job-queue level --
  // concurrent alert-dispatch jobs for different findings should run freely.
  await boss.createQueue(QUEUE_ALERT_DISPATCH, { retryLimit: 1 });
}
