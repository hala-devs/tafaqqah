import type { PrismaClient } from "@/generated/prisma/client";
import type { SessionReport } from "./report";

/**
 * Pre/post measurement (lessons with measurementEnabled):
 *   Pre-test → study → adaptive assessment → targeted review → post-test.
 * Both tests use the same human-approved fixed bank and never change mastery.
 * When each test completes we persist its score, the concepts missed, and a snapshot
 * of the learner's concept mastery at that moment. Nothing here is estimated.
 */
export type MasterySnapshot = Record<string, { score: number; state: string; attempts: number }>;

async function snapshot(db: PrismaClient, userId: string, lessonId: string): Promise<MasterySnapshot> {
  const rows = await db.conceptMastery.findMany({ where: { userId, concept: { lessonId } } });
  return Object.fromEntries(rows.map((r) => [r.conceptId, { score: r.masteryScore, state: r.state, attempts: r.attempts }]));
}

export async function recordMeasurement(
  db: PrismaClient,
  session: { id: string; userId: string; lessonId: string; purpose: string },
  report: SessionReport,
): Promise<void> {
  const key = { userId_lessonId: { userId: session.userId, lessonId: session.lessonId } };
  const mastery = await snapshot(db, session.userId, session.lessonId);
  if (session.purpose === "PRE_TEST") {
    const data = { preSessionId: session.id, preScore: report.accuracy, masteryBefore: mastery, weakBefore: report.missedConceptIds };
    await db.lessonMeasurement.upsert({ where: key, update: data, create: { userId: session.userId, lessonId: session.lessonId, ...data } });
  } else if (session.purpose === "POST_TEST") {
    const data = { postSessionId: session.id, postScore: report.accuracy, masteryAfter: mastery, weakAfter: report.missedConceptIds };
    await db.lessonMeasurement.upsert({ where: key, update: data, create: { userId: session.userId, lessonId: session.lessonId, ...data } });
  }
}
