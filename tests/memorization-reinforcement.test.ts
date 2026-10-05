import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { AIProviderError } from "@/server/ai/provider";
import { REINFORCEMENT_PLAN_JSON_SCHEMA } from "@/server/ai/schemas";
import { submitRecitation } from "@/server/memorization/recitation";
import { buildPlannerPayload, REINFORCEMENT_SYSTEM_PROMPT } from "@/server/memorization/reinforcement/ai-planner";
import { observationSentence } from "@/server/memorization/reinforcement/copy";
import { buildMemorizationPerformanceFacts, type UnitAssessmentInput } from "@/server/memorization/reinforcement/facts";
import { buildDeterministicPlan, decideAINecessity, exposureOrder, OBSERVATION_KEYS, PLAN_CAPS, validatePlan, type PlanTarget, type ReinforcementPlan } from "@/server/memorization/reinforcement/plan";
import {
  compareAssessments,
  ensureReinforcementPlan,
  finishReinforcement,
  getFollowUpComparison,
  getStoredPlan,
  loadAttemptFacts,
} from "@/server/memorization/reinforcement/service";
import { advanceCoach, revealExercise } from "@/server/memorization/reinforcement/coach-service";
import { getMemorizationSessionUnits } from "@/server/memorization/content";
import { getAttemptResult } from "@/server/memorization/progress";
import { hasTestDb, testDb, truncateAll } from "./helpers/db";
import { createUser, seedFixtureCurriculum } from "./helpers/fixtures";
import { PASS_A_UNITS, seedMatnFixture } from "./helpers/matn-fixtures";
import { ScriptedProvider } from "./helpers/scripted-provider";

// ───────────────────────────── pure helpers ─────────────────────────────

type U = Partial<UnitAssessmentInput>;
let auto = 0;
const unit = (o: U = {}): UnitAssessmentInput => ({
  unitId: o.unitId ?? `unit-${++auto}`,
  tokenCount: 6,
  status: "CORRECT",
  scope: null,
  incorrect: [],
  forgotten: [],
  hasPreviousNeighbor: true,
  hasNextNeighbor: true,
  previous: null,
  ...o,
});
const words = (incorrect: number[], forgotten: number[] = []) => ({ status: (forgotten.length ? "FORGOTTEN" : "INCORRECT") as "FORGOTTEN" | "INCORRECT", scope: "WORDS" as const, incorrect, forgotten });
const fullUnit = (status: "INCORRECT" | "FORGOTTEN") => ({ status, scope: "FULL_UNIT" as const, incorrect: [], forgotten: [] });
const correct = { status: "CORRECT" as const, scope: null, incorrect: [], forgotten: [] };
const facts = (...units: UnitAssessmentInput[]) => buildMemorizationPerformanceFacts(units);
const target = (t: Partial<PlanTarget>): PlanTarget => ({ unitRefs: ["u1"], tokens: [], priority: "HIGH", contextStrategy: "TARGET_UNIT_ONLY", strategy: "TARGETED_RECALL", repeatPolicy: "ONCE", reasonCode: "CURRENT_INCORRECT", ...t });

describe("deterministic performance facts", () => {
  it("all CORRECT: no issues, every word correct, no plan, no AI", () => {
    const f = facts(unit(), unit());
    expect(f.hasIssues).toBe(false);
    expect(f.totals).toMatchObject({ assessedTokens: 12, correctTokens: 12, incorrectTokens: 0, forgottenTokens: 0 });
    expect(buildDeterministicPlan(f)).toBeNull();
    expect(decideAINecessity(f)).toEqual({ useAI: false, reasons: [] });
    expect(supportedKeys(f)).toEqual([]);
  });

  it("one INCORRECT word: exact counts, ratios and position", () => {
    const f = facts(unit(words([2])), unit());
    expect(f.totals).toMatchObject({ correctTokens: 11, incorrectTokens: 1, forgottenTokens: 0 });
    expect(f.totals.ratios.incorrect).toBeCloseTo(1 / 12, 3);
    expect(f.affected).toEqual([{ unitRef: "u1", token: 2, kind: "INCORRECT", level: "WORD", history: "NO_HISTORY" }]);
    expect(f.unitSummary).toMatchObject({ fullyCorrect: 1, withIncorrect: 1, withForgotten: 0, mixed: 0 });
  });

  it("one FORGOTTEN word", () => {
    const f = facts(unit(words([], [0])));
    expect(f.totals).toMatchObject({ correctTokens: 5, forgottenTokens: 1 });
    expect(f.pattern).toBe("FORGETTING_DOMINANT");
  });

  it("mixed INCORRECT + FORGOTTEN in the same unit", () => {
    const f = facts(unit(words([1], [3, 4])));
    expect(f.totals).toMatchObject({ correctTokens: 3, incorrectTokens: 1, forgottenTokens: 2 });
    expect(f.unitSummary.mixed).toBe(1);
    expect(f.adjacency.tokenRuns).toEqual([{ unitRef: "u1", from: 3, to: 4, kinds: ["FORGOTTEN"] }]);
  });

  it("multiple and adjacent affected units; boundary-touching pairs", () => {
    const f = facts(unit(words([], [4, 5])), unit(words([], [0])), unit(), unit(words([2])));
    expect(f.adjacency.unitGroups).toEqual([["u1", "u2"]]);
    expect(f.adjacency.boundaryPairs).toEqual([["u1", "u2"]]);
    expect(supportedKeys(f)).toContain("CLUSTERED_FORGOTTEN");
  });

  it("first attempt: no repeated / persistent / resolved and no history observation", () => {
    const f = facts(unit(words([1], [2])), unit(fullUnit("FORGOTTEN")));
    expect(f.history.firstComparableAttempt).toBe(true);
    expect(f.affected.every((p) => p.history === "NO_HISTORY")).toBe(true);
    expect(f.resolved).toEqual([]);
    const keys = supportedKeys(f);
    for (const k of ["REPEATED_FORGOTTEN", "REPEATED_INCORRECT", "NEW_AND_RESOLVED", "PERSISTENT_ISSUE", "RESOLVED_PREVIOUS"]) expect(keys).not.toContain(k);
    expect(keys).toContain("FIRST_ATTEMPT");
  });

  it("repeated FORGOTTEN and repeated INCORRECT with real history", () => {
    const f = facts(unit({ ...words([1], [3]), previous: words([1], [3]) }));
    expect(f.affected.map((p) => p.history)).toEqual(["REPEATED", "REPEATED"]);
    expect(supportedKeys(f)).toEqual(expect.arrayContaining(["REPEATED_FORGOTTEN", "REPEATED_INCORRECT"]));
    expect(observationSentence("REPEATED_FORGOTTEN", f)).toContain("محاولتك السابقة");
  });

  it("previously affected position now correct; new position; persistent (other kind)", () => {
    const f = facts(unit({ ...words([5], [2]), previous: words([0, 2]) }));
    expect(f.resolved).toEqual([{ unitRef: "u1", token: 0, previousKind: "INCORRECT" }]);
    const byToken = Object.fromEntries(f.affected.map((p) => [p.token, p.history]));
    expect(byToken).toEqual({ 5: "NEW", 2: "PERSISTENT" });
    expect(supportedKeys(f)).toEqual(expect.arrayContaining(["NEW_AND_RESOLVED", "RESOLVED_PREVIOUS", "PERSISTENT_ISSUE"]));
  });

  it("FULL_UNIT INCORRECT / FORGOTTEN stay unit-level evidence (never fake per-word evidence)", () => {
    const f = facts(unit(fullUnit("INCORRECT")), unit(fullUnit("FORGOTTEN")), unit());
    expect(f.affected).toEqual([
      { unitRef: "u1", token: null, kind: "INCORRECT", level: "UNIT", history: "NO_HISTORY" },
      { unitRef: "u2", token: null, kind: "FORGOTTEN", level: "UNIT", history: "NO_HISTORY" },
    ]);
    expect(f.units[0]!.incorrect).toEqual([]);
    expect(f.totals).toMatchObject({ wordLevelTokens: 6, correctTokens: 6, incorrectTokens: 0, forgottenTokens: 0, unitLevelTokens: 12 });
    expect(f.unitSummary).toMatchObject({ fullUnitIncorrect: 1, fullUnitForgotten: 1 });
  });

  it("a previous FULL_UNIT never becomes word-level history (PERSISTENT, not REPEATED, and no per-word resolution)", () => {
    const f = facts(unit({ ...words([], [1]), previous: fullUnit("FORGOTTEN") }));
    expect(f.affected[0]!.history).toBe("PERSISTENT");
    expect(f.resolved).toEqual([]);
  });
});

function supportedKeys(f: ReturnType<typeof facts>) {
  return OBSERVATION_KEYS.filter((k) => validatePlan({ observationKey: k, targets: buildDeterministicPlan(f)?.targets ?? [] }, f).ok);
}

describe("AI necessity + deterministic planner", () => {
  it("simple first-attempt single error → deterministic, AI unnecessary", () => {
    const f = facts(unit(words([2])), unit());
    expect(decideAINecessity(f).useAI).toBe(false);
    const plan = buildDeterministicPlan(f)!;
    expect(plan.targets).toEqual([target({ tokens: [{ unitRef: "u1", index: 2 }], priority: "LOW" })]);
    expect(validatePlan(plan, f).ok).toBe(true);
  });

  it("a single mixed unit on a first attempt is still a deterministic case", () => {
    expect(decideAINecessity(facts(unit(words([1], [2])))).useAI).toBe(false);
  });

  it("complex cases need AI: multiple targets, history, adjacency", () => {
    expect(decideAINecessity(facts(unit(words([1])), unit(), unit(words([2])))).reasons).toEqual(["MULTIPLE_TARGETS"]);
    expect(decideAINecessity(facts(unit({ ...words([1]), previous: words([1]) }))).reasons).toEqual(["HISTORY_EVIDENCE"]);
    expect(decideAINecessity(facts(unit(words([5])), unit(words([0])))).reasons).toEqual(["MULTIPLE_TARGETS", "ADJACENT_UNITS"]);
  });

  it("orders FULL_UNIT FORGOTTEN first, merges boundary-touching units, repeats severe targets once (cap)", () => {
    const f = facts(unit(words([3])), unit(words([], [5])), unit(words([], [0])), unit(), unit(fullUnit("FORGOTTEN")));
    const plan = buildDeterministicPlan(f)!;
    expect(validatePlan(plan, f)).toMatchObject({ ok: true });
    expect(plan.targets[0]).toMatchObject({ unitRefs: ["u5"], strategy: "FULL_UNIT_RECALL", tokens: [], reasonCode: "FULL_UNIT_FORGOTTEN", priority: "HIGH", repeatPolicy: "REPEAT_LATER_IN_SESSION" });
    expect(plan.targets.find((t) => t.strategy === "SEQUENCE_RECALL")).toMatchObject({ unitRefs: ["u2", "u3"], tokens: [{ unitRef: "u2", index: 5 }, { unitRef: "u3", index: 0 }] });
    expect(plan.targets.every((t) => t.contextStrategy === "TARGET_UNIT_ONLY")).toBe(true);
    const order = exposureOrder(plan);
    expect(order.length).toBe(plan.targets.length + 1);
    for (const i of new Set(order)) expect(order.filter((x) => x === i).length).toBeLessThanOrEqual(PLAN_CAPS.maxExposuresPerTarget);
  });

  it("deterministic plans are always valid across many shapes", () => {
    const shapes = [
      [unit(fullUnit("INCORRECT"))],
      [unit({ status: "FORGOTTEN", scope: null, incorrect: [], forgotten: [] })],
      [unit(words([5])), unit(words([0])), unit(fullUnit("FORGOTTEN")), unit(words([0], [1]))],
      [unit({ ...words([1], [2]), previous: words([2], [1]) }), unit(), unit({ ...fullUnit("FORGOTTEN"), previous: fullUnit("FORGOTTEN") })],
    ];
    for (const s of shapes) {
      const f = facts(...s);
      expect(validatePlan(buildDeterministicPlan(f), f)).toMatchObject({ ok: true });
    }
  });
});

describe("strict validator", () => {
  const f = facts(unit({ hasPreviousNeighbor: false, ...words([1], [2]) }), unit(), unit({ hasNextNeighbor: false, ...fullUnit("FORGOTTEN") }));
  const good = (): ReinforcementPlan => ({
    observationKey: "FIRST_ATTEMPT",
    targets: [
      target({ unitRefs: ["u3"], strategy: "FULL_UNIT_RECALL", reasonCode: "FULL_UNIT_FORGOTTEN", contextStrategy: "PREVIOUS_AND_TARGET" }),
      target({ tokens: [{ unitRef: "u1", index: 1 }, { unitRef: "u1", index: 2 }], reasonCode: "MIXED_ISSUES", contextStrategy: "TARGET_AND_NEXT" }),
    ],
  });
  const mutate = (fn: (p: ReinforcementPlan) => void) => {
    const p = good();
    fn(p);
    return validatePlan(p, f);
  };

  it("accepts a valid plan", () => expect(validatePlan(good(), f)).toMatchObject({ ok: true }));
  it("rejects an invalid / out-of-range token index", () => {
    expect(mutate((p) => (p.targets[1]!.tokens[0]!.index = 99)).ok).toBe(false);
    expect(mutate((p) => (p.targets[1]!.tokens[0]!.index = 1.5)).ok).toBe(false);
  });
  it("rejects a fabricated position (word the learner did not mark)", () => expect(mutate((p) => (p.targets[1]!.tokens[0]!.index = 4))).toMatchObject({ ok: false }));
  it("rejects a non-existent unit", () => expect(mutate((p) => (p.targets[1]!.unitRefs = ["u9"])).ok).toBe(false));
  it("rejects REPEATED reason without history", () => expect(mutate((p) => (p.targets[1]!.reasonCode = "REPEATED_FORGOTTEN"))).toMatchObject({ ok: false, reason: expect.stringContaining("not supported") }));
  it("rejects an observed-change claim without comparable history", () => {
    for (const k of ["RESOLVED_PREVIOUS", "NEW_AND_RESOLVED", "REPEATED_INCORRECT"] as const) expect(mutate((p) => (p.observationKey = k))).toMatchObject({ ok: false, reason: expect.stringContaining("history") });
  });
  it("first unit cannot request previous context; last unit cannot request next (book boundary → reject)", () => {
    expect(mutate((p) => (p.targets[1]!.contextStrategy = "PREVIOUS_AND_TARGET"))).toMatchObject({ ok: false, reason: expect.stringContaining("boundary") });
    expect(mutate((p) => (p.targets[0]!.contextStrategy = "TARGET_AND_NEXT"))).toMatchObject({ ok: false, reason: expect.stringContaining("boundary") });
  });
  it("adjacent grouping must be truly contiguous and affected", () => {
    expect(mutate((p) => (p.targets = [target({ unitRefs: ["u1", "u3"], strategy: "SEQUENCE_RECALL", tokens: [{ unitRef: "u1", index: 1 }, { unitRef: "u1", index: 2 }], reasonCode: "ADJACENT_ISSUES" })])).ok).toBe(false);
    expect(mutate((p) => (p.targets = [target({ unitRefs: ["u1", "u2", "u3"], strategy: "SEQUENCE_RECALL", tokens: [{ unitRef: "u1", index: 1 }, { unitRef: "u1", index: 2 }], reasonCode: "ADJACENT_ISSUES" })])).ok).toBe(false);
  });
  it("never converts FULL_UNIT into word tokens", () => expect(mutate((p) => (p.targets[0]!.tokens = [{ unitRef: "u3", index: 0 }]))).toMatchObject({ ok: false }));
  it("rejects unknown enums, extra keys (e.g. Matn text) and duplicate targets", () => {
    expect(mutate((p) => ((p.targets[0] as unknown as Record<string, unknown>).contextStrategy = "WHOLE_CHAPTER")).ok).toBe(false);
    expect(mutate((p) => ((p.targets[0] as unknown as Record<string, unknown>).text = "نص مولّد")).ok).toBe(false);
    expect(mutate((p) => ((p as unknown as Record<string, unknown>).summary = "أداؤك رائع")).ok).toBe(false);
    expect(mutate((p) => p.targets.push({ ...p.targets[0]! })).ok).toBe(false);
  });
  it("enforces the repeat cap and full coverage", () => {
    const many = facts(...[0, 1, 2, 3, 4].map(() => unit(words([1]))));
    const plan = buildDeterministicPlan(many)!;
    plan.targets.forEach((t) => (t.repeatPolicy = "REPEAT_LATER_IN_SESSION"));
    expect(validatePlan(plan, many)).toMatchObject({ ok: false, reason: "too many repeated targets" });
    expect(mutate((p) => p.targets.pop())).toMatchObject({ ok: false, reason: expect.stringContaining("without a target") });
  });
  it("context window never exceeds 3 units", () => {
    const g = facts(unit(words([5])), unit(words([0])), unit());
    expect(validatePlan({ observationKey: "FIRST_ATTEMPT", targets: [target({ unitRefs: ["u1", "u2"], strategy: "SEQUENCE_RECALL", tokens: [{ unitRef: "u1", index: 5 }, { unitRef: "u2", index: 0 }], reasonCode: "ADJACENT_ISSUES", contextStrategy: "PREVIOUS_TARGET_NEXT" })] }, g)).toMatchObject({ ok: false, reason: expect.stringContaining("too large") });
  });
});

describe("AI payload + schema", () => {
  const f = facts(unit({ unitId: "cuid-real-id-1", ...words([1], [2]), previous: words([1]) }), unit({ unitId: "cuid-real-id-2", ...fullUnit("FORGOTTEN") }));
  const json = JSON.stringify(buildPlannerPayload(f));
  it("contains no audio, recording, transcript, PII, real ids or Matn text", () => {
    expect(json).not.toMatch(/audio|blob|recording|transcript|email|userId|name"|https?:/i);
    expect(json).not.toContain("cuid-real-id");
    expect(json).not.toMatch(/[؀-ۿ]/u);
  });
  it("lists only supported observation keys and per-unit reason codes", () => {
    const payload = buildPlannerPayload(f) as { allowed: { observationKeys: string[] }; units: { supportedReasonCodes: string[] }[] };
    expect(payload.allowed.observationKeys).toContain("REPEATED_INCORRECT");
    expect(payload.allowed.observationKeys).not.toContain("FIRST_ATTEMPT");
    expect(payload.units[1]!.supportedReasonCodes).toEqual(["FULL_UNIT_FORGOTTEN"]);
  });
  it("structured output schema has no free-text field", () => {
    const text = JSON.stringify(REINFORCEMENT_PLAN_JSON_SCHEMA);
    expect(text).not.toMatch(/"(summary|text|reason|explanation|matn)"/);
    expect(REINFORCEMENT_SYSTEM_PROMPT).toContain("NOT evaluating recitation correctness");
  });
});

describe("before/after comparison (observational)", () => {
  it("counts positions now correct, remaining and new", () => {
    const before = facts(unit({ unitId: "a", ...words([1], [2, 3]) }), unit({ unitId: "b", ...fullUnit("FORGOTTEN") }), unit({ unitId: "c" }));
    const after = facts(unit({ unitId: "a", ...words([], [3]) }), unit({ unitId: "b", ...correct }), unit({ unitId: "c", ...words([0]) }));
    const r = compareAssessments(before, after);
    expect(r).toMatchObject({ nowCorrect: 3, remaining: 1, newlyAffected: 1 });
    expect(r.before).toMatchObject({ incorrectTokens: 1, forgottenTokens: 2, unitLevel: 1 });
    expect(r.after).toMatchObject({ incorrectTokens: 1, forgottenTokens: 1, unitLevel: 0 });
  });
});

// ───────────────────────────── database integration ─────────────────────────────

const T0 = new Date("2026-10-06T10:00:00Z");
const MIN = 60_000;

type Detail = { unitId: string; status: "CORRECT" | "INCORRECT" | "FORGOTTEN"; scope?: "WORDS" | "FULL_UNIT" | null; wordIndexes?: number[]; forgottenWordIndexes?: number[] };
const C = (unitId: string): Detail => ({ unitId, status: "CORRECT", scope: null, wordIndexes: [], forgottenWordIndexes: [] });
const W = (unitId: string, wordIndexes: number[], forgottenWordIndexes: number[] = []): Detail => ({ unitId, status: forgottenWordIndexes.length ? "FORGOTTEN" : "INCORRECT", scope: "WORDS", wordIndexes, forgottenWordIndexes });
const FU = (unitId: string, status: "INCORRECT" | "FORGOTTEN"): Detail => ({ unitId, status, scope: "FULL_UNIT", wordIndexes: [], forgottenWordIndexes: [] });
let seq = 0;

async function submit(db: PrismaClient, userId: string, results: Detail[], at: Date, extra: Record<string, unknown> = {}) {
  seq += 1;
  return submitRecitation(db, userId, { passageId: "pass-a", clientAttemptId: `reinf-${seq}-${Date.now()}`, results, ...extra }, { now: at, provider: null });
}

describe.skipIf(!hasTestDb)("memorization reinforcement (database)", () => {
  let db: PrismaClient;
  let userId: string;
  beforeEach(async () => {
    db = testDb();
    await truncateAll();
    await seedFixtureCurriculum(db);
    await seedMatnFixture(db);
    userId = (await createUser(db, "student@example.com")).id;
  });

  const validAI = (data: unknown) => new ScriptedProvider().scriptPlan(data);

  it("all CORRECT → NONE, no plan row, zero AI calls", async () => {
    const { attemptId } = await submit(db, userId, PASS_A_UNITS.map(C), T0);
    const provider = new ScriptedProvider();
    expect(await ensureReinforcementPlan(db, userId, attemptId, { provider })).toEqual({ kind: "NONE" });
    expect(provider.planRequests).toHaveLength(0);
    expect(await db.memorizationReinforcementPlan.count()).toBe(0);
  });

  it("a saved first assessment loads its result facts and a ready coach plan without prior coach history", async () => {
    const { attemptId } = await submit(db, userId, [W("u-a1", [1]), C("u-a2")], T0);
    expect(await getAttemptResult(db, userId, attemptId)).not.toBeNull();
    expect((await loadAttemptFacts(db, userId, attemptId))?.facts.history.firstComparableAttempt).toBe(true);
    const created = await ensureReinforcementPlan(db, userId, attemptId, { provider: null });
    expect(created).toMatchObject({ kind: "PLAN", plan: { reviewMode: "AI_ADAPTIVE_REVIEW", planSource: "DETERMINISTIC" } });
    expect(await getStoredPlan(db, userId, attemptId)).toEqual(created);
  });

  it("simple first-attempt error → deterministic plan, zero AI calls", async () => {
    const { attemptId } = await submit(db, userId, [W("u-a1", [1]), C("u-a2")], T0);
    const provider = new ScriptedProvider();
    const r = await ensureReinforcementPlan(db, userId, attemptId, { provider });
    expect(r).toMatchObject({ kind: "PLAN", plan: { planSource: "DETERMINISTIC", targetCount: 1 } });
    expect(provider.planRequests).toHaveLength(0);
    expect((await db.memorizationReinforcementPlan.findFirstOrThrow()).aiOutcome).toBe("NOT_NEEDED");
    expect(await db.aIInteractionLog.count({ where: { type: "PLAN_MEMORIZATION_REINFORCEMENT" } })).toBe(0);
  });

  it("complex case → one AI call with structured facts; valid plan accepted; refresh and parallel requests reuse it", async () => {
    const { attemptId } = await submit(db, userId, [W("u-a1", [3], []), W("u-a2", [], [0]), C("u-a3"), FU("u-a4", "INCORRECT")], T0);
    let calls = 0;
    const provider = new ScriptedProvider().scriptPlan((req: { payload: Record<string, unknown> }) => {
      calls += 1;
      const p = req.payload as { units: { ref: string; evidence: string }[] };
      expect(p.units.map((u) => u.evidence)).toEqual(["WORDS", "WORDS", "CORRECT", "FULL_UNIT"]);
      return {
        observationKey: "CLUSTERED_ISSUES",
        targets: [
          { unitRefs: ["u1", "u2"], tokens: [{ unitRef: "u1", index: 3 }, { unitRef: "u2", index: 0 }], priority: "HIGH", contextStrategy: "TARGET_UNIT_ONLY", strategy: "SEQUENCE_RECALL", repeatPolicy: "REPEAT_LATER_IN_SESSION", reasonCode: "ADJACENT_ISSUES" },
          { unitRefs: ["u4"], tokens: [], priority: "MEDIUM", contextStrategy: "PREVIOUS_AND_TARGET", strategy: "FULL_UNIT_RECALL", repeatPolicy: "ONCE", reasonCode: "FULL_UNIT_INCORRECT" },
        ],
      };
    });
    const [a, b] = await Promise.all([ensureReinforcementPlan(db, userId, attemptId, { provider }), ensureReinforcementPlan(db, userId, attemptId, { provider })]);
    const plans = [a, b].filter((r) => r.kind === "PLAN");
    expect(plans.length).toBeGreaterThanOrEqual(1);
    expect(calls).toBe(1);
    const again = await ensureReinforcementPlan(db, userId, attemptId, { provider });
    expect(again).toMatchObject({ kind: "PLAN", plan: { planSource: "AI", targetCount: 2 } });
    expect(calls).toBe(1);
    expect(await db.memorizationReinforcementPlan.count()).toBe(1);
    const log = await db.aIInteractionLog.findFirstOrThrow({ where: { type: "PLAN_MEMORIZATION_REINFORCEMENT" } });
    expect(log).toMatchObject({ type: "PLAN_MEMORIZATION_REINFORCEMENT", status: "SUCCESS" });
    expect(JSON.stringify(log.metadata)).not.toMatch(/student@example|audio|وحدة/);

    // Coach session: the plan's adjacent group comes first (deterministic decision without a provider); canonical
    // content from MatnUnit, hidden by index, and the hidden words are not sent before reveal.
    const plan = await db.memorizationReinforcementPlan.findFirstOrThrow();
    const view = (await advanceCoach(db, userId, plan.id, { provider: null }))!;
    expect(view.exercise).toMatchObject({ exerciseType: "LINKED_SEQUENCE_RECALL", revealed: false });
    const seq = view.exercise!.units;
    expect(seq.map((u) => u.role)).toEqual(["TARGET", "TARGET"]);
    // u2's hidden first word «وحدة» also occurs in u1, so it is masked there too (the answer never stays visible).
    expect(seq[0]!.segments).toEqual([{ kind: "MASKED" }, ...["اختبار", "ألف"].map((text) => ({ kind: "TEXT", text, wasHidden: false, target: true })), { kind: "HIDDEN" }]);
    expect(seq[1]!.segments[0]).toEqual({ kind: "HIDDEN" });
    expect(JSON.stringify(view)).not.toContain("الأولى");
    const revealed = (await revealExercise(db, userId, plan.id, view.exercise!.id))!;
    expect(revealed.exercise!.units[0]!.segments.map((x) => (x.kind === "TEXT" ? x.text : "")).join(" ")).toBe("وحدة اختبار ألف الأولى");
    expect(await advanceCoach(db, (await createUser(db, "other@example.com")).id, plan.id, { provider: null })).toBeNull();
  });

  it.each([
    ["invalid token index", { observationKey: "FIRST_ATTEMPT", targets: [{ unitRefs: ["u1"], tokens: [{ unitRef: "u1", index: 77 }], priority: "HIGH", contextStrategy: "TARGET_UNIT_ONLY", strategy: "TARGETED_RECALL", repeatPolicy: "ONCE", reasonCode: "CURRENT_INCORRECT" }] }, "FALLBACK:VALIDATION_REJECTED"],
    ["non-existent unit", { observationKey: "FIRST_ATTEMPT", targets: [{ unitRefs: ["u9"], tokens: [], priority: "HIGH", contextStrategy: "TARGET_UNIT_ONLY", strategy: "FULL_UNIT_RECALL", repeatPolicy: "ONCE", reasonCode: "FULL_UNIT_FORGOTTEN" }] }, "FALLBACK:VALIDATION_REJECTED"],
    ["Matn text in output", { observationKey: "FIRST_ATTEMPT", matn: "نص", targets: [] }, "FALLBACK:VALIDATION_REJECTED"],
    ["malformed JSON", "not json at all", "FALLBACK:VALIDATION_REJECTED"],
    ["provider BAD_RESPONSE", new AIProviderError("BAD_RESPONSE", "invalid json"), "FALLBACK:BAD_RESPONSE"],
    ["quota", new AIProviderError("RATE_LIMITED", "429"), "FALLBACK:RATE_LIMITED"],
  ])("%s → deterministic fallback, exactly one call, no repair call", async (_name, step, outcome) => {
    const { attemptId } = await submit(db, userId, [W("u-a1", [1]), C("u-a2"), W("u-a3", [], [2])], T0);
    const provider = validAI(step);
    const r = await ensureReinforcementPlan(db, userId, attemptId, { provider });
    expect(r).toMatchObject({ kind: "PLAN", plan: { planSource: "DETERMINISTIC" } });
    expect(provider.planRequests).toHaveLength(1);
    expect((await db.memorizationReinforcementPlan.findFirstOrThrow()).aiOutcome).toBe(outcome);
  });

  it("timeout and missing provider → fallback", async () => {
    const { attemptId } = await submit(db, userId, [W("u-a1", [1]), C("u-a2"), W("u-a3", [2])], T0);
    const hanging = new ScriptedProvider().scriptPlan(() => new Promise(() => {}));
    expect(await ensureReinforcementPlan(db, userId, attemptId, { provider: hanging, timeoutMs: 30 })).toMatchObject({ kind: "PLAN", plan: { planSource: "DETERMINISTIC" } });
    expect((await db.memorizationReinforcementPlan.findFirstOrThrow()).aiOutcome).toBe("FALLBACK:TIMEOUT");

    const second = await submit(db, userId, [W("u-a1", [1]), C("u-a2"), W("u-a3", [2])], new Date(T0.getTime() + MIN));
    const throwing = () => {
      throw new Error("AI not configured");
    };
    expect(await ensureReinforcementPlan(db, userId, second.attemptId, { provider: throwing })).toMatchObject({ kind: "PLAN", plan: { planSource: "DETERMINISTIC" } });
    expect((await db.memorizationReinforcementPlan.findFirstOrThrow({ where: { sourceAttemptId: second.attemptId } })).aiOutcome).toBe("FALLBACK:NOT_CONFIGURED");
  });

  it("repeated history is detected from real earlier attempts of the same unit", async () => {
    await submit(db, userId, [W("u-a1", [], [2]), C("u-a2")], T0);
    const { attemptId } = await submit(db, userId, [W("u-a1", [], [2]), C("u-a2")], new Date(T0.getTime() + 5 * MIN));
    const loaded = (await loadAttemptFacts(db, userId, attemptId))!;
    expect(loaded.facts.affected[0]).toMatchObject({ history: "REPEATED", kind: "FORGOTTEN" });
    expect(loaded.facts.units[0]).toMatchObject({ hasPreviousNeighbor: false, hasNextNeighbor: true });
    const provider = new ScriptedProvider().scriptPlan({ observationKey: "REPEATED_FORGOTTEN", targets: [{ unitRefs: ["u1"], tokens: [{ unitRef: "u1", index: 2 }], priority: "HIGH", contextStrategy: "TARGET_AND_NEXT", strategy: "TARGETED_RECALL", repeatPolicy: "ONCE", reasonCode: "REPEATED_FORGOTTEN" }] });
    const r = await ensureReinforcementPlan(db, userId, attemptId, { provider });
    expect(r).toMatchObject({ kind: "PLAN", plan: { planSource: "AI" } });
    if (r.kind === "PLAN") expect(r.plan.observation).toContain("محاولتك السابقة");
  });

  it("legacy (status-only) assessments remain readable and plan as unit-level", async () => {
    const { attemptId } = await submitRecitation(db, userId, { passageId: "pass-a", clientAttemptId: "legacy-attempt-1", results: [{ unitId: "u-a1", status: "FORGOTTEN" }, { unitId: "u-a2", status: "CORRECT" }] }, { now: T0, provider: null });
    const loaded = (await loadAttemptFacts(db, userId, attemptId))!;
    expect(loaded.facts.units[0]).toMatchObject({ evidence: "LEGACY_UNIT", unitIssue: "FORGOTTEN" });
    const r = await ensureReinforcementPlan(db, userId, attemptId, { provider: null });
    expect(r).toMatchObject({ kind: "PLAN", plan: { planSource: "DETERMINISTIC" } });
  });

  it("re-recitation links before → reinforcement → after; mastery and schedule are exactly as without the plan", async () => {
    const twin = (await createUser(db, "twin@example.com")).id;
    const first = [W("u-a1", [1], [3]), C("u-a2")];
    const second = [C("u-a1"), W("u-a2", [0])];
    const { attemptId } = await submit(db, userId, first, T0);
    await submitRecitation(db, twin, { passageId: "pass-a", clientAttemptId: "twin-attempt-1", results: first }, { now: T0, provider: null });

    const r = await ensureReinforcementPlan(db, userId, attemptId, { provider: null });
    if (r.kind !== "PLAN") throw new Error("expected plan");
    await finishReinforcement(db, userId, r.plan.planId, { completed: true }, T0);
    const finished = await db.memorizationReinforcementPlan.findUniqueOrThrow({ where: { id: r.plan.planId } });
    expect(finished).toMatchObject({ status: "COMPLETED", exposuresCompleted: 0 }); // server-counted, never client-supplied

    const later = new Date(T0.getTime() + 10 * MIN);
    const after = await submit(db, userId, second, later, { reinforcementPlanId: r.plan.planId });
    await submitRecitation(db, twin, { passageId: "pass-a", clientAttemptId: "twin-attempt-2", results: second }, { now: later, provider: null });
    expect((await db.memorizationReinforcementPlan.findUniqueOrThrow({ where: { id: r.plan.planId } })).followUpAttemptId).toBe(after.attemptId);

    const cmp = (await getFollowUpComparison(db, userId, after.attemptId))!;
    expect(cmp).toMatchObject({ nowCorrect: 2, remaining: 0, newlyAffected: 1, completedReinforcement: true });

    const pick = (m: { masteryScore: number; state: string; nextReviewAt: Date; consecutiveWeak: number }) => [m.masteryScore, m.state, m.nextReviewAt.toISOString(), m.consecutiveWeak];
    const mine = await db.memorizationMastery.findFirstOrThrow({ where: { userId } });
    const theirs = await db.memorizationMastery.findFirstOrThrow({ where: { userId: twin } });
    expect(pick(mine)).toEqual(pick(theirs));

    // A second follow-up cannot re-link the same plan; a different unit set is never linked.
    const again = await submit(db, userId, second, new Date(later.getTime() + MIN), { reinforcementPlanId: r.plan.planId });
    expect(await getFollowUpComparison(db, userId, again.attemptId)).toBeNull();
  });

  it("double submit of the same assessment creates one attempt and one plan", async () => {
    const input = { passageId: "pass-a", clientAttemptId: "dup-attempt-1", results: [W("u-a1", [1]), C("u-a2"), W("u-a3", [2])] };
    const [x, y] = await Promise.all([submitRecitation(db, userId, input, { now: T0, provider: null }), submitRecitation(db, userId, input, { now: T0, provider: null })]);
    expect(x.attemptId).toBe(y.attemptId);
    const provider = new ScriptedProvider().scriptPlan(new AIProviderError("UNAVAILABLE", "down"));
    await Promise.all([ensureReinforcementPlan(db, userId, x.attemptId, { provider }), ensureReinforcementPlan(db, userId, y.attemptId, { provider })]);
    expect(await db.recitationAttempt.count()).toBe(1);
    expect(await db.memorizationReinforcementPlan.count()).toBe(1);
    expect(provider.planRequests.length).toBeLessThanOrEqual(1);
  });

  it("cross-passage session keeps canonical order (results, facts, reinforcement, re-recitation) and mixed states persist", async () => {
    const CANON = ["u-a3", "u-a4", "u-b1", "u-b2"];
    const session = (await getMemorizationSessionUnits(db, "pass-a", "u-a3", 4))!;
    expect(session.map((u) => u.id)).toEqual(CANON); // no duplicate, no skip, canonical
    const marks = [C("u-a3"), W("u-a4", [], [3]), W("u-b1", [0]), W("u-b2", [1], [2])];
    const { attemptId } = await submit(db, userId, marks, T0);

    const result = (await getAttemptResult(db, userId, attemptId))!;
    expect(result.details.map((d) => d.unitId)).toEqual(CANON);
    expect(new Set(result.details.map((d) => d.unitId)).size).toBe(4);
    expect(result.details[3]).toMatchObject({ unitId: "u-b2", status: "FORGOTTEN", scope: "WORDS", wordIndexes: [1], forgottenWordIndexes: [2] });
    const stored = await db.recitationUnitResult.findFirstOrThrow({ where: { attemptId, unitId: "u-b2" } });
    expect([stored.wordIndexes, stored.forgottenWordIndexes]).toEqual([[1], [2]]);

    const loaded = (await loadAttemptFacts(db, userId, attemptId))!;
    expect(loaded.facts.units.map((u) => u.unitId)).toEqual(CANON);
    expect(loaded.facts.adjacency.boundaryPairs).toEqual([["u2", "u3"]]); // u-a4 end ↔ u-b1 start, across the passage boundary
    expect(loaded.facts.unitSummary.mixed).toBe(1);
    expect(loaded).toMatchObject({ passageId: "pass-a", firstUnitId: "u-a3" });

    const r = await ensureReinforcementPlan(db, userId, attemptId, { provider: null });
    if (r.kind !== "PLAN") throw new Error("expected plan");
    // The coach's cross-passage sequence uses the canonical units in canonical order (u-a4 → u-b1).
    const view = (await advanceCoach(db, userId, r.plan.planId, { provider: null }))!;
    expect(view.exercise).toMatchObject({ exerciseType: "LINKED_SEQUENCE_RECALL" });
    const shown = (await revealExercise(db, userId, r.plan.planId, view.exercise!.id))!.exercise!.units;
    expect(shown.map((u) => u.segments.map((x) => (x.kind === "TEXT" ? x.text : "")).join(" "))).toEqual(["وحدة اختبار ألف الرابعة", "وحدة اختبار باء الأولى"]);

    expect(view.recite).toEqual({ passageId: "pass-a", startUnitId: "u-a3", size: 4 });
    const again = (await getMemorizationSessionUnits(db, view.recite.passageId, view.recite.startUnitId, view.recite.size))!;
    expect(again.map((u) => u.id)).toEqual(CANON);

    const after = await submit(db, userId, [C("u-a3"), C("u-a4"), W("u-b1", [0]), W("u-b2", [], [2])], new Date(T0.getTime() + 10 * MIN), { reinforcementPlanId: r.plan.planId });
    expect((await db.memorizationReinforcementPlan.findUniqueOrThrow({ where: { id: r.plan.planId } })).followUpAttemptId).toBe(after.attemptId);
    expect((await getAttemptResult(db, userId, after.attemptId))!.details.map((d) => d.unitId)).toEqual(CANON);
    expect(await getFollowUpComparison(db, userId, after.attemptId)).toMatchObject({ nowCorrect: 2, remaining: 2, newlyAffected: 0 });
  });

  it("another learner cannot build or read a plan for someone else's attempt", async () => {
    const { attemptId } = await submit(db, userId, [W("u-a1", [1]), C("u-a2")], T0);
    const other = (await createUser(db, "other@example.com")).id;
    await expect(ensureReinforcementPlan(db, other, attemptId, { provider: null })).rejects.toThrow();
  });
});
