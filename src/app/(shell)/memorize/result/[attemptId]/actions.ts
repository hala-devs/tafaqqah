"use server";

import { prisma } from "@/server/db";
import { getAIProvider } from "@/server/ai/factory";
import { requireApiLearner } from "@/server/auth/current-user";
import { isAppError } from "@/server/errors";
import { hitRateLimit } from "@/server/rate-limit";
import { ensureReinforcementPlan, type EnsurePlanResult } from "@/server/memorization/reinforcement/service";

export type PlanState = { ok: true; result: EnsurePlanResult } | { ok: false; error: string };

/**
 * Builds (once) or returns the immediate reinforcement plan of the learner's own attempt. Idempotent: a refresh or a
 * second tab reuses the stored plan; the provider is called at most once per attempt and only when the deterministic
 * necessity check finds a real decision to make. Any provider problem silently becomes the deterministic plan.
 */
export async function ensurePlanAction(attemptId: unknown): Promise<PlanState> {
  try {
    const user = await requireApiLearner();
    if (typeof attemptId !== "string" || attemptId.length === 0 || attemptId.length > 100) return { ok: false, error: "هذه النتيجة غير متاحة." };
    if (hitRateLimit(`reinforcement-plan:${user.id}`, 60, 10 * 60_000)) return { ok: false, error: "حاول مرة أخرى بعد قليل." };
    const result = await ensureReinforcementPlan(prisma, user.id, attemptId, { provider: getAIProvider });
    return { ok: true, result };
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.userMessage };
    console.error("[memorization] reinforcement plan failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "تعذّر تجهيز المراجعة الآن." };
  }
}
