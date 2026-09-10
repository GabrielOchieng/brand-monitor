// Explicit, first thing in the module graph: unlike Prisma's CLI (`prisma migrate`/`db
// seed`), which auto-loads .env itself, and unlike @prisma/client (which loads it as a
// side effect of instantiating PrismaClient), plain `tsx watch src/server.ts` does not
// load .env at all. Without this, non-Prisma env vars (CLERK_SECRET_KEY etc.) silently
// read as empty strings whenever this module happened to evaluate before any
// PrismaClient was constructed elsewhere in the import graph -- exactly the bug that
// caused "Failed to resolve JWK during verification" (Clerk's JWKS fetch rejected an
// empty secret key). Node 20.6+ ships this natively; try/catch only because it's a
// no-op (not an error) if .env doesn't exist, e.g. in prod where real env vars are set.
try {
  // process.cwd() is apps/api when run the normal way (`npm run dev`, an npm workspace
  // script) -- matches the same assumption runPipeline.ts already makes for screenshots/.
  process.loadEnvFile(); // defaults to ./.env relative to cwd
} catch {
  // .env not present -- fine in environments where vars are injected another way.
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  scannerUrl: process.env.SCANNER_URL ?? "http://localhost:3100",
  // The running server always connects as the restricted brandmonitor_app role, never
  // the migration role in DATABASE_URL -- see apps/api/.env.example.
  databaseAppUrl: process.env.DATABASE_APP_URL ?? "",
  // Privileged (bypasses RLS) -- used ONLY by src/adminDb.ts for the Clerk webhook sync,
  // which has to create organizations/users rows before any tenant context can exist.
  // Never use this for request-handling routes/pipeline code.
  databaseUrl: process.env.DATABASE_URL ?? "",
  clerkSecretKey: process.env.CLERK_SECRET_KEY ?? "",
  clerkWebhookSigningSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET ?? "",
  smtpHost: process.env.SMTP_HOST ?? "smtp.gmail.com",
  smtpPort: Number(process.env.SMTP_PORT ?? 465),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  smtpFrom: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "",
  webAppUrl: process.env.WEB_APP_URL ?? "http://localhost:3000",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  // A narration task fed pre-computed evidence, not open-ended reasoning -- doesn't need
  // a larger model.
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
  // Per-org cost guardrail for Stage E's AI explanations -- see routes/findings.ts.
  aiExplanationDailyLimit: Number(process.env.AI_EXPLANATION_DAILY_LIMIT ?? 100),
};
