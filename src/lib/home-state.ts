import { ar } from "@/lib/format";

/**
 * Deterministic student-home state. No AI: every message below is chosen by plain rules over real
 * learner data, so the same data always renders the same page (and the rules are unit-tested).
 */

export type StageKey = "LEARN" | "ASSESS" | "REVIEW" | "REASSESS" | "DONE" | "MEMORIZE";

export const STAGE_LABEL: Record<StageKey, string> = {
  LEARN: "مرحلة التعلّم",
  ASSESS: "مرحلة اختبار الفهم",
  REVIEW: "مرحلة المراجعة",
  REASSESS: "مرحلة إعادة التقييم",
  DONE: "أتممت الدروس المتاحة",
  MEMORIZE: "مرحلة الحفظ",
};

export type HomeStateInput = {
  /** Anything real has happened: studied lesson, assessment answer or learning day. */
  hasAnyActivity: boolean;
  hasContinueTarget: boolean;
  weakCount: number;
  streakCount: number;
  streakActiveToday: boolean;
  weekly: { remaining: number; done: boolean; target: number } | null;
};

export type HomeState = {
  phase: "NEW" | "IN_PROGRESS" | "ALL_DONE";
  /** The one short motivational line of the page (null = say nothing). */
  note: { kind: "GOAL_DONE" | "GOAL_CLOSE" | "STREAK_SAVED" | "STREAK_AT_RISK" | "LEVEL"; text: string } | null;
  heroEyebrow: string;
  ctaLabel: string;
  hasWeak: boolean;
};


export function streakPhrase(count: number): string {
  if (count === 1) return "يوم واحد من التعلّم";
  if (count === 2) return "يومان متتاليان";
  return count <= 10 ? `${ar(count)} أيام متتالية` : `${ar(count)} يومًا متتاليًا`;
}

export function deriveHomeState(input: HomeStateInput): HomeState {
  const phase: HomeState["phase"] = !input.hasAnyActivity && input.hasContinueTarget ? "NEW" : input.hasContinueTarget || input.weakCount > 0 ? "IN_PROGRESS" : "ALL_DONE";

  let note: HomeState["note"] = null;
  const w = input.weekly;
  if (w?.done) note = { kind: "GOAL_DONE", text: "أتممت هدفك الأسبوعي ✓" };
  else if (w && w.remaining === 1) note = { kind: "GOAL_CLOSE", text: "باقي لك درس واحد لتحقيق هدفك." };
  else if (input.streakCount >= 2 && input.streakActiveToday) note = { kind: "STREAK_SAVED", text: "عودتك اليوم حافظت على سلسلة تعلّمك." };
  else if (input.streakCount >= 1 && !input.streakActiveToday) note = { kind: "STREAK_AT_RISK", text: "خطوة اليوم تحفظ سلسلة تعلّمك." };
  else if (phase === "IN_PROGRESS") note = { kind: "LEVEL", text: "خطوة اليوم تقرّبك من إتمام المستوى." };

  return {
    phase,
    note,
    heroEyebrow: phase === "NEW" ? "ابدأ رحلتك" : phase === "ALL_DONE" ? "أحسنت" : "واصل من حيث توقفت",
    ctaLabel: phase === "NEW" ? "ابدأ التعلّم" : "متابعة التعلّم",
    hasWeak: input.weakCount > 0,
  };
}

/** Where the learner stands within one lesson: learn → test → review → master. */
export type LessonStageState = "done" | "current" | "upcoming";
export type LessonStages = { key: "LEARN" | "TEST" | "REVIEW" | "MASTER"; label: string; state: LessonStageState }[];

export function lessonStages(input: {
  studied: boolean;
  completed: boolean;
  weakInLesson: number;
  allStrong: boolean;
}): LessonStages {
  const { studied, completed, weakInLesson, allStrong } = input;
  const reviewState: LessonStageState = !completed ? "upcoming" : weakInLesson > 0 ? "current" : "done";
  const masterState: LessonStageState = !completed || weakInLesson > 0 ? "upcoming" : allStrong ? "done" : "current";
  return [
    { key: "LEARN", label: "تعلّم", state: studied || completed ? "done" : "current" },
    { key: "TEST", label: "اختبر", state: completed ? "done" : studied ? "current" : "upcoming" },
    { key: "REVIEW", label: "راجع", state: reviewState },
    { key: "MASTER", label: "أتقن", state: masterState },
  ];
}

/** Share of one lesson done, from real state: 50% once studied, plus the baseline questions answered. */
export function lessonProgressPct(input: { studied: boolean; completed: boolean; answered: number; total: number }): number {
  if (input.completed) return 100;
  if (!input.studied) return 0;
  const test = input.total > 0 ? Math.min(1, input.answered / input.total) : 0;
  return Math.round(50 + 50 * test);
}

/**
 * The call-to-action of a continue target (stage + whether its session already started). Shared by the home hero and
 * /progress so the same state is always worded the same way.
 */
export function continueCtaLabel(target: { stage: StageKey; inProgress?: boolean }): string {
  switch (target.stage) {
    case "LEARN":
      return "ابدأ الدرس";
    case "ASSESS":
      return target.inProgress ? "تابع الاختبار" : "ابدأ الاختبار";
    case "REASSESS":
      return target.inProgress ? "تابع الاختبار" : "اختبر فهمي مرة أخرى";
    case "REVIEW":
      return "راجع هذا الجزء";
    case "MEMORIZE":
      return "تابع الحفظ";
    case "DONE":
      return "المسار العلمي";
  }
}
