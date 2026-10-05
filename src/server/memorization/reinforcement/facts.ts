import type { SelfAssessment } from "../config";

/**
 * Deterministic performance facts for ONE completed self-assessment («الكود يحدد ماذا حدث»).
 *
 *  - The learner's self-assessment is the only source of truth. A canonical token is CORRECT when the learner did not
 *    mark it INCORRECT (`wordIndexes`) or FORGOTTEN (`forgottenWordIndexes`) in a WORDS unit, or when the whole unit is CORRECT.
 *  - FULL_UNIT (and legacy rows without detail) is UNIT-level evidence. It is never expanded into per-word evidence:
 *    its tokens are counted separately and its position has `token: null`.
 *  - History is used only when a comparable previous assessment of the SAME unit exists (see `previous`). Without one,
 *    every position is NO_HISTORY and nothing can be called repeated, persistent, new or resolved.
 *
 * Pure: no database, no AI. Everything AI later sees is derived from this object.
 */

export const FACTS_VERSION = 1;

export type IssueKind = "INCORRECT" | "FORGOTTEN";
/** WORDS: per-word evidence. FULL_UNIT: the learner judged the whole unit. LEGACY_UNIT: a pre-detail row (unit-level). */
export type UnitEvidence = "CORRECT" | "WORDS" | "FULL_UNIT" | "LEGACY_UNIT";
export type PositionHistory = "NO_HISTORY" | "NEW" | "REPEATED" | "PERSISTENT";

export type UnitAssessment = {
  status: SelfAssessment;
  scope: "WORDS" | "FULL_UNIT" | null;
  /** INCORRECT word indexes (the persisted `wordIndexes`). */
  incorrect: number[];
  forgotten: number[];
};

export type UnitAssessmentInput = UnitAssessment & {
  unitId: string;
  tokenCount: number;
  /** A canonical, approved unit exists right before / after this one in the SAME book (context availability). */
  hasPreviousNeighbor: boolean;
  hasNextNeighbor: boolean;
  /** The learner's most recent earlier assessment of this exact unit, when comparable (same approved text). */
  previous: UnitAssessment | null;
};

export type UnitFact = {
  /** Pseudonymous, session-ordered reference used everywhere outside the database («u1» = first unit of the session). */
  ref: string;
  unitId: string;
  tokenCount: number;
  evidence: UnitEvidence;
  /** Kind of a unit-level issue (FULL_UNIT / LEGACY_UNIT); null otherwise. */
  unitIssue: IssueKind | null;
  incorrect: number[];
  forgotten: number[];
  hasPreviousNeighbor: boolean;
  hasNextNeighbor: boolean;
  previous: { evidence: UnitEvidence; unitIssue: IssueKind | null; incorrect: number[]; forgotten: number[] } | null;
};

export type AffectedPosition = { unitRef: string; token: number | null; kind: IssueKind; level: "WORD" | "UNIT"; history: PositionHistory };
export type ResolvedPosition = { unitRef: string; token: number | null; previousKind: IssueKind };

export type PerformancePattern = "NONE" | "FORGETTING_DOMINANT" | "INCORRECT_DOMINANT" | "BALANCED";

export type MemorizationPerformanceFacts = {
  version: typeof FACTS_VERSION;
  units: UnitFact[];
  totals: {
    assessedTokens: number;
    /** Tokens of CORRECT and WORDS units — the only tokens that have a per-word state. */
    wordLevelTokens: number;
    correctTokens: number;
    incorrectTokens: number;
    forgottenTokens: number;
    /** Ratios over `wordLevelTokens` (0 when there are none). Unit-level tokens are deliberately excluded. */
    ratios: { correct: number; incorrect: number; forgotten: number };
    unitLevelTokens: number;
  };
  unitSummary: {
    total: number;
    fullyCorrect: number;
    withIncorrect: number;
    withForgotten: number;
    /** WORDS units with both INCORRECT and FORGOTTEN words. */
    mixed: number;
    fullUnitIncorrect: number;
    fullUnitForgotten: number;
    legacyUnits: number;
  };
  affected: AffectedPosition[];
  resolved: ResolvedPosition[];
  adjacency: {
    /** Runs of ≥2 consecutive affected words inside one WORDS unit. */
    tokenRuns: { unitRef: string; from: number; to: number; kinds: IssueKind[] }[];
    /** Maximal runs (≥2) of consecutive affected units in canonical order. */
    unitGroups: string[][];
    /** Consecutive units whose issues touch across the boundary (end of one, start of the next, or unit-level). */
    boundaryPairs: [string, string][];
  };
  history: {
    comparableUnits: number;
    /** True when no unit of this session has a comparable earlier assessment: no repetition/change may be claimed. */
    firstComparableAttempt: boolean;
    repeated: number;
    persistent: number;
    newIssues: number;
    resolved: number;
  };
  pattern: PerformancePattern;
  hasIssues: boolean;
};

const sorted = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
export const unitRef = (index: number) => `u${index + 1}`;

function evidenceOf(a: UnitAssessment): { evidence: UnitEvidence; unitIssue: IssueKind | null } {
  if (a.status === "CORRECT") return { evidence: "CORRECT", unitIssue: null };
  if (a.scope === "WORDS") return { evidence: "WORDS", unitIssue: null };
  return { evidence: a.scope === "FULL_UNIT" ? "FULL_UNIT" : "LEGACY_UNIT", unitIssue: a.status };
}

export const isUnitLevelEvidence = (e: UnitEvidence) => e === "FULL_UNIT" || e === "LEGACY_UNIT";
const isUnitLevel = isUnitLevelEvidence;

function wordHistory(token: number, kind: IssueKind, previous: UnitFact["previous"]): PositionHistory {
  if (!previous) return "NO_HISTORY";
  if (previous.evidence === "CORRECT") return "NEW";
  // A previous unit-level judgement covered this word, but not as per-word evidence: affected both times, not "the same word".
  if (isUnitLevel(previous.evidence)) return "PERSISTENT";
  const same = kind === "INCORRECT" ? previous.incorrect : previous.forgotten;
  const other = kind === "INCORRECT" ? previous.forgotten : previous.incorrect;
  if (same.includes(token)) return "REPEATED";
  if (other.includes(token)) return "PERSISTENT";
  return "NEW";
}

function unitHistory(kind: IssueKind, previous: UnitFact["previous"]): PositionHistory {
  if (!previous) return "NO_HISTORY";
  if (previous.evidence === "CORRECT") return "NEW";
  if (isUnitLevel(previous.evidence) && previous.unitIssue === kind) return "REPEATED";
  return "PERSISTENT";
}

const ratio = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : 0);

/** Builds the facts from units given in canonical (session) order. */
export function buildMemorizationPerformanceFacts(inputs: UnitAssessmentInput[]): MemorizationPerformanceFacts {
  const units: UnitFact[] = inputs.map((input, index) => {
    const { evidence, unitIssue } = evidenceOf(input);
    const prev = input.previous ? { ...evidenceOf(input.previous), incorrect: input.previous.scope === "WORDS" ? sorted(input.previous.incorrect) : [], forgotten: input.previous.scope === "WORDS" ? sorted(input.previous.forgotten) : [] } : null;
    return {
      ref: unitRef(index),
      unitId: input.unitId,
      tokenCount: input.tokenCount,
      evidence,
      unitIssue,
      incorrect: evidence === "WORDS" ? sorted(input.incorrect) : [],
      forgotten: evidence === "WORDS" ? sorted(input.forgotten) : [],
      hasPreviousNeighbor: input.hasPreviousNeighbor,
      hasNextNeighbor: input.hasNextNeighbor,
      previous: prev,
    };
  });

  const affected: AffectedPosition[] = [];
  const resolved: ResolvedPosition[] = [];
  for (const u of units) {
    if (u.evidence === "WORDS") {
      for (const kind of ["INCORRECT", "FORGOTTEN"] as const) {
        for (const token of kind === "INCORRECT" ? u.incorrect : u.forgotten) affected.push({ unitRef: u.ref, token, kind, level: "WORD", history: wordHistory(token, kind, u.previous) });
      }
    } else if (u.unitIssue) {
      affected.push({ unitRef: u.ref, token: null, kind: u.unitIssue, level: "UNIT", history: unitHistory(u.unitIssue, u.previous) });
    }
    // Resolved: affected before, CORRECT now — only at the granularity both assessments share.
    const p = u.previous;
    if (p && p.evidence === "WORDS" && (u.evidence === "CORRECT" || u.evidence === "WORDS")) {
      const now = new Set([...u.incorrect, ...u.forgotten]);
      for (const token of p.incorrect) if (!now.has(token)) resolved.push({ unitRef: u.ref, token, previousKind: "INCORRECT" });
      for (const token of p.forgotten) if (!now.has(token)) resolved.push({ unitRef: u.ref, token, previousKind: "FORGOTTEN" });
    } else if (p && p.unitIssue && u.evidence === "CORRECT") {
      resolved.push({ unitRef: u.ref, token: null, previousKind: p.unitIssue });
    }
  }
  affected.sort((a, b) => units.findIndex((u) => u.ref === a.unitRef) - units.findIndex((u) => u.ref === b.unitRef) || (a.token ?? -1) - (b.token ?? -1));

  // Adjacency
  const tokenRuns: MemorizationPerformanceFacts["adjacency"]["tokenRuns"] = [];
  for (const u of units) {
    if (u.evidence !== "WORDS") continue;
    const all = sorted([...u.incorrect, ...u.forgotten]);
    let start = 0;
    for (let i = 1; i <= all.length; i++) {
      if (i < all.length && all[i] === all[i - 1]! + 1) continue;
      if (i - start >= 2) {
        const run = all.slice(start, i);
        const kinds = [...new Set(run.map((t): IssueKind => (u.forgotten.includes(t) ? "FORGOTTEN" : "INCORRECT")))];
        tokenRuns.push({ unitRef: u.ref, from: run[0]!, to: run.at(-1)!, kinds });
      }
      start = i;
    }
  }
  const isAffected = (u: UnitFact) => u.evidence !== "CORRECT";
  const unitGroups: string[][] = [];
  let current: string[] = [];
  for (const u of units) {
    if (isAffected(u)) current.push(u.ref);
    else {
      if (current.length >= 2) unitGroups.push(current);
      current = [];
    }
  }
  if (current.length >= 2) unitGroups.push(current);
  const boundaryPairs: [string, string][] = [];
  for (let i = 0; i + 1 < units.length; i++) {
    const a = units[i]!;
    const b = units[i + 1]!;
    const endsAffected = a.unitIssue !== null || (a.evidence === "WORDS" && [...a.incorrect, ...a.forgotten].includes(a.tokenCount - 1));
    const startsAffected = b.unitIssue !== null || (b.evidence === "WORDS" && [...b.incorrect, ...b.forgotten].includes(0));
    if (endsAffected && startsAffected) boundaryPairs.push([a.ref, b.ref]);
  }

  const wordUnits = units.filter((u) => u.evidence === "CORRECT" || u.evidence === "WORDS");
  const wordLevelTokens = wordUnits.reduce((n, u) => n + u.tokenCount, 0);
  const incorrectTokens = units.reduce((n, u) => n + u.incorrect.length, 0);
  const forgottenTokens = units.reduce((n, u) => n + u.forgotten.length, 0);
  const correctTokens = wordLevelTokens - incorrectTokens - forgottenTokens;
  const comparableUnits = units.filter((u) => u.previous !== null).length;

  const forgottenWeight = affected.filter((p) => p.kind === "FORGOTTEN").length;
  const incorrectWeight = affected.filter((p) => p.kind === "INCORRECT").length;
  const pattern: PerformancePattern = affected.length === 0 ? "NONE" : forgottenWeight > incorrectWeight ? "FORGETTING_DOMINANT" : incorrectWeight > forgottenWeight ? "INCORRECT_DOMINANT" : "BALANCED";

  return {
    version: FACTS_VERSION,
    units,
    totals: {
      assessedTokens: units.reduce((n, u) => n + u.tokenCount, 0),
      wordLevelTokens,
      correctTokens,
      incorrectTokens,
      forgottenTokens,
      ratios: { correct: ratio(correctTokens, wordLevelTokens), incorrect: ratio(incorrectTokens, wordLevelTokens), forgotten: ratio(forgottenTokens, wordLevelTokens) },
      unitLevelTokens: units.filter((u) => isUnitLevel(u.evidence)).reduce((n, u) => n + u.tokenCount, 0),
    },
    unitSummary: {
      total: units.length,
      fullyCorrect: units.filter((u) => u.evidence === "CORRECT").length,
      withIncorrect: units.filter((u) => u.incorrect.length > 0 || u.unitIssue === "INCORRECT").length,
      withForgotten: units.filter((u) => u.forgotten.length > 0 || u.unitIssue === "FORGOTTEN").length,
      mixed: units.filter((u) => u.incorrect.length > 0 && u.forgotten.length > 0).length,
      fullUnitIncorrect: units.filter((u) => u.evidence === "FULL_UNIT" && u.unitIssue === "INCORRECT").length,
      fullUnitForgotten: units.filter((u) => u.evidence === "FULL_UNIT" && u.unitIssue === "FORGOTTEN").length,
      legacyUnits: units.filter((u) => u.evidence === "LEGACY_UNIT").length,
    },
    affected,
    resolved,
    adjacency: { tokenRuns, unitGroups, boundaryPairs },
    history: {
      comparableUnits,
      firstComparableAttempt: comparableUnits === 0,
      repeated: affected.filter((p) => p.history === "REPEATED").length,
      persistent: affected.filter((p) => p.history === "PERSISTENT").length,
      newIssues: affected.filter((p) => p.history === "NEW").length,
      resolved: resolved.length,
    },
    pattern,
    hasIssues: affected.length > 0,
  };
}
