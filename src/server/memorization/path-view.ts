import type { PrismaClient } from "@/generated/prisma/client";
import { visiblePassageWhere } from "./content";
import type { DueReview, MemorizationContinue } from "./progress";

/**
 * View model of the memorization PATH (/memorize). Pure derivations over state that already exists — nothing here
 * writes, scores, schedules or credits. Every label is a fact about stored data.
 */

/** A section's place on the path. «جارٍ» means at least one of its passages was recited and not all are «متقن». */
export type SectionPathState = "REVIEW_DUE" | "COMPLETED" | "IN_PROGRESS" | "NOT_STARTED";

export const SECTION_PATH_LABEL: Record<SectionPathState, string> = {
  REVIEW_DUE: "حان وقت مراجعته",
  COMPLETED: "متقن",
  IN_PROGRESS: "جارٍ",
  NOT_STARTED: "لم يبدأ",
};

export function sectionPathState(section: { passageCount: number; attemptedPassages: number; masteredPassages: number; dueCount: number }): SectionPathState {
  if (section.dueCount > 0) return "REVIEW_DUE";
  if (section.passageCount > 0 && section.masteredPassages === section.passageCount) return "COMPLETED";
  if (section.attemptedPassages > 0) return "IN_PROGRESS";
  return "NOT_STARTED";
}

export type MemorizeNextStep =
  | { kind: "REVIEW"; passageId: string; sectionTitle: string; passageTitle: string }
  | { kind: "START" | "CONTINUE" | "REINFORCE"; passageId: string; startUnitId: string; sectionTitle: string; passageTitle: string }
  | { kind: "DONE" };

/**
 * The single next action, in the existing priority: a due review (deterministic schedule) first, then the real
 * continue position from getMemorizationContinue. «DONE» only when neither exists.
 */
export function memorizeNextStep(attemptedPassages: number, next: MemorizationContinue | null, due: DueReview[]): MemorizeNextStep {
  const review = due[0];
  if (review) return { kind: "REVIEW", passageId: review.passageId, sectionTitle: review.sectionTitle, passageTitle: review.passageTitle };
  if (!next) return { kind: "DONE" };
  const kind = attemptedPassages === 0 ? "START" : next.kind === "FIRST" ? "CONTINUE" : "REINFORCE";
  return { kind, passageId: next.passageId, startUnitId: next.startUnitId, sectionTitle: next.sectionTitle, passageTitle: next.passageTitle };
}

/** The line under the progress bar — true statements only. */
export function memorizeProgressLine(recited: number, total: number, dueCount: number): string {
  if (dueCount > 0) return "لديك محفوظ يحتاج إلى مراجعة.";
  if (total > 0 && recited >= total) return "سمّعت كل المتاح للحفظ في هذا المتن.";
  if (recited === 0) return "كل حفظ يبدأ بمقطع صغير.";
  return "واصل من حيث توقفت.";
}

/**
 * Progress metric of the path: canonical lines (MatnUnits) of the book's VISIBLE passages that the learner has
 * recited at least once, out of all visible lines. Read-only; the denominator is the runtime truth (approved content),
 * not the size of the source file.
 */
export async function getRecitedUnitCounts(db: PrismaClient, userId: string, courseId: string): Promise<{ recited: number; total: number }> {
  const passage = { ...visiblePassageWhere, section: { status: "APPROVED" as const, courseId } };
  const [total, recited] = await Promise.all([
    db.matnUnit.count({ where: { passage } }),
    db.matnUnit.count({ where: { passage, results: { some: { attempt: { userId } } } } }),
  ]);
  return { recited, total };
}
