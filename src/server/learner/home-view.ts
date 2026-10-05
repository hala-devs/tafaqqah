import type { StageKey } from "@/lib/home-state";
import type { MemorizeNextStep } from "@/server/memorization/path-view";

/**
 * Journey-card states for the learner home. Pure wording over states that other modules already computed
 * (getContinueTarget for understanding, the /memorize journey for memorization). No new rule, no combined score.
 */

export type JourneyCardState = { label: string; tone: "neutral" | "ink" | "sage" | "warning" | "success" };

/** Understanding: from the understanding continue target, plus lesson completion when there is no target. */
export function learningCardState(target: { stage: StageKey; inProgress?: boolean } | null, input: { started: boolean; completed: number; published: number }): JourneyCardState {
  if (!target) {
    if (input.published > 0 && input.completed === input.published) return { label: "مكتمل", tone: "success" };
    return { label: "لا دروس متاحة الآن", tone: "neutral" };
  }
  switch (target.stage) {
    case "LEARN":
      return input.started ? { label: "درس متاح", tone: "ink" } : { label: "لم يبدأ", tone: "neutral" };
    case "ASSESS":
      return target.inProgress ? { label: "اختبار جارٍ", tone: "ink" } : { label: "اختبار متاح", tone: "ink" };
    case "REASSESS":
      return target.inProgress ? { label: "اختبار جارٍ", tone: "ink" } : { label: "إعادة اختبار متاحة", tone: "ink" };
    case "REVIEW":
      return { label: "يحتاج إلى تثبيت", tone: "warning" };
    default:
      return { label: "درس متاح", tone: "ink" };
  }
}

/** Memorization: from the same next step /memorize shows. «جارٍ» = recitations exist and an unrecited line remains. */
export function memorizationCardState(step: MemorizeNextStep): JourneyCardState {
  switch (step.kind) {
    case "START":
      return { label: "لم يبدأ", tone: "neutral" };
    case "CONTINUE":
      return { label: "جارٍ", tone: "sage" };
    case "REVIEW":
      return { label: "حان وقت المراجعة", tone: "warning" };
    case "REINFORCE":
      return { label: "يحتاج إلى تثبيت", tone: "warning" };
    case "DONE":
      return { label: "أتقنت المتاح", tone: "success" };
  }
}

/** The memorization card's CTA wording on the home («تابع حفظك» reads naturally here). */
export function memorizationCardCta(step: MemorizeNextStep): string | null {
  switch (step.kind) {
    case "START":
      return "ابدأ الحفظ";
    case "CONTINUE":
      return "تابع حفظك";
    case "REVIEW":
      return "راجع محفوظك";
    case "REINFORCE":
      return "ثبّت محفوظك";
    case "DONE":
      return null;
  }
}

type LearningTargetLike = { stage: StageKey; href: string; inProgress?: boolean; lesson: { title: string } | null; detail: string | null } | null;

/** The understanding card's CTA, worded from the same continue target (no new rule). */
export function learningCardCta(target: LearningTargetLike, started: boolean): string | null {
  if (!target || target.stage === "DONE" || target.stage === "MEMORIZE") return null;
  if (target.stage === "LEARN") return started ? "تابع تعلّمك" : "ابدأ الدرس";
  if (target.stage === "REVIEW") return "راجع المفهوم";
  return target.inProgress ? "تابع الاختبار" : "ابدأ الاختبار";
}
