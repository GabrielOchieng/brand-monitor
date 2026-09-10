import { describe, it, expect } from "vitest";
import { buildAlertEmail } from "./email";

const base = {
  to: "test@example.com",
  findingIdentifier: "jambojetflights.com",
  findingId: "finding123",
  previousScore: 15,
  previousSeverity: "low",
  newScore: 30,
  newSeverity: "medium",
};

describe("buildAlertEmail", () => {
  it("words the summary as 'changed from X to Y' when the score/severity actually moved", () => {
    const { text } = buildAlertEmail(base);
    expect(text).toContain("changed from low (15/100) to medium (30/100)");
    expect(text).not.toContain("remains");
  });

  it("words the summary as 'remains X' instead of a no-op 'changed from X to X' when nothing moved", () => {
    const { text, html } = buildAlertEmail({ ...base, previousScore: 30, previousSeverity: "medium" });
    expect(text).toContain("remains medium (30/100)");
    expect(text).not.toContain("changed from");
    expect(html).toContain("remains medium (30/100)");
  });

  it("includes a link to the finding's threat detail page", () => {
    const { text, html } = buildAlertEmail(base);
    expect(text).toContain(`/threats/${base.findingId}`);
    expect(html).toContain(`/threats/${base.findingId}`);
  });

  it("HTML-escapes the finding identifier to prevent markup injection", () => {
    const { html } = buildAlertEmail({ ...base, findingIdentifier: "<script>alert(1)</script>.com" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("picks a distinct color per severity", () => {
    const severities = ["critical", "high", "medium", "low"];
    const htmls = severities.map((s) => buildAlertEmail({ ...base, newSeverity: s }).html);
    expect(new Set(htmls)).toHaveLength(severities.length);
  });

  it("falls back to the low-severity color for an unrecognized severity value", () => {
    const known = buildAlertEmail({ ...base, newSeverity: "low" }).html;
    const unknown = buildAlertEmail({ ...base, newSeverity: "somethingelse" }).html;
    // Same badge colors as the low-severity case (background/border/text hex codes),
    // even though the printed label itself still reflects the raw input.
    const colorOf = (html: string) =>
      html.match(/background-color:(#[0-9a-f]{6});border:1px solid (#[0-9a-f]{6});color:(#[0-9a-f]{6})/)?.slice(1, 4);
    expect(colorOf(unknown)).toEqual(colorOf(known));
  });

  it("builds a subject line naming the identifier, new severity, and score", () => {
    const { subject } = buildAlertEmail(base);
    expect(subject).toBe("[Brand Monitor] jambojetflights.com is now MEDIUM (30/100)");
  });
});
