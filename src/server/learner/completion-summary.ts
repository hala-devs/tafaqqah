import type { PrismaClient } from "@/generated/prisma/client";
import { monthPeriod, weekPeriod } from "@/lib/learning-time";
import type { SessionReport } from "@/server/assessment/report";
import { getMotivation, type GoalProgress, type Motivation } from "./motivation";

export type CompletionSummary = {
  /** Concepts that ended the lesson «متقن» without needing the review loop. */
  mastered: number;
  /** Concepts the learner missed, reviewed and then answered correctly after the review. */
  stabilized: number;
  totalQuestions: number;
  streak: Motivation["streak"];
  weekly: (GoalProgress & { before: number }) | null;
  monthly: (GoalProgress & { before: number; kind: "LESSONS" | "CONCEPTS"; monthName: string }) | null;
};

/**
 * Real numbers for the lesson-completion moment, all derived from stored data:
 * the frozen session report, the answers given after a review, the streak and the goals.
 *
 * `before` is the goal value just before this lesson was completed — it is only different from the
 * current value when this very session first completed the lesson inside the current week/month.
 */
export async function getCompletionSummary(
  db: PrismaClient,
  userId: string,
  session: { id: string; completedAt: Date | null },
  lessonCompletedAt: Date | null,
  report: SessionReport,
  now: Date = new Date(),
): Promise<CompletionSummary> {
  const [motivation, afterReview] = await Promise.all([
    getMotivation(db, userId, now),
    db.generatedQuestion.findMany({
      where: { sessionId: session.id, stage: "REASSESSMENT", answer: { is: { correct: true } } },
      select: { conceptId: true },
    }),
  ]);
  const strong = new Set(report.concepts.filter((c) => c.status === "STRONG").map((c) => c.conceptId));
  const stabilizedIds = new Set(afterReview.map((q) => q.conceptId).filter((id) => strong.has(id)));

  const tz = motivation.settings.timezone;
  const completedAt = session.completedAt;
  const firstCompletion = Boolean(completedAt && lessonCompletedAt && completedAt.getTime() === lessonCompletedAt.getTime());
  const inPeriod = (p: { start: Date; end: Date }) => Boolean(firstCompletion && completedAt && completedAt >= p.start && completedAt < p.end);
  const weekCounted = inPeriod(weekPeriod(now, tz));
  const monthCounted = inPeriod(monthPeriod(now, tz));

  const weekly = motivation.weekly ? { ...motivation.weekly, before: Math.max(0, motivation.weekly.current - (weekCounted ? 1 : 0)) } : null;
  const monthly = motivation.monthly
    ? {
        ...motivation.monthly,
        before: Math.max(0, motivation.monthly.current - (motivation.monthly.kind === "LESSONS" && monthCounted ? 1 : 0)),
      }
    : null;

  return {
    mastered: [...strong].filter((id) => !stabilizedIds.has(id)).length,
    stabilized: stabilizedIds.size,
    totalQuestions: report.totalQuestions,
    streak: motivation.streak,
    weekly,
    monthly,
  };
}
