import { describe, it, expect } from "vitest";
import { computeNextScanAt } from "./cadence";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("computeNextScanAt", () => {
  it("schedules a 20-minute recheck for a finding under 3 days old", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    const firstDetectedAt = new Date(now.getTime() - 1 * DAY_MS);
    const next = computeNextScanAt(firstDetectedAt, now);
    expect(next.getTime() - now.getTime()).toBe(20 * 60 * 1000);
  });

  it("backs off to a 2-hour recheck between 3 and 7 days old", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    const firstDetectedAt = new Date(now.getTime() - 4 * DAY_MS);
    const next = computeNextScanAt(firstDetectedAt, now);
    expect(next.getTime() - now.getTime()).toBe(2 * HOUR_MS);
  });

  it("backs off to a 24-hour recheck past 7 days old", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    const firstDetectedAt = new Date(now.getTime() - 30 * DAY_MS);
    const next = computeNextScanAt(firstDetectedAt, now);
    expect(next.getTime() - now.getTime()).toBe(DAY_MS);
  });

  it("keeps a dormant finding on the aggressive 20-minute cadence regardless of age", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    const firstDetectedAt = new Date(now.getTime() - 60 * DAY_MS);
    const next = computeNextScanAt(firstDetectedAt, now, true);
    expect(next.getTime() - now.getTime()).toBe(20 * 60 * 1000);
  });
});
