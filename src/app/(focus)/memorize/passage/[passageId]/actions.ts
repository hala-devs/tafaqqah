"use server";

import { prisma } from "@/server/db";
import { requireApiLearner } from "@/server/auth/current-user";
import { isAppError } from "@/server/errors";
import { hitRateLimit } from "@/server/rate-limit";
import { getMemorizationSessionUnits, type RevealedUnit } from "@/server/memorization/content";
import { submitRecitation } from "@/server/memorization/recitation";

/**
 * NOTE (privacy): neither action accepts or returns audio. The recording never leaves the browser; the only
 * thing submitted is the learner's per-unit self-assessment.
 */

export type RevealState = { ok: true; units: RevealedUnit[] } | { ok: false; error: string };

/** The approved canonical units of a passage — requested only after the learner finished reciting. */
export async function revealUnitsAction(input: unknown): Promise<RevealState> {
  try {
    await requireApiLearner();
    if (!input || typeof input !== "object") return { ok: false, error: "الأسطر المختارة غير صالحة." };
    const { passageId, startUnitId, count } = input as Record<string, unknown>;
    if (typeof passageId !== "string" || passageId.length > 100 || typeof startUnitId !== "string" || startUnitId.length > 100 || typeof count !== "number" || !Number.isInteger(count)) return { ok: false, error: "الأسطر المختارة غير صالحة." };
    const selectedUnitIds: string[] = [];
    if (typeof passageId !== "string" || passageId.length > 100) return { ok: false, error: "هذا المقطع غير متاح حاليًا." };
    if (!Array.isArray(selectedUnitIds) || selectedUnitIds.length > 100 || selectedUnitIds.some((id) => typeof id !== "string" || id.length > 100)) return { ok: false, error: "الأسطر المختارة غير صالحة." };
    const units = await getMemorizationSessionUnits(prisma, passageId, startUnitId, count);
    if (!units) return { ok: false, error: "هذا المقطع غير متاح حاليًا." };
    return { ok: true, units };
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.userMessage };
    console.error("[memorization] reveal failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "تعذّر عرض المتن الآن. حاول مرة أخرى." };
  }
}

export type SubmitState = { ok: true; attemptId: string } | { ok: false; error: string };

/** Saves the self-assessment. The user is the authenticated learner; score, mastery and schedule are computed on the server. */
export async function submitRecitationAction(input: unknown): Promise<SubmitState> {
  try {
    const user = await requireApiLearner();
    if (hitRateLimit(`recitation:${user.id}`, 60, 10 * 60_000)) {
      return { ok: false, error: "أرسلت تقييمات كثيرة في وقت قصير. خذ استراحة قصيرة ثم تابع." };
    }
    // This flow persists only the learner's structured self-assessment. It never sends recording data to an AI.
    const result = await submitRecitation(prisma, user.id, input, { provider: null });
    return { ok: true, attemptId: result.attemptId };
  } catch (error) {
    if (isAppError(error)) return { ok: false, error: error.userMessage };
    console.error("[memorization] submit failed", error instanceof Error ? error.message : error);
    return { ok: false, error: "تعذّر حفظ التسميع الآن. حاول مرة أخرى." };
  }
}
