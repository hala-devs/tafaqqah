/**
 * REAL Gemini verification on Lesson 1 — no mocks.
 *
 * Runs the production pipeline (server-side source retrieval → Gemini generator → evidence + deterministic
 * checks → independent Gemini validator) on the APPROVED passages of the real Lesson 1, at the three
 * runtime stages, and prints every question — the ones that passed AND the ones that were rejected.
 *
 *   npm run verify:gemini-lesson-1            # 10 questions across concepts and stages
 *   npm run verify:gemini-lesson-1 -- 3       # only the first 3 plan items
 *
 * Uses the database in DATABASE_URL (it writes a throw-away session for the verification user, visible
 * to admins in /admin/logs) and costs real API calls. Needs GEMINI_API_KEY.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { getAIProvider } from "../src/server/ai/factory";
import { produceValidatedQuestion } from "../src/server/ai/pipeline";
import type { AdaptiveStage } from "../src/server/ai/types";
import { isAppError } from "../src/server/errors";

const LESSON = "lesson-akhsar-01";
const EMAIL = "real-gemini-verification@example.test";

type PlanItem = { conceptOrder: number; stage: AdaptiveStage };
const PLAN: PlanItem[] = [
  { conceptOrder: 1, stage: "VERIFICATION" },
  { conceptOrder: 2, stage: "VERIFICATION" },
  { conceptOrder: 4, stage: "SECOND_VERIFICATION" },
  { conceptOrder: 5, stage: "REASSESSMENT" },
  { conceptOrder: 6, stage: "VERIFICATION" },
  { conceptOrder: 7, stage: "VERIFICATION" },
  { conceptOrder: 8, stage: "REASSESSMENT" },
  { conceptOrder: 10, stage: "VERIFICATION" },
  { conceptOrder: 11, stage: "VERIFICATION" },
  { conceptOrder: 12, stage: "SECOND_VERIFICATION" },
];

/** A second plan (npm run verify:gemini-lesson-1 -- 10 out.json B) that exercises other concept/stage pairs. */
const PLAN_B: PlanItem[] = [
  { conceptOrder: 2, stage: "REASSESSMENT" },
  { conceptOrder: 4, stage: "VERIFICATION" },
  { conceptOrder: 5, stage: "VERIFICATION" },
  { conceptOrder: 6, stage: "REASSESSMENT" },
  { conceptOrder: 8, stage: "VERIFICATION" },
  { conceptOrder: 10, stage: "SECOND_VERIFICATION" },
  { conceptOrder: 11, stage: "REASSESSMENT" },
  { conceptOrder: 1, stage: "REASSESSMENT" },
];

async function main() {
  const PLAN_USED = process.argv[4] === "B" ? PLAN_B : PLAN;
  const limit = Number(process.argv[2]) || PLAN_USED.length;
  const outFile = process.argv[3];
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const provider = getAIProvider();
  if (provider.isDevelopmentMock) throw new Error("Refusing to run: the configured provider is the development mock. Set AI_PROVIDER=gemini.");
  console.log(`provider=${provider.name} generatorModel=${provider.generatorModel} validatorModel=${provider.validatorModel}\n`);

  const user = await db.user.upsert({
    where: { email: EMAIL },
    update: {},
    create: { email: EMAIL, name: "تحقق Gemini", passwordHash: "not-a-login", role: "STUDENT" },
  });
  const session = await db.assessmentSession.create({ data: { userId: user.id, lessonId: LESSON, mode: "FIXED", purpose: "PRACTICE" } });
  const concepts = await db.concept.findMany({ where: { lessonId: LESSON }, orderBy: { order: "asc" }, select: { id: true, title: true, order: true } });

  const results: unknown[] = [];
  const aiShown: Record<string, string[]> = {};

  for (const item of PLAN_USED.slice(0, limit)) {
    const concept = concepts.find((c) => c.order === item.conceptOrder)!;
    const bank = await db.fixedQuestion.findMany({ where: { conceptId: concept.id, approved: true }, orderBy: { order: "asc" } });
    const base = bank[0];
    // Record the baseline question the (simulated) learner missed, so the chain is traceable in /admin/logs.
    const baseRow = base
      ? await db.generatedQuestion.create({
          data: {
            sessionId: session.id,
            lessonId: LESSON,
            conceptId: concept.id,
            sourcePassageId: base.sourcePassageId,
            sourceVersion: (await db.sourcePassage.findUniqueOrThrow({ where: { id: base.sourcePassageId } })).version,
            sourceSnapshot: "",
            origin: "FIXED_BANK",
            stage: "BASELINE",
            fixedQuestionId: base.id,
            questionType: base.questionType,
            question: base.question,
            options: base.options,
            correctIndex: base.correctIndex,
            correctAnswer: base.options[base.correctIndex],
            explanation: base.explanation,
            answerEvidence: "",
            difficulty: base.difficulty,
            validationStatus: "VALID",
            validationIssues: [],
            generatorMetadata: { origin: "FIXED_BANK", verificationScript: true },
            sequence: results.length + 1,
          },
        })
      : null;
    const previous = base && baseRow
      ? {
          id: baseRow.id,
          stage: "BASELINE" as const,
          question: base.question,
          options: base.options,
          studentAnswer: base.options[(base.correctIndex + 1) % base.options.length],
          correctAnswer: base.options[base.correctIndex],
        }
      : null;
    const shown = aiShown[concept.id] ?? [];
    const started = Date.now();
    let outcome: string;
    try {
      const result = await produceValidatedQuestion({
        db,
        provider,
        userId: user.id,
        sessionId: session.id,
        lessonId: LESSON,
        concept: { id: concept.id, title: concept.title },
        stage: item.stage,
        targetDifficulty: 2,
        previous,
        previousQuestions: [...bank.map((b) => b.question), ...shown],
        previousAnswers: bank.map((b) => b.options[b.correctIndex]),
        baselineQuestions: bank.map((b) => b.question),
      });
      outcome = result.kind === "FAILED" ? `FAILED (${result.failureKind}: ${result.lastIssues.join(",")})` : result.kind;
      if (result.kind === "VALID") {
        const row = await db.generatedQuestion.findUniqueOrThrow({ where: { id: result.questionId } });
        aiShown[concept.id] = [...shown, row.question];
      }
    } catch (error) {
      outcome = `ERROR ${isAppError(error) ? error.code : error instanceof Error ? error.message : String(error)}`;
    }
    console.log(`#${results.length + 1} concept ${item.conceptOrder} «${concept.title}» [${item.stage}] → ${outcome} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    results.push({ conceptOrder: item.conceptOrder, conceptTitle: concept.title, stage: item.stage, outcome });
  }

  const rows = await db.generatedQuestion.findMany({
    where: { sessionId: session.id, origin: "AI_GENERATED" },
    orderBy: { createdAt: "asc" },
    include: { concept: { select: { title: true, order: true } } },
  });
  const report = rows.map((r) => ({
    number: r.number,
    stage: r.stage,
    concept: `${r.concept.order}. ${r.concept.title}`,
    result: r.validationStatus === "VALID" ? "PASS" : "REJECT",
    question: r.question,
    options: r.options,
    correctAnswer: r.correctAnswer,
    explanation: r.explanation,
    answerEvidence: r.answerEvidence,
    explanationEvidence: r.explanationEvidence,
    issues: r.validationIssues,
    validatorReasons: (r.validatorResult as { reasons?: string[] } | null)?.reasons ?? [],
    modelChecks: (r.validatorResult as { modelChecks?: unknown } | null)?.modelChecks ?? null,
    model: r.model,
    promptVersion: r.promptVersion,
    retryCount: r.retryCount,
    sourcePassageId: r.sourcePassageId,
    sourceVersion: r.sourceVersion,
  }));
  const passed = report.filter((r) => r.result === "PASS").length;
  console.log(`\nsession=${session.id}\nPASS=${passed} REJECT=${report.length - passed} (candidates stored: ${report.length})`);
  console.log(`models used: ${[...new Set(rows.map((r) => r.model))].join(", ")}`);
  const logs = await db.aIInteractionLog.groupBy({ by: ["type", "status", "model"], where: { sessionId: session.id }, _count: { _all: true } });
  console.log(JSON.stringify(logs.map((l) => ({ type: l.type, status: l.status, model: l.model, n: l._count._all }))));

  if (outFile) writeFileSync(outFile, JSON.stringify({ sessionId: session.id, plan: results, candidates: report }, null, 2), "utf8");
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
