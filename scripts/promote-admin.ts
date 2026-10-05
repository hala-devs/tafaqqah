import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/** Usage: npm run admin:promote -- someone@example.com */
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npm run admin:promote -- <email>");
    process.exitCode = 1;
    return;
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`No user with email ${email}. Ask them to register first.`);
      process.exitCode = 1;
      return;
    }
    await prisma.user.update({ where: { email }, data: { role: "ADMIN" } });
    console.log(`✔ ${email} is now an admin.`);
  } finally {
    await prisma.$disconnect();
  }
}

main();
