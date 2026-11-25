import { describe, expect, it } from "vitest";
import { settingsRedirect } from "./settingsRoutes";

describe("settingsRedirect", () => {
  it("sends brand sections to the Brands page with the right tab", () => {
    expect(settingsRedirect("details", null)).toBe("/brands");
    expect(settingsRedirect("keywords", null)).toBe("/brands?tab=keywords");
    expect(settingsRedirect("report-form", null)).toBe("/brands?tab=report-form");
    expect(settingsRedirect("delete", null)).toBe("/brands");
    expect(settingsRedirect("add-brand", null)).toBe("/brands?add=1");
  });

  it("sends organization sections to their own pages", () => {
    expect(settingsRedirect("auto-takedown", null)).toBe("/settings/automatic-reporting");
    expect(settingsRedirect("report-recipients", null)).toBe("/settings/report-recipients");
    expect(settingsRedirect("webhook", null)).toBe("/settings/webhook");
    expect(settingsRedirect("team", null)).toBe("/team");
  });

  it("understands the older ?tab= links", () => {
    expect(settingsRedirect(null, "integrations")).toBe("/settings/webhook");
    expect(settingsRedirect(null, "brand")).toBe("/brands");
  });

  it("falls back to the first section", () => {
    expect(settingsRedirect(null, null)).toBe("/settings/alerts");
    expect(settingsRedirect("nonsense", null)).toBe("/settings/alerts");
  });
});
