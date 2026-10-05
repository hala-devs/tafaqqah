import { describe, expect, it } from "vitest";
import { deriveHomeState, lessonProgressPct, lessonStages, type HomeStateInput } from "@/lib/home-state";
import { pickJourneyWindow, type JourneyNode } from "@/lib/journey";

const base: HomeStateInput = { hasAnyActivity: true, hasContinueTarget: true, weakCount: 0, streakCount: 0, streakActiveToday: false, weekly: null };

describe("deterministic home state", () => {
  it("NEW student: «ابدأ رحلتك» and a start CTA", () => {
    const s = deriveHomeState({ ...base, hasAnyActivity: false });
    expect(s.phase).toBe("NEW");
    expect(s.heroEyebrow).toBe("ابدأ رحلتك");
    expect(s.ctaLabel).toBe("ابدأ التعلّم");
  });

  it("IN PROGRESS: «واصل من حيث توقفت» and «متابعة التعلّم»", () => {
    const s = deriveHomeState(base);
    expect(s.phase).toBe("IN_PROGRESS");
    expect(s.heroEyebrow).toBe("واصل من حيث توقفت");
    expect(s.ctaLabel).toBe("متابعة التعلّم");
    expect(s.note?.text).toBe("خطوة اليوم تقرّبك من إتمام المستوى.");
  });

  it("goal completed beats everything", () => {
    const s = deriveHomeState({ ...base, streakCount: 5, streakActiveToday: true, weekly: { target: 3, remaining: 0, done: true } });
    expect(s.note).toEqual({ kind: "GOAL_DONE", text: "أتممت هدفك الأسبوعي ✓" });
  });

  it("one lesson from the weekly goal", () => {
    const s = deriveHomeState({ ...base, weekly: { target: 3, remaining: 1, done: false } });
    expect(s.note?.text).toBe("باقي لك درس واحد لتحقيق هدفك.");
  });

  it("active streak that was kept today vs at risk", () => {
    expect(deriveHomeState({ ...base, streakCount: 5, streakActiveToday: true }).note?.text).toBe("عودتك اليوم حافظت على سلسلة تعلّمك.");
    expect(deriveHomeState({ ...base, streakCount: 5, streakActiveToday: false }).note?.kind).toBe("STREAK_AT_RISK");
  });

  it("weak concepts are flagged and keep the page in progress when lessons are finished", () => {
    const s = deriveHomeState({ ...base, hasContinueTarget: false, weakCount: 2 });
    expect(s.hasWeak).toBe(true);
    expect(s.phase).toBe("IN_PROGRESS");
  });

  it("everything finished and nothing to review", () => {
    expect(deriveHomeState({ ...base, hasContinueTarget: false }).phase).toBe("ALL_DONE");
  });

  it("is a pure function: same input, same output", () => {
    expect(deriveHomeState(base)).toEqual(deriveHomeState({ ...base }));
  });
});

describe("lesson stages", () => {
  const states = (input: Parameters<typeof lessonStages>[0]) => lessonStages(input).map((s) => s.state);

  it("not studied: learn is current", () => {
    expect(states({ studied: false, completed: false, weakInLesson: 0, allStrong: false })).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
  });
  it("studied: test is current", () => {
    expect(states({ studied: true, completed: false, weakInLesson: 0, allStrong: false })).toEqual(["done", "current", "upcoming", "upcoming"]);
  });
  it("completed with a weak concept: review is current", () => {
    expect(states({ studied: true, completed: true, weakInLesson: 1, allStrong: false })).toEqual(["done", "done", "current", "upcoming"]);
  });
  it("completed, nothing weak, not all strong: master is current; all strong: everything done", () => {
    expect(states({ studied: true, completed: true, weakInLesson: 0, allStrong: false })).toEqual(["done", "done", "done", "current"]);
    expect(states({ studied: true, completed: true, weakInLesson: 0, allStrong: true })).toEqual(["done", "done", "done", "done"]);
  });
  it("lesson progress comes from real state only", () => {
    expect(lessonProgressPct({ studied: false, completed: false, answered: 0, total: 16 })).toBe(0);
    expect(lessonProgressPct({ studied: true, completed: false, answered: 0, total: 16 })).toBe(50);
    expect(lessonProgressPct({ studied: true, completed: false, answered: 8, total: 16 })).toBe(75);
    expect(lessonProgressPct({ studied: true, completed: false, answered: 99, total: 16 })).toBe(100);
    expect(lessonProgressPct({ studied: true, completed: true, answered: 0, total: 0 })).toBe(100);
  });
});

describe("journey window", () => {
  const nodes = (states: JourneyNode["state"][]): JourneyNode[] => states.map((state, i) => ({ id: `l${i + 1}`, number: i + 1, title: `درس ${i + 1}`, state, href: null }));
  const repeat = (n: number, state: JourneyNode["state"]) => Array.from({ length: n }, () => state);

  it("shows everything when the book is short", () => {
    const { shown, hidden } = pickJourneyWindow(nodes(["done", "current", "upcoming"]));
    expect(shown).toHaveLength(3);
    expect(hidden).toBe(0);
  });

  it("never shows 55 lessons: one behind, the current and what follows", () => {
    const states: JourneyNode["state"][] = Array.from({ length: 55 }, (_, i) => (i < 11 ? "done" : i === 11 ? "current" : "upcoming"));
    const { shown, hidden } = pickJourneyWindow(nodes(states));
    expect(shown.map((n) => n.number)).toEqual([11, 12, 13, 14]);
    expect(shown[1].state).toBe("current");
    expect(hidden).toBe(51);
  });

  it("clamps at both ends", () => {
    expect(pickJourneyWindow(nodes(["current", ...repeat(10, "upcoming")])).shown.map((n) => n.number)).toEqual([1, 2, 3, 4]);
    expect(pickJourneyWindow(nodes([...repeat(9, "done"), "current"])).shown.map((n) => n.number)).toEqual([7, 8, 9, 10]);
  });

  it("anchors on the last completed lesson when none is current", () => {
    expect(pickJourneyWindow(nodes([...repeat(8, "done"), "soon", "soon"])).shown.map((n) => n.number)).toEqual([7, 8, 9, 10]);
  });
});
