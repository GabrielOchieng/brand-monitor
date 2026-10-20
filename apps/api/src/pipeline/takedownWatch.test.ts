import { describe, it, expect } from "vitest";
import { isDefinitelyDown, isLiveContent, nextTakedownWatch } from "./takedownWatch";

const live = { skipped: false, looksParked: false, httpStatus: 200 };
const now = new Date("2026-10-08T12:00:00Z");
const earlier = new Date("2026-09-10T14:30:00Z");

describe("isLiveContent / isDefinitelyDown", () => {
  it("treats a 404/410/451 page as down, not live", () => {
    for (const httpStatus of [404, 410, 451]) {
      const result = { ...live, httpStatus };
      expect(isLiveContent(result)).toBe(false);
      expect(isDefinitelyDown({ isDomainType: true, dnsExists: true, hasAddress: true, result })).toBe(true);
    }
  });

  it("does not count bot-protection or server errors as down", () => {
    for (const httpStatus of [403, 500, 503]) {
      expect(isDefinitelyDown({ isDomainType: true, dnsExists: true, hasAddress: true, result: { ...live, httpStatus } })).toBe(false);
    }
  });

  it("counts no DNS / no address / parked as down, but a failed scan as unknown", () => {
    expect(isDefinitelyDown({ isDomainType: true, dnsExists: false, hasAddress: false, result: null })).toBe(true);
    expect(isDefinitelyDown({ isDomainType: true, dnsExists: true, hasAddress: false, result: null })).toBe(true);
    expect(isDefinitelyDown({ isDomainType: true, dnsExists: true, hasAddress: true, result: { ...live, looksParked: true } })).toBe(true);
    expect(isDefinitelyDown({ isDomainType: true, dnsExists: true, hasAddress: true, result: { skipped: true, reason: "scan_failed" } })).toBe(false);
    expect(isDefinitelyDown({ isDomainType: false, dnsExists: false, hasAddress: false, result: { skipped: true, reason: "scan_failed" } })).toBe(false);
  });
});

describe("nextTakedownWatch", () => {
  const step = (state: { downSince: Date | null; downStreak: number }, obs: { definitelyDown?: boolean; live?: boolean }, at = now) =>
    nextTakedownWatch({ underWatch: true, ...state, definitelyDown: false, live: false, ...obs, now: at });

  it("does nothing for a finding that isn't resolved or taken down", () => {
    expect(nextTakedownWatch({ underWatch: false, downSince: null, downStreak: 1, definitelyDown: true, live: false, now })).toEqual({
      downSince: null,
      downStreak: 0,
      reactivated: false,
    });
  });

  it("confirms down after two down scans, holds through failed scans, then fires once when live again", () => {
    let state = step({ downSince: null, downStreak: 0 }, { definitelyDown: true }, earlier);
    expect(state).toEqual({ downSince: null, downStreak: 1, reactivated: false });

    // A failed scan (neither definitely down nor live) changes nothing, mid-streak or confirmed.
    state = step(state, {});
    expect(state).toEqual({ downSince: null, downStreak: 1, reactivated: false });

    state = step(state, { definitelyDown: true });
    expect(state).toEqual({ downSince: now, downStreak: 0, reactivated: false });

    state = step(state, {});
    expect(state).toEqual({ downSince: now, downStreak: 0, reactivated: false });

    state = step(state, { live: true });
    expect(state).toEqual({ downSince: null, downStreak: 0, reactivated: true });

    // Still live on the next scan: no second alert.
    state = step(state, { live: true });
    expect(state).toEqual({ downSince: null, downStreak: 0, reactivated: false });
  });

  it("does not fire when a live site has one misread parked scan", () => {
    let state = step({ downSince: null, downStreak: 0 }, { definitelyDown: true });
    state = step(state, { live: true });
    expect(state).toEqual({ downSince: null, downStreak: 0, reactivated: false });
  });

  it("never fires for a takedown marked complete while the site was still up", () => {
    expect(step({ downSince: null, downStreak: 0 }, { live: true }).reactivated).toBe(false);
  });
});
