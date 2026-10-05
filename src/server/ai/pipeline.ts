import { randomInt, randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { QuestionStage } from "@/generated/prisma/enums";
import { GENERATION_RULES } from "@/server/assessment/config";
import { appErrorForProviderError, failureKindForProviderError, failureKindForRejections, type AIFailureKind } from "./failures";
import { logAIInteraction } from "./log";
import type { AIProvider, AIProviderError } from "./provider";
import { QuestionGenerator } from "./question-generator";
import { QuestionValidator } from "./question-validator";
import { resolveApprovedSource, sourceStillApproved, type SourceFailure } from "./source";
import type { AdaptiveStage, CandidateQuestion, Difficulty, IssueCode, PreviousQuestionContext } from "./types";

/**
 *  Wrong answer / review (engine) → concept (engine) → APPROVED passage (resolved here, server-side)
 *  → QuestionGenerator → evidence + deterministic checks → independent QuestionValidator
 *  → PASS? store & return : regenerate (≤ maxAttempts) → otherwise fail closed.
 *
 * Every candidate — accepted or rejected — is persisted with its full trace so any question
 * can be audited back to lesson, concept, passage + version, prompt versions and models.
 * A rejected candidate is never shown to the learner.
 */
export type PipelineInput = {
  db: PrismaClient;
  provider: AIProvider;
  userId: string;
  sessionId: string;
  lessonId: string;
  concept: { id: string; title: string };
  stage: AdaptiveStage;
  /** Medium by default. */
  targetDifficulty?: Difficulty;
  /** The question the learner has just answered (context only). */
  previous: (PreviousQuestionContext & { id: string }) | null;
  /** Every question already shown or banked for this concept in any form. */
  previousQuestions: string[];
  /** The correct answer of each entry of `previousQuestions` (same index; "" when unknown). */
  previousAnswers?: string[];
  /** The approved baseline questions of the concept. */
  baselineQuestions?: string[];
  /** Extra non-sensitive trace data stored with each candidate. */
  trace?: Record<string, unknown>;
};

export type PipelineResult =
  | { kind: "VALID"; questionId: string }
  | { kind: "INSUFFICIENT_SOURCE"; reason: string }
  | { kind: "SOURCE_NOT_APPROVED"; failure: SourceFailure | "CHANGED_DURING_GENERATION"; reason: string }
  | { kind: "FAILED"; attempts: number; lastIssues: IssueCode[]; reason: "ATTEMPTS_EXHAUSTED" | "TIME_BUDGET"; failureKind: AIFailureKind };

function shuffleOptions(candidate: CandidateQuestion): { options: string[]; correctIndex: number } {
  const options = [...candidate.options];
  for (let i = options.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { options, correctIndex: options.findIndex((o) => o.trim() === candidate.correctAnswer.trim()) };
}

/** Errors that are worth another attempt (within the time budget) rather than failing now. */
function isRetryable(error: AIProviderError): boolean {
  return (
    error.code === "REFUSAL" ||
    error.code === "TRUNCATED" ||
    error.code === "BAD_RESPONSE" ||
    error.code === "UNAVAILABLE" ||
    error.code === "TIMEOUT" ||
    error.code === "RATE_LIMITED"
  );
}

/**
 * Gemini quota errors are transient, but immediate retries only consume the remaining
 * request window. Pause inside the existing per-question budget before another attempt.
 */
async function waitBeforeRetry(attempt: number, remainingMs: number): Promise<void> {
  // Tests exercise the retry path without real waiting (same convention as the mock provider).
  if (process.env.NODE_ENV === "test") return;
  const delay = Math.min(attempt * 20_000, Math.max(0, remainingMs - GENERATION_RULES.minCallMs));
  if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay));
}

export async function produceValidatedQuestion(input: PipelineInput): Promise<PipelineResult> {
  const { db, provider } = input;

  // The server — never the browser — decides which approved passage the question is built from.
  const source = await resolveApprovedSource(db, { sessionId: input.sessionId, lessonId: input.lessonId, conceptId: input.concept.id });
  if (!source.ok) {
    await logAIInteraction(db, {
      type: "GENERATE",
      status: "REJECTED",
      meta: { provider: "server", model: "source-check", promptVersion: "source.v1", latencyMs: 0 },
      sessionId: input.sessionId,
      userId: input.userId,
      details: { failureKind: "SOURCE_NOT_APPROVED" satisfies AIFailureKind, sourceFailure: source.failure, detail: source.detail, conceptId: input.concept.id, modelCalled: false },
    });
    return { kind: "SOURCE_NOT_APPROVED", failure: source.failure, reason: source.detail };
  }
  const { passage, textHash } = source;

  const generator = new QuestionGenerator(provider);
  const validator = new QuestionValidator(provider);
  const logBase = { sourcePassageId: passage.id, sourceVersion: passage.version, sessionId: input.sessionId, userId: input.userId };
  const difficulty = input.targetDifficulty ?? 2;
  const stage = input.stage as QuestionStage;
  let previousRejections: IssueCode[] = [];
  let rejectionNotes: string[] = [];
  const startedAt = Date.now();
  let attemptsMade = 0;
  let lastProviderError: AIProviderError | null = null;
  const remaining = () => GENERATION_RULES.budgetMs - (Date.now() - startedAt);
  const callTimeout = () => Math.min(GENERATION_RULES.callTimeoutMs, remaining());

  const providerFailure: (error: AIProviderError) => never = (error) => {
    throw appErrorForProviderError(error);
  };

  for (let attempt = 1; attempt <= GENERATION_RULES.maxAttempts; attempt++) {
    // Fail closed rather than keep the learner waiting: no new attempt after the budget.
    if (remaining() < GENERATION_RULES.minCallMs) {
      if (lastProviderError) providerFailure(lastProviderError);
      return { kind: "FAILED", attempts: attemptsMade, lastIssues: previousRejections, reason: "TIME_BUDGET", failureKind: failureKindForRejections(previousRejections) };
    }
    attemptsMade = attempt;
    const traceId = randomUUID();
    const generation = await generator.generate(
      {
        lessonId: input.lessonId,
        conceptId: input.concept.id,
        conceptTitle: input.concept.title,
        passage,
        stage: input.stage,
        questionType: "MCQ",
        targetDifficulty: difficulty,
        previous: input.previous ? { ...input.previous } : null,
        previousQuestions: input.previousQuestions,
        previousAnswers: input.previousAnswers,
        previousRejections,
        rejectionNotes,
      },
      { timeoutMs: callTimeout() },
    );

    if (generation.kind === "PROVIDER_ERROR") {
      await logAIInteraction(db, {
        type: "GENERATE",
        status: "PROVIDER_ERROR",
        meta: generation.meta,
        ...logBase,
        details: { traceId, attempt, stage, errorCode: generation.error.code, failureKind: failureKindForProviderError(generation.error) },
      });
      if (isRetryable(generation.error)) {
        lastProviderError = generation.error;
        await waitBeforeRetry(attempt, remaining());
        continue;
      }
      providerFailure(generation.error);
    }
    lastProviderError = null;

    if (generation.kind === "INSUFFICIENT_SOURCE") {
      await logAIInteraction(db, {
        type: "GENERATE",
        status: "INSUFFICIENT_SOURCE",
        meta: generation.meta,
        ...logBase,
        raw: generation.raw,
        details: { traceId, attempt, stage, reason: generation.reason, failureKind: "INSUFFICIENT_SOURCE" satisfies AIFailureKind },
      });
      return { kind: "INSUFFICIENT_SOURCE", reason: generation.reason };
    }

    if (generation.kind === "MALFORMED") {
      await logAIInteraction(db, {
        type: "GENERATE",
        status: "MALFORMED_OUTPUT",
        meta: generation.meta,
        ...logBase,
        raw: generation.raw,
        details: { traceId, attempt, stage, error: generation.error, failureKind: "VALIDATOR_REJECTED" satisfies AIFailureKind },
      });
      previousRejections = ["SCHEMA_INVALID"];
      continue;
    }

    await logAIInteraction(db, {
      type: "GENERATE",
      status: "SUCCESS",
      meta: generation.meta,
      ...logBase,
      raw: generation.raw,
      details: { traceId, attempt, stage },
    });

    const candidate = generation.candidate;
    if (remaining() < GENERATION_RULES.minCallMs) {
      return { kind: "FAILED", attempts: attemptsMade, lastIssues: previousRejections, reason: "TIME_BUDGET", failureKind: failureKindForRejections(previousRejections) };
    }
    const validationInput = {
      passage,
      conceptTitle: input.concept.title,
      candidate,
      previousQuestions: input.previousQuestions,
      previousAnswers: input.previousAnswers,
      baselineQuestions: input.baselineQuestions,
    };
    let validation = await validator.validate(validationInput, { timeoutMs: callTimeout() });

    if (validation.providerError) {
      await logAIInteraction(db, {
        type: "VALIDATE",
        status: "PROVIDER_ERROR",
        meta: validation.meta ?? generation.meta,
        ...logBase,
        details: { traceId, attempt, stage, errorCode: validation.providerError.code, failureKind: failureKindForProviderError(validation.providerError) },
      });
      if (isRetryable(validation.providerError)) {
        lastProviderError = validation.providerError;
        await waitBeforeRetry(attempt, remaining());
        // Keep the already-generated candidate and retry only the independent review.
        // Regenerating here turns one transient validator outage into extra generation
        // traffic, which can itself exhaust Gemini's request window.
        validation = await validator.validate(validationInput, { timeoutMs: callTimeout() });
        if (!validation.providerError) {
          lastProviderError = null;
        } else {
          await logAIInteraction(db, {
            type: "VALIDATE",
            status: "PROVIDER_ERROR",
            meta: validation.meta ?? generation.meta,
            ...logBase,
            details: { traceId, attempt, stage, retry: 1, errorCode: validation.providerError.code, failureKind: failureKindForProviderError(validation.providerError) },
          });
        }
      }
      if (validation.providerError) {
        if (isRetryable(validation.providerError)) {
          lastProviderError = validation.providerError;
          await waitBeforeRetry(attempt, remaining());
          continue;
        }
        providerFailure(validation.providerError);
      }
    }

    // Re-check that the source did not change while the model was working.
    const stillApproved = validation.valid ? await sourceStillApproved(db, passage, textHash) : true;
    const valid = validation.valid && stillApproved;
    const issues: IssueCode[] = stillApproved ? validation.issues : [...validation.issues, "VALIDATOR_INCONSISTENT"];

    const { options, correctIndex } = valid
      ? shuffleOptions(candidate)
      : { options: candidate.options, correctIndex: candidate.options.findIndex((o) => o.trim() === candidate.correctAnswer.trim()) };

    const stored = await db.generatedQuestion.create({
      data: {
        sessionId: input.sessionId,
        lessonId: input.lessonId,
        conceptId: input.concept.id,
        sourcePassageId: passage.id,
        sourceVersion: passage.version,
        sourceSnapshot: passage.text,
        origin: "AI_GENERATED",
        stage,
        previousQuestionId: input.previous?.id || null,
        studentPreviousAnswer: input.previous?.studentAnswer ?? null,
        questionType: "MCQ",
        question: candidate.question,
        options,
        correctIndex,
        correctAnswer: candidate.correctAnswer,
        explanation: candidate.explanation,
        answerEvidence: candidate.answerEvidence,
        explanationEvidence: candidate.explanationEvidence,
        difficulty,
        validationStatus: valid ? "VALID" : "REJECTED",
        validationIssues: issues,
        model: generation.meta.model,
        promptVersion: generation.meta.promptVersion,
        retryCount: attempt - 1,
        generatorRaw: JSON.parse(JSON.stringify(generation.raw ?? null)),
        validatorResult: JSON.parse(JSON.stringify({ ...validation.result, sourceStillApproved: stillApproved })),
        generatorMetadata: JSON.parse(
          JSON.stringify({
            traceId,
            attempt,
            stage,
            provider: generation.meta.provider,
            isDevelopmentMock: provider.isDevelopmentMock,
            generator: { model: generation.meta.model, promptVersion: generation.meta.promptVersion, latencyMs: generation.meta.latencyMs },
            validator: validation.meta
              ? { model: validation.meta.model, promptVersion: validation.meta.promptVersion, latencyMs: validation.meta.latencyMs }
              : { skipped: "deterministic checks failed" },
            deterministicIssues: validation.deterministicIssues,
            modelIssues: validation.modelIssues,
            supportedOptionIndices: validation.supportedOptionIndices,
            validatorReasons: validation.result.reasons,
            sourceTextHash: textHash,
            correctOptionIdBeforeShuffle: candidate.correctOptionId,
            elapsedMs: Date.now() - startedAt,
            ...input.trace,
          }),
        ),
      },
      select: { id: true },
    });

    if (validation.meta) {
      await logAIInteraction(db, {
        type: "VALIDATE",
        status: valid ? "SUCCESS" : "REJECTED",
        meta: validation.meta,
        ...logBase,
        questionId: stored.id,
        raw: validation.raw,
        details: { traceId, attempt, stage, issues, reasons: validation.result.reasons, failureKind: valid ? null : failureKindForRejections(issues) },
      });
    } else {
      await logAIInteraction(db, {
        type: "VALIDATE",
        status: "REJECTED",
        meta: { provider: "deterministic", model: "server-checks", promptVersion: "checks.v2", latencyMs: 0 },
        ...logBase,
        questionId: stored.id,
        details: { traceId, attempt, stage, issues, failureKind: failureKindForRejections(issues) },
      });
    }

    if (valid) return { kind: "VALID", questionId: stored.id };
    if (!stillApproved) {
      return { kind: "SOURCE_NOT_APPROVED", failure: "CHANGED_DURING_GENERATION", reason: "The passage changed while the question was being generated." };
    }
    previousRejections = issues;
    rejectionNotes = validation.result.reasons.filter((r) => !r.startsWith("Rejected by deterministic"));
  }

  // Every attempt failed because the provider was unreachable → report it as unavailable.
  if (lastProviderError && previousRejections.length === 0) providerFailure(lastProviderError);
  return { kind: "FAILED", attempts: attemptsMade, lastIssues: previousRejections, reason: "ATTEMPTS_EXHAUSTED", failureKind: failureKindForRejections(previousRejections) };
}
