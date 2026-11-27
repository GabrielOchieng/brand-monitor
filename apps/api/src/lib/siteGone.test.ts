import { describe, expect, it } from "vitest";
import { siteGoneState } from "./siteGone";

const live = { statusCodes: ["clientTransferProhibited"], everResolved: true, resolvesNow: true, resolvedLastScan: true };

describe("siteGoneState", () => {
  it("is null for a domain that resolves and isn't on hold", () => {
    expect(siteGoneState(live)).toBeNull();
  });

  it("reads a registry hold as suspended on the first reading", () => {
    expect(siteGoneState({ ...live, statusCodes: ["clientHold"] })).toBe("suspended");
    expect(siteGoneState({ ...live, statusCodes: ["serverHold"], resolvesNow: false, resolvedLastScan: false })).toBe("suspended");
  });

  it("needs two failed lookups in a row before calling it unresolved", () => {
    expect(siteGoneState({ ...live, resolvesNow: false })).toBeNull();
    expect(siteGoneState({ ...live, resolvesNow: false, resolvedLastScan: null })).toBeNull();
    expect(siteGoneState({ ...live, resolvesNow: false, resolvedLastScan: false })).toBe("unresolved");
  });

  it("never calls a domain that never resolved gone", () => {
    expect(siteGoneState({ ...live, everResolved: false, resolvesNow: false, resolvedLastScan: false })).toBeNull();
  });
});
