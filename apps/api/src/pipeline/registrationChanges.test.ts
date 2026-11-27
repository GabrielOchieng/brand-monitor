import { describe, it, expect } from "vitest";
import { diffRegistration, holdTransition, type PreviousRegistration } from "./registrationChanges";
import type { RegistrationInfo } from "../lib/rdap";

const prev: PreviousRegistration = {
  registrar: "Name.com, Inc.",
  nameservers: ["ns1cny.name.com", "ns2ckr.name.com"],
  whoisSource: "rdap",
  lastChangedAt: new Date("2026-09-07T16:11:39.192Z"),
  expiresAt: new Date("2027-09-07T16:11:39.192Z"),
  statusCodes: ["clientTransferProhibited"],
  aRecords: ["34.111.179.208"],
};

const next: RegistrationInfo = {
  registrar: "Name.com, Inc.",
  registeredAt: "2026-09-07T16:11:39.192Z",
  lastChangedAt: "2026-09-07T16:11:39.192Z",
  expiresAt: "2027-09-07T16:11:39.192Z",
  statusCodes: ["clientTransferProhibited"],
  registrarAbuseEmail: "abuse@name.com",
  registrarAbusePhone: null,
  registrarIanaId: "625",
  nameservers: ["NS2CKR.NAME.COM.", "ns1cny.name.com"],
  source: "rdap",
  raw: null,
};

describe("diffRegistration", () => {
  it("reports nothing when only formatting differs", () => {
    expect(diffRegistration(prev, next, ["34.111.179.208"])).toEqual([]);
  });

  // flyjambojet.org (2026-09): only the update date moved while the site sat dormant. Recorded,
  // but since 2026-11 it no longer alerts on its own: grace periods ending bump it too.
  it("records an update date that moved on its own without alerting", () => {
    const changes = diffRegistration(prev, { ...next, lastChangedAt: "2026-09-12T16:12:23.508Z" }, ["34.111.179.208"]);
    expect(changes).toEqual([
      { field: "last_changed", oldValue: "2026-09-07T16:11:39.192Z", newValue: "2026-09-12T16:12:23.508Z", alert: false },
    ]);
  });

  it("alerts on the update date when it comes with a real change", () => {
    const changes = diffRegistration(prev, { ...next, lastChangedAt: "2026-09-12T16:12:23.508Z", nameservers: ["ada.ns.cloudflare.com"] }, ["34.111.179.208"]);
    expect(changes.filter((c) => c.alert).map((c) => c.field).sort()).toEqual(["last_changed", "nameservers"]);
  });

  // jambojetbooking.online, 2026-11-25: on hold since registration; only addPeriod ended.
  it("doesn't alert when only a grace period ends", () => {
    const changes = diffRegistration(
      { ...prev, lastChangedAt: new Date("2026-11-23T10:10:45.778Z"), statusCodes: ["addPeriod", "clientHold", "clientTransferProhibited"] },
      { ...next, lastChangedAt: "2026-11-25T18:32:49.427Z", statusCodes: ["clientHold", "clientTransferProhibited"] },
      ["34.111.179.208"]
    );
    expect(changes.map((c) => c.field).sort()).toEqual(["last_changed", "status"]);
    expect(changes.every((c) => !c.alert)).toBe(true);
    expect(holdTransition(changes)).toBeUndefined();
  });

  it("flags a registrar hold being placed", () => {
    const changes = diffRegistration(prev, { ...next, statusCodes: ["clientHold", "clientTransferProhibited"] }, ["34.111.179.208"]);
    expect(changes).toEqual([
      { field: "status", oldValue: "clientTransferProhibited", newValue: "clientHold, clientTransferProhibited", alert: true },
      { field: "hold", oldValue: "not suspended", newValue: "suspended", alert: true },
    ]);
    expect(holdTransition(changes)).toBe("placed");
  });

  it("flags a registrar hold being lifted", () => {
    const changes = diffRegistration({ ...prev, statusCodes: ["serverHold", "clientTransferProhibited"] }, next, ["34.111.179.208"]);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ field: "status", oldValue: "clientTransferProhibited, serverHold", newValue: "clientTransferProhibited", alert: true });
    expect(holdTransition(changes)).toBe("lifted");
  });

  it("flags new nameservers", () => {
    const changes = diffRegistration(prev, { ...next, nameservers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"] }, ["34.111.179.208"]);
    expect(changes.map((c) => c.field)).toEqual(["nameservers"]);
  });

  it("ignores registrar/date/status differences across RDAP and WHOIS", () => {
    const changes = diffRegistration(
      { ...prev, whoisSource: "whois", registrar: "TUCOWS.COM, CO.", statusCodes: ["ok"] },
      { ...next, registrar: "Tucows Domains Inc.", lastChangedAt: "2026-10-01T00:00:00Z" },
      ["34.111.179.208"]
    );
    expect(changes).toEqual([]);
  });

  it("never treats a missing value as a change", () => {
    const changes = diffRegistration(
      { ...prev, lastChangedAt: null, expiresAt: null, statusCodes: [], aRecords: [] },
      { ...next, nameservers: [], registrar: null },
      ["1.2.3.4"]
    );
    expect(changes).toEqual([]);
    expect(diffRegistration(prev, null, ["34.111.179.208"])).toEqual([]);
    expect(diffRegistration(null, next, ["1.2.3.4"])).toEqual([]);
  });

  it("records a move to a disjoint IP set without alerting, but ignores rotation within a set", () => {
    expect(diffRegistration({ ...prev, aRecords: ["1.1.1.1", "2.2.2.2"] }, next, ["2.2.2.2", "3.3.3.3"])).toEqual([]);
    expect(diffRegistration(prev, next, ["5.6.7.8"])).toEqual([
      { field: "ip", oldValue: "34.111.179.208", newValue: "5.6.7.8", alert: false },
    ]);
  });

  it("records a renewal (expiry change) without alerting on it", () => {
    const changes = diffRegistration(prev, { ...next, expiresAt: "2028-09-07T16:11:39.192Z" }, ["34.111.179.208"]);
    expect(changes).toEqual([{ field: "expires", oldValue: "2027-09-07T16:11:39.192Z", newValue: "2028-09-07T16:11:39.192Z", alert: false }]);
  });
});
