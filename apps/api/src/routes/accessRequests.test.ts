import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  create: vi.fn(),
  findAdmins: vi.fn(),
  sendMail: vi.fn(),
  turnstileOk: { value: true },
}));

vi.mock("../adminDb", () => ({
  adminPrisma: { accessRequest: { create: db.create }, user: { findMany: db.findAdmins } },
}));
vi.mock("../lib/email", async (orig) => ({ ...(await orig<typeof import("../lib/email")>()), sendMail: db.sendMail }));
vi.mock("../lib/publicReports", () => ({ verifyTurnstile: async () => db.turnstileOk.value }));

import { accessRequestRoutes } from "./accessRequests";

const valid = { name: "Ada Lovelace", email: "ada@example.com", organization: "Example Air", brands: "example.com", message: "" };

describe("POST /api/public/access-requests", () => {
  let app: FastifyInstance;
  let ip = 0;
  // Each test gets its own address so the per-IP limit only bites where it's tested.
  const post = (body: unknown, remoteAddress = `10.0.0.${++ip}`) =>
    app.inject({ method: "POST", url: "/api/public/access-requests", payload: body as object, remoteAddress });

  beforeAll(async () => {
    app = Fastify();
    await app.register(accessRequestRoutes);
    await app.ready();
  });
  afterAll(() => app.close());

  beforeEach(() => {
    vi.clearAllMocks();
    db.turnstileOk.value = true;
    db.create.mockImplementation(async ({ data }) => ({ id: "ar_1", ...data }));
    db.findAdmins.mockResolvedValue([{ email: "admin1@example.com" }, { email: "admin2@example.com" }]);
    db.sendMail.mockResolvedValue(undefined);
  });

  it("saves the request and emails every platform admin", async () => {
    const res = await post(valid);
    expect(res.statusCode).toBe(201);
    expect(db.create).toHaveBeenCalledWith({ data: { ...valid, message: null } });
    expect(db.sendMail.mock.calls.map(([m]) => m.to)).toEqual(["admin1@example.com", "admin2@example.com"]);
    expect(db.sendMail.mock.calls[0][0].subject).toBe("[Brand Monitor] Access request: Example Air");
  });

  it("still answers 201 when the email fails, since the request is saved", async () => {
    db.sendMail.mockRejectedValue(new Error("smtp down"));
    expect((await post(valid)).statusCode).toBe(201);
    expect(db.create).toHaveBeenCalled();
  });

  it("rejects missing fields and control characters", async () => {
    expect((await post({ ...valid, organization: "" })).statusCode).toBe(400);
    expect((await post({ ...valid, email: "not-an-email" })).statusCode).toBe(400);
    expect((await post({ ...valid, organization: "Evil\r\nBcc: x@example.com" })).statusCode).toBe(400);
    expect(db.create).not.toHaveBeenCalled();
  });

  it("pretends to accept a filled honeypot without saving anything", async () => {
    expect((await post({ ...valid, website: "http://spam.example" })).statusCode).toBe(201);
    expect(db.create).not.toHaveBeenCalled();
    expect(db.sendMail).not.toHaveBeenCalled();
  });

  it("refuses a failed Turnstile check", async () => {
    db.turnstileOk.value = false;
    const res = await post(valid);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("captcha_failed");
    expect(db.create).not.toHaveBeenCalled();
  });

  it("allows 3 requests an hour per address", async () => {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await post(valid, "10.9.9.9")).statusCode);
    expect(codes).toEqual([201, 201, 201, 429]);
  });
});
