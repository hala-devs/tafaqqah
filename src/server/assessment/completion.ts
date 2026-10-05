import { COMPLETION_RULES, DIFFICULTY_BANDS, REASSESSMENT_RULES } from "./config";

/**
 * Assessment completion rules. Pure — see tests/engine-logic.test.ts.
 *
 * A concept has *sufficient evidence* in this session when ANY holds:
 *   • 3 or more questions were asked on it
 *   • 2+ questions and the latest answer was correct
 *   • 1+ question, latest answer correct, and mastery ≥ 75
 * Two wrong answers in a row are NOT enough: a third, differently worded question is
 * asked to confirm the weakness before the concept is judged.
 *
 * Lesson assessment completes when:
 *   • 10 questions have been answered, OR
 *   • at least 5 answered AND every eligible concept was asked at least once AND has
 *     sufficient evidence, OR
 *   • no eligible concept remains (all reported insufficient source) after ≥ 1 answer.
 *
 * Reassessment (focused on concepts that need reinforcement) completes when:
 *   • 4 questions have been answered, OR
 *   • at least 2 answered AND every focus concept has sufficient evidence.
 *
 * Fixed mode (and pre/post tests) completes when every approved fixed question was answered.
 */
export type EvidenceInput = { sessionAttempts: number; lastSessionResult: boolean | null; mastery: number };

export function hasSufficientEvidence(c: EvidenceInput): boolean {
  if (c.sessionAttempts >= 3) return true;
  if (c.sessionAttempts >= 2 && c.lastSessionResult === true) return true;
  if (c.sessionAttempts >= 1 && c.lastSessionResult === true && c.mastery >= DIFFICULTY_BANDS.appliedFrom) return true;
  return false;
}

export type CompletionReason = "MAX_QUESTIONS" | "EVIDENCE_SUFFICIENT" | "NO_ELIGIBLE_CONCEPTS" | "FIXED_SET_DONE";

export type CompletionDecision = { complete: true; reason: CompletionReason } | { complete: false };

function decide(answered: number, eligible: EvidenceInput[], rules: { minQuestions: number; maxQuestions: number }): CompletionDecision {
  if (answered >= rules.maxQuestions) return { complete: true, reason: "MAX_QUESTIONS" };
  if (eligible.length === 0) return answered > 0 ? { complete: true, reason: "NO_ELIGIBLE_CONCEPTS" } : { complete: false };
  if (answered >= rules.minQuestions && eligible.every((c) => c.sessionAttempts >= 1 && hasSufficientEvidence(c))) {
    return { complete: true, reason: "EVIDENCE_SUFFICIENT" };
  }
  return { complete: false };
}

export function decideAdaptiveCompletion(answered: number, eligible: EvidenceInput[]): CompletionDecision {
  return decide(answered, eligible, COMPLETION_RULES);
}

export function decideReassessmentCompletion(answered: number, focus: EvidenceInput[]): CompletionDecision {
  return decide(answered, focus, REASSESSMENT_RULES);
}

export function decideFixedCompletion(answered: number, total: number): CompletionDecision {
  return total > 0 && answered >= total ? { complete: true, reason: "FIXED_SET_DONE" } : { complete: false };
}
