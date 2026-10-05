import { SELF_ASSESSMENTS, type SelfAssessment } from "./config";

export type AttemptScore = {
  totalUnits: number;
  correctUnits: number;
  incorrectUnits: number;
  forgottenUnits: number;
  /** correct / total × 100 (unrounded). */
  scorePercentage: number;
};

export function isSelfAssessment(value: unknown): value is SelfAssessment {
  return typeof value === "string" && (SELF_ASSESSMENTS as readonly string[]).includes(value);
}

/** The score of an attempt, computed only from the learner's per-unit self-assessment. Pure. */
export function scoreAttempt(statuses: readonly SelfAssessment[]): AttemptScore {
  const total = statuses.length;
  const correct = statuses.filter((s) => s === "CORRECT").length;
  const incorrect = statuses.filter((s) => s === "INCORRECT").length;
  const forgotten = statuses.filter((s) => s === "FORGOTTEN").length;
  return {
    totalUnits: total,
    correctUnits: correct,
    incorrectUnits: incorrect,
    forgottenUnits: forgotten,
    scorePercentage: total > 0 ? (correct / total) * 100 : 0,
  };
}
