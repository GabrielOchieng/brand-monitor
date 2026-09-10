import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { env } from "./env";
import { pipelineRoutes } from "./routes/pipeline";
import { findingsRoutes } from "./routes/findings";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), "screenshots"),
    prefix: "/screenshots/",
  });

  await app.register(pipelineRoutes);
  await app.register(findingsRoutes);

  app.get("/health", async () => ({ ok: true }));

  await app.listen({ port: env.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
