import type { PrismaClient } from "@/generated/prisma/client";
import {
  DEFAULT_TIMEZONE,
  addDays,
  computeStreak,
  dayKey,
  isValidTimezone,
  monthPeriod,
  weekPeriod,
  weekStrip,
  type Period,
  type Streak,
  type StripDay,
} from "@/lib/learning-time";

export type MonthlyGoalKind = "LESSONS" | "CONCEPTS";

export type GoalSettings = {
  timezone: string;
  weeklyLessonGoal: number | null;
  monthlyGoalKind: MonthlyGoalKind | null;
  monthlyGoalTarget: number | null;
};

export type GoalProgress = {
  target: number;
  current: number;
  remaining: number;
  done: boolean;
  /** 0–100, capped. */
  pct: number;
};

export type Motivation = {
  settings: GoalSettings;
  today: string;
  streak: Streak;
  strip: StripDay[];
  /** Lessons completed this week, even when the learner set no goal. */
  weeklyLessons: number;
  weekly: GoalProgress | null;
  monthly: (GoalProgress & { kind: MonthlyGoalKind; monthName: string }) | null;
};

export type Continuity = {
  activeDays: string[];
  currentStreak: Streak;
  longestStreak: number;
  totalActiveDays: number;
};

/** Longest run in ordered local-day keys; used only for truthful historical continuity. */
export function longestActiveStreak(activeDays: readonly string[]): number {
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of activeDays) {
    run = previous && day === addDays(previous, 1) ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  return longest;
}

export const WEEKLY_GOAL_PRESETS = [1, 2, 3, 5] as const;
export const MONTHLY_GOAL_PRESETS: Record<MonthlyGoalKind, readonly number[]> = {
  LESSONS: [4, 8, 10, 12],
  CONCEPTS: [10, 20, 30, 50],
};
export const GOAL_LIMITS = { weekly: { min: 1, max: 14 }, monthly: { min: 1, max: 200 } } as const;

const STREAK_LOOKBACK_DAYS = 400;

export function goalProgress(target: number, current: number): GoalProgress {
  const remaining = Math.max(0, target - current);
  return { target, current, remaining, done: current >= target, pct: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0 };
}

export async function getGoalSettings(db: PrismaClient, userId: string): Promise<GoalSettings> {
  const row = await db.learnerSettings.findUnique({ where: { userId } });
  const timezone = row && isValidTimezone(row.timezone) ? row.timezone : DEFAULT_TIMEZONE;
  return {
    timezone,
    weeklyLessonGoal: row?.weeklyLessonGoal ?? null,
    monthlyGoalKind: row?.monthlyGoalKind ?? null,
    monthlyGoalTarget: row?.monthlyGoalKind && row.monthlyGoalTarget ? row.monthlyGoalTarget : null,
  };
}

/** Lessons whose first completion happened inside [period.start, period.end). */
export function countLessonsCompleted(db: PrismaClient, userId: string, period: Period): Promise<number> {
  return db.lessonProgress.count({ where: { userId, completedAt: { gte: period.start, lt: period.end } } });
}

/**
 * Concepts that moved up into the «متقن» group (GOOD or MASTERED) during the period, counted
 * once each. It reads the real answer history, so a concept only counts when an answer lifted it.
 */
export async function countConceptsMastered(db: PrismaClient, userId: string, period: Period): Promise<number> {
  const rows = await db.studentAnswer.findMany({
    where: {
      userId,
      answeredAt: { gte: period.start, lt: period.end },
      stateAfter: { in: ["GOOD", "MASTERED"] },
      stateBefore: { in: ["LEARNING", "NEEDS_REINFORCEMENT"] },
    },
    select: { question: { select: { conceptId: true } } },
  });
  return new Set(rows.map((r) => r.question.conceptId)).size;
}

function monthName(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", { month: "long", timeZone }).format(now);
}

export async function getMotivation(db: PrismaClient, userId: string, now: Date = new Date()): Promise<Motivation> {
  const settings = await getGoalSettings(db, userId);
  const tz = settings.timezone;
  const today = dayKey(now, tz);
  const week = weekPeriod(now, tz);
  const month = monthPeriod(now, tz);

  const [days, weeklyLessons] = await Promise.all([
    db.learningDay.findMany({ where: { userId, day: { gte: addDays(today, -STREAK_LOOKBACK_DAYS) } }, select: { day: true } }),
    countLessonsCompleted(db, userId, week),
  ]);
  const active = new Set(days.map((d) => d.day));

  let monthly: Motivation["monthly"] = null;
  if (settings.monthlyGoalKind && settings.monthlyGoalTarget) {
    const current =
      settings.monthlyGoalKind === "LESSONS"
        ? await countLessonsCompleted(db, userId, month)
        : await countConceptsMastered(db, userId, month);
    monthly = { ...goalProgress(settings.monthlyGoalTarget, current), kind: settings.monthlyGoalKind, monthName: monthName(now, tz) };
  }

  return {
    settings,
    today,
    streak: computeStreak(active, today),
    strip: weekStrip(active, today),
    weeklyLessons,
    weekly: settings.weeklyLessonGoal ? goalProgress(settings.weeklyLessonGoal, weeklyLessons) : null,
    monthly,
  };
}

/** Full account continuity history, derived only from qualifying LearningDay records. */
export async function getContinuity(db: PrismaClient, userId: string, now: Date = new Date()): Promise<Continuity> {
  const settings = await getGoalSettings(db, userId);
  const activeDays = (await db.learningDay.findMany({ where: { userId }, orderBy: { day: "asc" }, select: { day: true } })).map((row) => row.day);
  const active = new Set(activeDays);
  return { activeDays, currentStreak: computeStreak(active, dayKey(now, settings.timezone)), longestStreak: longestActiveStreak(activeDays), totalActiveDays: activeDays.length };
}

export type GoalUpdate = {
  weeklyLessonGoal?: number | null;
  monthlyGoalKind?: MonthlyGoalKind | null;
  monthlyGoalTarget?: number | null;
  timezone?: string;
};

/** Validates and stores goals. Goals are optional: null clears them. */
export async function updateGoalSettings(db: PrismaClient, userId: string, update: GoalUpdate): Promise<void> {
  const data: GoalUpdate = {};
  if (update.weeklyLessonGoal !== undefined) {
    const v = update.weeklyLessonGoal;
    if (v !== null && !(Number.isInteger(v) && v >= GOAL_LIMITS.weekly.min && v <= GOAL_LIMITS.weekly.max)) throw new RangeError("weekly goal out of range");
    data.weeklyLessonGoal = v;
  }
  if (update.monthlyGoalKind !== undefined || update.monthlyGoalTarget !== undefined) {
    const kind = update.monthlyGoalKind ?? null;
    const target = update.monthlyGoalTarget ?? null;
    if ((kind === null) !== (target === null)) throw new RangeError("monthly goal needs both a kind and a target");
    if (target !== null && !(Number.isInteger(target) && target >= GOAL_LIMITS.monthly.min && target <= GOAL_LIMITS.monthly.max)) {
      throw new RangeError("monthly goal out of range");
    }
    data.monthlyGoalKind = kind;
    data.monthlyGoalTarget = target;
  }
  if (update.timezone !== undefined) {
    if (!isValidTimezone(update.timezone)) throw new RangeError("invalid timezone");
    data.timezone = update.timezone;
  }
  await db.learnerSettings.upsert({ where: { userId }, update: data, create: { userId, ...data } });
}
