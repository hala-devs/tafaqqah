import { describe, expect, it } from "vitest";
import { memorizeNextStep, memorizeProgressLine, sectionPathState } from "@/server/memorization/path-view";
import type { DueReview, MemorizationContinue } from "@/server/memorization/progress";
import { memorizePassageHref } from "@/lib/routes";

const cont = (kind: MemorizationContinue["kind"]): MemorizationContinue => ({ passageId: "p2", passageTitle: "المقطع 1", sectionTitle: "المياه", courseTitle: "كتاب", startUnitId: "u5", kind });
const due: DueReview = { passageId: "p1", passageTitle: "المقطع 2", sectionTitle: "مقدمة المؤلف", courseTitle: "كتاب", state: "NEEDS_REINFORCEMENT", masteryScore: 40, repeatedWeakness: false, dueAt: new Date(0) };

describe("section states on the memorization path (derived only from stored state)", () => {
  it("is «لم يبدأ» when no passage was recited", () => {
    expect(sectionPathState({ passageCount: 3, attemptedPassages: 0, masteredPassages: 0, dueCount: 0 })).toBe("NOT_STARTED");
  });
  it("is «جارٍ» when some passages were recited and not all are mastered", () => {
    expect(sectionPathState({ passageCount: 3, attemptedPassages: 1, masteredPassages: 0, dueCount: 0 })).toBe("IN_PROGRESS");
    expect(sectionPathState({ passageCount: 3, attemptedPassages: 3, masteredPassages: 2, dueCount: 0 })).toBe("IN_PROGRESS");
  });
  it("is «متقن» only when every passage is mastered", () => {
    expect(sectionPathState({ passageCount: 3, attemptedPassages: 3, masteredPassages: 3, dueCount: 0 })).toBe("COMPLETED");
  });
  it("a due review (deterministic schedule) takes priority over every other state", () => {
    expect(sectionPathState({ passageCount: 3, attemptedPassages: 3, masteredPassages: 3, dueCount: 1 })).toBe("REVIEW_DUE");
  });
  it("an empty section is never reported as mastered", () => {
    expect(sectionPathState({ passageCount: 0, attemptedPassages: 0, masteredPassages: 0, dueCount: 0 })).toBe("NOT_STARTED");
  });
});

describe("the next memorization step uses the existing continue/review state", () => {
  it("a new learner starts at the real continue position", () => {
    expect(memorizeNextStep(0, cont("FIRST"), [])).toEqual({ kind: "START", passageId: "p2", startUnitId: "u5", sectionTitle: "المياه", passageTitle: "المقطع 1" });
  });
  it("the start CTA uses the passage route and passes its start unit as a search parameter", () => {
    const step = memorizeNextStep(0, cont("FIRST"), []);
    if (step.kind === "DONE" || step.kind === "REVIEW") throw new Error("expected a start step");
    expect(memorizePassageHref(step.passageId, step.startUnitId)).toBe("/memorize/passage/p2?start=u5");
  });
  it("a learner with progress continues", () => {
    expect(memorizeNextStep(4, cont("FIRST"), []).kind).toBe("CONTINUE");
  });
  it("a due review comes first and opens the due passage", () => {
    expect(memorizeNextStep(4, cont("FIRST"), [due])).toEqual({ kind: "REVIEW", passageId: "p1", sectionTitle: "مقدمة المؤلف", passageTitle: "المقطع 2" });
  });
  it("after everything was recited, the weakest passage is reinforced", () => {
    expect(memorizeNextStep(9, cont("REINFORCE"), []).kind).toBe("REINFORCE");
  });
  it("is DONE only when there is neither a review nor a continue position — no invented next item", () => {
    expect(memorizeNextStep(9, null, [])).toEqual({ kind: "DONE" });
  });
});

describe("progress line states only facts", () => {
  it("zero, partial, complete and review-due", () => {
    expect(memorizeProgressLine(0, 159, 0)).toBe("كل حفظ يبدأ بمقطع صغير.");
    expect(memorizeProgressLine(12, 159, 0)).toBe("واصل من حيث توقفت.");
    expect(memorizeProgressLine(159, 159, 0)).toBe("سمّعت كل المتاح للحفظ في هذا المتن.");
    expect(memorizeProgressLine(12, 159, 2)).toBe("لديك محفوظ يحتاج إلى مراجعة.");
  });
  it("nothing approved yet is never reported as complete", () => {
    expect(memorizeProgressLine(0, 0, 0)).toBe("كل حفظ يبدأ بمقطع صغير.");
  });
});
