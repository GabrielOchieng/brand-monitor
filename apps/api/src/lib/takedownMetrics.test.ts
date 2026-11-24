import { describe, it, expect } from "vitest";
import { computeMetrics, type MetricsRow } from "./takedownMetrics";

const t0 = new Date("2026-11-01T00:00:00Z");
const at = (h: number) => new Date(t0.getTime() + h * 3600_000);
const row = (p: Partial<MetricsRow>): MetricsRow => ({ channel: "registrar", provider: "Name.com, Inc.", sentAt: t0, firstReplyAt: null, acknowledged: false, completedAt: null, rejected: false, ...p });

describe("computeMetrics", () => {
  it("counts outcomes and takes medians per group", () => {
    const m = computeMetrics([
      row({ firstReplyAt: at(2), acknowledged: true, completedAt: at(24) }),
      row({ firstReplyAt: at(6), acknowledged: true, completedAt: at(48) }),
      row({ rejected: true }),
      row({ provider: "GoDaddy.com, LLC", firstReplyAt: at(1), acknowledged: true }),
      row({ channel: "host", provider: "Cloudflare, Inc.", completedAt: at(10) }),
    ]);
    expect(m.total).toMatchObject({ sent: 5, acknowledged: 3, completed: 3, rejected: 1, medianHoursToReply: 2, medianHoursToTakedown: 24 });
    expect(m.byChannel.map((b) => [b.key, b.sent])).toEqual([["registrar", 4], ["host", 1]]);
    expect(m.byRegistrar[0]).toMatchObject({ key: "Name.com, Inc.", sent: 3, completed: 2, medianHoursToReply: 4, medianHoursToTakedown: 36 });
    expect(m.byHost).toEqual([expect.objectContaining({ key: "Cloudflare, Inc.", completed: 1, medianHoursToTakedown: 10, medianHoursToReply: null })]);
  });

  it("is empty-safe", () => {
    expect(computeMetrics([]).total).toEqual({ key: "all", sent: 0, acknowledged: 0, completed: 0, rejected: 0, medianHoursToReply: null, medianHoursToTakedown: null });
  });
});
