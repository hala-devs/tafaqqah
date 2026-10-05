"use server";

import { prisma } from "@/server/db";
import { getAIProvider } from "@/server/ai/factory";
import { requireApiLearner } from "@/server/auth/current-user";
import { isAppError } from "@/server/errors";
import { hitRateLimit } from "@/server/rate-limit";
import { advanceCoach, respondExercise, revealExercise, type CoachView } from "@/server/memorization/reinforcement/coach-service";
import { finishReinforcement } from "@/server/memorization/reinforcement/service";

export type FinishState = { ok: true } | { ok: false; error: string };
export type CoachState = { ok: true; view: CoachView } | { ok: false; error: string };

const UNAVAILABLE = "جولة التثبيت غير متاحة.";
const validId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 100;

async function run(label: string, fn: (userId: string) => Promise<CoachView | null>): Promise<CoachState> {
  try {
    const user = await requireApiLearner();
    if (hitRateLimit(`reinforcement-coach:${user.id}`, 120, 10 * 60_000)) return { ok: false, error: "حاول مرة أخرى بعد قليل." };
    const view = await fn(user.id);
    return view ? { ok: true, view } : { ok: false, error: UNAVAILABLE };
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.userMessage };
    console.error(`[memorization] coach ${label} failed`, error instanceof Error ? error.message : error);
    return { ok: false, error: "تعذّر تجهيز التمرين الآن." };
  }
}

/** Returns the current exercise or decides the next one (≤ 1 provider call per decision; any failure → safe fallback). */
export async function advanceCoachAction(planId: unknown): Promise<CoachState> {
  if (!validId(planId)) return { ok: false, error: UNAVAILABLE };
  return run("advance", (userId) => advanceCoach(prisma, userId, planId, { provider: getAIProvider }));
}

/** Reveals the canonical answer of the current exercise. Hidden canonical text reaches the browser only here. */
export async function revealExerciseAction(planId: unknown, exerciseId: unknown): Promise<CoachState> {
  if (!validId(planId) || !validId(exerciseId)) return { ok: false, error: UNAVAILABLE };
  return run("reveal", (userId) => revealExercise(prisma, userId, planId, exerciseId));
}

/** Records the learner's self-report (RECALLED / PARTIAL / NOT_RECALLED) and moves to the next exercise. */
export async function respondExerciseAction(planId: unknown, exerciseId: unknown, response: unknown): Promise<CoachState> {
  if (!validId(planId) || !validId(exerciseId)) return { ok: false, error: UNAVAILABLE };
  return run("respond", (userId) => respondExercise(prisma, userId, planId, exerciseId, response, { provider: getAIProvider }));
}

/** Records that the learner finished (or ended) the session. Never touches mastery, score or the review schedule. */
export async function finishReinforcementAction(input: unknown): Promise<FinishState> {
  try {
    const user = await requireApiLearner();
    if (!input || typeof input !== "object") return { ok: false, error: UNAVAILABLE };
    const { planId, completed } = input as Record<string, unknown>;
    if (!validId(planId) || typeof completed !== "boolean") return { ok: false, error: UNAVAILABLE };
    await finishReinforcement(prisma, user.id, planId, { completed });
    return { ok: true };
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.userMessage };
    console.error("[memorization] finish reinforcement failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "تعذّر حفظ الجولة الآن." };
  }
}
