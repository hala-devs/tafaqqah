import { scoreLevel, type MasteryLevel } from "@/lib/mastery-levels";
import type { CompletionReason } from "./completion";

/**
 * Session result, computed once when a session completes and frozen on the session row,
 * so the result page always shows the same numbers (and equals a recomputation).
 *
 * Each assessed concept is grouped by its learning state after its last answer:
 *   STRONG               → «أتقنت»            (GOOD or MASTERED)
 *   NEEDS_REINFORCEMENT  → «يحتاج إلى تثبيت»   (repeated evidence of misunderstanding)
 *   LEARNING             → «قيد التعلّم»        (e.g. a single mistake — never labelled weak)
 */
export type ConceptGroup = "STRONG" | "LEARNING" | "NEEDS_REINFORCEMENT";

export type ReportConcept = {
  conceptId: string;
  title: string;
  order: number;
  attempts: number;
  correct: number;
  masteryStart: number;
  masteryEnd: number;
  /** State before the first answer of this session, and after the last one. */
  levelStart: MasteryLevel;
  level: MasteryLevel;
  status: ConceptGroup;
};

export type ReportPurpose = "PRACTICE" | "PRE_TEST" | "POST_TEST" | "REASSESSMENT";

export type SessionReport = {
  version: 2;
  mode: "ADAPTIVE" | "FIXED";
  purpose: ReportPurpose;
  completionReason: CompletionReason;
  totalQuestions: number;
  correctCount: number;
  accuracy: number;
  overallMastery: number;
  overallLevel: MasteryLevel;
  concepts: ReportConcept[];
  strongConceptIds: string[];
  learningConceptIds: string[];
  reinforceConceptIds: string[];
  /** Concepts with at least one wrong answer in this session (used for pre/post measurement). */
  missedConceptIds: string[];
};

export type ReportAnswer = {
  conceptId: string;
  correct: boolean;
  masteryBefore: number;
  masteryAfter: number;
  stateBefore?: MasteryLevel;
  stateAfter: MasteryLevel;
  answeredAt: Date;
};

function groupOf(level: MasteryLevel): ConceptGroup {
  if (level === "GOOD" || level === "MASTERED") return "STRONG";
  if (level === "NEEDS_REINFORCEMENT") return "NEEDS_REINFORCEMENT";
  return "LEARNING";
}

export function buildReport(input: {
  mode: "ADAPTIVE" | "FIXED";
  purpose?: ReportPurpose;
  completionReason: CompletionReason;
  concepts: { id: string; title: string; order: number }[];
  answers: ReportAnswer[];
}): SessionReport {
  const answers = [...input.answers].sort((a, b) => a.answeredAt.getTime() - b.answeredAt.getTime());
  const concepts: ReportConcept[] = [];

  for (const concept of [...input.concepts].sort((a, b) => a.order - b.order)) {
    const own = answers.filter((a) => a.conceptId === concept.id);
    if (own.length === 0) continue;
    const last = own[own.length - 1];
    concepts.push({
      conceptId: concept.id,
      title: concept.title,
      order: concept.order,
      attempts: own.length,
      correct: own.filter((a) => a.correct).length,
      masteryStart: own[0].masteryBefore,
      masteryEnd: last.masteryAfter,
      levelStart: own[0].stateBefore ?? "LEARNING",
      level: last.stateAfter,
      status: groupOf(last.stateAfter),
    });
  }

  const correctCount = answers.filter((a) => a.correct).length;
  const overallMastery = concepts.length ? Math.round(concepts.reduce((sum, c) => sum + c.masteryEnd, 0) / concepts.length) : 0;
  const ids = (group: ConceptGroup) => concepts.filter((c) => c.status === group).map((c) => c.conceptId);

  return {
    version: 2,
    mode: input.mode,
    purpose: input.purpose ?? "PRACTICE",
    completionReason: input.completionReason,
    totalQuestions: answers.length,
    correctCount,
    accuracy: answers.length ? correctCount / answers.length : 0,
    overallMastery,
    overallLevel: scoreLevel(overallMastery),
    concepts,
    strongConceptIds: ids("STRONG"),
    learningConceptIds: ids("LEARNING"),
    reinforceConceptIds: ids("NEEDS_REINFORCEMENT"),
    missedConceptIds: concepts.filter((c) => c.correct < c.attempts).map((c) => c.conceptId),
  };
}

/** Reads a frozen report, upgrading the v1 shape stored before learning states existed. */
export function readReport(json: unknown): SessionReport | null {
  if (!json || typeof json !== "object") return null;
  const raw = json as Record<string, unknown>;
  if (raw.version === 2) return raw as unknown as SessionReport;
  const concepts = ((raw.concepts as ReportConcept[] | undefined) ?? []).map((c) => {
    const level = scoreLevel(c.masteryEnd);
    return { ...c, levelStart: scoreLevel(c.masteryStart), level, status: groupOf(level) };
  });
  const ids = (group: ConceptGroup) => concepts.filter((c) => c.status === group).map((c) => c.conceptId);
  return {
    version: 2,
    mode: (raw.mode as "ADAPTIVE" | "FIXED") ?? "ADAPTIVE",
    purpose: "PRACTICE",
    completionReason: (raw.completionReason as CompletionReason) ?? "EVIDENCE_SUFFICIENT",
    totalQuestions: Number(raw.totalQuestions ?? 0),
    correctCount: Number(raw.correctCount ?? 0),
    accuracy: Number(raw.accuracy ?? 0),
    overallMastery: Number(raw.overallMastery ?? 0),
    overallLevel: scoreLevel(Number(raw.overallMastery ?? 0)),
    concepts,
    strongConceptIds: ids("STRONG"),
    learningConceptIds: ids("LEARNING"),
    reinforceConceptIds: ids("NEEDS_REINFORCEMENT"),
    missedConceptIds: concepts.filter((c) => c.correct < c.attempts).map((c) => c.conceptId),
  };
}
