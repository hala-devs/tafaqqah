import { ar, countLabel } from "@/lib/format";
import type { MemorizationPerformanceFacts } from "./facts";
import type { CoachReasonCode, ExerciseType, RecallResponse } from "./coach";
import type { ObservationKey, ReasonCode } from "./plan";

/**
 * Every learner-facing sentence of the adaptive review is built HERE from deterministic facts + validated keys.
 * No sentence is written by AI. History wording exists only behind history keys, which the validator allows only when
 * comparable history exists; nothing here attributes a change to the review (observational wording only).
 */

const POSITIONS = ["موضع واحد", "موضعين", "مواضع", "موضعًا"] as [string, string, string, string];

export function observationSentence(key: ObservationKey, facts: MemorizationPerformanceFacts): string {
  const a = facts.affected;
  const count = (pred: (p: (typeof a)[number]) => boolean) => a.filter(pred).length;
  switch (key) {
    case "REPEATED_FORGOTTEN": {
      const n = count((p) => p.history === "REPEATED" && p.kind === "FORGOTTEN");
      return `لم تتذكر ${countLabel(n, POSITIONS)} في هذه المحاولة، وقد ${n === 1 ? "نسيته" : "نسيتها"} في محاولتك السابقة لهذه الأسطر أيضًا.`;
    }
    case "REPEATED_INCORRECT": {
      const n = count((p) => p.history === "REPEATED" && p.kind === "INCORRECT");
      return `أخطأت في ${countLabel(n, POSITIONS)} سبق أن أخطأت ${n === 1 ? "فيه" : "فيها"} في محاولتك السابقة لهذه الأسطر.`;
    }
    case "NEW_AND_RESOLVED": {
      const fresh = count((p) => p.history === "NEW") === 1 ? "ظهر موضع جديد" : "ظهرت مواضع جديدة";
      const fixed = facts.resolved.length === 1 ? "أصبح موضع كان متأثرًا سابقًا صحيحًا الآن" : "أصبحت مواضع كانت متأثرة سابقًا صحيحة الآن";
      return `${fresh}، بينما ${fixed}.`;
    }
    case "PERSISTENT_ISSUE":
      return count((p) => p.history === "PERSISTENT") === 1
        ? "أحد المواضع الحالية احتاج إلى تثبيت في محاولتك السابقة أيضًا."
        : "بعض المواضع الحالية احتاجت إلى تثبيت في محاولتك السابقة أيضًا.";
    case "RESOLVED_PREVIOUS":
      return facts.resolved.length === 1 ? "أصبح موضع كان متأثرًا في محاولتك السابقة صحيحًا الآن." : "أصبحت مواضع كانت متأثرة في محاولتك السابقة صحيحة الآن.";
    case "FULL_UNIT_FORGOTTEN": {
      const n = count((p) => p.level === "UNIT" && p.kind === "FORGOTTEN");
      return n === 1 ? "لم تتذكر سطرًا كاملًا في هذه المحاولة، فستراجعه كاملًا." : `لم تتذكر ${ar(n)} أسطر كاملة في هذه المحاولة، فستراجعها كاملة.`;
    }
    case "CLUSTERED_FORGOTTEN":
      return "تركّز النسيان في مواضع متقاربة، فستراجعها معًا في سياقها.";
    case "CLUSTERED_ISSUES":
      return "جاءت بعض المواضع متجاورة، فستراجعها معًا في سياقها.";
    case "MIXED_IN_UNIT":
      return "اجتمع في بعض الأسطر خطأ ونسيان معًا.";
    case "FIRST_ATTEMPT":
      return "هذه أول محاولة لهذه الأسطر؛ ستُبنى المراجعة على مواضع الخطأ والنسيان الحالية.";
    case "FORGETTING_DOMINANT":
      return "غلب على هذه المحاولة النسيان أكثر من الخطأ.";
    case "INCORRECT_DOMINANT":
      return "غلب على هذه المحاولة الخطأ في اللفظ أكثر من النسيان.";
    case "SCATTERED_ISSUES":
      return `جاءت المواضع متفرقة في ${countLabel(new Set(a.map((p) => p.unitRef)).size, ["سطر واحد", "سطرين", "أسطر", "سطرًا"])}.`;
    case "SINGLE_ISSUE":
      return "يحتاج موضع واحد إلى تثبيت في هذه المحاولة.";
  }
}

export const REASON_LABEL: Record<ReasonCode, string> = {
  FULL_UNIT_FORGOTTEN: "لم تتذكر السطر كاملًا",
  REPEATED_FORGOTTEN: "تكرر نسيانه",
  PERSISTENT_ISSUE: "احتاج إلى تثبيت في المحاولة السابقة أيضًا",
  CURRENT_FORGOTTEN: "لم تتذكره في هذه المحاولة",
  FULL_UNIT_INCORRECT: "حددت أن السطر كاملًا يحتاج إلى تصحيح",
  REPEATED_INCORRECT: "تكرر الخطأ فيه",
  MIXED_ISSUES: "اجتمع فيه خطأ ونسيان",
  CURRENT_INCORRECT: "أخطأت في لفظه",
  ADJACENT_ISSUES: "مواضع متجاورة تُثبَّت معًا",
};

export function positionsLabel(n: number): string {
  return countLabel(n, POSITIONS);
}

// ───────────────────────────── Reinforcement coach (deterministic copy; reason codes are never shown) ─────────────────────────────

export const EXERCISE_TITLE: Record<ExerciseType, string> = {
  CLOZE_RECALL: "الكلمة الناقصة",
  CONTEXT_RECALL: "الاستذكار بالسياق",
  REDUCED_CUE_RECALL: "تلميح أقل",
  SEQUENCE_RECALL: "الانتقال بين سطرين",
  DELAYED_RECALL: "عودة إلى موضع سابق",
  WHOLE_UNIT_RECALL: "السطر كاملًا",
  LINKED_SEQUENCE_RECALL: "أسطر متتالية",
};

/** Guided-recall prompts: what the learner is asked when the card shows a cue instead of the instruction above. */
export const GUIDED_INSTRUCTION = {
  NEXT_LINE: "ما النص الذي يأتي بعده؟",
  COMPLETE_LINE: "أكمل السطر من بدايته الظاهرة.",
} as const;

export function exerciseInstruction(type: ExerciseType, hiddenWords: number): string {
  const one = hiddenWords === 1;
  switch (type) {
    case "CLOZE_RECALL":
      return one ? "استذكر الكلمة الناقصة." : "استذكر الكلمات الناقصة.";
    case "CONTEXT_RECALL":
      return `استعن بالسطر المجاور لاستذكار ${one ? "الكلمة المخفية" : "الكلمات المخفية"}.`;
    case "REDUCED_CUE_RECALL":
      return "استذكر المخفي بأقل قدر من النص الظاهر.";
    case "SEQUENCE_RECALL":
      return "ثبّت الانتقال بين هذين السطرين.";
    case "LINKED_SEQUENCE_RECALL":
      return "استذكر هذه الأسطر المتتالية معًا.";
    case "DELAYED_RECALL":
      return "عدنا إلى موضع راجعته قبل قليل. استذكره الآن.";
    case "WHOLE_UNIT_RECALL":
      return "جرّب استذكار السطر كاملًا.";
  }
}

/** One short, approved sentence linking this exercise to observable evidence. Never a diagnosis, never "AI detected". */
export function exerciseLead(reason: CoachReasonCode, type: ExerciseType): string | null {
  switch (reason) {
    case "FAILED_TARGETED_RECALL":
    case "FAILED_AFTER_CUE_REDUCTION":
      return "سنراجع هذا الموضع مرة أخرى بطريقة مختلفة.";
    case "SUCCEEDED_WITH_CONTEXT":
      return type === "REDUCED_CUE_RECALL" ? "أحسنت. هذه المرة سنقلل التلميح." : "أحسنت. لنثبّته بخطوة أخرى.";
    case "PREVIOUS_INTERVENTION_REMAINED":
      return "سنراجع هذا الموضع بطريقة مختلفة عن المرة السابقة.";
    case "REPEATED_TARGET":
    case "PERSISTENT_TARGET":
      return "هذا الموضع احتاج إلى تثبيت في محاولتك السابقة أيضًا.";
    case "ADJACENT_TARGETS":
    case "BOUNDARY_TARGETS":
    case "MULTIPLE_RELATED_TARGETS":
      return "هذه المواضع متجاورة، فسنثبّتها معًا.";
    default:
      return null;
  }
}

export const RESPONSE_LABEL: Record<RecallResponse, string> = {
  RECALLED: "استذكرتها",
  PARTIAL: "احتجت مساعدة",
  NOT_RECALLED: "لم أتذكرها",
};
