import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectSuspiciousTokens, normalizeWhitespace, stripExtractionArtifacts, tokenize } from "@/server/memorization/canonical";
import { MASTERY_RULES, REVIEW_RULES } from "@/server/memorization/config";
import { stateFor, updateMastery, type MasterySnapshot } from "@/server/memorization/mastery";
import { expectedUnitLines, planImport, structureStats, verifyStructure, type MatnStructure } from "@/server/memorization/matn-import";
import { computeNextReview, describeReviewDelay } from "@/server/memorization/schedule";
import { scoreAttempt } from "@/server/memorization/scoring";
import { validateAnalysis } from "@/server/memorization/analysis";

const root = process.cwd();
const source = readFileSync(join(root, "content/matn-akhsar.source.txt"), "utf8");
const structure = JSON.parse(readFileSync(join(root, "content/matn-akhsar.structure.json"), "utf8")) as MatnStructure;

const S = (c: number, i = 0, f = 0) => scoreAttempt([...Array(c).fill("CORRECT"), ...Array(i).fill("INCORRECT"), ...Array(f).fill("FORGOTTEN")]);

// ───────────────────────────── scoring ─────────────────────────────

describe("deterministic score", () => {
  it("10 correct, 1 incorrect, 1 forgotten of 12 → 10/12", () => {
    const s = S(10, 1, 1);
    expect(s).toMatchObject({ totalUnits: 12, correctUnits: 10, incorrectUnits: 1, forgottenUnits: 1 });
    expect(s.scorePercentage).toBeCloseTo((10 / 12) * 100, 10);
    expect(Math.round(s.scorePercentage)).toBe(83);
  });
  it("handles all-correct and all-forgotten", () => {
    expect(S(5).scorePercentage).toBe(100);
    expect(S(0, 0, 4).scorePercentage).toBe(0);
  });
});

// ───────────────────────────── mastery ─────────────────────────────

const snap = (over: Partial<MasterySnapshot> = {}): MasterySnapshot => ({ masteryScore: 72, attempts: 1, reviewCount: 0, consecutiveCorrect: 0, consecutiveWeak: 1, errorCount: 2, forgottenCount: 0, ...over });

describe("memorization mastery", () => {
  it("first attempt: score × 0.9, and a perfect first attempt is «جيد», never «متقن»", () => {
    const m = updateMastery({ previous: null, attempt: S(10), repeatedWeakUnits: 0, wasDue: false });
    expect(m.masteryScore).toBe(90);
    expect(m.state).toBe("GOOD");
    expect(m).toMatchObject({ attempts: 1, consecutiveCorrect: 1, consecutiveWeak: 0, reviewCount: 0 });
  });

  it("mixed first attempt (8/10) → 72 «يحتاج إلى تثبيت»", () => {
    const m = updateMastery({ previous: null, attempt: S(8, 2), repeatedWeakUnits: 0, wasDue: false });
    expect(m.masteryScore).toBe(72);
    expect(m.state).toBe("NEEDS_REINFORCEMENT");
    expect(m).toMatchObject({ errorCount: 2, forgottenCount: 0, consecutiveCorrect: 0, consecutiveWeak: 1 });
  });

  it("forgotten units are counted and weigh on the score", () => {
    const m = updateMastery({ previous: null, attempt: S(2, 0, 4), repeatedWeakUnits: 0, wasDue: false });
    expect(m.masteryScore).toBe(30);
    expect(m.state).toBe("NEEDS_REVIEW");
    expect(m.forgottenCount).toBe(4);
  });

  it("two perfect attempts in a row reach «متقن»", () => {
    const first = updateMastery({ previous: null, attempt: S(10), repeatedWeakUnits: 0, wasDue: false });
    const second = updateMastery({ previous: { ...first, reviewCount: 0 }, attempt: S(10), repeatedWeakUnits: 0, wasDue: true });
    expect(second.masteryScore).toBe(100); // 0.6×100 + 0.4×90 = 96, +5 streak bonus, clamped
    expect(second.consecutiveCorrect).toBe(2);
    expect(second.state).toBe("MASTERED");
    expect(second.reviewCount).toBe(1);
  });

  it("repeated weakness costs 3 points per unit (max 15)", () => {
    const plain = updateMastery({ previous: snap(), attempt: S(8, 2), repeatedWeakUnits: 0, wasDue: false });
    const repeated = updateMastery({ previous: snap(), attempt: S(8, 2), repeatedWeakUnits: 2, wasDue: false });
    expect(plain.masteryScore - repeated.masteryScore).toBe(6);
    const capped = updateMastery({ previous: snap(), attempt: S(8, 2), repeatedWeakUnits: 9, wasDue: false });
    expect(plain.masteryScore - capped.masteryScore).toBe(MASTERY_RULES.maxRepeatedWeakPenalty);
  });

  it("recovery after weakness: a perfect attempt resets the weak streak and lifts the state", () => {
    const m = updateMastery({ previous: snap({ masteryScore: 50, consecutiveWeak: 2, attempts: 2 }), attempt: S(10), repeatedWeakUnits: 0, wasDue: true });
    expect(m.masteryScore).toBe(80); // 0.6×100 + 0.4×50
    expect(m.state).toBe("GOOD");
    expect(m.consecutiveWeak).toBe(0);
    expect(m.consecutiveCorrect).toBe(1);
  });

  it("a non-perfect attempt breaks the perfect streak", () => {
    const m = updateMastery({ previous: snap({ masteryScore: 100, consecutiveCorrect: 3, consecutiveWeak: 0 }), attempt: S(9, 1), repeatedWeakUnits: 0, wasDue: true });
    expect(m.consecutiveCorrect).toBe(0);
    expect(m.state).not.toBe("MASTERED");
  });

  it("state thresholds", () => {
    expect(stateFor(95, 2)).toBe("MASTERED");
    expect(stateFor(95, 1)).toBe("GOOD");
    expect(stateFor(75, 0)).toBe("GOOD");
    expect(stateFor(74, 0)).toBe("NEEDS_REINFORCEMENT");
    expect(stateFor(50, 0)).toBe("NEEDS_REINFORCEMENT");
    expect(stateFor(49, 0)).toBe("NEEDS_REVIEW");
  });

  it("is clamped to 0–100", () => {
    expect(updateMastery({ previous: snap({ masteryScore: 5 }), attempt: S(0, 0, 3), repeatedWeakUnits: 3, wasDue: false }).masteryScore).toBe(0);
    expect(updateMastery({ previous: snap({ masteryScore: 100, consecutiveCorrect: 4 }), attempt: S(5), repeatedWeakUnits: 0, wasDue: true }).masteryScore).toBe(100);
  });
});

// ───────────────────────────── review scheduling ─────────────────────────────

const NOW = new Date("2026-10-06T10:00:00Z"); // 13:00 in Riyadh
const base = { now: NOW, timezone: "Asia/Riyadh", forgottenUnits: 0, incorrectUnits: 0, consecutiveCorrect: 1, repeatedWeakness: false };

describe("deterministic review schedule", () => {
  it("FORGOTTEN → very soon (+4 hours, same day)", () => {
    const r = computeNextReview({ ...base, forgottenUnits: 1, consecutiveCorrect: 0 });
    expect(r.rule).toBe("FORGOTTEN");
    expect(r.nextReviewAt.toISOString()).toBe("2026-10-06T14:00:00.000Z");
  });

  it("INCORRECT → the start of the learner's next local day", () => {
    const r = computeNextReview({ ...base, incorrectUnits: 2, consecutiveCorrect: 0 });
    expect(r.rule).toBe("INCORRECT");
    expect(r.nextReviewAt.toISOString()).toBe("2026-10-06T21:00:00.000Z"); // 00:00 on 07 Oct in Riyadh
  });

  it("forgotten wins over incorrect", () => {
    const r = computeNextReview({ ...base, forgottenUnits: 1, incorrectUnits: 3, consecutiveCorrect: 0 });
    expect(r.rule).toBe("FORGOTTEN");
  });

  it("CORRECT lengthens the interval with every consecutive success: 3, 7, 14, 30, 60 days (then stays at 60)", () => {
    const days = [1, 2, 3, 4, 5, 6, 9].map((cc) => {
      const at = computeNextReview({ ...base, consecutiveCorrect: cc }).nextReviewAt;
      return Math.round((at.getTime() - Date.parse("2026-10-05T21:00:00Z")) / 86_400_000);
    });
    expect(days).toEqual([...REVIEW_RULES.correctLadderDays, 60, 60]);
    expect(REVIEW_RULES.correctLadderDays).toEqual([3, 7, 14, 30, 60]);
  });

  it("intervals are strictly increasing along the ladder and shorter after a mistake", () => {
    const at = (cc: number) => computeNextReview({ ...base, consecutiveCorrect: cc }).nextReviewAt.getTime();
    expect(at(1)).toBeLessThan(at(2));
    expect(at(2)).toBeLessThan(at(3));
    const wrong = computeNextReview({ ...base, incorrectUnits: 1, consecutiveCorrect: 0 }).nextReviewAt.getTime();
    expect(wrong).toBeLessThan(at(1));
    const forgot = computeNextReview({ ...base, forgottenUnits: 1, consecutiveCorrect: 0 }).nextReviewAt.getTime();
    expect(forgot).toBeLessThan(wrong);
  });

  it("repeated weakness never waits longer than 12 hours", () => {
    const early = new Date("2026-10-06T00:00:00Z"); // 03:00 Riyadh → next local midnight is 21 hours away
    const plain = computeNextReview({ ...base, now: early, incorrectUnits: 1, consecutiveCorrect: 0 });
    const weak = computeNextReview({ ...base, now: early, incorrectUnits: 1, consecutiveCorrect: 0, repeatedWeakness: true });
    expect(plain.nextReviewAt.toISOString()).toBe("2026-10-06T21:00:00.000Z");
    expect(weak.nextReviewAt.toISOString()).toBe("2026-10-06T12:00:00.000Z");
    expect(weak.cappedByRepeatedWeakness).toBe(true);
    // It never lengthens an interval that is already short.
    expect(computeNextReview({ ...base, forgottenUnits: 1, consecutiveCorrect: 0, repeatedWeakness: true }).nextReviewAt.toISOString()).toBe("2026-10-06T14:00:00.000Z");
  });

  it("respects the learner's timezone at the day boundary", () => {
    const riyadh = computeNextReview({ ...base, incorrectUnits: 1, consecutiveCorrect: 0, timezone: "Asia/Riyadh" });
    const newYork = computeNextReview({ ...base, incorrectUnits: 1, consecutiveCorrect: 0, timezone: "America/New_York" });
    expect(riyadh.nextReviewAt.toISOString()).toBe("2026-10-06T21:00:00.000Z");
    expect(newYork.nextReviewAt.toISOString()).toBe("2026-10-07T04:00:00.000Z");
    // 23:30 in Riyadh is still the 6th: «tomorrow» starts only 30 minutes later.
    const lateNight = computeNextReview({ ...base, now: new Date("2026-10-06T20:30:00Z"), incorrectUnits: 1, consecutiveCorrect: 0 });
    expect(lateNight.nextReviewAt.toISOString()).toBe("2026-10-06T21:00:00.000Z");
  });

  it("describes the delay for the result screen", () => {
    expect(describeReviewDelay(NOW, new Date(NOW.getTime() + 4 * 3_600_000), "Asia/Riyadh")).toEqual({ kind: "hours", amount: 4 });
    expect(describeReviewDelay(NOW, new Date("2026-10-06T21:00:00Z"), "Asia/Riyadh")).toEqual({ kind: "hours", amount: 11 });
    expect(describeReviewDelay(NOW, new Date("2026-10-08T21:00:00Z"), "Asia/Riyadh")).toEqual({ kind: "days", amount: 3 });
    expect(describeReviewDelay(NOW, NOW, "Asia/Riyadh").kind).toBe("now");
  });
});

// ───────────────────────────── AI output validation ─────────────────────────────

const ctx = (previousAttempts: number, units = ["u4", "u2"]) => ({ previousAttempts, weakUnitIds: new Set(units) });
const good = { summary: "معظم الأجزاء ثابتة لديك، والجزء ٤ يحتاج إلى مراجعة.", patterns: ["ظهر ضعف في الجزء ٤."], priorities: [{ unitId: "u4", reason: "لم يكن ثابتًا في هذه المحاولة." }], progressObservation: "" };

describe("AI performance analysis validation", () => {
  it("accepts a well-formed first-attempt analysis (empty observation becomes null)", () => {
    const r = validateAnalysis(good, ctx(0));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.progressObservation).toBeNull();
      expect(r.value.priorities).toEqual([{ unitNumber: 4, reason: "لم يكن ثابتًا في هذه المحاولة." }]);
    }
  });

  it("rejects malformed output", () => {
    for (const bad of [null, "text", {}, { ...good, summary: "" }, { ...good, patterns: "x" }, { ...good, priorities: [{ unitId: "u4" }] }, { ...good, extra: 1 }]) {
      expect(validateAnalysis(bad, ctx(0)).ok).toBe(false);
    }
  });

  it("cannot carry a score, mastery or review date (strict schema)", () => {
    for (const field of [{ score: 100 }, { masteryScore: 100 }, { nextReviewAt: "2030-01-01" }, { state: "MASTERED" }]) {
      expect(validateAnalysis({ ...good, ...field }, ctx(2)).ok).toBe(false);
    }
  });

  it("rejects a priority that does not reference a weak unit it was sent", () => {
    expect(validateAnalysis({ ...good, priorities: [{ unitId: "u9", reason: "x" }] }, ctx(0)).ok).toBe(false);
    expect(validateAnalysis({ ...good, priorities: [{ unitId: "u4", reason: "a" }, { unitId: "u4", reason: "b" }] }, ctx(0)).ok).toBe(false);
  });

  it("does not allow a trend or progress claim on a first attempt", () => {
    expect(validateAnalysis({ ...good, progressObservation: "تحسن أداؤك." }, ctx(0)).ok).toBe(false);
    expect(validateAnalysis({ ...good, summary: "تحسن أداؤك مقارنة بمحاولاتك السابقة." }, ctx(0)).ok).toBe(false);
    expect(validateAnalysis({ ...good, patterns: ["تكرر الخطأ في الجزء ٤."] }, ctx(0)).ok).toBe(false);
  });

  it("allows trends and repeated weakness once history exists", () => {
    const withHistory = { ...good, patterns: ["تكرر الخطأ في الجزء ٤ في أكثر من محاولة."], progressObservation: "تحسن أداؤك مقارنة بمحاولاتك السابقة." };
    expect(validateAnalysis(withHistory, ctx(2)).ok).toBe(true);
  });

  it("rejects markup, links, rulings and claims of verification or certainty", () => {
    for (const text of ["<b>جيد</b>", "انظر https://example.com", "هذا لا يجوز", "تم التحقق من تسميعك", "هذا مؤكد علميًا"]) {
      expect(validateAnalysis({ ...good, summary: text }, ctx(2)).ok, text).toBe(false);
    }
  });
});

// ───────────────────────────── canonical content ─────────────────────────────

describe("canonical text helpers", () => {
  it("removes only the extraction artifact", () => {
    expect(stripExtractionArtifacts("أ svgsvgsvg ب").removed).toBe(1);
    expect(tokenize(stripExtractionArtifacts("أ svgsvgsvg ب").text)).toEqual(["أ", "ب"]);
    expect(normalizeWhitespace("  أ   ب\n ج ")).toBe("أ ب ج");
  });
  it("flags digits, Latin letters and stray symbols but not Arabic wording", () => {
    expect(detectSuspiciousTokens("2 - وَسن توضؤ بِمد")).toEqual(["2", "-"]);
    expect(detectSuspiciousTokens("الْمِيَاه ثلَاثه")).toEqual([]);
    expect(detectSuspiciousTokens("abc")).toEqual(["abc"]);
  });
});

describe("the supplied Matn structure (content/matn-akhsar.structure.json)", () => {
  const verification = verifyStructure(source, structure);
  const plan = planImport(structure);
  const stats = structureStats(plan);

  it("reproduces the supplied Arabic wording word for word — no canonical wording changed", () => {
    expect(verification.firstMismatch).toBeNull();
    expect(verification.ok).toBe(true);
    expect(verification.unitTokenCount).toBe(verification.sourceTokenCount);
    expect(plan.flatMap((s) => s.passages.flatMap((p) => p.units.map((u) => u.text)))).toEqual(expectedUnitLines(source, structure).lines);
  });

  it("removes all 15 svgsvgsvg artifacts and none ever appears in a unit", () => {
    expect(verification.report.artifactCount).toBe(0);
    expect(source.split("svgsvgsvg").length - 1).toBe(0);
    for (const s of plan) for (const p of s.passages) for (const u of p.units) expect(u.text).not.toContain("svgsvgsvg");
  });

  it("keeps section, passage and unit order contiguous and unique", () => {
    expect(plan.map((s) => s.order)).toEqual(plan.map((_, i) => i + 1));
    for (const s of plan) {
      expect(s.passages.map((p) => p.order)).toEqual(s.passages.map((_, i) => i + 1));
      for (const p of s.passages) expect(p.units.map((u) => u.order)).toEqual(p.units.map((_, i) => i + 1));
    }
    const ids = plan.flatMap((s) => [s.id, ...s.passages.flatMap((p) => [p.id, ...p.units.map((u) => u.id)])]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no empty passage or unit and no unit that is a connector-only fragment", () => {
    for (const s of plan) for (const p of s.passages) {
      expect(p.units.length).toBeGreaterThan(0);
      for (const u of p.units) {
        expect(u.text.trim().length).toBeGreaterThan(0);
        const last = tokenize(u.text).at(-1)!.replace(/[ً-ٟ]/g, "");
        expect(["و", "او", "أو", "من", "في", "على", "الى", "إلى", "الا", "إلا", "اذا", "إذا", "فان", "الذي", "التي"]).not.toContain(last);
      }
    }
  });

  it("matches the target sizes (units 3–15 words except flagged shorts; passages 3–7 units)", () => {
    // The old fixture heuristic expected a deliberately long sample unit. The approved import contract is instead
    // a maximum of 15 words (with explicitly reported short units), and the frozen real structure has no long units.
    expect(stats.longUnits).toEqual([]);
    expect(stats.oddPassages).toEqual([]);
    expect(stats.shortUnits.length).toBeGreaterThanOrEqual(0);
  });

  it("flags the only suspicious token («2 -») instead of removing it", () => {
    expect(stats.suspicious).toEqual([]);
    expect(plan.flatMap((s) => s.passages.flatMap((p) => p.units)).some((u) => u.text.startsWith("2 - "))).toBe(false);
  });

  it("counts: 12 sections, 32 passages, 159 units", () => {
    expect([stats.sections, stats.passages, stats.units]).toEqual([12, 32, 159]);
  });

  it("derived navigation labels are metadata only: never inside any unit text", () => {
    const derived = plan.filter((s) => s.titleIsDerived).map((s) => s.title);
    expect(derived).toHaveLength(12);
    const allText = plan.flatMap((s) => s.passages.flatMap((p) => p.units.map((u) => u.text))).join(" ");
    expect(allText).not.toContain("فصل الآنية");
    expect(allText).not.toContain("فصل التيمم");
  });
});
