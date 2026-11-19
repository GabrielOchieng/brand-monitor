import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { describeAiError } from "./aiExplain";

function apiError(status: number, message: string) {
  const body = { type: "error", error: { type: "invalid_request_error", message } };
  return Anthropic.APIError.generate(status, body, undefined, new Headers());
}

describe("describeAiError", () => {
  it("explains an exhausted credit balance (the real 2026-11-19 error)", () => {
    const err = apiError(
      400,
      "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."
    );
    expect(describeAiError(err)).toBe("AI explanations are unavailable: the Anthropic account has run out of credits.");
  });

  it("maps auth, model, rate-limit and server errors", () => {
    expect(describeAiError(apiError(401, "invalid x-api-key"))).toMatch(/API key is invalid/);
    expect(describeAiError(apiError(404, "model: claude-x"))).toMatch(/ANTHROPIC_MODEL/);
    expect(describeAiError(apiError(429, "rate limited"))).toMatch(/rate-limiting/);
    expect(describeAiError(apiError(529, "Overloaded"))).toMatch(/temporarily unavailable/);
  });

  it("maps connection failures and timeouts", () => {
    expect(describeAiError(new Anthropic.APIConnectionTimeoutError())).toMatch(/too long/);
    expect(describeAiError(new Anthropic.APIConnectionError({ message: "ECONNRESET" }))).toMatch(/Couldn't reach/);
  });

  it("never leaks a raw message for anything unrecognised", () => {
    expect(describeAiError(new Error('400 {"type":"error"}'))).toBe("The AI explanation couldn't be generated. Try again later.");
    expect(describeAiError(apiError(400, "some other bad request"))).toBe(
      "The AI explanation couldn't be generated. Try again later."
    );
  });
});
