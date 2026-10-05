import type { PrismaClient } from "@/generated/prisma/client";
import { approvedVideo, type ApprovedVideo } from "@/lib/video";
import type { MasteryLevel } from "@/lib/mastery-levels";

export type ReviewTarget = {
  lesson: { id: string; title: string; isSample: boolean };
  concept: { id: string; title: string; description: string };
  /** Present only when a human approved the video and its timestamps. */
  video: ApprovedVideo | null;
  mastery: { score: number; state: MasteryLevel; attempts: number } | null;
};

/**
 * Resolves the approved video segment for a concept. Approved source passages remain
 * server-side for assessment generation and are intentionally not serialized to students.
 * Timestamps are read from human-approved metadata only.
 */
export async function getReviewTarget(db: PrismaClient, userId: string, lessonId: string, conceptId: string): Promise<ReviewTarget | null> {
  const concept = await db.concept.findFirst({
    where: { id: conceptId, lessonId, lesson: { status: "PUBLISHED" } },
    include: {
      lesson: { select: { id: true, title: true, isSample: true } },
      passages: { where: { approved: true }, select: { id: true } },
      masteries: { where: { userId } },
    },
  });
  if (!concept || concept.passages.length === 0) return null;
  const m = concept.masteries[0];
  return {
    lesson: concept.lesson,
    concept: { id: concept.id, title: concept.title, description: concept.description },
    video: approvedVideo(concept),
    mastery: m && m.attempts > 0 ? { score: m.masteryScore, state: m.state, attempts: m.attempts } : null,
  };
}

