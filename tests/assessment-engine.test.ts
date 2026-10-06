import { beforeEach, describe, expect, it } from "vitest";
import { completeSession, getNextQuestion, startAssessment, submitAnswer } from "@/server/assessment/engine";
import { buildReport, type SessionReport } from "@/server/assessment/report";
import { AIProviderError } from "@/server/ai/provider";
import { AppError } from "@/server/errors";
import type { PrismaClient } from "@/generated/prisma/client";
import { hasTestDb, testDb, truncateAll } from "./helpers/db";
import { createUser, markStudied, seedFixtureCurriculum, UNAPPROVED_MARKER } from "./helpers/fixtures";
import { A, answerNext, asQuestion, C, CONCEPT_C_QUESTIONS, expectAppError, LESSON, mockBacked, PASS } from "./helpers/flow";
import { INSUFFICIENT, ScriptedProvider } from "./helpers/scripted-provider";

async function setup(db: PrismaClient) {
  await truncateAll();
  await seedFixtureCurriculum(db);
  const student = await createUser(db, "student@example.com");
  await markStudied(db, student.id, LESSON);
  return { student };
}

/** Answers the four baseline questions of concepts A and B correctly, leaving concept C next. */
async function answerFirstFourCorrectly(db: PrismaClient, deps: Parameters<typeof answerNext>[1], userId: string, sessionId: string) {
  for (let i = 0; i < 4; i++) {
    const step = await answerNext(db, deps, userId, sessionId, "correct");
    expect(step?.stored.stage).toBe("BASELINE");
  }
}

describe.skipIf(!hasTestDb)("assessment engine (database)", () => {
  let db: PrismaClient;
  beforeEach(() => {
    db = testDb();
  });

  it("requires the lesson to be studied first", async () => {
    await truncateAll();
    await seedFixtureCurriculum(db);
    const student = await createUser(db, "student@example.com");
    await expectAppError(startAssessment({ db, getProvider: () => mockBacked() }, student.id, LESSON), "LESSON_NOT_STUDIED");
  });

  it("keeps later lessons locked until the previous one is studied", async () => {
    await truncateAll();
    await seedFixtureCurriculum(db);
    const student = await createUser(db, "student@example.com");
    await expectAppError(startAssessment({ db, getProvider: () => mockBacked() }, student.id, "lesson-mastery"), "LESSON_LOCKED");
  });

  // ───────────────────────── BASELINE ─────────────────────────

  it("BASE — Q1 is the approved fixed baseline and does not construct an AI provider", async () => {
    const { student } = await setup(db);
    const provider = mockBacked();
    let providerConstructed = 0;
    const deps = {
      db,
      getProvider: () => {
        providerConstructed++;
        return provider;
      },
    };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);

    const first = asQuestion(await getNextQuestion(deps, student.id, sessionId));

    expect(first).toMatchObject({ origin: "FIXED_BANK", stage: "BASELINE" });
    expect(providerConstructed).toBe(0);
    expect(provider.generateRequests).toHaveLength(0);
    expect(provider.validateRequests).toHaveLength(0);
  });

  it("BASE — an empty eligible fixed bank uses the existing validated source-grounded fallback", async () => {
    const { student } = await setup(db);
    await db.fixedQuestion.updateMany({ where: { lessonId: LESSON }, data: { approved: false } });
    const provider = mockBacked();
    const deps = { db, getProvider: () => provider };

    const { sessionId, mode } = await startAssessment(deps, student.id, LESSON);
    const first = asQuestion(await getNextQuestion(deps, student.id, sessionId));

    expect(mode).toBe("ADAPTIVE");
    expect(first.origin).toBe("AI_GENERATED");
    expect(provider.generateRequests).toHaveLength(1);
    expect(provider.validateRequests).toHaveLength(1);
  });

  it("BASE — the lesson assessment is the approved database bank, served in order; Gemini is NOT called", async () => {
    const { student } = await setup(db);
    const provider = mockBacked();
    const deps = { db, getProvider: () => provider };
    const { sessionId, mode } = await startAssessment(deps, student.id, LESSON);
    expect(mode).toBe("FIXED");
    const bank = await db.fixedQuestion.findMany({ where: { lessonId: LESSON }, orderBy: { order: "asc" } });

    for (const expected of bank) {
      const q = asQuestion(await getNextQuestion(deps, student.id, sessionId));
      expect(q.text).toBe(expected.question);
      expect(q.origin).toBe("FIXED_BANK");
      expect(q.stage).toBe("BASELINE");
      // The public payload never leaks the key or the explanation before the learner answers.
      expect(JSON.stringify(q)).not.toContain("correctIndex");
      expect(Object.keys(q)).not.toEqual(expect.arrayContaining(["correctAnswer", "explanation"]));
      await submitAnswer(deps, student.id, sessionId, q.id, expected.correctIndex);
    }
    const session = await db.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe("COMPLETED");
    expect((session.report as unknown as SessionReport).accuracy).toBe(1);
    // Not one model call for baseline questions, and no AI trace.
    expect(provider.generateRequests).toHaveLength(0);
    expect(provider.validateRequests).toHaveLength(0);
    expect(await db.aIInteractionLog.count({ where: { sessionId } })).toBe(0);
  });

  it("BASE — progress counts baseline questions only and a follow-up keeps the position of the question it follows", async () => {
    const { student } = await setup(db);
    const provider = new ScriptedProvider([CONCEPT_C_QUESTIONS.inspector], [PASS()]);
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    await answerFirstFourCorrectly(db, deps, student.id, sessionId);

    const fifth = await getNextQuestion(deps, student.id, sessionId);
    if (fifth.kind !== "question") throw new Error("expected question");
    expect(fifth.question.position).toBe(5);
    expect(fifth.progress.fixedTotal).toBe(6);
    const fifthRow = await db.generatedQuestion.findUniqueOrThrow({ where: { id: fifth.question.id } });
    await submitAnswer(deps, student.id, sessionId, fifth.question.id, (fifthRow.correctIndex + 1) % fifthRow.options.length);
    const verification = await getNextQuestion(deps, student.id, sessionId);
    if (verification.kind !== "question") throw new Error("expected question");
    expect(verification.question.stage).toBe("VERIFICATION");
    expect(verification.question.position).toBe(5);
    expect(verification.progress.answered).toBe(5);
    expect(verification.progress.fixedTotal).toBe(6);
  });

  // ───────────────────────── VERIFICATION ─────────────────────────

  it("VERIFICATION — a wrong baseline answer triggers an AI question from the APPROVED passage, with full traceability", async () => {
    const { student } = await setup(db);
    const provider = new ScriptedProvider([CONCEPT_C_QUESTIONS.inspector], [PASS()]);
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    await answerFirstFourCorrectly(db, deps, student.id, sessionId);
    expect(provider.generateRequests).toHaveLength(0);

    const wrong = await answerNext(db, deps, student.id, sessionId, "wrong");
    expect(wrong?.stored.conceptId).toBe(C);
    expect(wrong?.result).toMatchObject({ correct: false, followUp: "GENERATE", feedbackTitle: "نتأكد من فهم هذه الفكرة بسؤال آخر" });

    const q = asQuestion(await getNextQuestion(deps, student.id, sessionId));
    expect(q).toMatchObject({ stage: "VERIFICATION", origin: "AI_GENERATED", conceptId: C });
    expect(q.adaptiveNote).toBe("نتأكد من فهم هذه الفكرة بسؤال آخر");
    expect(provider.generateRequests).toHaveLength(1);
    expect(JSON.stringify(q)).not.toMatch(/answerEvidence|explanationEvidence|grounding|correctIndex/);

    // The model only ever received the APPROVED passage of THIS concept, resolved by the server.
    const approved = await db.sourcePassage.findUniqueOrThrow({ where: { id: "passage-question-validation" } });
    const req = provider.generateRequests[0];
    expect(req.stage).toBe("VERIFICATION");
    expect(req.passage.text).toBe(approved.text);
    expect(req.conceptId).toBe(C);
    expect(provider.generatePrompts[0].user).not.toContain(UNAPPROVED_MARKER);
    // Adaptive context: what the learner just missed, and every question that must not be repeated.
    expect(req.previous).toMatchObject({ stage: "BASELINE", correctAnswer: expect.any(String), studentAnswer: expect.any(String) });
    const givenAnswer = await db.studentAnswer.findUniqueOrThrow({ where: { questionId: wrong!.stored.id } });
    expect(req.previous?.studentAnswer).toBe(givenAnswer.selectedAnswer);
    expect(req.previous?.studentAnswer).not.toBe(req.previous?.correctAnswer);
    const bank = await db.fixedQuestion.findMany({ where: { conceptId: C } });
    for (const b of bank) expect(req.previousQuestions).toContain(b.question);

    const stored = await db.generatedQuestion.findUniqueOrThrow({ where: { id: q.id }, include: { sourcePassage: true } });
    expect(stored).toMatchObject({
      stage: "VERIFICATION",
      validationStatus: "VALID",
      previousQuestionId: wrong?.stored.id,
      sourcePassageId: approved.id,
      sourceVersion: approved.version,
      answerEvidence: expect.stringContaining("يفحص مدقق مستقل"),
      retryCount: 0,
    });
    expect(stored.explanationEvidence).not.toBe("");
    expect(stored.studentPreviousAnswer).toBe(req.previous?.studentAnswer);
    expect(stored.model).toBe("scripted-model");
    expect(stored.promptVersion).toMatch(/^generator\./);
    expect(stored.sourceSnapshot).toBe(approved.text);
    expect(stored.question).not.toBe(wrong?.stored.question);

    const logs = await db.aIInteractionLog.findMany({ where: { sessionId, type: { not: "GENERATION_REQUEST" } } });
    expect(logs.map((l) => l.type)).toEqual(expect.arrayContaining(["GENERATE", "VALIDATE"]));
    expect(logs.every((l) => l.sourcePassageId === approved.id)).toBe(true);
  });

  it("VERIFICATION — a correct verification answer ends the chain and the base assessment continues; one mistake is never «weak»", async () => {
    const { student } = await setup(db);
    const provider = new ScriptedProvider([CONCEPT_C_QUESTIONS.inspector], [PASS()]);
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    await answerFirstFourCorrectly(db, deps, student.id, sessionId);
    await answerNext(db, deps, student.id, sessionId, "wrong");

    const verification = await answerNext(db, deps, student.id, sessionId, "correct");
    expect(verification?.stored.stage).toBe("VERIFICATION");
    expect(verification?.result).toMatchObject({ correct: true, followUp: "NONE", sessionComplete: false });
    const mastery = await db.conceptMastery.findUniqueOrThrow({ where: { userId_conceptId: { userId: student.id, conceptId: C } } });
    expect(mastery.state).not.toBe("NEEDS_REINFORCEMENT");

    // Back to the approved bank: the last baseline question, then the end.
    const sixth = await answerNext(db, deps, student.id, sessionId, "correct");
    expect(sixth?.stored).toMatchObject({ stage: "BASELINE", origin: "FIXED_BANK" });
    expect(sixth?.result.sessionComplete).toBe(true);
    expect(provider.generateRequests).toHaveLength(1);
  });

  it("the assessment never ends while a follow-up is pending, even when the LAST baseline question is the wrong one", async () => {
    const { student } = await setup(db);
    const provider = new ScriptedProvider([CONCEPT_C_QUESTIONS.inspector], [PASS()]);
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    await answerFirstFourCorrectly(db, deps, student.id, sessionId);
    await answerNext(db, deps, student.id, sessionId, "correct"); // 5th
    const last = await answerNext(db, deps, student.id, sessionId, "wrong"); // 6th — last baseline
    expect(last?.result).toMatchObject({ correct: false, sessionComplete: false, followUp: "GENERATE" });
    expect((await db.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("IN_PROGRESS");

    const verification = await answerNext(db, deps, student.id, sessionId, "correct");
    expect(verification?.stored.stage).toBe("VERIFICATION");
    expect(verification?.result.sessionComplete).toBe(true);
  });

  it("SECOND_VERIFICATION → weak concept → exact approved video review → REASSESSMENT → the assessment continues", async () => {
    const { student } = await setup(db);
    await db.concept.update({
      where: { id: C },
      data: { videoUrl: "https://www.youtube.com/watch?v=AbCdEf12345", videoStartSecond: 755, videoEndSecond: 980, videoApproved: true },
    });
    const provider = new ScriptedProvider(
      [CONCEPT_C_QUESTIONS.inspector, CONCEPT_C_QUESTIONS.three, CONCEPT_C_QUESTIONS.insufficient],
      [PASS(), PASS(), PASS()],
    );
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    await answerFirstFourCorrectly(db, deps, student.id, sessionId);

    const base = await answerNext(db, deps, student.id, sessionId, "wrong");
    const v1 = await answerNext(db, deps, student.id, sessionId, "wrong");
    expect(v1?.stored.stage).toBe("VERIFICATION");
    expect(v1?.result).toMatchObject({ followUp: "GENERATE", feedbackTitle: "نتأكد من فهم هذه الفكرة بسؤال آخر" });
    const v2 = await answerNext(db, deps, student.id, sessionId, "wrong");
    expect(v2?.stored.stage).toBe("SECOND_VERIFICATION");
    expect(v2?.stored.previousQuestionId).toBe(v1?.stored.id);
    expect(v2?.result).toMatchObject({ followUp: "REVIEW", feedbackTitle: "هذه الفكرة تحتاج إلى تثبيت بسيط", adaptiveMessage: "راجع هذا الجزء ثم اختبر فهمك مرة أخرى." });

    // Each AI question differs from the baseline and from the verification before it.
    expect(new Set([base?.stored.question, v1?.stored.question, v2?.stored.question]).size).toBe(3);
    expect(provider.generateRequests[1].previousQuestions).toContain(v1?.stored.question);

    // Weak concept → the review step carries ONLY the human-approved video segment.
    const review = await getNextQuestion(deps, student.id, sessionId);
    expect(review).toMatchObject({
      kind: "review",
      review: { conceptId: C, conceptTitle: "بناء الأسئلة والتحقق منها", video: { url: "https://www.youtube.com/watch?v=AbCdEf12345", startSecond: 755, endSecond: 980 } },
    });
    expect(JSON.stringify(review)).not.toMatch(/passage|text|sourceSnapshot|reviewText/i);
    // Asking again without confirming never skips the review; no model call happened for it.
    expect((await getNextQuestion(deps, student.id, sessionId)).kind).toBe("review");
    expect(provider.generateRequests).toHaveLength(2);

    // The learner confirms → AI REASSESSMENT, new and different from everything before.
    const reassessment = asQuestion(await getNextQuestion(deps, student.id, sessionId, { reviewed: true }));
    expect(reassessment).toMatchObject({ stage: "REASSESSMENT", origin: "AI_GENERATED", conceptId: C });
    expect(provider.generateRequests[2].stage).toBe("REASSESSMENT");
    expect(provider.generateRequests[2].previousQuestions).toEqual(expect.arrayContaining([base?.stored.question, v1?.stored.question, v2?.stored.question]));
    expect([base?.stored.question, v1?.stored.question, v2?.stored.question]).not.toContain(reassessment.text);

    const answered = await submitAnswer(deps, student.id, sessionId, reassessment.id, (await db.generatedQuestion.findUniqueOrThrow({ where: { id: reassessment.id } })).correctIndex);
    expect(answered).toMatchObject({ correct: true, followUp: "NONE", sessionComplete: false });
    // The weak concept recovers through the normal mastery logic (no thresholds were changed).
    const mastery = await db.conceptMastery.findUniqueOrThrow({ where: { userId_conceptId: { userId: student.id, conceptId: C } } });
    expect(mastery.attempts).toBe(4);
    expect(mastery.correctCount).toBe(1);

    // …and the assessment continues with the remaining baseline question, then ends.
    const last = await answerNext(db, deps, student.id, sessionId, "correct");
    expect(last?.stored.stage).toBe("BASELINE");
    expect(last?.result.sessionComplete).toBe(true);
    // A single reassessment per weak concept: even a wrong reassessment answer does not loop.
  });

  it("a wrong REASSESSMENT answer does not start another chain — the assessment simply continues", async () => {
    const { student } = await setup(db);
    const provider = new ScriptedProvider(
      [CONCEPT_C_QUESTIONS.inspector, CONCEPT_C_QUESTIONS.three, CONCEPT_C_QUESTIONS.insufficient],
      [PASS(), PASS(), PASS()],
    );
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    await answerFirstFourCorrectly(db, deps, student.id, sessionId);
    for (let i = 0; i < 3; i++) await answerNext(db, deps, student.id, sessionId, "wrong");
    const reassessment = await answerNext(db, deps, student.id, sessionId, "wrong");
    expect(reassessment?.stored.stage).toBe("REASSESSMENT");
    expect(reassessment?.result.followUp).toBe("NONE");
    const next = await getNextQuestion(deps, student.id, sessionId);
    expect(next.kind === "question" && next.question.stage).toBe("BASELINE");
    expect(provider.generateRequests).toHaveLength(3);
  });

  // ───────────────────────── Failure handling ─────────────────────────

  it("regenerates when validation fails and never serves the rejected question", async () => {
    const { student } = await setup(db);
    const madhhab = { ...CONCEPT_C_QUESTIONS.inspector, explanation: "وعند الشافعية يفحص مدقق مستقل السؤال قبل عرضه." };
    const provider = new ScriptedProvider([madhhab, CONCEPT_C_QUESTIONS.inspector], [PASS(), PASS()]);
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    await answerFirstFourCorrectly(db, deps, student.id, sessionId);
    await answerNext(db, deps, student.id, sessionId, "wrong");
    const q = asQuestion(await getNextQuestion(deps, student.id, sessionId));

    const ai = await db.generatedQuestion.findMany({ where: { sessionId, origin: "AI_GENERATED" }, orderBy: { createdAt: "asc" } });
    expect(ai).toHaveLength(2);
    expect(ai[0]).toMatchObject({ validationStatus: "REJECTED", sequence: null });
    expect(ai[0].validationIssues).toContain("OTHER_MADHHAB_MARKER");
    expect((ai[0].validatorResult as { verdict: string }).verdict).toBe("REJECT");
    expect(q.id).toBe(ai[1].id);
    expect(ai[1].retryCount).toBe(1);
    // The regeneration was told why the previous draft failed.
    expect(provider.generateRequests[1].previousRejections).toContain("OTHER_MADHHAB_MARKER");
    expect(provider.generatePrompts[1].user).toContain("OTHER_MADHHAB_MARKER");
  });

  it("gives up safely after the maximum attempts: progress is kept, nothing invented is shown, a retry works later", async () => {
    const { student } = await setup(db);
    const bad = { ...CONCEPT_C_QUESTIONS.inspector, explanation: "وعند الشافعية يفحص مدقق مستقل السؤال قبل عرضه." };
    const provider = new ScriptedProvider([], [], { gen: bad, val: PASS() });
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    await answerFirstFourCorrectly(db, deps, student.id, sessionId);
    await answerNext(db, deps, student.id, sessionId, "wrong");

    await expectAppError(getNextQuestion(deps, student.id, sessionId), "GENERATION_FAILED");
    expect(provider.generateRequests).toHaveLength(3);
    expect(await db.generatedQuestion.count({ where: { sessionId, origin: "AI_GENERATED", sequence: { not: null } } })).toBe(0);
    // Progress is preserved and the lock is released.
    expect(await db.studentAnswer.count({ where: { sessionId } })).toBe(5);
    expect((await db.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } })).generationLockUntil).toBeNull();

    // «حاول مرة أخرى» continues the SAME session, and the model has recovered.
    const recovered = new ScriptedProvider([CONCEPT_C_QUESTIONS.three], [PASS()]);
    const q = asQuestion(await getNextQuestion({ db, getProvider: () => recovered }, student.id, sessionId));
    expect(q.stage).toBe("VERIFICATION");
    expect(await db.studentAnswer.count({ where: { sessionId } })).toBe(5);
  });

  it("repeated exhaustion for the same step skips the follow-up instead of trapping the learner; no fallback question is invented", async () => {
    const { student } = await setup(db);
    const bad = { ...CONCEPT_C_QUESTIONS.inspector, explanation: "وعند الشافعية يفحص مدقق مستقل السؤال قبل عرضه." };
    const provider = new ScriptedProvider([], [], { gen: bad, val: PASS() });
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    await answerFirstFourCorrectly(db, deps, student.id, sessionId);
    await answerNext(db, deps, student.id, sessionId, "wrong");
    await expectAppError(getNextQuestion(deps, student.id, sessionId), "GENERATION_FAILED");
    const next = await getNextQuestion(deps, student.id, sessionId);
    // Second exhaustion → the concept is recorded as not verifiable and the approved bank carries on.
    expect(next.kind).toBe("question");
    if (next.kind === "question") expect(next.question).toMatchObject({ stage: "BASELINE", origin: "FIXED_BANK" });
    expect((await db.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } })).insufficientConceptIds).toEqual([C]);
    expect(await db.generatedQuestion.count({ where: { sessionId, origin: "AI_GENERATED", sequence: { not: null } } })).toBe(0);
  });

  it("INSUFFICIENT_SOURCE on a follow-up skips it and continues with the approved bank", async () => {
    const { student } = await setup(db);
    const provider = new ScriptedProvider([INSUFFICIENT]);
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    await answerFirstFourCorrectly(db, deps, student.id, sessionId);
    await answerNext(db, deps, student.id, sessionId, "wrong");
    const next = await getNextQuestion(deps, student.id, sessionId);
    expect(next.kind === "question" && next.question.stage).toBe("BASELINE");
    expect((await db.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } })).insufficientConceptIds).toEqual([C]);
    expect(await db.aIInteractionLog.count({ where: { sessionId, type: "GENERATE", status: "INSUFFICIENT_SOURCE" } })).toBe(1);
  });

  it("provider failures are distinct, calm and retryable — the session, answers and mastery survive", async () => {
    const { student } = await setup(db);
    const cases: Array<[AIProviderError, string]> = [
      [new AIProviderError("UNAVAILABLE", "down"), "AI_UNAVAILABLE"],
      [new AIProviderError("RATE_LIMITED", "quota"), "AI_RATE_LIMIT"],
      [new AIProviderError("TIMEOUT", "slow"), "AI_TIMEOUT"],
    ];
    const deps0 = { db, getProvider: () => new ScriptedProvider() };
    const { sessionId } = await startAssessment(deps0, student.id, LESSON);
    await answerFirstFourCorrectly(db, deps0, student.id, sessionId);
    await answerNext(db, deps0, student.id, sessionId, "wrong");

    const answersBefore = await db.studentAnswer.count({ where: { sessionId } });
    const masteryBefore = await db.conceptMastery.findUniqueOrThrow({ where: { userId_conceptId: { userId: student.id, conceptId: C } } });
    for (const [error, code] of cases) {
      const provider = new ScriptedProvider([], [], { gen: error });
      await expectAppError(getNextQuestion({ db, getProvider: () => provider }, student.id, sessionId), code);
      expect((await db.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } })).generationLockUntil).toBeNull();
    }
    expect(await db.studentAnswer.count({ where: { sessionId } })).toBe(answersBefore);
    expect((await db.conceptMastery.findUniqueOrThrow({ where: { userId_conceptId: { userId: student.id, conceptId: C } } })).masteryScore).toBe(masteryBefore.masteryScore);
    const kinds = (await db.aIInteractionLog.findMany({ where: { sessionId, status: "PROVIDER_ERROR" } })).map((l) => (l.metadata as { failureKind?: string }).failureKind);
    expect(kinds).toEqual(expect.arrayContaining(["AI_PROVIDER_ERROR", "AI_RATE_LIMIT", "AI_TIMEOUT"]));

    // Back online: the same step resumes where it was.
    const online = new ScriptedProvider([CONCEPT_C_QUESTIONS.inspector], [PASS()]);
    expect(asQuestion(await getNextQuestion({ db, getProvider: () => online }, student.id, sessionId)).stage).toBe("VERIFICATION");
  });

  it("without a configured provider the base assessment still works and follow-ups are skipped (never faked)", async () => {
    const { student } = await setup(db);
    const notConfigured = () => {
      throw new AppError("AI_NOT_CONFIGURED");
    };
    const deps = { db, getProvider: notConfigured };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    for (let i = 0; i < 6; i++) {
      const step = await answerNext(db, deps, student.id, sessionId, "wrong");
      expect(step?.stored).toMatchObject({ stage: "BASELINE", origin: "FIXED_BANK" });
    }
    expect((await db.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("COMPLETED");
    expect(await db.generatedQuestion.count({ where: { origin: "AI_GENERATED" } })).toBe(0);
  });

  it("pre/post measurement tests never call the model and never move mastery", async () => {
    await truncateAll();
    await seedFixtureCurriculum(db);
    const student = await createUser(db, "student@example.com");
    await markStudied(db, student.id, LESSON);
    const provider = new ScriptedProvider([], [], { gen: new AIProviderError("UNAVAILABLE", "must not be called") });
    const deps = { db, getProvider: () => provider };
    const pre = await startAssessment(deps, student.id, "lesson-mastery", { purpose: "PRE_TEST" });
    for (let i = 0; i < 12; i++) {
      const step = await answerNext(db, deps, student.id, pre.sessionId, "wrong");
      if (!step || step.result.sessionComplete) break;
      expect(step.stored.stage).toBe("BASELINE");
    }
    expect(provider.generateRequests).toHaveLength(0);
    expect(await db.conceptMastery.count({ where: { userId: student.id, concept: { lessonId: "lesson-mastery" } } })).toBe(0);
  });

  // ───────────────────────── Sessions & concurrency ─────────────────────────

  it("resumes the same unanswered question after a refresh — including a pending AI follow-up, without a second model call", async () => {
    const { student } = await setup(db);
    const provider = new ScriptedProvider([CONCEPT_C_QUESTIONS.inspector], [PASS()]);
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    await answerFirstFourCorrectly(db, deps, student.id, sessionId);
    await answerNext(db, deps, student.id, sessionId, "wrong");

    const first = asQuestion(await getNextQuestion(deps, student.id, sessionId));
    const again = asQuestion(await getNextQuestion(deps, student.id, sessionId));
    expect(again.id).toBe(first.id);
    expect(provider.generateRequests).toHaveLength(1);
    expect(await startAssessment(deps, student.id, LESSON)).toMatchObject({ sessionId, resumed: true });
  });

  it("two concurrent requests for the same follow-up produce ONE question (the other gets «pending» or the same question)", async () => {
    const { student } = await setup(db);
    const provider = new ScriptedProvider([CONCEPT_C_QUESTIONS.inspector, CONCEPT_C_QUESTIONS.three], [PASS(), PASS()]);
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    await answerFirstFourCorrectly(db, deps, student.id, sessionId);
    await answerNext(db, deps, student.id, sessionId, "wrong");
    const [a, b] = await Promise.all([getNextQuestion(deps, student.id, sessionId), getNextQuestion(deps, student.id, sessionId)]);
    const ids = [a, b].filter((r) => r.kind === "question").map((r) => (r.kind === "question" ? r.question.id : ""));
    expect(new Set(ids).size).toBe(1);
    expect(await db.generatedQuestion.count({ where: { sessionId, origin: "AI_GENERATED", sequence: { not: null } } })).toBe(1);
  });

  it("J. duplicate answer submissions are idempotent (sequential and concurrent)", async () => {
    const { student } = await setup(db);
    const deps = { db, getProvider: () => mockBacked() };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    const q = asQuestion(await getNextQuestion(deps, student.id, sessionId));
    const [a, b] = await Promise.all([submitAnswer(deps, student.id, sessionId, q.id, 0), submitAnswer(deps, student.id, sessionId, q.id, 1)]);
    const c = await submitAnswer(deps, student.id, sessionId, q.id, 1);
    expect(await db.studentAnswer.count({ where: { questionId: q.id } })).toBe(1);
    const mastery = await db.conceptMastery.findUniqueOrThrow({ where: { userId_conceptId: { userId: student.id, conceptId: q.conceptId } } });
    expect(mastery.attempts).toBe(1);
    expect([a.duplicate, b.duplicate].filter(Boolean)).toHaveLength(1);
    expect(c.duplicate).toBe(true);
    expect(new Set([a.selectedIndex, b.selectedIndex, c.selectedIndex]).size).toBe(1);
  });

  it("does not let a learner answer someone else's question", async () => {
    const { student } = await setup(db);
    const other = await createUser(db, "other@example.com");
    const deps = { db, getProvider: () => mockBacked() };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);
    const q = asQuestion(await getNextQuestion(deps, student.id, sessionId));
    await expectAppError(submitAnswer(deps, other.id, sessionId, q.id, 0), "NOT_FOUND");
    await expectAppError(getNextQuestion(deps, other.id, sessionId), "NOT_FOUND");
  });

  it("K. a lesson assessment with follow-ups completes with a consistent, frozen result", async () => {
    const { student } = await setup(db);
    const provider = mockBacked();
    const deps = { db, getProvider: () => provider };
    const { sessionId } = await startAssessment(deps, student.id, LESSON);

    let answered = 0;
    const seen = new Map<string, number>();
    for (let guard = 0; guard < 25; guard++) {
      // Concept A is missed on its first baseline answer; everything else is right.
      const step = await answerNext(db, deps, student.id, sessionId, ({ conceptId, stage, nth }) => (conceptId === A && stage === "BASELINE" && nth === 1 ? "wrong" : "correct"), seen);
      if (!step) break;
      answered++;
      if (step.result.sessionComplete) break;
    }
    const session = await db.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe("COMPLETED");
    const stages = (await db.generatedQuestion.findMany({ where: { sessionId, sequence: { not: null } }, orderBy: { sequence: "asc" } })).map((q) => q.stage);
    expect(stages.filter((s) => s === "BASELINE")).toHaveLength(6);
    expect(stages).toContain("VERIFICATION");

    const report = session.report as unknown as SessionReport;
    expect(report.totalQuestions).toBe(answered);
    const answers = await db.studentAnswer.findMany({ where: { sessionId }, include: { question: true } });
    const concepts = await db.concept.findMany({ where: { lessonId: LESSON } });
    const recomputed = buildReport({
      mode: "FIXED",
      purpose: "PRACTICE",
      completionReason: report.completionReason,
      concepts,
      answers: answers.map((a) => ({
        conceptId: a.question.conceptId,
        correct: a.correct,
        masteryBefore: a.masteryBefore,
        masteryAfter: a.masteryAfter,
        stateBefore: a.stateBefore,
        stateAfter: a.stateAfter,
        answeredAt: a.answeredAt,
      })),
    });
    expect(recomputed).toEqual(report);
    expect(await completeSession(db, sessionId, "MAX_QUESTIONS")).toEqual(report);
    expect([...report.strongConceptIds, ...report.learningConceptIds, ...report.reinforceConceptIds].sort()).toEqual(report.concepts.map((c) => c.conceptId).sort());
    const progress = await db.lessonProgress.findUniqueOrThrow({ where: { userId_lessonId: { userId: student.id, lessonId: LESSON } } });
    expect(progress.completedAt).not.toBeNull();
    expect(await getNextQuestion(deps, student.id, sessionId)).toEqual({ kind: "completed" });
    // Completing the lesson unlocks the next one.
    await markStudied(db, student.id, "lesson-mastery");
    expect((await startAssessment(deps, student.id, "lesson-mastery")).sessionId).toBeTruthy();
  });
});
