import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { markingModeCopy, SelfAssessmentList } from "@/components/memorize/self-assessment";
import { tokenizeCanonicalMatn } from "@/lib/matn-tokens";
import { changeAssessmentScope, changeAssessmentStatus, toggleAssessmentWord, type AssessmentDetail } from "@/lib/recitation-detail";

const MATN = "الْحَمْدُ لِلَّهِ الْمُفَقِّهِ مَنْ شَاءَ مِنْ خَلْقِهِ الْكَرِيمِ فِي الدِّينِ";
const TOKENS = tokenizeCanonicalMatn(MATN);
const unit = { id: "unit-1", order: 1, text: MATN };

function render(detail: AssessmentDetail): string {
  return renderToStaticMarkup(createElement(SelfAssessmentList, {
    units: [unit],
    answers: { [unit.id]: detail },
    onChange: vi.fn(),
  }));
}

function tokenCount(html: string) {
  return (html.match(/data-testid="matn-token"/g) ?? []).length;
}

function textContent(html: string) {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
}

function expectCanonicalTokens(html: string) {
  expect(tokenCount(html)).toBe(TOKENS.length);
  TOKENS.forEach((token, index) => {
    expect(html).toContain(`data-word-index="${index}"`);
    expect(html).toContain(`>${token}</span>`);
  });
}

const words = (status: "INCORRECT" | "FORGOTTEN") => changeAssessmentScope(changeAssessmentStatus(status), "WORDS");

const STATUS_COPY = [
  "صحيح",
  "استذكرته كما هو",
  "أخطأت",
  "فيه خطأ أو نقص",
  "لم أتذكر",
  "لم يستحضره",
] as const;

function expectStageCopy(html: string) {
  expect(html).toContain("كيف كان تسميعك لهذا السطر؟");
  expect(html).toContain("صحيح");
  expect(html).toContain("يحتاج تصحيحًا");
  expect(html).toContain('data-testid="assess-1-CORRECT"');
  expect((html.match(/<svg/g) ?? []).length).toBeGreaterThanOrEqual(1);
}

describe("word-level self-assessment rendering", () => {
  it("uses the active marking mode for the heading and helper without changing stored word marks", () => {
    expect(markingModeCopy("INCORRECT")).toEqual({ heading: "ما الذي أخطأت فيه؟", helper: "اضغط على الكلمات التي أخطأت فيها." });
    expect(markingModeCopy("FORGOTTEN")).toEqual({ heading: "ما الذي لم تتذكره؟", helper: "اضغط على الكلمات التي لم تتذكرها." });
    expect(markingModeCopy("INCORRECT")).toEqual({ heading: "ما الذي أخطأت فيه؟", helper: "اضغط على الكلمات التي أخطأت فيها." });

    const incorrect = toggleAssessmentWord(words("INCORRECT"), 1, "INCORRECT");
    const mixed = toggleAssessmentWord(incorrect, 2, "FORGOTTEN");
    expect(mixed).toMatchObject({ wordIndexes: [1], forgottenWordIndexes: [2] });
  });

  it("keeps every status button title and subtitle mounted through every selected state and detail scope", () => {
    const transitions: AssessmentDetail[] = [
      changeAssessmentStatus("CORRECT"),
      changeAssessmentStatus("INCORRECT"),
      words("INCORRECT"),
      changeAssessmentScope(words("INCORRECT"), "FULL_UNIT"),
      changeAssessmentStatus("FORGOTTEN"),
      words("FORGOTTEN"),
      changeAssessmentScope(words("FORGOTTEN"), "FULL_UNIT"),
      changeAssessmentStatus("CORRECT"),
    ];

    for (const detail of transitions) {
      const html = render(detail);
      expect(html).toBeTruthy();
      if (detail.status === "CORRECT") expectStageCopy(html);
      if (detail.scope !== null) expect(html).toContain('data-testid="assessment-stage-2"');
    }
  });

  it("renders every canonical token before selection and retains its exact diacritics", () => {
    const html = render(words("INCORRECT"));
    expectCanonicalTokens(html);
    expect(textContent(html)).toContain(MATN);
    expect(html).not.toContain("data-testid=\"matn-token-label\"");
  });

  it("selecting, selecting multiple, and deselecting only changes selected token state", () => {
    const initial = words("INCORRECT");
    const one = toggleAssessmentWord(initial, 2);
    const multiple = toggleAssessmentWord(toggleAssessmentWord(one, 5), TOKENS.length - 1);
    const deselected = toggleAssessmentWord(multiple, 5);

    for (const detail of [initial, one, multiple, deselected]) expectCanonicalTokens(render(detail));
    expect(one.wordIndexes).toEqual([2]);
    expect(multiple.wordIndexes).toEqual([2, 5, TOKENS.length - 1]);
    expect(deselected.wordIndexes).toEqual([2, TOKENS.length - 1]);

    const oneHtml = render(one);
    expect((oneHtml.match(/data-selected="true"/g) ?? [])).toHaveLength(1);
    expect(oneHtml).toContain(`data-word-index="2" data-selected="true"`);
    expect(oneHtml).toContain("خطأ");
    expect(oneHtml).toContain(`${TOKENS[2]} — محددة كخطأ`);
  });

  it.each([
    ["INCORRECT", "خطأ"],
    ["FORGOTTEN", "لم أتذكر"],
  ] as const)("keeps the full Matn and labels only selected %s words", (status, label) => {
    const detail = toggleAssessmentWord(toggleAssessmentWord(words(status), 0), TOKENS.length - 1);
    const html = render(detail);
    expectCanonicalTokens(html);
    expect((html.match(/data-testid="matn-token-label"/g) ?? [])).toHaveLength(2);
    expect(html).toContain(label);
    expect(html).toContain(`${TOKENS[0]} — ${status === "INCORRECT" ? "محددة كخطأ" : "لم أتذكر"}`);
    expect(html).toContain(`${TOKENS.at(-1)} — ${status === "INCORRECT" ? "محددة كخطأ" : "لم أتذكر"}`);
  });

  it("keeps full-unit canonical text normal and shows one unit-level state indicator", () => {
    const selectedWords = toggleAssessmentWord(words("FORGOTTEN"), 3);
    const fullUnit = changeAssessmentScope(selectedWords, "FULL_UNIT");
    const html = render(fullUnit);

    expect(fullUnit.wordIndexes).toEqual([]);
    expect(html).toContain(MATN);
    expect(tokenCount(html)).toBe(0);
    expect(html).toContain("data-testid=\"full-unit-state\"");
    expect(html).toContain("المقطع كاملًا — لم أتذكر");
    expect(html).not.toContain("data-testid=\"matn-token-label\"");
  });

  it("clears stale selections across status and scope changes without changing canonical text", () => {
    const incorrectWords = toggleAssessmentWord(toggleAssessmentWord(words("INCORRECT"), 2), 4);
    const forgotten = changeAssessmentStatus("FORGOTTEN");
    const forgottenWords = toggleAssessmentWord(words("FORGOTTEN"), 3);
    const fullUnit = changeAssessmentScope(forgottenWords, "FULL_UNIT");
    const wordsAgain = changeAssessmentScope(fullUnit, "WORDS");

    expect(forgotten.wordIndexes).toEqual([]);
    expect(fullUnit.wordIndexes).toEqual([]);
    expect(wordsAgain.wordIndexes).toEqual([]);
    for (const detail of [incorrectWords, words("FORGOTTEN"), forgottenWords, wordsAgain]) expectCanonicalTokens(render(detail));
    expect(render(fullUnit)).toContain(MATN);
  });
});
