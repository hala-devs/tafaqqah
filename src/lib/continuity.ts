/**
 * Pure continuity view-models for /progress: the activity calendar month and the milestone path. They read only
 * LearningDay day keys (the same source as the streak) — no new definition of activity, no I/O.
 */
import { addDays, weekdayOf, WEEK_STARTS_ON } from "@/lib/learning-time";

/** Product continuity milestones (days). Stations of consistency only — never framed as reward. */
export const CONTINUITY_MILESTONES = [3, 7, 14, 30, 60, 100] as const;

export type Milestone = { days: number; reached: boolean; current: boolean };
export type MilestonePath = {
  milestones: Milestone[];
  /** Highest milestone reached by the best streak, or null. */
  reached: number | null;
  /** Next milestone above the CURRENT streak, with the days left to reach it; null past the last one. */
  next: { days: number; remaining: number } | null;
};

/**
 * A milestone is «reached» once the longest real streak got there; «أنت هنا» marks the highest milestone the current
 * streak has passed (none while the current streak is below 3). «next» counts from the current streak.
 */
export function milestonePath(currentStreak: number, longestStreak: number): MilestonePath {
  const best = Math.max(currentStreak, longestStreak);
  const passedNow = CONTINUITY_MILESTONES.filter((d) => currentStreak >= d);
  const here = passedNow.length ? passedNow[passedNow.length - 1] : null;
  const reachedList = CONTINUITY_MILESTONES.filter((d) => best >= d);
  const nextDays = CONTINUITY_MILESTONES.find((d) => d > currentStreak) ?? null;
  return {
    milestones: CONTINUITY_MILESTONES.map((days) => ({ days, reached: best >= days, current: days === here })),
    reached: reachedList.length ? reachedList[reachedList.length - 1] : null,
    next: nextDays === null ? null : { days: nextDays, remaining: nextDays - currentStreak },
  };
}

export type CalendarCell = { key: string; day: number; state: "active" | "today-active" | "today" | "missed" | "future" };
export type CalendarMonth = { monthKey: string; lead: number; cells: CalendarCell[] };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** First day (YYYY-MM-01) of the month `delta` months away from `monthKey`. */
export function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
}

/** A Saturday-first month grid: `lead` empty slots, then one cell per day with its activity state. */
export function calendarMonth(monthKey: string, today: string, active: ReadonlySet<string>): CalendarMonth {
  const start = `${monthKey.slice(0, 7)}-01`;
  const lead = (weekdayOf(start) - WEEK_STARTS_ON + 7) % 7;
  const cells: CalendarCell[] = [];
  for (let key = start; key.slice(0, 7) === start.slice(0, 7); key = addDays(key, 1)) {
    const on = active.has(key);
    const state: CalendarCell["state"] = key === today ? (on ? "today-active" : "today") : key > today ? "future" : on ? "active" : "missed";
    cells.push({ key, day: Number(key.slice(8)), state });
  }
  return { monthKey: start, lead, cells };
}
