import type { SelfAssessment } from "@/server/memorization/config";

export type AssessmentScope = "WORDS" | "FULL_UNIT";
/**
 * `wordIndexes` remains the persisted incorrect-word field for backward compatibility.
 * `forgottenWordIndexes` is deliberately separate so one canonical token can have one
 * explicit state while a unit can truthfully contain both kinds of weakness.
 */
export type AssessmentDetail = { status: SelfAssessment; scope: AssessmentScope | null; wordIndexes: number[]; forgottenWordIndexes?: number[] };

export type WordAssessmentKind = "INCORRECT" | "FORGOTTEN";

/** Presentation facts for a prior self-assessment. Keep the two persisted word-state columns independent. */
export type PreviousAssessmentDetail = Pick<AssessmentDetail, "status" | "scope" | "wordIndexes" | "forgottenWordIndexes">;

export function previousWordAssessmentKind(detail: PreviousAssessmentDetail | undefined, index: number): WordAssessmentKind | null {
  if (detail?.scope !== "WORDS") return null;
  if (detail.wordIndexes.includes(index)) return "INCORRECT";
  if ((detail.forgottenWordIndexes ?? []).includes(index)) return "FORGOTTEN";
  return null;
}

export function previousAssessmentCopy(detail: PreviousAssessmentDetail | undefined): string | null {
  if (!detail) return null;
  if (detail.scope === "FULL_UNIT") return detail.status === "INCORRECT" ? "المقطع كاملًا يحتاج إلى تصحيح." : "لم تتذكر هذا المقطع في التسميع السابق.";
  if (detail.scope !== "WORDS") return null;
  const hasIncorrect = detail.wordIndexes.length > 0;
  const hasForgotten = (detail.forgottenWordIndexes ?? []).length > 0;
  if (hasIncorrect && hasForgotten) return "مواضع الخطأ والنسيان في تسميعك السابق.";
  if (hasIncorrect) return "الكلمات التي أخطأت فيها في تسميعك السابق.";
  return hasForgotten ? "الكلمات التي لم تتذكرها في تسميعك السابق." : null;
}

export function derivedAssessmentStatus(wordIndexes: number[], forgottenWordIndexes: number[]): SelfAssessment {
  return forgottenWordIndexes.length > 0 ? "FORGOTTEN" : wordIndexes.length > 0 ? "INCORRECT" : "INCORRECT";
}

/** A status change always resets the detail, preventing stale selections. */
export function changeAssessmentStatus(status: SelfAssessment): AssessmentDetail {
  return { status, scope: null, wordIndexes: [], forgottenWordIndexes: [] };
}

export function changeAssessmentScope(detail: AssessmentDetail, scope: AssessmentScope): AssessmentDetail {
  return { ...detail, scope, wordIndexes: [], forgottenWordIndexes: [] };
}

/** Enters clean word-selection mode; no hidden draft selections survive a mode change. */
export function startWordAssessment(): AssessmentDetail {
  return { status: "INCORRECT", scope: "WORDS", wordIndexes: [], forgottenWordIndexes: [] };
}

export function toggleAssessmentWord(detail: AssessmentDetail, index: number, kind: WordAssessmentKind = detail.status === "FORGOTTEN" ? "FORGOTTEN" : "INCORRECT"): AssessmentDetail {
  const forgotten = detail.forgottenWordIndexes ?? [];
  const inThisKind = kind === "INCORRECT" ? detail.wordIndexes : forgotten;
  const inOtherKind = kind === "INCORRECT" ? forgotten : detail.wordIndexes;
  const nextThis = inThisKind.includes(index) ? inThisKind.filter((value) => value !== index) : [...inThisKind, index].sort((a, b) => a - b);
  const nextOther = inOtherKind.filter((value) => value !== index);
  const wordIndexes = kind === "INCORRECT" ? nextThis : nextOther;
  const forgottenWordIndexes = kind === "FORGOTTEN" ? nextThis : nextOther;
  return { status: derivedAssessmentStatus(wordIndexes, forgottenWordIndexes), scope: "WORDS", wordIndexes, forgottenWordIndexes };
}

/** Pure client/server validation; the server additionally checks its canonical unit token count. */
export function isAssessmentDetailShape(value: AssessmentDetail): boolean {
  const forgotten = value.forgottenWordIndexes ?? [];
  const noWordMarks = value.wordIndexes.length === 0 && forgotten.length === 0;
  if (value.status === "CORRECT") return value.scope === null && noWordMarks;
  if (value.scope === "FULL_UNIT") return noWordMarks;
  return value.scope === "WORDS" && !noWordMarks && value.status === derivedAssessmentStatus(value.wordIndexes, forgotten);
}
