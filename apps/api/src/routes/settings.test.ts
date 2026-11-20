import { describe, it, expect } from "vitest";
import { DomainSchema } from "./brands";
import { normalizeRuleUpdate } from "./alertRules";
import { webhookUrlError } from "./webhookConfig";

describe("brand domain", () => {
  it("trims a pasted URL down to the bare domain", () => {
    expect(DomainSchema.parse("https://www.Jambojet.com/en/booking?x=1")).toBe("jambojet.com");
    expect(DomainSchema.parse(" jambojet.co.ke. ")).toBe("jambojet.co.ke");
  });

  it("rejects things that aren't domains", () => {
    for (const bad of ["jambojet", "jambo jet.com", "http://", "-jambo.com", "a.b"]) {
      expect(DomainSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("alert rule updates", () => {
  it("keeps only the channels and threshold the kind supports", () => {
    expect(normalizeRuleUpdate("public_report", { enabled: true, channels: ["email", "in_app", "webhook"], config: { minSeverity: "low" } })).toEqual({
      enabled: true,
      channels: ["in_app"],
      config: {},
    });
    expect(normalizeRuleUpdate("severity_threshold", { enabled: true, channels: ["email", "email"], config: { minSeverity: "critical", minDelta: 50 } })).toEqual({
      enabled: true,
      channels: ["email"],
      config: { minSeverity: "critical" },
    });
    expect(normalizeRuleUpdate("score_increase", { enabled: false, channels: [], config: {} })).toEqual({ enabled: false, channels: [], config: { minDelta: 20 } });
  });
});

describe("webhook URL", () => {
  it("accepts public HTTPS endpoints only", () => {
    expect(webhookUrlError("https://hooks.slack.com/services/T/B/X")).toBeNull();
    expect(webhookUrlError("http://hooks.example.com/x")).toBe("webhook_https_only");
    expect(webhookUrlError("https://localhost:4000/x")).toBe("target_not_allowed");
    expect(webhookUrlError("https://192.168.1.10/x")).toBe("target_not_allowed");
  });
});
