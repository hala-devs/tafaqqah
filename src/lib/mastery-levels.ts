/**
 * Human-readable learning states. The numeric score (0–100) is an internal, explainable
 * educational indicator; the UI leads with these labels.
 *
 * NEEDS_REINFORCEMENT («يحتاج إلى تثبيت») is never derived from a score alone — it requires
 * repeated evidence of misunderstanding (see src/server/assessment/mastery.ts → classifyState).
 */
export type MasteryLevel = "NEEDS_REINFORCEMENT" | "LEARNING" | "GOOD" | "MASTERED";

export const MASTERY_THRESHOLDS = {
  good: 60,
  mastered: 80,
} as const;

/** Score-only level, used for aggregates (lesson averages). Never returns NEEDS_REINFORCEMENT. */
export function scoreLevel(score: number): MasteryLevel {
  if (score >= MASTERY_THRESHOLDS.mastered) return "MASTERED";
  if (score >= MASTERY_THRESHOLDS.good) return "GOOD";
  return "LEARNING";
}

export type Tone = "warning" | "ink" | "sage" | "success";

export const MASTERY_LEVEL_META: Record<MasteryLevel, { label: string; tone: Tone; step: 1 | 2 | 3 | 4; hint: string }> = {
  NEEDS_REINFORCEMENT: {
    label: "يحتاج إلى تثبيت",
    tone: "warning",
    step: 1,
    hint: "تكرّر الخطأ في هذا الجزء؛ راجع موضعه في الدرس ثم اختبر فهمك مرة أخرى.",
  },
  LEARNING: { label: "قيد التعلّم", tone: "ink", step: 2, hint: "فهمك يتشكّل؛ بعض الأسئلة الإضافية ستثبّته." },
  GOOD: { label: "جيد", tone: "sage", step: 3, hint: "أظهرت فهمًا جيدًا لهذا الجزء." },
  MASTERED: { label: "متقن", tone: "success", step: 4, hint: "أظهرت إجاباتك إتقانًا ثابتًا لهذا الجزء." },
};

/** Rounded to the nearest 5 to avoid implying false precision. */
export function approximatePercent(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score / 5) * 5));
}

