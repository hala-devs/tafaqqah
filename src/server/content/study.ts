import type { PrismaClient } from "@/generated/prisma/client";
import { AppError } from "@/server/errors";
import { recordLearningDay } from "@/server/learner/activity";
import { computePathStates, isAccessible } from "./path-state";

/** Resolves whether a learner may open a lesson right now (server-side source of truth). */
export async function assertLessonAccessible(db: PrismaClient, userId: string, lessonId: string): Promise<void> {
  const lesson = await db.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, status: true, chapter: { select: { courseId: true } } },
  });
  if (!lesson || lesson.status === "DRAFT") throw new AppError("NOT_FOUND");
  if (lesson.status !== "PUBLISHED") throw new AppError("LESSON_LOCKED");

  const lessons = await db.lesson.findMany({
    where: { chapter: { courseId: lesson.chapter.courseId }, status: { in: ["PUBLISHED", "COMING_SOON"] } },
    orderBy: [{ chapter: { order: "asc" } }, { order: "asc" }],
    select: { id: true, status: true, progress: { where: { userId }, select: { studied: true, completedAt: true } } },
  });
  const states = computePathStates(
    lessons.map((l) => ({
      id: l.id,
      status: l.status,
      studied: l.progress[0]?.studied ?? false,
      completed: Boolean(l.progress[0]?.completedAt),
    })),
  );
  if (!isAccessible(states.get(lessonId))) throw new AppError("LESSON_LOCKED");
}

/** "أكملت دراسة الدرس" — idempotent. */
export async function markLessonStudied(db: PrismaClient, userId: string, lessonId: string): Promise<void> {
  await assertLessonAccessible(db, userId, lessonId);
  const approved = await db.sourcePassage.count({ where: { lessonId, approved: true } });
  const lesson = await db.lesson.findUniqueOrThrow({ where: { id: lessonId }, select: { measurementEnabled: true } });
  if (lesson.measurementEnabled) {
    const measurement = await db.lessonMeasurement.findUnique({ where: { userId_lessonId: { userId, lessonId } } });
    if (measurement?.preScore == null) throw new AppError("BAD_REQUEST", "ابدأ بالاختبار القبلي القصير قبل دراسة هذا الدرس.");
  }
  if (approved === 0) throw new AppError("INSUFFICIENT_SOURCE", "لا توجد مادة معتمدة في هذا الدرس بعد.");
  const existing = await db.lessonProgress.findUnique({ where: { userId_lessonId: { userId, lessonId } } });
  if (existing?.studied) return;
  await db.lessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    update: { studied: true, studiedAt: new Date() },
    create: { userId, lessonId, studied: true, studiedAt: new Date() },
  });
  await recordLearningDay(db, userId);
}
