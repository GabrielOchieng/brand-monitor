import { describe, expect, it } from "vitest";
import { extractIscDomains, iscUserAgent } from "./iscRecentDomains";
import { brandMatcher } from "../pipeline/nrdMonitorJob";

const feed = JSON.stringify([
  { domainname: "0-ip.com", ip: 3107304341, firstseen: "2026-11-20", score: 0, scorereason: "" },
  { domainname: "JamboJetOnlineBooking.site", ip: null, firstseen: "2026-11-20", score: 0, scorereason: "" },
  { domainname: "other.xyz", ip: null, firstseen: "2026-11-20", score: 2, scorereason: "Excessive numbers" },
]);

describe("extractIscDomains", () => {
  it("counts every domain and returns the brand matches, lower-cased", () => {
    expect(extractIscDomains(feed, brandMatcher("jambojet"))).toEqual({
      total: 3,
      firstSeen: "2026-11-20",
      matched: ["jambojetonlinebooking.site"],
    });
  });

  it("handles the feed's spacing after colons", () => {
    const spaced = '[{"domainname": "flyjambojet.top", "ip": null, "firstseen": "2026-11-21"}]';
    expect(extractIscDomains(spaced, brandMatcher("jambojet")).matched).toEqual(["flyjambojet.top"]);
  });
});

describe("iscUserAgent", () => {
  it("includes the contact only when one is configured", () => {
    expect(iscUserAgent("")).toBe("BrandMonitor/1.0 (brand-protection monitoring)");
    expect(iscUserAgent("security@example.com")).toContain("contact: security@example.com");
  });
});
