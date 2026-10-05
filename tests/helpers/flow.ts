import { expect } from "vitest";
import { getNextQuestion, submitAnswer, type AnswerResult, type EngineDeps, type NextResult, type PublicQuestion } from "@/server/assessment/engine";
import { MockProvider } from "@/server/ai/mock-provider";
import { AppError } from "@/server/errors";
import type { PrismaClient } from "@/generated/prisma/client";
import { okQuestion, ScriptedProvider, verdict } from "./scripted-provider";

export const LESSON = "lesson-method";
/** Concept ids of the fixture lesson (two approved base questions each). */
export const A = "concept-approved-source";
export const B = "concept-study-stages";
export const C = "concept-question-validation";

/** A scripted provider that delegates to the deterministic development mock unless told otherwise. */
export function mockBacked(genOverrides: unknown[] = []) {
  const mock = new MockProvider();
  return new ScriptedProvider(genOverrides, [], {
    gen: async (req: Parameters<MockProvider["generateQuestion"]>[0]) => (await mock.generateQuestion(req)).data,
    val: async (req: Parameters<MockProvider["validateQuestion"]>[0]) => (await mock.validateQuestion(req)).data,
  });
}

export async function expectAppError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    expect.unreachable(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

export function asQuestion(next: NextResult): PublicQuestion {
  if (next.kind !== "question") throw new Error(`expected a question, got ${next.kind}`);
  return next.question;
}

/** Fully grounded questions on the fixture concept C (passage «بناء الأسئلة والتحقق منها»). */
const EVIDENCE = {
  rejected: "فإن رُفض السؤال أُعيد توليده",
  inspector: "ثم يفحص مدقق مستقل السؤال قبل عرضه",
  three: "وإن تكرر الرفض ثلاث مرات لم يُعرض سؤال مختلَق",
  insufficient: "عُدّ المقطع غير كافٍ ولم يُبنَ عليه سؤال",
};

export const CONCEPT_C_QUESTIONS = {
  inspector: okQuestion({
    question: "ما الذي يفحص السؤال قبل عرضه على المتعلم؟",
    options: ["مدقق مستقل", "الخادم نفسه", "المتصفح", "المتعلم الآخر"],
    explanation: "يفحص مدقق مستقل السؤال قبل عرضه.",
    answerEvidence: EVIDENCE.inspector,
  }),
  three: okQuestion({
    question: "كم مرة يتكرر الرفض قبل ألا يُعرض سؤال مختلَق؟",
    options: ["ثلاث مرات", "مرتان", "خمس مرات", "مرة واحدة"],
    explanation: "إذا تكرر الرفض ثلاث مرات لم يُعرض سؤال مختلَق.",
    answerEvidence: EVIDENCE.three,
  }),
  insufficient: okQuestion({
    question: "كيف يُعامل ما لا يكفي لبناء سؤال موثوق؟",
    options: ["يُعدّ غير كافٍ ولم يُبنَ عليه سؤال", "يُبنى عليه سؤال بعد تلخيصه", "يُنقل إلى مقطع آخر ليُبنى عليه", "يُعاد توليده مرة بعد أخرى"],
    explanation: "عُدّ غير كافٍ ولم يُبنَ عليه سؤال.",
    answerEvidence: EVIDENCE.insufficient,
  }),
};

export const PASS = (index = 0) => verdict(true, [index]);

/**
 * Answers the pending/next question.
 *  - `pick`: "correct" | "wrong" | explicit option index
 *  - handles the review step by confirming it (the learner pressing «اختبر فهمي مرة أخرى»)
 * Returns null when the session is complete.
 */
export async function answerNext(
  db: PrismaClient,
  deps: EngineDeps,
  userId: string,
  sessionId: string,
  pick: "correct" | "wrong" | number | ((q: { conceptId: string; stage: string; nth: number }) => "correct" | "wrong") = "correct",
  seen: Map<string, number> = new Map(),
): Promise<{ stored: Awaited<ReturnType<PrismaClient["generatedQuestion"]["findUniqueOrThrow"]>>; result: AnswerResult } | null> {
  let next = await getNextQuestion(deps, userId, sessionId);
  if (next.kind === "review") next = await getNextQuestion(deps, userId, sessionId, { reviewed: true });
  if (next.kind !== "question") return null;
  const stored = await db.generatedQuestion.findUniqueOrThrow({ where: { id: next.question.id } });
  const nth = (seen.get(stored.conceptId) ?? 0) + 1;
  seen.set(stored.conceptId, nth);
  const decision = typeof pick === "function" ? pick({ conceptId: stored.conceptId, stage: stored.stage, nth }) : pick;
  const index = typeof decision === "number" ? decision : decision === "correct" ? stored.correctIndex : (stored.correctIndex + 1) % stored.options.length;
  const result = await submitAnswer(deps, userId, sessionId, stored.id, index);
  return { stored, result };
}
