// Loaded only for `*.integration.test.ts` files (see vitest.config.ts's setupFiles glob).
// Without this guard, a developer with DATABASE_URL already exported in their shell
// profile (pointing at their real seeded local dev database) could run `npm test` and
// have this suite silently create/update/delete real dev data -- no error, no warning.
// CI sets ALLOW_DB_TESTS explicitly; a bare local shell won't have it by accident.
if (process.env.ALLOW_DB_TESTS !== "1") {
  throw new Error(
    "Integration tests require ALLOW_DB_TESTS=1 to be set explicitly (CI sets this). " +
      "This guard exists because these tests run real writes/deletes against whatever " +
      "DATABASE_URL/DATABASE_APP_URL are configured -- refusing to run by default protects " +
      "against accidentally corrupting a real local dev database."
  );
}
