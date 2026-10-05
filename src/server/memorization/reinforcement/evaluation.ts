import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { isUnitLevelEvidence, type IssueKind, type MemorizationPerformanceFacts } from "./facts";
import { loadAttemptFacts } from "./service";

/**
 * Evaluation-ready outcome data (no experiment is run here).
 *
 * Primary outcome: affected positions BEFORE review vs AFTER the linked re-recitation, from the learner's own two
 * self-assessments. Word-level and unit-level (FULL_UNIT / legacy) positions are reported separately — a FULL_UNIT is
 * never counted as N words — and INCORRECT / FORGOTTEN stay separable. A rate is given only where its denominator is
 * meaningful. No educational score is invented.
 */

type ByKind = Record<IssueKind, number>;
export type LevelOutcome = { before: ByKind; resolved: ByKind; remaining: ByKind; newAffected: ByKind; resolutionRate: number | null };
export type DetailedOutcome = { word: LevelOutcome; unit: LevelOutcome };

const zero = (): ByKind => ({ INCORRECT: 0, FORGOTTEN: 0 });
const level = (): LevelOutcome => ({ before: zero(), resolved: zero(), remaining: zero(), newAffected: zero(), resolutionRate: null });

/**
 * resolved: affected before → CORRECT after (same unit; word positions only where the word is no longer marked);
 * remaining: affected before → still affected after (any kind / granularity); newAffected: affected after, not before.
 * Before-positions are classified by their BEFORE kind/level; new positions by their AFTER kind/level. Totals equal
 * compareAssessments() (nowCorrect / remaining / newlyAffected).
 */
export function compareOutcomeDetailed(before: MemorizationPerformanceFacts, after: MemorizationPerformanceFacts): DetailedOutcome {
  const out: DetailedOutcome = { word: level(), unit: level() };
  const afterUnits = new Map(after.units.map((u) => [u.unitId, u]));
  const beforeUnits = new Map(before.units.map((u) => [u.unitId, u]));
  const idOf = (f: MemorizationPerformanceFacts) => new Map(f.units.map((u) => [u.ref, u.unitId]));
  const beforeIds = idOf(before);
  for (const p of before.affected) {
    const bucket = p.level === "WORD" ? out.word : out.unit;
    bucket.before[p.kind] += 1;
    const u = afterUnits.get(beforeIds.get(p.unitRef)!);
    if (!u) continue;
    const stillAffected = u.evidence !== "CORRECT" && (u.unitIssue !== null || p.token === null || u.incorrect.includes(p.token) || u.forgotten.includes(p.token));
    (stillAffected ? bucket.remaining : bucket.resolved)[p.kind] += 1;
  }
  const afterIds = idOf(after);
  for (const p of after.affected) {
    const b = beforeUnits.get(afterIds.get(p.unitRef)!);
    const isNew = !b || b.evidence === "CORRECT" || (!isUnitLevelEvidence(b.evidence) && p.token !== null && !b.incorrect.includes(p.token) && !b.forgotten.includes(p.token));
    if (isNew) (p.level === "WORD" ? out.word : out.unit).newAffected[p.kind] += 1;
  }
  for (const l of [out.word, out.unit]) {
    const n = l.before.INCORRECT + l.before.FORGOTTEN;
    l.resolutionRate = n > 0 ? Math.round(((l.resolved.INCORRECT + l.resolved.FORGOTTEN) / n) * 1000) / 1000 : null;
  }
  return out;
}

export type EvaluationExercise = {
  order: number;
  exerciseType: string | null;
  action: "EXERCISE" | "FINISH";
  targetRefs: string[];
  contextLevel: string | null;
  cueLevel: string | null;
  reasonCode: string | null;
  decisionSource: string | null;
  decisionOutcome: string | null;
  response: string | null;
  /** Server-observed time from exercise ready to self-report (null when not answered). */
  durationMs: number | null;
};
export type EvaluationRow = {
  sessionKey: string;
  learnerKey: string;
  reviewMode: "AI_ADAPTIVE_REVIEW" | "BASELINE_REVIEW";
  /** Who chose the session plan: AI | DETERMINISTIC (AI unnecessary) | FALLBACK (AI failed / rejected) | NONE (baseline). */
  plannerSource: "AI" | "DETERMINISTIC" | "FALLBACK" | "NONE";
  status: string;
  exercises: EvaluationExercise[];
  exposuresByTarget: Record<string, number>;
  outcome: DetailedOutcome | null;
};

const pseudonym = (value: string, salt: string) => createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 16);

/**
 * One row per reinforcement session: condition → planner → exercises → responses → re-recitation → before/after.
 * Pseudonymous keys only (salted hashes); no user id, email, name, audio, transcript or Matn text.
 */
export async function exportReinforcementEvaluation(db: PrismaClient, salt: string): Promise<EvaluationRow[]> {
  if (!salt) throw new Error("An evaluation salt is required for pseudonymous keys.");
  const plans = await db.memorizationReinforcementPlan.findMany({
    where: { status: { in: ["READY", "COMPLETED", "SKIPPED"] } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      status: true,
      reviewMode: true,
      planSource: true,
      aiOutcome: true,
      facts: true,
      followUpAttemptId: true,
      exercises: { orderBy: { order: "asc" }, select: { order: true, exerciseType: true, targetRefs: true, contextLevel: true, cueLevel: true, reasonCode: true, decisionSource: true, decisionOutcome: true, response: true, readyAt: true, respondedAt: true } },
    },
  });
  const rows: EvaluationRow[] = [];
  for (const p of plans) {
    const plannerSource = p.reviewMode === "BASELINE_REVIEW" || p.planSource === "NONE" ? "NONE" : p.aiOutcome?.startsWith("FALLBACK") ? "FALLBACK" : (p.planSource ?? "DETERMINISTIC");
    const exposuresByTarget: Record<string, number> = {};
    for (const e of p.exercises) if (e.response) for (const r of e.targetRefs) exposuresByTarget[r] = (exposuresByTarget[r] ?? 0) + 1;
    let outcome: DetailedOutcome | null = null;
    if (p.followUpAttemptId && p.facts) {
      const after = await loadAttemptFacts(db, p.userId, p.followUpAttemptId);
      if (after) outcome = compareOutcomeDetailed(p.facts as unknown as MemorizationPerformanceFacts, after.facts);
    }
    rows.push({
      sessionKey: pseudonym(p.id, salt),
      learnerKey: pseudonym(p.userId, salt),
      reviewMode: p.reviewMode,
      plannerSource,
      status: p.status,
      exercises: p.exercises.map((e) => ({
        order: e.order,
        exerciseType: e.exerciseType,
        action: e.exerciseType ? "EXERCISE" : "FINISH",
        targetRefs: e.targetRefs,
        contextLevel: e.contextLevel,
        cueLevel: e.cueLevel,
        reasonCode: e.reasonCode,
        decisionSource: e.decisionSource,
        decisionOutcome: e.decisionOutcome,
        response: e.response,
        durationMs: e.readyAt && e.respondedAt ? e.respondedAt.getTime() - e.readyAt.getTime() : null,
      })),
      exposuresByTarget,
      outcome,
    });
  }
  return rows;
}
