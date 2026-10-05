import "server-only";
import { cache } from "react";
import { prisma } from "@/server/db";
import type { MasteryLevel } from "@/lib/mastery-levels";
import { approvedVideo, type ApprovedVideo } from "@/lib/video";
import { readReport, type SessionReport } from "@/server/assessment/report";
import { flattenPath, getLearningPath } from "@/server/content/queries";

export type WeakConcept = {
  conceptId: string;
  conceptTitle: string;
  lessonId: string;
  lessonTitle: string;
  /** The book (course) the lesson belongs to — review items always name their source. */
  bookTitle: string;
  mastery: number;
  state: MasteryLevel;
  attempts: number;
  video: ApprovedVideo | null;
};

/** Concepts in the «يحتاج إلى تثبيت» state (repeated evidence of misunderstanding) — real data only. */
export const getWeakConcepts = cache(async (userId: string, limit?: number): Promise<WeakConcept[]> => {
  const rows = await prisma.conceptMastery.findMany({
    where: { userId, attempts: { gt: 0 }, state: "NEEDS_REINFORCEMENT", concept: { lesson: { status: "PUBLISHED" } } },
    orderBy: [{ masteryScore: "asc" }, { updatedAt: "desc" }],
    take: limit,
    include: {
      concept: {
        include: {
          lesson: { select: { id: true, title: true, chapter: { select: { course: { select: { title: true } } } } } },
        },
      },
    },
  });
  return rows.map((row) => ({
    conceptId: row.conceptId,
    conceptTitle: row.concept.title,
    lessonId: row.concept.lesson.id,
    lessonTitle: row.concept.lesson.title,
    bookTitle: row.concept.lesson.chapter.course.title,
    mastery: row.masteryScore,
    state: row.state,
    attempts: row.attempts,
    video: approvedVideo(row.concept),
  }));
});

export type CompletedAttempt = {
  sessionId: string;
  lessonId: string;
  lessonTitle: string;
  completedAt: Date;
  mode: "ADAPTIVE" | "FIXED";
  purpose: "PRACTICE" | "PRE_TEST" | "POST_TEST" | "REASSESSMENT";
  report: SessionReport | null;
};

export const getCompletedAttempts = cache(async (userId: string, limit = 20): Promise<CompletedAttempt[]> => {
  const sessions = await prisma.assessmentSession.findMany({
    where: { userId, status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    take: limit,
    include: { lesson: { select: { title: true } } },
  });
  return sessions.map((s) => ({
    sessionId: s.id,
    lessonId: s.lessonId,
    lessonTitle: s.lesson.title,
    completedAt: s.completedAt ?? s.startedAt,
    mode: s.mode,
    purpose: s.purpose,
    report: readReport(s.report),
  }));
});

export type LessonMastery = {
  lessonId: string;
  lessonTitle: string;
  concepts: { id: string; title: string; mastery: number | null; state: MasteryLevel | null; attempts: number }[];
};

/** Per-lesson concept mastery for published lessons (null = not assessed yet). */
export const getMasteryByLesson = cache(async (userId: string): Promise<LessonMastery[]> => {
  const lessons = await prisma.lesson.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ chapter: { course: { order: "asc" } } }, { chapter: { order: "asc" } }, { order: "asc" }],
    include: {
      concepts: {
        where: { passages: { some: { approved: true } } },
        orderBy: { order: "asc" },
        include: { masteries: { where: { userId } } },
      },
    },
  });
  return lessons.map((lesson) => ({
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    concepts: lesson.concepts.map((c) => {
      const m = c.masteries[0];
      const assessed = Boolean(m && m.attempts > 0);
      return {
        id: c.id,
        title: c.title,
        mastery: assessed ? m.masteryScore : null,
        state: assessed ? m.state : null,
        attempts: m?.attempts ?? 0,
      };
    }),
  }));
});

/** The lesson "أكمل رحلتك" should point to, with its stage. */
export async function getCurrentStep(userId: string) {
  const path = await getLearningPath(userId);
  const flat = flattenPath(path);
  const entry = flat.find((e) => e.lesson.state === "CURRENT") ?? null;
  if (!entry) return { path, entry: null, activeSessionId: null, allCompleted: flat.some((e) => e.lesson.completed) };
  const active = await prisma.assessmentSession.findFirst({
    where: { userId, lessonId: entry.lesson.id, status: "IN_PROGRESS" },
    select: { id: true },
  });
  return { path, entry, activeSessionId: active?.id ?? null, allCompleted: false };
}
