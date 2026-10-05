import { describe, expect, it } from "vitest";
import { tokenizeCanonicalMatn } from "@/lib/matn-tokens";
import { changeAssessmentScope, changeAssessmentStatus, isAssessmentDetailShape, previousAssessmentCopy, previousWordAssessmentKind, toggleAssessmentWord } from "@/lib/recitation-detail";
import { scoreAttempt } from "@/server/memorization/scoring";
import { validateAssessmentDetail } from "@/server/memorization/recitation";

describe("canonical Matn word tokenization", () => {
  it("keeps diacritics and attaches unspaced punctuation to its word", () => {
    expect(tokenizeCanonicalMatn("بِسْمِ اللَّهِ، الرَّحْمَنِ: الرَّحِيمِ")).toEqual(["بِسْمِ", "اللَّهِ،", "الرَّحْمَنِ:", "الرَّحِيمِ"]);
  });
});

describe("detailed self-assessment validation", () => {
  const valid = (detail: { status: "CORRECT" | "INCORRECT" | "FORGOTTEN"; scope: "WORDS" | "FULL_UNIT" | null; wordIndexes: number[]; forgottenWordIndexes?: number[] }) => expect(() => validateAssessmentDetail(detail, 4)).not.toThrow();
  const invalid = (detail: { status: "CORRECT" | "INCORRECT" | "FORGOTTEN"; scope: "WORDS" | "FULL_UNIT" | null; wordIndexes: number[]; forgottenWordIndexes?: number[] }) => expect(() => validateAssessmentDetail(detail, 4)).toThrow();
  it("enforces status, scope, index and range semantics", () => {
    valid({ status: "CORRECT", scope: null, wordIndexes: [] });
    invalid({ status: "CORRECT", scope: "WORDS", wordIndexes: [] });
    valid({ status: "INCORRECT", scope: "WORDS", wordIndexes: [1] });
    invalid({ status: "INCORRECT", scope: "WORDS", wordIndexes: [] });
    valid({ status: "INCORRECT", scope: "FULL_UNIT", wordIndexes: [] });
    invalid({ status: "INCORRECT", scope: "FULL_UNIT", wordIndexes: [1] });
    valid({ status: "FORGOTTEN", scope: "WORDS", wordIndexes: [], forgottenWordIndexes: [2] });
    valid({ status: "FORGOTTEN", scope: "WORDS", wordIndexes: [1], forgottenWordIndexes: [2] });
    valid({ status: "FORGOTTEN", scope: "FULL_UNIT", wordIndexes: [] });
    invalid({ status: "FORGOTTEN", scope: "FULL_UNIT", wordIndexes: [2] });
    invalid({ status: "FORGOTTEN", scope: "WORDS", wordIndexes: [], forgottenWordIndexes: [-1] });
    invalid({ status: "FORGOTTEN", scope: "WORDS", wordIndexes: [], forgottenWordIndexes: [4] });
    invalid({ status: "FORGOTTEN", scope: "WORDS", wordIndexes: [], forgottenWordIndexes: [1, 1] });
    invalid({ status: "FORGOTTEN", scope: "WORDS", wordIndexes: [], forgottenWordIndexes: [1.5] });
    invalid({ status: "FORGOTTEN", scope: "WORDS", wordIndexes: [1], forgottenWordIndexes: [1] });
  });
  it("clears stale selections when status or scope changes", () => {
    const words = toggleAssessmentWord(changeAssessmentScope(changeAssessmentStatus("INCORRECT"), "WORDS"), 2);
    expect(words).toMatchObject({ status: "INCORRECT", scope: "WORDS", wordIndexes: [2] });
    expect(changeAssessmentStatus("CORRECT")).toEqual({ status: "CORRECT", scope: null, wordIndexes: [], forgottenWordIndexes: [] });
    expect(changeAssessmentScope(words, "FULL_UNIT")).toMatchObject({ scope: "FULL_UNIT", wordIndexes: [] });
    expect(changeAssessmentStatus("FORGOTTEN")).toEqual({ status: "FORGOTTEN", scope: null, wordIndexes: [], forgottenWordIndexes: [] });
    expect(isAssessmentDetailShape({ status: "FORGOTTEN", scope: "WORDS", wordIndexes: [], forgottenWordIndexes: [1] })).toBe(true);
  });
  it("keeps mixed word truth while deriving FORGOTTEN and moves a word between exclusive states", () => {
    const initial = changeAssessmentScope(changeAssessmentStatus("INCORRECT"), "WORDS");
    const incorrect = toggleAssessmentWord(initial, 1, "INCORRECT");
    const mixed = toggleAssessmentWord(incorrect, 2, "FORGOTTEN");
    expect(mixed).toMatchObject({ status: "FORGOTTEN", wordIndexes: [1], forgottenWordIndexes: [2] });
    const movedToForgotten = toggleAssessmentWord(mixed, 1, "FORGOTTEN");
    expect(movedToForgotten).toMatchObject({ wordIndexes: [], forgottenWordIndexes: [1, 2] });
    const movedToIncorrect = toggleAssessmentWord(movedToForgotten, 2, "INCORRECT");
    expect(movedToIncorrect).toMatchObject({ status: "FORGOTTEN", wordIndexes: [2], forgottenWordIndexes: [1] });
    const cleared = toggleAssessmentWord(movedToIncorrect, 2, "INCORRECT");
    expect(cleared.wordIndexes).toEqual([]);
  });
  it("does not change scoring for word-level versus full-unit details", () => {
    expect(scoreAttempt(["CORRECT", "INCORRECT", "FORGOTTEN"])).toEqual(scoreAttempt(["CORRECT", "INCORRECT", "FORGOTTEN"]));
  });

  it("keeps prior incorrect and forgotten word marks separate for re-recitation, including legacy and full-unit data", () => {
    const incorrect = { status: "INCORRECT" as const, scope: "WORDS" as const, wordIndexes: [1], forgottenWordIndexes: [] };
    const forgotten = { status: "FORGOTTEN" as const, scope: "WORDS" as const, wordIndexes: [], forgottenWordIndexes: [2] };
    // A mixed row has FORGOTTEN as its legacy/dominant status; it must still render index 1 as INCORRECT.
    const mixed = { status: "FORGOTTEN" as const, scope: "WORDS" as const, wordIndexes: [1], forgottenWordIndexes: [2] };
    const legacy = { status: "INCORRECT" as const, scope: "WORDS" as const, wordIndexes: [3] };

    expect(previousWordAssessmentKind(incorrect, 1)).toBe("INCORRECT");
    expect(previousWordAssessmentKind(forgotten, 2)).toBe("FORGOTTEN");
    expect(previousWordAssessmentKind(mixed, 1)).toBe("INCORRECT");
    expect(previousWordAssessmentKind(mixed, 2)).toBe("FORGOTTEN");
    expect(previousWordAssessmentKind(mixed, 0)).toBeNull();
    expect(previousWordAssessmentKind(legacy, 3)).toBe("INCORRECT");
    expect(previousWordAssessmentKind(legacy, 2)).toBeNull();
    expect(previousAssessmentCopy(incorrect)).toBe("الكلمات التي أخطأت فيها في تسميعك السابق.");
    expect(previousAssessmentCopy(forgotten)).toBe("الكلمات التي لم تتذكرها في تسميعك السابق.");
    expect(previousAssessmentCopy(mixed)).toBe("مواضع الخطأ والنسيان في تسميعك السابق.");
    expect(previousAssessmentCopy({ status: "INCORRECT", scope: "FULL_UNIT", wordIndexes: [], forgottenWordIndexes: [] })).toBe("المقطع كاملًا يحتاج إلى تصحيح.");
    expect(previousAssessmentCopy({ status: "FORGOTTEN", scope: "FULL_UNIT", wordIndexes: [], forgottenWordIndexes: [] })).toBe("لم تتذكر هذا المقطع في التسميع السابق.");
  });
});
