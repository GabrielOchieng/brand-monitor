import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastifyRawBody from "fastify-raw-body";
import { env } from "./env";
import { pipelineRoutes } from "./routes/pipeline";
import { findingsRoutes } from "./routes/findings";
import { brandRoutes } from "./routes/brands";
import { webhookRoutes } from "./routes/webhooks";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), "screenshots"),
    prefix: "/screenshots/",
  });
  // Scoped to just the webhook route (global: false) -- Clerk's svix signature is
  // computed over the exact raw request bytes, which normal JSON body parsing discards.
  await app.register(fastifyRawBody, { field: "rawBody", global: false, runFirst: true });

  await app.register(webhookRoutes);
  await app.register(brandRoutes);
  await app.register(pipelineRoutes);
  await app.register(findingsRoutes);

  app.get("/health", async () => ({ ok: true }));

  await app.listen({ port: env.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
