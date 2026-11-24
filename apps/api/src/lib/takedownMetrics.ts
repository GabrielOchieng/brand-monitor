// Takedown results (TAKEDOWN_AUTOMATION_PLAN.md §14 step 7): how reports fared, per channel and per
// registrar / host, from the org's own data only -- reports actually sent to real recipients (not
// redirected test deliveries), their replies, and whether the takedown was completed. Pure.

export interface MetricsRow {
  channel: string;
  // Who it went to: the registrar name (registrar channel), the hosting org (host), else the address.
  provider: string;
  sentAt: Date;
  firstReplyAt: Date | null;
  acknowledged: boolean; // a reply came, or the tracker says acknowledged/completed
  completedAt: Date | null; // the tracker row was completed (site taken down)
  rejected: boolean;
}

export interface Bucket {
  key: string;
  sent: number;
  acknowledged: number;
  completed: number;
  rejected: number;
  // Medians in hours; null when nothing to measure.
  medianHoursToReply: number | null;
  medianHoursToTakedown: number | null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return Math.round(v * 10) / 10;
}

const hours = (from: Date, to: Date) => Math.max(0, (to.getTime() - from.getTime()) / 3600_000);

function bucket(key: string, rows: MetricsRow[]): Bucket {
  return {
    key,
    sent: rows.length,
    acknowledged: rows.filter((r) => r.acknowledged).length,
    completed: rows.filter((r) => r.completedAt).length,
    rejected: rows.filter((r) => r.rejected).length,
    medianHoursToReply: median(rows.filter((r) => r.firstReplyAt).map((r) => hours(r.sentAt, r.firstReplyAt!))),
    medianHoursToTakedown: median(rows.filter((r) => r.completedAt).map((r) => hours(r.sentAt, r.completedAt!))),
  };
}

function groupBy(rows: MetricsRow[], key: (r: MetricsRow) => string): Bucket[] {
  const groups = new Map<string, MetricsRow[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  return [...groups.entries()].map(([k, rs]) => bucket(k, rs)).sort((a, b) => b.sent - a.sent || a.key.localeCompare(b.key));
}

export function computeMetrics(rows: MetricsRow[]) {
  return {
    total: bucket("all", rows),
    byChannel: groupBy(rows, (r) => r.channel),
    byRegistrar: groupBy(rows.filter((r) => r.channel === "registrar"), (r) => r.provider),
    byHost: groupBy(rows.filter((r) => r.channel === "host"), (r) => r.provider),
  };
}
