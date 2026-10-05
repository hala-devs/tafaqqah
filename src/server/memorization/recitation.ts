import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AIProvider } from "@/server/ai/provider";
import { AppError } from "@/server/errors";
import { recordLearningDay } from "@/server/learner/activity";
import { DEFAULT_TIMEZONE, isValidTimezone } from "@/lib/learning-time";
import { analyzeAttempt } from "./analysis";
import { getMemorizationSessionUnits, visiblePassageWhere } from "./content";
import { SELF_ASSESSMENTS, type SelfAssessment } from "./config";
import { stateFor, updateMastery, type MasterySnapshot } from "./mastery";
import { computeNextReview } from "./schedule";
import { linkFollowUpAttempt } from "./reinforcement/service";
import { scoreAttempt } from "./scoring";
import { tokenizeCanonicalMatn } from "@/lib/matn-tokens";
import { isAssessmentDetailShape, type AssessmentDetail } from "@/lib/recitation-detail";

/**
 * What the browser may send: WHICH passage, a client-generated attempt id (double-submit protection) and one
 * self-assessment per unit. It cannot send a score, counts, mastery, a review date, an analysis or any audio —
 * the schema is strict, so such fields are rejected, and the server recomputes everything authoritative.
 */
export const recitationInputSchema = z
  .object({
    passageId: z.string().trim().min(1).max(100),
    clientAttemptId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,64}$/, "invalid attempt id"),
    startedAt: z.coerce.date().optional(),
    /** Optional: this attempt is the re-recitation after a reinforcement plan (before/after linkage only). */
    reinforcementPlanId: z.string().trim().min(1).max(100).optional(),
    results: z
      .array(
        z
          .object({
            unitId: z.string().trim().min(1).max(100),
            status: z.enum(SELF_ASSESSMENTS as unknown as [SelfAssessment, ...SelfAssessment[]]),
            scope: z.enum(["WORDS", "FULL_UNIT"]).nullable().optional(),
            wordIndexes: z.array(z.number()).max(500).optional(),
            forgottenWordIndexes: z.array(z.number()).max(500).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export type RecitationInput = z.infer<typeof recitationInputSchema>;

export type SubmitDeps = {
  now?: Date;
  /** The AI provider (or a factory that may throw when AI is not configured). Null/omitted → no analysis (fallback). */
  provider?: AIProvider | (() => AIProvider) | null;
  analysisTimeoutMs?: number;
};

export type SubmitResult = { attemptId: string; created: boolean; analysisStatus: "ANALYZED" | "FALLBACK" | null };

const bad = (message: string) => new AppError("BAD_REQUEST", message);

/**
 * Saves a completed recitation for the AUTHENTICATED learner.
 *
 *  1. validates ownership/visibility: the passage and all its units must be approved (checked again inside the transaction);
 *  2. requires exactly one result per unit — no missing, duplicate or foreign unit;
 *  3. computes counts, score, mastery and the next review date on the server;
 *  4. is idempotent per (user, clientAttemptId): a double click returns the same attempt;
 *  5. records the learning day (a completed recitation is real learning; opening a passage never is);
 *  6. only THEN asks AI for an optional analysis. Failure there never affects steps 1–5.
 */
export async function submitRecitation(db: PrismaClient, userId: string, raw: unknown, deps: SubmitDeps = {}): Promise<SubmitResult> {
  const parsed = recitationInputSchema.safeParse(raw);
  if (!parsed.success) throw bad("تعذّر حفظ التسميع: بيانات التقييم غير صالحة.");
  const input = parsed.data;
  const now = deps.now ?? new Date();

  const existing = await db.recitationAttempt.findUnique({ where: { userId_clientAttemptId: { userId, clientAttemptId: input.clientAttemptId } } });
  if (existing) {
    if (existing.passageId !== input.passageId) throw bad("تعذّر حفظ التسميع: بيانات التقييم غير صالحة.");
    return { attemptId: existing.id, created: false, analysisStatus: existing.analysisStatus };
  }

  const settings = await db.learnerSettings.findUnique({ where: { userId }, select: { timezone: true } });
  const timezone = settings && isValidTimezone(settings.timezone) ? settings.timezone : DEFAULT_TIMEZONE;

  let saved: { attemptId: string; schedule: { rule: string; repeatedWeakness: boolean } } | null = null;
  for (let tries = 0; tries < 3 && !saved; tries++) {
    try {
      saved = await db.$transaction((tx) => saveAttempt(tx as unknown as PrismaClient, userId, input, now, timezone), { isolationLevel: "Serializable" });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "P2002") {
        // The same attempt id (double click) or a concurrent first attempt: return the stored attempt if there is one.
        const again = await db.recitationAttempt.findUnique({ where: { userId_clientAttemptId: { userId, clientAttemptId: input.clientAttemptId } } });
        if (again) return { attemptId: again.id, created: false, analysisStatus: again.analysisStatus };
      } else if (code !== "P2034") {
        throw error;
      }
      // P2034 (serialization conflict) or a lost first-attempt race: retry.
    }
  }
  if (!saved) throw new AppError("BUSY", "تعذّر حفظ التسميع الآن. حاول مرة أخرى.");

  await recordLearningDay(db, userId, now);

  const outcome = await analyzeAttempt(db, { attemptId: saved.attemptId, userId, schedule: saved.schedule, provider: deps.provider, timeoutMs: deps.analysisTimeoutMs });
  return { attemptId: saved.attemptId, created: true, analysisStatus: outcome.status };
}

async function saveAttempt(tx: PrismaClient, userId: string, input: RecitationInput, now: Date, timezone: string) {
  const passage = await tx.matnPassage.findFirst({
    where: { id: input.passageId, ...visiblePassageWhere },
    select: { id: true },
  });
  if (!passage) throw new AppError("NOT_FOUND", "هذا المقطع غير متاح حاليًا.");

  const submitted = input.results.map((r) => r.unitId);
  if (new Set(submitted).size !== submitted.length) throw bad("تعذّر حفظ التسميع: يوجد تقييم مكرر لأحد الأجزاء.");
  const selectedUnits = await getMemorizationSessionUnits(tx, passage.id, submitted[0] ?? "", submitted.length);
  if (!selectedUnits || selectedUnits.length !== submitted.length || selectedUnits.some((unit, index) => unit.id !== submitted[index])) throw bad("اختر أسطرًا متتالية من هذا المتن قبل حفظ التسميع.");

  const detailByUnit = new Map(
    input.results.map((result) => {
      // Omitted detail is accepted only for historical/browser compatibility and remains explicitly legacy.
      const detail: AssessmentDetail = { status: result.status, scope: result.scope ?? null, wordIndexes: result.wordIndexes ?? [], forgottenWordIndexes: result.forgottenWordIndexes ?? [] };
      validateAssessmentDetail(detail, tokenizeCanonicalMatn(selectedUnits.find((unit) => unit.id === result.unitId)?.text ?? "").length, result.scope === undefined && result.wordIndexes === undefined && result.forgottenWordIndexes === undefined);
      return [result.unitId, detail] as const;
    }),
  );
  const statusByUnit = new Map<string, SelfAssessment>([...detailByUnit].map(([unitId, detail]) => [unitId, detail.status]));
  const score = scoreAttempt(selectedUnits.map((u) => statusByUnit.get(u.id)!));

  const previous = await tx.memorizationMastery.findUnique({ where: { userId_passageId: { userId, passageId: passage.id } } });
  const lastAttempt = await tx.recitationAttempt.findFirst({
    where: { userId, passageId: passage.id },
    orderBy: { completedAt: "desc" },
    include: { results: { select: { unitId: true, selfAssessmentStatus: true } } },
  });
  const previousNonCorrect = new Set((lastAttempt?.results ?? []).filter((r) => r.selfAssessmentStatus !== "CORRECT").map((r) => r.unitId));
  const repeatedWeakUnits = selectedUnits.filter((u) => statusByUnit.get(u.id) !== "CORRECT" && previousNonCorrect.has(u.id)).length;
  const wasDue = Boolean(previous && previous.nextReviewAt.getTime() <= now.getTime());

  const snapshot: MasterySnapshot | null = previous
    ? {
        masteryScore: previous.masteryScore,
        attempts: previous.attempts,
        reviewCount: previous.reviewCount,
        consecutiveCorrect: previous.consecutiveCorrect,
        consecutiveWeak: previous.consecutiveWeak,
        errorCount: previous.errorCount,
        forgottenCount: previous.forgottenCount,
      }
    : null;
  const mastery = updateMastery({ previous: snapshot, attempt: score, repeatedWeakUnits, wasDue });
  const repeatedWeakness = repeatedWeakUnits > 0 || mastery.consecutiveWeak >= 2;
  const schedule = computeNextReview({
    now,
    timezone,
    forgottenUnits: score.forgottenUnits,
    incorrectUnits: score.incorrectUnits,
    consecutiveCorrect: mastery.consecutiveCorrect,
    repeatedWeakness,
  });

  const attempt = await tx.recitationAttempt.create({
    data: {
      userId,
      passageId: passage.id,
      clientAttemptId: input.clientAttemptId,
      kind: wasDue ? "REVIEW" : "PRACTICE",
      totalUnits: score.totalUnits,
      correctUnits: score.correctUnits,
      incorrectUnits: score.incorrectUnits,
      forgottenUnits: score.forgottenUnits,
      scorePercentage: score.scorePercentage,
      startedAt: input.startedAt && input.startedAt.getTime() <= now.getTime() ? input.startedAt : null,
      completedAt: now,
      masteryBefore: previous?.masteryScore ?? null,
      masteryAfter: mastery.masteryScore,
      stateAfter: mastery.state,
      nextReviewAt: schedule.nextReviewAt,
      results: {
        create: selectedUnits.map((u) => {
          const detail = detailByUnit.get(u.id)!;
          return { unitId: u.id, selfAssessmentStatus: detail.status, selfAssessmentScope: detail.scope, wordIndexes: detail.wordIndexes, forgottenWordIndexes: detail.forgottenWordIndexes };
        }),
      },
    },
  });

  // Before/after linkage only — it never changes counts, score, mastery or the schedule computed above.
  if (input.reinforcementPlanId) await linkFollowUpAttempt(tx, userId, input.reinforcementPlanId, attempt.id, selectedUnits.map((u) => u.id));

  // Credit only first-time NEW units. A due review is excluded, and the unique (userId, unitId)
  // constraint makes retries/concurrent submits unable to inflate the learner's optional goal.
  if (!wasDue) {
    await tx.memorizationGoalCredit.createMany({
      data: selectedUnits.map((unit) => ({ userId, unitId: unit.id, attemptId: attempt.id, createdAt: now })),
      skipDuplicates: true,
    });
  }

  const masteryData = {
    masteryScore: mastery.masteryScore,
    state: stateFor(mastery.masteryScore, mastery.consecutiveCorrect),
    attempts: mastery.attempts,
    reviewCount: mastery.reviewCount,
    consecutiveCorrect: mastery.consecutiveCorrect,
    consecutiveWeak: mastery.consecutiveWeak,
    errorCount: mastery.errorCount,
    forgottenCount: mastery.forgottenCount,
    lastScore: mastery.lastScore,
    lastReviewedAt: now,
    nextReviewAt: schedule.nextReviewAt,
  };
  if (previous) await tx.memorizationMastery.update({ where: { id: previous.id }, data: masteryData });
  else await tx.memorizationMastery.create({ data: { userId, passageId: passage.id, ...masteryData } });

  return { attemptId: attempt.id, schedule: { rule: schedule.rule, repeatedWeakness } };
}

/** Validates browser detail against the token count of the database's approved canonical text. */
export function validateAssessmentDetail(detail: AssessmentDetail, tokenCount: number, allowLegacy = false): void {
  const legacy = detail.status !== "CORRECT" && detail.scope === null && detail.wordIndexes.length === 0 && (detail.forgottenWordIndexes?.length ?? 0) === 0;
  if (!(allowLegacy && legacy) && !isAssessmentDetailShape(detail)) throw bad("تعذّر حفظ التسميع: تفاصيل التقييم غير صالحة.");
  if (!Number.isInteger(tokenCount) || tokenCount < 1) throw bad("تعذّر حفظ التسميع: نص المتن المعتمد غير صالح.");
  const indexes = [...detail.wordIndexes, ...(detail.forgottenWordIndexes ?? [])];
  if (new Set(indexes).size !== indexes.length || indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= tokenCount)) {
    throw bad("تعذّر حفظ التسميع: مواضع الكلمات غير صالحة.");
  }
}
