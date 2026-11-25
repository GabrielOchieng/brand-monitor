import { describe, expect, it } from "vitest";
import { notificationHref } from "./notificationHref";

describe("notificationHref", () => {
  it("prefers the threat", () => {
    expect(notificationHref({ findingId: "f1", link: "https://x.example", reportId: "r1" })).toEqual({ href: "/threats/f1", external: false });
  });
  it("opens an external link in place of a threat", () => {
    expect(notificationHref({ findingId: null, link: "https://news.example/a", reportId: null })).toEqual({ href: "https://news.example/a", external: true });
  });
  it("sends an unmatched public report to the reports list", () => {
    expect(notificationHref({ findingId: null, link: null, reportId: "r1" })).toEqual({ href: "/reports", external: false });
  });
  it("falls back to the threat list", () => {
    expect(notificationHref({ findingId: null, link: null })).toEqual({ href: "/threats", external: false });
  });
});
