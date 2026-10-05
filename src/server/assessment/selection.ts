import { DIFFICULTY_BANDS } from "./config";
import { hasSufficientEvidence } from "./completion";

/**
 * Adaptive next-question selection. Pure and deterministic.
 *
 * Priority score per eligible concept (highest wins, ties → lesson order):
 *   (100 − mastery)                          weaker concepts first
 *   + 60  if not yet asked this session      coverage before depth
 *   + 25  if the last answer on it was wrong reinforce right after an error
 *   + 15  if it is already flagged «يحتاج إلى تثبيت» from earlier sessions
 *   − 15 × questions already asked on it this session
 *   − 40  if it was the previous question's concept (when alternatives exist)
 *   − 30  if the session already holds sufficient evidence for it
 */
export type ConceptCandidate = {
  id: string;
  order: number;
  mastery: number;
  sessionAttempts: number;
  sessionCorrect: number;
  lastSessionResult: boolean | null;
  /** Wrong answers in a row on this concept within the current session. */
  sessionConsecutiveErrors?: number;
  needsReinforcement?: boolean;
};

export type SelectionReason = "UNASSESSED" | "REINFORCE_AFTER_ERROR" | "REPEATED_ERROR" | "VERIFY_MASTERY" | "WEAKEST";

export type Selection = { conceptId: string; reason: SelectionReason; score: number };

export function scoreCandidate(c: ConceptCandidate, lastConceptId: string | null, alternatives: number): number {
  let score = 100 - c.mastery;
  if (c.sessionAttempts === 0) score += 60;
  if (c.lastSessionResult === false) score += 25;
  if (c.needsReinforcement) score += 15;
  score -= 15 * c.sessionAttempts;
  if (c.id === lastConceptId && alternatives > 1) score -= 40;
  if (hasSufficientEvidence(c)) score -= 30;
  return score;
}

export function selectNextConcept(candidates: ConceptCandidate[], lastConceptId: string | null): Selection | null {
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((c) => ({ c, score: scoreCandidate(c, lastConceptId, candidates.length) }))
    .sort((a, b) => b.score - a.score || a.c.order - b.c.order);
  const best = ranked[0].c;
  let reason: SelectionReason;
  if (best.sessionAttempts === 0) reason = "UNASSESSED";
  else if (best.lastSessionResult === false && (best.sessionConsecutiveErrors ?? 1) >= 2) reason = "REPEATED_ERROR";
  else if (best.lastSessionResult === false) reason = "REINFORCE_AFTER_ERROR";
  else if (best.mastery >= DIFFICULTY_BANDS.appliedFrom) reason = "VERIFY_MASTERY";
  else reason = "WEAKEST";
  return { conceptId: best.id, reason, score: ranked[0].score };
}

export function difficultyForMastery(mastery: number): 1 | 2 | 3 {
  if (mastery < DIFFICULTY_BANDS.intermediateFrom) return 1;
  if (mastery < DIFFICULTY_BANDS.appliedFrom) return 2;
  return 3;
}

/** Foundational questions alternate True/False and MCQ; higher levels use MCQ. */
export function questionTypeFor(difficulty: 1 | 2 | 3, previousType: "MCQ" | "TRUE_FALSE" | null): "MCQ" | "TRUE_FALSE" {
  if (difficulty === 1) return previousType === "TRUE_FALSE" ? "MCQ" : "TRUE_FALSE";
  return "MCQ";
}

/** Subtle, human copy that signals adaptation without exposing the algorithm. */
export function adaptiveNote(reason: SelectionReason, difficulty: 1 | 2 | 3, sequence: number): string | null {
  if (sequence <= 1) return null;
  switch (reason) {
    case "REPEATED_ERROR":
      return "سنعيد هذا المفهوم بصياغة مختلفة.";
    case "REINFORCE_AFTER_ERROR":
      return "سنركّز قليلًا على هذا المفهوم.";
    case "VERIFY_MASTERY":
      return "أظهرت إجاباتك إتقانًا جيدًا لهذا الجزء؛ لنتحقق منه بسؤال تطبيقي.";
    case "WEAKEST":
      return difficulty === 1 ? "نعود إلى أساس هذا الجزء لتثبيته." : "نعود إلى جزء يحتاج إلى تثبيت.";
    case "UNASSESSED":
      return "ننتقل إلى جزء جديد من الدرس.";
  }
}
