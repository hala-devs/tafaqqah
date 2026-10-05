import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { calendarMonth, milestonePath, shiftMonth } from "@/lib/continuity";
import { computeStreak } from "@/lib/learning-time";
import { goalProgress, longestActiveStreak } from "@/server/learner/motivation";
import { activityText, mergeActivity, type ActivityItem } from "@/server/learner/recent-activity";

const days = (...keys: string[]) => new Set(keys);

describe("streak figures (LearningDay keys only)", () => {
  const active = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-03", "2026-10-04"];
  it("current, broken, cross-month, longest and total", () => {
    expect(computeStreak(new Set(active), "2026-10-04").count).toBe(2);
    expect(computeStreak(new Set(active), "2026-10-06").count).toBe(0); // a whole day missed breaks it
    expect(computeStreak(days("2026-09-30", "2026-10-01"), "2026-10-01").count).toBe(2); // across months
    expect(longestActiveStreak(active)).toBe(4);
    expect(new Set(active).size).toBe(6);
  });
  it("a new learner has nothing", () => {
    expect(computeStreak(new Set(), "2026-10-04")).toMatchObject({ count: 0, activeToday: false });
    expect(longestActiveStreak([])).toBe(0);
  });
});

describe("activity calendar month", () => {
  const m = calendarMonth("2026-10-01", "2026-10-07", days("2026-10-01", "2026-10-07", "2026-09-30"));
  it("starts on Saturday with the right lead and every day of the month", () => {
    expect(m.lead).toBe(5); // 1 Oct 2026 is a Thursday
    expect(m.cells).toHaveLength(31);
  });
  it("marks active, today, missed and future days", () => {
    const at = (d: number) => m.cells[d - 1].state;
    expect(at(1)).toBe("active");
    expect(at(2)).toBe("missed");
    expect(at(7)).toBe("today-active");
    expect(at(8)).toBe("future");
    expect(calendarMonth("2026-10-01", "2026-10-07", days()).cells[6].state).toBe("today");
  });
  it("navigates months, including across the year", () => {
    expect(shiftMonth("2026-10-01", -1)).toBe("2026-09-01");
    expect(shiftMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(calendarMonth("2026-09-01", "2026-10-07", days("2026-09-30")).cells[29].state).toBe("active");
  });
});

describe("continuity milestones", () => {
  it("new learner: none reached, next is 3 days", () => {
    const p = milestonePath(0, 0);
    expect(p.milestones.every((m) => !m.reached && !m.current)).toBe(true);
    expect(p.next).toEqual({ days: 3, remaining: 3 });
  });
  it("«أنت هنا» is the highest milestone the CURRENT streak passed; best streak marks reached ones", () => {
    const p = milestonePath(8, 15);
    expect(p.milestones.find((m) => m.current)?.days).toBe(7);
    expect(p.milestones.filter((m) => m.reached).map((m) => m.days)).toEqual([3, 7, 14]);
    expect(p.next).toEqual({ days: 14, remaining: 6 });
  });
  it("a broken streak keeps past milestones but has no current marker", () => {
    const p = milestonePath(0, 9);
    expect(p.milestones.some((m) => m.current)).toBe(false);
    expect(p.reached).toBe(7);
  });
  it("past the last milestone there is no next", () => {
    expect(milestonePath(120, 120).next).toBeNull();
  });
});

describe("goal progress (no goal → no percentage)", () => {
  it("learning goal progress is capped and reports done", () => {
    expect(goalProgress(3, 2)).toMatchObject({ pct: 67, done: false, remaining: 1 });
    expect(goalProgress(3, 5)).toMatchObject({ pct: 100, done: true, remaining: 0 });
  });
});

describe("recent activity", () => {
  const item = (id: string, kind: ActivityItem["kind"], at: string): ActivityItem => ({ id, kind, journey: kind.startsWith("RECITATION") ? "MEMORIZATION" : "UNDERSTANDING", title: "الدرس الأول", at: new Date(at) });
  it("merges sources newest first and limits", () => {
    const out = mergeActivity([[item("a", "LESSON_COMPLETED", "2026-10-01")], [item("b", "RECITATION", "2026-10-03"), item("c", "ASSESSMENT", "2026-10-02")]], 2);
    expect(out.map((i) => i.id)).toEqual(["b", "c"]);
  });
  it("wording is truthful per kind and never claims mastery", () => {
    expect(activityText(item("x", "RECITATION_REVIEW", "2026-10-01"))).toContain("راجعت محفوظك");
    for (const k of ["LESSON_STUDIED", "LESSON_COMPLETED", "ASSESSMENT", "REASSESSMENT", "RECITATION", "RECITATION_REVIEW"] as const) {
      expect(activityText(item("x", k, "2026-10-01"))).not.toMatch(/أتقنت|متقن|حفظت/u);
    }
  });
});

describe("/progress page integrity (static)", () => {
  const page = readFileSync(join(process.cwd(), "src/app/(shell)/progress/page.tsx"), "utf8");
  it("reads every figure from the shared helpers — no duplicated rules", () => {
    for (const fn of ["getContinuity(", "getMemorizationGoal(", "loadMatnJourney(", "getRecentActivity(", "milestonePath("]) expect(page).toContain(fn);
    expect(page).toContain("j.recited"); // cumulative memorization = distinct recited canonical lines
  });
  it("has no hardcoded mockup numbers, no combined score and no reward language", () => {
    expect(page).not.toMatch(/value=\{\d/);
    expect(page).not.toMatch(/تقدمك الكلي|overallPct|أجر|ثواب|بركة/u);
    expect(page).not.toMatch(/أكتوبر|2026/u);
  });
});

describe("cumulative memorization cannot be inflated by repeats (static)", () => {
  const src = readFileSync(join(process.cwd(), "src/server/memorization/path-view.ts"), "utf8");
  it("counts each canonical line once — a unit with ANY result, not one row per attempt", () => {
    expect(src).toMatch(/db\.matnUnit\.count\(\{ where: \{ passage, results: \{ some: \{ attempt: \{ userId \} \} \} \} \}\)/);
  });
});
