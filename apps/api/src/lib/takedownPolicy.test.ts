import { describe, it, expect } from "vitest";
import { evaluatePolicy, initialStatus, sendAfterFor, type PolicyFinding } from "./takedownPolicy";

const now = new Date("2026-11-28T12:00:00Z");
const policy = { minSeverity: "critical", signals: ["login_form", "payment_form", "shared_indicator", "scam_pattern"] };
const base: PolicyFinding = {
  type: "domain",
  status: "new",
  severity: "critical",
  domain: "jambojet-login.com",
  liveStreak: 2,
  downSince: null,
  ruleCodes: ["DOMAIN_SIMILARITY_HIGH", "LOGIN_FORM_DETECTED"],
  screenshotAt: new Date("2026-11-28T09:00:00Z"),
};
const own = ["jambojet.com"];

describe("evaluatePolicy", () => {
  it("qualifies a live critical site with a login form", () => {
    expect(evaluatePolicy(base, policy, own, now)).toEqual({ qualifies: true, via: "signals", signals: ["login_form"] });
  });

  it("never qualifies social findings, dismissed findings or own domains", () => {
    expect(evaluatePolicy({ ...base, type: "social" }, policy, own, now).qualifies).toBe(false);
    expect(evaluatePolicy({ ...base, status: "false_positive" }, policy, own, now).qualifies).toBe(false);
    expect(evaluatePolicy({ ...base, status: "resolved" }, policy, own, now).qualifies).toBe(false);
    expect(evaluatePolicy({ ...base, domain: "book.jambojet.com" }, policy, own, now).qualifies).toBe(false);
  });

  it("waits for two live scans in a row and a fresh screenshot", () => {
    expect(evaluatePolicy({ ...base, liveStreak: 1 }, policy, own, now)).toMatchObject({ qualifies: false });
    expect(evaluatePolicy({ ...base, downSince: now }, policy, own, now)).toMatchObject({ qualifies: false });
    expect(evaluatePolicy({ ...base, screenshotAt: new Date("2026-11-27T11:00:00Z") }, policy, own, now)).toMatchObject({ qualifies: false });
    expect(evaluatePolicy({ ...base, screenshotAt: null }, policy, own, now)).toMatchObject({ qualifies: false });
  });

  it("needs the severity and a fraud signal, unless an analyst confirmed it", () => {
    expect(evaluatePolicy({ ...base, severity: "high" }, policy, own, now)).toMatchObject({ qualifies: false });
    expect(evaluatePolicy({ ...base, ruleCodes: ["DOMAIN_SIMILARITY_HIGH"] }, policy, own, now)).toMatchObject({ qualifies: false });
    // A lookalike name alone isn't enough (registrars act on fraud, not trademark).
    expect(evaluatePolicy({ ...base, severity: "medium", ruleCodes: [], status: "confirmed" }, policy, own, now)).toEqual({ qualifies: true, via: "confirmed", signals: [] });
    expect(evaluatePolicy({ ...base, severity: "high" }, { ...policy, minSeverity: "high" }, own, now).qualifies).toBe(true);
  });

  it("only counts the signals the org picked", () => {
    const visualOnly = { ...base, ruleCodes: ["VISUAL_SIMILARITY_MATCH"] };
    expect(evaluatePolicy(visualOnly, policy, own, now).qualifies).toBe(false);
    expect(evaluatePolicy(visualOnly, { ...policy, signals: ["visual_match"] }, own, now)).toMatchObject({ qualifies: true, signals: ["visual_match"] });
  });
});

describe("sending schedule", () => {
  const s = { vetoHours: 6, confirmedSkipsVeto: true };
  it("waits out the veto window in delayed mode, unless confirmed", () => {
    expect(sendAfterFor("delayed", false, s, now)).toEqual(new Date("2026-11-28T18:00:00Z"));
    expect(sendAfterFor("delayed", true, s, now)).toEqual(now);
    expect(sendAfterFor("delayed", true, { ...s, confirmedSkipsVeto: false }, now)).toEqual(new Date("2026-11-28T18:00:00Z"));
    expect(sendAfterFor("automatic", false, s, now)).toEqual(now);
    expect(sendAfterFor("approval", false, s, now)).toBeNull();
  });

  it("starts every report in shadow mode as shadow, and form-only ones as manual tasks", () => {
    expect(initialStatus("shadow", "automatic", "email")).toBe("shadow");
    expect(initialStatus("live", "automatic", "form")).toBe("manual");
    expect(initialStatus("live", "approval", "email")).toBe("awaiting_approval");
    expect(initialStatus("redirect", "delayed", "email")).toBe("pending_veto");
    expect(initialStatus("live", "automatic", "email")).toBe("queued");
  });
});
