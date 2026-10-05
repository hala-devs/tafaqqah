import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/server/auth/password";
import { CURRICULUM } from "../../prisma/seed-data/curriculum";

export const UNAPPROVED_MARKER = "نص-غير-معتمد-لا-يجوز-إرساله";

const methodLesson = CURRICULUM[0].chapters[0].lessons[0];
const masteryLesson = CURRICULUM[0].chapters[0].lessons[1];

/** Seeds one course with two published demo lessons (+ fixed questions) and an unapproved passage. */
export async function seedFixtureCurriculum(db: PrismaClient) {
  await db.course.create({
    data: { id: "c1", slug: "test-course", title: "مسار اختبار", description: "—", madhhab: "الحنبلي", isSample: true },
  });
  await db.chapter.create({ data: { id: "ch1", courseId: "c1", title: "مدخل", order: 1 } });

  for (const [index, lesson] of [methodLesson, masteryLesson].entries()) {
    await db.lesson.create({
      data: {
        id: lesson.id,
        chapterId: "ch1",
        title: lesson.title,
        description: lesson.description,
        objectives: lesson.objectives,
        order: index + 1,
        status: "PUBLISHED",
        isSample: true,
        measurementEnabled: lesson.measurementEnabled ?? false,
      },
    });
    for (const [ci, concept] of lesson.concepts.entries()) {
      await db.concept.create({ data: { id: concept.id, lessonId: lesson.id, title: concept.title, description: concept.description, order: ci + 1 } });
      for (const passage of concept.passages) {
        await db.sourcePassage.create({
          data: {
            id: passage.id,
            lessonId: lesson.id,
            conceptId: concept.id,
            text: passage.text,
            sourceTitle: passage.sourceTitle,
            sourceAuthor: passage.sourceAuthor,
            sourceReference: passage.sourceReference,
            approved: true,
            isSample: true,
          },
        });
      }
    }
    for (const [qi, q] of lesson.fixedQuestions.entries()) {
      await db.fixedQuestion.create({
        data: {
          id: q.id,
          lessonId: lesson.id,
          conceptId: q.conceptId,
          sourcePassageId: q.passageId,
          questionType: q.questionType,
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          explanation: q.explanation,
          difficulty: q.difficulty,
          order: qi + 1,
          approved: true,
          isSample: true,
        },
      });
    }
  }

  // An UNAPPROVED passage on the first concept: it must never reach the AI.
  await db.sourcePassage.create({
    data: {
      id: "passage-unapproved",
      lessonId: methodLesson.id,
      conceptId: methodLesson.concepts[0].id,
      text: `${UNAPPROVED_MARKER} هذا مقطع لم يُعتمد بعد ويجب ألا يُستخدم في توليد الأسئلة أبدًا مهما كان.`,
      sourceTitle: "مسودة",
      sourceAuthor: "—",
      sourceReference: "—",
      approved: false,
      order: 99,
    },
  });

  return { methodLesson, masteryLesson };
}

export async function createUser(db: PrismaClient, email: string, role: "STUDENT" | "ADMIN" = "STUDENT") {
  return db.user.create({
    data: { email, name: role === "ADMIN" ? "مشرف" : "متعلم", passwordHash: await hashPassword("password-123"), role },
  });
}

export async function markStudied(db: PrismaClient, userId: string, lessonId: string) {
  await db.lessonProgress.create({ data: { userId, lessonId, studied: true, studiedAt: new Date() } });
}
