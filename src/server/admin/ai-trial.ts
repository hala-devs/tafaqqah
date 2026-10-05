import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertAdmin } from "@/server/auth/authorization";
import type { SessionUser } from "@/server/auth/session-store";
import { AppError } from "@/server/errors";
import { GENERATION_RULES } from "@/server/assessment/config";
import { getAIProvider } from "@/server/ai/factory";
import { logAIInteraction } from "@/server/ai/log";
import type { AIProvider } from "@/server/ai/provider";
import { QuestionGenerator, type CallMeta } from "@/server/ai/question-generator";
import { QuestionValidator } from "@/server/ai/question-validator";
import { resolveApprovedSource } from "@/server/ai/source";
import type { AdaptiveStage, CandidateQuestion, IssueCode, TrustedPassage } from "@/server/ai/types";
import { recordAudit } from "./audit";

type Actor = Pick<SessionUser, "id" | "role"> | null;

export const trialInput = z.object({
  conceptId: z.string().trim().min(1).max(64),
  stage: z.enum(["VERIFICATION", "SECOND_VERIFICATION", "REASSESSMENT"]).default("VERIFICATION"),
});

export type TrialOutcome =
  | { status: "VALID" | "REJECTED"; candidate: CandidateQuestion; validation: TrialValidation; passage: TrialPassage; meta: TrialMeta }
  | { status: "INSUFFICIENT_SOURCE"; reason: string; passage: TrialPassage; meta: TrialMeta }
  | { status: "MALFORMED" | "PROVIDER_ERROR"; reason: string; passage: TrialPassage; meta: TrialMeta };

export type TrialValidation = {
  valid: boolean;
  issues: IssueCode[];
  deterministicIssues: string[];
  modelIssues: string[];
  notes: string | null;
  reasons: string[];
  checks: Record<string, boolean> | null;
};
export type TrialPassage = Pick<TrustedPassage, "id" | "version" | "text" | "sourceTitle" | "sourceAuthor" | "sourceReference"> & { conceptTitle: string };
export type TrialMeta = { provider: string; generatorModel: string; validatorModel: string; isDevelopmentMock: boolean; generatorLatencyMs: number; validatorLatencyMs: number | null };

const meta = (provider: AIProvider, generator: CallMeta, validator: CallMeta | null): TrialMeta => ({
  provider: provider.name,
  generatorModel: generator.model,
  validatorModel: validator?.model ?? provider.validatorModel,
  isDevelopmentMock: provider.isDevelopmentMock,
  generatorLatencyMs: generator.latencyMs,
  validatorLatencyMs: validator?.latencyMs ?? null,
});

/**
 * Admin-only dry run of the real pipeline on ONE approved passage: generator → validator.
 * Nothing is persisted as a question, no session exists, and no learner's mastery is touched.
 * The passage is resolved here from the database (approved only) — never from client input.
 */
export async function generateTrialQuestion(db: PrismaClient, actor: Actor, raw: unknown, deps: { provider?: AIProvider } = {}): Promise<TrialOutcome> {
  assertAdmin(actor);
  const input = trialInput.parse(raw);
  const concept = await db.concept.findUnique({
    where: { id: input.conceptId },
    select: {
      id: true,
      title: true,
      lessonId: true,
      passages: {
        where: { approved: true },
        orderBy: { order: "asc" },
        take: 1,
        select: { id: true, version: true, text: true, sourceTitle: true, sourceAuthor: true, sourceReference: true },
      },
    },
  });
  if (!concept) throw new AppError("NOT_FOUND");
  const resolved = await resolveApprovedSource(db, { sessionId: "trial", lessonId: concept.lessonId, conceptId: concept.id });
  if (!resolved.ok) throw new AppError("INSUFFICIENT_SOURCE", "لا يوجد مقطع معتمد وسليم لهذا المفهوم؛ اعتمد نصه أولًا. لا يُستدعى الذكاء الاصطناعي على محتوى غير معتمد.");
  const passage = resolved.passage;

  const provider = deps.provider ?? getAIProvider();
  const trusted: TrustedPassage = passage;
  const shown: TrialPassage = { ...passage, conceptTitle: concept.title };
  const logBase = { sourcePassageId: passage.id, sourceVersion: passage.version, userId: actor.id };
  const stage = input.stage as AdaptiveStage;
  const timeoutMs = GENERATION_RULES.callTimeoutMs;

  const generation = await new QuestionGenerator(provider).generate(
    {
      lessonId: concept.lessonId,
      conceptId: concept.id,
      conceptTitle: concept.title,
      passage: trusted,
      stage,
      questionType: "MCQ",
      targetDifficulty: 2,
      previous: null,
      previousQuestions: [],
      previousRejections: [],
    },
    { timeoutMs },
  );

  const finish = async (outcome: TrialOutcome, summary: string): Promise<TrialOutcome> => {
    await recordAudit(db, actor, {
      action: "ai.trial_generation",
      entityType: "concept",
      entityId: concept.id,
      lessonId: concept.lessonId,
      summary,
      metadata: { status: outcome.status, passageId: passage.id, passageVersion: passage.version, provider: provider.name, stage },
    });
    return outcome;
  };
  const trialDetails = { trial: true, stage };

  if (generation.kind === "PROVIDER_ERROR") {
    await logAIInteraction(db, { type: "GENERATE", status: "PROVIDER_ERROR", meta: generation.meta, ...logBase, details: { ...trialDetails, errorCode: generation.error.code } });
    return finish(
      { status: "PROVIDER_ERROR", reason: `تعذّر الاتصال بمزوّد الذكاء الاصطناعي (${generation.error.code}).`, passage: shown, meta: meta(provider, generation.meta, null) },
      `توليد تجريبي لمفهوم «${concept.title}»: خطأ في المزوّد`,
    );
  }
  if (generation.kind === "INSUFFICIENT_SOURCE") {
    await logAIInteraction(db, { type: "GENERATE", status: "INSUFFICIENT_SOURCE", meta: generation.meta, ...logBase, raw: generation.raw, details: { ...trialDetails, reason: generation.reason } });
    return finish(
      { status: "INSUFFICIENT_SOURCE", reason: generation.reason, passage: shown, meta: meta(provider, generation.meta, null) },
      `توليد تجريبي لمفهوم «${concept.title}»: المصدر غير كافٍ`,
    );
  }
  if (generation.kind === "MALFORMED") {
    await logAIInteraction(db, { type: "GENERATE", status: "MALFORMED_OUTPUT", meta: generation.meta, ...logBase, raw: generation.raw, details: { ...trialDetails, error: generation.error } });
    return finish(
      { status: "MALFORMED", reason: "أعاد النموذج مخرجات غير مطابقة للصيغة المطلوبة.", passage: shown, meta: meta(provider, generation.meta, null) },
      `توليد تجريبي لمفهوم «${concept.title}»: مخرجات غير صالحة`,
    );
  }

  await logAIInteraction(db, { type: "GENERATE", status: "SUCCESS", meta: generation.meta, ...logBase, raw: generation.raw, details: trialDetails });
  const validation = await new QuestionValidator(provider).validate(
    { passage: trusted, conceptTitle: concept.title, candidate: generation.candidate, previousQuestions: [] },
    { timeoutMs },
  );

  if (validation.providerError) {
    await logAIInteraction(db, {
      type: "VALIDATE",
      status: "PROVIDER_ERROR",
      meta: validation.meta ?? generation.meta,
      ...logBase,
      details: { ...trialDetails, errorCode: validation.providerError.code },
    });
    return finish(
      { status: "PROVIDER_ERROR", reason: `تعذّر إكمال التدقيق (${validation.providerError.code}).`, passage: shown, meta: meta(provider, generation.meta, validation.meta) },
      `توليد تجريبي لمفهوم «${concept.title}»: خطأ في المدقق`,
    );
  }

  await logAIInteraction(db, {
    type: "VALIDATE",
    status: validation.valid ? "SUCCESS" : "REJECTED",
    meta: validation.meta ?? { provider: "deterministic", model: "server-checks", promptVersion: "checks.v2", latencyMs: 0 },
    ...logBase,
    raw: validation.raw,
    details: { ...trialDetails, issues: validation.issues, reasons: validation.result.reasons },
  });

  const result: TrialValidation = {
    valid: validation.valid,
    issues: validation.issues,
    deterministicIssues: validation.deterministicIssues,
    modelIssues: validation.modelIssues,
    notes: validation.result.reasons.join(" · ") || null,
    reasons: validation.result.reasons,
    checks: validation.result.modelChecks,
  };
  return finish(
    { status: validation.valid ? "VALID" : "REJECTED", candidate: generation.candidate, validation: result, passage: shown, meta: meta(provider, generation.meta, validation.meta) },
    `توليد تجريبي لمفهوم «${concept.title}»: ${validation.valid ? "سؤال مقبول من المدقق" : "سؤال مرفوض من المدقق"}`,
  );
}
