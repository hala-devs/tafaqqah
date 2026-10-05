import { describe, expect, it } from "vitest";
import { applyAnswer, classifyState, initialMastery } from "@/server/assessment/mastery";
import { adaptiveNote, difficultyForMastery, questionTypeFor, selectNextConcept, type ConceptCandidate } from "@/server/assessment/selection";
import {
  decideAdaptiveCompletion,
  decideFixedCompletion,
  decideReassessmentCompletion,
  hasSufficientEvidence,
} from "@/server/assessment/completion";
import { buildReport } from "@/server/assessment/report";
import { computePathStates } from "@/server/content/path-state";
import { approximatePercent, scoreLevel } from "@/lib/mastery-levels";

describe("mastery update", () => {
  it("starts at 50 and rewards harder correct answers more", () => {
    const start = initialMastery();
    expect(start.masteryScore).toBe(50);
    expect(applyAnswer(start, { correct: true, difficulty: 1 }).masteryScore).toBe(58);
    expect(applyAnswer(start, { correct: true, difficulty: 2 }).masteryScore).toBe(62);
    expect(applyAnswer(start, { correct: true, difficulty: 3 }).masteryScore).toBe(65);
  });

  it("penalises incorrect answers and repeated errors more", () => {
    const once = applyAnswer(initialMastery(), { correct: false, difficulty: 2 });
    expect(once.masteryScore).toBe(38);
    expect(once.consecutiveIncorrect).toBe(1);
    const twice = applyAnswer(once, { correct: false, difficulty: 1 });
    expect(twice.masteryScore).toBe(38 - 14 - 6);
    expect(twice.incorrectCount).toBe(2);
  });

  it("clamps to [0, 100] and tracks counters", () => {
    let s = initialMastery();
    for (let i = 0; i < 10; i++) s = applyAnswer(s, { correct: true, difficulty: 3 });
    expect(s.masteryScore).toBe(100);
    expect(s.consecutiveCorrect).toBe(10);
    for (let i = 0; i < 10; i++) s = applyAnswer(s, { correct: false, difficulty: 1 });
    expect(s.masteryScore).toBe(0);
    expect(s.attempts).toBe(20);
    expect(s.consecutiveCorrect).toBe(0);
  });
});

describe("difficulty and question type", () => {
  it("maps mastery bands to difficulty", () => {
    expect(difficultyForMastery(39)).toBe(1);
    expect(difficultyForMastery(40)).toBe(2);
    expect(difficultyForMastery(74)).toBe(2);
    expect(difficultyForMastery(75)).toBe(3);
  });

  it("alternates True/False and MCQ at the foundational level only", () => {
    expect(questionTypeFor(1, null)).toBe("TRUE_FALSE");
    expect(questionTypeFor(1, "TRUE_FALSE")).toBe("MCQ");
    expect(questionTypeFor(2, "MCQ")).toBe("MCQ");
    expect(questionTypeFor(3, null)).toBe("MCQ");
  });

  it("uses calm adaptive copy and never mentions AI", () => {
    const notes = (["UNASSESSED", "REINFORCE_AFTER_ERROR", "VERIFY_MASTERY", "WEAKEST"] as const).map((r) => adaptiveNote(r, 2, 3));
    expect(notes).toContain("سنركّز قليلًا على هذا المفهوم.");
    for (const note of notes) expect(note ?? "").not.toMatch(/ذكاء|AI/);
    expect(adaptiveNote("UNASSESSED", 2, 1)).toBeNull();
  });
});

const c = (id: string, order: number, over: Partial<ConceptCandidate> = {}): ConceptCandidate => ({
  id,
  order,
  mastery: 50,
  sessionAttempts: 0,
  sessionCorrect: 0,
  lastSessionResult: null,
  ...over,
});

describe("concept selection", () => {
  it("covers unassessed concepts first, in lesson order", () => {
    expect(selectNextConcept([c("a", 1), c("b", 2)], null)).toMatchObject({ conceptId: "a", reason: "UNASSESSED" });
    const afterA = [c("a", 1, { sessionAttempts: 1, sessionCorrect: 1, lastSessionResult: true, mastery: 62 }), c("b", 2)];
    expect(selectNextConcept(afterA, "a")?.conceptId).toBe("b");
  });

  it("returns to a concept right after an error", () => {
    const pool = [
      c("a", 1, { sessionAttempts: 1, lastSessionResult: false, mastery: 38 }),
      c("b", 2, { sessionAttempts: 1, sessionCorrect: 1, lastSessionResult: true, mastery: 62 }),
    ];
    expect(selectNextConcept(pool, "b")).toMatchObject({ conceptId: "a", reason: "REINFORCE_AFTER_ERROR" });
  });

  it("avoids asking the same concept twice in a row when alternatives exist", () => {
    const pool = [
      c("a", 1, { sessionAttempts: 1, lastSessionResult: false, mastery: 38 }),
      c("b", 2, { sessionAttempts: 1, lastSessionResult: false, mastery: 38 }),
    ];
    expect(selectNextConcept(pool, "a")?.conceptId).toBe("b");
  });

  it("returns null when nothing is eligible", () => {
    expect(selectNextConcept([], null)).toBeNull();
  });
});

describe("completion rules", () => {
  it("defines sufficient evidence", () => {
    expect(hasSufficientEvidence({ sessionAttempts: 1, lastSessionResult: true, mastery: 62 })).toBe(false);
    expect(hasSufficientEvidence({ sessionAttempts: 1, lastSessionResult: true, mastery: 80 })).toBe(true);
    expect(hasSufficientEvidence({ sessionAttempts: 2, lastSessionResult: true, mastery: 60 })).toBe(true);
    // Two wrong answers are not enough: a third, differently worded question confirms first.
    expect(hasSufficientEvidence({ sessionAttempts: 2, lastSessionResult: false, mastery: 30 })).toBe(false);
    expect(hasSufficientEvidence({ sessionAttempts: 2, lastSessionResult: false, mastery: 45 })).toBe(false);
    expect(hasSufficientEvidence({ sessionAttempts: 3, lastSessionResult: false, mastery: 45 })).toBe(true);
  });

  it("never finishes before the minimum and always finishes at the maximum", () => {
    const strong = { sessionAttempts: 2, lastSessionResult: true, mastery: 74 };
    expect(decideAdaptiveCompletion(4, [strong, strong]).complete).toBe(false);
    expect(decideAdaptiveCompletion(5, [strong, strong])).toEqual({ complete: true, reason: "EVIDENCE_SUFFICIENT" });
    expect(decideAdaptiveCompletion(10, [{ sessionAttempts: 0, lastSessionResult: null, mastery: 50 }])).toEqual({
      complete: true,
      reason: "MAX_QUESTIONS",
    });
  });

  it("requires every eligible concept to be covered", () => {
    const strong = { sessionAttempts: 3, lastSessionResult: true, mastery: 80 };
    const untouched = { sessionAttempts: 0, lastSessionResult: null, mastery: 50 };
    expect(decideAdaptiveCompletion(6, [strong, strong, untouched]).complete).toBe(false);
  });

  it("finishes when no eligible concept remains after some answers", () => {
    expect(decideAdaptiveCompletion(3, [])).toEqual({ complete: true, reason: "NO_ELIGIBLE_CONCEPTS" });
    expect(decideAdaptiveCompletion(0, []).complete).toBe(false);
  });

  it("reassessment is short and focused", () => {
    const recovered = { sessionAttempts: 2, lastSessionResult: true, mastery: 60 };
    expect(decideReassessmentCompletion(1, [recovered]).complete).toBe(false);
    expect(decideReassessmentCompletion(2, [recovered])).toEqual({ complete: true, reason: "EVIDENCE_SUFFICIENT" });
    expect(decideReassessmentCompletion(4, [{ sessionAttempts: 4, lastSessionResult: false, mastery: 20 }]).complete).toBe(true);
  });

  it("fixed mode finishes after every fixed question", () => {
    expect(decideFixedCompletion(5, 6).complete).toBe(false);
    expect(decideFixedCompletion(6, 6)).toEqual({ complete: true, reason: "FIXED_SET_DONE" });
  });
});

describe("report", () => {
  const t = (s: number) => new Date(2026, 0, 1, 10, 0, s);
  const concepts = [
    { id: "a", title: "أ", order: 1 },
    { id: "b", title: "ب", order: 2 },
    { id: "c", title: "ج", order: 3 },
    { id: "z", title: "لم يُختبر", order: 4 },
  ];

  it("separates mastered and needs-review concepts and is deterministic", () => {
    const answers = [
      { conceptId: "a", correct: true, masteryBefore: 50, masteryAfter: 62, stateAfter: "GOOD" as const, answeredAt: t(1) },
      { conceptId: "b", correct: false, masteryBefore: 50, masteryAfter: 38, stateAfter: "LEARNING" as const, answeredAt: t(2) },
      { conceptId: "c", correct: false, masteryBefore: 50, masteryAfter: 38, stateAfter: "LEARNING" as const, answeredAt: t(3) },
      { conceptId: "a", correct: true, masteryBefore: 62, masteryAfter: 74, stateAfter: "GOOD" as const, answeredAt: t(4) },
      { conceptId: "b", correct: true, masteryBefore: 38, masteryAfter: 46, stateAfter: "LEARNING" as const, answeredAt: t(5) },
      { conceptId: "c", correct: false, masteryBefore: 38, masteryAfter: 18, stateAfter: "NEEDS_REINFORCEMENT" as const, answeredAt: t(6) },
    ];
    const report = buildReport({ mode: "ADAPTIVE", completionReason: "EVIDENCE_SUFFICIENT", concepts, answers });
    expect(report.totalQuestions).toBe(6);
    expect(report.correctCount).toBe(3);
    expect(report.accuracy).toBe(0.5);
    expect(report.strongConceptIds).toEqual(["a"]);
    // One mistake then a recovery → still learning, never "needs reinforcement".
    expect(report.learningConceptIds).toEqual(["b"]);
    expect(report.reinforceConceptIds).toEqual(["c"]);
    expect(report.missedConceptIds).toEqual(["b", "c"]);
    expect(report.overallMastery).toBe(46);
    expect(report.concepts.map((x) => x.conceptId)).toEqual(["a", "b", "c"]);
    // Same input in a different order → identical report.
    const again = buildReport({ mode: "ADAPTIVE", completionReason: "EVIDENCE_SUFFICIENT", concepts, answers: [...answers].reverse() });
    expect(again).toEqual(report);
  });

  it("labels levels for humans and avoids false precision", () => {
    // A score alone never produces «يحتاج إلى تثبيت».
    expect(scoreLevel(5)).toBe("LEARNING");
    expect(scoreLevel(59)).toBe("LEARNING");
    expect(scoreLevel(60)).toBe("GOOD");
    expect(scoreLevel(80)).toBe("MASTERED");
    expect(approximatePercent(62)).toBe(60);
    expect(approximatePercent(73)).toBe(75);
  });
});

describe("learning path states", () => {
  it("marks completed / current / locked / coming soon", () => {
    const states = computePathStates([
      { id: "l1", status: "PUBLISHED", studied: true, completed: true },
      { id: "l2", status: "PUBLISHED", studied: false, completed: false },
      { id: "l3", status: "PUBLISHED", studied: false, completed: false },
      { id: "l4", status: "COMING_SOON", studied: false, completed: false },
    ]);
    expect(Object.fromEntries(states)).toEqual({ l1: "COMPLETED", l2: "CURRENT", l3: "LOCKED", l4: "COMING_SOON" });
  });

  it("unlocks the next lesson once the current one is studied", () => {
    const states = computePathStates([
      { id: "l1", status: "PUBLISHED", studied: true, completed: false },
      { id: "l2", status: "PUBLISHED", studied: false, completed: false },
      { id: "l3", status: "DRAFT", studied: false, completed: false },
    ]);
    expect(states.get("l1")).toBe("CURRENT");
    expect(states.get("l2")).toBe("AVAILABLE");
    expect(states.has("l3")).toBe(false);
  });
});

describe("learning states (deterministic classifier)", () => {
  const answer = (state: ReturnType<typeof initialMastery>, correct: boolean, difficulty = 2) => applyAnswer(state, { correct, difficulty });

  it("B. one mistake alone never classifies a concept as needing reinforcement", () => {
    const once = answer(initialMastery(), false);
    expect(once.state).toBe("LEARNING");
    expect(once.masteryScore).toBeLessThan(50);
    let s = initialMastery();
    s = answer(s, true);
    s = answer(s, true);
    s = answer(s, false, 1);
    expect(s.state).not.toBe("NEEDS_REINFORCEMENT");
  });

  it("A. repeated mistakes on the same concept trigger «يحتاج إلى تثبيت»", () => {
    let s = answer(initialMastery(), false);
    s = answer(s, false, 1);
    expect(s.state).toBe("NEEDS_REINFORCEMENT");
    expect(s.recentOutcomes).toEqual([false, false]);
  });

  it("an error, a correct answer, then another error is repeated evidence too", () => {
    let s = answer(initialMastery(), false);
    s = answer(s, true, 1);
    s = answer(s, false, 1);
    expect(s.state).toBe("NEEDS_REINFORCEMENT");
  });

  it("leaving «يحتاج إلى تثبيت» requires two correct answers in a row", () => {
    let s = answer(answer(initialMastery(), false), false, 1);
    s = answer(s, true, 1);
    expect(s.state).toBe("NEEDS_REINFORCEMENT");
    s = answer(s, true, 1);
    expect(s.state).not.toBe("NEEDS_REINFORCEMENT");
  });

  it("correct answers gradually improve mastery and state", () => {
    let s = initialMastery();
    const states: string[] = [];
    for (let i = 0; i < 4; i++) {
      s = answer(s, true, i < 2 ? 2 : 3);
      states.push(s.state);
    }
    expect(states).toEqual(["GOOD", "GOOD", "MASTERED", "MASTERED"]);
    expect(s.masteryScore).toBeGreaterThan(80);
  });

  it("classifyState looks only at the most recent window", () => {
    expect(classifyState({ score: 70, recentOutcomes: [false, false, true, true, true, true], consecutiveCorrect: 4, previousState: "LEARNING" })).toBe("GOOD");
    expect(classifyState({ score: 50, recentOutcomes: [], consecutiveCorrect: 0, previousState: "LEARNING" })).toBe("LEARNING");
  });

  it("C. a repeated error makes selection ask a differently worded question on that concept", () => {
    const pool = [
      { id: "a", order: 1, mastery: 18, sessionAttempts: 2, sessionCorrect: 0, lastSessionResult: false, sessionConsecutiveErrors: 2 },
      { id: "b", order: 2, mastery: 62, sessionAttempts: 2, sessionCorrect: 2, lastSessionResult: true, sessionConsecutiveErrors: 0 },
    ];
    expect(selectNextConcept(pool, "b")).toMatchObject({ conceptId: "a", reason: "REPEATED_ERROR" });
    expect(adaptiveNote("REPEATED_ERROR", 1, 4)).toBe("سنعيد هذا المفهوم بصياغة مختلفة.");
  });
});
