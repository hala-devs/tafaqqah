import type { PrismaClient } from "@/generated/prisma/client";
import { tokenizeCanonicalMatn } from "@/lib/matn-tokens";
import type { IssueKind, MemorizationPerformanceFacts } from "./facts";
import { loadBookUnits } from "./service";

/**
 * BASELINE_REVIEW (evaluation condition, never shown to ordinary learners): «review your actual mistakes using the
 * correct source». Every affected unit is shown in full canonical text, in canonical order, with exactly the positions
 * the learner marked. No AI, no exercises, no personalised sequence, no hiding, no time limit. Then the same
 * re-recitation and the same before/after measurement as the adaptive condition.
 */

export type BaselineToken = { text: string; mark: IssueKind | null };
export type BaselineUnit = { position: number; evidence: "WORDS" | "FULL_UNIT" | "LEGACY_UNIT"; unitIssue: IssueKind | null; tokens: BaselineToken[] };
export type BaselineView = {
  planId: string;
  status: "READY" | "COMPLETED" | "SKIPPED";
  units: BaselineUnit[];
  recite: { passageId: string; startUnitId: string; size: number };
  alreadyReRecited: boolean;
};

/** Null when the plan is not this learner's baseline session, or when any affected unit is no longer approved / drifted (fail closed). */
export async function getBaselineReview(db: PrismaClient, userId: string, planId: string): Promise<BaselineView | null> {
  const row = await db.memorizationReinforcementPlan.findFirst({
    where: { id: planId, userId, reviewMode: "BASELINE_REVIEW", status: { in: ["READY", "COMPLETED", "SKIPPED"] } },
    select: { id: true, status: true, facts: true, followUpAttemptId: true, sourceAttempt: { select: { passageId: true, passage: { select: { section: { select: { courseId: true } } } } } } },
  });
  if (!row?.facts) return null;
  const facts = row.facts as unknown as MemorizationPerformanceFacts;
  const book = await loadBookUnits(db, row.sourceAttempt.passage.section.courseId);
  const byId = new Map(book.map((u) => [u.id, u]));
  const units: BaselineUnit[] = [];
  for (const [i, u] of facts.units.entries()) {
    if (u.evidence === "CORRECT") continue;
    const canonical = byId.get(u.unitId);
    if (!canonical || !canonical.eligible) return null;
    const tokens = tokenizeCanonicalMatn(canonical.text);
    if (tokens.length !== u.tokenCount) return null;
    units.push({
      position: i + 1,
      evidence: u.evidence,
      unitIssue: u.unitIssue,
      tokens: tokens.map((text, index) => ({ text, mark: u.incorrect.includes(index) ? "INCORRECT" : u.forgotten.includes(index) ? "FORGOTTEN" : null })),
    });
  }
  if (units.length === 0) return null;
  return {
    planId: row.id,
    status: row.status as BaselineView["status"],
    units,
    recite: { passageId: row.sourceAttempt.passageId, startUnitId: facts.units[0]!.unitId, size: facts.units.length },
    alreadyReRecited: row.followUpAttemptId !== null,
  };
}
