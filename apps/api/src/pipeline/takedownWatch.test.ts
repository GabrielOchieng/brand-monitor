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
  it("does nothing for a finding that isn't resolved or taken down", () => {
    expect(nextTakedownWatch({ underWatch: false, downSince: null, definitelyDown: true, live: false, now })).toEqual({ downSince: null, reactivated: false });
  });

  it("confirms down, holds through failed scans, then fires once when live again", () => {
    let state = nextTakedownWatch({ underWatch: true, downSince: null, definitelyDown: true, live: false, now: earlier });
    expect(state).toEqual({ downSince: earlier, reactivated: false });

    // A failed scan (neither definitely down nor live) changes nothing.
    state = nextTakedownWatch({ underWatch: true, downSince: state.downSince, definitelyDown: false, live: false, now });
    expect(state).toEqual({ downSince: earlier, reactivated: false });

    state = nextTakedownWatch({ underWatch: true, downSince: state.downSince, definitelyDown: false, live: true, now });
    expect(state).toEqual({ downSince: null, reactivated: true });

    // Still live on the next scan: no second alert.
    state = nextTakedownWatch({ underWatch: true, downSince: state.downSince, definitelyDown: false, live: true, now });
    expect(state).toEqual({ downSince: null, reactivated: false });
  });

  it("never fires for a takedown marked complete while the site was still up", () => {
    const state = nextTakedownWatch({ underWatch: true, downSince: null, definitelyDown: false, live: true, now });
    expect(state.reactivated).toBe(false);
  });
});
