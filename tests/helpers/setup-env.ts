import "dotenv/config";

// Integration tests never touch the development database: DATABASE_URL is swapped for
// TEST_DATABASE_URL before any module creates a Prisma client.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  delete process.env.DATABASE_URL;
}
