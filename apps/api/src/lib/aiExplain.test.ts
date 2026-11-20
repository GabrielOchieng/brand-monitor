import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../env";
import { AiHttpError, describeAiError, generateText } from "./aiExplain";

describe("describeAiError", () => {
  it("maps an invalid key, including Gemini's 400 form", () => {
    expect(describeAiError(new AiHttpError(401, "Invalid API Key"))).toMatch(/AI_API_KEY is invalid/);
    expect(
      describeAiError(new AiHttpError(400, '[{"error":{"code":400,"message":"API key not valid. Please pass a valid API key."}}]'))
    ).toMatch(/AI_API_KEY is invalid/);
  });

  it("maps model, quota and server errors", () => {
    expect(describeAiError(new AiHttpError(404, "model not found"))).toMatch(/AI_MODEL/);
    expect(describeAiError(new AiHttpError(429, "RESOURCE_EXHAUSTED"))).toMatch(/free quota/);
    expect(describeAiError(new AiHttpError(503, "Overloaded"))).toMatch(/overloaded or down/);
  });

  it("maps connection failures and timeouts", () => {
    expect(describeAiError(new DOMException("timed out", "TimeoutError"))).toMatch(/too long/);
    expect(describeAiError(new TypeError("fetch failed"))).toMatch(/Couldn't reach/);
  });

  it("never leaks a raw message for anything unrecognised", () => {
    expect(describeAiError(new Error('400 {"type":"error"}'))).toBe("The AI explanation couldn't be generated. Try again later.");
    expect(describeAiError(new AiHttpError(400, "some other bad request"))).toBe(
      "The AI explanation couldn't be generated. Try again later."
    );
  });
});

describe("generateText fallback chain", () => {
  const saved = { key: env.aiApiKey, models: env.aiModels };
  afterEach(() => {
    env.aiApiKey = saved.key;
    env.aiModels = saved.models;
    vi.unstubAllGlobals();
  });

  function stubFetch(byModel: Record<string, () => Response>) {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model as string;
      calls.push(model);
      return byModel[model]();
    });
    return calls;
  }
  const ok = (text: string) => () => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
  const fail = (status: number, body = "x") => () => new Response(body, { status });

  it("falls through overloaded and quota-spent models to the first that answers", async () => {
    env.aiApiKey = "k";
    env.aiModels = ["a", "b", "c", "d"];
    const calls = stubFetch({ a: fail(503), b: fail(429), c: ok("explained"), d: ok("unused") });
    const seen: string[] = [];
    await expect(generateText("p", (m) => seen.push(m))).resolves.toEqual({ text: "explained", model: "c" });
    expect(calls).toEqual(["a", "b", "c"]);
    expect(seen).toEqual(["a", "b"]);
  });

  it("stops at a bad key instead of trying every model", async () => {
    env.aiApiKey = "k";
    env.aiModels = ["a", "b"];
    const calls = stubFetch({ a: fail(400, "API key not valid"), b: ok("unused") });
    await expect(generateText("p")).rejects.toBeInstanceOf(AiHttpError);
    expect(calls).toEqual(["a"]);
  });

  it("throws the last error when every model fails", async () => {
    env.aiApiKey = "k";
    env.aiModels = ["a", "b"];
    stubFetch({ a: fail(503), b: fail(404) });
    const err = await generateText("p").catch((e) => e);
    expect(describeAiError(err)).toMatch(/AI_MODEL/);
  });
});
