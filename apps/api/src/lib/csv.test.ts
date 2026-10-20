import { describe, it, expect } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralises spreadsheet formulas from attacker-chosen values", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+254712345678")).toBe("'+254712345678");
    expect(csvCell("@evil")).toBe("'@evil");
  });

  it("formats empty values, dates and arrays", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(new Date("2026-10-20T08:00:00Z"))).toBe("2026-10-20T08:00:00.000Z");
    expect(csvCell(["a", "b"])).toBe("a; b");
    expect(csvCell(45)).toBe("45");
  });
});

describe("toCsv", () => {
  it("joins rows with CRLF and ends with one", () => {
    expect(toCsv(["x", "y"], [[1, "a,b"]])).toBe('x,y\r\n1,"a,b"\r\n');
  });
});
