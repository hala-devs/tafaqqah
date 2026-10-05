import { beforeEach, describe, expect, it } from "vitest";
import { completeSession, startAssessment } from "@/server/assessment/engine";
import { readReport } from "@/server/assessment/report";
import { markLessonStudied } from "@/server/content/study";
import { getCompletionSummary } from "@/server/learner/completion-summary";
import { recordLearningDay } from "@/server/learner/activity";
import { getQuoteOfTheDay } from "@/server/learner/home";
import { countConceptsMastered, getMotivation, updateGoalSettings } from "@/server/learner/motivation";
import { dayKey, monthPeriod } from "@/lib/learning-time";
import type { PrismaClient } from "@/generated/prisma/client";
import { hasTestDb, testDb, truncateAll } from "./helpers/db";
import { createUser, seedFixtureCurriculum } from "./helpers/fixtures";
import { answerNext, LESSON, mockBacked } from "./helpers/flow";

const TZ = "Asia/Riyadh";

async function setup(db: PrismaClient) {
  await truncateAll();
  await seedFixtureCurriculum(db);
  const student = await createUser(db, "student@example.com");
  return { student };
}

async function completeLesson(db: PrismaClient, userId: string) {
  const deps = { db, getProvider: () => mockBacked() };
  await markLessonStudied(db, userId, LESSON);
  const { sessionId } = await startAssessment(deps, userId, LESSON);
  while (await answerNext(db, deps, userId, sessionId, "correct")) {
    /* answer every approved question */
  }
  return db.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } });
}

describe.skipIf(!hasTestDb)("student motivation (database)", () => {
  let db: PrismaClient;
  beforeEach(() => {
    db = testDb();
  });

  // ───────────────────────── streak ─────────────────────────

  it("a brand-new student has no streak, no goals and no activity", async () => {
    const { student } = await setup(db);
    const m = await getMotivation(db, student.id);
    expect(m.streak).toEqual({ count: 0, activeToday: false, atRisk: false });
    expect(m.weekly).toBeNull();
    expect(m.monthly).toBeNull();
    expect(m.weeklyLessons).toBe(0);
    expect(await db.learningDay.count()).toBe(0);
  });

  it("logging in or opening pages never counts — only real learning writes a day", async () => {
    const { student } = await setup(db);
    // Nothing in the auth/session path calls recordLearningDay; reading the home does not either.
    await getMotivation(db, student.id);
    await getMotivation(db, student.id);
    expect(await db.learningDay.count({ where: { userId: student.id } })).toBe(0);
  });

  it("the same day is never counted twice", async () => {
    const { student } = await setup(db);
    const now = new Date("2026-10-03T09:00:00Z");
    await recordLearningDay(db, student.id, now);
    await recordLearningDay(db, student.id, new Date("2026-10-03T18:00:00Z"));
    await recordLearningDay(db, student.id, new Date("2026-10-03T20:59:00Z")); // 23:59 in Riyadh: still the same day
    expect(await db.learningDay.count({ where: { userId: student.id } })).toBe(1);
    const m = await getMotivation(db, student.id, new Date("2026-10-03T20:59:30Z"));
    expect(m.streak.count).toBe(1);
  });

  it("the next day extends the streak; a missed day breaks it; the week strip follows", async () => {
    const { student } = await setup(db);
    await recordLearningDay(db, student.id, new Date("2026-10-03T08:00:00Z")); // Sat
    await recordLearningDay(db, student.id, new Date("2026-10-04T08:00:00Z")); // Sun
    await recordLearningDay(db, student.id, new Date("2026-10-05T08:00:00Z")); // Mon

    const monday = await getMotivation(db, student.id, new Date("2026-10-05T10:00:00Z"));
    expect(monday.streak).toEqual({ count: 3, activeToday: true, atRisk: false });
    expect(monday.strip.map((d) => d.state)).toEqual(["done", "done", "today-done", "upcoming", "upcoming", "upcoming", "upcoming"]);

    const tuesdayMorning = await getMotivation(db, student.id, new Date("2026-10-06T05:00:00Z"));
    expect(tuesdayMorning.streak).toEqual({ count: 3, activeToday: false, atRisk: true });

    const wednesday = await getMotivation(db, student.id, new Date("2026-10-07T10:00:00Z"));
    expect(wednesday.streak.count).toBe(0);
  });

  it("the learner's timezone decides which day a lesson belongs to", async () => {
    const { student } = await setup(db);
    await updateGoalSettings(db, student.id, { timezone: "America/New_York" });
    await recordLearningDay(db, student.id, new Date("2026-10-03T22:00:00Z")); // 18:00 in New York → 10-03
    const row = await db.learningDay.findFirstOrThrow({ where: { userId: student.id } });
    expect(row.day).toBe("2026-10-03");

    await updateGoalSettings(db, student.id, { timezone: TZ });
    await recordLearningDay(db, student.id, new Date("2026-10-03T22:00:00Z")); // 01:00 on 10-04 in Riyadh
    expect((await db.learningDay.findMany({ where: { userId: student.id }, orderBy: { day: "asc" } })).map((r) => r.day)).toEqual(["2026-10-03", "2026-10-04"]);
  });

  // ───────────────────────── goals ─────────────────────────

  it("goal settings are optional, validated, and can be cleared", async () => {
    const { student } = await setup(db);
    await updateGoalSettings(db, student.id, { weeklyLessonGoal: 3 });
    await updateGoalSettings(db, student.id, { monthlyGoalKind: "LESSONS", monthlyGoalTarget: 10 });
    const m = await getMotivation(db, student.id);
    expect(m.weekly).toMatchObject({ target: 3, current: 0, remaining: 3, done: false, pct: 0 });
    expect(m.monthly).toMatchObject({ kind: "LESSONS", target: 10, current: 0 });

    await expect(updateGoalSettings(db, student.id, { weeklyLessonGoal: 0 })).rejects.toThrow(RangeError);
    await expect(updateGoalSettings(db, student.id, { weeklyLessonGoal: 99 })).rejects.toThrow(RangeError);
    await expect(updateGoalSettings(db, student.id, { monthlyGoalKind: "LESSONS", monthlyGoalTarget: null })).rejects.toThrow(RangeError);
    await expect(updateGoalSettings(db, student.id, { timezone: "Not/AZone" })).rejects.toThrow(RangeError);

    await updateGoalSettings(db, student.id, { weeklyLessonGoal: null, monthlyGoalKind: null, monthlyGoalTarget: null });
    const cleared = await getMotivation(db, student.id);
    expect(cleared.weekly).toBeNull();
    expect(cleared.monthly).toBeNull();
  });

  it("weekly and monthly goals read the real completions and roll over at the right midnight", async () => {
    const { student } = await setup(db);
    await updateGoalSettings(db, student.id, { weeklyLessonGoal: 2, monthlyGoalKind: "LESSONS", monthlyGoalTarget: 4 });
    const done = (lessonId: string, at: string) => db.lessonProgress.upsert({ where: { userId_lessonId: { userId: student.id, lessonId } }, update: { completedAt: new Date(at) }, create: { userId: student.id, lessonId, studied: true, completedAt: new Date(at) } });

    await done(LESSON, "2026-10-09T20:00:00Z"); // Friday 23:00 Riyadh — last day of the week
    const friday = await getMotivation(db, student.id, new Date("2026-10-09T20:30:00Z"));
    expect(friday.weekly?.current).toBe(1);
    expect(friday.monthly?.current).toBe(1);

    const saturday = await getMotivation(db, student.id, new Date("2026-10-09T21:30:00Z")); // 00:30 Saturday: new week, same month
    expect(saturday.weekly?.current).toBe(0);
    expect(saturday.monthly?.current).toBe(1);

    const nextMonth = await getMotivation(db, student.id, new Date("2026-10-31T21:30:00Z")); // 00:30 on 1 Nov: new month
    expect(nextMonth.monthly?.current).toBe(0);
    expect(nextMonth.monthly?.monthName).toBe("نوفمبر");
  });

  it("a completed weekly goal is reported as done", async () => {
    const { student } = await setup(db);
    await updateGoalSettings(db, student.id, { weeklyLessonGoal: 1 });
    await db.lessonProgress.create({ data: { userId: student.id, lessonId: LESSON, studied: true, completedAt: new Date("2026-10-05T08:00:00Z") } });
    const m = await getMotivation(db, student.id, new Date("2026-10-05T10:00:00Z"));
    expect(m.weekly).toMatchObject({ current: 1, target: 1, done: true, remaining: 0, pct: 100 });
  });

  // ───────────────────────── the real loop ─────────────────────────

  it("completing a lesson updates streak, goals, mastery and the completion summary — and persists", async () => {
    const { student } = await setup(db);
    await updateGoalSettings(db, student.id, { weeklyLessonGoal: 3, monthlyGoalKind: "CONCEPTS", monthlyGoalTarget: 30, timezone: TZ });

    const before = await getMotivation(db, student.id);
    expect(before.streak.count).toBe(0);
    expect(before.weekly?.current).toBe(0);

    const session = await completeLesson(db, student.id);
    expect(session.status).toBe("COMPLETED");
    const report = readReport(session.report)!;
    const progress = await db.lessonProgress.findUniqueOrThrow({ where: { userId_lessonId: { userId: student.id, lessonId: LESSON } } });
    expect(progress.completedAt).not.toBeNull();

    // Streak: exactly one learning day (studying and finishing the same day is one day).
    expect(await db.learningDay.count({ where: { userId: student.id } })).toBe(1);
    const after = await getMotivation(db, student.id);
    expect(after.streak).toMatchObject({ count: 1, activeToday: true });
    expect(after.weekly).toMatchObject({ current: 1, target: 3, remaining: 2 });

    // Monthly concept goal = concepts lifted into «متقن» during the month, from the real answer history.
    const month = monthPeriod(new Date(), TZ);
    expect(await countConceptsMastered(db, student.id, month)).toBe(report.strongConceptIds.length);
    expect(after.monthly?.current).toBe(report.strongConceptIds.length);

    // Completion summary: before → after for the weekly goal, real mastered counts.
    const summary = await getCompletionSummary(db, student.id, { id: session.id, completedAt: session.completedAt }, progress.completedAt, report);
    expect(summary.weekly).toMatchObject({ before: 0, current: 1, target: 3 });
    expect(summary.mastered + summary.stabilized).toBe(report.strongConceptIds.length);
    expect(summary.stabilized).toBe(0); // nothing needed the review loop
    expect(summary.streak.count).toBe(1);

    // Completing the same lesson's assessment again the same day changes neither the streak nor the goal.
    const deps = { db, getProvider: () => mockBacked() };
    const again = await startAssessment(deps, student.id, LESSON);
    while (await answerNext(db, deps, student.id, again.sessionId, "correct")) {
      /* finish */
    }
    expect(await db.learningDay.count({ where: { userId: student.id } })).toBe(1);
    expect((await getMotivation(db, student.id)).weekly?.current).toBe(1);

    // Persistence: a fresh read returns exactly the same numbers.
    expect(await getMotivation(db, student.id)).toEqual(await getMotivation(db, student.id));
    expect(dayKey(new Date(), TZ)).toBe((await db.learningDay.findFirstOrThrow({ where: { userId: student.id } })).day);
  });

  it("a completion that happened in an earlier week does not pretend to move this week's goal", async () => {
    const { student } = await setup(db);
    await updateGoalSettings(db, student.id, { weeklyLessonGoal: 3 });
    const session = await completeLesson(db, student.id);
    const report = readReport(session.report)!;
    const progress = await db.lessonProgress.findUniqueOrThrow({ where: { userId_lessonId: { userId: student.id, lessonId: LESSON } } });
    const later = new Date(Date.now() + 14 * 24 * 3600 * 1000);
    const summary = await getCompletionSummary(db, student.id, { id: session.id, completedAt: session.completedAt }, progress.completedAt, report, later);
    expect(summary.weekly?.current).toBe(0);
    expect(summary.weekly?.before).toBe(0);
  });

  it("completeSession is idempotent for the streak", async () => {
    const { student } = await setup(db);
    const session = await completeLesson(db, student.id);
    await completeSession(db, session.id, "FIXED_SET_DONE");
    expect(await db.learningDay.count({ where: { userId: student.id } })).toBe(1);
  });

  // ───────────────────────── quotes ─────────────────────────

  it("only approved quotes with an author and source are ever shown", async () => {
    await setup(db);
    expect(await getQuoteOfTheDay(db, "2026-10-03")).toBeNull();

    await db.quote.create({ data: { text: "اقتباس لم يُعتمد", author: "مؤلف", source: "كتاب", approved: false } });
    expect(await getQuoteOfTheDay(db, "2026-10-03")).toBeNull();

    await db.quote.create({ data: { text: "اقتباس بلا مصدر", author: "مؤلف", source: "  ", approved: true } });
    expect(await getQuoteOfTheDay(db, "2026-10-03")).toBeNull();

    await db.quote.create({ data: { text: "اقتباس معتمد", author: "مؤلف", source: "كتاب، ص ١", approved: true, approvedAt: new Date(), approvedById: "reviewer" } });
    expect(await getQuoteOfTheDay(db, "2026-10-03")).toMatchObject({ text: "اقتباس معتمد", author: "مؤلف", source: "كتاب، ص ١" });
    // Deterministic for the day.
    expect(await getQuoteOfTheDay(db, "2026-10-03")).toEqual(await getQuoteOfTheDay(db, "2026-10-03"));
  });
});
