import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { ExerciseText } from "@/components/memorize/exercise-text";
import { tokenizeCanonicalMatn } from "@/lib/matn-tokens";
import { submitRecitation } from "@/server/memorization/recitation";
import { renderExercise, type ExerciseDecision, type RenderedUnit } from "@/server/memorization/reinforcement/coach";
import { advanceCoach, getCoachView, hintExercise, revealExercise, respondExercise } from "@/server/memorization/reinforcement/coach-service";
import { buildMemorizationPerformanceFacts } from "@/server/memorization/reinforcement/facts";
import { ensureReinforcementPlan } from "@/server/memorization/reinforcement/service";
import { hasTestDb, testDb, truncateAll } from "./helpers/db";
import { createUser, seedFixtureCurriculum } from "./helpers/fixtures";
import { seedMatnFixture } from "./helpers/matn-fixtures";

/**
 * Guided active recall: a recall card never asks «هل استذكرته؟» about a blank. It shows the previous line, or the start
 * of the hidden line, and progressive hints reveal more of the beginning — never the whole answer before «أظهر النص».
 */

const words = (u: RenderedUnit) => u.segments.map((s) => (s.kind === "TEXT" || s.kind === "PREFIX" ? s.text : `[${s.kind}${s.kind === "HIDDEN" && s.rest ? ":rest" : ""}]`));
const visibleText = (u: RenderedUnit) => u.segments.flatMap((s) => (s.kind === "TEXT" || s.kind === "PREFIX" ? [s.text] : []));

const LINE = tokenizeCanonicalMatn("الفقه معرفة الأحكام الشرعية العملية من أدلتها التفصيلية");
const SHORT = ["كلمة"];
const WHOLE: ExerciseDecision = { exerciseType: "WHOLE_UNIT_RECALL", unitRefs: ["u1"], hiddenTokens: [], contextLevel: "NONE", cueLevel: "NONE", reasonCode: "FULL_UNIT_WEAKNESS" };

function factsFor(tokens: string[]) {
  return buildMemorizationPerformanceFacts([
    { unitId: "x1", tokenCount: tokens.length, status: "FORGOTTEN", scope: "FULL_UNIT", incorrect: [], forgotten: [], previous: null, hasPreviousNeighbor: false, hasNextNeighbor: false },
  ]);
}

describe("guided recall rendering (pure)", () => {
  const target = (tokens: string[]) => [{ ref: "u1", role: "TARGET" as const, tokens }];

  it("H — no previous line: the beginning of the line is the cue («الفقه معرفة ____»), the rest stays hidden", () => {
    const [unit] = renderExercise(WHOLE, factsFor(LINE), target(LINE), false, { leadingCue: true });
    expect(words(unit!)).toEqual(["الفقه", "معرفة", "[HIDDEN:rest]"]);
    expect(unit!.fullyHidden).toBe(false);
  });

  it("G (pure) — with a visible previous line no word of the target is given away", () => {
    const window = [{ ref: null, role: "CONTEXT" as const, tokens: ["السطر", "السابق"] }, ...target(LINE)];
    const units = renderExercise(WHOLE, factsFor(LINE), window, false, { leadingCue: true });
    expect(words(units[0]!)).toEqual(["السطر", "السابق"]);
    expect(units[1]).toEqual({ role: "TARGET", fullyHidden: true, segments: [{ kind: "HIDDEN" }] });
  });

  it("I — hints reveal progressively and never the whole answer; the answer is absent from the markup before reveal", () => {
    const levels = [0, 1, 2].map((hints) => visibleText(renderExercise(WHOLE, factsFor(LINE), target(LINE), false, { leadingCue: true, hints })[0]!));
    expect(levels[0]!.length).toBeLessThan(levels[1]!.length);
    expect(levels[1]!.length).toBeLessThan(levels[2]!.length);
    for (const shown of levels) {
      expect(shown.length).toBeLessThan(LINE.length);
      expect(shown).toEqual(LINE.slice(0, shown.length)); // always the beginning, in order
    }
    // Hints beyond the maximum are clamped.
    expect(visibleText(renderExercise(WHOLE, factsFor(LINE), target(LINE), false, { leadingCue: true, hints: 99 })[0]!)).toEqual(levels[2]);
    const html = renderToStaticMarkup(createElement(ExerciseText, { units: renderExercise(WHOLE, factsFor(LINE), target(LINE), false, { leadingCue: true, hints: 2 }), revealed: false }));
    expect(html).toContain("بقية السطر مخفية");
    expect(html).not.toContain(LINE.at(-1)!);
    expect(html).toContain('lang="ar"');
  });

  it("a one-word line is never exposed by its cue: only its first letter is given", () => {
    const [unit] = renderExercise(WHOLE, factsFor(SHORT), target(SHORT), false, { leadingCue: true });
    expect(unit!.segments).toEqual([{ kind: "PREFIX", text: "ك" }, { kind: "HIDDEN", rest: true }]);
  });

  it("word-level exercises: a hint gives the first letter of a single hidden word, then nothing more", () => {
    const cloze: ExerciseDecision = { exerciseType: "CLOZE_RECALL", unitRefs: ["u1"], hiddenTokens: [{ unitRef: "u1", index: 1 }], contextLevel: "NONE", cueLevel: "FULL", reasonCode: "NEW_SINGLE_TARGET" };
    const f = buildMemorizationPerformanceFacts([{ unitId: "x1", tokenCount: LINE.length, status: "FORGOTTEN", scope: "WORDS", incorrect: [], forgotten: [1], previous: null, hasPreviousNeighbor: false, hasNextNeighbor: false }]);
    const base = renderExercise(cloze, f, target(LINE), false, { leadingCue: true });
    expect(base[0]!.segments.filter((s) => s.kind === "HIDDEN")).toHaveLength(1);
    expect(visibleText(base[0]!)).not.toContain("معرفة");
    const hinted = renderExercise(cloze, f, target(LINE), false, { leadingCue: true, hints: 1 });
    expect(hinted[0]!.segments).toContainEqual({ kind: "PREFIX", text: "م" });
    expect(visibleText(hinted[0]!)).not.toContain("معرفة");
  });

  it("without a cue argument rendering is unchanged (decision logic and existing behaviour untouched)", () => {
    expect(renderExercise(WHOLE, factsFor(LINE), target(LINE), false)).toEqual([{ role: "TARGET", fullyHidden: true, segments: [{ kind: "HIDDEN" }] }]);
  });

  it("after reveal the whole canonical line is shown with the hidden part highlighted", () => {
    const [unit] = renderExercise(WHOLE, factsFor(LINE), target(LINE), true, { leadingCue: true, hints: 2 });
    expect(visibleText(unit!)).toEqual(LINE);
  });
});

type Detail = { unitId: string; status: "CORRECT" | "INCORRECT" | "FORGOTTEN"; scope?: "WORDS" | "FULL_UNIT" | null; wordIndexes?: number[]; forgottenWordIndexes?: number[] };
const C = (unitId: string): Detail => ({ unitId, status: "CORRECT", scope: null, wordIndexes: [], forgottenWordIndexes: [] });
const FU = (unitId: string): Detail => ({ unitId, status: "FORGOTTEN", scope: "FULL_UNIT", wordIndexes: [], forgottenWordIndexes: [] });
let seq = 0;

describe.skipIf(!hasTestDb)("guided recall in the coach session (database)", () => {
  let db: PrismaClient;
  let userId: string;
  beforeEach(async () => {
    db = testDb();
    await truncateAll();
    await seedFixtureCurriculum(db);
    await seedMatnFixture(db);
    userId = (await createUser(db, "student@example.com")).id;
  });

  async function planOf(results: Detail[]) {
    const { attemptId } = await submitRecitation(db, userId, { passageId: "pass-a", clientAttemptId: `guided-${++seq}`, results }, { now: new Date(), provider: null });
    const r = await ensureReinforcementPlan(db, userId, attemptId, { provider: null });
    if (r.kind !== "PLAN") throw new Error("expected a plan");
    return r.plan.planId;
  }
  const unitText = async (id: string) => (await db.matnUnit.findUniqueOrThrow({ where: { id } })).canonicalText;

  it("G — a forgotten whole line in the middle shows the previous line and asks «ما النص الذي يأتي بعده؟»", async () => {
    const planId = await planOf([C("u-a1"), FU("u-a2"), C("u-a3")]);
    const view = (await advanceCoach(db, userId, planId, { provider: null }))!;
    const ex = view.exercise!;
    expect(ex.exerciseType).toBe("WHOLE_UNIT_RECALL");
    expect(ex.instruction).toBe("ما النص الذي يأتي بعده؟");
    expect(ex.units[0]).toMatchObject({ role: "CONTEXT" });
    expect(ex.units[0]!.segments.some((s) => s.kind === "TEXT")).toBe(true);
    expect(JSON.stringify(ex.units)).not.toContain(await unitText("u-a2"));
  });

  it("H — the first line of the book (no previous line) shows its own beginning, never a blank card", async () => {
    const planId = await planOf([FU("u-a1"), C("u-a2")]);
    const ex = (await advanceCoach(db, userId, planId, { provider: null }))!.exercise!;
    expect(ex.units[0]!.role).toBe("TARGET");
    const first = tokenizeCanonicalMatn(await unitText("u-a1"));
    const shown = ex.units[0]!.segments.flatMap((s) => (s.kind === "TEXT" ? [s.text] : []));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown).toEqual(first.slice(0, shown.length));
    expect(shown.length).toBeLessThan(first.length);
    expect(ex.instruction).toBe("أكمل السطر من بدايته الظاهرة.");
  });

  it("I — hints are progressive, end before the full answer, never change the stored decision, and the self-report flow continues", async () => {
    const planId = await planOf([C("u-a1"), FU("u-a2"), C("u-a3")]);
    const ex = (await advanceCoach(db, userId, planId, { provider: null }))!.exercise!;
    const before = await db.memorizationReinforcementExercise.findUniqueOrThrow({ where: { id: ex.id } });
    const full = tokenizeCanonicalMatn(await unitText("u-a2"));
    const given = (level: number) => hintExercise(db, userId, planId, ex.id, level).then((v) => v!.exercise!.units.at(-1)!.segments.flatMap((s) => (s.kind === "TEXT" ? [s.text] : [])));

    const one = await given(1);
    const two = await given(2);
    expect(one.length).toBeGreaterThan(0);
    expect(two.length).toBeGreaterThanOrEqual(one.length);
    expect(two.length).toBeLessThan(full.length);
    expect((await hintExercise(db, userId, planId, ex.id, 2))!.exercise!.hints).toMatchObject({ used: 2, canHint: false });
    await expect(hintExercise(db, userId, planId, ex.id, 3)).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const after = await db.memorizationReinforcementExercise.findUniqueOrThrow({ where: { id: ex.id } });
    expect(after).toEqual(before); // hints never touch the stored exercise
    const revealed = (await revealExercise(db, userId, planId, ex.id))!;
    expect(revealed.exercise!.hints).toEqual({ used: 0, canHint: false });
    expect(JSON.stringify(revealed.exercise!.units)).toContain(full.at(-1)!);
    const next = (await respondExercise(db, userId, planId, ex.id, "PARTIAL", { provider: null }))!;
    expect(next.answered).toBe(1);
    expect((await getCoachView(db, userId, planId))!.answered).toBe(1);
  });

  it("last line of the passage with a forgotten whole line still gets its previous line as a cue", async () => {
    const planId = await planOf([C("u-a1"), C("u-a2"), C("u-a3"), FU("u-a4")]);
    const ex = (await advanceCoach(db, userId, planId, { provider: null }))!.exercise!;
    expect(ex.units[0]!.role).toBe("CONTEXT");
    expect(ex.instruction).toBe("ما النص الذي يأتي بعده؟");
  });
});
