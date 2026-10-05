import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": r("./src"),
      // `server-only` throws outside the React server runtime; tests run server code directly.
      "server-only": r("./tests/helpers/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Pure tests can still run when the isolated PostgreSQL service is unavailable.
    globalSetup: process.env.VITEST_SKIP_DB_SETUP === "1" ? [] : ["tests/helpers/global-setup.ts"],
    setupFiles: ["tests/helpers/setup-env.ts"],
    // Integration tests share one test database.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
