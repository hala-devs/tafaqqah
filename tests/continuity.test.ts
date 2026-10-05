import { describe, expect, it } from "vitest";
import { longestActiveStreak } from "@/server/learner/motivation";
import { computeStreak, weekStartKey } from "@/lib/learning-time";

describe("account continuity derivation", () => {
  it("derives current, broken, cross-month and longest streaks from real day keys", () => {
    const active = new Set(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-03", "2026-10-04"]);
    expect(computeStreak(active, "2026-10-04")).toMatchObject({ count: 2, activeToday: true });
    expect(computeStreak(active, "2026-10-05")).toMatchObject({ count: 2, activeToday: false, atRisk: true });
    expect(longestActiveStreak([...active].sort())).toBe(3);
  });

  it("uses Saturday as the week boundary", () => {
    expect(weekStartKey("2026-10-04")).toBe("2026-10-03");
  });
});
