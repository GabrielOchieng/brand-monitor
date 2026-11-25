import { describe, expect, it } from "vitest";
import { medianDays, perDay, topReason, webState } from "./findingView";

const intel = (looksParked: boolean, httpStatus: number | null) => ({ looksParked, httpStatus });

describe("webState", () => {
  it("is null for social accounts and unscanned findings", () => {
    expect(webState({ type: "social", downSince: null, websiteIntel: intel(false, 200) })).toBeNull();
    expect(webState({ type: "domain", downSince: null, websiteIntel: null })).toBeNull();
  });

  it("is offline once confirmed down, whatever the last intel says", () => {
    expect(webState({ type: "domain", downSince: new Date(), websiteIntel: intel(false, 200) })).toBe("offline");
  });

  it("treats takedown statuses and server errors as offline", () => {
    for (const s of [404, 410, 451, 503]) expect(webState({ type: "domain", downSince: null, websiteIntel: intel(false, s) })).toBe("offline");
  });

  it("tells parked from live", () => {
    expect(webState({ type: "domain", downSince: null, websiteIntel: intel(true, 200) })).toBe("parked");
    expect(webState({ type: "url", downSince: null, websiteIntel: intel(false, 200) })).toBe("live");
    expect(webState({ type: "domain", downSince: null, websiteIntel: intel(false, null) })).toBe("live");
  });
});

describe("topReason", () => {
  it("picks the largest positive contribution", () => {
    expect(topReason([{ delta: 10, reason: "a" }, { delta: 35, reason: "b" }, { delta: -5, reason: "c" }])).toBe("b");
  });
  it("is null with no positive events", () => {
    expect(topReason([])).toBeNull();
    expect(topReason([{ delta: -5, reason: "c" }])).toBeNull();
  });
});

describe("perDay", () => {
  const now = new Date("2026-11-25T10:00:00Z");
  it("buckets by UTC day, today last, and ignores older dates", () => {
    const r = perDay([new Date("2026-11-25T01:00:00Z"), new Date("2026-11-24T23:59:00Z"), new Date("2026-11-24T00:00:00Z"), new Date("2026-11-01T00:00:00Z")], now, 3);
    expect(r).toEqual([0, 2, 1]);
  });
});

describe("medianDays", () => {
  const d = (s: string) => new Date(s);
  it("returns the median in days, one decimal", () => {
    expect(medianDays([{ requestedAt: d("2026-11-01"), resolvedAt: d("2026-11-02") }, { requestedAt: d("2026-11-01"), resolvedAt: d("2026-11-05") }])).toBe(2.5);
    expect(medianDays([{ requestedAt: d("2026-11-01"), resolvedAt: d("2026-11-03T12:00:00Z") }])).toBe(2.5);
  });
  it("is null with nothing resolved", () => {
    expect(medianDays([])).toBeNull();
  });
});
