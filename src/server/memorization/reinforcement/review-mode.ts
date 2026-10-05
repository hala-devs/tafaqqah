/**
 * Evaluation condition of a reinforcement session.
 *
 * Every learner gets AI_ADAPTIVE_REVIEW. BASELINE_REVIEW (review the marked canonical units, no AI, no exercises) exists
 * only for a future comparison and is assigned exclusively from server configuration: a learner id must be listed in
 * REINFORCEMENT_BASELINE_USER_IDS. No route, query parameter, form field or learner setting can select it.
 */

export const REVIEW_MODES = ["AI_ADAPTIVE_REVIEW", "BASELINE_REVIEW"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

export function resolveReviewMode(userId: string, env: Record<string, string | undefined> = process.env): ReviewMode {
  const listed = (env.REINFORCEMENT_BASELINE_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return listed.includes(userId) ? "BASELINE_REVIEW" : "AI_ADAPTIVE_REVIEW";
}
