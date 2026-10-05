import "dotenv/config";
import { execSync } from "node:child_process";

/**
 * Applies migrations to the dedicated test database once per run (non-destructive).
 * Individual suites empty the test tables themselves (see tests/helpers/db.ts).
 * Skipped — and DB tests are skipped — when TEST_DATABASE_URL is not configured.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("[tests] TEST_DATABASE_URL not set — database integration tests will be skipped.");
    return;
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL — tests empty the test database.");
  }
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
