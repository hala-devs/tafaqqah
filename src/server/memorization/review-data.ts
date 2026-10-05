import type { PrismaClient } from "@/generated/prisma/client";
import { canonicalResultOrder, visiblePassageWhere } from "./content";
import type { MemorizationStateKey } from "./config";
import { getDueReviews, type DueReview } from "./progress";

/**
 * Read-only data for the memorization side of /review. Due-ness comes from the stored deterministic schedule
 * (getDueReviews); «يحتاج إلى تثبيت» comes from the stored mastery state. Nothing is scored, scheduled or written.
 */

/** One non-correct line from the learner's latest recitation of a passage, exactly as saved (word indexes included). */
export type LineDetail = { unitId: string; unitOrder: number; text: string; status: "INCORRECT" | "FORGOTTEN"; scope: "WORDS" | "FULL_UNIT" | null; wordIndexes: number[]; forgottenWordIndexes: number[] };

export type MemorizationReviewItem = {
  passageId: string;
  passageTitle: string;
  sectionTitle: string;
  bookTitle: string;
  state: MemorizationStateKey;
  /** The stored schedule says the review is due now. */
  due: boolean;
  repeatedWeakness: boolean;
  /** The stored next review time (real, never estimated). */
  nextReviewAt: Date;
  details: LineDetail[];
};

const WEAK_STATES: MemorizationStateKey[] = ["NEEDS_REINFORCEMENT", "NEEDS_REVIEW"];

export async function getMemorizationReviewData(db: PrismaClient, userId: string, now: Date) {
  const [due, reinforceRows, upcoming] = await Promise.all([
    getDueReviews(db, userId, now),
    db.memorizationMastery.findMany({
      where: { userId, state: { in: WEAK_STATES }, nextReviewAt: { gt: now }, passage: visiblePassageWhere },
      orderBy: { masteryScore: "asc" },
      include: { passage: { select: { title: true, section: { select: { title: true, course: { select: { title: true } } } } } } },
    }),
    db.memorizationMastery.findFirst({ where: { userId, nextReviewAt: { gt: now }, passage: visiblePassageWhere }, orderBy: { nextReviewAt: "asc" }, select: { nextReviewAt: true } }),
  ]);

  const items: Omit<MemorizationReviewItem, "details">[] = [
    ...due.map((d: DueReview) => ({ passageId: d.passageId, passageTitle: d.passageTitle, sectionTitle: d.sectionTitle, bookTitle: d.courseTitle, state: d.state, due: true, repeatedWeakness: d.repeatedWeakness, nextReviewAt: d.dueAt })),
    ...reinforceRows.map((m) => ({ passageId: m.passageId, passageTitle: m.passage.title, sectionTitle: m.passage.section.title, bookTitle: m.passage.section.course.title, state: m.state, due: false, repeatedWeakness: m.consecutiveWeak >= 2, nextReviewAt: m.nextReviewAt })),
  ];

  // The latest attempt of each listed passage: its non-correct lines with the saved scope and word indexes.
  const attempts = items.length
    ? await db.recitationAttempt.findMany({
        where: { userId, passageId: { in: items.map((i) => i.passageId) } },
        orderBy: { completedAt: "desc" },
        distinct: ["passageId"],
        select: {
          passageId: true,
          results: {
            where: { selfAssessmentStatus: { not: "CORRECT" } },
            orderBy: canonicalResultOrder,
            select: { unitId: true, selfAssessmentStatus: true, selfAssessmentScope: true, wordIndexes: true, forgottenWordIndexes: true, unit: { select: { order: true, canonicalText: true } } },
          },
        },
      })
    : [];
  const detailsByPassage = new Map(
    attempts.map((a) => [
      a.passageId,
      a.results
        .map((r) => ({ unitId: r.unitId, unitOrder: r.unit.order, text: r.unit.canonicalText, status: r.selfAssessmentStatus as LineDetail["status"], scope: r.selfAssessmentScope, wordIndexes: r.wordIndexes, forgottenWordIndexes: r.forgottenWordIndexes })),
    ]),
  );

  return {
    items: items.map((i) => ({ ...i, details: detailsByPassage.get(i.passageId) ?? [] })) as MemorizationReviewItem[],
    nextReviewAt: upcoming?.nextReviewAt ?? null,
  };
}
