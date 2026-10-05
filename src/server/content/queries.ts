import "server-only";
import { cache } from "react";
import { prisma } from "@/server/db";
import { defaultModeFor } from "@/server/auth/accounts";
import { approvedVideo } from "@/lib/video";
import { computePathStates, isAccessible, type PathState } from "./path-state";

export type PathLesson = {
  id: string;
  title: string;
  description: string;
  order: number;
  number: number; // 1-based position within the course
  status: "COMING_SOON" | "PUBLISHED";
  state: PathState;
  isSample: boolean;
  studied: boolean;
  completed: boolean;
  conceptCount: number;
  estimatedMinutes: number | null;
  /** Practice assessment state only; measurement sessions are a separate journey. */
  assessmentState: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  /** Average mastery of the concepts the learner has actually been assessed on, or null. */
  mastery: number | null;
};

export type PathChapter = { id: string; title: string; description: string | null; order: number; lessons: PathLesson[] };
export type PathCourse = { id: string; title: string; levelTitle: string | null; description: string; madhhab: string; isSample: boolean; chapters: PathChapter[] };

/** The learner's whole curriculum with per-lesson path states. */
export const getLearningPath = cache(async (userId: string): Promise<PathCourse[]> => {
  const [courses, progress, masteries, assessmentSessions] = await Promise.all([
    prisma.course.findMany({
      // Only books in ACTIVE levels (or not yet assigned to a level) have openable lessons.
      where: { OR: [{ levelId: null }, { level: { status: "ACTIVE" } }] },
      orderBy: { order: "asc" },
      include: {
        level: { select: { title: true } },
        chapters: {
          orderBy: { order: "asc" },
          include: {
            lessons: {
              where: { status: { in: ["PUBLISHED", "COMING_SOON"] } },
              orderBy: { order: "asc" },
              include: { concepts: { select: { id: true } } },
            },
          },
        },
      },
    }),
    prisma.lessonProgress.findMany({ where: { userId } }),
    prisma.conceptMastery.findMany({ where: { userId, attempts: { gt: 0 } }, select: { conceptId: true, masteryScore: true } }),
    prisma.assessmentSession.findMany({
      where: { userId, purpose: "PRACTICE", status: { in: ["IN_PROGRESS", "COMPLETED"] } },
      orderBy: { startedAt: "desc" },
      select: { lessonId: true, status: true },
    }),
  ]);

  const progressByLesson = new Map(progress.map((p) => [p.lessonId, p]));
  const masteryByConcept = new Map(masteries.map((m) => [m.conceptId, m.masteryScore]));
  const assessmentByLesson = new Map<string, "IN_PROGRESS" | "COMPLETED">();
  for (const session of assessmentSessions) {
    if ((session.status === "IN_PROGRESS" || session.status === "COMPLETED") && !assessmentByLesson.has(session.lessonId)) {
      assessmentByLesson.set(session.lessonId, session.status);
    }
  }

  return courses.map((course) => {
    const ordered = course.chapters.flatMap((ch) => ch.lessons);
    const states = computePathStates(
      ordered.map((l) => ({
        id: l.id,
        status: l.status,
        studied: progressByLesson.get(l.id)?.studied ?? false,
        completed: Boolean(progressByLesson.get(l.id)?.completedAt),
      })),
    );
    let number = 0;
    return {
      id: course.id,
      title: course.title,
      levelTitle: course.level?.title ?? null,
      description: course.description,
      madhhab: course.madhhab,
      isSample: course.isSample,
      chapters: course.chapters
        .filter((ch) => ch.lessons.length > 0)
        .map((ch) => ({
          id: ch.id,
          title: ch.title,
          description: ch.description,
          order: ch.order,
          lessons: ch.lessons.map((l) => {
            number += 1;
            const p = progressByLesson.get(l.id);
            const scores = l.concepts.map((c) => masteryByConcept.get(c.id)).filter((s): s is number => s !== undefined);
            return {
              id: l.id,
              title: l.title,
              description: l.description,
              order: l.order,
              number,
              status: l.status as "COMING_SOON" | "PUBLISHED",
              state: states.get(l.id) ?? "LOCKED",
              isSample: l.isSample,
              studied: p?.studied ?? false,
              completed: Boolean(p?.completedAt),
              conceptCount: l.concepts.length,
              estimatedMinutes: l.estimatedMinutes,
              assessmentState: assessmentByLesson.get(l.id) ?? "NOT_STARTED",
              mastery: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
            };
          }),
        })),
    };
  });
});

export type RoadmapLevel = {
  id: string;
  order: number;
  title: string;
  description: string | null;
  status: "ACTIVE" | "COMING_SOON";
  courseIds: string[];
};
export type Roadmap = { id: string; title: string; description: string; isSample: boolean; levels: RoadmapLevel[] };

/** The multi-level path (e.g. 7 levels, only Level 1 active in the MVP). */
export const getRoadmaps = cache(async (): Promise<Roadmap[]> => {
  const paths = await prisma.learningPath.findMany({
    orderBy: { order: "asc" },
    include: { levels: { orderBy: { order: "asc" }, include: { courses: { select: { id: true } } } } },
  });
  return paths.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    isSample: p.isSample,
    levels: p.levels.map((l) => ({
      id: l.id,
      order: l.order,
      title: l.title,
      description: l.description,
      status: l.status,
      courseIds: l.courses.map((c) => c.id),
    })),
  }));
});

export function flattenPath(courses: PathCourse[]) {
  return courses.flatMap((course) =>
    course.chapters.flatMap((chapter) => chapter.lessons.map((lesson) => ({ course, chapter, lesson }))),
  );
}

export type LessonView = NonNullable<Awaited<ReturnType<typeof getLessonView>>>;

/**
 * Everything the student lesson shell needs. Source text deliberately stays out of
 * this projection: it is resolved server-side by the assessment engine and exposed
 * in the separate admin review surface only.
 */
export const getLessonView = cache(async (userId: string, lessonId: string) => {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      chapter: { include: { course: true } },
      concepts: {
        orderBy: { order: "asc" },
        include: { passages: { where: { approved: true }, orderBy: { order: "asc" }, select: { id: true } } },
      },
    },
  });
  if (!lesson || lesson.status === "DRAFT") return null;
  if (lesson.chapter.course.levelId) {
    const level = await prisma.level.findUnique({ where: { id: lesson.chapter.course.levelId }, select: { status: true } });
    if (level?.status !== "ACTIVE") return null;
  }

  const [user, path, progress, masteries, activeSession, lastCompleted, fixedCount, measurement, measurementSession] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { evaluationGroup: true } }),
    getLearningPath(userId),
    prisma.lessonProgress.findUnique({ where: { userId_lessonId: { userId, lessonId } } }),
    prisma.conceptMastery.findMany({ where: { userId, conceptId: { in: lesson.concepts.map((c) => c.id) } } }),
    prisma.assessmentSession.findFirst({
      where: { userId, lessonId, status: "IN_PROGRESS", purpose: "PRACTICE" },
      orderBy: { startedAt: "desc" },
      select: { id: true, mode: true, _count: { select: { answers: true } } },
    }),
    prisma.assessmentSession.findFirst({
      where: { userId, lessonId, status: "COMPLETED", purpose: "PRACTICE" },
      orderBy: { completedAt: "desc" },
      select: { id: true, completedAt: true },
    }),
    prisma.fixedQuestion.count({ where: { lessonId, approved: true, sourcePassage: { approved: true } } }),
    prisma.lessonMeasurement.findUnique({ where: { userId_lessonId: { userId, lessonId } } }),
    prisma.assessmentSession.findFirst({
      where: { userId, lessonId, status: "IN_PROGRESS", purpose: { in: ["PRE_TEST", "POST_TEST"] } },
      select: { id: true, purpose: true },
    }),
  ]);

  const flat = flattenPath(path);
  const index = flat.findIndex((entry) => entry.lesson.id === lessonId);
  const pathEntry = index >= 0 ? flat[index] : undefined;
  const nextEntry = flat.slice(index + 1).find((entry) => entry.lesson.status === "PUBLISHED");

  const concepts = lesson.concepts.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    order: c.order,
    passages: c.passages,
    video: approvedVideo(c),
  }));

  return {
    lesson,
    chapter: lesson.chapter,
    course: lesson.chapter.course,
    concepts,
    hasApprovedContent: concepts.some((c) => c.passages.length > 0),
    progress,
    state: pathEntry?.lesson.state ?? ("LOCKED" as PathState),
    accessible: isAccessible(pathEntry?.lesson.state),
    number: pathEntry?.lesson.number ?? lesson.order,
    masteryByConcept: new Map(
      masteries.filter((m) => m.attempts > 0).map((m) => [m.conceptId, { score: m.masteryScore, state: m.state }]),
    ),
    measurement: lesson.measurementEnabled
      ? {
          preDone: measurement?.preScore != null,
          postDone: measurement?.postScore != null,
          preScore: measurement?.preScore ?? null,
          postScore: measurement?.postScore ?? null,
          activeSession: measurementSession,
        }
      : null,
    activeSession,
    lastCompleted,
    fixedQuestionCount: fixedCount,
    defaultMode: defaultModeFor(user.evaluationGroup),
    nextLesson: nextEntry ? { id: nextEntry.lesson.id, title: nextEntry.lesson.title, state: nextEntry.lesson.state } : null,
  };
});
