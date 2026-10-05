import type { PrismaClient } from "@/generated/prisma/client";
import { getBookHome, type SectionCard } from "./content";
import { getRecitedUnitCounts, memorizeNextStep, type MemorizeNextStep } from "./path-view";
import { getDueReviews, getMemorizationContinue, type MemorizationSummary } from "./progress";

export type MatnJourneyData = {
  courseId: string;
  title: string;
  madhhab: string | null;
  levelOrder: number | null;
  levelTitle: string | null;
  recited: number;
  total: number;
  dueCount: number;
  step: MemorizeNextStep;
  sections: SectionCard[];
};

/**
 * Everything one Matn journey shows, from the existing read functions only (no writes, no scoring, no scheduling).
 * Returns null when the book has no approved, visible Matn.
 */
export async function loadMatnJourney(db: PrismaClient, userId: string, courseId: string, summaries: MemorizationSummary[], now: Date): Promise<MatnJourneyData | null> {
  const summary = summaries.find((s) => s.courseId === courseId);
  if (!summary) return null;
  const [home, course, next, due, counts] = await Promise.all([
    getBookHome(db, userId, courseId, now),
    db.course.findUnique({ where: { id: courseId }, select: { madhhab: true, level: { select: { order: true, title: true } } } }),
    getMemorizationContinue(db, userId, courseId),
    getDueReviews(db, userId, now, 1, courseId),
    getRecitedUnitCounts(db, userId, courseId),
  ]);
  if (!home) return null;
  return {
    courseId,
    title: home.course.title,
    madhhab: course?.madhhab ?? null,
    levelOrder: course?.level?.order ?? null,
    levelTitle: course?.level?.title ?? null,
    recited: counts.recited,
    total: counts.total,
    dueCount: summary.dueCount,
    step: memorizeNextStep(summary.attemptedPassages, next, summary.dueCount > 0 ? due : []),
    sections: home.sections,
  };
}
