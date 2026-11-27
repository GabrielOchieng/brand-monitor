import { describe, expect, it } from "vitest";
import { buildAccessRequestEmail } from "./accessRequests";

describe("buildAccessRequestEmail", () => {
  it("escapes what the visitor typed in the HTML part", () => {
    const { html, text } = buildAccessRequestEmail(
      { name: "<b>Ada</b>", email: "ada@example.com", organization: "Example Air", brands: "example.com", message: "<script>x</script>" },
      "https://app.example/admin/access-requests"
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(text).toContain("Message: <script>x</script>");
  });

  it("leaves out an empty message", () => {
    const { text } = buildAccessRequestEmail({ name: "Ada", email: "a@example.com", organization: "O", brands: "b", message: null }, "u");
    expect(text).not.toContain("Message:");
  });
});
