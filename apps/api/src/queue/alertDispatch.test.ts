import { describe, it, expect } from "vitest";
import { ruleMatches, type AlertDispatchJobData } from "./alertDispatch";

const base: AlertDispatchJobData = {
  findingId: "f1",
  scanId: "s1",
  organizationId: "o1",
  previousScore: 20,
  previousSeverity: "low",
  newScore: 70,
  newSeverity: "high",
  isFirstScan: false,
  justActivated: true,
};

const rule = (kind: string, config: any = {}) => ({ kind, config });

describe("ruleMatches", () => {
  it("sends only site_reactivated for a reactivation, not the score or activation rules too", () => {
    const data = { ...base, reactivated: true };
    expect(ruleMatches(rule("site_reactivated"), data)).toBe(true);
    expect(ruleMatches(rule("website_activated"), data)).toBe(false);
    expect(ruleMatches(rule("severity_threshold", { minSeverity: "high" }), data)).toBe(false);
    expect(ruleMatches(rule("score_increase", { minDelta: 20 }), data)).toBe(false);
  });

  it("leaves the existing rules alone when nothing was reactivated", () => {
    expect(ruleMatches(rule("site_reactivated"), base)).toBe(false);
    expect(ruleMatches(rule("website_activated"), base)).toBe(true);
    expect(ruleMatches(rule("severity_threshold", { minSeverity: "high" }), base)).toBe(true);
  });

  it("fires registration_changed only when there are alert-worthy changes, never on a first scan", () => {
    expect(ruleMatches(rule("registration_changed"), base)).toBe(false);
    expect(ruleMatches(rule("registration_changed"), { ...base, registrationChanges: ["Nameservers: a → b"] })).toBe(true);
    expect(ruleMatches(rule("registration_changed"), { ...base, isFirstScan: true, registrationChanges: ["x"] })).toBe(false);
  });
});
