import { MASTERY_RULES, type MemorizationStateKey } from "./config";
import type { AttemptScore } from "./scoring";

export type MasterySnapshot = {
  masteryScore: number;
  attempts: number;
  reviewCount: number;
  consecutiveCorrect: number;
  consecutiveWeak: number;
  errorCount: number;
  forgottenCount: number;
};

export type MasteryUpdate = MasterySnapshot & {
  state: MemorizationStateKey;
  lastScore: number;
};

export function stateFor(masteryScore: number, consecutiveCorrect: number): MemorizationStateKey {
  const r = MASTERY_RULES;
  if (masteryScore >= r.masteredMin && consecutiveCorrect >= r.masteredMinConsecutive) return "MASTERED";
  if (masteryScore >= r.goodMin) return "GOOD";
  if (masteryScore >= r.reinforcementMin) return "NEEDS_REINFORCEMENT";
  return "NEEDS_REVIEW";
}

/**
 * Deterministic memorization mastery of one passage after one attempt. Pure and fully unit-tested; the formula
 * and thresholds are documented in config.ts and docs/memorization.md.
 *
 *   first attempt:  mastery = round(score × 0.9)
 *   later attempts: mastery = round(0.6 × score + 0.4 × previous)
 *   − 3 per unit that was not CORRECT in this attempt and in the previous one (max −15)
 *   + 5 per consecutive perfect attempt beyond the first (max +10)
 *   clamped to 0–100.
 */
export function updateMastery(input: {
  previous: MasterySnapshot | null;
  attempt: AttemptScore;
  /** Units not CORRECT now AND in the previous attempt of this passage. */
  repeatedWeakUnits: number;
  /** True when the passage was due for review when the attempt was made. */
  wasDue: boolean;
}): MasteryUpdate {
  const { previous, attempt, repeatedWeakUnits, wasDue } = input;
  const r = MASTERY_RULES;
  const perfect = attempt.totalUnits > 0 && attempt.incorrectUnits === 0 && attempt.forgottenUnits === 0;

  const base = previous
    ? Math.round(r.currentWeight * attempt.scorePercentage + (1 - r.currentWeight) * previous.masteryScore)
    : Math.round(attempt.scorePercentage * r.firstAttemptFactor);

  const consecutiveCorrect = perfect ? (previous?.consecutiveCorrect ?? 0) + 1 : 0;
  const consecutiveWeak = perfect ? 0 : (previous?.consecutiveWeak ?? 0) + 1;

  const penalty = Math.min(r.maxRepeatedWeakPenalty, repeatedWeakUnits * r.repeatedWeakUnitPenalty);
  const bonus = perfect && consecutiveCorrect >= 2 ? Math.min(r.maxPerfectStreakBonus, (consecutiveCorrect - 1) * r.perfectStreakBonus) : 0;
  const masteryScore = Math.max(0, Math.min(100, base - penalty + bonus));

  return {
    masteryScore,
    state: stateFor(masteryScore, consecutiveCorrect),
    attempts: (previous?.attempts ?? 0) + 1,
    reviewCount: (previous?.reviewCount ?? 0) + (wasDue ? 1 : 0),
    consecutiveCorrect,
    consecutiveWeak,
    errorCount: (previous?.errorCount ?? 0) + attempt.incorrectUnits,
    forgottenCount: (previous?.forgottenCount ?? 0) + attempt.forgottenUnits,
    lastScore: attempt.scorePercentage,
  };
}
