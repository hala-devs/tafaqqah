import type { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_TIMEZONE, dayKey } from "@/lib/learning-time";

/**
 * Records that real learning happened today (learner's local day). Idempotent: the same day is
 * never counted twice, which is what keeps the streak honest. Logging in never calls this —
 * only a studied lesson, a completed assessment or a completed focused reassessment does.
 *
 * It must never break the learning flow it is attached to, so failures are logged and swallowed.
 */
export async function recordLearningDay(db: PrismaClient, userId: string, now: Date = new Date()): Promise<void> {
  try {
    const settings = await db.learnerSettings.findUnique({ where: { userId }, select: { timezone: true } });
    const day = dayKey(now, settings?.timezone ?? DEFAULT_TIMEZONE);
    await db.learningDay.createMany({ data: [{ userId, day }], skipDuplicates: true });
  } catch (error) {
    console.error("[learning-day] could not record activity", error instanceof Error ? error.message : error);
  }
}
