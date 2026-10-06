import { beforeEach, describe, expect, it } from "vitest";
import { getNextQuestion, startAssessment } from "@/server/assessment/engine";
import type { PrismaClient } from "@/generated/prisma/client";
import { hasTestDb, testDb, truncateAll } from "./helpers/db";
import { createUser, markStudied, seedFixtureCurriculum } from "./helpers/fixtures";
import { answerNext, asQuestion, CONCEPT_C_QUESTIONS, expectAppError, LESSON, PASS } from "./helpers/flow";
import { ScriptedProvider } from "./helpers/scripted-provider";

/**
 * A runtime question is saved before its HTTP response leaves the server. These tests pin the server half of
 * «never report a saved question as a failure»: the read-only peek finds it, a retry returns it without a new
 * generation, concurrent requests produce one generation, and every request that reached the engine is tracked.
 */
const BAD = { ...CONCEPT_C_QUESTIONS.inspector, explanation: "وعند الشافعية يفحص مدقق مستقل السؤال قبل عرضه." };

async function atFollowUp(db: PrismaClient, provider: ScriptedProvider) {
  await truncateAll();
  await seedFixtureCurriculum(db);
  const student = await createUser(db, "student@example.com");
  await markStudied(db, student.id, LESSON);
  const deps = { db, getProvider: () => provider };
  const { sessionId } = await startAssessment(deps, student.id, LESSON);
  for (let i = 0; i < 4; i++) await answerNext(db, deps, student.id, sessionId, "correct");
  // A wrong answer on concept C → the next step is an AI VERIFICATION question.
  await answerNext(db, deps, student.id, sessionId, "wrong");
  return { deps, userId: student.id, sessionId };
}

const requests = (db: PrismaClient, sessionId: string) =>
  db.aIInteractionLog.findMany({ where: { sessionId, type: "GENERATION_REQUEST" }, orderBy: { createdAt: "asc" } });

describe.skipIf(!hasTestDb)("runtime generation: idempotency and reconciliation (database)", () => {
  let db: PrismaClient;
  beforeEach(() => {
    db = testDb();
  });

  it("A — normal success: the question is returned and the request is tracked as SUCCESS with its question id", async () => {
    const provider = new ScriptedProvider([CONCEPT_C_QUESTIONS.three], [PASS()]);
    const { deps, userId, sessionId } = await atFollowUp(db, provider);

    const q = asQuestion(await getNextQuestion(deps, userId, sessionId));

    expect(q.stage).toBe("VERIFICATION");
    const tracked = await requests(db, sessionId);
    expect(tracked).toHaveLength(1);
    expect(tracked[0]).toMatchObject({ status: "SUCCESS", questionId: q.id });
    expect((tracked[0].metadata as { stage: string }).stage).toBe("VERIFICATION");
  });

  it("B — saved but the response was lost: peek returns the saved question without any model call", async () => {
    const provider = new ScriptedProvider([CONCEPT_C_QUESTIONS.three], [PASS()]);
    const { deps, userId, sessionId } = await atFollowUp(db, provider);
    const saved = asQuestion(await getNextQuestion(deps, userId, sessionId)); // response never reached the browser
    const calls = provider.generateRequests.length;

    const peek = await getNextQuestion(deps, userId, sessionId, { peek: true });

    expect(peek.kind === "question" && peek.question.id).toBe(saved.id);
    expect(provider.generateRequests).toHaveLength(calls);
  });

  it("C — retry after the question was saved returns the same question and generates nothing new", async () => {
    const provider = new ScriptedProvider([CONCEPT_C_QUESTIONS.three], [PASS()]);
    const { deps, userId, sessionId } = await atFollowUp(db, provider);
    const saved = asQuestion(await getNextQuestion(deps, userId, sessionId));

    const retried = asQuestion(await getNextQuestion(deps, userId, sessionId));

    expect(retried.id).toBe(saved.id);
    expect(provider.generateRequests).toHaveLength(1);
    expect(await db.generatedQuestion.count({ where: { sessionId, origin: "AI_GENERATED", sequence: { not: null } } })).toBe(1);
    expect(await requests(db, sessionId)).toHaveLength(1);
  });

  it("D — validator/deterministic rejections are never shown, are visible to admins, and are tracked as REJECTED (not a server failure)", async () => {
    const provider = new ScriptedProvider([], [], { gen: BAD, val: PASS() });
    const { deps, userId, sessionId } = await atFollowUp(db, provider);

    await expectAppError(getNextQuestion(deps, userId, sessionId), "GENERATION_FAILED");

    const drafts = await db.generatedQuestion.findMany({ where: { sessionId, origin: "AI_GENERATED" } });
    expect(drafts).toHaveLength(3);
    expect(drafts.every((d) => d.validationStatus === "REJECTED" && d.sequence === null)).toBe(true);
    const tracked = await requests(db, sessionId);
    expect(tracked).toHaveLength(1);
    expect(tracked[0].status).toBe("REJECTED");
    expect((tracked[0].metadata as { errorCode: string }).errorCode).toBe("GENERATION_FAILED");
  });

  it("E — a genuine failure leaves nothing to reconcile (peek → none) and a real retry can succeed", async () => {
    const provider = new ScriptedProvider([], [], { gen: BAD, val: PASS() });
    const { deps, userId, sessionId } = await atFollowUp(db, provider);
    await expectAppError(getNextQuestion(deps, userId, sessionId), "GENERATION_FAILED");

    expect(await getNextQuestion(deps, userId, sessionId, { peek: true })).toEqual({ kind: "none" });

    const recovered = new ScriptedProvider([CONCEPT_C_QUESTIONS.three], [PASS()]);
    const q = asQuestion(await getNextQuestion({ db, getProvider: () => recovered }, userId, sessionId));
    expect(q.stage).toBe("VERIFICATION");
    expect((await requests(db, sessionId)).map((r) => r.status)).toEqual(["REJECTED", "SUCCESS"]);
  });

  it("F — two simultaneous requests (double click) run ONE generation; the other waits («pending») or gets the same question", async () => {
    const provider = new ScriptedProvider([CONCEPT_C_QUESTIONS.three], [PASS()]);
    const { deps, userId, sessionId } = await atFollowUp(db, provider);

    const results = await Promise.all([getNextQuestion(deps, userId, sessionId), getNextQuestion(deps, userId, sessionId)]);

    expect(provider.generateRequests).toHaveLength(1);
    const ids = results.flatMap((r) => (r.kind === "question" ? [r.question.id] : []));
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ids).size).toBe(1);
    expect(results.every((r) => r.kind === "question" || r.kind === "pending")).toBe(true);
    expect(await db.generatedQuestion.count({ where: { sessionId, origin: "AI_GENERATED", sequence: { not: null } } })).toBe(1);
  });

  it("peek never generates, never serves a new bank question and reports «pending» while the lock is held", async () => {
    const provider = new ScriptedProvider([CONCEPT_C_QUESTIONS.three], [PASS()]);
    const { deps, userId, sessionId } = await atFollowUp(db, provider);
    const before = await db.generatedQuestion.count({ where: { sessionId } });

    await db.assessmentSession.update({ where: { id: sessionId }, data: { generationLockUntil: new Date(Date.now() + 60_000) } });
    expect(await getNextQuestion(deps, userId, sessionId, { peek: true })).toEqual({ kind: "pending" });
    await db.assessmentSession.update({ where: { id: sessionId }, data: { generationLockUntil: null } });
    expect(await getNextQuestion(deps, userId, sessionId, { peek: true })).toEqual({ kind: "none" });

    expect(provider.generateRequests).toHaveLength(0);
    expect(await db.generatedQuestion.count({ where: { sessionId } })).toBe(before);
  });

  it("a request that fails before any model call (rate limit) still leaves a tracking record", async () => {
    const provider = new ScriptedProvider([CONCEPT_C_QUESTIONS.three], [PASS()]);
    const { deps, userId, sessionId } = await atFollowUp(db, provider);
    const previous = process.env.AI_RATE_LIMIT_PER_10_MIN;
    process.env.AI_RATE_LIMIT_PER_10_MIN = "1";
    try {
      await db.aIInteractionLog.create({ data: { type: "GENERATE", status: "SUCCESS", provider: "x", model: "x", promptVersion: "x", userId, metadata: {} } });
      await expectAppError(getNextQuestion(deps, userId, sessionId), "RATE_LIMITED");
    } finally {
      if (previous === undefined) delete process.env.AI_RATE_LIMIT_PER_10_MIN;
      else process.env.AI_RATE_LIMIT_PER_10_MIN = previous;
    }
    expect(provider.generateRequests).toHaveLength(0);
    const tracked = await requests(db, sessionId);
    expect(tracked).toHaveLength(1);
    expect(tracked[0].status).toBe("FAILED");
    expect((tracked[0].metadata as { errorCode: string }).errorCode).toBe("RATE_LIMITED");
  });
});
