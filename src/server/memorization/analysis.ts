import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { logAIInteraction } from "@/server/ai/log";
import type { CallMeta } from "@/server/ai/question-generator";
import { AIProviderError, type AIProvider } from "@/server/ai/provider";
import { ANALYSIS_HISTORY, ANALYSIS_TIMEOUT_MS, MIN_PREVIOUS_ATTEMPTS_FOR_TREND, type SelfAssessment } from "./config";

/**
 * AI performance analysis of a memorization attempt.
 *
 *  - The model receives ONLY structured history the learner entered (per-unit self-assessment outcomes, scores, mastery
 *    trajectory, the deterministic schedule). It never receives audio, canonical Matn text, names, emails or real ids.
 *  - It returns observations only. It cannot set a status, score, mastery or review date: the output schema has no such
 *    fields, unknown keys are rejected, and the application stored the authoritative result BEFORE calling it.
 *  - Output is validated (schema, unit references, no trend claim without history, no rulings, no HTML). Anything that
 *    fails is discarded and the learner sees the deterministic result with an explicit fallback message.
 */

export const ANALYSIS_PROMPT_VERSION = "memorization-analysis-v1";

export const ANALYSIS_SYSTEM_PROMPT = `You write a short, calm performance observation, in Modern Standard Arabic, for a learner who is memorizing a classical text (a Matn).

You receive ONLY structured data that the learner produced: for each numbered unit of the passage, the learner's own self-assessment outcomes (CORRECT / INCORRECT / FORGOTTEN), scores of recent attempts, a mastery trajectory and the review schedule the application already decided. You never hear audio and you never see the text itself.

Hard rules:
- Describe patterns in the supplied data only. Do not invent attempts, units, numbers or dates.
- Do NOT say whether the learner "recited correctly": the outcomes are the learner's own judgement. Never say that anything was verified, corrected or checked by you.
- Do NOT change or restate any score, mastery state or review date, and do not propose different ones.
- Do NOT claim a trend (improving, declining, repeated, recovered) unless "historyAttempts" is at least ${MIN_PREVIOUS_ATTEMPTS_FOR_TREND} and the data shows it. For a first attempt ("historyAttempts" = 0) describe only the current attempt, and set "progressObservation" to an empty string.
- Refer to a unit only by its supplied unitId (e.g. "u4") inside "priorities"; in prose call it «الجزء ٤».
- No religious rulings, no fiqh content, no comparison of schools, no certainty claims, no medical or scientific claims.
- Tone: calm, encouraging, concrete. No exclamation marks, no emoji, no praise inflation.
- Output exactly the requested JSON. "summary": 1–2 sentences. "patterns": 0–3 short sentences. "priorities": up to 3 entries, only units that appear in "weakUnits". "progressObservation": one sentence, or an empty string when history does not support one.`;

export function buildAnalysisUserPrompt(payload: Record<string, unknown>): string {
  return `Structured performance data (JSON):\n${JSON.stringify(payload)}\n\nWrite the observation as JSON in Arabic.`;
}

// ───────────────────────────── Payload ─────────────────────────────

export type PerformancePayload = {
  passage: { unitCount: number };
  /** Number of earlier attempts of this passage (the current one excluded). */
  historyAttempts: number;
  currentAttempt: { kind: "PRACTICE" | "REVIEW"; score: number; correct: number; incorrect: number; forgotten: number; total: number };
  weakUnits: { unitId: string; currentStatus: SelfAssessment; previousOutcomes: SelfAssessment[] }[];
  recentAttempts: { kind: "PRACTICE" | "REVIEW"; score: number; correct: number; incorrect: number; forgotten: number; daysAgo: number }[];
  masteryTrajectory: { score: number; state: string }[];
  reviewHistory: { reviewsCompleted: number; lastReviewDaysAgo: number | null };
  deterministicSchedule: { rule: string; repeatedWeakness: boolean; nextReviewInHours: number; masteryScore: number; masteryState: string };
};

const DAY_MS = 86_400_000;

/** Pseudonymous unit id used with the model («u4» = the passage's 4th unit). Mapped back to the real unit by order. */
export const unitRef = (order: number) => `u${order}`;

export async function buildPerformancePayload(db: PrismaClient, attemptId: string, schedule: { rule: string; repeatedWeakness: boolean }): Promise<PerformancePayload> {
  const attempt = await db.recitationAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { results: { include: { unit: { select: { order: true } } } } },
  });
  const previous = await db.recitationAttempt.findMany({
    where: { userId: attempt.userId, passageId: attempt.passageId, completedAt: { lt: attempt.completedAt } },
    orderBy: { completedAt: "asc" },
    include: { results: { include: { unit: { select: { order: true } } } } },
  });
  const recent = previous.slice(-ANALYSIS_HISTORY.recentAttempts);
  const reviewsCompleted = await db.recitationAttempt.count({ where: { userId: attempt.userId, passageId: attempt.passageId, kind: "REVIEW", completedAt: { lte: attempt.completedAt } } });
  const lastReview = [...previous].reverse().find((a) => a.kind === "REVIEW") ?? null;

  const outcomesByUnit = new Map<number, SelfAssessment[]>();
  for (const a of recent) for (const r of a.results) outcomesByUnit.set(r.unit.order, [...(outcomesByUnit.get(r.unit.order) ?? []), r.selfAssessmentStatus]);

  const weak = attempt.results
    .map((r) => {
      const before = (outcomesByUnit.get(r.unit.order) ?? []).slice(-ANALYSIS_HISTORY.previousOutcomesPerUnit);
      const nonCorrect = before.filter((o) => o !== "CORRECT").length + (r.selfAssessmentStatus !== "CORRECT" ? 1 : 0);
      return { order: r.unit.order, currentStatus: r.selfAssessmentStatus, previousOutcomes: before, nonCorrect };
    })
    .filter((u) => u.nonCorrect > 0)
    .sort((a, b) => b.nonCorrect - a.nonCorrect || a.order - b.order)
    .slice(0, ANALYSIS_HISTORY.maxWeakUnits);

  const now = attempt.completedAt.getTime();
  return {
    passage: { unitCount: attempt.totalUnits },
    historyAttempts: previous.length,
    currentAttempt: {
      kind: attempt.kind,
      score: Math.round(attempt.scorePercentage),
      correct: attempt.correctUnits,
      incorrect: attempt.incorrectUnits,
      forgotten: attempt.forgottenUnits,
      total: attempt.totalUnits,
    },
    weakUnits: weak.map((u) => ({ unitId: unitRef(u.order), currentStatus: u.currentStatus, previousOutcomes: u.previousOutcomes })),
    recentAttempts: recent.map((a) => ({
      kind: a.kind,
      score: Math.round(a.scorePercentage),
      correct: a.correctUnits,
      incorrect: a.incorrectUnits,
      forgotten: a.forgottenUnits,
      daysAgo: Math.max(0, Math.floor((now - a.completedAt.getTime()) / DAY_MS)),
    })),
    masteryTrajectory: [...recent, attempt].map((a) => ({ score: a.masteryAfter, state: a.stateAfter })),
    reviewHistory: {
      reviewsCompleted,
      lastReviewDaysAgo: lastReview ? Math.max(0, Math.floor((now - lastReview.completedAt.getTime()) / DAY_MS)) : null,
    },
    deterministicSchedule: {
      rule: schedule.rule,
      repeatedWeakness: schedule.repeatedWeakness,
      nextReviewInHours: Math.max(0, Math.round((attempt.nextReviewAt.getTime() - now) / 3_600_000)),
      masteryScore: attempt.masteryAfter,
      masteryState: attempt.stateAfter,
    },
  };
}

// ───────────────────────────── Output validation ─────────────────────────────

export type ValidatedAnalysis = {
  summary: string;
  patterns: string[];
  priorities: { unitNumber: number; reason: string }[];
  progressObservation: string | null;
};

const outputSchema = z
  .object({
    summary: z.string().trim().min(1).max(400),
    patterns: z.array(z.string().trim().min(1).max(260)).max(4),
    priorities: z.array(z.object({ unitId: z.string().trim().min(1).max(12), reason: z.string().trim().min(1).max(260) }).strict()).max(5),
    progressObservation: z.string().trim().max(300).nullable(),
  })
  .strict();

/** Words that describe a trend or repetition — only allowed when earlier attempts exist. */
const TREND_WORDS = /(تحسّ?ن|تحسنت|تحسّنت|تراجع|تراجعت|تدهور|ارتفع|ارتفعت|انخفض|انخفضت|مقارنة|السابقة|سابقًا|سابقا|تكرر|تكرّر|مرارًا|مرارا|في كل محاولة|مجددًا|ثبتت|استقر|أصبح ثابتًا)/u;
/** Rulings, verification claims and certainty claims the model must never make. */
const FORBIDDEN = /(فتوى|أفتي|يجوز|لا يجوز|حرام|حلال|واجب شرعًا|الشافعي|المالكي|الحنفي|تم التحقق|تحققنا|تحقق الذكاء|صحّحنا|صححنا|أكدنا|مؤكد|بالتأكيد|دراسات|علميًا|علميا)/u;
const MARKUP = /[<>]|&[a-z]+;|javascript:|https?:\/\//iu;

export type AnalysisContext = { previousAttempts: number; weakUnitIds: ReadonlySet<string> };

export function validateAnalysis(raw: unknown, ctx: AnalysisContext): { ok: true; value: ValidatedAnalysis } | { ok: false; reason: string } {
  // Providers are asked for "" when there is nothing to say; the application stores null.
  const candidate =
    raw && typeof raw === "object" && "progressObservation" in raw && (raw as { progressObservation: unknown }).progressObservation === ""
      ? { ...(raw as object), progressObservation: null }
      : raw;
  const parsed = outputSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, reason: `schema: ${parsed.error.issues[0]?.message ?? "invalid"}` };
  const v = parsed.data;

  const texts = [v.summary, ...v.patterns, ...v.priorities.map((p) => p.reason), v.progressObservation ?? ""];
  if (texts.some((t) => MARKUP.test(t))) return { ok: false, reason: "markup or link in text" };
  if (texts.some((t) => FORBIDDEN.test(t))) return { ok: false, reason: "forbidden claim (ruling, verification or certainty)" };

  for (const p of v.priorities) if (!ctx.weakUnitIds.has(p.unitId)) return { ok: false, reason: `priority references unknown unit ${p.unitId}` };
  if (new Set(v.priorities.map((p) => p.unitId)).size !== v.priorities.length) return { ok: false, reason: "duplicate priority unit" };

  if (ctx.previousAttempts < MIN_PREVIOUS_ATTEMPTS_FOR_TREND) {
    if (v.progressObservation) return { ok: false, reason: "progress observation without history" };
    if (texts.some((t) => TREND_WORDS.test(t))) return { ok: false, reason: "trend claim without history" };
  }

  return {
    ok: true,
    value: {
      summary: v.summary,
      patterns: v.patterns,
      priorities: v.priorities.map((p) => ({ unitNumber: Number(p.unitId.replace(/^u/, "")), reason: p.reason })),
      progressObservation: v.progressObservation && v.progressObservation.length > 0 ? v.progressObservation : null,
    },
  };
}

// ───────────────────────────── Orchestration ─────────────────────────────

export type AnalysisOutcome =
  | { status: "ANALYZED"; analysis: ValidatedAnalysis; model: string }
  | { status: "FALLBACK"; reason: string };

type ProviderSource = AIProvider | (() => AIProvider) | null | undefined;

function resolveProvider(source: ProviderSource): AIProvider | null {
  if (!source) return null;
  try {
    return typeof source === "function" ? source() : source;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AIProviderError("TIMEOUT", "Analysis timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs the optional analysis for an attempt that is ALREADY saved with its score, mastery and review date.
 * Never throws: any failure becomes a FALLBACK outcome. The attempt row is updated only with the validated analysis
 * (or a FALLBACK marker) — it can never change score, mastery or nextReviewAt.
 */
export async function analyzeAttempt(
  db: PrismaClient,
  params: { attemptId: string; userId: string; schedule: { rule: string; repeatedWeakness: boolean }; provider: ProviderSource; timeoutMs?: number },
): Promise<AnalysisOutcome> {
  const provider = resolveProvider(params.provider);
  const baseMeta: CallMeta = { provider: provider?.name ?? "none", model: provider?.generatorModel ?? "none", promptVersion: ANALYSIS_PROMPT_VERSION, latencyMs: 0 };

  const finish = async (outcome: AnalysisOutcome, logStatus: "SUCCESS" | "MALFORMED_OUTPUT" | "PROVIDER_ERROR", details: Record<string, unknown>, meta: CallMeta, raw?: unknown) => {
    try {
      await db.recitationAttempt.update({
        where: { id: params.attemptId },
        data:
          outcome.status === "ANALYZED"
            ? { analysisStatus: "ANALYZED", analysis: outcome.analysis, analysisModel: outcome.model }
            : { analysisStatus: "FALLBACK", analysis: undefined, analysisModel: null },
      });
    } catch (error) {
      console.error("[memorization] could not store the analysis status", error instanceof Error ? error.message : error);
    }
    await logAIInteraction(db, { type: "ANALYZE_MEMORIZATION", status: logStatus, meta, userId: params.userId, details: { attemptId: params.attemptId, outcome: outcome.status, ...details }, raw });
    return outcome;
  };

  if (!provider) return finish({ status: "FALLBACK", reason: "AI not configured" }, "PROVIDER_ERROR", { errorCode: "NOT_CONFIGURED" }, baseMeta);

  let payload: PerformancePayload;
  try {
    payload = await buildPerformancePayload(db, params.attemptId, params.schedule);
  } catch (error) {
    console.error("[memorization] could not build the analysis payload", error instanceof Error ? error.message : error);
    return finish({ status: "FALLBACK", reason: "payload" }, "PROVIDER_ERROR", { errorCode: "PAYLOAD" }, baseMeta);
  }

  const timeoutMs = params.timeoutMs ?? ANALYSIS_TIMEOUT_MS;
  const started = Date.now();
  let response;
  try {
    response = await withTimeout(
      provider.analyzePerformance({ payload: payload as unknown as Record<string, unknown> }, { system: ANALYSIS_SYSTEM_PROMPT, user: buildAnalysisUserPrompt(payload as unknown as Record<string, unknown>), timeoutMs }),
      timeoutMs + 500,
    );
  } catch (error) {
    const code = error instanceof AIProviderError ? error.code : "UNAVAILABLE";
    return finish({ status: "FALLBACK", reason: code }, "PROVIDER_ERROR", { errorCode: code }, { ...baseMeta, latencyMs: Date.now() - started });
  }

  const meta: CallMeta = { provider: response.provider, model: response.model, promptVersion: ANALYSIS_PROMPT_VERSION, latencyMs: response.latencyMs, stopReason: response.stopReason ?? null, usage: response.usage };
  const checked = validateAnalysis(response.data, { previousAttempts: payload.historyAttempts, weakUnitIds: new Set(payload.weakUnits.map((u) => u.unitId)) });
  if (!checked.ok) return finish({ status: "FALLBACK", reason: checked.reason }, "MALFORMED_OUTPUT", { reason: checked.reason }, meta, response.data);
  return finish({ status: "ANALYZED", analysis: checked.value, model: response.model }, "SUCCESS", { historyAttempts: payload.historyAttempts }, meta);
}
