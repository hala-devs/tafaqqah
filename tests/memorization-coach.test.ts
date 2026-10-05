import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { ExerciseText } from "@/components/memorize/exercise-text";
import { tokenizeCanonicalMatn } from "@/lib/matn-tokens";
import { MockProvider } from "@/server/ai/mock-provider";
import { AIProviderError } from "@/server/ai/provider";
import { REINFORCEMENT_EXERCISE_JSON_SCHEMA } from "@/server/ai/schemas";
import { getMemorizationSessionUnits } from "@/server/memorization/content";
import { submitRecitation } from "@/server/memorization/recitation";
import { getBaselineReview } from "@/server/memorization/reinforcement/baseline";
import {
  buildCoachPayload,
  COACH_CAPS,
  cueStrength,
  decisionNeedsAI,
  deriveSession,
  deterministicDecision,
  exerciseWindow,
  renderExercise,
  sessionBudget,
  sessionDone,
  validateCoachDecision,
  type CoachContext,
  type ExerciseDecision,
  type PlayedExercise,
  type RecallResponse,
} from "@/server/memorization/reinforcement/coach";
import { COACH_SYSTEM_PROMPT } from "@/server/memorization/reinforcement/coach-ai";
import { advanceCoach, getCoachView, respondExercise, revealExercise, type CoachView } from "@/server/memorization/reinforcement/coach-service";
import { compareOutcomeDetailed, exportReinforcementEvaluation } from "@/server/memorization/reinforcement/evaluation";
import { buildMemorizationPerformanceFacts, type UnitAssessmentInput } from "@/server/memorization/reinforcement/facts";
import { resolveReviewMode } from "@/server/memorization/reinforcement/review-mode";
import { compareAssessments, ensureReinforcementPlan, finishReinforcement, getFollowUpComparison } from "@/server/memorization/reinforcement/service";
import { hasTestDb, testDb, truncateAll } from "./helpers/db";
import { createUser, seedFixtureCurriculum } from "./helpers/fixtures";
import { seedMatnFixture } from "./helpers/matn-fixtures";
import { ScriptedProvider } from "./helpers/scripted-provider";

// No network at all: a real provider call (Gemini or otherwise) would have to go through fetch.
const fetchSpy = vi.fn(() => {
  throw new Error("network is disabled in tests");
});
vi.stubGlobal("fetch", fetchSpy);
afterAll(() => expect(fetchSpy).not.toHaveBeenCalled());

// ───────────────────────────── pure helpers ─────────────────────────────

let auto = 0;
const unit = (o: Partial<UnitAssessmentInput> = {}): UnitAssessmentInput => ({
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
type Facts = ReturnType<typeof facts>;

const ctxOf = (f: Facts, o: Partial<CoachContext> = {}): CoachContext => ({ facts: f, targetGroups: f.units.filter((u) => u.evidence !== "CORRECT").map((u) => [u.ref]), previous: {}, played: [], ...o });
const ex = (o: Partial<ExerciseDecision> = {}): ExerciseDecision => ({ exerciseType: "CLOZE_RECALL", unitRefs: ["u1"], hiddenTokens: [{ unitRef: "u1", index: 2 }], contextLevel: "NONE", cueLevel: "FULL", reasonCode: "NEW_SINGLE_TARGET", ...o });
const raw = (d: ExerciseDecision) => ({ action: "EXERCISE", ...d });
const played = (...items: [ExerciseDecision, RecallResponse][]): PlayedExercise[] => items.map(([d, response], i) => ({ ...d, order: i + 1, response }));
const v = (d: ExerciseDecision, c: CoachContext) => validateCoachDecision(raw(d), c);
const FINISH = { action: "FINISH", exerciseType: "CLOZE_RECALL", unitRefs: [], hiddenTokens: [], contextLevel: "NONE", cueLevel: "FULL", reasonCode: "NEW_SINGLE_TARGET" };

// ───────────────────────────── A. interactive behaviour (pure) ─────────────────────────────

describe("A. coach decisions adapt to the learner's responses", () => {
  const one = facts(unit(words([], [2])));

  it("1. forgotten token → valid cloze on exactly that canonical index", () => {
    expect(v(ex(), ctxOf(one))).toMatchObject({ ok: true, decision: { action: "EXERCISE", exercise: { exerciseType: "CLOZE_RECALL", hiddenTokens: [{ unitRef: "u1", index: 2 }] } } });
  });

  it("2. learner fails → a different strategy is accepted, the same exercise is rejected; fallback also switches", () => {
    const c = ctxOf(one, { played: played([ex(), "NOT_RECALLED"]) });
    expect(v(ex({ exerciseType: "CONTEXT_RECALL", contextLevel: "PREVIOUS", reasonCode: "FAILED_TARGETED_RECALL" }), c).ok).toBe(true);
    expect(v(ex(), c)).toMatchObject({ ok: false, reason: expect.stringContaining("duplicate") });
    expect(deterministicDecision(c)).toMatchObject({ action: "EXERCISE", exercise: { exerciseType: "WHOLE_UNIT_RECALL", reasonCode: "FAILED_TARGETED_RECALL" } });
  });

  it("3. success with context → reduced cue may follow (strictly weaker); not before any exposure", () => {
    const ctxRecall = ex({ exerciseType: "CONTEXT_RECALL", contextLevel: "PREVIOUS" });
    const c = ctxOf(one, { played: played([ctxRecall, "RECALLED"]) });
    expect(deriveSession(c).get("u1")).toMatchObject({ succeededWithCue: true, closed: false });
    expect(v(ex({ exerciseType: "REDUCED_CUE_RECALL", cueLevel: "MINIMAL", reasonCode: "SUCCEEDED_WITH_CONTEXT" }), c).ok).toBe(true);
    expect(v(ex({ exerciseType: "REDUCED_CUE_RECALL", cueLevel: "FULL", reasonCode: "SUCCEEDED_WITH_CONTEXT" }), c).ok).toBe(false);
    expect(v(ex({ exerciseType: "REDUCED_CUE_RECALL", cueLevel: "MINIMAL" }), ctxOf(one)).ok).toBe(false);
    // After a failure with minimal cue, PARTIAL is not «less» than MINIMAL.
    const c2 = ctxOf(one, { played: played([ctxRecall, "RECALLED"], [ex({ exerciseType: "REDUCED_CUE_RECALL", cueLevel: "MINIMAL" }), "NOT_RECALLED"]) });
    expect(v(ex({ exerciseType: "REDUCED_CUE_RECALL", cueLevel: "PARTIAL", reasonCode: "FAILED_AFTER_CUE_REDUCTION" }), c2)).toMatchObject({ ok: false, reason: expect.stringContaining("not reduced") });
    expect(v(ex({ exerciseType: "CONTEXT_RECALL", contextLevel: "BOTH", reasonCode: "FAILED_AFTER_CUE_REDUCTION" }), c2).ok).toBe(true);
  });

  it("4. delayed recall needs another exercise in between, at most once per target, and a recall on delay closes the target", () => {
    const two = facts(unit(words([], [2])), unit(words([1])));
    const delayed = ex({ exerciseType: "DELAYED_RECALL", cueLevel: "PARTIAL", reasonCode: "DELAYED_RECHECK" });
    const u2 = ex({ unitRefs: ["u2"], hiddenTokens: [{ unitRef: "u2", index: 1 }] });
    expect(v(delayed, ctxOf(two, { played: played([ex(), "RECALLED"]) }))).toMatchObject({ ok: false, reason: expect.stringContaining("other exercise") });
    const c = ctxOf(two, { played: played([ex(), "RECALLED"], [u2, "RECALLED"]) });
    expect(v(delayed, c).ok).toBe(true);
    const later = ctxOf(two, { played: played([ex(), "RECALLED"], [u2, "RECALLED"], [delayed, "PARTIAL"], [{ ...u2, exerciseType: "REDUCED_CUE_RECALL", cueLevel: "MINIMAL" }, "PARTIAL"]) });
    expect(v({ ...delayed, cueLevel: "MINIMAL" }, later)).toMatchObject({ ok: false, reason: expect.stringContaining("delayed return cap") });
    const recalled = deriveSession(ctxOf(two, { played: played([ex(), "RECALLED"], [u2, "RECALLED"], [delayed, "RECALLED"]) })).get("u1")!;
    expect(recalled).toMatchObject({ recalledOnDelay: true, closed: true, closedBy: "STABLE" });
  });

  it("5. adjacent / boundary targets → sequence exercises are valid only on real evidence", () => {
    const f = facts(unit(words([], [5])), unit(words([0])), unit(), unit(words([2])));
    const c = ctxOf(f);
    const both = [{ unitRef: "u1", index: 5 }, { unitRef: "u2", index: 0 }];
    expect(v(ex({ exerciseType: "SEQUENCE_RECALL", unitRefs: ["u1", "u2"], hiddenTokens: both, reasonCode: "BOUNDARY_TARGETS" }), c).ok).toBe(true);
    expect(v(ex({ exerciseType: "LINKED_SEQUENCE_RECALL", unitRefs: ["u1", "u2"], hiddenTokens: both, reasonCode: "ADJACENT_TARGETS" }), c).ok).toBe(true);
    expect(v(ex({ exerciseType: "SEQUENCE_RECALL", unitRefs: ["u2", "u3"], hiddenTokens: [{ unitRef: "u2", index: 0 }], reasonCode: "NEW_SINGLE_TARGET" }), c)).toMatchObject({ ok: false });
    expect(v(ex({ exerciseType: "LINKED_SEQUENCE_RECALL", unitRefs: ["u1", "u2", "u3"], hiddenTokens: both, reasonCode: "ADJACENT_TARGETS" }), c)).toMatchObject({ ok: false, reason: expect.stringContaining("all be affected") });
    expect(deterministicDecision(ctxOf(f, { targetGroups: [["u1", "u2"], ["u4"]] }))).toMatchObject({ action: "EXERCISE", exercise: { exerciseType: "LINKED_SEQUENCE_RECALL", unitRefs: ["u1", "u2"], reasonCode: "BOUNDARY_TARGETS" } });
  });

  it("7. FULL_UNIT → whole-unit recall; never split into words; no AI needed for a lone fresh FULL_UNIT", () => {
    const f = facts(unit(fullUnit("FORGOTTEN")));
    const c = ctxOf(f);
    expect(deterministicDecision(c)).toMatchObject({ action: "EXERCISE", exercise: { exerciseType: "WHOLE_UNIT_RECALL", hiddenTokens: [], reasonCode: "FULL_UNIT_WEAKNESS" } });
    expect(decisionNeedsAI(c)).toBe(false);
    expect(v(ex({ hiddenTokens: [] }), c)).toMatchObject({ ok: false, reason: expect.stringContaining("word-level") });
    expect(v(ex({ exerciseType: "WHOLE_UNIT_RECALL", hiddenTokens: [{ unitRef: "u1", index: 0 }], cueLevel: "NONE", reasonCode: "FULL_UNIT_WEAKNESS" }), c).ok).toBe(false);
    const rendered = renderExercise(ex({ exerciseType: "WHOLE_UNIT_RECALL", hiddenTokens: [], cueLevel: "NONE" }), f, [{ ref: "u1", role: "TARGET", tokens: ["أ", "ب", "ت", "ث", "ج", "ح"] }], false);
    expect(rendered).toEqual([{ role: "TARGET", fullyHidden: true, segments: [{ kind: "HIDDEN" }] }]);
  });

  it("8. repeated / persistent history reaches the AI as structured facts and supports only matching reasons", () => {
    const f = facts(unit({ ...words([4], [2]), previous: words([0], [2, 4]) }));
    const payload = buildCoachPayload(ctxOf(f), "v") as { units: { positions: { token: number; history: string }[] }[] };
    expect(payload.units[0]!.positions).toEqual([
      { token: 4, kind: "INCORRECT", level: "WORD", history: "PERSISTENT" },
      { token: 2, kind: "FORGOTTEN", level: "WORD", history: "REPEATED" },
    ].sort((a, b) => a.token - b.token).map((p) => expect.objectContaining(p)));
    const c = ctxOf(f);
    const hide = [{ unitRef: "u1", index: 2 }];
    expect(v(ex({ hiddenTokens: hide, reasonCode: "REPEATED_TARGET" }), c).ok).toBe(true);
    expect(v(ex({ hiddenTokens: hide, reasonCode: "PERSISTENT_TARGET" }), c).ok).toBe(true);
    expect(v(ex({ hiddenTokens: hide, reasonCode: "NEW_SINGLE_TARGET" }), c).ok).toBe(false);
  });

  it("9–10. a previous intervention that did not hold is a fact the AI sees and lets it choose another strategy", () => {
    const previous = { u1: { exerciseTypes: ["CLOZE_RECALL" as const], lastResponse: "RECALLED" as const, outcome: "REMAINED_AFFECTED" as const } };
    const c = ctxOf(one, { previous });
    expect((buildCoachPayload(c, "v") as { units: { previousIntervention: unknown }[] }).units[0]!.previousIntervention).toEqual(previous.u1);
    const whole = ex({ exerciseType: "WHOLE_UNIT_RECALL", hiddenTokens: [], cueLevel: "NONE", reasonCode: "PREVIOUS_INTERVENTION_REMAINED" });
    expect(v(whole, c).ok).toBe(true);
    // Without that evidence a single marked word does not justify hiding the whole unit, nor that reason.
    expect(v(whole, ctxOf(one)).ok).toBe(false);
    expect(v(ex({ reasonCode: "PREVIOUS_INTERVENTION_REMAINED" }), ctxOf(one)).ok).toBe(false);
  });
});

// ───────────────────────────── B. safety (pure + rendering) ─────────────────────────────

describe("B. strict validator and answer safety", () => {
  const f = facts(unit({ hasPreviousNeighbor: false, ...words([1], [2]) }), unit(), unit({ hasNextNeighbor: false, ...fullUnit("FORGOTTEN") }));
  const c = ctxOf(f);

  it("11. the AI cannot output Matn (or any) text: no free-text field, refs are pattern-checked, extra keys rejected", () => {
    const freeText: string[] = [];
    const walk = (node: Record<string, unknown>, path: string) => {
      if (node.type === "string" && !node.enum) freeText.push(path);
      for (const [k, child] of Object.entries((node.properties as Record<string, Record<string, unknown>>) ?? {})) walk(child, `${path}.${k}`);
      if (node.items) walk(node.items as Record<string, unknown>, `${path}[]`);
    };
    walk(REINFORCEMENT_EXERCISE_JSON_SCHEMA as unknown as Record<string, unknown>, "");
    expect(freeText).toEqual([".unitRefs[]", ".hiddenTokens[].unitRef"]);
    expect(v(ex({ unitRefs: ["وحدة اختبار"] }), c).ok).toBe(false);
    expect(validateCoachDecision({ ...raw(ex()), text: "وحدة اختبار" }, c)).toMatchObject({ ok: false, reason: expect.stringContaining("schema") });
    expect(COACH_SYSTEM_PROMPT).toMatch(/No prose, no Matn text/);
  });
  it("12. invalid / fractional / unmarked token indexes are rejected", () => {
    expect(v(ex({ hiddenTokens: [{ unitRef: "u1", index: 99 }] }), c)).toMatchObject({ ok: false, reason: expect.stringContaining("out of range") });
    expect(v(ex({ hiddenTokens: [{ unitRef: "u1", index: 1.5 }] }), c).ok).toBe(false);
    expect(v(ex({ hiddenTokens: [{ unitRef: "u1", index: 4 }] }), c)).toMatchObject({ ok: false, reason: expect.stringContaining("not marked") });
  });
  it("13. invented unit refs are rejected", () => expect(v(ex({ unitRefs: ["u9"], hiddenTokens: [] }), c)).toMatchObject({ ok: false, reason: expect.stringContaining("unknown unit") }));
  it("15. non-contiguous sequences are rejected", () => {
    const g = facts(unit(words([1])), unit(), unit(words([2])));
    expect(v(ex({ exerciseType: "LINKED_SEQUENCE_RECALL", unitRefs: ["u1", "u3"], hiddenTokens: [{ unitRef: "u1", index: 1 }], reasonCode: "MULTIPLE_RELATED_TARGETS" }), ctxOf(g))).toMatchObject({ ok: false, reason: expect.stringContaining("contiguous") });
  });
  it("16. context is bounded (≤ 3 units) and never crosses the book boundary", () => {
    const five = facts(unit(), unit(words([1])), unit(words([1])), unit(words([1])), unit());
    expect(exerciseWindow(five, ["u2", "u3", "u4"], "BOTH")).toMatchObject({ ok: false, reason: expect.stringContaining("too large") });
    expect(exerciseWindow(five, ["u3"], "BOTH")).toMatchObject({ ok: true });
    expect(validateCoachDecision({ ...raw(ex({ exerciseType: "LINKED_SEQUENCE_RECALL" })), unitRefs: ["u1", "u2", "u3", "u4"] }, ctxOf(five)).ok).toBe(false);
    expect(v(ex({ exerciseType: "CONTEXT_RECALL", contextLevel: "PREVIOUS", hiddenTokens: [{ unitRef: "u1", index: 1 }], reasonCode: "NEW_SINGLE_TARGET" }), c)).toMatchObject({ ok: false, reason: expect.stringContaining("book boundary") });
  });
  it("17. reason codes must be supported by observable facts (no history, no exposure, no delay → rejected)", () => {
    const hide = [{ unitRef: "u1", index: 1 }];
    expect(v(ex({ hiddenTokens: hide, reasonCode: "REPEATED_TARGET" }), c)).toMatchObject({ ok: false, reason: expect.stringContaining("not supported") });
    expect(v(ex({ hiddenTokens: hide, reasonCode: "SUCCEEDED_WITH_CONTEXT" }), c).ok).toBe(false);
    expect(v(ex({ hiddenTokens: hide, reasonCode: "DELAYED_RECHECK" }), c).ok).toBe(false);
    expect(v(ex({ hiddenTokens: hide, reasonCode: "PREVIOUS_INTERVENTION_REMAINED" }), c).ok).toBe(false);
  });
  it("18. unknown keys (e.g. a diagnosis) are rejected", () => {
    expect(validateCoachDecision({ ...raw(ex({ hiddenTokens: [{ unitRef: "u1", index: 1 }] })), diagnosis: "sequencing difficulty" }, c).ok).toBe(false);
  });
  it("FINISH only after every target was practised and recalled; closed targets and the budget are code-controlled", () => {
    const g = facts(unit(words([], [2])));
    expect(validateCoachDecision(FINISH, ctxOf(g)).ok).toBe(false);
    expect(validateCoachDecision(FINISH, ctxOf(g, { played: played([ex(), "PARTIAL"]) })).ok).toBe(false);
    expect(validateCoachDecision(FINISH, ctxOf(g, { played: played([ex(), "RECALLED"]) })).ok).toBe(true);
    const failedTwice = ctxOf(g, { played: played([ex(), "NOT_RECALLED"], [ex({ exerciseType: "CONTEXT_RECALL", contextLevel: "BOTH", reasonCode: "FAILED_TARGETED_RECALL" }), "NOT_RECALLED"]) });
    expect(deriveSession(failedTwice).get("u1")).toMatchObject({ closed: true, closedBy: "FAILURE_CAP" });
    expect(sessionDone(failedTwice)).toBe(true);
    expect(v(ex({ exerciseType: "WHOLE_UNIT_RECALL", hiddenTokens: [], cueLevel: "NONE", reasonCode: "FAILED_TARGETED_RECALL" }), failedTwice)).toMatchObject({ ok: false, reason: expect.stringContaining("exhausted or every target closed") });
  });

  const MATN = ["الْحَمْدُ", "لِلَّهِ", "رَبِّ", "الْعَالَمِينَ", "وَ", "لِلَّهِ،"];
  const g = facts(unit(words([], [1])));
  const cloze = ex({ hiddenTokens: [{ unitRef: "u1", index: 1 }] });

  it("19. the hidden word is not sent before reveal — not even where the same word recurs in the visible text", () => {
    const before = renderExercise(cloze, g, [{ ref: "u1", role: "TARGET", tokens: MATN }], false);
    expect(before[0]!.segments).toEqual([
      { kind: "TEXT", text: "الْحَمْدُ", wasHidden: false, target: true },
      { kind: "HIDDEN" },
      { kind: "TEXT", text: "رَبِّ", wasHidden: false, target: true },
      { kind: "TEXT", text: "الْعَالَمِينَ", wasHidden: false, target: true },
      { kind: "TEXT", text: "وَ", wasHidden: false, target: true },
      { kind: "MASKED" },
    ]);
    expect(JSON.stringify(before)).not.toMatch(/لِلَّهِ|لله/);
    const after = renderExercise(cloze, g, [{ ref: "u1", role: "TARGET", tokens: MATN }], true);
    expect(after[0]!.segments.map((s) => (s.kind === "TEXT" ? s.text : "?")).join(" ")).toBe(MATN.join(" "));
    expect(after[0]!.segments[1]).toMatchObject({ wasHidden: true });
  });
  it("cue levels reveal only ±3 / ±1 / 0 neighbouring words of the target unit", () => {
    const ten = facts(unit({ tokenCount: 10, ...words([], [5]) }));
    const tokens = Array.from({ length: 10 }, (_, i) => `ك${i}`);
    const visible = (cueLevel: "PARTIAL" | "MINIMAL" | "NONE") =>
      renderExercise(ex({ exerciseType: "REDUCED_CUE_RECALL", hiddenTokens: [{ unitRef: "u1", index: 5 }], cueLevel }), ten, [{ ref: "u1", role: "TARGET", tokens }], false)[0]!.segments.map((s) => (s.kind === "TEXT" ? s.text : s.kind));
    expect(visible("PARTIAL")).toEqual(["MASKED", "ك2", "ك3", "ك4", "HIDDEN", "ك6", "ك7", "ك8", "MASKED"]);
    expect(visible("MINIMAL")).toEqual(["MASKED", "ك4", "HIDDEN", "ك6", "MASKED"]);
    expect(visible("NONE")).toEqual(["MASKED", "HIDDEN", "MASKED"]);
    expect(cueStrength({ exerciseType: "CONTEXT_RECALL", contextLevel: "PREVIOUS", cueLevel: "FULL" })).toBeGreaterThan(cueStrength({ exerciseType: "CLOZE_RECALL", contextLevel: "NONE", cueLevel: "FULL" }));
  });
  it("20. accessibility: placeholders are announced as «كلمة مخفية» / «نص مخفي» / «سطر مخفي»; the answer is not in the markup before reveal", () => {
    const html = (revealed: boolean) => renderToStaticMarkup(createElement(ExerciseText, { units: renderExercise(cloze, g, [{ ref: "u1", role: "TARGET", tokens: MATN }], revealed), revealed }));
    const before = html(false);
    expect(before).toContain("كلمة مخفية");
    expect(before).toContain("نص مخفي");
    expect(before).not.toMatch(/لِلَّهِ/);
    expect(before).not.toMatch(/aria-label="[^"]*لل/);
    expect(before).toContain('lang="ar"');
    const after = html(true);
    expect(after).toContain("لِلَّهِ");
    expect(after).toContain("(كانت مخفية)");
    const whole = renderToStaticMarkup(createElement(ExerciseText, { units: renderExercise(ex({ exerciseType: "WHOLE_UNIT_RECALL", hiddenTokens: [], cueLevel: "NONE" }), facts(unit(fullUnit("FORGOTTEN"))), [{ ref: "u1", role: "TARGET", tokens: MATN }], false), revealed: false }));
    expect(whole).toContain("سطر مخفي");
    expect(whole).not.toMatch(/الْحَمْدُ/);
  });

  const SOURCES = ["src/server/memorization/reinforcement", "src/components/memorize/reinforcement-coach.tsx", "src/components/memorize/exercise-text.tsx", "src/components/memorize/baseline-review.tsx", "src/app/(focus)/memorize/reinforce"];
  const read = (p: string): string => (statSync(p).isDirectory() ? readdirSync(p).map((n) => read(join(p, n))).join("\n") : readFileSync(p, "utf8"));
  const code = SOURCES.map(read).join("\n");
  it("21–22. no audio leaves the browser and there is no transcript / speech recognition in the coach", () => {
    expect(code).not.toMatch(/MediaRecorder|getUserMedia|new Blob|FormData|SpeechRecognition|webkitSpeech|transcribe\(/);
    const payload = JSON.stringify(buildCoachPayload(ctxOf(facts(unit(words([1])))), "v"));
    expect(payload).not.toMatch(/audio|recording|transcript|blob/i);
  });
});

// ───────────────────────────── E. outcome integrity (pure) ─────────────────────────────

describe("E. before/after outcome integrity", () => {
  const before = facts(unit({ unitId: "a", ...words([1], [2, 3]) }), unit({ unitId: "b", ...fullUnit("FORGOTTEN") }), unit({ unitId: "c" }), unit({ unitId: "d", ...fullUnit("INCORRECT") }));
  const after = facts(unit({ unitId: "a", ...words([4], [3]) }), unit({ unitId: "b", ...correct }), unit({ unitId: "c", ...fullUnit("FORGOTTEN") }), unit({ unitId: "d", ...words([0]) }));
  const o = compareOutcomeDetailed(before, after);

  it("41–44. resolved / remaining / new are exact and INCORRECT / FORGOTTEN stay separable", () => {
    expect(o.word).toEqual({ before: { INCORRECT: 1, FORGOTTEN: 2 }, resolved: { INCORRECT: 1, FORGOTTEN: 1 }, remaining: { INCORRECT: 0, FORGOTTEN: 1 }, newAffected: { INCORRECT: 1, FORGOTTEN: 0 }, resolutionRate: 0.667 });
  });
  it("45–46. FULL_UNIT stays unit-level (never N words), with its own rate; totals equal the learner-facing comparison", () => {
    expect(o.unit).toEqual({ before: { INCORRECT: 1, FORGOTTEN: 1 }, resolved: { INCORRECT: 0, FORGOTTEN: 1 }, remaining: { INCORRECT: 1, FORGOTTEN: 0 }, newAffected: { INCORRECT: 0, FORGOTTEN: 1 }, resolutionRate: 0.5 });
    const sum = (k: "resolved" | "remaining" | "newAffected") => o.word[k].INCORRECT + o.word[k].FORGOTTEN + o.unit[k].INCORRECT + o.unit[k].FORGOTTEN;
    expect(compareAssessments(before, after)).toMatchObject({ nowCorrect: sum("resolved"), remaining: sum("remaining"), newlyAffected: sum("newAffected") });
    expect(before.totals).toMatchObject({ incorrectTokens: 1, forgottenTokens: 2, unitLevelTokens: 12 });
    expect(compareOutcomeDetailed(facts(unit({ unitId: "z" })), facts(unit({ unitId: "z" }))).word.resolutionRate).toBeNull();
  });
});

describe("F. canonical tokenizer unchanged", () => {
  it("49. tokens are exact whitespace-separated runs (punctuation and tashkeel untouched)", () => {
    expect(tokenizeCanonicalMatn("الْحَمْدُ لِلَّهِ، رَبِّ  الْعَالَمِينَ .")).toEqual(["الْحَمْدُ", "لِلَّهِ،", "رَبِّ", "الْعَالَمِينَ", "."]);
    expect(tokenizeCanonicalMatn("  ")).toEqual([]);
  });
});

describe("D. baseline cannot be selected by an ordinary learner", () => {
  it("40. only a server-side allowlist selects BASELINE_REVIEW; no route, action or component can set it", () => {
    expect(resolveReviewMode("learner-1", {})).toBe("AI_ADAPTIVE_REVIEW");
    expect(resolveReviewMode("learner-1", { REINFORCEMENT_BASELINE_USER_IDS: "learner-10, learner-2" })).toBe("AI_ADAPTIVE_REVIEW");
    expect(resolveReviewMode("learner-2", { REINFORCEMENT_BASELINE_USER_IDS: "learner-10, learner-2" })).toBe("BASELINE_REVIEW");
    const read = (p: string): string => (statSync(p).isDirectory() ? readdirSync(p).map((n) => read(join(p, n))).join("\n") : readFileSync(p, "utf8"));
    const ui = read("src/app") + read("src/components");
    expect(ui).not.toMatch(/resolveReviewMode|REINFORCEMENT_BASELINE_USER_IDS|reviewMode\s*:/);
    expect(read("src/app/(focus)/memorize/reinforce")).not.toMatch(/searchParams/);
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
const text = (u: { segments: { kind: string; text?: string }[] }) => u.segments.map((s) => (s.kind === "TEXT" ? s.text : `[${s.kind}]`)).join(" ");

describe.skipIf(!hasTestDb)("reinforcement coach (database)", () => {
  let db: PrismaClient;
  let userId: string;
  beforeEach(async () => {
    db = testDb();
    await truncateAll();
    await seedFixtureCurriculum(db);
    await seedMatnFixture(db);
    userId = (await createUser(db, "student@example.com")).id;
  });

  const submit = (results: Detail[], at: Date, o: { passageId?: string; planId?: string; user?: string } = {}) =>
    submitRecitation(db, o.user ?? userId, { passageId: o.passageId ?? "pass-a", clientAttemptId: `coach-${++seq}-${Date.now()}`, results, ...(o.planId ? { reinforcementPlanId: o.planId } : {}) }, { now: at, provider: null });
  const planOf = async (results: Detail[], at = T0, o: { passageId?: string; reviewMode?: "AI_ADAPTIVE_REVIEW" | "BASELINE_REVIEW"; user?: string; followOf?: string } = {}) => {
    const { attemptId } = await submit(results, at, { passageId: o.passageId, user: o.user, planId: o.followOf });
    const r = await ensureReinforcementPlan(db, o.user ?? userId, attemptId, { provider: null, reviewMode: o.reviewMode });
    if (r.kind !== "PLAN") throw new Error("expected a plan");
    return { planId: r.plan.planId, attemptId };
  };
  /** One full interactive step: decide (or reuse), reveal, self-report. */
  const step = async (planId: string, response: RecallResponse, provider: unknown, user = userId): Promise<{ shown: CoachView; next: CoachView }> => {
    const deps = { provider: provider as never, now: new Date() };
    const shown = (await advanceCoach(db, user, planId, deps))!;
    if (!shown.exercise) throw new Error(`no exercise (state ${shown.state})`);
    await revealExercise(db, user, planId, shown.exercise.id);
    const next = (await respondExercise(db, user, planId, shown.exercise.id, response, deps))!;
    return { shown, next };
  };
  const exercises = (planId: string) => db.memorizationReinforcementExercise.findMany({ where: { planId }, orderBy: { order: "asc" } });

  it("A. adaptive session: cloze → fails → context recall → recalls → reduced cue → closes; one AI call per decision", async () => {
    const { planId } = await planOf([W("u-a1", [], [2]), C("u-a2")]);
    const ai = new ScriptedProvider().scriptDecision(
      { action: "EXERCISE", exerciseType: "CLOZE_RECALL", unitRefs: ["u1"], hiddenTokens: [{ unitRef: "u1", index: 2 }], contextLevel: "NONE", cueLevel: "FULL", reasonCode: "NEW_SINGLE_TARGET" },
      { action: "EXERCISE", exerciseType: "CONTEXT_RECALL", unitRefs: ["u1"], hiddenTokens: [{ unitRef: "u1", index: 2 }], contextLevel: "NEXT", cueLevel: "FULL", reasonCode: "FAILED_TARGETED_RECALL" },
      { action: "EXERCISE", exerciseType: "REDUCED_CUE_RECALL", unitRefs: ["u1"], hiddenTokens: [{ unitRef: "u1", index: 2 }], contextLevel: "NONE", cueLevel: "MINIMAL", reasonCode: "SUCCEEDED_WITH_CONTEXT" },
    );
    const first = (await advanceCoach(db, userId, planId, { provider: ai }))!;
    expect(first).toMatchObject({ state: "ACTIVE", exercise: { exerciseType: "CLOZE_RECALL", number: 1, revealed: false, lead: null } });
    expect(text(first.exercise!.units[0]!)).toBe("وحدة اختبار [HIDDEN] الأولى");

    const s1 = await step(planId, "NOT_RECALLED", ai);
    expect(s1.next).toMatchObject({ state: "ACTIVE", exercise: { exerciseType: "CONTEXT_RECALL", lead: "سنراجع هذا الموضع مرة أخرى بطريقة مختلفة." } });
    // Canonical next line as cue; the hidden word «ألف» is masked there too.
    expect(s1.next.exercise!.units.map((u) => [u.role, text(u)])).toEqual([["TARGET", "وحدة اختبار [HIDDEN] الأولى"], ["CONTEXT", "وحدة اختبار [MASKED] الثانية"]]);
    const payload2 = ai.decisionRequests[1]!.payload as { targets: { lastResponse: string; lastExercise: { exerciseType: string } }[]; exercises: unknown[] };
    expect(payload2.targets[0]).toMatchObject({ lastResponse: "NOT_RECALLED", lastExercise: { exerciseType: "CLOZE_RECALL" } });
    expect(payload2.exercises).toHaveLength(1);

    const s2 = await step(planId, "RECALLED", ai);
    expect(s2.next.exercise).toMatchObject({ exerciseType: "REDUCED_CUE_RECALL", lead: "أحسنت. هذه المرة سنقلل التلميح." });
    expect(text(s2.next.exercise!.units[0]!)).toBe("[MASKED] اختبار [HIDDEN] الأولى");
    const s3 = await step(planId, "RECALLED", ai);
    expect(s3.next).toMatchObject({ state: "DONE", needsMoreReview: false, answered: 3 });
    expect(ai.decisionRequests).toHaveLength(3);
    const rows = await exercises(planId);
    expect(rows.map((r) => [r.exerciseType, r.decisionSource, r.decisionOutcome, r.response, r.reasonCode, r.targetRefs])).toEqual([
      ["CLOZE_RECALL", "AI", "AI_ACCEPTED", "NOT_RECALLED", "NEW_SINGLE_TARGET", ["u1"]],
      ["CONTEXT_RECALL", "AI", "AI_ACCEPTED", "RECALLED", "FAILED_TARGETED_RECALL", ["u1"]],
      ["REDUCED_CUE_RECALL", "AI", "AI_ACCEPTED", "RECALLED", "SUCCEEDED_WITH_CONTEXT", ["u1"]],
    ]);
    expect(rows.every((r) => r.readyAt && r.revealedAt && r.respondedAt)).toBe(true);
    expect(await db.memorizationReinforcementPlan.findUniqueOrThrow({ where: { id: planId } })).toMatchObject({ status: "COMPLETED", exposuresCompleted: 3 });
    expect(await db.aIInteractionLog.count({ where: { type: "DECIDE_MEMORIZATION_EXERCISE", status: "SUCCESS" } })).toBe(3);

    // 23. Payloads and prompts: no PII, no database ids, no Matn text, no audio.
    const sent = JSON.stringify([ai.decisionRequests, ai.decisionPrompts]);
    expect(sent).not.toMatch(/student@example|متعلم|u-a1|u-a2|وحدة|اختبار/);
    expect(JSON.stringify(ai.decisionRequests)).not.toMatch(/audio|transcript|recording/i);
    expect(sent).not.toContain(userId);
    expect(sent).not.toContain(planId);
  });

  it("6 / 51. canonical context crosses the passage boundary in canonical order, both directions", async () => {
    const decision = (contextLevel: string) => ({ action: "EXERCISE", exerciseType: "CONTEXT_RECALL", unitRefs: ["u1"], hiddenTokens: [{ unitRef: "u1", index: 3 }], contextLevel, cueLevel: "FULL", reasonCode: "NEW_SINGLE_TARGET" });
    const a = await planOf([W("u-a4", [], [3])]);
    const va = (await advanceCoach(db, userId, a.planId, { provider: new ScriptedProvider().scriptDecision(decision("NEXT")) }))!;
    const ra = (await revealExercise(db, userId, a.planId, va.exercise!.id))!;
    expect(ra.exercise!.units.map((u) => [u.role, text(u)])).toEqual([["TARGET", "وحدة اختبار ألف الرابعة"], ["CONTEXT", "وحدة اختبار باء الأولى"]]);
    // Before reveal: the hidden «الرابعة» is absent, and nothing of the answer is in the view.
    expect(JSON.stringify(va)).not.toContain("الرابعة");

    const b = await planOf([W("u-b1", [], [3])], new Date(T0.getTime() + MIN), { passageId: "pass-b" });
    const vb = (await advanceCoach(db, userId, b.planId, { provider: new ScriptedProvider().scriptDecision(decision("PREVIOUS")) }))!;
    const rb = (await revealExercise(db, userId, b.planId, vb.exercise!.id))!;
    expect(rb.exercise!.units.map((u) => [u.role, text(u)])).toEqual([["CONTEXT", "وحدة اختبار ألف الرابعة"], ["TARGET", "وحدة اختبار باء الأولى"]]);
  });

  it("52. a session across a SECTION boundary keeps canonical order (no duplicate, no skip) through the coach", async () => {
    await db.matnPassage.deleteMany({ where: { id: { in: ["pass-draft", "pass-partial", "pass-empty"] } } });
    await db.matnSection.update({ where: { id: "sec-draft" }, data: { status: "APPROVED" } });
    const session = (await getMemorizationSessionUnits(db, "pass-b", "u-b3", 2))!;
    expect(session.map((u) => u.id)).toEqual(["u-b3", "u-h1"]);
    const { planId } = await planOf([W("u-b3", [], [3]), W("u-h1", [], [0])], T0, { passageId: "pass-b" });
    const view = (await advanceCoach(db, userId, planId, { provider: null }))!;
    expect(view.exercise).toMatchObject({ exerciseType: "LINKED_SEQUENCE_RECALL" });
    const shown = (await revealExercise(db, userId, planId, view.exercise!.id))!;
    expect(shown.exercise!.units.map(text)).toEqual(["وحدة اختبار باء الثالثة", "وحدة اختبار مخفي الأولى"]);
  });

  it("9–10. the previous intervention outcome (REMAINED_AFFECTED / RETURNED_LATER) is loaded from real history and drives a different strategy", async () => {
    // Session 1: cloze, recalled, then the re-recitation still has the word forgotten.
    const s1 = await planOf([W("u-a1", [], [2]), C("u-a2")]);
    await step(s1.planId, "RECALLED", null);
    expect((await advanceCoach(db, userId, s1.planId, { provider: null }))!.state).toBe("DONE");
    const s2 = await planOf([W("u-a1", [], [2]), C("u-a2")], new Date(T0.getTime() + 10 * MIN), { followOf: s1.planId });
    expect((await db.memorizationReinforcementPlan.findUniqueOrThrow({ where: { id: s1.planId } })).followUpAttemptId).toBe(s2.attemptId);

    const ai = new ScriptedProvider().scriptDecision({ action: "EXERCISE", exerciseType: "WHOLE_UNIT_RECALL", unitRefs: ["u1"], hiddenTokens: [], contextLevel: "NONE", cueLevel: "NONE", reasonCode: "PREVIOUS_INTERVENTION_REMAINED" });
    const v2 = (await advanceCoach(db, userId, s2.planId, { provider: ai }))!;
    const units = (ai.decisionRequests[0]!.payload as { units: { previousIntervention: unknown }[] }).units;
    expect(units[0]!.previousIntervention).toEqual({ exerciseTypes: ["CLOZE_RECALL"], lastResponse: "RECALLED", outcome: "REMAINED_AFFECTED" });
    expect(units[1]!.previousIntervention).toBeNull();
    expect(v2.exercise).toMatchObject({ exerciseType: "WHOLE_UNIT_RECALL", lead: "سنراجع هذا الموضع بطريقة مختلفة عن المرة السابقة." });

    // Session 3: the follow-up was correct, the word is forgotten again later → RETURNED_LATER.
    await step(s2.planId, "RECALLED", ai);
    const follow = await submit([C("u-a1"), C("u-a2")], new Date(T0.getTime() + 20 * MIN), { planId: s2.planId });
    expect((await db.memorizationReinforcementPlan.findUniqueOrThrow({ where: { id: s2.planId } })).followUpAttemptId).toBe(follow.attemptId);
    const s3 = await planOf([W("u-a1", [], [2]), C("u-a2")], new Date(T0.getTime() + 60 * MIN));
    const ai3 = new ScriptedProvider().scriptDecision((req: { payload: { units: { previousIntervention: unknown }[] } }) => {
      expect(req.payload.units[0]!.previousIntervention).toEqual({ exerciseTypes: ["WHOLE_UNIT_RECALL"], lastResponse: "RECALLED", outcome: "RETURNED_LATER" });
      return { action: "EXERCISE", exerciseType: "CLOZE_RECALL", unitRefs: ["u1"], hiddenTokens: [{ unitRef: "u1", index: 2 }], contextLevel: "NONE", cueLevel: "FULL", reasonCode: "PREVIOUS_INTERVENTION_REMAINED" };
    });
    expect((await advanceCoach(db, userId, s3.planId, { provider: ai3 }))!.exercise).toMatchObject({ exerciseType: "CLOZE_RECALL" });
    expect(ai3.decisionRequests).toHaveLength(1);
  });

  // ───── C. reliability ─────

  it.each([
    ["24. missing provider", null, "FALLBACK:NOT_CONFIGURED", 0],
    ["24b. provider factory throws", () => {
      throw new Error("AI not configured");
    }, "FALLBACK:NOT_CONFIGURED", 0],
    ["26. rate limit", new ScriptedProvider().scriptDecision(new AIProviderError("RATE_LIMITED", "429")), "FALLBACK:RATE_LIMITED", 1],
    ["27. malformed response", new ScriptedProvider().scriptDecision("not json"), "FALLBACK:VALIDATION_REJECTED", 1],
    ["28. validator rejection (unmarked token)", new ScriptedProvider().scriptDecision({ action: "EXERCISE", exerciseType: "CLOZE_RECALL", unitRefs: ["u1"], hiddenTokens: [{ unitRef: "u1", index: 0 }], contextLevel: "NONE", cueLevel: "FULL", reasonCode: "NEW_SINGLE_TARGET" }), "FALLBACK:VALIDATION_REJECTED", 1],
    ["28b. Matn text in output", new ScriptedProvider().scriptDecision({ action: "EXERCISE", exerciseType: "CLOZE_RECALL", unitRefs: ["u1"], hiddenTokens: [{ unitRef: "u1", index: 2 }], contextLevel: "NONE", cueLevel: "FULL", reasonCode: "NEW_SINGLE_TARGET", answer: "ألف" }), "FALLBACK:VALIDATION_REJECTED", 1],
  ])("%s → safe deterministic exercise, at most one call (no repair call)", async (_name, provider, outcome, calls) => {
    const { planId } = await planOf([W("u-a1", [], [2]), C("u-a2")]);
    const view = (await advanceCoach(db, userId, planId, { provider: provider as never }))!;
    expect(view.exercise).toMatchObject({ exerciseType: "CLOZE_RECALL" });
    const [row] = await exercises(planId);
    expect(row).toMatchObject({ decisionSource: "FALLBACK", decisionOutcome: outcome, exerciseType: "CLOZE_RECALL" });
    if (provider instanceof ScriptedProvider) expect(provider.decisionRequests).toHaveLength(calls);
  });

  it("25. timeout → fallback; 29. after a provider failure the rest of the session makes NO further calls", async () => {
    const { planId } = await planOf([W("u-a1", [], [2]), C("u-a2")]);
    const hanging = new ScriptedProvider().scriptDecision(() => new Promise(() => {}));
    const v1 = (await advanceCoach(db, userId, planId, { provider: hanging, timeoutMs: 30 }))!;
    expect((await exercises(planId))[0]!.decisionOutcome).toBe("FALLBACK:TIMEOUT");
    await revealExercise(db, userId, planId, v1.exercise!.id);
    const v2 = (await respondExercise(db, userId, planId, v1.exercise!.id, "NOT_RECALLED", { provider: hanging, timeoutMs: 30 }))!;
    expect(hanging.decisionRequests).toHaveLength(1);
    expect(v2.exercise).toMatchObject({ exerciseType: "WHOLE_UNIT_RECALL" });
    expect((await exercises(planId))[1]!.decisionOutcome).toBe("FALLBACK:SESSION_DEGRADED");
  });

  it("29b. after a validator rejection the NEXT decision may call again (one call per decision)", async () => {
    const { planId } = await planOf([W("u-a1", [], [2]), C("u-a2")]);
    const ai = new ScriptedProvider().scriptDecision({ bad: true }, { action: "EXERCISE", exerciseType: "CONTEXT_RECALL", unitRefs: ["u1"], hiddenTokens: [{ unitRef: "u1", index: 2 }], contextLevel: "NEXT", cueLevel: "FULL", reasonCode: "FAILED_TARGETED_RECALL" });
    await step(planId, "NOT_RECALLED", ai);
    expect(ai.decisionRequests).toHaveLength(2);
    expect((await exercises(planId)).map((r) => r.decisionOutcome)).toEqual(["FALLBACK:VALIDATION_REJECTED", "AI_ACCEPTED"]);
  });

  it("30. the exercise budget ends every session (dev mock provider, learner never recalls)", async () => {
    const { planId } = await planOf([W("u-a1", [], [2]), C("u-a2"), W("u-a3", [1])]);
    const mock = new MockProvider();
    let view = (await advanceCoach(db, userId, planId, { provider: mock }))!;
    for (let i = 0; i < 20 && view.state === "ACTIVE"; i++) view = (await step(planId, i % 2 ? "PARTIAL" : "NOT_RECALLED", mock)).next;
    expect(view.state).toBe("DONE");
    const rows = (await exercises(planId)).filter((r) => r.exerciseType);
    expect(rows.length).toBeLessThanOrEqual(sessionBudget({ targetGroups: [["u1"], ["u3"]] }));
    expect(rows.every((r) => r.decisionSource === "AI")).toBe(true); // the dev mock only proposes valid exercises here
    expect(new Set(rows.map((r) => r.exerciseType)).size).toBeGreaterThan(1); // it changes strategy after failures
    for (const ref of ["u1", "u3"]) expect(rows.filter((r) => r.targetRefs.includes(ref)).length).toBeLessThanOrEqual(COACH_CAPS.maxExposuresPerTarget);
    expect(await advanceCoach(db, userId, planId, { provider: mock })).toMatchObject({ state: "DONE" });
  });

  it("31. refreshes reuse the same exercise; rendering never creates one", async () => {
    const { planId } = await planOf([W("u-a1", [], [2]), C("u-a2"), W("u-a3", [1])]);
    expect((await getCoachView(db, userId, planId))!.state).toBe("NEEDS_NEXT");
    expect(await exercises(planId)).toHaveLength(0);
    const ai = new ScriptedProvider().scriptDecision({ action: "EXERCISE", exerciseType: "CLOZE_RECALL", unitRefs: ["u1"], hiddenTokens: [{ unitRef: "u1", index: 2 }], contextLevel: "NONE", cueLevel: "FULL", reasonCode: "NEW_SINGLE_TARGET" });
    const ids = new Set<string>();
    for (let i = 0; i < 3; i++) ids.add((await advanceCoach(db, userId, planId, { provider: ai }))!.exercise!.id);
    ids.add((await getCoachView(db, userId, planId))!.exercise!.id);
    expect(ids.size).toBe(1);
    expect(ai.decisionRequests).toHaveLength(1);
    expect(await exercises(planId)).toHaveLength(1);
  });

  it("32. double click / double submit: one reveal, first self-report wins, one next exercise, ≤ 1 call", async () => {
    const { planId } = await planOf([W("u-a1", [], [2]), C("u-a2"), W("u-a3", [1])]);
    const first = (await advanceCoach(db, userId, planId, { provider: null }))!;
    await expect(respondExercise(db, userId, planId, first.exercise!.id, "RECALLED", { provider: null })).rejects.toThrow(); // reveal first
    await expect(respondExercise(db, userId, planId, first.exercise!.id, "MAYBE", { provider: null })).rejects.toThrow();
    await Promise.all([revealExercise(db, userId, planId, first.exercise!.id), revealExercise(db, userId, planId, first.exercise!.id)]);
    const ai = new ScriptedProvider().scriptDecision({ action: "EXERCISE", exerciseType: "CLOZE_RECALL", unitRefs: ["u3"], hiddenTokens: [{ unitRef: "u3", index: 1 }], contextLevel: "NONE", cueLevel: "FULL", reasonCode: "NEW_SINGLE_TARGET" });
    await Promise.all([respondExercise(db, userId, planId, first.exercise!.id, "RECALLED", { provider: ai }), respondExercise(db, userId, planId, first.exercise!.id, "NOT_RECALLED", { provider: ai })]);
    const rows = await exercises(planId);
    expect(rows).toHaveLength(2);
    expect(["RECALLED", "NOT_RECALLED"]).toContain(rows[0]!.response);
    expect(ai.decisionRequests.length).toBeLessThanOrEqual(1);
    // A later, different answer cannot overwrite the first one.
    const stored = rows[0]!.response;
    await respondExercise(db, userId, planId, first.exercise!.id, stored === "RECALLED" ? "NOT_RECALLED" : "RECALLED", { provider: null });
    expect((await exercises(planId))[0]!.response).toBe(stored);
  });

  it("33. second tab: concurrent advances claim one exercise; an abandoned claim is finished deterministically without a call", async () => {
    const { planId } = await planOf([W("u-a1", [], [2]), C("u-a2"), W("u-a3", [1])]);
    const ai = new ScriptedProvider().scriptDecision({ action: "EXERCISE", exerciseType: "CLOZE_RECALL", unitRefs: ["u1"], hiddenTokens: [{ unitRef: "u1", index: 2 }], contextLevel: "NONE", cueLevel: "FULL", reasonCode: "NEW_SINGLE_TARGET" });
    await Promise.all([advanceCoach(db, userId, planId, { provider: ai }), advanceCoach(db, userId, planId, { provider: ai })]);
    expect(await exercises(planId)).toHaveLength(1);
    expect(ai.decisionRequests).toHaveLength(1);

    const other = await planOf([W("u-a1", [], [2]), C("u-a2"), W("u-a3", [1])], new Date(T0.getTime() + MIN));
    await db.memorizationReinforcementExercise.create({ data: { planId: other.planId, order: 1, createdAt: new Date(Date.now() - 60_000) } });
    const silent = new ScriptedProvider();
    expect((await getCoachView(db, userId, other.planId))!.state).toBe("PENDING");
    const resumed = (await advanceCoach(db, userId, other.planId, { provider: silent }))!;
    expect(resumed.state).toBe("ACTIVE");
    expect(silent.decisionRequests).toHaveLength(0);
    expect((await exercises(other.planId))[0]!.decisionOutcome).toBe("FALLBACK:STALE_PENDING");
  });

  it("another learner can neither read, advance, reveal nor answer someone else's session", async () => {
    const { planId } = await planOf([W("u-a1", [], [2]), C("u-a2")]);
    const v1 = (await advanceCoach(db, userId, planId, { provider: null }))!;
    const other = (await createUser(db, "other@example.com")).id;
    expect(await getCoachView(db, other, planId)).toBeNull();
    expect(await advanceCoach(db, other, planId, { provider: null })).toBeNull();
    await expect(revealExercise(db, other, planId, v1.exercise!.id)).rejects.toThrow();
    await expect(respondExercise(db, other, planId, v1.exercise!.id, "RECALLED")).rejects.toThrow();
  });

  it("14 / 50. fail closed when content is no longer approved or its tokens drifted; the coach never writes canonical rows", async () => {
    const snapshot = () => db.matnUnit.findMany({ orderBy: { id: "asc" } });
    const before = await snapshot();
    const { planId } = await planOf([W("u-a1", [], [2]), C("u-a2")]);
    await step(planId, "NOT_RECALLED", new MockProvider());
    await step(planId, "RECALLED", new MockProvider());
    expect(await snapshot()).toEqual(before);

    const view = (await getCoachView(db, userId, planId))!;
    if (view.state === "ACTIVE") {
      await db.matnUnit.update({ where: { id: "u-a1" }, data: { status: "DRAFT" } });
      expect((await getCoachView(db, userId, planId))!.state).toBe("UNAVAILABLE");
      await db.matnUnit.update({ where: { id: "u-a1" }, data: { status: "APPROVED", canonicalText: "وحدة اختبار ألف الأولى المعدلة" } });
      expect((await getCoachView(db, userId, planId))!.state).toBe("UNAVAILABLE");
    }
    const b = await planOf([W("u-a2", [1]), C("u-a3")], new Date(T0.getTime() + MIN), { reviewMode: "BASELINE_REVIEW" });
    await db.matnUnit.update({ where: { id: "u-a2" }, data: { status: "DRAFT" } });
    expect(await getBaselineReview(db, userId, b.planId)).toBeNull();
  });

  // ───── D. baseline ─────

  it("34–39. baseline: zero AI calls, exact canonical text with the learner's marks, no exercises, same re-recitation and measurement", async () => {
    const provider = new ScriptedProvider();
    const { attemptId } = await submit([W("u-a1", [3], [0]), W("u-a2", [], [0]), C("u-a3"), FU("u-a4", "INCORRECT")], T0);
    const r = await ensureReinforcementPlan(db, userId, attemptId, { provider, reviewMode: "BASELINE_REVIEW" });
    expect(r).toMatchObject({ kind: "PLAN", plan: { reviewMode: "BASELINE_REVIEW", planSource: "NONE" } });
    if (r.kind !== "PLAN") return;
    expect(provider.planRequests).toHaveLength(0);

    const view = (await getBaselineReview(db, userId, r.plan.planId))!;
    expect(view.units.map((u) => u.position)).toEqual([1, 2, 4]);
    expect(view.units[0]!.tokens.map((t) => t.text).join(" ")).toBe("وحدة اختبار ألف الأولى");
    expect(view.units[0]!.tokens.map((t) => t.mark)).toEqual(["FORGOTTEN", null, null, "INCORRECT"]);
    expect(view.units[2]).toMatchObject({ evidence: "FULL_UNIT", unitIssue: "INCORRECT" });
    expect(view.units[2]!.tokens.every((t) => t.mark === null)).toBe(true); // a FULL_UNIT is never faked as word marks

    expect(await getCoachView(db, userId, r.plan.planId)).toBeNull();
    expect(await advanceCoach(db, userId, r.plan.planId, { provider })).toBeNull();
    expect(provider.decisionRequests).toHaveLength(0);
    expect(await db.memorizationReinforcementExercise.count()).toBe(0);
    expect(await db.aIInteractionLog.count({ where: { type: { in: ["PLAN_MEMORIZATION_REINFORCEMENT", "DECIDE_MEMORIZATION_EXERCISE"] } } })).toBe(0);

    await finishReinforcement(db, userId, r.plan.planId, { completed: true });
    const after = await submit([C("u-a1"), W("u-a2", [], [0]), C("u-a3"), C("u-a4")], new Date(T0.getTime() + 10 * MIN), { planId: r.plan.planId });
    expect(await db.memorizationReinforcementPlan.findUniqueOrThrow({ where: { id: r.plan.planId } })).toMatchObject({ status: "COMPLETED", exposuresCompleted: 1, followUpAttemptId: after.attemptId });
    expect(await getFollowUpComparison(db, userId, after.attemptId)).toMatchObject({ nowCorrect: 3, remaining: 1, newlyAffected: 0 });
  });

  it("40b. without the allowlist every learner gets AI_ADAPTIVE_REVIEW; with it, only the listed learner gets the baseline", async () => {
    const prev = process.env.REINFORCEMENT_BASELINE_USER_IDS;
    try {
      delete process.env.REINFORCEMENT_BASELINE_USER_IDS;
      const { attemptId } = await submit([W("u-a1", [1]), C("u-a2")], T0);
      expect(await ensureReinforcementPlan(db, userId, attemptId, { provider: null })).toMatchObject({ plan: { reviewMode: "AI_ADAPTIVE_REVIEW" } });
      const listed = (await createUser(db, "cohort@example.com")).id;
      process.env.REINFORCEMENT_BASELINE_USER_IDS = listed;
      const second = await submit([W("u-a1", [1]), C("u-a2")], T0, { user: listed });
      expect(await ensureReinforcementPlan(db, listed, second.attemptId, { provider: null })).toMatchObject({ plan: { reviewMode: "BASELINE_REVIEW" } });
      const third = await submit([W("u-a1", [1]), C("u-a2")], new Date(T0.getTime() + MIN));
      expect(await ensureReinforcementPlan(db, userId, third.attemptId, { provider: null })).toMatchObject({ plan: { reviewMode: "AI_ADAPTIVE_REVIEW" } });
    } finally {
      if (prev === undefined) delete process.env.REINFORCEMENT_BASELINE_USER_IDS;
      else process.env.REINFORCEMENT_BASELINE_USER_IDS = prev;
    }
  });

  // ───── E. mastery / schedule independence + evaluation export ─────

  it("47–48. mastery and the long-term schedule are identical for identical self-assessments, whatever the review condition", async () => {
    const first = [W("u-a1", [1], [3]), C("u-a2")];
    const second = [C("u-a1"), W("u-a2", [0])];
    const learners = [userId, (await createUser(db, "baseline@example.com")).id, (await createUser(db, "none@example.com")).id];
    const later = new Date(T0.getTime() + 10 * MIN);

    const ai = await planOf(first, T0, { user: learners[0] });
    let view = (await advanceCoach(db, learners[0]!, ai.planId, { provider: new MockProvider() }))!;
    for (let i = 0; i < 10 && view.state === "ACTIVE"; i++) view = (await step(ai.planId, "RECALLED", new MockProvider(), learners[0])).next;
    await submit(second, later, { user: learners[0], planId: ai.planId });

    const base = await planOf(first, T0, { user: learners[1], reviewMode: "BASELINE_REVIEW" });
    await finishReinforcement(db, learners[1]!, base.planId, { completed: true });
    await submit(second, later, { user: learners[1], planId: base.planId });

    await submit(first, T0, { user: learners[2] });
    await submit(second, later, { user: learners[2] });

    const pick = async (u: string) => {
      const m = await db.memorizationMastery.findFirstOrThrow({ where: { userId: u } });
      const attempts = await db.recitationAttempt.findMany({ where: { userId: u }, orderBy: { completedAt: "asc" }, select: { scorePercentage: true, nextReviewAt: true } });
      return [m.masteryScore, m.state, m.nextReviewAt.toISOString(), m.consecutiveWeak, attempts.map((a) => [a.scorePercentage, a.nextReviewAt?.toISOString()])];
    };
    const [a, b, c] = await Promise.all(learners.map(pick));
    expect(a).toEqual(c);
    expect(b).toEqual(c);

    const rows = await exportReinforcementEvaluation(db, "test-salt");
    expect(rows.map((r) => [r.reviewMode, r.plannerSource])).toEqual(expect.arrayContaining([["AI_ADAPTIVE_REVIEW", expect.any(String)], ["BASELINE_REVIEW", "NONE"]]));
    const aiRow = rows.find((r) => r.reviewMode === "AI_ADAPTIVE_REVIEW")!;
    expect(aiRow.exercises.length).toBeGreaterThan(0);
    expect(aiRow.exercises[0]).toMatchObject({ order: 1, decisionSource: "AI", response: "RECALLED" });
    expect(aiRow.outcome!.word.before).toEqual({ INCORRECT: 1, FORGOTTEN: 1 });
    expect(aiRow.outcome!.word.resolved).toEqual({ INCORRECT: 1, FORGOTTEN: 1 });
    expect(aiRow.outcome!.word.newAffected).toEqual({ INCORRECT: 1, FORGOTTEN: 0 });
    expect(rows.find((r) => r.reviewMode === "BASELINE_REVIEW")!.outcome).toEqual(aiRow.outcome);
    const exported = JSON.stringify(rows);
    for (const id of learners) expect(exported).not.toContain(id);
    expect(exported).not.toMatch(/@example\.com|وحدة|u-a1/);
  });
});
