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
import { notificationsRoutes } from "./routes/notifications";
import { webhookConfigRoutes } from "./routes/webhookConfig";
import { boss, ensureQueues } from "./queue/boss";
import { registerQueueWorkers, scheduleDispatchers } from "./queue/dispatch";
import { registerAlertDispatchWorker } from "./queue/alertDispatch";

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
  await app.register(notificationsRoutes);
  await app.register(webhookConfigRoutes);

  app.get("/health", async () => ({ ok: true }));

  // Requires `npm run queue:bootstrap` to have already granted brandmonitor_app access
  // to the pgboss schema -- see scripts/bootstrapQueue.ts.
  await boss.start();
  await ensureQueues();
  await registerQueueWorkers();
  await registerAlertDispatchWorker();
  await scheduleDispatchers();
  app.log.info("Queue started: workers registered, dispatchers scheduled.");

  await app.listen({ port: env.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
