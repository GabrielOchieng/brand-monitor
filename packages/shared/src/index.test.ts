import { describe, it, expect } from "vitest";
import { severityForScore } from "./index";

describe("severityForScore", () => {
  it("maps the boundary and interior values of each severity band correctly", () => {
    expect(severityForScore(0)).toBe("low");
    expect(severityForScore(29)).toBe("low");
    expect(severityForScore(30)).toBe("medium");
    expect(severityForScore(59)).toBe("medium");
    expect(severityForScore(60)).toBe("high");
    expect(severityForScore(79)).toBe("high");
    expect(severityForScore(80)).toBe("critical");
    expect(severityForScore(100)).toBe("critical");
  });
});
