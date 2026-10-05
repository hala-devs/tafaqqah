import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { learningCardCta, learningCardState, memorizationCardCta, memorizationCardState } from "@/server/learner/home-view";
import type { MemorizeNextStep } from "@/server/memorization/path-view";

const step = (kind: MemorizeNextStep["kind"]): MemorizeNextStep =>
  kind === "DONE" ? { kind } : kind === "REVIEW" ? { kind, passageId: "p", sectionTitle: "س", passageTitle: "م" } : { kind, passageId: "p", startUnitId: "u", sectionTitle: "س", passageTitle: "م" };

describe("understanding card state (from the understanding continue target)", () => {
  const base = { started: false, completed: 0, published: 1 };
  it("new learner: «لم يبدأ»; after activity: «درس متاح»", () => {
    expect(learningCardState({ stage: "LEARN" }, base).label).toBe("لم يبدأ");
    expect(learningCardState({ stage: "LEARN" }, { ...base, started: true }).label).toBe("درس متاح");
  });
  it("assessment available vs in progress", () => {
    expect(learningCardState({ stage: "ASSESS" }, base).label).toBe("اختبار متاح");
    expect(learningCardState({ stage: "ASSESS", inProgress: true }, base).label).toBe("اختبار جارٍ");
  });
  it("weak concept review", () => {
    expect(learningCardState({ stage: "REVIEW" }, base)).toEqual({ label: "يحتاج إلى تثبيت", tone: "warning" });
  });
  it("completed only when every published lesson is completed; never invents a «continue lesson» state", () => {
    expect(learningCardState(null, { started: true, completed: 1, published: 1 }).label).toBe("مكتمل");
    expect(learningCardState(null, { started: false, completed: 0, published: 0 }).label).toBe("لا دروس متاحة الآن");
    const labels = (["LEARN", "ASSESS", "REASSESS", "REVIEW"] as const).map((s) => learningCardState({ stage: s }, base).label);
    expect(labels).not.toContain("تابع الدرس");
  });
});

describe("memorization card state (same next step as /memorize)", () => {
  it("states and CTAs", () => {
    expect([memorizationCardState(step("START")).label, memorizationCardCta(step("START"))]).toEqual(["لم يبدأ", "ابدأ الحفظ"]);
    expect([memorizationCardState(step("CONTINUE")).label, memorizationCardCta(step("CONTINUE"))]).toEqual(["جارٍ", "تابع حفظك"]);
    expect([memorizationCardState(step("REVIEW")).label, memorizationCardCta(step("REVIEW"))]).toEqual(["حان وقت المراجعة", "راجع محفوظك"]);
    expect([memorizationCardState(step("REINFORCE")).label, memorizationCardCta(step("REINFORCE"))]).toEqual(["يحتاج إلى تثبيت", "ثبّت محفوظك"]);
    expect(memorizationCardCta(step("DONE"))).toBeNull();
  });
  it("never calls recitation «حفظت» or «أتقنت» for an unfinished journey", () => {
    for (const k of ["START", "CONTINUE", "REVIEW", "REINFORCE"] as const) expect(memorizationCardState(step(k)).label).not.toMatch(/حفظت|أتقنت/u);
  });
});

describe("home page integrity (static)", () => {
  const page = readFileSync(join(process.cwd(), "src/app/(shell)/dashboard/page.tsx"), "utf8");
  it("both journeys are rendered with the same card component", () => {
    expect(page.match(/<JourneyCard\b/g)?.length).toBe(2);
  });
  it("no single global next action and no separate continue section: the journey cards are the next actions", () => {
    expect(page).not.toContain("overallNext(");
    expect(page).not.toMatch(/ContinueJourney|خطوتك التالية|NextStepPanel/u);
    expect(page).toContain("learningCardCta(");
    expect(page).toContain("getMemorizationGoal(");
    expect(page).toContain("loadMatnJourney(");
    expect(page).toContain("orderReview(");
  });
  it("is not hardcoded to a book, level or lesson id, and has no combined score", () => {
    expect(page).not.toMatch(/أخصر المختصرات|lesson-akhsar|المستوى الأول/u);
    expect(page).not.toMatch(/تقدمك الكلي|overallPct/u);
  });
});

describe("journey card CTA (from the same continue target)", () => {
  const t = (stage: "LEARN" | "ASSESS" | "REASSESS" | "REVIEW" | "DONE", inProgress = false) => ({ stage, inProgress, href: "/h", lesson: { title: "الدرس الأول" }, detail: "مفهوم" });
  it("start lesson / continue learning / start or continue assessment / review concept; none when done", () => {
    expect(learningCardCta(t("LEARN"), false)).toBe("ابدأ الدرس");
    expect(learningCardCta(t("LEARN"), true)).toBe("تابع تعلّمك");
    expect(learningCardCta(t("ASSESS"), true)).toBe("ابدأ الاختبار");
    expect(learningCardCta(t("REASSESS", true), true)).toBe("تابع الاختبار");
    expect(learningCardCta(t("REVIEW"), true)).toBe("راجع المفهوم");
    expect(learningCardCta(t("DONE"), true)).toBeNull();
    expect(learningCardCta(null, false)).toBeNull();
  });
});
