import type { PrismaClient } from "@/generated/prisma/client";

/**
 * «نشاطي الأخير»: a read-only merge of records that already carry a real completion time — lesson study and
 * completion (LessonProgress), completed assessments (AssessmentSession), and completed recitations
 * (RecitationAttempt). Nothing is inferred: a type without a persisted timestamp is simply not shown.
 */
export type ActivityKind = "LESSON_STUDIED" | "LESSON_COMPLETED" | "ASSESSMENT" | "REASSESSMENT" | "RECITATION" | "RECITATION_REVIEW";
export type ActivityItem = { id: string; kind: ActivityKind; journey: "UNDERSTANDING" | "MEMORIZATION"; title: string; at: Date };

const PER_SOURCE = 8;

/** Newest first, ties broken by id so the order is deterministic. */
export function mergeActivity(groups: ActivityItem[][], limit: number): ActivityItem[] {
  return groups
    .flat()
    .sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function activityText(item: ActivityItem): string {
  switch (item.kind) {
    case "LESSON_STUDIED":
      return `درست شرح ${item.title}`;
    case "LESSON_COMPLETED":
      return `أكملت ${item.title}`;
    case "ASSESSMENT":
      return `أتممت اختبار الفهم: ${item.title}`;
    case "REASSESSMENT":
      return `أعدت اختبار مفاهيم: ${item.title}`;
    case "RECITATION":
      return `أتممت تسميع: ${item.title}`;
    case "RECITATION_REVIEW":
      return `راجعت محفوظك: ${item.title}`;
  }
}

export async function getRecentActivity(db: PrismaClient, userId: string, limit = 6): Promise<ActivityItem[]> {
  const [studied, completed, sessions, recitations] = await Promise.all([
    db.lessonProgress.findMany({ where: { userId, studiedAt: { not: null } }, orderBy: { studiedAt: "desc" }, take: PER_SOURCE, select: { id: true, studiedAt: true, lesson: { select: { title: true } } } }),
    db.lessonProgress.findMany({ where: { userId, completedAt: { not: null } }, orderBy: { completedAt: "desc" }, take: PER_SOURCE, select: { id: true, completedAt: true, lesson: { select: { title: true } } } }),
    db.assessmentSession.findMany({ where: { userId, status: "COMPLETED", completedAt: { not: null } }, orderBy: { completedAt: "desc" }, take: PER_SOURCE, select: { id: true, purpose: true, completedAt: true, lesson: { select: { title: true } } } }),
    db.recitationAttempt.findMany({ where: { userId }, orderBy: { completedAt: "desc" }, take: PER_SOURCE, select: { id: true, kind: true, completedAt: true, passage: { select: { title: true, section: { select: { title: true } } } } } }),
  ]);
  return mergeActivity(
    [
      studied.map((r) => ({ id: `s-${r.id}`, kind: "LESSON_STUDIED" as const, journey: "UNDERSTANDING" as const, title: r.lesson.title, at: r.studiedAt! })),
      completed.map((r) => ({ id: `c-${r.id}`, kind: "LESSON_COMPLETED" as const, journey: "UNDERSTANDING" as const, title: r.lesson.title, at: r.completedAt! })),
      sessions.map((r) => ({ id: `a-${r.id}`, kind: r.purpose === "REASSESSMENT" ? ("REASSESSMENT" as const) : ("ASSESSMENT" as const), journey: "UNDERSTANDING" as const, title: r.lesson.title, at: r.completedAt! })),
      recitations.map((r) => ({
        id: `r-${r.id}`,
        kind: r.kind === "REVIEW" ? ("RECITATION_REVIEW" as const) : ("RECITATION" as const),
        journey: "MEMORIZATION" as const,
        title: `${r.passage.section.title} — ${r.passage.title}`,
        at: r.completedAt,
      })),
    ],
    limit,
  );
}
