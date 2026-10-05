import { addDays, dayKey, startOfDayUtc } from "@/lib/learning-time";
import { REVIEW_RULES } from "./config";

export type ReviewRule = "FORGOTTEN" | "INCORRECT" | "CORRECT_LADDER";

export type ReviewSchedule = {
  nextReviewAt: Date;
  rule: ReviewRule;
  /** True when repeated weakness shortened the interval. */
  cappedByRepeatedWeakness: boolean;
};

const HOUR_MS = 3_600_000;

/**
 * The next review date of a passage. Deterministic (no AI). Day-based intervals land on the start of the
 * learner's LOCAL day (so «غدًا» means from local midnight, whatever the server's timezone); hour-based ones are exact.
 *
 *   any unit FORGOTTEN          → +4 hours
 *   else any unit INCORRECT     → +1 day
 *   else (all CORRECT)          → ladder by consecutive perfect attempts: 3, 7, 14, 30, 60 days
 *   repeated weakness           → never later than +12 hours
 */
export function computeNextReview(input: {
  now: Date;
  timezone: string;
  forgottenUnits: number;
  incorrectUnits: number;
  consecutiveCorrect: number;
  repeatedWeakness: boolean;
}): ReviewSchedule {
  const { now, timezone, forgottenUnits, incorrectUnits, consecutiveCorrect, repeatedWeakness } = input;
  const inDays = (days: number) => startOfDayUtc(addDays(dayKey(now, timezone), days), timezone);

  let rule: ReviewRule;
  let at: Date;
  if (forgottenUnits > 0) {
    rule = "FORGOTTEN";
    at = new Date(now.getTime() + REVIEW_RULES.forgottenHours * HOUR_MS);
  } else if (incorrectUnits > 0) {
    rule = "INCORRECT";
    at = inDays(REVIEW_RULES.incorrectDays);
  } else {
    rule = "CORRECT_LADDER";
    const ladder = REVIEW_RULES.correctLadderDays;
    const step = Math.min(Math.max(consecutiveCorrect, 1), ladder.length) - 1;
    at = inDays(ladder[step]);
  }

  let capped = false;
  if (repeatedWeakness) {
    const ceiling = new Date(now.getTime() + REVIEW_RULES.repeatedWeaknessMaxHours * HOUR_MS);
    if (at.getTime() > ceiling.getTime()) {
      at = ceiling;
      capped = true;
    }
  }
  return { nextReviewAt: at, rule, cappedByRepeatedWeakness: capped };
}

/** «بعد ٤ ساعات» / «غدًا» / «بعد ٣ أيام» — derived from the stored dates and the learner's timezone. */
export function describeReviewDelay(from: Date, to: Date, timezone: string): { kind: "now" | "hours" | "days"; amount: number } {
  const diff = to.getTime() - from.getTime();
  if (diff <= 0) return { kind: "now", amount: 0 };
  const hours = diff / HOUR_MS;
  if (hours < 24) return { kind: "hours", amount: Math.max(1, Math.round(hours)) };
  const a = dayKey(from, timezone);
  const b = dayKey(to, timezone);
  let days = 0;
  for (let cursor = a; cursor < b && days < 400; cursor = addDays(cursor, 1)) days += 1;
  return { kind: "days", amount: Math.max(1, days) };
}
