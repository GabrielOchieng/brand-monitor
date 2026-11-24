import { describe, it, expect } from "vitest";
import { authorizationInForce, automationBlockers, ENABLE_REQUIRES, type AutomationState } from "./takedownAutomation";

const now = new Date("2026-11-25T12:00:00Z");
const day = 24 * 3600_000;

function ready(): AutomationState {
  return {
    platformEnabled: true,
    org: { autoTakedownAllowedAt: new Date(now.getTime() - day), monitoringPausedAt: null },
    automation: { enabledAt: new Date(now.getTime() - day), stoppedAt: null },
    sender: { lastTestOk: true },
    authorizations: [{ brandId: null, validFrom: new Date(now.getTime() - day), expiresAt: new Date(now.getTime() + 300 * day), revokedAt: null }],
  };
}

const brand = { id: "b1", autoTakedownEnabled: true, monitoringPausedAt: null };

describe("automationBlockers", () => {
  it("has none when every switch is on", () => {
    expect(automationBlockers(ready(), null, now)).toEqual([]);
    expect(automationBlockers(ready(), brand, now)).toEqual([]);
  });

  it("lists everything missing for a fresh org", () => {
    const fresh: AutomationState = {
      platformEnabled: false,
      org: { autoTakedownAllowedAt: null, monitoringPausedAt: null },
      automation: null,
      sender: null,
      authorizations: [],
    };
    expect(automationBlockers(fresh, null, now)).toEqual(["platform_disabled", "not_allowed", "no_sender", "no_authorization", "not_enabled"]);
  });

  it("needs a passed test of the sender's current settings", () => {
    expect(automationBlockers({ ...ready(), sender: { lastTestOk: null } }, null, now)).toEqual(["sender_untested"]);
    expect(automationBlockers({ ...ready(), sender: { lastTestOk: false } }, null, now)).toEqual(["sender_untested"]);
  });

  it("stops on the emergency stop, a pause or the brand switch", () => {
    expect(automationBlockers({ ...ready(), automation: { enabledAt: now, stoppedAt: now } }, null, now)).toEqual(["stopped"]);
    expect(automationBlockers({ ...ready(), org: { autoTakedownAllowedAt: now, monitoringPausedAt: now } }, brand, now)).toEqual(["monitoring_paused"]);
    expect(automationBlockers(ready(), { ...brand, monitoringPausedAt: now }, now)).toEqual(["monitoring_paused"]);
    expect(automationBlockers(ready(), { ...brand, autoTakedownEnabled: false }, now)).toEqual(["brand_off"]);
  });

  it("only counts an authorization that covers the brand", () => {
    const other: AutomationState = { ...ready(), authorizations: [{ ...ready().authorizations[0], brandId: "b2" }] };
    expect(automationBlockers(other, null, now)).toEqual([]); // the org has one in force for some brand
    expect(automationBlockers(other, brand, now)).toEqual(["no_authorization"]);
  });

  it("enabling needs only the setup steps", () => {
    expect(ENABLE_REQUIRES).toEqual(["not_allowed", "no_sender", "sender_untested", "no_authorization"]);
  });
});

describe("authorizationInForce", () => {
  const base = { brandId: null, validFrom: new Date(now.getTime() - day), expiresAt: null, revokedAt: null };
  it("is in force with no expiry", () => expect(authorizationInForce(base, null, now)).toBe(true));
  it("isn't once revoked", () => expect(authorizationInForce({ ...base, revokedAt: now }, null, now)).toBe(false));
  it("isn't before it starts", () => expect(authorizationInForce({ ...base, validFrom: new Date(now.getTime() + 1) }, null, now)).toBe(false));
  it("isn't at or after expiry", () => {
    expect(authorizationInForce({ ...base, expiresAt: now }, null, now)).toBe(false);
    expect(authorizationInForce({ ...base, expiresAt: new Date(now.getTime() + 1) }, null, now)).toBe(true);
  });
  it("an all-brands one covers every brand", () => expect(authorizationInForce(base, "any", now)).toBe(true));
});
