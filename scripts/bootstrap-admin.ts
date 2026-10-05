import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/auth/password";

const config = (() => {
  const connectionString = process.env.DATABASE_URL;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  if (!email || !password) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required.");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
  return { connectionString, email, password };
})();

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.connectionString }) });

async function main() {
  const existing = await db.user.findUnique({ where: { email: config.email }, select: { id: true } });
  if (existing) {
    await db.user.update({ where: { id: existing.id }, data: { role: "ADMIN" } });
  } else {
    await db.user.create({ data: { email: config.email, name: "مشرف المحتوى", passwordHash: await hashPassword(config.password), role: "ADMIN" } });
  }
  console.log("Admin bootstrap complete.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
