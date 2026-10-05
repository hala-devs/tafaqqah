import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tokenizeCanonicalMatn } from "@/lib/matn-tokens";
import { memorizePassageHref, reviewHref } from "@/lib/routes";
import { lineLabel, memorizationReason, orderReview, reviewSummary, wordLabel } from "@/server/learner/review-view";
import type { MemorizationReviewItem } from "@/server/memorization/review-data";

const item = (id: string, over: Partial<MemorizationReviewItem> = {}): MemorizationReviewItem => ({
  passageId: id,
  passageTitle: "المقطع 1",
  sectionTitle: "مقدمة المؤلف",
  bookTitle: over.bookTitle ?? "كتاب أ",
  state: "NEEDS_REVIEW",
  due: true,
  repeatedWeakness: false,
  nextReviewAt: new Date(0),
  details: [],
  ...over,
});
const weak = [{ conceptId: "c1" }, { conceptId: "c2" }];

describe("summary and empty states", () => {
  it("both empty → one global empty state (no per-system cards)", () => {
    expect(reviewSummary(0, [])).toEqual({ understanding: null, memorization: null, empty: true });
  });
  it("understanding only", () => {
    const s = reviewSummary(2, []);
    expect(s).toMatchObject({ understanding: "مفهومان يحتاجان إلى تثبيت", memorization: null, empty: false });
  });
  it("memorization only — due and reinforcement are counted separately", () => {
    const s = reviewSummary(0, [item("a"), item("b"), item("c", { due: false, state: "NEEDS_REINFORCEMENT" })]);
    expect(s.understanding).toBeNull();
    expect(s.memorization).toBe("مقطعان حان وقت مراجعتها، ومقطع واحد يحتاج إلى تثبيت");
  });
  it("both systems keep their own line; there is no combined score", () => {
    const s = reviewSummary(1, [item("a")]);
    expect(Object.keys(s).sort()).toEqual(["empty", "memorization", "understanding"]);
    expect(s.understanding).toBe("مفهوم واحد يحتاج إلى تثبيت");
  });
});

describe("priority and item types", () => {
  it("memorization due → understanding → memorization reinforcement", () => {
    const order = orderReview([item("r", { due: false }), item("d")], weak).map((e) => (e.type === "MEMORIZATION" ? `M:${e.item.passageId}` : `U:${(e.item as { conceptId: string }).conceptId}`));
    expect(order).toEqual(["M:d", "U:c1", "U:c2", "M:r"]);
  });
  it("routes: targeted concept review and passage recitation", () => {
    expect(reviewHref("l1", "c1")).toContain("c1");
    expect(memorizePassageHref("p1")).toBe("/memorize/passage/p1");
  });
});

describe("due vs reinforcement wording is truthful", () => {
  it("only a schedule-due item says «حان وقت مراجعته»", () => {
    expect(memorizationReason({ due: true, repeatedWeakness: false }).label).toBe("حان وقت مراجعته");
    expect(memorizationReason({ due: true, repeatedWeakness: true }).text).toContain("تكرّر الضعف");
    expect(memorizationReason({ due: false, repeatedWeakness: false }).label).toBe("يحتاج إلى تثبيت");
    expect(memorizationReason({ due: false, repeatedWeakness: false }).text).toContain("لم يحن موعد مراجعته");
  });
});

describe("word-level details never invent positions", () => {
  it("WORDS: labels go on the words, no line label", () => {
    expect(wordLabel("INCORRECT")).toBe("خطأ");
    expect(wordLabel("FORGOTTEN")).toBe("لم أتذكر");
    expect(lineLabel({ status: "INCORRECT", scope: "WORDS" })).toBeNull();
  });
  it("FULL_UNIT: one line label, no word highlight", () => {
    expect(lineLabel({ status: "INCORRECT", scope: "FULL_UNIT" })).toBe("السطر كاملًا — أخطأت فيه");
    expect(lineLabel({ status: "FORGOTTEN", scope: "FULL_UNIT" })).toBe("السطر كاملًا — لم أتذكره");
  });
  it("legacy (null scope): unit-level wording only", () => {
    expect(lineLabel({ status: "INCORRECT", scope: null })).toBe("أخطأت في هذا السطر");
    expect(lineLabel({ status: "FORGOTTEN", scope: null })).toBe("لم تتذكر هذا السطر");
  });
  it("the canonical line keeps every token (display tokens re-join to the exact text)", () => {
    const text = "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ وَبِهِ تَوْفِيقِي";
    expect(tokenizeCanonicalMatn(text).join(" ")).toBe(text);
  });
  it("the review line renders all tokens and only annotates saved word indexes", () => {
    const src = readFileSync(join(process.cwd(), "src/components/review/review-items.tsx"), "utf8");
    expect(src).toContain("tokenizeCanonicalMatn(detail.text).map");
    expect(src).toContain('new Set([...detail.wordIndexes, ...detail.forgottenWordIndexes])');
    expect(src).toContain('wordLabel(forgotten.has(index) ? "FORGOTTEN" : detail.status)');
  });
});

describe("multi-book context and no hardcoding", () => {
  it("each memorization item carries its own book", () => {
    expect(orderReview([item("a", { bookTitle: "كتاب أ" }), item("b", { bookTitle: "كتاب ب" })], []).map((e) => (e.item as MemorizationReviewItem).bookTitle)).toEqual(["كتاب أ", "كتاب ب"]);
  });
  it("the page and components never hardcode a book title or a combined score", () => {
    for (const f of ["src/app/(shell)/review/page.tsx", "src/components/review/review-items.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src).not.toContain("أخصر المختصرات");
      expect(src).not.toMatch(/درجة المراجعة|reviewScore/u);
    }
  });
});
