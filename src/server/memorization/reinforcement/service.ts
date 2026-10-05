import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { logAIInteraction } from "@/server/ai/log";
import { AIProviderError, type AIProvider } from "@/server/ai/provider";
import type { CallMeta } from "@/server/ai/question-generator";
import { AppError } from "@/server/errors";
import { tokenizeCanonicalMatn } from "@/lib/matn-tokens";
import { buildPlannerPayload, REINFORCEMENT_PROMPT_VERSION, REINFORCEMENT_TIMEOUT_MS, requestAIPlan } from "./ai-planner";
import { observationSentence } from "./copy";
import { buildMemorizationPerformanceFacts, type IssueKind, type MemorizationPerformanceFacts, type UnitAssessment, type UnitAssessmentInput } from "./facts";
import { buildDeterministicPlan, decideAINecessity, validatePlan, type ObservationKey, type ReinforcementPlan } from "./plan";
import { resolveReviewMode, type ReviewMode } from "./review-mode";

/**
 * Orchestration of immediate adaptive reinforcement:
 *
 *   saved self-assessment → deterministic facts → AI necessity → (AI planner | deterministic planner) → validator
 *   → persisted plan → canonical context resolved from MatnUnit → reinforcement → re-recitation → before/after facts.
 *
 * Never touches mastery, score or the long-term review schedule. At most ONE provider call per attempt: the plan row
 * is claimed (PENDING, unique per attempt) before any call, so refreshes, double clicks and parallel tabs reuse it.
 */

type ProviderSource = AIProvider | (() => AIProvider) | null | undefined;
export type PlanDeps = { provider?: ProviderSource; timeoutMs?: number; now?: Date; /** Tests only; otherwise resolveReviewMode(). */ reviewMode?: ReviewMode };

/** A PENDING claim older than this is treated as abandoned and finished deterministically (no AI call). */
const STALE_PENDING_MS = REINFORCEMENT_TIMEOUT_MS * 3;

// ───────────────────────────── Book order ─────────────────────────────

export type BookUnit = { id: string; eligible: boolean; text: string };

/** Every unit of a book in canonical order, flagged eligible when its section, passage and all its units are approved. */
export async function loadBookUnits(db: PrismaClient, courseId: string): Promise<BookUnit[]> {
  const sections = await db.matnSection.findMany({
    where: { courseId },
    orderBy: { order: "asc" },
    select: { status: true, passages: { orderBy: { order: "asc" }, select: { status: true, units: { orderBy: { order: "asc" }, select: { id: true, status: true, canonicalText: true } } } } },
  });
  return sections.flatMap((s) =>
    s.passages.flatMap((p) => {
      const eligible = s.status === "APPROVED" && p.status === "APPROVED" && p.units.length > 0 && p.units.every((u) => u.status === "APPROVED");
      return p.units.map((u) => ({ id: u.id, eligible, text: u.canonicalText }));
    }),
  );
}

const asAssessment = (r: { selfAssessmentStatus: UnitAssessment["status"]; selfAssessmentScope: UnitAssessment["scope"]; wordIndexes: number[]; forgottenWordIndexes: number[] }): UnitAssessment => ({
  status: r.selfAssessmentStatus,
  scope: r.selfAssessmentScope,
  incorrect: r.wordIndexes,
  forgotten: r.forgottenWordIndexes,
});

// ───────────────────────────── Facts from the database ─────────────────────────────

export type LoadedFacts = { facts: MemorizationPerformanceFacts; courseId: string; passageId: string; firstUnitId: string; completedAt: Date };

/**
 * Builds deterministic facts for a stored attempt of THIS learner. Comparable history = the learner's most recent
 * earlier assessment of the same unit, as long as the unit was not re-approved (possibly re-worded) after it.
 */
export async function loadAttemptFacts(db: PrismaClient, userId: string, attemptId: string): Promise<LoadedFacts | null> {
  const attempt = await db.recitationAttempt.findFirst({
    where: { id: attemptId, userId },
    select: {
      id: true,
      passageId: true,
      completedAt: true,
      passage: { select: { section: { select: { courseId: true } } } },
      results: { select: { unitId: true, selfAssessmentStatus: true, selfAssessmentScope: true, wordIndexes: true, forgottenWordIndexes: true, unit: { select: { canonicalText: true, approvedAt: true } } } },
    },
  });
  if (!attempt || attempt.results.length === 0) return null;
  const courseId = attempt.passage.section.courseId;
  const book = await loadBookUnits(db, courseId);
  const position = new Map(book.map((u, i) => [u.id, i]));
  const results = [...attempt.results].sort((a, b) => (position.get(a.unitId) ?? 0) - (position.get(b.unitId) ?? 0));

  const earlier = await db.recitationUnitResult.findMany({
    where: { unitId: { in: results.map((r) => r.unitId) }, attempt: { userId, completedAt: { lt: attempt.completedAt } } },
    orderBy: { attempt: { completedAt: "desc" } },
    select: { unitId: true, selfAssessmentStatus: true, selfAssessmentScope: true, wordIndexes: true, forgottenWordIndexes: true, attempt: { select: { completedAt: true } } },
  });
  const previousByUnit = new Map<string, (typeof earlier)[number]>();
  for (const r of earlier) if (!previousByUnit.has(r.unitId)) previousByUnit.set(r.unitId, r);

  const inputs: UnitAssessmentInput[] = results.map((r) => {
    const i = position.get(r.unitId);
    const prev = previousByUnit.get(r.unitId);
    const comparable = prev && (!r.unit.approvedAt || r.unit.approvedAt.getTime() <= prev.attempt.completedAt.getTime());
    return {
      unitId: r.unitId,
      tokenCount: tokenizeCanonicalMatn(r.unit.canonicalText).length,
      ...asAssessment(r),
      hasPreviousNeighbor: i !== undefined && i > 0 && book[i - 1]!.eligible,
      hasNextNeighbor: i !== undefined && i + 1 < book.length && book[i + 1]!.eligible,
      previous: comparable ? asAssessment(prev) : null,
    };
  });
  return { facts: buildMemorizationPerformanceFacts(inputs), courseId, passageId: attempt.passageId, firstUnitId: results[0]!.unitId, completedAt: attempt.completedAt };
}

// ───────────────────────────── Plan creation (idempotent, ≤ 1 AI call) ─────────────────────────────

export type PlanSummary = {
  planId: string;
  reviewMode: ReviewMode;
  planSource: "AI" | "DETERMINISTIC" | "NONE";
  observation: string;
  targetCount: number;
  status: "READY" | "COMPLETED" | "SKIPPED";
};
export type EnsurePlanResult = { kind: "NONE" } | { kind: "PENDING" } | { kind: "PLAN"; plan: PlanSummary };

type StoredPlan = { id: string; status: string; reviewMode: ReviewMode; planSource: "AI" | "DETERMINISTIC" | "NONE" | null; observationKey: string | null; targetCount: number; facts: Prisma.JsonValue; createdAt: Date };

function summarize(row: StoredPlan): PlanSummary | null {
  if (row.status === "PENDING" || !row.planSource || !row.observationKey || !row.facts) return null;
  return {
    planId: row.id,
    reviewMode: row.reviewMode,
    planSource: row.planSource,
    observation: observationSentence(row.observationKey as ObservationKey, row.facts as unknown as MemorizationPerformanceFacts),
    targetCount: row.targetCount,
    status: row.status as PlanSummary["status"],
  };
}

function resolveProvider(source: ProviderSource): AIProvider | null {
  if (!source) return null;
  try {
    return typeof source === "function" ? source() : source;
  } catch {
    return null;
  }
}

const planSelect = { id: true, status: true, reviewMode: true, planSource: true, observationKey: true, targetCount: true, facts: true, createdAt: true } as const;

/** Reads the stored plan for an attempt without creating anything (used at render time). */
export async function getStoredPlan(db: PrismaClient, userId: string, attemptId: string): Promise<EnsurePlanResult | null> {
  const row = await db.memorizationReinforcementPlan.findFirst({ where: { sourceAttemptId: attemptId, userId }, select: planSelect });
  if (!row) return null;
  const summary = summarize(row);
  return summary ? { kind: "PLAN", plan: summary } : { kind: "PENDING" };
}

export async function ensureReinforcementPlan(db: PrismaClient, userId: string, attemptId: string, deps: PlanDeps = {}): Promise<EnsurePlanResult> {
  const now = deps.now ?? new Date();
  const existing = await db.memorizationReinforcementPlan.findFirst({ where: { sourceAttemptId: attemptId }, select: { ...planSelect, userId: true } });
  if (existing) {
    if (existing.userId !== userId) throw new AppError("NOT_FOUND", "هذه النتيجة غير متاحة.");
    const summary = summarize(existing);
    if (summary) return { kind: "PLAN", plan: summary };
    if (now.getTime() - existing.createdAt.getTime() < STALE_PENDING_MS) return { kind: "PENDING" };
  }

  const loaded = await loadAttemptFacts(db, userId, attemptId);
  if (!loaded) throw new AppError("NOT_FOUND", "هذه النتيجة غير متاحة.");
  const { facts } = loaded;
  if (!facts.hasIssues) return { kind: "NONE" };

  if (existing) {
    // An abandoned claim: finish it deterministically. Never a (second) AI call.
    const plan = buildDeterministicPlan(facts)!;
    const baseline = existing.reviewMode === "BASELINE_REVIEW";
    await db.memorizationReinforcementPlan.updateMany({
      where: { id: existing.id, status: "PENDING" },
      data: baseline ? planData(facts, plan, "NONE", "BASELINE_REVIEW", []) : planData(facts, plan, "DETERMINISTIC", "FALLBACK:STALE_PENDING", []),
    });
    return (await getStoredPlan(db, userId, attemptId)) ?? { kind: "PENDING" };
  }

  // The evaluation condition is fixed when the session is created, from server-side configuration only.
  const reviewMode = deps.reviewMode ?? resolveReviewMode(userId);
  // Claim the attempt. The unique sourceAttemptId makes a concurrent second request lose here — before any AI call.
  let claimId: string;
  try {
    claimId = (await db.memorizationReinforcementPlan.create({ data: { userId, sourceAttemptId: attemptId, status: "PENDING", reviewMode }, select: { id: true } })).id;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return (await getStoredPlan(db, userId, attemptId)) ?? { kind: "PENDING" };
    throw error;
  }

  const deterministic = buildDeterministicPlan(facts)!;
  if (reviewMode === "BASELINE_REVIEW") {
    // Evaluation baseline: no planner, no AI. The deterministic plan only fixes which units are reviewed (all of them).
    await db.memorizationReinforcementPlan.update({ where: { id: claimId }, data: planData(facts, deterministic, "NONE", "BASELINE_REVIEW", []) });
    return (await getStoredPlan(db, userId, attemptId)) ?? { kind: "PENDING" };
  }
  const necessity = decideAINecessity(facts);
  let chosen: { plan: ReinforcementPlan; source: "AI" | "DETERMINISTIC"; outcome: string } = { plan: deterministic, source: "DETERMINISTIC", outcome: "NOT_NEEDED" };

  if (necessity.useAI) {
    chosen = await planWithAI(db, { userId, attemptId, facts, fallback: deterministic, necessityReasons: necessity.reasons, provider: deps.provider, timeoutMs: deps.timeoutMs });
  }

  await db.memorizationReinforcementPlan.update({ where: { id: claimId }, data: planData(facts, chosen.plan, chosen.source, chosen.outcome, necessity.reasons) });
  return (await getStoredPlan(db, userId, attemptId)) ?? { kind: "PENDING" };
}

function planData(facts: MemorizationPerformanceFacts, plan: ReinforcementPlan, source: "AI" | "DETERMINISTIC" | "NONE", outcome: string, reasons: string[]) {
  return {
    status: "READY" as const,
    planSource: source,
    aiOutcome: outcome,
    necessityReasons: reasons,
    promptVersion: source === "AI" ? REINFORCEMENT_PROMPT_VERSION : null,
    facts: facts as unknown as Prisma.InputJsonValue,
    observationKey: plan.observationKey,
    targets: plan.targets as unknown as Prisma.InputJsonValue,
    targetCount: plan.targets.length,
  };
}

async function planWithAI(
  db: PrismaClient,
  p: { userId: string; attemptId: string; facts: MemorizationPerformanceFacts; fallback: ReinforcementPlan; necessityReasons: string[]; provider: ProviderSource; timeoutMs?: number },
): Promise<{ plan: ReinforcementPlan; source: "AI" | "DETERMINISTIC"; outcome: string }> {
  const provider = resolveProvider(p.provider);
  const baseMeta: CallMeta = { provider: provider?.name ?? "none", model: provider?.generatorModel ?? "none", promptVersion: REINFORCEMENT_PROMPT_VERSION, latencyMs: 0 };
  const details = { feature: "MEMORIZATION_REINFORCEMENT", attemptId: p.attemptId, necessityReasons: p.necessityReasons };
  const fallback = async (reason: string, status: "MALFORMED_OUTPUT" | "PROVIDER_ERROR", meta: CallMeta, extra: Record<string, unknown> = {}, raw?: unknown) => {
    await logAIInteraction(db, { type: "PLAN_MEMORIZATION_REINFORCEMENT", status, meta, userId: p.userId, details: { ...details, planSource: "DETERMINISTIC", fallbackUsed: true, fallbackReason: reason, ...extra }, raw });
    return { plan: p.fallback, source: "DETERMINISTIC" as const, outcome: `FALLBACK:${reason}` };
  };

  if (!provider) return fallback("NOT_CONFIGURED", "PROVIDER_ERROR", baseMeta);

  const payload = buildPlannerPayload(p.facts);
  const started = Date.now();
  let response;
  try {
    response = await requestAIPlan(provider, payload, p.timeoutMs);
  } catch (error) {
    const code = error instanceof AIProviderError ? error.code : "UNAVAILABLE";
    return fallback(code, "PROVIDER_ERROR", { ...baseMeta, latencyMs: Date.now() - started });
  }
  const meta: CallMeta = { provider: response.provider, model: response.model, promptVersion: REINFORCEMENT_PROMPT_VERSION, latencyMs: response.latencyMs, stopReason: response.stopReason ?? null, usage: response.usage };
  const checked = validatePlan(response.data, p.facts);
  if (!checked.ok) return fallback("VALIDATION_REJECTED", "MALFORMED_OUTPUT", meta, { validation: checked.reason }, response.data);
  await logAIInteraction(db, { type: "PLAN_MEMORIZATION_REINFORCEMENT", status: "SUCCESS", meta, userId: p.userId, details: { ...details, planSource: "AI", fallbackUsed: false, validation: "PASSED", targetCount: checked.plan.targets.length } });
  return { plan: checked.plan, source: "AI", outcome: "AI_ACCEPTED" };
}

// ───────────────────────────── Finishing a session ─────────────────────────────

/**
 * Marks the session completed (or ended early). Exposures are computed on the server — answered coach exercises, or
 * one review pass for the baseline — never taken from the client. Idempotent.
 */
export async function finishReinforcement(db: PrismaClient, userId: string, planId: string, input: { completed: boolean }, now = new Date()): Promise<void> {
  const row = await db.memorizationReinforcementPlan.findFirst({ where: { id: planId, userId, status: { in: ["READY", "COMPLETED", "SKIPPED"] } }, select: { id: true, status: true, reviewMode: true } });
  if (!row) throw new AppError("NOT_FOUND", "جولة التثبيت غير متاحة.");
  if (row.status !== "READY") return;
  const exposures = row.reviewMode === "BASELINE_REVIEW" ? (input.completed ? 1 : 0) : await db.memorizationReinforcementExercise.count({ where: { planId: row.id, response: { not: null } } });
  await db.memorizationReinforcementPlan.updateMany({
    where: { id: row.id, status: "READY" },
    data: { status: input.completed ? "COMPLETED" : "SKIPPED", exposuresCompleted: exposures, completedAt: now },
  });
}

/** A plan that a re-recitation may link to: owned, built, and not yet followed up. */
export async function getLinkablePlan(db: PrismaClient, userId: string, planId: string) {
  return db.memorizationReinforcementPlan.findFirst({
    where: { id: planId, userId, followUpAttemptId: null, status: { in: ["READY", "COMPLETED", "SKIPPED"] } },
    // Re-recitation must display the learner's original assessment, never a derived plan or coach response.
    select: {
      id: true,
      facts: true,
      sourceAttempt: {
        select: {
          passageId: true,
          results: {
            where: { selfAssessmentStatus: { not: "CORRECT" } },
            select: { unitId: true, selfAssessmentStatus: true, selfAssessmentScope: true, wordIndexes: true, forgottenWordIndexes: true },
          },
        },
      },
    },
  });
}

/**
 * Called inside the recitation transaction: links the new attempt to the plan only when it re-assessed exactly the same
 * units (comparable before/after). Anything else is silently not linked — the attempt itself is always saved.
 */
export async function linkFollowUpAttempt(tx: PrismaClient, userId: string, planId: string, attemptId: string, unitIds: string[]): Promise<boolean> {
  const plan = await getLinkablePlan(tx, userId, planId);
  if (!plan || !plan.facts) return false;
  const before = (plan.facts as unknown as MemorizationPerformanceFacts).units.map((u) => u.unitId);
  if (before.length !== unitIds.length || before.some((id) => !unitIds.includes(id))) return false;
  const updated = await tx.memorizationReinforcementPlan.updateMany({ where: { id: plan.id, followUpAttemptId: null }, data: { followUpAttemptId: attemptId } });
  return updated.count === 1;
}

// ───────────────────────────── Before / after (deterministic, observational) ─────────────────────────────

export type BeforeAfter = {
  before: { incorrectTokens: number; forgottenTokens: number; unitLevel: number; positions: number };
  after: { incorrectTokens: number; forgottenTokens: number; unitLevel: number; positions: number };
  /** Positions affected before and CORRECT now (same granularity only). */
  nowCorrect: number;
  /** Positions affected before that are still affected now (any kind / granularity). */
  remaining: number;
  /** Positions affected now that were not affected before. */
  newlyAffected: number;
};

type Pos = { unitId: string; token: number | null; kind: IssueKind };

function positionsOf(facts: MemorizationPerformanceFacts): Pos[] {
  const idByRef = new Map(facts.units.map((u) => [u.ref, u.unitId]));
  return facts.affected.map((p) => ({ unitId: idByRef.get(p.unitRef)!, token: p.token, kind: p.kind }));
}

/** Pure comparison of two assessments of the same units. It describes what changed; it never says why. */
export function compareAssessments(before: MemorizationPerformanceFacts, after: MemorizationPerformanceFacts): BeforeAfter {
  const afterUnits = new Map(after.units.map((u) => [u.unitId, u]));
  const beforeUnits = new Map(before.units.map((u) => [u.unitId, u]));
  let nowCorrect = 0;
  let remaining = 0;
  for (const p of positionsOf(before)) {
    const u = afterUnits.get(p.unitId);
    if (!u) continue;
    if (u.evidence === "CORRECT") nowCorrect += 1;
    else if (u.unitIssue) remaining += 1;
    else if (p.token === null) remaining += 1; // unit-level before, some words still marked now
    else if (u.incorrect.includes(p.token) || u.forgotten.includes(p.token)) remaining += 1;
    else nowCorrect += 1;
  }
  let newlyAffected = 0;
  for (const p of positionsOf(after)) {
    const b = beforeUnits.get(p.unitId);
    if (!b || b.evidence === "CORRECT") newlyAffected += 1;
    else if (b.unitIssue) continue; // was affected as a whole unit before
    else if (p.token === null) continue; // whole unit now; its earlier words are counted as remaining
    else if (!b.incorrect.includes(p.token) && !b.forgotten.includes(p.token)) newlyAffected += 1;
  }
  const side = (f: MemorizationPerformanceFacts) => ({ incorrectTokens: f.totals.incorrectTokens, forgottenTokens: f.totals.forgottenTokens, unitLevel: f.affected.filter((p) => p.level === "UNIT").length, positions: f.affected.length });
  return { before: side(before), after: side(after), nowCorrect, remaining, newlyAffected };
}

/** Before/after for an attempt that is the re-recitation of a plan, or null. */
export async function getFollowUpComparison(db: PrismaClient, userId: string, attemptId: string): Promise<(BeforeAfter & { completedReinforcement: boolean }) | null> {
  const plan = await db.memorizationReinforcementPlan.findFirst({ where: { followUpAttemptId: attemptId, userId }, select: { facts: true, status: true } });
  if (!plan?.facts) return null;
  const loaded = await loadAttemptFacts(db, userId, attemptId);
  if (!loaded) return null;
  return { ...compareAssessments(plan.facts as unknown as MemorizationPerformanceFacts, loaded.facts), completedReinforcement: plan.status === "COMPLETED" };
}
