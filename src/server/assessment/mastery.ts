import { MASTERY_THRESHOLDS, type MasteryLevel } from "@/lib/mastery-levels";
import { MASTERY_RULES } from "./config";

/**
 * Explainable per-concept mastery. Pure functions — see tests/engine-logic.test.ts.
 *
 * 1) Score update
 *      correct   → score += gain[difficulty]                 (8 / 12 / 15)
 *      incorrect → score -= loss[difficulty]                  (14 / 12 / 10)
 *                  − repeatedErrorPenalty (6) if the previous answer on this concept was also wrong
 *      clamp to [0, 100]
 *
 * 2) Learning state (classifyState), evaluated in this order:
 *      NEEDS_REINFORCEMENT  if the concept was already NEEDS_REINFORCEMENT and the learner has
 *                           not yet answered 2 in a row correctly since (hysteresis), OR
 *                           ≥ 2 of the last 4 answers were wrong AND the latest one was wrong
 *      MASTERED             score ≥ 80 and the last 2 answers correct
 *      GOOD                 score ≥ 60 and the latest answer correct
 *      LEARNING             otherwise
 *
 *   A single mistake therefore lowers the score but can never produce «يحتاج إلى تثبيت».
 *
 * This is an educational progress indicator, not a validated psychometric model.
 */
export type MasteryRecord = {
  masteryScore: number;
  attempts: number;
  correctCount: number;
  incorrectCount: number;
  consecutiveCorrect: number;
  consecutiveIncorrect: number;
  lastDifficulty: number | null;
  recentOutcomes: boolean[];
  state: MasteryLevel;
};

export const RECENT_WINDOW = 4;
export const REINFORCEMENT_RULES = { minRecentErrors: 2, exitConsecutiveCorrect: 2 } as const;

export function initialMastery(): MasteryRecord {
  return {
    masteryScore: MASTERY_RULES.initial,
    attempts: 0,
    correctCount: 0,
    incorrectCount: 0,
    consecutiveCorrect: 0,
    consecutiveIncorrect: 0,
    lastDifficulty: null,
    recentOutcomes: [],
    state: "LEARNING",
  };
}

function asDifficulty(d: number): 1 | 2 | 3 {
  return d <= 1 ? 1 : d >= 3 ? 3 : 2;
}

export function classifyState(input: {
  score: number;
  recentOutcomes: boolean[];
  consecutiveCorrect: number;
  previousState: MasteryLevel;
}): MasteryLevel {
  const recent = input.recentOutcomes.slice(-RECENT_WINDOW);
  if (recent.length === 0) return "LEARNING";
  const last = recent[recent.length - 1];
  const recentErrors = recent.filter((o) => !o).length;

  if (input.previousState === "NEEDS_REINFORCEMENT" && input.consecutiveCorrect < REINFORCEMENT_RULES.exitConsecutiveCorrect) {
    return "NEEDS_REINFORCEMENT";
  }
  if (recentErrors >= REINFORCEMENT_RULES.minRecentErrors && !last) return "NEEDS_REINFORCEMENT";
  if (input.score >= MASTERY_THRESHOLDS.mastered && input.consecutiveCorrect >= 2) return "MASTERED";
  if (input.score >= MASTERY_THRESHOLDS.good && last) return "GOOD";
  return "LEARNING";
}

export function applyAnswer(state: MasteryRecord, answer: { correct: boolean; difficulty: number }): MasteryRecord {
  const difficulty = asDifficulty(answer.difficulty);
  let delta: number;
  if (answer.correct) {
    delta = MASTERY_RULES.gain[difficulty];
  } else {
    delta = -MASTERY_RULES.loss[difficulty];
    if (state.consecutiveIncorrect > 0) delta -= MASTERY_RULES.repeatedErrorPenalty;
  }
  const masteryScore = Math.max(MASTERY_RULES.min, Math.min(MASTERY_RULES.max, state.masteryScore + delta));
  const consecutiveCorrect = answer.correct ? state.consecutiveCorrect + 1 : 0;
  const recentOutcomes = [...state.recentOutcomes, answer.correct].slice(-RECENT_WINDOW);
  return {
    masteryScore,
    attempts: state.attempts + 1,
    correctCount: state.correctCount + (answer.correct ? 1 : 0),
    incorrectCount: state.incorrectCount + (answer.correct ? 0 : 1),
    consecutiveCorrect,
    consecutiveIncorrect: answer.correct ? 0 : state.consecutiveIncorrect + 1,
    lastDifficulty: difficulty,
    recentOutcomes,
    state: classifyState({ score: masteryScore, recentOutcomes, consecutiveCorrect, previousState: state.state }),
  };
}
