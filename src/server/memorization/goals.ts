import type { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_TIMEZONE, dayKey, isValidTimezone, monthPeriod, startOfDayUtc, weekPeriod } from "@/lib/learning-time";

export type MemorizationGoalPeriod = "DAILY" | "WEEKLY" | "MONTHLY";
export type MemorizationGoalView = { targetUnits: number; period: MemorizationGoalPeriod; isActive: boolean; completedUnits: number; periodStart: string } | null;

function period(now: Date, timezone: string, kind: MemorizationGoalPeriod) {
  if (kind === "DAILY") { const key = dayKey(now, timezone); return { start: startOfDayUtc(key, timezone), end: startOfDayUtc(dayKey(new Date(now.getTime() + 36 * 60 * 60_000), timezone), timezone), key }; }
  const p = kind === "WEEKLY" ? weekPeriod(now, timezone) : monthPeriod(now, timezone);
  return { start: p.start, end: p.end, key: p.startKey };
}

export async function getMemorizationGoal(db: PrismaClient, userId: string, now = new Date()): Promise<MemorizationGoalView> {
  const [goal, settings] = await Promise.all([db.memorizationGoal.findUnique({ where: { userId } }), db.learnerSettings.findUnique({ where: { userId }, select: { timezone: true } })]);
  if (!goal) return null;
  const timezone = settings && isValidTimezone(settings.timezone) ? settings.timezone : DEFAULT_TIMEZONE;
  const p = period(now, timezone, goal.period);
  const completedUnits = await db.memorizationGoalCredit.count({ where: { userId, createdAt: { gte: p.start, lt: p.end } } });
  return { targetUnits: goal.targetUnits, period: goal.period, isActive: goal.isActive, completedUnits, periodStart: p.key };
}

export async function saveMemorizationGoal(db: PrismaClient, userId: string, input: { targetUnits: number; period: MemorizationGoalPeriod; isActive: boolean }) {
  if (!Number.isInteger(input.targetUnits) || input.targetUnits < 1 || input.targetUnits > 500) throw new RangeError("invalid memorization goal");
  await db.memorizationGoal.upsert({ where: { userId }, create: { userId, ...input }, update: input });
}
