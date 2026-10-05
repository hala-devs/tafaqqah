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
