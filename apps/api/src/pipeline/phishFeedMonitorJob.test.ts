import { describe, it, expect } from "vitest";
import { findingForFeedUrl } from "./phishFeedMonitorJob";

describe("findingForFeedUrl", () => {
  it("treats a bare host as a domain finding", () => {
    expect(findingForFeedUrl("https://jambojet-pay.com/")).toEqual({ identifier: "jambojet-pay.com", type: "domain" });
    expect(findingForFeedUrl("http://www.Jambojet-Pay.com")).toEqual({ identifier: "jambojet-pay.com", type: "domain" });
  });
  it("keeps a path- or query-bearing URL as a url finding", () => {
    expect(findingForFeedUrl("https://sites.google.com/view/jambojet-refunds")).toEqual({
      identifier: "https://sites.google.com/view/jambojet-refunds",
      type: "url",
    });
    expect(findingForFeedUrl("https://x.pages.dev/?ref=jambojet")?.type).toBe("url");
  });
  it("rejects garbage and non-web schemes", () => {
    expect(findingForFeedUrl("not a url")).toBeNull();
    expect(findingForFeedUrl("ftp://jambojet.example/")).toBeNull();
  });
});
