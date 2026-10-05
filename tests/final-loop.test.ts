import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNextQuestion, startAssessment } from "@/server/assessment/engine";
import { readReport } from "@/server/assessment/report";
import { produceValidatedQuestion } from "@/server/ai/pipeline";
import { MockProvider } from "@/server/ai/mock-provider";
import { QuestionGenerator } from "@/server/ai/question-generator";
import { getReviewTarget } from "@/server/learner/review";
import { markLessonStudied } from "@/server/content/study";
import { getLatencySummary, getMeasurementRows } from "@/server/admin/evaluation";
import { questionVerdict } from "@/server/admin/trace";
import { playerSrc } from "@/lib/video";
import { reviewHref } from "@/lib/routes";
import type { PrismaClient } from "@/generated/prisma/client";
import { hasTestDb, testDb, truncateAll } from "./helpers/db";
import { createUser, markStudied, seedFixtureCurriculum } from "./helpers/fixtures";
import { A, answerNext, asQuestion, B, C, CONCEPT_C_QUESTIONS, expectAppError, LESSON, mockBacked, PASS } from "./helpers/flow";
import { INSUFFICIENT, okQuestion, ScriptedProvider, verdict } from "./helpers/scripted-provider";
import { request } from "./helpers/ai-fixtures";

describe.skipIf(!hasTestDb)("final learning loop (database)", () => {
  let db: PrismaClient;
  beforeEach(async () => {
    db = testDb();
    await truncateAll();
    await seedFixtureCurriculum(db);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A lesson assessment where concept C is missed three times in a row (baseline + two verifications). */
  async function runWeakSession() {
    const student = await createUser(db, "learner@example.com");
    await markStudied(db, student.id, LESSON);
    const provider = new ScriptedProvider([CONCEPT_C_QUESTIONS.inspector, CONCEPT_C_QUESTIONS.three, CONCEPT_C_QUESTIONS.insufficient], [PASS(), PASS(), PASS()]);
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    for (let i = 0; i < 4; i++) await answerNext(db, deps, student.id, sessionId, "correct");
    for (let i = 0; i < 3; i++) await answerNext(db, deps, student.id, sessionId, "wrong");
    return { student, provider, deps, sessionId };
  }

  it("A + B. three misses in a row make a concept weak («يحتاج إلى تثبيت»); a single miss never does", async () => {
    const { student, deps, sessionId } = await runWeakSession();
    const weak = await db.conceptMastery.findUniqueOrThrow({ where: { userId_conceptId: { userId: student.id, conceptId: C } } });
    expect(weak.state).toBe("NEEDS_REINFORCEMENT");

    // Finish the lesson: review → reassessment (correct) → last baseline question.
    for (let i = 0; i < 3; i++) {
      const step = await answerNext(db, deps, student.id, sessionId, "correct");
      if (!step || step.result.sessionComplete) break;
    }
    const session = await db.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe("COMPLETED");
    const report = readReport(session.report)!;
    expect(report.concepts.find((c) => c.conceptId === C)?.attempts).toBe(5);
    // Concepts answered correctly were never flagged.
    expect(report.reinforceConceptIds).not.toContain(A);
    expect(report.reinforceConceptIds).not.toContain(B);

    // Contrast: one miss followed by a correct verification leaves the concept un-flagged.
    const other = await createUser(db, "other@example.com");
    await markStudied(db, other.id, LESSON);
    const otherProvider = new ScriptedProvider([CONCEPT_C_QUESTIONS.inspector], [PASS()]);
    const otherDeps = { db, getProvider: () => otherProvider };
    const { sessionId: otherSession } = await startAssessment(otherDeps, other.id, LESSON);
    for (let i = 0; i < 4; i++) await answerNext(db, otherDeps, other.id, otherSession, "correct");
    await answerNext(db, otherDeps, other.id, otherSession, "wrong");
    await answerNext(db, otherDeps, other.id, otherSession, "correct");
    const single = await db.conceptMastery.findUniqueOrThrow({ where: { userId_conceptId: { userId: other.id, conceptId: C } } });
    expect(single.state).not.toBe("NEEDS_REINFORCEMENT");
  });

  it("D + E + G. targeted review exposes only the approved timestamp, never the source passages", async () => {
    const student = await createUser(db, "learner@example.com");
    // No video yet → text-only fallback.
    const textOnly = await getReviewTarget(db, student.id, LESSON, A);
    expect(textOnly?.video).toBeNull();
    expect(textOnly).not.toHaveProperty("passages");
    expect(textOnly).not.toHaveProperty("textAnchor");
    expect(reviewHref(LESSON, A)).toBe(`/lessons/${LESSON}/review/${A}`);

    // Entered but NOT approved → still text only.
    await db.concept.update({ where: { id: A }, data: { videoUrl: "https://www.youtube.com/watch?v=AbCdEf12345", videoStartSecond: 755, videoEndSecond: 980 } });
    expect((await getReviewTarget(db, student.id, LESSON, A))?.video).toBeNull();

    // Approved → exact stored timestamps.
    await db.concept.update({ where: { id: A }, data: { videoApproved: true, videoApprovedAt: new Date() } });
    const withVideo = await getReviewTarget(db, student.id, LESSON, A);
    expect(withVideo?.video).toEqual({ url: "https://www.youtube.com/watch?v=AbCdEf12345", startSecond: 755, endSecond: 980 });
    const src = playerSrc(withVideo!.video!)!;
    expect(src).toContain("youtube-nocookie.com/embed/AbCdEf12345");
    expect(src).toContain("start=755");
    expect(src).toContain("end=980");

    // Incoherent approved timestamps are never shown.
    await db.concept.update({ where: { id: A }, data: { videoEndSecond: 700 } });
    expect((await getReviewTarget(db, student.id, LESSON, A))?.video).toBeNull();
  });

  it("F. the AI cannot invent or change timestamps", async () => {
    // The generator contract has no timestamp field: extra keys make the output malformed.
    const provider = new ScriptedProvider([{ ...CONCEPT_C_QUESTIONS.inspector, videoStartSecond: 12 }]);
    const outcome = await new QuestionGenerator(provider).generate(request());
    expect(outcome.kind).toBe("MALFORMED");

    // A whole weak-concept flow leaves human-approved video metadata untouched.
    const video = { videoUrl: "https://www.youtube.com/watch?v=AbCdEf12345", videoStartSecond: 755, videoEndSecond: 980, videoApproved: true };
    await db.concept.update({ where: { id: C }, data: video });
    await runWeakSession();
    const after = await db.concept.findUniqueOrThrow({ where: { id: C } });
    expect({ videoUrl: after.videoUrl, videoStartSecond: after.videoStartSecond, videoEndSecond: after.videoEndSecond, videoApproved: after.videoApproved }).toEqual(video);
  });

  it("H + I. a standalone «اختبر فهمي مرة أخرى» generates NEW questions from the same source and updates mastery", async () => {
    const student = await createUser(db, "learner@example.com");
    await markStudied(db, student.id, LESSON);
    await db.conceptMastery.create({
      data: { userId: student.id, conceptId: C, masteryScore: 20, attempts: 3, incorrectCount: 3, consecutiveIncorrect: 3, recentOutcomes: [false, false, false], state: "NEEDS_REINFORCEMENT" },
    });
    const bank = (await db.fixedQuestion.findMany({ where: { conceptId: C } })).map((f) => f.question);
    const provider = mockBacked();
    const deps = { db, getProvider: () => provider };

    const { sessionId, mode } = await startAssessment(deps, student.id, LESSON, { purpose: "REASSESSMENT", focusConceptIds: [C] });
    expect(mode).toBe("ADAPTIVE");
    const asked: string[] = [];
    for (let i = 0; i < 5; i++) {
      const step = await answerNext(db, deps, student.id, sessionId, "correct");
      if (!step) break;
      asked.push(step.stored.question);
      expect(step.stored).toMatchObject({ conceptId: C, stage: "REASSESSMENT", origin: "AI_GENERATED", questionType: "MCQ" });
      expect(step.stored.options).toHaveLength(4);
      if (step.result.sessionComplete) break;
    }
    expect(asked.length).toBeGreaterThanOrEqual(2);
    expect(new Set(asked).size).toBe(asked.length);
    for (const q of asked) expect(bank).not.toContain(q); // never a baseline question
    expect(provider.generateRequests[0].previousQuestions).toEqual(expect.arrayContaining(bank));
    expect(provider.generateRequests.every((r) => r.conceptId === C && r.stage === "REASSESSMENT")).toBe(true);

    const mastery = await db.conceptMastery.findUniqueOrThrow({ where: { userId_conceptId: { userId: student.id, conceptId: C } } });
    expect(mastery.state).not.toBe("NEEDS_REINFORCEMENT");
    expect(mastery.consecutiveCorrect).toBeGreaterThanOrEqual(2);
    const report = readReport((await db.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } })).report)!;
    expect(report.purpose).toBe("REASSESSMENT");
    expect(report.concepts[0].levelStart).toBe("NEEDS_REINFORCEMENT");
  });

  it("I. weakness that remains keeps the concept in targeted review", async () => {
    const student = await createUser(db, "learner@example.com");
    await markStudied(db, student.id, LESSON);
    await db.conceptMastery.create({
      data: { userId: student.id, conceptId: C, masteryScore: 20, attempts: 3, incorrectCount: 3, consecutiveIncorrect: 3, recentOutcomes: [false, false, false], state: "NEEDS_REINFORCEMENT" },
    });
    const deps = { db, getProvider: () => mockBacked() };
    const { sessionId } = await startAssessment(deps, student.id, LESSON, { purpose: "REASSESSMENT", focusConceptIds: [C] });
    for (let i = 0; i < 2; i++) await answerNext(db, deps, student.id, sessionId, "wrong");
    expect((await db.conceptMastery.findUniqueOrThrow({ where: { userId_conceptId: { userId: student.id, conceptId: C } } })).state).toBe("NEEDS_REINFORCEMENT");
  });

  it("a standalone reassessment never silently falls back to the fixed bank when the model fails", async () => {
    const student = await createUser(db, "learner@example.com");
    await markStudied(db, student.id, LESSON);
    const deps = { db, getProvider: () => new ScriptedProvider([], [], { gen: INSUFFICIENT }) };
    const { sessionId } = await startAssessment(deps, student.id, LESSON, { purpose: "REASSESSMENT", focusConceptIds: [C] });
    await expectAppError(getNextQuestion(deps, student.id, sessionId), "INSUFFICIENT_SOURCE");
    expect(await db.generatedQuestion.count({ where: { sessionId } })).toBe(0);
  });

  it("J + K. unapproved-only concepts never reach the generator; insufficient source fails closed", async () => {
    await db.concept.create({ data: { id: "concept-draft", lessonId: LESSON, title: "مسودة", description: "—", order: 9 } });
    await db.sourcePassage.create({
      data: { id: "p-draft", lessonId: LESSON, conceptId: "concept-draft", text: "نص لم يُعتمد بعد ولا يجوز أن يصل إلى المولّد بأي حال.", sourceTitle: "x", sourceAuthor: "x", sourceReference: "x", approved: false },
    });

    const student = await createUser(db, "learner@example.com");
    await markStudied(db, student.id, LESSON);
    const session = await db.assessmentSession.create({ data: { userId: student.id, lessonId: LESSON } });
    const provider = new ScriptedProvider([], [], { gen: INSUFFICIENT });
    const base = { db, provider, userId: student.id, sessionId: session.id, lessonId: LESSON, stage: "VERIFICATION" as const, previous: null, previousQuestions: [] };
    const draft = await produceValidatedQuestion({ ...base, concept: { id: "concept-draft", title: "مسودة" } });
    expect(draft.kind).toBe("SOURCE_NOT_APPROVED");
    expect(provider.generateRequests).toHaveLength(0);

    const insufficient = await produceValidatedQuestion({ ...base, concept: { id: A, title: "x" } });
    expect(insufficient.kind).toBe("INSUFFICIENT_SOURCE");
    expect(await db.generatedQuestion.count({ where: { sessionId: session.id } })).toBe(0);
  });

  it("L. a validator rejection prevents display and is fully recorded for the admin", async () => {
    const student = await createUser(db, "learner@example.com");
    await markStudied(db, student.id, LESSON);
    const provider = new ScriptedProvider([], [], { gen: CONCEPT_C_QUESTIONS.inspector, val: verdict(false, [0], ["UNSUPPORTED_CLAIM"], ["correctAnswer"]) });
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    for (let i = 0; i < 4; i++) await answerNext(db, deps, student.id, sessionId, "correct");
    await answerNext(db, deps, student.id, sessionId, "wrong");
    await expectAppError(getNextQuestion(deps, student.id, sessionId), "GENERATION_FAILED");
    const rows = await db.generatedQuestion.findMany({ where: { sessionId, origin: "AI_GENERATED" } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.validationStatus === "REJECTED" && r.sequence === null)).toBe(true);
    expect(rows.every((r) => questionVerdict(r).validator === "REJECTED" && !questionVerdict(r).displayed)).toBe(true);
    expect(rows[0].validationIssues).toEqual(expect.arrayContaining(["UNSUPPORTED_CLAIM", "ANSWER_NOT_SUPPORTED"]));
    expect((rows[0].validatorResult as { modelChecks: Record<string, boolean> }).modelChecks.correctAnswer).toBe(false);
  });

  it("stops generating once the per-question time budget is spent (fail closed, no long waits)", async () => {
    const student = await createUser(db, "learner@example.com");
    await markStudied(db, student.id, LESSON);
    const bad = { ...CONCEPT_C_QUESTIONS.inspector, explanation: "وعند الشافعية يفحص مدقق مستقل السؤال قبل عرضه." };
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const provider = new ScriptedProvider([], [], {
      gen: () => {
        clock += 85_000; // a slow model call
        return bad;
      },
    });
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    for (let i = 0; i < 4; i++) await answerNext(db, deps, student.id, sessionId, "correct");
    await answerNext(db, deps, student.id, sessionId, "wrong");
    await expectAppError(getNextQuestion(deps, student.id, sessionId), "AI_TIMEOUT");
    expect(provider.generateRequests).toHaveLength(1);
  });

  it("pre/post measurement records real results without changing mastery", async () => {
    const student = await createUser(db, "learner@example.com");
    await markStudied(db, student.id, LESSON); // unlocks lesson-mastery
    const lesson2 = "lesson-mastery";
    const deps = { db, getProvider: () => mockBacked() };

    await expectAppError(markLessonStudied(db, student.id, lesson2), "BAD_REQUEST"); // pre-test first
    await expectAppError(startAssessment(deps, student.id, lesson2, { purpose: "POST_TEST" }), "LESSON_NOT_STUDIED");

    const pre = await startAssessment(deps, student.id, lesson2, { purpose: "PRE_TEST" });
    expect(pre.mode).toBe("FIXED");
    const seen = new Map<string, number>();
    for (let i = 0; i < 12; i++) {
      const step = await answerNext(db, deps, student.id, pre.sessionId, ({ nth }) => (nth > 1 ? "correct" : "wrong"), seen);
      if (!step || step.result.sessionComplete) break;
      expect(step.result.stateAfter).toBeNull();
    }
    expect(await db.conceptMastery.count({ where: { userId: student.id, concept: { lessonId: lesson2 } } })).toBe(0);
    const measurement = await db.lessonMeasurement.findUniqueOrThrow({ where: { userId_lessonId: { userId: student.id, lessonId: lesson2 } } });
    expect(measurement.preScore).not.toBeNull();
    expect(measurement.weakBefore.length).toBeGreaterThan(0);
    await expectAppError(startAssessment(deps, student.id, lesson2, { purpose: "PRE_TEST" }), "SESSION_COMPLETED");

    // Study → lesson assessment → post-test.
    await markLessonStudied(db, student.id, lesson2);
    const practice = await startAssessment(deps, student.id, lesson2);
    for (let i = 0; i < 12; i++) {
      const step = await answerNext(db, deps, student.id, practice.sessionId, "correct");
      if (!step || step.result.sessionComplete) break;
    }
    const post = await startAssessment(deps, student.id, lesson2, { purpose: "POST_TEST" });
    for (let i = 0; i < 12; i++) {
      const step = await answerNext(db, deps, student.id, post.sessionId, "correct");
      if (!step || step.result.sessionComplete) break;
    }
    const done = await db.lessonMeasurement.findUniqueOrThrow({ where: { userId_lessonId: { userId: student.id, lessonId: lesson2 } } });
    expect(done.postScore).toBe(1);
    expect(done.weakAfter).toEqual([]);
    expect(Object.keys((done.masteryAfter ?? {}) as object).length).toBeGreaterThan(0);
  });

  it("N. students cannot read admin traceability or evaluation data", async () => {
    const student = await createUser(db, "learner@example.com");
    const actor = { id: student.id, role: student.role };
    await expectAppError(getLatencySummary(db, actor), "FORBIDDEN");
    await expectAppError(getMeasurementRows(db, actor), "FORBIDDEN");
  });

  it("the development mock stays out of production-shaped data: its questions are labelled", async () => {
    const student = await createUser(db, "learner@example.com");
    await markStudied(db, student.id, LESSON);
    const deps = { db, getProvider: () => new MockProvider() };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    for (let i = 0; i < 4; i++) await answerNext(db, deps, student.id, sessionId, "correct");
    await answerNext(db, deps, student.id, sessionId, "wrong");
    const q = asQuestion(await getNextQuestion(deps, student.id, sessionId));
    expect(q.isDevelopmentMock).toBe(true);
    expect(q.stage).toBe("VERIFICATION");
    // A quick reference to keep the helper imports honest.
    expect(okQuestion).toBeTypeOf("function");
  });
});
