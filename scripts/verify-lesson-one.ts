import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const LESSON_ID = "lesson-akhsar-01";
const ASR_ERRORS = ["اخسر المختصرات", "لم يذكرها الشارع", "يفصل ويسعد", "الماء الاجل", "وظعنا"];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const passages = await db.sourcePassage.findMany({
      where: { lessonId: LESSON_ID },
      orderBy: { concept: { order: "asc" } },
      select: {
        id: true,
        text: true,
        rawBahethText: true,
        reviewText: true,
        approved: true,
        startSecond: true,
        endSecond: true,
        concept: { select: { order: true, videoStartSecond: true, videoEndSecond: true, videoApproved: true } },
      },
    });
    const lesson = await db.lesson.findUniqueOrThrow({ where: { id: LESSON_ID }, select: { status: true } });
    const flags = (value: string | null) => ASR_ERRORS.filter((error) => value?.includes(error));
    const report = passages.map((passage) => ({
      order: passage.concept.order,
      id: passage.id,
      reviewMatchesSource: passage.text === passage.reviewText,
      rawPresent: Boolean(passage.rawBahethText),
      sourceErrors: flags(passage.text),
      reviewErrors: flags(passage.reviewText),
      rawErrors: flags(passage.rawBahethText),
      timestampsMatch: passage.startSecond === passage.concept.videoStartSecond && passage.endSecond === passage.concept.videoEndSecond,
      approved: passage.approved,
      videoApproved: passage.concept.videoApproved,
    }));
    console.log(JSON.stringify({ lessonStatus: lesson.status, passages: report }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
