/**
 * Docker bootstrap helper: exit 0 when the database already holds seeded content (a Course row), 10 when it is empty.
 * Lets the one-off `migrate` service seed only on the very first start, so restarts never overwrite later /admin edits.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
db.course
  .count()
  .then((n) => process.exit(n > 0 ? 0 : 10))
  .catch((error) => {
    console.error("[bootstrap] cannot read the database:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
