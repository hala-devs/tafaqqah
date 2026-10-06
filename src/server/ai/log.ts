import type { PrismaClient } from "@/generated/prisma/client";
import type { AIInteractionStatus, AIInteractionType } from "@/generated/prisma/enums";
import type { CallMeta } from "./question-generator";

const MAX_RAW_CHARS = 8000;

function boundedJson(value: unknown): unknown {
  if (value == null) return null;
  const text = JSON.stringify(value);
  return text.length > MAX_RAW_CHARS ? { truncated: true, preview: text.slice(0, MAX_RAW_CHARS) } : value;
}

/** Structured, admin-only trace of every AI call. Never contains secrets or prompts with keys. */
export async function logAIInteraction(
  db: PrismaClient,
  entry: {
    type: AIInteractionType;
    status: AIInteractionStatus;
    meta: CallMeta;
    sourcePassageId?: string;
    sourceVersion?: number;
    sessionId?: string;
    userId?: string;
    questionId?: string;
    details?: Record<string, unknown>;
    raw?: unknown;
  },
): Promise<void> {
  try {
    await db.aIInteractionLog.create({
      data: {
        type: entry.type,
        status: entry.status,
        provider: entry.meta.provider,
        model: entry.meta.model,
        promptVersion: entry.meta.promptVersion,
        latencyMs: entry.meta.latencyMs,
        sourcePassageId: entry.sourcePassageId,
        sourceVersion: entry.sourceVersion,
        sessionId: entry.sessionId,
        userId: entry.userId,
        questionId: entry.questionId,
        metadata: JSON.parse(
          JSON.stringify({
            ...entry.details,
            stopReason: entry.meta.stopReason ?? null,
            usage: entry.meta.usage ?? null,
            raw: boundedJson(entry.raw),
          }),
        ),
      },
    });
  } catch (error) {
    // Logging must never break the learner's flow.
    console.error("[ai-log] failed to write interaction log", error instanceof Error ? error.message : error);
  }
}

/**
 * Request-level tracking for runtime question generation: one row is created as soon as a request reaches the engine
 * (status STARTED) and updated with its final outcome, so a request that ends before any model call — rate limit,
 * provider not configured, a crash — still leaves a trace. Status, error category, ids and timings only — never
 * prompts or model reasoning. Never breaks the learner's flow.
 */
export type GenerationRequestOutcome = {
  status: Extract<AIInteractionStatus, "SUCCESS" | "REJECTED" | "INSUFFICIENT_SOURCE" | "PROVIDER_ERROR" | "FAILED">;
  questionId?: string;
  errorCode?: string;
  details?: Record<string, unknown>;
};

export async function startGenerationRequest(
  db: PrismaClient,
  entry: { sessionId: string; userId: string; stage: string; conceptId: string; previousQuestionId: string | null },
): Promise<{ id: string; startedAt: number } | null> {
  try {
    const row = await db.aIInteractionLog.create({
      data: {
        type: "GENERATION_REQUEST",
        status: "STARTED",
        provider: "server",
        model: "request",
        promptVersion: "request.v1",
        sessionId: entry.sessionId,
        userId: entry.userId,
        metadata: { stage: entry.stage, conceptId: entry.conceptId, previousQuestionId: entry.previousQuestionId },
      },
      select: { id: true },
    });
    return { id: row.id, startedAt: Date.now() };
  } catch (error) {
    console.error("[ai-log] failed to start generation request", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function finishGenerationRequest(db: PrismaClient, request: { id: string; startedAt: number } | null, outcome: GenerationRequestOutcome): Promise<void> {
  if (!request) return;
  try {
    const row = await db.aIInteractionLog.findUnique({ where: { id: request.id }, select: { metadata: true } });
    await db.aIInteractionLog.update({
      where: { id: request.id },
      data: {
        status: outcome.status,
        questionId: outcome.questionId,
        metadata: JSON.parse(
          JSON.stringify({
            ...((row?.metadata as Record<string, unknown> | null) ?? {}),
            ...outcome.details,
            errorCode: outcome.errorCode ?? null,
            elapsedMs: Date.now() - request.startedAt,
            finishedAt: new Date().toISOString(),
          }),
        ),
      },
    });
  } catch (error) {
    console.error("[ai-log] failed to finish generation request", error instanceof Error ? error.message : error);
  }
}
