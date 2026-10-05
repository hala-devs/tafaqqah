/**
 * Memorization («حفظ المتن») rules — the single place where every threshold, weight and interval lives.
 * All of it is deterministic application code: no AI ever reads or overrides these values, and nothing here
 * claims to be scientifically validated. It is a simple, transparent policy documented in docs/memorization.md.
 */

export type SelfAssessment = "CORRECT" | "INCORRECT" | "FORGOTTEN";
export type MemorizationStateKey = "NEEDS_REVIEW" | "NEEDS_REINFORCEMENT" | "GOOD" | "MASTERED";

export const SELF_ASSESSMENTS: readonly SelfAssessment[] = ["CORRECT", "INCORRECT", "FORGOTTEN"];

export const SELF_ASSESSMENT_LABEL: Record<SelfAssessment, string> = {
  CORRECT: "صحيح",
  INCORRECT: "أخطأت",
  FORGOTTEN: "لم أتذكر",
};

export const MEMORIZATION_STATE_LABEL: Record<MemorizationStateKey, string> = {
  MASTERED: "متقن",
  GOOD: "جيد",
  NEEDS_REINFORCEMENT: "يحتاج إلى تثبيت",
  NEEDS_REVIEW: "يحتاج إلى مراجعة",
};

/** Worst → best, used to prioritise what to review first. */
export const STATE_RANK: Record<MemorizationStateKey, number> = { NEEDS_REVIEW: 0, NEEDS_REINFORCEMENT: 1, GOOD: 2, MASTERED: 3 };

// ───────────────────────────── Mastery (per passage, 0–100) ─────────────────────────────

export const MASTERY_RULES = {
  /**
   * First attempt: mastery = round(score × FIRST_ATTEMPT_FACTOR). One recitation alone can never reach «متقن»
   * (it also needs consecutive perfect attempts), and a perfect first attempt starts at 90.
   */
  firstAttemptFactor: 0.9,
  /** Later attempts: mastery = round(CURRENT_WEIGHT × score + (1 − CURRENT_WEIGHT) × previousMastery). */
  currentWeight: 0.6,
  /** For every unit that was not CORRECT in this attempt AND in the previous one: −3, capped at −15 per attempt. */
  repeatedWeakUnitPenalty: 3,
  maxRepeatedWeakPenalty: 15,
  /** From the 2nd consecutive perfect attempt: +5 for each consecutive perfect attempt beyond the first, capped at +10. */
  perfectStreakBonus: 5,
  maxPerfectStreakBonus: 10,
  /** State thresholds (inclusive). MASTERED additionally needs MASTERED_MIN_CONSECUTIVE perfect attempts in a row. */
  masteredMin: 90,
  masteredMinConsecutive: 2,
  goodMin: 75,
  reinforcementMin: 50,
} as const;

// ───────────────────────────── Spaced review ─────────────────────────────

export const REVIEW_RULES = {
  /** Any unit FORGOTTEN in the attempt → review again after this many hours (same day). */
  forgottenHours: 4,
  /** Otherwise any unit INCORRECT → review at the start of the learner's local day this many days ahead. */
  incorrectDays: 1,
  /**
   * Otherwise (every unit CORRECT): days until review, indexed by consecutive perfect attempts (1 → first value,
   * 2 → second …, capped at the last value). Day-based intervals land on the start of the learner's local day.
   */
  correctLadderDays: [3, 7, 14, 30, 60],
  /** Repeated weakness (the same unit not CORRECT twice in a row, or two weak attempts in a row) never waits longer than this. */
  repeatedWeaknessMaxHours: 12,
} as const;

/** Minimum number of PREVIOUS attempts before any trend (improving / declining / recovered) may be described. */
export const MIN_PREVIOUS_ATTEMPTS_FOR_TREND = 1;
/** How much history the analysis receives. */
export const ANALYSIS_HISTORY = { recentAttempts: 5, previousOutcomesPerUnit: 5, maxWeakUnits: 8 } as const;
/** The analysis is optional: past this budget the learner gets the deterministic result alone. */
export const ANALYSIS_TIMEOUT_MS = 12_000;

/** Passage list sizes shown on the review screen. */
export const DUE_REVIEW_LIMIT = 50;
