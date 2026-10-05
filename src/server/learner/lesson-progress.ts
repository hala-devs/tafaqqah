import "server-only";
import { prisma } from "@/server/db";
import { lessonProgressPct, lessonStages } from "@/lib/home-state";
import type { LessonView } from "@/server/content/queries";

/** Baseline (approved) questions answered in a session — follow-up checks do not move the percentage. */
export function countBaselineAnswers(sessionId: string): Promise<number> {
  return prisma.studentAnswer.count({ where: { sessionId, question: { stage: "BASELINE" } } });
}

/** Stage journey («تعلّم → اختبر → راجع → أتقن») and real progress for the lesson page. */
export async function getLessonStageInfo(view: LessonView) {
  const studied = Boolean(view.progress?.studied);
  const completed = Boolean(view.progress?.completedAt);
  const assessed = view.concepts.filter((c) => c.passages.length > 0);
  const weakInLesson = assessed.filter((c) => view.masteryByConcept.get(c.id)?.state === "NEEDS_REINFORCEMENT").length;
  const allStrong =
    assessed.length > 0 &&
    assessed.every((c) => {
      const state = view.masteryByConcept.get(c.id)?.state;
      return state === "GOOD" || state === "MASTERED";
    });
  const answered = view.activeSession ? await countBaselineAnswers(view.activeSession.id) : 0;
  return {
    stages: lessonStages({ studied, completed, weakInLesson, allStrong }),
    progressPct: lessonProgressPct({ studied, completed, answered, total: view.fixedQuestionCount }),
    weakInLesson,
  };
}
