/**
 * Follow-up logic after a wrong answer in a lesson assessment. Pure and deterministic.
 *
 *   BASELINE (approved database question)
 *     wrong → AI VERIFICATION            "was it a slip, or a misunderstanding?"
 *       wrong → AI SECOND_VERIFICATION   confirmation from another angle
 *         wrong → weak concept → REVIEW of the exact approved video segment
 *                 → AI REASSESSMENT → the assessment continues
 *   Any correct answer ends the chain. A single mistake is never a weak concept: it takes three
 *   consecutive wrong answers on the same concept (baseline + two differently angled checks).
 *   A concept whose follow-up cannot be generated safely is skipped — the learner is never shown
 *   an unverified question.
 */
export type FollowUpStage = "BASELINE" | "VERIFICATION" | "SECOND_VERIFICATION" | "REASSESSMENT";

export type ServedLite = {
  id: string;
  conceptId: string;
  stage: FollowUpStage;
  /** null while the question is still unanswered. */
  correct: boolean | null;
};

export type FollowUp =
  | { kind: "NONE" }
  | { kind: "GENERATE"; stage: "VERIFICATION" | "SECOND_VERIFICATION"; previousId: string; conceptId: string }
  | { kind: "REVIEW"; previousId: string; conceptId: string };

/** What must happen next, given the questions served so far (in order) and the concepts that cannot be followed up. */
export function nextFollowUp(served: ServedLite[], skippedConceptIds: readonly string[]): FollowUp {
  const answered = served.filter((q) => q.correct !== null);
  const last = answered[answered.length - 1];
  if (!last || last.correct) return { kind: "NONE" };
  if (skippedConceptIds.includes(last.conceptId)) return { kind: "NONE" };

  switch (last.stage) {
    case "BASELINE":
      return { kind: "GENERATE", stage: "VERIFICATION", previousId: last.id, conceptId: last.conceptId };
    case "VERIFICATION":
      return { kind: "GENERATE", stage: "SECOND_VERIFICATION", previousId: last.id, conceptId: last.conceptId };
    case "SECOND_VERIFICATION":
      return { kind: "REVIEW", previousId: last.id, conceptId: last.conceptId };
    case "REASSESSMENT":
      return { kind: "NONE" };
  }
}

/** Learner-facing wording after a wrong answer, by the stage of the question that was missed. */
export function wrongAnswerFeedback(stage: FollowUpStage, followUp: FollowUp["kind"], sessionComplete: boolean): { title: string; message: string } {
  if (stage === "BASELINE" && followUp === "GENERATE") {
    return { title: "نتأكد من فهم هذه الفكرة بسؤال آخر", message: "سؤال قصير عن الفكرة نفسها، ولا يحكم خطأ واحد على فهمك." };
  }
  if (stage === "VERIFICATION" && followUp === "GENERATE") {
    return { title: "نتأكد من فهم هذه الفكرة بسؤال آخر", message: "نجرّب صياغة أخرى للفكرة نفسها." };
  }
  if (followUp === "REVIEW") {
    return { title: "هذه الفكرة تحتاج إلى تثبيت بسيط", message: "راجع هذا الجزء ثم اختبر فهمك مرة أخرى." };
  }
  return {
    title: "هذه الفكرة تحتاج إلى تثبيت بسيط",
    message: sessionComplete ? "راجع هذا الجزء من الدرس لتثبيته." : "راجع هذا الجزء من الدرس لتثبيته، ثم نتابع.",
  };
}
