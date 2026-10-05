import { describe, expect, it } from "vitest";
import {
  addDays,
  computeStreak,
  dayKey,
  isValidTimezone,
  monthPeriod,
  monthStartKey,
  nextMonthStartKey,
  startOfDayUtc,
  weekPeriod,
  weekStartKey,
  weekStrip,
} from "@/lib/learning-time";

const set = (...days: string[]) => new Set(days);

describe("day keys and timezones", () => {
  it("the same instant is a different local day in different timezones", () => {
    const instant = new Date("2026-10-03T21:30:00Z");
    expect(dayKey(instant, "Asia/Riyadh")).toBe("2026-10-04"); // 00:30 next day
    expect(dayKey(instant, "UTC")).toBe("2026-10-03");
    expect(dayKey(instant, "America/New_York")).toBe("2026-10-03");
  });

  it("start of a local day is the right UTC instant, also across a DST change", () => {
    expect(startOfDayUtc("2026-10-04", "Asia/Riyadh").toISOString()).toBe("2026-10-03T21:00:00.000Z");
    expect(startOfDayUtc("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z"); // still EDT
    expect(startOfDayUtc("2026-11-02", "America/New_York").toISOString()).toBe("2026-11-02T05:00:00.000Z"); // EST after falling back
  });

  it("validates timezone names", () => {
    expect(isValidTimezone("Asia/Riyadh")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("weeks start on Saturday and months on the 1st", () => {
  it("week start", () => {
    expect(weekStartKey("2026-10-03")).toBe("2026-10-03"); // Saturday
    expect(weekStartKey("2026-10-09")).toBe("2026-10-03"); // Friday: last day of that week
    expect(weekStartKey("2026-10-10")).toBe("2026-10-10"); // next Saturday: a new week
    expect(weekStartKey("2026-10-04")).toBe("2026-10-03"); // Sunday
  });

  it("week rollover happens at the learner's own midnight", () => {
    // Friday 2026-10-09 23:30 in Riyadh is still last week; 00:30 Saturday is the new week.
    const fri = weekPeriod(new Date("2026-10-09T20:30:00Z"), "Asia/Riyadh");
    const sat = weekPeriod(new Date("2026-10-09T21:30:00Z"), "Asia/Riyadh");
    expect(fri.startKey).toBe("2026-10-03");
    expect(sat.startKey).toBe("2026-10-10");
    expect(fri.end.getTime()).toBe(sat.start.getTime());
    expect(fri.end.toISOString()).toBe("2026-10-09T21:00:00.000Z");
  });

  it("month rollover and year end", () => {
    expect(monthStartKey("2026-10-17")).toBe("2026-10-01");
    expect(nextMonthStartKey("2026-10-17")).toBe("2026-11-01");
    expect(nextMonthStartKey("2026-12-31")).toBe("2027-01-01");
    const oct = monthPeriod(new Date("2026-10-31T20:30:00Z"), "Asia/Riyadh");
    const nov = monthPeriod(new Date("2026-10-31T21:30:00Z"), "Asia/Riyadh");
    expect(oct.startKey).toBe("2026-10-01");
    expect(nov.startKey).toBe("2026-11-01");
  });

  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("learning streak", () => {
  it("counts consecutive days ending today", () => {
    expect(computeStreak(set("2026-10-01", "2026-10-02", "2026-10-03"), "2026-10-03")).toEqual({ count: 3, activeToday: true, atRisk: false });
  });

  it("the same day twice is one day (a set cannot double count)", () => {
    expect(computeStreak(set("2026-10-03", "2026-10-03"), "2026-10-03").count).toBe(1);
  });

  it("stays alive until the day ends: yesterday's streak is intact and at risk today", () => {
    expect(computeStreak(set("2026-10-01", "2026-10-02"), "2026-10-03")).toEqual({ count: 2, activeToday: false, atRisk: true });
  });

  it("is broken after a missed day", () => {
    expect(computeStreak(set("2026-10-01", "2026-10-02"), "2026-10-04")).toEqual({ count: 0, activeToday: false, atRisk: false });
  });

  it("a gap ends the run", () => {
    expect(computeStreak(set("2026-09-28", "2026-10-02", "2026-10-03"), "2026-10-03").count).toBe(2);
  });

  it("works across month and year boundaries", () => {
    expect(computeStreak(set("2026-12-30", "2026-12-31", "2027-01-01"), "2027-01-01").count).toBe(3);
  });

  it("no activity is zero", () => {
    expect(computeStreak(set(), "2026-10-03")).toEqual({ count: 0, activeToday: false, atRisk: false });
  });
});

describe("week strip", () => {
  it("shows Saturday → Friday with done / today / quiet upcoming days", () => {
    const strip = weekStrip(set("2026-10-03", "2026-10-04"), "2026-10-05"); // Monday
    expect(strip.map((d) => d.letter).join(" ")).toBe("س ح ن ث ر خ ج");
    expect(strip.map((d) => d.state)).toEqual(["done", "done", "today", "upcoming", "upcoming", "upcoming", "upcoming"]);
  });

  it("marks today as completed when today has learning, and past empty days as missed", () => {
    const strip = weekStrip(set("2026-10-05"), "2026-10-05");
    expect(strip[2].state).toBe("today-done");
    expect(strip[0].state).toBe("missed");
  });
});
