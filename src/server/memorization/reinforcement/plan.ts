import { z } from "zod";
import { isUnitLevelEvidence, type MemorizationPerformanceFacts, type UnitFact } from "./facts";

/**
 * The bounded decision space of immediate reinforcement, plus the two planners' shared contract:
 *
 *  - `buildDeterministicPlan` — always available; used when AI adds no decision value or fails.
 *  - `decideAINecessity`      — deterministic: is there a real choice for AI to make?
 *  - `validatePlan`           — independent of any planner. AI output that fails ANY rule is discarded (no repair call).
 *
 * A plan contains only enums, pseudonymous unit refs («u3») and canonical token indexes that already exist as
 * learner-marked evidence. It never contains Matn text: the backend resolves canonical units after validation.
 */

export const PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export const CONTEXT_STRATEGIES = ["TARGET_UNIT_ONLY", "PREVIOUS_AND_TARGET", "TARGET_AND_NEXT", "PREVIOUS_TARGET_NEXT"] as const;
/** DELAYED recall is expressed as `repeatPolicy = REPEAT_LATER_IN_SESSION` on any strategy, not as a fourth strategy. */
export const STRATEGIES = ["TARGETED_RECALL", "FULL_UNIT_RECALL", "SEQUENCE_RECALL"] as const;
export const REPEAT_POLICIES = ["ONCE", "REPEAT_LATER_IN_SESSION"] as const;
export const REASON_CODES = [
  "FULL_UNIT_FORGOTTEN",
  "REPEATED_FORGOTTEN",
  "PERSISTENT_ISSUE",
  "CURRENT_FORGOTTEN",
  "FULL_UNIT_INCORRECT",
  "REPEATED_INCORRECT",
  "MIXED_ISSUES",
  "CURRENT_INCORRECT",
  "ADJACENT_ISSUES",
] as const;
export const OBSERVATION_KEYS = [
  "REPEATED_FORGOTTEN",
  "REPEATED_INCORRECT",
  "NEW_AND_RESOLVED",
  "PERSISTENT_ISSUE",
  "FULL_UNIT_FORGOTTEN",
  "CLUSTERED_FORGOTTEN",
  "CLUSTERED_ISSUES",
  "MIXED_IN_UNIT",
  "RESOLVED_PREVIOUS",
  "FIRST_ATTEMPT",
  "FORGETTING_DOMINANT",
  "INCORRECT_DOMINANT",
  "SCATTERED_ISSUES",
  "SINGLE_ISSUE",
] as const;

export type Priority = (typeof PRIORITIES)[number];
export type ContextStrategy = (typeof CONTEXT_STRATEGIES)[number];
export type Strategy = (typeof STRATEGIES)[number];
export type RepeatPolicy = (typeof REPEAT_POLICIES)[number];
export type ReasonCode = (typeof REASON_CODES)[number];
export type ObservationKey = (typeof OBSERVATION_KEYS)[number];

/** Deterministic caps. A target is shown at most twice; the whole window (target + context) is at most 3 canonical units. */
export const PLAN_CAPS = { maxExposuresPerTarget: 2, maxRepeatedTargets: 3, maxContextUnits: 3, maxSequenceUnits: 3, maxTargets: 20 } as const;

export type PlanTarget = {
  unitRefs: string[];
  tokens: { unitRef: string; index: number }[];
  priority: Priority;
  contextStrategy: ContextStrategy;
  strategy: Strategy;
  repeatPolicy: RepeatPolicy;
  reasonCode: ReasonCode;
};
export type ReinforcementPlan = { observationKey: ObservationKey; targets: PlanTarget[] };

// ───────────────────────────── What the facts support ─────────────────────────────

const unitByRef = (facts: MemorizationPerformanceFacts) => new Map(facts.units.map((u) => [u.ref, u]));
const affectedTokens = (u: UnitFact) => [...new Set([...u.incorrect, ...u.forgotten])].sort((a, b) => a - b);

/** Reason codes the evidence of a group of units actually supports. */
export function supportedReasonCodes(facts: MemorizationPerformanceFacts, refs: string[]): Set<ReasonCode> {
  const out = new Set<ReasonCode>();
  const set = new Set(refs);
  const byRef = unitByRef(facts);
  for (const ref of refs) {
    const u = byRef.get(ref);
    if (!u) continue;
    if (u.unitIssue === "FORGOTTEN") out.add("FULL_UNIT_FORGOTTEN");
    if (u.unitIssue === "INCORRECT") out.add("FULL_UNIT_INCORRECT");
    if (u.forgotten.length) out.add("CURRENT_FORGOTTEN");
    if (u.incorrect.length) out.add("CURRENT_INCORRECT");
    if (u.forgotten.length && u.incorrect.length) out.add("MIXED_ISSUES");
  }
  for (const p of facts.affected) {
    if (!set.has(p.unitRef)) continue;
    if (p.history === "REPEATED") out.add(p.kind === "FORGOTTEN" ? "REPEATED_FORGOTTEN" : "REPEATED_INCORRECT");
    if (p.history === "PERSISTENT") out.add("PERSISTENT_ISSUE");
  }
  if (refs.length >= 2) out.add("ADJACENT_ISSUES");
  return out;
}

/** Observation keys the facts support. Any history-based key requires real comparable history. */
export function supportedObservationKeys(facts: MemorizationPerformanceFacts): Set<ObservationKey> {
  const out = new Set<ObservationKey>();
  if (!facts.hasIssues) return out;
  const a = facts.affected;
  if (a.some((p) => p.history === "REPEATED" && p.kind === "FORGOTTEN")) out.add("REPEATED_FORGOTTEN");
  if (a.some((p) => p.history === "REPEATED" && p.kind === "INCORRECT")) out.add("REPEATED_INCORRECT");
  if (a.some((p) => p.history === "PERSISTENT")) out.add("PERSISTENT_ISSUE");
  if (facts.resolved.length > 0) out.add("RESOLVED_PREVIOUS");
  if (facts.resolved.length > 0 && a.some((p) => p.history === "NEW")) out.add("NEW_AND_RESOLVED");
  if (facts.history.firstComparableAttempt) out.add("FIRST_ATTEMPT");
  if (facts.unitSummary.fullUnitForgotten > 0 || a.some((p) => p.level === "UNIT" && p.kind === "FORGOTTEN")) out.add("FULL_UNIT_FORGOTTEN");
  const clustered = facts.adjacency.tokenRuns.length > 0 || facts.adjacency.boundaryPairs.length > 0;
  if (clustered) out.add("CLUSTERED_ISSUES");
  const byRef = unitByRef(facts);
  const forgottenOnlyRun = facts.adjacency.tokenRuns.some((r) => r.kinds.length === 1 && r.kinds[0] === "FORGOTTEN");
  const forgottenOnlyPair = facts.adjacency.boundaryPairs.some(([x, y]) => [byRef.get(x)!, byRef.get(y)!].every((u) => u.incorrect.length === 0 && u.unitIssue !== "INCORRECT"));
  if (forgottenOnlyRun || forgottenOnlyPair) out.add("CLUSTERED_FORGOTTEN");
  if (facts.unitSummary.mixed > 0) out.add("MIXED_IN_UNIT");
  if (facts.pattern === "FORGETTING_DOMINANT") out.add("FORGETTING_DOMINANT");
  if (facts.pattern === "INCORRECT_DOMINANT") out.add("INCORRECT_DOMINANT");
  if (a.length === 1) out.add("SINGLE_ISSUE");
  if (a.length >= 2 && !clustered && facts.adjacency.unitGroups.length === 0) out.add("SCATTERED_ISSUES");
  return out;
}

const HISTORY_KEYS: ReadonlySet<ObservationKey> = new Set(["REPEATED_FORGOTTEN", "REPEATED_INCORRECT", "NEW_AND_RESOLVED", "PERSISTENT_ISSUE", "RESOLVED_PREVIOUS"]);

/** Window size and neighbour availability of a context choice for a target group. */
export function contextWindow(facts: MemorizationPerformanceFacts, refs: string[], context: ContextStrategy): { ok: true; before: number; after: number } | { ok: false; reason: string } {
  const byRef = unitByRef(facts);
  const first = byRef.get(refs[0]!);
  const last = byRef.get(refs.at(-1)!);
  if (!first || !last) return { ok: false, reason: "unknown unit" };
  const before = context === "PREVIOUS_AND_TARGET" || context === "PREVIOUS_TARGET_NEXT" ? 1 : 0;
  const after = context === "TARGET_AND_NEXT" || context === "PREVIOUS_TARGET_NEXT" ? 1 : 0;
  // Book boundary rule (documented): a context that needs a unit outside the book — or before the first / after the last
  // approved unit — is REJECTED, never silently widened or shifted.
  if (before && !first.hasPreviousNeighbor) return { ok: false, reason: "previous context unavailable (book boundary)" };
  if (after && !last.hasNextNeighbor) return { ok: false, reason: "next context unavailable (book boundary)" };
  if (refs.length + before + after > PLAN_CAPS.maxContextUnits) return { ok: false, reason: "context window too large" };
  return { ok: true, before, after };
}

// ───────────────────────────── Deterministic planner ─────────────────────────────

/** Fixed severity order (most urgent first). */
const REASON_RANK: Record<ReasonCode, number> = Object.fromEntries(REASON_CODES.map((c, i) => [c, i])) as Record<ReasonCode, number>;
const DETERMINISTIC_OBSERVATION_ORDER: readonly ObservationKey[] = OBSERVATION_KEYS;
const REPEAT_WORTHY: ReadonlySet<ReasonCode> = new Set(["FULL_UNIT_FORGOTTEN", "REPEATED_FORGOTTEN", "PERSISTENT_ISSUE", "REPEATED_INCORRECT"]);

function strategyFor(units: UnitFact[]): Strategy {
  if (units.length > 1) return "SEQUENCE_RECALL";
  return isUnitLevelEvidence(units[0]!.evidence) ? "FULL_UNIT_RECALL" : "TARGETED_RECALL";
}

function tokensFor(units: UnitFact[]): PlanTarget["tokens"] {
  return units.flatMap((u) => (u.evidence === "WORDS" ? affectedTokens(u).map((index) => ({ unitRef: u.ref, index })) : []));
}

/**
 * Safe, explainable plan without AI:
 *  - each affected unit is one target; two (max three) consecutive affected units whose issues touch across the
 *    boundary are merged into one SEQUENCE target;
 *  - order/priority by the fixed severity of the strongest supported reason;
 *  - context TARGET_UNIT_ONLY (always valid, never crosses a boundary);
 *  - repeated / persistent / fully-forgotten targets come back once later in the session (cap 3), only when there are
 *    other targets in between.
 */
export function buildDeterministicPlan(facts: MemorizationPerformanceFacts): ReinforcementPlan | null {
  if (!facts.hasIssues) return null;
  const touching = new Set(facts.adjacency.boundaryPairs.map(([a, b]) => `${a}|${b}`));
  const groups: UnitFact[][] = [];
  for (const u of facts.units) {
    if (u.evidence === "CORRECT") continue;
    const last = groups.at(-1);
    const prev = last?.at(-1);
    if (last && prev && touching.has(`${prev.ref}|${u.ref}`) && last.length < PLAN_CAPS.maxSequenceUnits) last.push(u);
    else groups.push([u]);
  }

  const targets = groups.map((units) => {
    const refs = units.map((u) => u.ref);
    const reasons = [...supportedReasonCodes(facts, refs)].filter((r) => r !== "ADJACENT_ISSUES" && r !== "MIXED_ISSUES").sort((a, b) => REASON_RANK[a] - REASON_RANK[b]);
    const reasonCode = reasons[0] ?? "ADJACENT_ISSUES";
    const rank = REASON_RANK[reasonCode];
    const priority: Priority = rank <= REASON_RANK.PERSISTENT_ISSUE ? "HIGH" : rank <= REASON_RANK.REPEATED_INCORRECT ? "MEDIUM" : "LOW";
    return { unitRefs: refs, tokens: tokensFor(units), priority, contextStrategy: "TARGET_UNIT_ONLY" as const, strategy: strategyFor(units), repeatPolicy: "ONCE" as RepeatPolicy, reasonCode, rank, order: facts.units.findIndex((u) => u.ref === refs[0]) };
  });
  targets.sort((a, b) => a.rank - b.rank || a.order - b.order);
  let repeats = 0;
  if (targets.length >= 2) {
    for (const t of targets) {
      if (repeats < PLAN_CAPS.maxRepeatedTargets && REPEAT_WORTHY.has(t.reasonCode)) {
        t.repeatPolicy = "REPEAT_LATER_IN_SESSION";
        repeats += 1;
      }
    }
  }
  const supported = supportedObservationKeys(facts);
  const observationKey = DETERMINISTIC_OBSERVATION_ORDER.find((k) => supported.has(k)) ?? "SINGLE_ISSUE";
  return { observationKey, targets: targets.map(({ rank: _rank, order: _order, ...t }) => t) };
}

// ───────────────────────────── AI necessity ─────────────────────────────

export type NecessityReason = "MULTIPLE_TARGETS" | "HISTORY_EVIDENCE" | "ADJACENT_UNITS";
export type NecessityDecision = { useAI: boolean; reasons: NecessityReason[] };

/**
 * AI is called only when there is a real choice to make: competing targets to order, real history to weigh, or
 * adjacent units that may be grouped. A single first-attempt target (even with mixed words) has one sensible plan.
 */
export function decideAINecessity(facts: MemorizationPerformanceFacts): NecessityDecision {
  if (!facts.hasIssues) return { useAI: false, reasons: [] };
  const reasons: NecessityReason[] = [];
  const affectedUnits = facts.units.filter((u) => u.evidence !== "CORRECT").length;
  if (affectedUnits >= 2) reasons.push("MULTIPLE_TARGETS");
  if (facts.history.repeated + facts.history.persistent + facts.history.resolved > 0) reasons.push("HISTORY_EVIDENCE");
  if (facts.adjacency.unitGroups.length > 0) reasons.push("ADJACENT_UNITS");
  return { useAI: reasons.length > 0, reasons };
}

// ───────────────────────────── Strict validator ─────────────────────────────

const ref = z.string().regex(/^u([1-9]|1[0-9]|20)$/);
const planSchema = z
  .object({
    observationKey: z.enum(OBSERVATION_KEYS),
    targets: z
      .array(
        z
          .object({
            unitRefs: z.array(ref).min(1).max(PLAN_CAPS.maxSequenceUnits),
            tokens: z.array(z.object({ unitRef: ref, index: z.number().int().min(0).max(499) }).strict()).max(200),
            priority: z.enum(PRIORITIES),
            contextStrategy: z.enum(CONTEXT_STRATEGIES),
            strategy: z.enum(STRATEGIES),
            repeatPolicy: z.enum(REPEAT_POLICIES),
            reasonCode: z.enum(REASON_CODES),
          })
          .strict(),
      )
      .min(1)
      .max(PLAN_CAPS.maxTargets),
  })
  .strict();

export type PlanValidation = { ok: true; plan: ReinforcementPlan } | { ok: false; reason: string };

/** Validates ANY plan (AI or deterministic) against the facts. Returns the first violated rule. */
export function validatePlan(raw: unknown, facts: MemorizationPerformanceFacts): PlanValidation {
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: `schema: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? "invalid"}`.trim() };
  const plan = parsed.data as ReinforcementPlan;
  const fail = (reason: string): PlanValidation => ({ ok: false, reason });
  const byRef = unitByRef(facts);
  const order = new Map(facts.units.map((u, i) => [u.ref, i]));

  if (!facts.hasIssues) return fail("plan without any affected position");
  if (!supportedObservationKeys(facts).has(plan.observationKey)) {
    return fail(HISTORY_KEYS.has(plan.observationKey) ? `observation ${plan.observationKey} needs comparable history that does not exist` : `unsupported observation ${plan.observationKey}`);
  }

  const covered = new Set<string>();
  let repeats = 0;
  for (const [i, t] of plan.targets.entries()) {
    const where = `target ${i + 1}`;
    const units = t.unitRefs.map((r) => byRef.get(r));
    if (units.some((u) => !u)) return fail(`${where}: unknown unit`);
    const us = units as UnitFact[];
    // Contiguous canonical order (same session = same book, consecutive approved units).
    for (let k = 1; k < us.length; k++) if (order.get(us[k]!.ref)! !== order.get(us[k - 1]!.ref)! + 1) return fail(`${where}: units are not contiguous`);
    if (us.some((u) => u.evidence === "CORRECT")) return fail(`${where}: unit has no affected evidence`);
    for (const u of us) {
      if (covered.has(u.ref)) return fail(`${where}: duplicate target for ${u.ref}`);
      covered.add(u.ref);
    }

    // Tokens: only real word-level evidence, exactly the affected words of the WORDS units in the group.
    const seen = new Set<string>();
    for (const tok of t.tokens) {
      const u = byRef.get(tok.unitRef);
      if (!u || !t.unitRefs.includes(tok.unitRef)) return fail(`${where}: token outside target units`);
      if (tok.index >= u.tokenCount) return fail(`${where}: token index out of range`);
      if (u.evidence !== "WORDS") return fail(`${where}: word token on unit-level evidence`);
      if (!u.incorrect.includes(tok.index) && !u.forgotten.includes(tok.index)) return fail(`${where}: token ${tok.unitRef}#${tok.index} was not marked by the learner`);
      const key = `${tok.unitRef}#${tok.index}`;
      if (seen.has(key)) return fail(`${where}: duplicate token`);
      seen.add(key);
    }
    const expected = us.flatMap((u) => (u.evidence === "WORDS" ? affectedTokens(u).map((index) => `${u.ref}#${index}`) : []));
    if (expected.length !== seen.size || expected.some((k) => !seen.has(k))) return fail(`${where}: tokens must be exactly the marked words`);

    if (t.strategy === "TARGETED_RECALL" && (us.length !== 1 || us[0]!.evidence !== "WORDS")) return fail(`${where}: TARGETED_RECALL needs one unit with word-level evidence`);
    if (t.strategy === "FULL_UNIT_RECALL" && (us.length !== 1 || !isUnitLevelEvidence(us[0]!.evidence))) return fail(`${where}: FULL_UNIT_RECALL needs one unit with unit-level evidence`);
    if (t.strategy === "SEQUENCE_RECALL" && us.length < 2) return fail(`${where}: SEQUENCE_RECALL needs 2–3 units`);
    if (us.length > 1 && t.strategy !== "SEQUENCE_RECALL") return fail(`${where}: multi-unit target must be SEQUENCE_RECALL`);

    const window = contextWindow(facts, t.unitRefs, t.contextStrategy);
    if (!window.ok) return fail(`${where}: ${window.reason}`);
    if (!supportedReasonCodes(facts, t.unitRefs).has(t.reasonCode)) return fail(`${where}: reason ${t.reasonCode} is not supported by the facts`);
    if (t.repeatPolicy === "REPEAT_LATER_IN_SESSION") repeats += 1;
  }
  const affectedUnits = facts.units.filter((u) => u.evidence !== "CORRECT").map((u) => u.ref);
  if (affectedUnits.some((r) => !covered.has(r))) return fail("plan leaves an affected unit without a target");
  if (repeats > PLAN_CAPS.maxRepeatedTargets) return fail("too many repeated targets");
  return { ok: true, plan };
}

/** Exposure order of a reinforcement session: every target once, then REPEAT_LATER targets once more (≤ 2 each). */
export function exposureOrder(plan: ReinforcementPlan): number[] {
  const first = plan.targets.map((_, i) => i);
  const later = plan.targets.flatMap((t, i) => (t.repeatPolicy === "REPEAT_LATER_IN_SESSION" ? [i] : [])).slice(0, PLAN_CAPS.maxRepeatedTargets);
  return [...first, ...later];
}
