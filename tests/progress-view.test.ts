import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { continueCtaLabel } from "@/lib/home-state";
import { groupConcepts, memorizationAction, overallNext, understandingAction, understandingStarted, type HomeTargetLike } from "@/server/learner/progress-view";
import type { MemorizeNextStep } from "@/server/memorization/path-view";

const start: MemorizeNextStep = { kind: "START", passageId: "p1", startUnitId: "u1", sectionTitle: "مقدمة المؤلف", passageTitle: "المقطع 1" };
const review: MemorizeNextStep = { kind: "REVIEW", passageId: "p3", sectionTitle: "المياه", passageTitle: "المقطع 2" };
const learn: HomeTargetLike = { stage: "LEARN", href: "/lessons/l1", lesson: { title: "الدرس الأول" }, detail: null, bookTitle: "كتاب" };
const empty = { mastered: [], learning: [], reinforce: [], unassessed: [] };

describe("understanding: grouping uses the existing mastery states", () => {
  it("«متقن» = GOOD or MASTERED; null = not assessed; reinforcement stays separate", () => {
    const g = groupConcepts([
      { id: "a", title: "أ", state: "MASTERED" },
      { id: "b", title: "ب", state: "GOOD" },
      { id: "c", title: "ج", state: "LEARNING" },
      { id: "d", title: "د", state: "NEEDS_REINFORCEMENT" },
      { id: "e", title: "هـ", state: null },
    ]);
    expect(g.mastered.map((c) => c.id)).toEqual(["a", "b"]);
    expect(g.learning.map((c) => c.id)).toEqual(["c"]);
    expect(g.reinforce.map((c) => c.id)).toEqual(["d"]);
    expect(g.unassessed.map((c) => c.id)).toEqual(["e"]);
  });
  it("a new learner has not started; studying, a finished test or an assessed concept starts it", () => {
    expect(understandingStarted({ studiedOrCompletedLessons: 0, completedAttempts: 0, groups: empty })).toBe(false);
    expect(understandingStarted({ studiedOrCompletedLessons: 1, completedAttempts: 0, groups: empty })).toBe(true);
    expect(understandingStarted({ studiedOrCompletedLessons: 0, completedAttempts: 1, groups: empty })).toBe(true);
    expect(understandingStarted({ studiedOrCompletedLessons: 0, completedAttempts: 0, groups: { ...empty, reinforce: [{ id: "x", title: "س", state: "NEEDS_REINFORCEMENT" }] } })).toBe(true);
  });
});

describe("journey card actions follow the existing stages", () => {
  it("understanding: untouched → pending test → active test → weak concepts → done", () => {
    expect(understandingAction({ stage: "LEARN", href: "/l" }, false)?.label).toBe("ابدأ من درسك الحالي");
    expect(understandingAction({ stage: "ASSESS", href: "/a" }, true)?.label).toBe("ابدأ الاختبار");
    expect(understandingAction({ stage: "ASSESS", href: "/a", inProgress: true }, true)?.label).toBe("تابع الاختبار");
    expect(understandingAction({ stage: "REVIEW", href: "/r" }, true)?.label).toBe("راجع ما يحتاج إلى تثبيت");
    expect(understandingAction(null, true)).toBeNull();
  });
  it("memorization: start → continue → review → done (no invented next item)", () => {
    expect(memorizationAction(start)).toEqual({ label: "ابدأ الحفظ", href: "/memorize/passage/p1?start=u1" });
    expect(memorizationAction({ ...start, kind: "CONTINUE" })?.label).toBe("تابع الحفظ");
    expect(memorizationAction(review)).toEqual({ label: "راجع محفوظك", href: "/memorize/passage/p3" });
    expect(memorizationAction({ kind: "DONE" })).toBeNull();
  });
});

describe("one next action, same priority as the home hero", () => {
  it("new learner: the current lesson", () => {
    const next = overallNext(learn, { step: start, bookTitle: "كتاب" });
    expect(next).toMatchObject({ journey: "UNDERSTANDING", title: "ابدأ الدرس الأول", label: continueCtaLabel({ stage: "LEARN" }), href: "/lessons/l1" });
  });
  it("an open assessment stays first", () => {
    expect(overallNext({ ...learn, stage: "ASSESS", inProgress: true, href: "/a" }, { step: review, bookTitle: "كتاب" })).toMatchObject({ title: "تابع اختبار فهمك", label: "تابع الاختبار" });
  });
  it("weak concepts after lessons are done", () => {
    expect(overallNext({ ...learn, stage: "REVIEW", href: "/r", detail: "مفهوم" }, null)).toMatchObject({ title: "ثبّت مفهومًا يحتاج إلى مراجعة", text: "مفهوم", tone: "review" });
  });
  it("memorization-only learner (no understanding target): memorization review first", () => {
    expect(overallNext(null, { step: review, bookTitle: "كتاب" })).toMatchObject({ journey: "MEMORIZATION", title: "راجع محفوظك", href: "/memorize/passage/p3" });
  });
  it("memorization resumed by the home rule", () => {
    expect(overallNext({ stage: "MEMORIZE", href: "/memorize/passage/p1", headline: "المياه — المقطع 1", lesson: null, detail: null, bookTitle: "كتاب" }, null)).toMatchObject({ journey: "MEMORIZATION", label: "تابع الحفظ" });
  });
  it("nothing left anywhere → null (truthful completion)", () => {
    expect(overallNext(null, { step: { kind: "DONE" }, bookTitle: "كتاب" })).toBeNull();
    expect(overallNext(null, null)).toBeNull();
  });
});

describe("page integrity (static)", () => {
  const page = readFileSync(join(process.cwd(), "src/app/(shell)/progress/page.tsx"), "utf8");
  it("has no combined overall percentage", () => {
    expect(page).not.toMatch(/تقدمك الكلي|تقدّمك الكلي|التقدم الكلي|overallPct|totalPct/u);
  });
  it("is not hardcoded to one book", () => {
    expect(page).not.toContain("أخصر المختصرات");
  });
  it("uses the /memorize section-state rule and the existing journey loader", () => {
    const details = readFileSync(join(process.cwd(), "src/components/progress/details.tsx"), "utf8");
    expect(details).toContain("sectionPathState");
    expect(page).toContain("loadMatnJourney");
  });
});
