/**
 * All tuning constants for the assessment engine live here so they are easy to audit.
 * The demo lesson text in prisma/seed-data/curriculum.ts quotes several of these
 * values — keep them in sync if you change them.
 */
export const MASTERY_RULES = {
  /** Every concept starts at the middle of the scale. */
  initial: 50,
  /** Points gained for a correct answer, by question difficulty. Harder → more evidence. */
  gain: { 1: 8, 2: 12, 3: 15 } as Record<1 | 2 | 3, number>,
  /** Points lost for an incorrect answer, by difficulty. Missing an easy question says more. */
  loss: { 1: 14, 2: 12, 3: 10 } as Record<1 | 2 | 3, number>,
  /** Extra penalty when the previous answer on the same concept was also wrong. */
  repeatedErrorPenalty: 6,
  min: 0,
  max: 100,
} as const;

/** mastery < 40 → foundational (1) · 40–74 → intermediate (2) · ≥ 75 → applied (3) */
export const DIFFICULTY_BANDS = { intermediateFrom: 40, appliedFrom: 75 } as const;

export const COMPLETION_RULES = {
  minQuestions: 5,
  maxQuestions: 10,
} as const;

/** Focused re-check after targeted review («اختبر فهمي مرة أخرى»). */
export const REASSESSMENT_RULES = {
  minQuestions: 2,
  maxQuestions: 4,
} as const;

export const GENERATION_RULES = {
  /** Generator+validator rounds per question before giving up gracefully. */
  maxAttempts: 3,
  /**
   * Wall-clock budget for producing ONE question (all attempts). No new attempt starts
   * once it is exceeded — the request fails closed instead of making the learner wait.
   */
  budgetMs: 90_000,
  /** Per model call timeout (ms), always capped by the remaining budget. */
  callTimeoutMs: 45_000,
  /** Never start a model call with less time than this left in the budget. */
  minCallMs: 10_000,
  /** Concurrency lock for one session's generation (ms) — longer than the budget. */
  lockMs: 150_000,
  /** Default per-learner budget of generation requests per 10 minutes. */
  defaultRateLimitPer10Min: 40,
} as const;

export const DIFFICULTY_LABEL: Record<1 | 2 | 3, string> = {
  1: "تأسيسي",
  2: "متوسط",
  3: "تطبيقي",
};
