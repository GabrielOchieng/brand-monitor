import { describe, it, expect } from "vitest";
import { diffRegistration, type PreviousRegistration } from "./registrationChanges";
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
  nameservers: ["NS2CKR.NAME.COM.", "ns1cny.name.com"],
  source: "rdap",
  raw: null,
};

describe("diffRegistration", () => {
  it("reports nothing when only formatting differs", () => {
    expect(diffRegistration(prev, next, ["34.111.179.208"])).toEqual([]);
  });

  it("catches the flyjambojet.org case: the record was updated while the site sat dormant", () => {
    const changes = diffRegistration(prev, { ...next, lastChangedAt: "2026-09-12T16:12:23.508Z" }, ["34.111.179.208"]);
    expect(changes).toEqual([
      { field: "last_changed", oldValue: "2026-09-07T16:11:39.192Z", newValue: "2026-09-12T16:12:23.508Z", alert: true },
    ]);
  });

  it("flags a registrar hold being lifted", () => {
    const changes = diffRegistration({ ...prev, statusCodes: ["clientHold", "clientTransferProhibited"] }, next, ["34.111.179.208"]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: "status", oldValue: "clientHold, clientTransferProhibited", newValue: "clientTransferProhibited", alert: true });
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
