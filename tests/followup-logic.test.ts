import { describe, expect, it } from "vitest";
import { nextFollowUp, wrongAnswerFeedback, type ServedLite } from "@/server/assessment/followup";
import { MASTERY_RULES, DIFFICULTY_BANDS, COMPLETION_RULES, REASSESSMENT_RULES } from "@/server/assessment/config";
import { applyAnswer, initialMastery } from "@/server/assessment/mastery";

const q = (id: string, stage: ServedLite["stage"], correct: boolean | null, conceptId = "c1"): ServedLite => ({ id, conceptId, stage, correct });

describe("follow-up chain after a wrong answer", () => {
  it("a correct answer — or nothing answered yet — needs no follow-up", () => {
    expect(nextFollowUp([], [])).toEqual({ kind: "NONE" });
    expect(nextFollowUp([q("1", "BASELINE", true)], [])).toEqual({ kind: "NONE" });
    expect(nextFollowUp([q("1", "BASELINE", null)], [])).toEqual({ kind: "NONE" });
  });

  it("BASELINE wrong → AI VERIFICATION; VERIFICATION wrong → SECOND_VERIFICATION; SECOND wrong → review", () => {
    expect(nextFollowUp([q("1", "BASELINE", false)], [])).toEqual({ kind: "GENERATE", stage: "VERIFICATION", previousId: "1", conceptId: "c1" });
    expect(nextFollowUp([q("1", "BASELINE", false), q("2", "VERIFICATION", false)], [])).toEqual({
      kind: "GENERATE",
      stage: "SECOND_VERIFICATION",
      previousId: "2",
      conceptId: "c1",
    });
    expect(nextFollowUp([q("1", "BASELINE", false), q("2", "VERIFICATION", false), q("3", "SECOND_VERIFICATION", false)], [])).toEqual({
      kind: "REVIEW",
      previousId: "3",
      conceptId: "c1",
    });
  });

  it("a correct verification (or reassessment) ends the chain; a wrong reassessment does not start another", () => {
    expect(nextFollowUp([q("1", "BASELINE", false), q("2", "VERIFICATION", true)], [])).toEqual({ kind: "NONE" });
    expect(nextFollowUp([q("1", "BASELINE", false), q("2", "VERIFICATION", false), q("3", "SECOND_VERIFICATION", true)], [])).toEqual({ kind: "NONE" });
    expect(nextFollowUp([q("3", "SECOND_VERIFICATION", false), q("4", "REASSESSMENT", false)], [])).toEqual({ kind: "NONE" });
  });

  it("only the most recent answer matters, and a skipped concept is never followed up", () => {
    expect(nextFollowUp([q("1", "BASELINE", false, "c1"), q("2", "VERIFICATION", true, "c1"), q("3", "BASELINE", true, "c2")], [])).toEqual({ kind: "NONE" });
    expect(nextFollowUp([q("1", "BASELINE", false, "c1")], ["c1"])).toEqual({ kind: "NONE" });
    expect(nextFollowUp([q("1", "BASELINE", false, "c1")], ["c2"]).kind).toBe("GENERATE");
  });

  it("one mistake is never a weak concept: it takes three wrong answers in a row", () => {
    let state = initialMastery();
    const outcomes = [false, false, false];
    const states: string[] = [];
    for (const correct of outcomes) {
      state = applyAnswer(state, { correct, difficulty: 2 });
      states.push(state.state);
    }
    // The mastery state machine is unchanged: LEARNING after one miss, flagged only once the miss repeats.
    expect(states[0]).toBe("LEARNING");
    expect(states[2]).toBe("NEEDS_REINFORCEMENT");
  });

  it("learner feedback follows the stage: first miss «نتأكد من فهم هذه الفكرة بسؤال آخر»، repeated «هذه الفكرة تحتاج إلى تثبيت بسيط»", () => {
    expect(wrongAnswerFeedback("BASELINE", "GENERATE", false).title).toBe("نتأكد من فهم هذه الفكرة بسؤال آخر");
    expect(wrongAnswerFeedback("VERIFICATION", "GENERATE", false).title).toBe("نتأكد من فهم هذه الفكرة بسؤال آخر");
    expect(wrongAnswerFeedback("SECOND_VERIFICATION", "REVIEW", false)).toEqual({
      title: "هذه الفكرة تحتاج إلى تثبيت بسيط",
      message: "راجع هذا الجزء ثم اختبر فهمك مرة أخرى.",
    });
  });
});

describe("mastery thresholds were not changed by the adaptive follow-up work", () => {
  it("keeps the documented constants", () => {
    expect(MASTERY_RULES).toMatchObject({ initial: 50, gain: { 1: 8, 2: 12, 3: 15 }, loss: { 1: 14, 2: 12, 3: 10 }, repeatedErrorPenalty: 6, min: 0, max: 100 });
    expect(DIFFICULTY_BANDS).toEqual({ intermediateFrom: 40, appliedFrom: 75 });
    expect(COMPLETION_RULES).toEqual({ minQuestions: 5, maxQuestions: 10 });
    expect(REASSESSMENT_RULES).toEqual({ minQuestions: 2, maxQuestions: 4 });
  });
});
