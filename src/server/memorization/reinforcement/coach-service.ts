import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { tokenizeCanonicalMatn } from "@/lib/matn-tokens";
import { logAIInteraction } from "@/server/ai/log";
import { AIProviderError, type AIProvider } from "@/server/ai/provider";
import type { CallMeta } from "@/server/ai/question-generator";
import { AppError } from "@/server/errors";
import {
  answeredCount,
  buildCoachPayload,
  checkExerciseStructure,
  decisionNeedsAI,
  deriveSession,
  deterministicDecision,
  exerciseWindow,
  RECALL_HINTS,
  renderExercise,
  RESPONSES,
  sessionBudget,
  sessionDone,
  validateCoachDecision,
  type CoachContext,
  type CoachDecision,
  type ExerciseDecision,
  type ExerciseType,
  type PlayedExercise,
  type PreviousIntervention,
  type RecallResponse,
  type RenderedUnit,
} from "./coach";
import { COACH_PROMPT_VERSION, COACH_TIMEOUT_MS, requestCoachDecision } from "./coach-ai";
import { EXERCISE_TITLE, exerciseInstruction, exerciseLead, GUIDED_INSTRUCTION } from "./copy";
import { isUnitLevelEvidence, type MemorizationPerformanceFacts } from "./facts";
import { validatePlan } from "./plan";
import { loadBookUnits, type BookUnit } from "./service";

/**
 * Orchestration of the interactive reinforcement coach (AI_ADAPTIVE_REVIEW):
 *
 *   validated plan (targets) → exercise k: claim row → (AI decision | deterministic) → validator → stored decision
 *   → canonical text resolved here from approved MatnUnit rows → learner reveals → learner self-reports
 *   → session-local facts updated → exercise k+1 … → session closes (code-controlled budget) → re-recitation.
 *
 * Never touches mastery, score, the long-term schedule, the canonical text or the learner's self-assessment.
 * At most ONE provider call per exercise decision: the (planId, order) row is claimed before any call, so refreshes,
 * double clicks and parallel tabs reuse it. A provider failure degrades the rest of the session to the deterministic
 * policy (no more calls); a validator rejection falls back for that decision only.
 */

type ProviderSource = AIProvider | (() => AIProvider) | null | undefined;
export type CoachDeps = { provider?: ProviderSource; timeoutMs?: number; now?: Date };

const STALE_PENDING_MS = COACH_TIMEOUT_MS * 3;
const PROVIDER_FAILURES = ["NOT_CONFIGURED", "UNAVAILABLE", "TIMEOUT", "RATE_LIMITED", "SESSION_DEGRADED"];

// ───────────────────────────── Loading ─────────────────────────────

const planSelect = {
  id: true,
  status: true,
  reviewMode: true,
  facts: true,
  targets: true,
  observationKey: true,
  followUpAttemptId: true,
  sourceAttemptId: true,
  sourceAttempt: { select: { passageId: true, completedAt: true, passage: { select: { section: { select: { courseId: true } } } } } },
} as const;

type ExerciseRow = {
  id: string;
  order: number;
  exerciseType: ExerciseType | null;
  decision: Prisma.JsonValue;
  decisionOutcome: string | null;
  response: RecallResponse | null;
  createdAt: Date;
  readyAt: Date | null;
  revealedAt: Date | null;
};
const exerciseSelect = { id: true, order: true, exerciseType: true, decision: true, decisionOutcome: true, response: true, createdAt: true, readyAt: true, revealedAt: true } as const;

async function loadPlan(db: PrismaClient, userId: string, planId: string) {
  const row = await db.memorizationReinforcementPlan.findFirst({ where: { id: planId, userId, status: { in: ["READY", "COMPLETED", "SKIPPED"] } }, select: planSelect });
  if (!row || !row.facts || !row.targets || row.reviewMode !== "AI_ADAPTIVE_REVIEW") return null;
  const facts = row.facts as unknown as MemorizationPerformanceFacts;
  // Stored plans were validated when created; re-validate so a tampered or stale row can never drive a session.
  const checked = validatePlan({ observationKey: row.observationKey, targets: row.targets }, facts);
  if (!checked.ok) return null;
  return { row, facts, targetGroups: checked.plan.targets.map((t) => t.unitRefs) };
}
type LoadedPlan = NonNullable<Awaited<ReturnType<typeof loadPlan>>>;

const exercisesOf = (db: PrismaClient, planId: string) => db.memorizationReinforcementExercise.findMany({ where: { planId }, orderBy: { order: "asc" }, select: exerciseSelect }) as Promise<ExerciseRow[]>;

const isExercise = (r: ExerciseRow) => r.readyAt !== null && r.exerciseType !== null;
const isFinishMarker = (r: ExerciseRow) => r.readyAt !== null && r.exerciseType === null;

function played(rows: ExerciseRow[]): PlayedExercise[] {
  return rows.filter(isExercise).map((r) => ({ ...(r.decision as unknown as ExerciseDecision), order: r.order, response: r.response }));
}

/**
 * For every affected unit of this session: the most recent EARLIER coach session that practised the same unit and how
 * that unit was self-assessed in the re-recitation that followed it. The current attempt counts as that re-recitation
 * when it is one. Comparable only while the unit was not re-approved since. Decision evidence — never a causal claim.
 */
async function loadPreviousInterventions(db: PrismaClient, userId: string, plan: LoadedPlan): Promise<Record<string, PreviousIntervention>> {
  const { facts, row } = plan;
  const affected = facts.units.filter((u) => u.evidence !== "CORRECT");
  if (affected.length === 0) return {};
  const units = await db.matnUnit.findMany({ where: { id: { in: affected.map((u) => u.unitId) } }, select: { id: true, approvedAt: true } });
  const approvedAt = new Map(units.map((u) => [u.id, u.approvedAt]));
  const earlier = await db.memorizationReinforcementPlan.findMany({
    where: { userId, id: { not: row.id }, reviewMode: "AI_ADAPTIVE_REVIEW", sourceAttempt: { completedAt: { lt: row.sourceAttempt.completedAt } } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      createdAt: true,
      facts: true,
      followUpAttempt: { select: { completedAt: true, results: { select: { unitId: true, selfAssessmentStatus: true } } } },
      exercises: { where: { exerciseType: { not: null } }, orderBy: { order: "asc" }, select: { exerciseType: true, targetRefs: true, response: true } },
    },
  });
  const out: Record<string, PreviousIntervention> = {};
  for (const u of affected) {
    for (const p of earlier) {
      const approved = approvedAt.get(u.unitId);
      if (approved && approved.getTime() > p.createdAt.getTime()) continue;
      const priorRef = (p.facts as unknown as MemorizationPerformanceFacts | null)?.units.find((x) => x.unitId === u.unitId)?.ref;
      if (!priorRef) continue;
      const touched = p.exercises.filter((e) => e.targetRefs.includes(priorRef));
      if (touched.length === 0) continue;
      const follow = p.followUpAttempt && p.followUpAttempt.completedAt.getTime() <= row.sourceAttempt.completedAt.getTime() ? p.followUpAttempt : null;
      const status = follow?.results.find((r) => r.unitId === u.unitId)?.selfAssessmentStatus;
      out[u.ref] = {
        exerciseTypes: [...new Set(touched.map((e) => e.exerciseType!))],
        lastResponse: touched.at(-1)!.response,
        // The unit is affected again NOW, so a follow-up that was correct means the weakness returned later.
        outcome: !status ? "NO_FOLLOW_UP" : status === "CORRECT" ? "RETURNED_LATER" : "REMAINED_AFFECTED",
      };
      break;
    }
  }
  return out;
}

async function contextFor(db: PrismaClient, userId: string, plan: LoadedPlan, rows: ExerciseRow[]): Promise<CoachContext> {
  return { facts: plan.facts, targetGroups: plan.targetGroups, previous: await loadPreviousInterventions(db, userId, plan), played: played(rows) };
}

// ───────────────────────────── Canonical resolution (fail closed) ─────────────────────────────

type ResolvedWindow = { ref: string | null; role: "TARGET" | "CONTEXT"; tokens: string[] }[];

/**
 * Canonical tokens of an exercise window, from approved MatnUnit rows in canonical book order. Fails closed (null) when
 * a unit is no longer approved, the target units are no longer consecutive, or a target's token count drifted.
 */
function resolveWindow(book: BookUnit[], facts: MemorizationPerformanceFacts, d: ExerciseDecision): ResolvedWindow | null {
  const window = exerciseWindow(facts, d.unitRefs, d.contextLevel);
  if (!window.ok) return null;
  const position = new Map(book.map((u, i) => [u.id, i]));
  const byRef = new Map(facts.units.map((u) => [u.ref, u]));
  const targetPositions = d.unitRefs.map((r) => position.get(byRef.get(r)!.unitId));
  if (targetPositions.some((p) => p === undefined) || targetPositions.some((p, k) => p !== targetPositions[0]! + k)) return null;
  const first = targetPositions[0]!;
  const last = targetPositions.at(-1)!;
  const out: ResolvedWindow = [];
  for (const w of window.units) {
    const pos = w.ref ? position.get(byRef.get(w.ref)!.unitId) : w.offset < 0 ? first - 1 : last + 1;
    if (pos === undefined || (w.role === "CONTEXT" && pos !== (w.offset < 0 ? first - 1 : last + 1))) return null;
    const unit = book[pos];
    if (!unit || !unit.eligible) return null;
    const tokens = tokenizeCanonicalMatn(unit.text);
    if (w.role === "TARGET" && tokens.length !== byRef.get(w.ref!)!.tokenCount) return null;
    out.push({ ref: w.ref, role: w.role, tokens });
  }
  return out;
}

/**
 * Guided recall: a fully hidden first target with nothing before it gets the canonical line that precedes it in the
 * book as a cue («ما النص الذي يأتي بعده؟»). Display only — the stored decision, cue strength and schedule are untouched.
 * Without an approved previous line the window is unchanged and the beginning of the line is shown instead.
 */
function withPreviousLine(book: BookUnit[], facts: MemorizationPerformanceFacts, d: ExerciseDecision, window: ResolvedWindow): { window: ResolvedWindow; previousLine: boolean } {
  const first = window[0];
  if (!first || first.role !== "TARGET") return { window, previousLine: false };
  const fact = facts.units.find((u) => u.ref === first.ref);
  const whole = d.exerciseType === "WHOLE_UNIT_RECALL" || Boolean(fact && isUnitLevelEvidence(fact.evidence));
  if (!fact || !whole) return { window, previousLine: false };
  const position = book.findIndex((u) => u.id === fact.unitId);
  const previous = position > 0 ? book[position - 1] : undefined;
  if (!previous || !previous.eligible) return { window, previousLine: false };
  const tokens = tokenizeCanonicalMatn(previous.text);
  if (tokens.length === 0) return { window, previousLine: false };
  return { window: [{ ref: null, role: "CONTEXT", tokens }, ...window], previousLine: true };
}

// ───────────────────────────── View ─────────────────────────────

export type ExerciseView = {
  id: string;
  number: number;
  exerciseType: ExerciseType;
  title: string;
  instruction: string;
  lead: string | null;
  revealed: boolean;
  units: RenderedUnit[];
  /** Guided recall: hints used so far and whether one more would reveal anything. Never sent after reveal. */
  hints: { used: number; canHint: boolean };
};

export type CoachView = {
  planId: string;
  state: "ACTIVE" | "PENDING" | "NEEDS_NEXT" | "DONE" | "UNAVAILABLE";
  exercise: ExerciseView | null;
  answered: number;
  budget: number;
  /** DONE only: some targets were closed after repeated unrecalled attempts (canonical answer shown each time). */
  needsMoreReview: boolean;
  recite: { passageId: string; startUnitId: string; size: number };
  alreadyReRecited: boolean;
};

async function buildView(db: PrismaClient, plan: LoadedPlan, rows: ExerciseRow[], hints = 0): Promise<CoachView> {
  const { row, facts, targetGroups } = plan;
  const ctx: CoachContext = { facts, targetGroups, previous: {}, played: played(rows) };
  const base = {
    planId: row.id,
    answered: answeredCount(ctx),
    budget: sessionBudget(ctx),
    recite: { passageId: row.sourceAttempt.passageId, startUnitId: facts.units[0]!.unitId, size: facts.units.length },
    alreadyReRecited: row.followUpAttemptId !== null,
    exercise: null,
    needsMoreReview: false,
  };
  const states = deriveSession(ctx);
  if (row.status !== "READY" || rows.some(isFinishMarker)) return { ...base, state: "DONE", needsMoreReview: [...states.values()].some((s) => s.closedBy === "FAILURE_CAP" || (!s.closed && s.lastResponse !== "RECALLED")) };
  const last = rows.at(-1);
  if (last && !last.readyAt) return { ...base, state: "PENDING" };
  if (!last || last.response !== null) return { ...base, state: "NEEDS_NEXT" };

  const decision = last.decision as unknown as ExerciseDecision;
  if (checkExerciseStructure(decision, facts)) return { ...base, state: "UNAVAILABLE" };
  const book = await loadBookUnits(db, row.sourceAttempt.passage.section.courseId);
  const resolved = resolveWindow(book, facts, decision);
  if (!resolved) return { ...base, state: "UNAVAILABLE" };
  const { window, previousLine } = withPreviousLine(book, facts, decision, resolved);
  const revealed = last.revealedAt !== null;
  const used = revealed ? 0 : Math.max(0, Math.min(RECALL_HINTS.max, Math.trunc(hints)));
  const render = (level: number) => renderExercise(decision, facts, window, revealed, { leadingCue: true, hints: level });
  const units = render(used);
  const canHint = !revealed && used < RECALL_HINTS.max && JSON.stringify(render(used + 1)) !== JSON.stringify(units);
  const guided = units.some((u) => u.role === "TARGET" && u.segments.some((s) => s.kind === "HIDDEN" && s.rest));
  return {
    ...base,
    state: "ACTIVE",
    exercise: {
      id: last.id,
      number: last.order,
      exerciseType: decision.exerciseType,
      title: EXERCISE_TITLE[decision.exerciseType],
      instruction: previousLine
        ? GUIDED_INSTRUCTION.NEXT_LINE
        : guided && used === 0
          ? GUIDED_INSTRUCTION.COMPLETE_LINE
          : exerciseInstruction(decision.exerciseType, decision.hiddenTokens.length),
      lead: exerciseLead(decision.reasonCode, decision.exerciseType),
      revealed,
      units,
      hints: { used, canHint },
    },
  };
}

/** Read-only view (render time). Never creates an exercise and never calls a provider. */
export async function getCoachView(db: PrismaClient, userId: string, planId: string, hints = 0): Promise<CoachView | null> {
  const plan = await loadPlan(db, userId, planId);
  if (!plan) return null;
  return buildView(db, plan, await exercisesOf(db, plan.row.id), hints);
}

/**
 * Progressive hint (learner-requested, before reveal): the same exercise rendered with `level` hints — further leading
 * words of the hidden text, never all of it. Read-only: the decision, responses and schedule are not changed.
 */
export async function hintExercise(db: PrismaClient, userId: string, planId: string, exerciseId: string, level: unknown): Promise<CoachView | null> {
  if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > RECALL_HINTS.max) throw new AppError("BAD_REQUEST");
  await ownedExercise(db, userId, planId, exerciseId);
  return getCoachView(db, userId, planId, level);
}

// ───────────────────────────── Deciding the next exercise (idempotent, ≤ 1 AI call) ─────────────────────────────

function resolveProvider(source: ProviderSource): AIProvider | null {
  if (!source) return null;
  try {
    return typeof source === "function" ? source() : source;
  } catch {
    return null;
  }
}

async function completePlan(db: PrismaClient, planId: string, answered: number, now: Date) {
  await db.memorizationReinforcementPlan.updateMany({ where: { id: planId, status: "READY" }, data: { status: "COMPLETED", exposuresCompleted: answered, completedAt: now } });
}

async function fillClaim(db: PrismaClient, exerciseId: string, decision: CoachDecision, source: "AI" | "DETERMINISTIC" | "FALLBACK", outcome: string, now: Date) {
  const e = decision.action === "EXERCISE" ? decision.exercise : null;
  await db.memorizationReinforcementExercise.updateMany({
    where: { id: exerciseId, readyAt: null },
    data: {
      exerciseType: e?.exerciseType ?? null,
      decisionSource: source,
      decisionOutcome: outcome,
      promptVersion: source === "AI" ? COACH_PROMPT_VERSION : null,
      decision: (e ?? { action: "FINISH" }) as unknown as Prisma.InputJsonValue,
      reasonCode: e?.reasonCode ?? null,
      contextLevel: e?.contextLevel ?? null,
      cueLevel: e?.cueLevel ?? null,
      targetRefs: e?.unitRefs ?? [],
      readyAt: now,
    },
  });
}

async function decide(
  db: PrismaClient,
  p: { userId: string; planId: string; ctx: CoachContext; rows: ExerciseRow[]; provider: ProviderSource; timeoutMs?: number },
): Promise<{ decision: CoachDecision; source: "AI" | "DETERMINISTIC" | "FALLBACK"; outcome: string }> {
  const fallback = deterministicDecision(p.ctx);
  if (!decisionNeedsAI(p.ctx)) return { decision: fallback, source: "DETERMINISTIC", outcome: "NOT_NEEDED" };
  // A provider failure earlier in this session: no further calls, the rest of the session is deterministic.
  if (p.rows.some((r) => PROVIDER_FAILURES.some((code) => r.decisionOutcome === `FALLBACK:${code}`))) return { decision: fallback, source: "FALLBACK", outcome: "FALLBACK:SESSION_DEGRADED" };

  const provider = resolveProvider(p.provider);
  const baseMeta: CallMeta = { provider: provider?.name ?? "none", model: provider?.generatorModel ?? "none", promptVersion: COACH_PROMPT_VERSION, latencyMs: 0 };
  const details = { feature: "MEMORIZATION_COACH", planId: p.planId, exerciseNumber: p.ctx.played.length + 1 };
  const fail = async (reason: string, status: "MALFORMED_OUTPUT" | "PROVIDER_ERROR", meta: CallMeta, extra: Record<string, unknown> = {}, raw?: unknown) => {
    await logAIInteraction(db, { type: "DECIDE_MEMORIZATION_EXERCISE", status, meta, userId: p.userId, details: { ...details, decisionSource: "FALLBACK", fallbackReason: reason, ...extra }, raw });
    return { decision: fallback, source: "FALLBACK" as const, outcome: `FALLBACK:${reason}` };
  };
  if (!provider) return fail("NOT_CONFIGURED", "PROVIDER_ERROR", baseMeta);

  const started = Date.now();
  let response;
  try {
    response = await requestCoachDecision(provider, buildCoachPayload(p.ctx, COACH_PROMPT_VERSION), p.timeoutMs);
  } catch (error) {
    const code = error instanceof AIProviderError ? error.code : "UNAVAILABLE";
    return fail(code, "PROVIDER_ERROR", { ...baseMeta, latencyMs: Date.now() - started });
  }
  const meta: CallMeta = { provider: response.provider, model: response.model, promptVersion: COACH_PROMPT_VERSION, latencyMs: response.latencyMs, stopReason: response.stopReason ?? null, usage: response.usage };
  const checked = validateCoachDecision(response.data, p.ctx);
  if (!checked.ok) return fail("VALIDATION_REJECTED", "MALFORMED_OUTPUT", meta, { validation: checked.reason }, response.data);
  await logAIInteraction(db, {
    type: "DECIDE_MEMORIZATION_EXERCISE",
    status: "SUCCESS",
    meta,
    userId: p.userId,
    details: { ...details, decisionSource: "AI", validation: "PASSED", action: checked.decision.action, exerciseType: checked.decision.action === "EXERCISE" ? checked.decision.exercise.exerciseType : null },
  });
  return { decision: checked.decision, source: "AI", outcome: "AI_ACCEPTED" };
}

/** Ensures the next step exists: returns the current exercise, decides the next one, or closes the session. */
export async function advanceCoach(db: PrismaClient, userId: string, planId: string, deps: CoachDeps = {}): Promise<CoachView | null> {
  const now = deps.now ?? new Date();
  const plan = await loadPlan(db, userId, planId);
  if (!plan) return null;
  const rows = await exercisesOf(db, plan.row.id);
  if (plan.row.status !== "READY") return buildView(db, plan, rows);
  const last = rows.at(-1);

  if (last && !last.readyAt) {
    if (now.getTime() - last.createdAt.getTime() < STALE_PENDING_MS) return buildView(db, plan, rows);
    // An abandoned claim: finish it deterministically. Never a (second) AI call for this decision.
    const ctx = await contextFor(db, userId, plan, rows.slice(0, -1));
    const decision = deterministicDecision(ctx);
    await fillClaim(db, last.id, decision, "FALLBACK", "FALLBACK:STALE_PENDING", now);
    if (decision.action === "FINISH") await completePlan(db, plan.row.id, answeredCount(ctx), now);
    return getCoachView(db, userId, planId);
  }
  if (last && isFinishMarker(last)) {
    await completePlan(db, plan.row.id, played(rows).filter((e) => e.response).length, now);
    return getCoachView(db, userId, planId);
  }
  if (last && last.response === null) return buildView(db, plan, rows);

  const ctx = await contextFor(db, userId, plan, rows);
  if (sessionDone(ctx)) {
    await completePlan(db, plan.row.id, answeredCount(ctx), now);
    return getCoachView(db, userId, planId);
  }

  // Claim the next position. A concurrent request (refresh, double click, second tab) loses here — before any AI call.
  let claimId: string;
  try {
    claimId = (await db.memorizationReinforcementExercise.create({ data: { planId: plan.row.id, order: rows.length + 1, createdAt: now }, select: { id: true } })).id;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return getCoachView(db, userId, planId);
    throw error;
  }
  const chosen = await decide(db, { userId, planId: plan.row.id, ctx, rows, provider: deps.provider, timeoutMs: deps.timeoutMs });
  await fillClaim(db, claimId, chosen.decision, chosen.source, chosen.outcome, now);
  if (chosen.decision.action === "FINISH") await completePlan(db, plan.row.id, answeredCount(ctx), now);
  return getCoachView(db, userId, planId);
}

// ───────────────────────────── Learner actions ─────────────────────────────

async function ownedExercise(db: PrismaClient, userId: string, planId: string, exerciseId: string) {
  const plan = await loadPlan(db, userId, planId);
  if (!plan) throw new AppError("NOT_FOUND", "جولة التثبيت غير متاحة.");
  const exercise = await db.memorizationReinforcementExercise.findFirst({ where: { id: exerciseId, planId: plan.row.id, readyAt: { not: null }, exerciseType: { not: null } }, select: { id: true, revealedAt: true, response: true } });
  if (!exercise) throw new AppError("NOT_FOUND", "هذا التمرين غير متاح.");
  return { plan, exercise };
}

/** Reveals the canonical answer of one exercise (idempotent). Only now is hidden canonical text sent to the browser. */
export async function revealExercise(db: PrismaClient, userId: string, planId: string, exerciseId: string, now = new Date()): Promise<CoachView | null> {
  const { exercise } = await ownedExercise(db, userId, planId, exerciseId);
  if (!exercise.revealedAt) await db.memorizationReinforcementExercise.updateMany({ where: { id: exercise.id, revealedAt: null }, data: { revealedAt: now } });
  return getCoachView(db, userId, planId);
}

/**
 * Records the learner's self-report for an exercise whose answer was revealed (first answer wins — a double click or a
 * second tab cannot change it), then advances to the next exercise.
 */
export async function respondExercise(db: PrismaClient, userId: string, planId: string, exerciseId: string, response: unknown, deps: CoachDeps = {}): Promise<CoachView | null> {
  if (typeof response !== "string" || !(RESPONSES as readonly string[]).includes(response)) throw new AppError("BAD_REQUEST");
  const now = deps.now ?? new Date();
  const { exercise } = await ownedExercise(db, userId, planId, exerciseId);
  if (!exercise.revealedAt) throw new AppError("BAD_REQUEST", "أظهر النص أولًا ثم قيّم استذكارك.");
  if (!exercise.response) await db.memorizationReinforcementExercise.updateMany({ where: { id: exercise.id, response: null }, data: { response: response as RecallResponse, respondedAt: now } });
  return advanceCoach(db, userId, planId, deps);
}
