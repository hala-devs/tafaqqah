import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AIProviderError } from "@/server/ai/provider";
import { getMatnOverview, setMatnPassageApproval, setMatnSectionApproval, updateMatnUnitText } from "@/server/admin/matn";
import { getBookHome, getPassageStart, getPassageUnits, getSectionView, listMemorizationBooks } from "@/server/memorization/content";
import { getAttemptResult, getDueReviews, getLatestJourneyActivity, getMemorizationContinue, getMemorizationSummaries } from "@/server/memorization/progress";
import { submitRecitation } from "@/server/memorization/recitation";
import { getMotivation } from "@/server/learner/motivation";
import { getMemorizationGoal, saveMemorizationGoal } from "@/server/memorization/goals";
import { hasTestDb, testDb, truncateAll } from "./helpers/db";
import { createUser, seedFixtureCurriculum } from "./helpers/fixtures";
import { attemptInput, MATN_COURSE, PASS_A_UNITS, results, seedMatnFixture } from "./helpers/matn-fixtures";
import { ScriptedProvider } from "./helpers/scripted-provider";

const T0 = new Date("2026-10-06T10:00:00Z"); // 13:00 in Riyadh
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const VALID_ANALYSIS = { summary: "معظم الأجزاء ثابتة لديك، والجزء ٢ يحتاج إلى مراجعة.", patterns: [], priorities: [{ unitId: "u2", reason: "لم يكن ثابتًا في تسميعك." }], progressObservation: "" };

async function setup(db: PrismaClient) {
  await truncateAll();
  await seedFixtureCurriculum(db);
  await seedMatnFixture(db);
  const student = await createUser(db, "student@example.com");
  const other = await createUser(db, "other@example.com");
  const admin = await createUser(db, "admin@example.com", "ADMIN");
  return { student, other, admin };
}

const noAI = { provider: null } as const;

describe.skipIf(!hasTestDb)("memorization (database)", () => {
  let db: PrismaClient;
  beforeEach(() => {
    db = testDb();
  });

  // ───────────────────────── content visibility ─────────────────────────

  describe("approved-only content", () => {
    it("continues at the earliest unit not completed as new, and reviews do not move it backward", async () => {
      const { student } = await setup(db);
      await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT"], PASS_A_UNITS.slice(0, 2)), { now: T0, ...noAI });
      expect((await getMemorizationContinue(db, student.id))?.startUnitId).toBe("u-a3");
      await db.memorizationMastery.updateMany({ where: { userId: student.id }, data: { nextReviewAt: new Date(T0.getTime() - 1) } });
      await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT"], PASS_A_UNITS.slice(0, 2)), { now: T0, ...noAI });
      expect((await getMemorizationContinue(db, student.id))?.startUnitId).toBe("u-a3");
    });

    it("counts only unique first-new units toward an optional memorization goal", async () => {
      const { student } = await setup(db);
      await saveMemorizationGoal(db, student.id, { targetUnits: 5, period: "WEEKLY", isActive: true });
      await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT"], PASS_A_UNITS.slice(0, 2)), { now: T0, ...noAI });
      expect((await getMemorizationGoal(db, student.id, T0))?.completedUnits).toBe(2);
      await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT"], PASS_A_UNITS.slice(0, 2)), { now: T0, ...noAI });
      expect((await getMemorizationGoal(db, student.id, T0))?.completedUnits).toBe(2);
    });
    it("shows approved passages and hides drafts, partly approved, empty and draft-section passages", async () => {
      const { student } = await setup(db);
      const home = await getBookHome(db, student.id, MATN_COURSE, T0);
      expect(home?.sections.map((s) => s.id)).toEqual(["sec-a"]);
      expect(home?.sections[0].passages.map((p) => p.id)).toEqual(["pass-a", "pass-b"]);
      expect(await getPassageStart(db, student.id, "pass-draft", T0)).toBeNull();
      expect(await getPassageStart(db, student.id, "pass-partial", T0)).toBeNull();
      expect(await getPassageStart(db, student.id, "pass-empty", T0)).toBeNull();
      expect(await getPassageStart(db, student.id, "pass-hidden", T0)).toBeNull();
      expect(await getSectionView(db, student.id, "sec-draft", T0)).toBeNull();
      expect(await getPassageUnits(db, "pass-draft")).toBeNull();
      expect(await getPassageUnits(db, "pass-partial")).toBeNull();
      expect((await listMemorizationBooks(db)).map((b) => b.id)).toEqual([MATN_COURSE]);
    });

    it("a freshly imported DRAFT book is invisible to learners", async () => {
      const { student } = await setup(db);
      await db.matnUnit.updateMany({ data: { status: "DRAFT" } });
      await db.matnPassage.updateMany({ data: { status: "DRAFT" } });
      await db.matnSection.updateMany({ data: { status: "DRAFT" } });
      expect(await listMemorizationBooks(db)).toEqual([]);
      expect(await getBookHome(db, student.id, MATN_COURSE, T0)).toBeNull();
      expect(await getMemorizationContinue(db, student.id)).toBeNull();
      expect(await getMemorizationSummaries(db, student.id, T0)).toEqual([]);
    });

    it("preserves section, passage and unit order and never mutates canonical text in the learner flow", async () => {
      const { student } = await setup(db);
      const before = await db.matnUnit.findMany({ orderBy: { id: "asc" } });
      const units = await getPassageUnits(db, "pass-a");
      expect(units?.map((u) => u.order)).toEqual([1, 2, 3, 4]);
      expect(units?.map((u) => u.id)).toEqual(PASS_A_UNITS);
      await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "INCORRECT"]), { now: T0, ...noAI });
      const after = await db.matnUnit.findMany({ orderBy: { id: "asc" } });
      expect(after.map((u) => [u.id, u.canonicalText, u.status, u.order])).toEqual(before.map((u) => [u.id, u.canonicalText, u.status, u.order]));
    });

    it("the start screen carries no canonical text", async () => {
      const { student } = await setup(db);
      const start = await getPassageStart(db, student.id, "pass-a", T0);
      expect(start).toMatchObject({ unitCount: 4, attempts: 0, state: null });
      expect(JSON.stringify(start)).not.toContain("وحدة اختبار");
    });

    it("preserves both word-level self-assessment states for the next re-recitation without changing canonical Matn", async () => {
      const { student } = await setup(db);
      const canonicalBefore = await db.matnUnit.findMany({ where: { passageId: "pass-a" }, orderBy: { order: "asc" }, select: { id: true, canonicalText: true } });
      await submitRecitation(db, student.id, {
        passageId: "pass-a",
        clientAttemptId: "mixed-prior-assessment",
        results: [
          { unitId: "u-a1", status: "FORGOTTEN", scope: "WORDS", wordIndexes: [0], forgottenWordIndexes: [1] },
          { unitId: "u-a2", status: "INCORRECT", scope: "WORDS", wordIndexes: [2], forgottenWordIndexes: [] },
          { unitId: "u-a3", status: "FORGOTTEN", scope: "FULL_UNIT", wordIndexes: [], forgottenWordIndexes: [] },
          { unitId: "u-a4", status: "CORRECT", scope: null, wordIndexes: [], forgottenWordIndexes: [] },
        ],
      }, { now: T0, ...noAI });
      const start = await getPassageStart(db, student.id, "pass-a", T0);
      expect(start?.previousDetails).toEqual(expect.arrayContaining([
        { unitId: "u-a1", status: "FORGOTTEN", scope: "WORDS", wordIndexes: [0], forgottenWordIndexes: [1] },
        { unitId: "u-a2", status: "INCORRECT", scope: "WORDS", wordIndexes: [2], forgottenWordIndexes: [] },
        { unitId: "u-a3", status: "FORGOTTEN", scope: "FULL_UNIT", wordIndexes: [], forgottenWordIndexes: [] },
      ]));
      expect(await db.matnUnit.findMany({ where: { passageId: "pass-a" }, orderBy: { order: "asc" }, select: { id: true, canonicalText: true } })).toEqual(canonicalBefore);
    });

    it("the database rejects duplicate section / passage / unit order and an orphan passage is just hidden", async () => {
      await setup(db);
      await expect(db.matnSection.create({ data: { courseId: MATN_COURSE, order: 1, title: "مكرر" } })).rejects.toThrow();
      await expect(db.matnPassage.create({ data: { sectionId: "sec-a", order: 1, title: "مكرر" } })).rejects.toThrow();
      await expect(db.matnUnit.create({ data: { passageId: "pass-a", order: 1, canonicalText: "مكرر" } })).rejects.toThrow();
    });

    it("is independent of explanation lessons: no lesson relation is needed or consulted", async () => {
      const { student } = await setup(db);
      await db.lesson.deleteMany();
      expect(await getPassageStart(db, student.id, "pass-a", T0)).not.toBeNull();
      const r = await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT"]), { now: T0, ...noAI });
      expect(r.created).toBe(true);
    });
  });

  // ───────────────────────── self-assessment submission ─────────────────────────

  describe("self-assessment submission", () => {
    it("persists CORRECT, INCORRECT and FORGOTTEN per unit and computes the counts and score on the server", async () => {
      const { student } = await setup(db);
      const { attemptId } = await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "INCORRECT", "FORGOTTEN", "CORRECT"]), { now: T0, ...noAI });
      const attempt = await db.recitationAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { results: true } });
      expect(attempt).toMatchObject({ userId: student.id, passageId: "pass-a", totalUnits: 4, correctUnits: 2, incorrectUnits: 1, forgottenUnits: 1, scorePercentage: 50 });
      expect(Object.fromEntries(attempt.results.map((r) => [r.unitId, r.selfAssessmentStatus]))).toEqual({
        "u-a1": "CORRECT",
        "u-a2": "INCORRECT",
        "u-a3": "FORGOTTEN",
        "u-a4": "CORRECT",
      });
    });

    it("allows a contiguous selected range and persists exactly its unit IDs", async () => {
      const { student } = await setup(db);
      const partial = { passageId: "pass-a", clientAttemptId: "client-incomplete-1", results: results(["CORRECT"]).slice(0, 3) };
      const saved = await submitRecitation(db, student.id, partial, { now: T0, ...noAI });
      const attempt = await db.recitationAttempt.findUniqueOrThrow({ where: { id: saved.attemptId }, include: { results: true } });
      expect(attempt.totalUnits).toBe(3);
      expect(attempt.results.map((result) => result.unitId).sort()).toEqual(PASS_A_UNITS.slice(0, 3));
    });

    it("rejects a disconnected selected range", async () => {
      const { student } = await setup(db);
      const input = { passageId: "pass-a", clientAttemptId: "client-disconnected-1", results: results(["CORRECT"], ["u-a1", "u-a3"]) };
      await expect(submitRecitation(db, student.id, input, { now: T0, ...noAI })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects a duplicate unit result, a unit of another passage and an unknown unit", async () => {
      const { student } = await setup(db);
      const dup = { passageId: "pass-a", clientAttemptId: "client-dup-0001", results: [...results([]).slice(0, 3), { unitId: "u-a1", status: "CORRECT" as const }] };
      await expect(submitRecitation(db, student.id, dup, { now: T0, ...noAI })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const foreign = { passageId: "pass-a", clientAttemptId: "client-foreign-1", results: [...results([]).slice(0, 3), { unitId: "u-b1", status: "CORRECT" as const }] };
      await expect(submitRecitation(db, student.id, foreign, { now: T0, ...noAI })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const unknown = { passageId: "pass-a", clientAttemptId: "client-unknown-1", results: [...results([]).slice(0, 3), { unitId: "nope", status: "CORRECT" as const }] };
      await expect(submitRecitation(db, student.id, unknown, { now: T0, ...noAI })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await db.recitationAttempt.count()).toBe(0);
    });

    it("rejects an invalid status", async () => {
      const { student } = await setup(db);
      const input = { passageId: "pass-a", clientAttemptId: "client-status-01", results: results([]).map((r, i) => (i === 0 ? { ...r, status: "PERFECT" } : r)) };
      await expect(submitRecitation(db, student.id, input, { now: T0, ...noAI })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("cannot fake the score, counts, mastery, review date or analysis: the schema is strict", async () => {
      const { student } = await setup(db);
      const base = attemptInput("pass-a", ["INCORRECT", "INCORRECT", "INCORRECT", "INCORRECT"]);
      for (const extra of [{ scorePercentage: 100 }, { correctUnits: 4 }, { masteryScore: 100 }, { nextReviewAt: "2030-01-01" }, { analysis: { summary: "x" } }, { userId: "someone-else" }, { audio: "data:audio/webm;base64,AAAA" }]) {
        await expect(submitRecitation(db, student.id, { ...base, clientAttemptId: `client-${Object.keys(extra)[0]}-1`, ...extra }, { now: T0, ...noAI })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      }
      expect(await db.recitationAttempt.count()).toBe(0);
      const ok = await submitRecitation(db, student.id, base, { now: T0, ...noAI });
      expect((await db.recitationAttempt.findUniqueOrThrow({ where: { id: ok.attemptId } })).scorePercentage).toBe(0);
    });

    it("rejects an unapproved, partly approved, empty or draft-section passage", async () => {
      const { student } = await setup(db);
      for (const [passageId, units] of [["pass-draft", ["u-d1", "u-d2", "u-d3"]], ["pass-partial", ["u-p1", "u-p2", "u-p3"]], ["pass-hidden", ["u-h1", "u-h2", "u-h3"]], ["pass-empty", ["x"]]] as const) {
        await expect(submitRecitation(db, student.id, attemptInput(passageId, [], [...units]), { now: T0, ...noAI }), passageId).rejects.toMatchObject({ code: "NOT_FOUND" });
      }
      expect(await db.recitationAttempt.count()).toBe(0);
    });

    it("rejects a submission when the passage was un-approved during the session", async () => {
      const { student, admin } = await setup(db);
      await setMatnPassageApproval(db, admin, { id: "pass-a", approved: "false" });
      await expect(submitRecitation(db, student.id, attemptInput("pass-a", []), { now: T0, ...noAI })).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await db.recitationAttempt.count()).toBe(0);
      expect(await db.memorizationMastery.count()).toBe(0);
    });

    it("a double submit (same client attempt id) is idempotent, even when fired concurrently", async () => {
      const { student } = await setup(db);
      const input = attemptInput("pass-a", ["CORRECT", "INCORRECT"], PASS_A_UNITS, "client-double-click-1");
      const [a, b] = await Promise.all([submitRecitation(db, student.id, input, { now: T0, ...noAI }), submitRecitation(db, student.id, input, { now: T0, ...noAI })]);
      expect(a.attemptId).toBe(b.attemptId);
      expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
      expect(await db.recitationAttempt.count()).toBe(1);
      expect(await db.recitationUnitResult.count()).toBe(4);
      expect((await db.memorizationMastery.findFirstOrThrow()).attempts).toBe(1);
      const again = await submitRecitation(db, student.id, input, { now: T0, ...noAI });
      expect(again).toMatchObject({ attemptId: a.attemptId, created: false });
    });

    it("an attempt id used by another learner does not collide or leak", async () => {
      const { student, other } = await setup(db);
      const input = attemptInput("pass-a", [], PASS_A_UNITS, "client-shared-id-1");
      const mine = await submitRecitation(db, student.id, input, { now: T0, ...noAI });
      const theirs = await submitRecitation(db, other.id, input, { now: T0, ...noAI });
      expect(theirs.attemptId).not.toBe(mine.attemptId);
      expect(theirs.created).toBe(true);
    });
  });

  // ───────────────────────── mastery + schedule ─────────────────────────

  describe("mastery and scheduling (persisted)", () => {
    it("first attempt creates a separate memorization mastery and a deterministic next review", async () => {
      const { student } = await setup(db);
      const { attemptId } = await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "CORRECT", "CORRECT", "CORRECT"]), { now: T0, ...noAI });
      const m = await db.memorizationMastery.findUniqueOrThrow({ where: { userId_passageId: { userId: student.id, passageId: "pass-a" } } });
      expect(m).toMatchObject({ masteryScore: 90, state: "GOOD", attempts: 1, consecutiveCorrect: 1, consecutiveWeak: 0, reviewCount: 0, errorCount: 0 });
      expect(m.nextReviewAt.toISOString()).toBe("2026-10-08T21:00:00.000Z"); // +3 local days from 06 Oct (Riyadh)
      const attempt = await db.recitationAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      expect(attempt).toMatchObject({ masteryBefore: null, masteryAfter: 90, stateAfter: "GOOD", kind: "PRACTICE" });
      expect(attempt.nextReviewAt).toEqual(m.nextReviewAt);
    });

    it("forgotten units schedule a same-day review; incorrect ones the next local day", async () => {
      const { student } = await setup(db);
      await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "FORGOTTEN", "CORRECT", "CORRECT"]), { now: T0, ...noAI });
      await submitRecitation(db, student.id, attemptInput("pass-b", ["CORRECT", "INCORRECT", "CORRECT"], ["u-b1", "u-b2", "u-b3"]), { now: T0, ...noAI });
      const rows = await db.memorizationMastery.findMany({ orderBy: { passageId: "asc" } });
      expect(rows[0].nextReviewAt.toISOString()).toBe("2026-10-06T14:00:00.000Z");
      expect(rows[1].nextReviewAt.toISOString()).toBe("2026-10-06T21:00:00.000Z");
    });

    it("the due-review query: nothing due at first, due once nextReviewAt arrives, hidden if the passage is un-approved", async () => {
      const { student, admin } = await setup(db);
      expect(await getDueReviews(db, student.id, T0)).toEqual([]);
      await submitRecitation(db, student.id, attemptInput("pass-a", ["FORGOTTEN"]), { now: T0, ...noAI });
      expect(await getDueReviews(db, student.id, new Date(T0.getTime() + 3 * HOUR))).toEqual([]);
      const due = await getDueReviews(db, student.id, new Date(T0.getTime() + 4 * HOUR));
      expect(due.map((d) => d.passageId)).toEqual(["pass-a"]);
      await setMatnPassageApproval(db, admin, { id: "pass-a", approved: "false" });
      expect(await getDueReviews(db, student.id, new Date(T0.getTime() + 4 * HOUR))).toEqual([]);
    });

    it("orders due reviews: repeated weakness first, then the weakest state", async () => {
      const { student } = await setup(db);
      await submitRecitation(db, student.id, attemptInput("pass-b", ["FORGOTTEN", "FORGOTTEN", "FORGOTTEN"], ["u-b1", "u-b2", "u-b3"]), { now: T0, ...noAI });
      await submitRecitation(db, student.id, attemptInput("pass-a", ["INCORRECT", "CORRECT", "CORRECT", "CORRECT"]), { now: T0, ...noAI });
      await submitRecitation(db, student.id, attemptInput("pass-a", ["INCORRECT", "CORRECT", "CORRECT", "CORRECT"]), { now: new Date(T0.getTime() + 13 * HOUR), ...noAI });
      const due = await getDueReviews(db, student.id, new Date(T0.getTime() + 2 * DAY));
      expect(due.map((d) => d.passageId)).toEqual(["pass-a", "pass-b"]);
      expect(due[0].repeatedWeakness).toBe(true);
    });

    it("a review made when due is a REVIEW and counts; an early repeat is a PRACTICE", async () => {
      const { student } = await setup(db);
      await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "CORRECT", "CORRECT", "CORRECT"]), { now: T0, ...noAI });
      const early = await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "CORRECT", "CORRECT", "CORRECT"]), { now: new Date(T0.getTime() + HOUR), ...noAI });
      expect((await db.recitationAttempt.findUniqueOrThrow({ where: { id: early.attemptId } })).kind).toBe("PRACTICE");
      const dueAt = (await db.memorizationMastery.findFirstOrThrow()).nextReviewAt;
      const review = await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "CORRECT", "CORRECT", "CORRECT"]), { now: dueAt, ...noAI });
      expect((await db.recitationAttempt.findUniqueOrThrow({ where: { id: review.attemptId } })).kind).toBe("REVIEW");
      expect(await db.memorizationMastery.findFirstOrThrow()).toMatchObject({ attempts: 3, reviewCount: 1, state: "MASTERED", consecutiveCorrect: 3 });
    });

    it("improvement after weakness raises mastery and lengthens the next interval", async () => {
      const { student } = await setup(db);
      const first = await submitRecitation(db, student.id, attemptInput("pass-a", ["INCORRECT", "FORGOTTEN", "CORRECT", "CORRECT"]), { now: T0, ...noAI });
      const t1 = new Date(T0.getTime() + 5 * HOUR);
      const second = await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "CORRECT", "CORRECT", "CORRECT"]), { now: t1, ...noAI });
      const a = await db.recitationAttempt.findUniqueOrThrow({ where: { id: first.attemptId } });
      const b = await db.recitationAttempt.findUniqueOrThrow({ where: { id: second.attemptId } });
      expect(b.masteryBefore).toBe(a.masteryAfter);
      expect(b.masteryAfter).toBeGreaterThan(a.masteryAfter);
      expect(b.nextReviewAt.getTime() - t1.getTime()).toBeGreaterThan(a.nextReviewAt.getTime() - T0.getTime());
    });

    it("does not touch concept (understanding) mastery or the understanding journey", async () => {
      const { student } = await setup(db);
      const before = await Promise.all([db.conceptMastery.count(), db.lessonProgress.count(), db.assessmentSession.count(), db.studentAnswer.count()]);
      await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "INCORRECT", "FORGOTTEN", "CORRECT"]), { now: T0, ...noAI });
      const after = await Promise.all([db.conceptMastery.count(), db.lessonProgress.count(), db.assessmentSession.count(), db.studentAnswer.count()]);
      expect(after).toEqual(before);
    });

    it("summaries report real progress only", async () => {
      const { student } = await setup(db);
      expect((await getMemorizationSummaries(db, student.id, T0))[0]).toMatchObject({ totalPassages: 2, attemptedPassages: 0, masteredPassages: 0, dueCount: 0, progressPct: 0 });
      await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "CORRECT", "CORRECT", "CORRECT"]), { now: T0, ...noAI });
      const summary = (await getMemorizationSummaries(db, student.id, T0))[0];
      expect(summary).toMatchObject({ attemptedPassages: 1, goodPassages: 1, progressPct: 45 }); // (90 + 0) / 2
      expect(await getMemorizationContinue(db, student.id)).toMatchObject({ passageId: "pass-b", kind: "FIRST" });
    });
  });

  // ───────────────────────── streak / goals ─────────────────────────

  describe("streak and goals", () => {
    it("only a COMPLETED recitation counts as a learning day; browsing never does; the same day is never duplicated", async () => {
      const { student } = await setup(db);
      await getBookHome(db, student.id, MATN_COURSE, T0);
      await getPassageStart(db, student.id, "pass-a", T0);
      await getPassageUnits(db, "pass-a");
      await getDueReviews(db, student.id, T0);
      expect(await db.learningDay.count()).toBe(0);

      await submitRecitation(db, student.id, attemptInput("pass-a", []), { now: T0, ...noAI });
      expect(await db.learningDay.count({ where: { userId: student.id } })).toBe(1);
      await submitRecitation(db, student.id, attemptInput("pass-b", [], ["u-b1", "u-b2", "u-b3"]), { now: new Date(T0.getTime() + HOUR), ...noAI });
      expect(await db.learningDay.count({ where: { userId: student.id } })).toBe(1);
      const motivation = await getMotivation(db, student.id, new Date(T0.getTime() + 2 * HOUR));
      expect(motivation.streak).toMatchObject({ count: 1, activeToday: true });
    });

    it("does not change the lesson goals (they count lessons/concepts only)", async () => {
      const { student } = await setup(db);
      await db.learnerSettings.create({ data: { userId: student.id, weeklyLessonGoal: 2 } });
      await submitRecitation(db, student.id, attemptInput("pass-a", []), { now: T0, ...noAI });
      const m = await getMotivation(db, student.id, T0);
      expect(m.weeklyLessons).toBe(0);
      expect(m.weekly).toMatchObject({ current: 0, target: 2 });
    });

    it("a failed attempt (validation error) records no learning day", async () => {
      const { student } = await setup(db);
      await expect(submitRecitation(db, student.id, { ...attemptInput("pass-a", []), results: [] }, { now: T0, ...noAI })).rejects.toBeTruthy();
      expect(await db.learningDay.count()).toBe(0);
    });

    it("tracks the latest journey activity for the home continue rule", async () => {
      const { student } = await setup(db);
      expect(await getLatestJourneyActivity(db, student.id)).toEqual({ memorizationAt: null, understandingAt: null });
      await submitRecitation(db, student.id, attemptInput("pass-a", []), { now: T0, ...noAI });
      const a = await getLatestJourneyActivity(db, student.id);
      expect(a.memorizationAt?.toISOString()).toBe(T0.toISOString());
      expect(a.understandingAt).toBeNull();
    });
  });

  // ───────────────────────── authorization ─────────────────────────

  describe("authorization", () => {
    it("a learner reads only their own attempt", async () => {
      const { student, other } = await setup(db);
      const { attemptId } = await submitRecitation(db, student.id, attemptInput("pass-a", []), { now: T0, ...noAI });
      expect(await getAttemptResult(db, student.id, attemptId)).not.toBeNull();
      expect(await getAttemptResult(db, other.id, attemptId)).toBeNull();
    });

    it("a submission always belongs to the authenticated learner, never to a browser-supplied user", async () => {
      const { student, other } = await setup(db);
      await expect(submitRecitation(db, student.id, { ...attemptInput("pass-a", []), userId: other.id }, { now: T0, ...noAI })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await submitRecitation(db, student.id, attemptInput("pass-a", []), { now: T0, ...noAI });
      expect(await db.recitationAttempt.count({ where: { userId: other.id } })).toBe(0);
      expect(await db.memorizationMastery.count({ where: { userId: other.id } })).toBe(0);
    });

    it("learners cannot see another learner's mastery in progress, due reviews or summaries", async () => {
      const { student, other } = await setup(db);
      await submitRecitation(db, student.id, attemptInput("pass-a", ["FORGOTTEN"]), { now: T0, ...noAI });
      const later = new Date(T0.getTime() + DAY);
      expect(await getDueReviews(db, other.id, later)).toEqual([]);
      expect((await getMemorizationSummaries(db, other.id, later))[0]).toMatchObject({ attemptedPassages: 0, dueCount: 0 });
      expect((await getBookHome(db, other.id, MATN_COURSE, later))?.sections[0].passages[0]).toMatchObject({ state: null, attempts: 0 });
    });

    it("learners cannot use the admin content actions", async () => {
      const { student } = await setup(db);
      for (const run of [
        () => setMatnPassageApproval(db, student, { id: "pass-draft", approved: "true" }),
        () => setMatnSectionApproval(db, student, { id: "sec-draft", approved: "true" }),
        () => updateMatnUnitText(db, student, { unitId: "u-a1", text: "نص معدّل" }),
        () => setMatnPassageApproval(db, null, { id: "pass-draft", approved: "true" }),
      ]) {
        await expect(run()).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHENTICATED/) });
      }
      expect((await db.matnUnit.findUniqueOrThrow({ where: { id: "u-a1" } })).canonicalText).toBe("وحدة اختبار ألف الأولى");
      expect((await db.matnPassage.findUniqueOrThrow({ where: { id: "pass-draft" } })).status).toBe("DRAFT");
    });
  });

  // ───────────────────────── admin approval ─────────────────────────

  describe("human approval", () => {
    it("approving a passage approves its units and makes it visible; revoking hides it again; both are audited", async () => {
      const { student, admin } = await setup(db);
      expect(await getPassageStart(db, student.id, "pass-draft", T0)).toBeNull();
      await setMatnPassageApproval(db, admin, { id: "pass-draft", approved: "true" });
      expect(await getPassageStart(db, student.id, "pass-draft", T0)).not.toBeNull();
      const units = await db.matnUnit.findMany({ where: { passageId: "pass-draft" } });
      expect(units.every((u) => u.status === "APPROVED" && u.approvedTextHash && u.approvedById === admin.id)).toBe(true);
      await setMatnPassageApproval(db, admin, { id: "pass-draft", approved: "false" });
      expect(await getPassageStart(db, student.id, "pass-draft", T0)).toBeNull();
      expect((await db.auditEvent.findMany({ where: { entityType: "matn_passage" }, orderBy: { createdAt: "asc" } })).map((e) => e.action)).toEqual(["matn.passage_approved", "matn.passage_revoked"]);
    });

    it("approving a passage in a draft section also approves the section container", async () => {
      const { student, admin } = await setup(db);
      await db.matnPassage.update({ where: { id: "pass-hidden" }, data: { status: "DRAFT" } });
      await setMatnPassageApproval(db, admin, { id: "pass-hidden", approved: "true" });
      expect((await db.matnSection.findUniqueOrThrow({ where: { id: "sec-draft" } })).status).toBe("APPROVED");
      expect(await getPassageStart(db, student.id, "pass-hidden", T0)).not.toBeNull();
    });

    it("refuses to approve a passage that has a suspicious token or no units, until a human edits the text", async () => {
      const { student, admin } = await setup(db);
      await db.matnUnit.update({ where: { id: "u-d2" }, data: { canonicalText: "2 - وحدة فيها رمز" } });
      await expect(setMatnPassageApproval(db, admin, { id: "pass-draft", approved: "true" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect((await db.matnUnit.findUniqueOrThrow({ where: { id: "u-d1" } })).status).toBe("DRAFT");
      await updateMatnUnitText(db, admin, { unitId: "u-d2", text: "وحدة بعد التحرير" });
      await setMatnPassageApproval(db, admin, { id: "pass-draft", approved: "true" });
      expect(await getPassageStart(db, student.id, "pass-draft", T0)).not.toBeNull();
      await db.matnPassage.update({ where: { id: "pass-empty" }, data: { status: "DRAFT" } });
      await expect(setMatnPassageApproval(db, admin, { id: "pass-empty", approved: "true" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("editing an approved unit revokes it and hides its passage until re-approved", async () => {
      const { student, admin } = await setup(db);
      await updateMatnUnitText(db, admin, { unitId: "u-a1", text: "  نص   معدّل بعد المراجعة " });
      const unit = await db.matnUnit.findUniqueOrThrow({ where: { id: "u-a1" } });
      expect(unit).toMatchObject({ canonicalText: "نص معدّل بعد المراجعة", status: "DRAFT", approvedAt: null, approvedTextHash: null });
      expect(await getPassageStart(db, student.id, "pass-a", T0)).toBeNull();
      await setMatnPassageApproval(db, admin, { id: "pass-a", approved: "true" });
      expect(await getPassageStart(db, student.id, "pass-a", T0)).not.toBeNull();
      expect((await db.auditEvent.findFirstOrThrow({ where: { action: "matn.unit_edited" } })).metadata).toMatchObject({ after: "نص معدّل بعد المراجعة" });
    });

    it("section approval with cascade approves everything inside; without cascade only the container", async () => {
      const { student, admin } = await setup(db);
      await db.matnUnit.updateMany({ data: { status: "DRAFT" } });
      await db.matnPassage.updateMany({ data: { status: "DRAFT" } });
      await db.matnSection.updateMany({ data: { status: "DRAFT" } });
      await setMatnSectionApproval(db, admin, { id: "sec-a", approved: "true" });
      expect(await listMemorizationBooks(db)).toEqual([]);
      await db.matnPassage.update({ where: { id: "pass-empty" }, data: { status: "DRAFT" } });
      // pass-empty has no units → a cascade over sec-a is refused entirely.
      await expect(setMatnSectionApproval(db, admin, { id: "sec-a", approved: "true", cascade: "true" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await db.matnUnit.count({ where: { status: "APPROVED" } })).toBe(0);
      await db.matnPassage.delete({ where: { id: "pass-empty" } });
      await db.matnPassage.delete({ where: { id: "pass-partial" } });
      await setMatnSectionApproval(db, admin, { id: "sec-a", approved: "true", cascade: "true" });
      expect((await getBookHome(db, student.id, MATN_COURSE, T0))?.sections[0].passages.map((p) => p.id)).toEqual(["pass-a", "pass-b", "pass-draft"]);
    });

    it("the admin overview exposes section → passage → unit number → text and flags suspicious tokens", async () => {
      const { admin } = await setup(db);
      void admin;
      await db.matnUnit.update({ where: { id: "u-d1" }, data: { canonicalText: "2 - رمز" } });
      const [book] = await getMatnOverview(db);
      const draft = book.sections[0].passages.find((p) => p.id === "pass-draft")!;
      expect(draft.units.map((u) => u.order)).toEqual([1, 2, 3]);
      expect(draft.units[0].suspicious).toEqual(["2", "-"]);
    });
  });

  // ───────────────────────── AI performance analysis ─────────────────────────

  describe("AI performance analysis", () => {
    it("sends structured history only: no audio, no personal data, no real ids, no canonical text", async () => {
      const { student } = await setup(db);
      await db.user.update({ where: { id: student.id }, data: { name: "اسم سري جدا" } });
      const provider = new ScriptedProvider().scriptAnalysis(VALID_ANALYSIS);
      await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "INCORRECT", "FORGOTTEN", "CORRECT"]), { now: T0, provider });
      expect(provider.analysisRequests).toHaveLength(1);
      const sent = JSON.stringify(provider.analysisRequests[0]) + provider.analysisPrompts[0].system + provider.analysisPrompts[0].user;
      for (const secret of [student.id, "student@example.com", "اسم سري جدا", "pass-a", "u-a1", "وحدة اختبار", "audio/", "blob:", "base64"]) expect(sent, secret).not.toContain(secret);
      expect(provider.analysisRequests[0].payload).toMatchObject({
        historyAttempts: 0,
        currentAttempt: { kind: "PRACTICE", score: 50, correct: 2, incorrect: 1, forgotten: 1, total: 4 },
        weakUnits: [
          { unitId: "u2", currentStatus: "INCORRECT", previousOutcomes: [] },
          { unitId: "u3", currentStatus: "FORGOTTEN", previousOutcomes: [] },
        ],
        deterministicSchedule: { rule: "FORGOTTEN", repeatedWeakness: false },
      });
    });

    it("stores a validated analysis and shows it; the deterministic result is unchanged by it", async () => {
      const { student } = await setup(db);
      const provider = new ScriptedProvider().scriptAnalysis(VALID_ANALYSIS);
      const r = await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "INCORRECT", "CORRECT", "CORRECT"]), { now: T0, provider });
      expect(r.analysisStatus).toBe("ANALYZED");
      const result = await getAttemptResult(db, student.id, r.attemptId);
      expect(result).toMatchObject({ analysisStatus: "ANALYZED", scorePercentage: 75, masteryAfter: 68, analysis: { summary: VALID_ANALYSIS.summary, priorities: [{ unitNumber: 2 }], progressObservation: null } });
      const log = await db.aIInteractionLog.findFirstOrThrow({ where: { type: "ANALYZE_MEMORIZATION" } });
      expect(log).toMatchObject({ status: "SUCCESS", provider: "scripted", userId: student.id });
      expect(JSON.stringify(log.metadata)).not.toContain("student@example.com");
    });

    it("does not invent a trend on a first attempt", async () => {
      const { student } = await setup(db);
      const provider = new ScriptedProvider().scriptAnalysis({ ...VALID_ANALYSIS, progressObservation: "تحسن أداؤك مقارنة بمحاولاتك السابقة." });
      const r = await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "INCORRECT"]), { now: T0, provider });
      expect(r.analysisStatus).toBe("FALLBACK");
      expect((await db.recitationAttempt.findUniqueOrThrow({ where: { id: r.attemptId } })).analysis).toBeNull();
    });

    it("identifies repeated weakness and recovery from real history, and allows a trend only with history", async () => {
      const { student } = await setup(db);
      await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "INCORRECT", "CORRECT", "CORRECT"]), { now: T0, ...noAI });
      await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "INCORRECT", "FORGOTTEN", "CORRECT"]), { now: new Date(T0.getTime() + DAY), ...noAI });
      const provider = new ScriptedProvider().scriptAnalysis({
        summary: "معظم الأجزاء ثابتة لديك.",
        patterns: ["تكرر الخطأ في الجزء ٢ في أكثر من محاولة."],
        priorities: [{ unitId: "u2", reason: "تكرر فيه الخطأ." }],
        progressObservation: "ثبت الجزء ٣ بعد أن كان يحتاج إلى مراجعة.",
      });
      const r = await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "INCORRECT", "CORRECT", "CORRECT"]), { now: new Date(T0.getTime() + 2 * DAY), provider });
      expect(r.analysisStatus).toBe("ANALYZED");
      const payload = provider.analysisRequests[0].payload as { historyAttempts: number; weakUnits: { unitId: string; currentStatus: string; previousOutcomes: string[] }[]; recentAttempts: unknown[]; masteryTrajectory: unknown[] };
      expect(payload.historyAttempts).toBe(2);
      expect(payload.recentAttempts).toHaveLength(2);
      expect(payload.masteryTrajectory).toHaveLength(3);
      expect(payload.weakUnits.find((u) => u.unitId === "u2")).toMatchObject({ currentStatus: "INCORRECT", previousOutcomes: ["INCORRECT", "INCORRECT"] });
      expect(payload.weakUnits.find((u) => u.unitId === "u3")).toMatchObject({ currentStatus: "CORRECT", previousOutcomes: ["CORRECT", "FORGOTTEN"] });
    });

    for (const [name, step] of [
      ["malformed output", { nope: true }],
      ["a provider error", new AIProviderError("UNAVAILABLE", "down")],
      ["a provider rate limit", new AIProviderError("RATE_LIMITED", "429")],
      ["a refusal", new AIProviderError("REFUSAL", "no")],
    ] as const) {
      it(`falls back cleanly on ${name} and the attempt is still fully saved`, async () => {
        const { student } = await setup(db);
        const provider = new ScriptedProvider().scriptAnalysis(step);
        const r = await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "INCORRECT", "FORGOTTEN", "CORRECT"]), { now: T0, provider });
        expect(r).toMatchObject({ created: true, analysisStatus: "FALLBACK" });
        const result = await getAttemptResult(db, student.id, r.attemptId);
        expect(result).toMatchObject({ scorePercentage: 50, analysis: null, analysisStatus: "FALLBACK", stateAfter: expect.any(String) });
        expect(result!.nextReviewAt.toISOString()).toBe("2026-10-06T14:00:00.000Z");
        expect(await db.memorizationMastery.count()).toBe(1);
        expect(await db.learningDay.count()).toBe(1);
        expect((await db.aIInteractionLog.findFirstOrThrow({ where: { type: "ANALYZE_MEMORIZATION" } })).status).toMatch(/PROVIDER_ERROR|MALFORMED_OUTPUT/);
      });
    }

    it("falls back when the provider is too slow (timeout)", async () => {
      const { student } = await setup(db);
      const provider = new ScriptedProvider().scriptAnalysis(() => new Promise(() => undefined));
      const started = Date.now();
      const r = await submitRecitation(db, student.id, attemptInput("pass-a", []), { now: T0, provider, analysisTimeoutMs: 100 });
      expect(r.analysisStatus).toBe("FALLBACK");
      expect(Date.now() - started).toBeLessThan(5000);
      expect(await db.recitationAttempt.count()).toBe(1);
    });

    it("falls back when AI is not configured (the provider factory throws)", async () => {
      const { student } = await setup(db);
      const r = await submitRecitation(db, student.id, attemptInput("pass-a", []), {
        now: T0,
        provider: () => {
          throw new Error("AI_NOT_CONFIGURED");
        },
      });
      expect(r).toMatchObject({ created: true, analysisStatus: "FALLBACK" });
    });

    it("AI cannot override the score, the mastery or the review date — even if it tries", async () => {
      const { student } = await setup(db);
      const cheat = { ...VALID_ANALYSIS, score: 100, masteryScore: 100, nextReviewAt: "2099-01-01T00:00:00Z", state: "MASTERED" };
      const provider = new ScriptedProvider().scriptAnalysis(cheat);
      const r = await submitRecitation(db, student.id, attemptInput("pass-a", ["INCORRECT", "INCORRECT", "INCORRECT", "INCORRECT"]), { now: T0, provider });
      expect(r.analysisStatus).toBe("FALLBACK");
      const attempt = await db.recitationAttempt.findUniqueOrThrow({ where: { id: r.attemptId } });
      expect(attempt).toMatchObject({ scorePercentage: 0, masteryAfter: 0, stateAfter: "NEEDS_REVIEW", analysis: null });
      expect(attempt.nextReviewAt.toISOString()).toBe("2026-10-06T21:00:00.000Z");
      const mastery = await db.memorizationMastery.findFirstOrThrow();
      expect(mastery).toMatchObject({ masteryScore: 0, state: "NEEDS_REVIEW" });
    });

    it("never changes the learner's self-assessments", async () => {
      const { student } = await setup(db);
      const provider = new ScriptedProvider().scriptAnalysis(VALID_ANALYSIS);
      const r = await submitRecitation(db, student.id, attemptInput("pass-a", ["CORRECT", "INCORRECT", "FORGOTTEN", "CORRECT"]), { now: T0, provider });
      const stored = await db.recitationUnitResult.findMany({ where: { attemptId: r.attemptId }, orderBy: { unitId: "asc" } });
      expect(stored.map((s) => s.selfAssessmentStatus)).toEqual(["CORRECT", "INCORRECT", "FORGOTTEN", "CORRECT"]);
    });
  });
});
