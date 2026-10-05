import { z } from "zod";
import { normalizeArabic } from "@/server/ai/arabic";
import { isUnitLevelEvidence, type MemorizationPerformanceFacts, type UnitFact } from "./facts";

/**
 * The interactive reinforcement coach — the pure half (no database, no AI, no Matn text).
 *
 *   SOURCE determines the content      → the backend resolves canonical tokens AFTER validation (see renderExercise).
 *   LEARNER determines what was wrong  → only learner-marked positions (facts) may be hidden; responses are self-reports.
 *   CODE determines facts and limits   → deriveSession() / COACH_CAPS / sessionDone(); the AI never sets a limit.
 *   AI designs the next exercise       → one structured decision per step (exercise type, units, hidden token indexes,
 *                                        context, cue, reason code), chosen from the finite tools below.
 *   VALIDATOR controls the AI          → validateCoachDecision(); any failure → deterministicDecision(), no second call.
 *
 * Refs: units are the session-local refs of the facts («u1» = first unit of the recited session).
 */

export const EXERCISE_TYPES = [
  "CLOZE_RECALL",
  "CONTEXT_RECALL",
  "REDUCED_CUE_RECALL",
  "SEQUENCE_RECALL",
  "DELAYED_RECALL",
  "WHOLE_UNIT_RECALL",
  "LINKED_SEQUENCE_RECALL",
] as const;
/** Canonical neighbour units shown as a retrieval cue around the target units. */
export const CONTEXT_LEVELS = ["NONE", "PREVIOUS", "NEXT", "BOTH"] as const;
/** How much of the target unit's OWN non-hidden words stays visible: all, ±3 words, ±1 word, nothing. */
export const CUE_LEVELS = ["FULL", "PARTIAL", "MINIMAL", "NONE"] as const;
export const COACH_REASON_CODES = [
  "NEW_SINGLE_TARGET",
  "REPEATED_TARGET",
  "PERSISTENT_TARGET",
  "ADJACENT_TARGETS",
  "BOUNDARY_TARGETS",
  "FAILED_TARGETED_RECALL",
  "SUCCEEDED_WITH_CONTEXT",
  "FAILED_AFTER_CUE_REDUCTION",
  "DELAYED_RECHECK",
  "FULL_UNIT_WEAKNESS",
  "MULTIPLE_RELATED_TARGETS",
  "PREVIOUS_INTERVENTION_REMAINED",
] as const;
export const RESPONSES = ["RECALLED", "PARTIAL", "NOT_RECALLED"] as const;

export type ExerciseType = (typeof EXERCISE_TYPES)[number];
export type ContextLevel = (typeof CONTEXT_LEVELS)[number];
export type CueLevel = (typeof CUE_LEVELS)[number];
export type CoachReasonCode = (typeof COACH_REASON_CODES)[number];
export type RecallResponse = (typeof RESPONSES)[number];

/**
 * Deterministic limits («الكود يحدد الحدود»). Budget = min(maxExercises, max(minBudget, perTarget × targets)).
 * A target closes after a stable recall (reduced cue / delayed / whole unit), maxExposuresPerTarget exposures, or
 * maxConsecutiveFailures NOT_RECALLED in a row (the canonical answer has been revealed each time — safe resolution).
 */
export const COACH_CAPS = {
  maxExercises: 8,
  minBudget: 4,
  exercisesPerTarget: 3,
  maxExposuresPerTarget: 4,
  maxDelayedPerTarget: 1,
  maxConsecutiveFailures: 2,
  maxWindowUnits: 3,
  /** Visible neighbourhood (in words) of a hidden word per cue level. */
  cueRadius: { FULL: Infinity, PARTIAL: 3, MINIMAL: 1, NONE: 0 } as Record<CueLevel, number>,
} as const;

const SINGLE_UNIT_TYPES: ReadonlySet<ExerciseType> = new Set(["CLOZE_RECALL", "CONTEXT_RECALL", "REDUCED_CUE_RECALL", "DELAYED_RECALL", "WHOLE_UNIT_RECALL"]);
/** Types that need learner-marked WORDS (they hide individual canonical tokens). */
const WORD_ONLY_TYPES: ReadonlySet<ExerciseType> = new Set(["CLOZE_RECALL", "CONTEXT_RECALL", "REDUCED_CUE_RECALL"]);

export type HiddenToken = { unitRef: string; index: number };
export type ExerciseDecision = {
  exerciseType: ExerciseType;
  /** Target units, contiguous in canonical order (1, or 2–3 for sequences). */
  unitRefs: string[];
  /** Learner-marked canonical token indexes to hide. Unit-level units are hidden whole and take no tokens. */
  hiddenTokens: HiddenToken[];
  contextLevel: ContextLevel;
  cueLevel: CueLevel;
  reasonCode: CoachReasonCode;
};
export type CoachDecision = { action: "EXERCISE"; exercise: ExerciseDecision } | { action: "FINISH" };

/** What happened the last time this unit was reinforced (an earlier session with a re-recitation). Evidence, not cause. */
export type InterventionOutcome = "REMAINED_AFFECTED" | "RETURNED_LATER" | "NO_FOLLOW_UP";
export type PreviousIntervention = { exerciseTypes: ExerciseType[]; lastResponse: RecallResponse | null; outcome: InterventionOutcome };

export type PlayedExercise = ExerciseDecision & { order: number; response: RecallResponse | null };

export type CoachContext = {
  facts: MemorizationPerformanceFacts;
  /** Affected units grouped and ordered as in the validated reinforcement plan (priority order). */
  targetGroups: string[][];
  previous: Record<string, PreviousIntervention>;
  /** Exercises already shown in this session, in order. */
  played: PlayedExercise[];
};

// ───────────────────────────── Session-local facts (deterministic) ─────────────────────────────

export type TargetState = {
  ref: string;
  unitLevel: boolean;
  exposures: number;
  delayedReturns: number;
  consecutiveFailures: number;
  lastResponse: RecallResponse | null;
  lastOrder: number | null;
  lastExercise: { exerciseType: ExerciseType; contextLevel: ContextLevel; cueLevel: CueLevel } | null;
  /** Other exercises (not touching this unit) since its last exposure. */
  exercisesSinceLast: number;
  succeededWithCue: boolean;
  failedAfterCueReduction: boolean;
  recalledOnDelay: boolean;
  triedWholeUnit: boolean;
  closed: boolean;
  closedBy: "STABLE" | "EXPOSURE_CAP" | "FAILURE_CAP" | null;
};

const CUE_RANK: Record<CueLevel, number> = { FULL: 3, PARTIAL: 2, MINIMAL: 1, NONE: 0 };
/** Cue strength of an exercise: own-unit cue, +1 when canonical neighbour context is shown; whole-unit recall = 0. */
export function cueStrength(e: { exerciseType: ExerciseType; contextLevel: ContextLevel; cueLevel: CueLevel }): number {
  if (e.exerciseType === "WHOLE_UNIT_RECALL") return e.contextLevel === "NONE" ? 0 : 1;
  return CUE_RANK[e.cueLevel] + (e.contextLevel === "NONE" ? 0 : 1);
}

const unitsByRef = (facts: MemorizationPerformanceFacts) => new Map(facts.units.map((u) => [u.ref, u]));
const isAffected = (u: UnitFact) => u.evidence !== "CORRECT";
const markedTokens = (u: UnitFact) => [...new Set([...u.incorrect, ...u.forgotten])].sort((a, b) => a - b);

export function affectedRefs(ctx: CoachContext): string[] {
  return ctx.targetGroups.flat();
}

export function sessionBudget(ctx: Pick<CoachContext, "targetGroups">): number {
  const targets = ctx.targetGroups.flat().length;
  return Math.min(COACH_CAPS.maxExercises, Math.max(COACH_CAPS.minBudget, COACH_CAPS.exercisesPerTarget * targets));
}

/** Derives every target's session-local facts from the exercises played so far. Pure and deterministic. */
export function deriveSession(ctx: CoachContext): Map<string, TargetState> {
  const byRef = unitsByRef(ctx.facts);
  const states = new Map<string, TargetState>();
  for (const ref of affectedRefs(ctx)) {
    states.set(ref, {
      ref,
      unitLevel: isUnitLevelEvidence(byRef.get(ref)!.evidence),
      exposures: 0,
      delayedReturns: 0,
      consecutiveFailures: 0,
      lastResponse: null,
      lastOrder: null,
      lastExercise: null,
      exercisesSinceLast: 0,
      succeededWithCue: false,
      failedAfterCueReduction: false,
      recalledOnDelay: false,
      triedWholeUnit: false,
      closed: false,
      closedBy: null,
    });
  }
  for (const e of ctx.played) {
    if (e.response === null) continue;
    for (const s of states.values()) if (!e.unitRefs.includes(s.ref) && s.exposures > 0) s.exercisesSinceLast += 1;
    for (const ref of e.unitRefs) {
      const s = states.get(ref);
      if (!s) continue; // a correct unit shown inside a sequence: no target state
      s.exposures += 1;
      s.lastResponse = e.response;
      s.lastOrder = e.order;
      s.lastExercise = { exerciseType: e.exerciseType, contextLevel: e.contextLevel, cueLevel: e.cueLevel };
      s.exercisesSinceLast = 0;
      if (e.exerciseType === "DELAYED_RECALL") s.delayedReturns += 1;
      if (e.exerciseType === "WHOLE_UNIT_RECALL") s.triedWholeUnit = true;
      const reduced = e.cueLevel !== "FULL" || e.exerciseType === "WHOLE_UNIT_RECALL";
      if (e.response === "NOT_RECALLED") s.consecutiveFailures += 1;
      else s.consecutiveFailures = 0;
      if (e.response !== "NOT_RECALLED" && cueStrength(e) >= 3) s.succeededWithCue = true;
      if (e.response !== "RECALLED" && reduced) s.failedAfterCueReduction = true;
      if (e.response === "RECALLED" && e.exerciseType === "DELAYED_RECALL") s.recalledOnDelay = true;
      if (!s.closed) {
        if (e.response === "RECALLED" && (reduced || e.exerciseType === "DELAYED_RECALL")) [s.closed, s.closedBy] = [true, "STABLE"];
        else if (s.consecutiveFailures >= COACH_CAPS.maxConsecutiveFailures) [s.closed, s.closedBy] = [true, "FAILURE_CAP"];
        else if (s.exposures >= COACH_CAPS.maxExposuresPerTarget) [s.closed, s.closedBy] = [true, "EXPOSURE_CAP"];
      }
    }
  }
  return states;
}

export const answeredCount = (ctx: CoachContext) => ctx.played.filter((e) => e.response !== null).length;

/** The session is over when the budget is spent or every target is closed. Code decides — never the AI. */
export function sessionDone(ctx: CoachContext, states = deriveSession(ctx)): boolean {
  if (answeredCount(ctx) >= sessionBudget(ctx)) return true;
  return [...states.values()].every((s) => s.closed);
}

// ───────────────────────────── Window (target units + canonical context) ─────────────────────────────

export type WindowUnit = { ref: string | null; role: "TARGET" | "CONTEXT"; offset: number };

/**
 * The units an exercise shows, in canonical order. Context is a session unit when one exists next to the target, else
 * the book neighbour (ref null) when facts say an approved neighbour exists. Book boundary → rejected, never shifted.
 */
export function exerciseWindow(facts: MemorizationPerformanceFacts, unitRefs: string[], context: ContextLevel): { ok: true; units: WindowUnit[] } | { ok: false; reason: string } {
  const index = new Map(facts.units.map((u, i) => [u.ref, i]));
  const first = index.get(unitRefs[0]!);
  const last = index.get(unitRefs.at(-1)!);
  if (first === undefined || last === undefined) return { ok: false, reason: "unknown unit" };
  const before = context === "PREVIOUS" || context === "BOTH";
  const after = context === "NEXT" || context === "BOTH";
  const units: WindowUnit[] = [];
  if (before) {
    if (first > 0) units.push({ ref: facts.units[first - 1]!.ref, role: "CONTEXT", offset: -1 });
    else if (facts.units[first]!.hasPreviousNeighbor) units.push({ ref: null, role: "CONTEXT", offset: -1 });
    else return { ok: false, reason: "previous context unavailable (book boundary)" };
  }
  for (const r of unitRefs) units.push({ ref: r, role: "TARGET", offset: 0 });
  if (after) {
    if (last + 1 < facts.units.length) units.push({ ref: facts.units[last + 1]!.ref, role: "CONTEXT", offset: 1 });
    else if (facts.units[last]!.hasNextNeighbor) units.push({ ref: null, role: "CONTEXT", offset: 1 });
    else return { ok: false, reason: "next context unavailable (book boundary)" };
  }
  if (units.length > COACH_CAPS.maxWindowUnits) return { ok: false, reason: "context window too large" };
  return { ok: true, units };
}

// ───────────────────────────── Reason codes the evidence supports ─────────────────────────────

function broadWeakness(ctx: CoachContext, u: UnitFact, s: TargetState | undefined): boolean {
  if (isUnitLevelEvidence(u.evidence)) return true;
  if (markedTokens(u).length * 2 >= u.tokenCount) return true;
  if (s && s.lastResponse !== null && s.lastResponse !== "RECALLED") return true;
  if (ctx.facts.affected.some((p) => p.unitRef === u.ref && (p.history === "REPEATED" || p.history === "PERSISTENT"))) return true;
  const prev = ctx.previous[u.ref];
  return Boolean(prev && prev.outcome !== "NO_FOLLOW_UP");
}

/** Reason codes the facts + session state support for a decision. Observable evidence only — never a diagnosis. */
export function supportedCoachReasons(ctx: CoachContext, d: Pick<ExerciseDecision, "exerciseType" | "unitRefs">, states = deriveSession(ctx)): Set<CoachReasonCode> {
  const out = new Set<CoachReasonCode>();
  const byRef = unitsByRef(ctx.facts);
  const affected = d.unitRefs.filter((r) => states.has(r));
  const positions = ctx.facts.affected.filter((p) => affected.includes(p.unitRef));
  if (d.unitRefs.length === 1 && affected.length === 1 && positions.every((p) => p.history === "NEW" || p.history === "NO_HISTORY")) out.add("NEW_SINGLE_TARGET");
  if (positions.some((p) => p.history === "REPEATED")) out.add("REPEATED_TARGET");
  if (positions.some((p) => p.history === "PERSISTENT")) out.add("PERSISTENT_TARGET");
  if (affected.length >= 2) out.add("ADJACENT_TARGETS").add("MULTIPLE_RELATED_TARGETS");
  if (ctx.facts.adjacency.boundaryPairs.some(([a, b]) => d.unitRefs.includes(a) && d.unitRefs.includes(b))) out.add("BOUNDARY_TARGETS");
  for (const ref of affected) {
    const s = states.get(ref)!;
    if (s.lastResponse === "NOT_RECALLED" || s.lastResponse === "PARTIAL") out.add("FAILED_TARGETED_RECALL");
    if (s.lastResponse === "RECALLED" && s.lastExercise && cueStrength(s.lastExercise) >= 3) out.add("SUCCEEDED_WITH_CONTEXT");
    if (s.lastResponse !== null && s.lastResponse !== "RECALLED" && s.lastExercise && (s.lastExercise.cueLevel !== "FULL" || s.lastExercise.exerciseType === "WHOLE_UNIT_RECALL")) out.add("FAILED_AFTER_CUE_REDUCTION");
    const u = byRef.get(ref)!;
    if (isUnitLevelEvidence(u.evidence) || (d.exerciseType === "WHOLE_UNIT_RECALL" && broadWeakness(ctx, u, s))) out.add("FULL_UNIT_WEAKNESS");
    const prev = ctx.previous[ref];
    if (prev && (prev.outcome === "REMAINED_AFFECTED" || prev.outcome === "RETURNED_LATER")) out.add("PREVIOUS_INTERVENTION_REMAINED");
  }
  if (d.exerciseType === "DELAYED_RECALL") out.add("DELAYED_RECHECK");
  return out;
}

// ───────────────────────────── Strict validator ─────────────────────────────

const ref = z.string().regex(/^u([1-9]|1[0-9]|20)$/);
const rawDecisionSchema = z
  .object({
    action: z.enum(["EXERCISE", "FINISH"]),
    exerciseType: z.enum(EXERCISE_TYPES),
    unitRefs: z.array(ref).max(COACH_CAPS.maxWindowUnits),
    hiddenTokens: z.array(z.object({ unitRef: ref, index: z.number().int().min(0).max(499) }).strict()).max(200),
    contextLevel: z.enum(CONTEXT_LEVELS),
    cueLevel: z.enum(CUE_LEVELS),
    reasonCode: z.enum(COACH_REASON_CODES),
  })
  .strict();

export type CoachValidation = { ok: true; decision: CoachDecision } | { ok: false; reason: string };

export function signature(d: ExerciseDecision): string {
  const hidden = [...d.hiddenTokens].map((t) => `${t.unitRef}#${t.index}`).sort().join(",");
  return [d.exerciseType, d.unitRefs.join("+"), hidden, d.contextLevel, d.cueLevel].join("|");
}

/**
 * Stateless structural rules of ONE exercise against the facts: refs exist, contiguity, learner-marked tokens only,
 * unit-level evidence never split into words, bounded window, type ↔ evidence compatibility. Used both for new
 * decisions and to re-check stored decisions before rendering.
 */
export function checkExerciseStructure(d: ExerciseDecision, facts: MemorizationPerformanceFacts): string | null {
  const byRef = unitsByRef(facts);
  const order = new Map(facts.units.map((u, i) => [u.ref, i]));
  if (d.unitRefs.length === 0) return "no target unit";
  if (new Set(d.unitRefs).size !== d.unitRefs.length) return "duplicate unit";
  const units = d.unitRefs.map((r) => byRef.get(r));
  if (units.some((u) => !u)) return "unknown unit";
  const us = units as UnitFact[];
  for (let k = 1; k < us.length; k++) if (order.get(us[k]!.ref)! !== order.get(us[k - 1]!.ref)! + 1) return "units are not contiguous";

  if (SINGLE_UNIT_TYPES.has(d.exerciseType) && us.length !== 1) return `${d.exerciseType} needs exactly one unit`;
  if (d.exerciseType === "SEQUENCE_RECALL" && us.length !== 2) return "SEQUENCE_RECALL needs exactly two consecutive units";
  if (d.exerciseType === "LINKED_SEQUENCE_RECALL" && (us.length < 2 || us.length > 3)) return "LINKED_SEQUENCE_RECALL needs 2–3 consecutive units";
  if (!us.some(isAffected)) return "no affected unit in exercise";
  if (SINGLE_UNIT_TYPES.has(d.exerciseType) && !isAffected(us[0]!)) return "target unit has no affected evidence";
  if (d.exerciseType === "LINKED_SEQUENCE_RECALL" && !us.every(isAffected)) return "linked units must all be affected";

  const seen = new Set<string>();
  for (const t of d.hiddenTokens) {
    const u = byRef.get(t.unitRef);
    if (!u || !d.unitRefs.includes(t.unitRef)) return "hidden token outside target units";
    if (t.index >= u.tokenCount) return "token index out of range";
    if (u.evidence !== "WORDS") return "word token on unit-level or correct evidence";
    if (!u.incorrect.includes(t.index) && !u.forgotten.includes(t.index)) return `token ${t.unitRef}#${t.index} was not marked by the learner`;
    const key = `${t.unitRef}#${t.index}`;
    if (seen.has(key)) return "duplicate hidden token";
    seen.add(key);
  }

  const wordsUnit = us[0]!.evidence === "WORDS";
  if (WORD_ONLY_TYPES.has(d.exerciseType)) {
    if (!wordsUnit) return `${d.exerciseType} needs word-level evidence`;
    if (d.hiddenTokens.length === 0) return `${d.exerciseType} must hide at least one marked word`;
  }
  if (d.exerciseType === "CLOZE_RECALL" && (d.contextLevel !== "NONE" || d.cueLevel !== "FULL")) return "CLOZE_RECALL uses the full unit without extra context";
  if (d.exerciseType === "CONTEXT_RECALL" && (d.contextLevel === "NONE" || d.cueLevel !== "FULL")) return "CONTEXT_RECALL needs canonical context and full cue";
  if (d.exerciseType === "REDUCED_CUE_RECALL" && (d.contextLevel !== "NONE" || d.cueLevel === "FULL")) return "REDUCED_CUE_RECALL needs a reduced cue without context";
  if ((d.exerciseType === "SEQUENCE_RECALL" || d.exerciseType === "LINKED_SEQUENCE_RECALL") && (d.contextLevel !== "NONE" || d.cueLevel !== "FULL")) return "sequence exercises show only their own units";
  if (d.exerciseType === "WHOLE_UNIT_RECALL" && (d.hiddenTokens.length !== 0 || d.cueLevel !== "NONE")) return "WHOLE_UNIT_RECALL hides the whole unit (no token list, cue NONE)";
  if (d.exerciseType === "DELAYED_RECALL") {
    if (d.contextLevel !== "NONE") return "DELAYED_RECALL has no extra context";
    if (wordsUnit && d.hiddenTokens.length === 0) return "DELAYED_RECALL must hide at least one marked word";
    if (!wordsUnit && d.cueLevel !== "NONE") return "unit-level DELAYED_RECALL hides the whole unit (cue NONE)";
  }
  if (d.exerciseType === "SEQUENCE_RECALL" || d.exerciseType === "LINKED_SEQUENCE_RECALL") {
    const hidesSomething = d.hiddenTokens.length > 0 || us.some((u) => isUnitLevelEvidence(u.evidence));
    if (!hidesSomething) return "sequence exercise hides nothing";
  }
  const window = exerciseWindow(facts, d.unitRefs, d.contextLevel);
  if (!window.ok) return window.reason;
  return null;
}

/** Validates ANY coach decision (AI or deterministic) against facts + session state. Returns the first violated rule. */
export function validateCoachDecision(raw: unknown, ctx: CoachContext): CoachValidation {
  const parsed = rawDecisionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: `schema: ${parsed.error.issues[0]?.path.join(".") ?? ""} ${parsed.error.issues[0]?.message ?? "invalid"}`.trim() };
  const fail = (reason: string): CoachValidation => ({ ok: false, reason });
  const states = deriveSession(ctx);
  if (sessionDone(ctx, states)) return fail("session budget exhausted or every target closed");
  if (ctx.played.some((e) => e.response === null)) return fail("previous exercise not answered");

  const { action, ...d } = parsed.data;
  if (action === "FINISH") {
    if (d.unitRefs.length || d.hiddenTokens.length) return fail("FINISH carries no exercise");
    const premature = [...states.values()].some((s) => s.exposures === 0 || (!s.closed && s.lastResponse !== "RECALLED"));
    if (premature) return fail("FINISH before every target was practised and recalled");
    return { ok: true, decision: { action: "FINISH" } };
  }

  const structure = checkExerciseStructure(d, ctx.facts);
  if (structure) return fail(structure);
  const byRef = unitsByRef(ctx.facts);
  const targets = d.unitRefs.filter((r) => states.has(r)).map((r) => states.get(r)!);
  if (!targets.some((s) => !s.closed)) return fail("every target unit of this exercise is already closed");
  if (SINGLE_UNIT_TYPES.has(d.exerciseType) && targets[0]!.closed) return fail("target is already closed");
  if (targets.some((s) => s.exposures >= COACH_CAPS.maxExposuresPerTarget)) return fail("exposure cap reached for a target");

  const s = targets[0]!;
  if (d.exerciseType === "REDUCED_CUE_RECALL") {
    if (!s.lastExercise) return fail("REDUCED_CUE_RECALL needs an earlier exposure of the target");
    if (CUE_RANK[d.cueLevel] >= cueStrength(s.lastExercise)) return fail("cue is not reduced compared with the previous exposure");
  }
  if (d.exerciseType === "DELAYED_RECALL") {
    if (s.exposures === 0) return fail("DELAYED_RECALL needs an earlier exposure of the target");
    if (s.delayedReturns >= COACH_CAPS.maxDelayedPerTarget) return fail("delayed return cap reached");
    if (s.exercisesSinceLast < 1) return fail("DELAYED_RECALL needs at least one other exercise in between");
  }
  if (d.exerciseType === "WHOLE_UNIT_RECALL" && !broadWeakness(ctx, byRef.get(s.ref)!, s)) return fail("WHOLE_UNIT_RECALL needs unit-level or broad weakness evidence");
  if (d.exerciseType === "SEQUENCE_RECALL") {
    const [a, b] = d.unitRefs as [string, string];
    const supported = (states.has(a) && states.has(b)) || ctx.facts.adjacency.boundaryPairs.some(([x, y]) => x === a && y === b);
    if (!supported) return fail("SEQUENCE_RECALL needs adjacent affected units or a boundary issue");
  }
  const sig = signature(d);
  if (ctx.played.some((e) => signature(e) === sig)) return fail("duplicate of an earlier exercise in this session");
  if (!supportedCoachReasons(ctx, d, states).has(d.reasonCode)) return fail(`reason ${d.reasonCode} is not supported by the facts`);
  return { ok: true, decision: { action: "EXERCISE", exercise: { ...d, hiddenTokens: [...d.hiddenTokens].sort((x, y) => x.unitRef.localeCompare(y.unitRef) || x.index - y.index) } } };
}

// ───────────────────────────── Deterministic fallback (operational, NOT the evaluation baseline) ─────────────────────────────

function firstExposureReason(ctx: CoachContext, unitRef: string): CoachReasonCode {
  const p = ctx.facts.affected.filter((x) => x.unitRef === unitRef);
  if (p.some((x) => x.level === "UNIT")) return "FULL_UNIT_WEAKNESS";
  if (p.some((x) => x.history === "REPEATED")) return "REPEATED_TARGET";
  if (p.some((x) => x.history === "PERSISTENT")) return "PERSISTENT_TARGET";
  return "NEW_SINGLE_TARGET";
}

const allMarked = (facts: MemorizationPerformanceFacts, refs: string[]): HiddenToken[] => {
  const byRef = unitsByRef(facts);
  return refs.flatMap((r) => {
    const u = byRef.get(r)!;
    return u.evidence === "WORDS" ? markedTokens(u).map((index) => ({ unitRef: r, index })) : [];
  });
};

/**
 * Safe and useful, deliberately simple: each target once (cloze for marked words, whole-unit recall for unit-level
 * evidence, the plan's adjacent group as a linked sequence), then one whole-unit recall for a word target that was not
 * recalled, then finish. Every candidate is passed through the validator; anything invalid is skipped.
 */
export function deterministicDecision(ctx: CoachContext): CoachDecision {
  const states = deriveSession(ctx);
  if (sessionDone(ctx, states)) return { action: "FINISH" };
  const byRef = unitsByRef(ctx.facts);
  const candidates: ExerciseDecision[] = [];
  for (const group of ctx.targetGroups) {
    const fresh = group.filter((r) => states.get(r)!.exposures === 0);
    if (fresh.length === 0) continue;
    if (group.length >= 2 && fresh.length === group.length) {
      candidates.push({ exerciseType: "LINKED_SEQUENCE_RECALL", unitRefs: group, hiddenTokens: allMarked(ctx.facts, group), contextLevel: "NONE", cueLevel: "FULL", reasonCode: ctx.facts.adjacency.boundaryPairs.some(([a, b]) => group.includes(a) && group.includes(b)) ? "BOUNDARY_TARGETS" : "ADJACENT_TARGETS" });
    }
    for (const r of fresh) {
      const unitLevel = isUnitLevelEvidence(byRef.get(r)!.evidence);
      candidates.push(
        unitLevel
          ? { exerciseType: "WHOLE_UNIT_RECALL", unitRefs: [r], hiddenTokens: [], contextLevel: "NONE", cueLevel: "NONE", reasonCode: "FULL_UNIT_WEAKNESS" }
          : { exerciseType: "CLOZE_RECALL", unitRefs: [r], hiddenTokens: allMarked(ctx.facts, [r]), contextLevel: "NONE", cueLevel: "FULL", reasonCode: firstExposureReason(ctx, r) },
      );
    }
  }
  for (const r of affectedRefs(ctx)) {
    const s = states.get(r)!;
    if (s.closed || s.unitLevel || s.triedWholeUnit || s.exposures === 0 || s.lastResponse === "RECALLED") continue;
    candidates.push({ exerciseType: "WHOLE_UNIT_RECALL", unitRefs: [r], hiddenTokens: [], contextLevel: "NONE", cueLevel: "NONE", reasonCode: "FAILED_TARGETED_RECALL" });
  }
  for (const c of candidates) {
    const checked = validateCoachDecision({ action: "EXERCISE", ...c }, ctx);
    if (checked.ok) return checked.decision;
  }
  return { action: "FINISH" };
}

/**
 * AI adds decision value only when there is a real choice. When every open target is unit-level evidence that has not
 * been practised yet, whole-unit recall is the only sensible exercise → no call.
 */
export function decisionNeedsAI(ctx: CoachContext): boolean {
  const states = [...deriveSession(ctx).values()].filter((s) => !s.closed);
  if (states.length === 0) return false;
  const onlyFreshUnitLevel = states.every((s) => s.unitLevel && s.exposures === 0) && ctx.facts.adjacency.unitGroups.length === 0;
  return !onlyFreshUnitLevel;
}

// ───────────────────────────── AI payload (structured facts only) ─────────────────────────────

export function buildCoachPayload(ctx: CoachContext, schemaVersion: string): Record<string, unknown> {
  const states = deriveSession(ctx);
  const budget = sessionBudget(ctx);
  return {
    schemaVersion,
    session: {
      exerciseNumber: ctx.played.length + 1,
      budget,
      remainingExercises: budget - answeredCount(ctx),
      firstComparableAttempt: ctx.facts.history.firstComparableAttempt,
    },
    units: ctx.facts.units.map((u) => ({
      ref: u.ref,
      tokenCount: u.tokenCount,
      evidence: u.evidence,
      unitIssue: u.unitIssue,
      incorrectTokens: u.incorrect,
      forgottenTokens: u.forgotten,
      previousNeighborAvailable: u.hasPreviousNeighbor,
      nextNeighborAvailable: u.hasNextNeighbor,
      positions: ctx.facts.affected.filter((p) => p.unitRef === u.ref).map((p) => ({ token: p.token, kind: p.kind, level: p.level, history: p.history })),
      previousIntervention: ctx.previous[u.ref] ?? null,
    })),
    adjacency: ctx.facts.adjacency,
    targets: [...states.values()].map((s) => ({
      ref: s.ref,
      open: !s.closed,
      closedBy: s.closedBy,
      exposures: s.exposures,
      delayedReturns: s.delayedReturns,
      consecutiveFailures: s.consecutiveFailures,
      lastResponse: s.lastResponse,
      lastExercise: s.lastExercise,
      exercisesSinceLast: s.exercisesSinceLast,
      succeededWithCue: s.succeededWithCue,
      failedAfterCueReduction: s.failedAfterCueReduction,
      recalledOnDelay: s.recalledOnDelay,
    })),
    exercises: ctx.played.map((e) => ({ n: e.order, exerciseType: e.exerciseType, unitRefs: e.unitRefs, hiddenTokens: e.hiddenTokens, contextLevel: e.contextLevel, cueLevel: e.cueLevel, reasonCode: e.reasonCode, response: e.response })),
    allowed: {
      actions: ["EXERCISE", "FINISH"],
      exerciseTypes: EXERCISE_TYPES,
      contextLevels: CONTEXT_LEVELS,
      cueLevels: CUE_LEVELS,
      reasonCodes: COACH_REASON_CODES,
      planGroups: ctx.targetGroups,
      maxWindowUnits: COACH_CAPS.maxWindowUnits,
      maxExposuresPerTarget: COACH_CAPS.maxExposuresPerTarget,
      maxDelayedPerTarget: COACH_CAPS.maxDelayedPerTarget,
    },
  };
}

// ───────────────────────────── Safe rendering (canonical text resolved by the backend) ─────────────────────────────

export type Segment = { kind: "TEXT"; text: string; wasHidden: boolean; target: boolean } | { kind: "HIDDEN" } | { kind: "MASKED" };
export type RenderedUnit = { role: "TARGET" | "CONTEXT"; fullyHidden: boolean; segments: Segment[] };

/**
 * Turns a validated decision + canonical tokens into what the browser receives. BEFORE reveal a hidden or masked word
 * is not sent at all — only a typed placeholder — so it cannot leak through the DOM, accessibility tree or RSC payload.
 * A visible word that is the same word as a hidden one (anywhere in the window, compared after Arabic normalisation)
 * is masked too, so the answer never appears in the visible text of its own exercise.
 */
export function renderExercise(d: ExerciseDecision, facts: MemorizationPerformanceFacts, window: { ref: string | null; role: "TARGET" | "CONTEXT"; tokens: string[] }[], revealed: boolean): RenderedUnit[] {
  const byRef = unitsByRef(facts);
  const answers = new Set<string>();
  for (const w of window) {
    const fact = w.role === "TARGET" && w.ref ? byRef.get(w.ref)! : null;
    if (!fact) continue;
    const whole = isUnitLevelEvidence(fact.evidence) || d.exerciseType === "WHOLE_UNIT_RECALL";
    w.tokens.forEach((t, i) => {
      if (whole || d.hiddenTokens.some((h) => h.unitRef === fact.ref && h.index === i)) answers.add(normalizeArabic(t));
    });
  }
  answers.delete("");
  return window.map((w) => {
    const fact = w.role === "TARGET" && w.ref ? byRef.get(w.ref)! : null;
    const fullyHidden = Boolean(fact && (isUnitLevelEvidence(fact.evidence) || d.exerciseType === "WHOLE_UNIT_RECALL"));
    const hidden = new Set(fact ? d.hiddenTokens.filter((t) => t.unitRef === fact.ref).map((t) => t.index) : []);
    const radius = fact && hidden.size > 0 ? COACH_CAPS.cueRadius[d.cueLevel] : Infinity;
    const near = (i: number) => radius === Infinity || [...hidden].some((h) => Math.abs(h - i) <= radius);
    if (revealed) return { role: w.role, fullyHidden, segments: w.tokens.map((text, i) => ({ kind: "TEXT" as const, text, wasHidden: fullyHidden || hidden.has(i), target: Boolean(fact) })) };
    if (fullyHidden) return { role: w.role, fullyHidden, segments: [{ kind: "HIDDEN" as const }] };
    const segments: Segment[] = [];
    w.tokens.forEach((text, i) => {
      if (hidden.has(i)) segments.push({ kind: "HIDDEN" });
      else if (!near(i) || answers.has(normalizeArabic(text))) {
        if (segments.at(-1)?.kind !== "MASKED") segments.push({ kind: "MASKED" });
      } else segments.push({ kind: "TEXT", text, wasHidden: false, target: Boolean(fact) });
    });
    return { role: w.role, fullyHidden, segments };
  });
}
