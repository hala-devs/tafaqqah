/**
 * Calendar logic for the learning streak and goals. Pure and deterministic (no I/O),
 * so streak, week and month rollover and timezone behaviour are unit-tested.
 *
 * A "day key" is a local calendar date `YYYY-MM-DD` in the learner's timezone. Weeks start on
 * Saturday (Saturday → Friday), the common week for Arabic-speaking learners.
 */

export const DEFAULT_TIMEZONE = "Asia/Riyadh";
/** 0 = Sunday … 6 = Saturday. */
export const WEEK_STARTS_ON = 6;

export function isValidTimezone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parts(date: Date, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** Local calendar date of an instant in a timezone. */
export function dayKey(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

function toUtcDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtcDate(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addDays(key: string, days: number): string {
  const date = toUtcDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtcDate(date);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: string): number {
  return toUtcDate(key).getUTCDay();
}

export function weekStartKey(key: string): string {
  const back = (weekdayOf(key) - WEEK_STARTS_ON + 7) % 7;
  return addDays(key, -back);
}

export function monthStartKey(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

export function nextMonthStartKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return m === 12 ? `${pad(y + 1, 4)}-01-01` : `${pad(y, 4)}-${pad(m + 1)}-01`;
}

/** The UTC instant at which a local calendar day begins in a timezone. */
export function startOfDayUtc(key: string, timeZone: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const offsetAt = (ms: number) => {
    const p = parts(new Date(ms), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  };
  let instant = guess - offsetAt(guess);
  // Re-resolve once so a UTC-offset change (DST) near midnight is honoured.
  instant = guess - offsetAt(instant);
  return new Date(instant);
}

export type Period = { startKey: string; endKey: string; start: Date; end: Date };

function period(startKey: string, endKey: string, timeZone: string): Period {
  return { startKey, endKey, start: startOfDayUtc(startKey, timeZone), end: startOfDayUtc(endKey, timeZone) };
}

/** The learner's current week: [start, end) in UTC instants. */
export function weekPeriod(now: Date, timeZone: string): Period {
  const start = weekStartKey(dayKey(now, timeZone));
  return period(start, addDays(start, 7), timeZone);
}

export function monthPeriod(now: Date, timeZone: string): Period {
  const today = dayKey(now, timeZone);
  return period(monthStartKey(today), nextMonthStartKey(today), timeZone);
}

export type Streak = { count: number; activeToday: boolean; atRisk: boolean };

/**
 * Consecutive learning days. A streak is still alive on a day with no activity yet
 * (the learner can continue it today); it breaks once a whole day passes without activity.
 */
export function computeStreak(activeDays: ReadonlySet<string>, today: string): Streak {
  const activeToday = activeDays.has(today);
  let cursor = activeToday ? today : addDays(today, -1);
  let count = 0;
  while (activeDays.has(cursor)) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return { count, activeToday, atRisk: count > 0 && !activeToday };
}

export const WEEKDAY_LETTER: Record<number, string> = { 6: "س", 0: "ح", 1: "ن", 2: "ث", 3: "ر", 4: "خ", 5: "ج" };
export const WEEKDAY_NAME: Record<number, string> = {
  6: "السبت",
  0: "الأحد",
  1: "الاثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
  5: "الجمعة",
};

export type StripDay = {
  key: string;
  letter: string;
  name: string;
  state: "done" | "today" | "today-done" | "missed" | "upcoming";
};

/** The seven days of the current week (Saturday → Friday) with each day's learning state. */
export function weekStrip(activeDays: ReadonlySet<string>, today: string): StripDay[] {
  const start = weekStartKey(today);
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDays(start, i);
    const wd = weekdayOf(key);
    let state: StripDay["state"];
    if (key === today) state = activeDays.has(key) ? "today-done" : "today";
    else if (key > today) state = "upcoming";
    else state = activeDays.has(key) ? "done" : "missed";
    return { key, letter: WEEKDAY_LETTER[wd], name: WEEKDAY_NAME[wd], state };
  });
}
