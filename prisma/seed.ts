import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { CURRICULUM, LEARNING_PATH } from "./seed-data/curriculum";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Idempotent seed: upserts curriculum by stable ids. A passage whose text changed gets
 * its version bumped (questions keep a snapshot of the exact text they were built from).
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function seedLearningPath(): Promise<Map<number, string>> {
  const p = LEARNING_PATH;
  const pathData = { slug: p.slug, title: p.title, description: p.description, isSample: p.isSample, order: 0 };
  await prisma.learningPath.upsert({ where: { id: p.id }, update: pathData, create: { id: p.id, ...pathData } });
  const levelIds = new Map<number, string>();
  for (const level of p.levels) {
    const id = `${p.id}-level-${level.order}`;
    const data = {
      pathId: p.id,
      order: level.order,
      title: level.title,
      status: level.status,
      description: level.status === "ACTIVE" ? null : "مستوى قادم في المسار. لم تُضف مادته بعد.",
    };
    await prisma.level.upsert({ where: { id }, update: data, create: { id, ...data } });
    levelIds.set(level.order, id);
  }
  return levelIds;
}

async function seedCurriculum(levelIds: Map<number, string>) {
  for (const [courseIndex, course] of CURRICULUM.entries()) {
    const courseData = {
      slug: course.slug,
      title: course.title,
      description: course.description,
      madhhab: course.madhhab,
      isSample: course.isSample,
      order: courseIndex,
      levelId: levelIds.get(course.levelOrder) ?? null,
    };
    await prisma.course.upsert({ where: { id: course.id }, update: courseData, create: { id: course.id, ...courseData } });

    for (const [chapterIndex, chapter] of course.chapters.entries()) {
      const chapterData = { courseId: course.id, title: chapter.title, description: chapter.description ?? null, order: chapterIndex + 1 };
      await prisma.chapter.upsert({ where: { id: chapter.id }, update: chapterData, create: { id: chapter.id, ...chapterData } });

      for (const [lessonIndex, lesson] of chapter.lessons.entries()) {
        const lessonData = {
          chapterId: chapter.id,
          title: lesson.title,
          description: lesson.description,
          objectives: lesson.objectives,
          order: lessonIndex + 1,
          status: lesson.status,
          isSample: lesson.isSample,
          estimatedMinutes: lesson.estimatedMinutes ?? null,
          measurementEnabled: lesson.measurementEnabled ?? false,
        };
        await prisma.lesson.upsert({ where: { id: lesson.id }, update: lessonData, create: { id: lesson.id, ...lessonData } });

        for (const [conceptIndex, concept] of lesson.concepts.entries()) {
          const conceptData = { lessonId: lesson.id, title: concept.title, description: concept.description, order: conceptIndex + 1 };
          await prisma.concept.upsert({ where: { id: concept.id }, update: conceptData, create: { id: concept.id, ...conceptData } });

          for (const [passageIndex, passage] of concept.passages.entries()) {
            const existing = await prisma.sourcePassage.findUnique({ where: { id: passage.id } });
            const base = {
              lessonId: lesson.id,
              conceptId: concept.id,
              text: passage.text,
              sourceTitle: passage.sourceTitle,
              sourceAuthor: passage.sourceAuthor,
              sourceReference: passage.sourceReference,
              approved: passage.approved,
              approvedAt: passage.approved ? (existing?.approvedAt ?? new Date()) : null,
              isSample: passage.isSample,
              order: passageIndex + 1,
            };
            if (!existing) {
              await prisma.sourcePassage.create({ data: { id: passage.id, ...base } });
            } else {
              await prisma.sourcePassage.update({
                where: { id: passage.id },
                data: { ...base, version: existing.text === passage.text ? existing.version : existing.version + 1 },
              });
            }
          }
        }

        for (const [questionIndex, q] of lesson.fixedQuestions.entries()) {
          const data = {
            lessonId: lesson.id,
            conceptId: q.conceptId,
            sourcePassageId: q.passageId,
            questionType: q.questionType,
            question: q.question,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation,
            difficulty: q.difficulty,
            order: questionIndex + 1,
            approved: true,
            isSample: true,
          };
          await prisma.fixedQuestion.upsert({ where: { id: q.id }, update: data, create: { id: q.id, ...data } });
        }
      }
    }
  }
}

/**
 * Human-approved release content (prisma/seed-data/release-content.json, written by scripts/export-release-content.ts).
 * Approval state is copied exactly as a person set it in /admin — nothing is approved here. Idempotent upserts by id;
 * approver user ids are never part of the snapshot.
 */
async function seedReleaseContent() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap: any = JSON.parse(readFileSync(join(__dirname, "seed-data", "release-content.json"), "utf8"));
  if (snap.format !== "tafaqqah-release-content/v1") throw new Error("Unknown release-content format.");
  const date = (v: string | null) => (v ? new Date(v) : null);
  for (const c of snap.chapters) await prisma.chapter.upsert({ where: { id: c.id }, update: c, create: c });
  for (const { concepts, passages, fixedQuestions, ...lesson } of snap.lessons) {
    await prisma.lesson.upsert({ where: { id: lesson.id }, update: lesson, create: lesson });
    for (const c of concepts) {
      const data = { ...c, lessonId: lesson.id, videoApprovedAt: date(c.videoApprovedAt) };
      await prisma.concept.upsert({ where: { id: c.id }, update: data, create: data });
    }
    for (const p of passages) {
      const data = { ...p, lessonId: lesson.id, approvedAt: date(p.approvedAt), alignmentDetails: p.alignmentDetails ?? undefined };
      await prisma.sourcePassage.upsert({ where: { id: p.id }, update: data, create: data });
    }
    for (const q of fixedQuestions) {
      const data = { ...q, lessonId: lesson.id };
      await prisma.fixedQuestion.upsert({ where: { id: q.id }, update: data, create: data });
    }
  }
  let units = 0;
  for (const { passages, ...section } of snap.matnSections) {
    const s = { ...section, approvedAt: date(section.approvedAt) };
    await prisma.matnSection.upsert({ where: { id: s.id }, update: s, create: s });
    for (const { units: rows, ...passage } of passages) {
      const p = { ...passage, sectionId: section.id, approvedAt: date(passage.approvedAt) };
      await prisma.matnPassage.upsert({ where: { id: p.id }, update: p, create: p });
      for (const u of rows) {
        const data = { ...u, passageId: passage.id, approvedAt: date(u.approvedAt) };
        await prisma.matnUnit.upsert({ where: { id: u.id }, update: data, create: data });
        units += 1;
      }
    }
  }
  for (const q of snap.quotes) {
    const data = { ...q, approvedAt: date(q.approvedAt) };
    await prisma.quote.upsert({ where: { id: q.id }, update: data, create: data });
  }
  console.log(`✔ Release content: ${snap.lessons.length} approved lesson(s), ${snap.matnSections.length} Matn section(s), ${units} Matn unit(s).`);
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("ℹ ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping admin bootstrap.");
    return;
  }
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({ where: { email }, data: { role: "ADMIN" } });
    console.log(`✔ Ensured admin role for ${email}`);
  } else {
    await prisma.user.create({ data: { email, name: "مشرف المحتوى", passwordHash: await hashPassword(password), role: "ADMIN" } });
    console.log(`✔ Created admin ${email}`);
  }
}

async function main() {
  await seedCurriculum(await seedLearningPath());
  await seedReleaseContent();
  await seedAdmin();
  const [lessons, passages, approved] = await Promise.all([
    prisma.lesson.count(),
    prisma.sourcePassage.count(),
    prisma.sourcePassage.count({ where: { approved: true } }),
  ]);
  console.log(`✔ Seeded ${lessons} lessons, ${passages} passages (${approved} approved).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
