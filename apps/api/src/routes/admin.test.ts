import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminRoutes } from "./admin";

// Regression: the admin guard used to test the raw request.url, so a percent-encoded path reached
// the handlers without it (the router matches the decoded path). Without a session cookie the
// guard answers 401 before any database access, so this runs without Postgres.
describe("admin routes require a platform admin", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(adminRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const cases: Array<[method: "GET" | "POST" | "DELETE", url: string]> = [
    ["GET", "/api/admin/overview"],
    ["GET", "/api/%61dmin/overview"],
    ["GET", "/%61pi/admin/overview"],
    ["GET", "/api/%61%64%6d%69%6e/users"],
    ["GET", "/api/%61dmin/audit"],
    ["GET", "/api/%61dmin/contacts"],
    ["GET", "/api/%61dmin/orgs/org_x"],
    ["GET", "/api/%61dmin/orgs/org_x/takedown-documents/doc_x"],
    ["POST", "/api/%61dmin/orgs/org_x/pause"],
    ["DELETE", "/api/%61dmin/orgs/org_x/invites/inv_x"],
  ];

  for (const [method, url] of cases) {
    it(`${method} ${url} without a session is refused`, async () => {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
    });
  }
});
