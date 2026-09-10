import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    // Prisma's per-instance connection pool and sharp's native bindings aren't
    // thread-safe across Vitest's default worker-thread pool -- forks are.
    pool: "forks",
    poolOptions: { forks: { minForks: 1, maxForks: 4 } },
    testTimeout: 10_000, // integration tests run real transactions; the default 5s is tight
  },
});
