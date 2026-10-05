import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

let client: PrismaClient | null = null;

export function testDb(): PrismaClient {
  if (!hasTestDb) throw new Error("TEST_DATABASE_URL is not configured");
  client ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL }) });
  return client;
}

/** Empties every application table (order-independent thanks to CASCADE). */
export async function truncateAll(): Promise<void> {
  const db = testDb();
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}
