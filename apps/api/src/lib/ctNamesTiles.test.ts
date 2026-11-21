import { describe, expect, it } from "vitest";
import { matchNamesTile, normalizeHostname, parseCheckpointSize, selectTiledLogs, tilePath } from "./ctNamesTiles";
import { brandMatcher } from "../pipeline/nrdMonitorJob";

describe("tilePath", () => {
  it("encodes tile indexes in tlog-tiles groups of three", () => {
    expect(tilePath(0)).toBe("000");
    expect(tilePath(54)).toBe("054");
    expect(tilePath(1234067)).toBe("x001/x234/067");
    expect(tilePath(4362054)).toBe("x004/x362/054");
  });
});

describe("parseCheckpointSize", () => {
  it("reads the tree size from the second line", () => {
    expect(parseCheckpointSize("log.example/2026h2\n1116686327\nN5Cf...=\n\n— sig\n")).toBe(1116686327);
  });
  it("rejects a malformed checkpoint", () => {
    expect(() => parseCheckpointSize("<html>error</html>")).toThrow();
  });
});

describe("normalizeHostname", () => {
  it("strips wildcards and trailing dots, rejects non-hostnames", () => {
    expect(normalizeHostname("*.JamboJet-Pay.com.")).toBe("jambojet-pay.com");
    expect(normalizeHostname("jambojet limited")).toBeNull();
    expect(normalizeHostname("localhost")).toBeNull();
  });
});

describe("matchNamesTile", () => {
  const tile = [
    '{"Timestamp":1,"Subject":{"CommonName":"uuid.sfdc.net"},"DNS":["uuid.sfdc.net"]}',
    '{"Timestamp":2,"Subject":{"CommonName":"flyjambojet.store"},"DNS":["flyjambojet.store","*.flyjambojet.store"]}',
    "not json",
    '{"Timestamp":3,"Subject":{"Organization":["X"]},"DNS":["jambojet-booking.netlify.app"]}',
    "",
  ].join("\n");

  it("counts entries and returns deduplicated brand matches", () => {
    expect(matchNamesTile(tile, brandMatcher("jambojet"))).toEqual({
      entries: 4,
      matched: ["flyjambojet.store", "jambojet-booking.netlify.app"],
    });
  });
});

describe("selectTiledLogs", () => {
  const list = {
    operators: [
      {
        name: "Let's Encrypt",
        tiled_logs: [
          { description: "Sycamore2026h2", monitoring_url: "https://mon.example/2026h2/", state: { usable: {} }, temporal_interval: { end_exclusive: "2027-01-01T00:00:00Z" } },
          { description: "Sycamore2026h1", monitoring_url: "https://mon.example/2026h1/", state: { usable: {} }, temporal_interval: { end_exclusive: "2026-07-01T00:00:00Z" } },
          { description: "Retired", monitoring_url: "https://mon.example/old", state: { retired: {} } },
          { description: "Willow2027h1", monitoring_url: "https://willow.example/2027h1", state: { qualified: {} } },
        ],
      },
      { name: "Google", tiled_logs: [{ description: "ParcelYard", monitoring_url: "https://g.example/", state: { usable: {} } }] },
    ],
  };
  const now = new Date("2026-11-21T00:00:00Z");

  it("keeps current usable/qualified shards of the chosen operators, with a trailing slash", () => {
    expect(selectTiledLogs(list, ["let's encrypt"], now).map((l) => l.monitoringUrl)).toEqual([
      "https://mon.example/2026h2/",
      "https://willow.example/2027h1/",
    ]);
  });

  it("takes every operator when the list is empty", () => {
    expect(selectTiledLogs(list, [], now)).toHaveLength(3);
  });
});
