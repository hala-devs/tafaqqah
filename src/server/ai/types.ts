/** Shared AI-layer types. Provider-agnostic. */

/** AI questions are always four-option multiple choice (A–D). */
export type QuestionKind = "MCQ";
export type Difficulty = 1 | 2 | 3;

/** Options of the human-authored True/False questions of the approved bank (AI questions are always A–D MCQ). */
export const TRUE_FALSE_OPTIONS = ["صحيح", "خطأ"] as const;

/** Stages at which a question is generated at runtime (the BASELINE is an approved database question). */
export type AdaptiveStage = "VERIFICATION" | "SECOND_VERIFICATION" | "REASSESSMENT";

export const OPTION_IDS = ["A", "B", "C", "D"] as const;
export type OptionId = (typeof OPTION_IDS)[number];

/** Per-part verdicts the independent validator must give on every candidate. */
export const VALIDATOR_CHECKS = [
  "question",
  "correctAnswer",
  "distractors",
  "explanation",
  "fidelity",
  "evidence",
  "concept",
  "novelty",
  "language",
] as const;
export type ValidatorCheck = (typeof VALIDATOR_CHECKS)[number];

/** Issues the semantic (LLM) validator may report. */
export const MODEL_ISSUE_CODES = [
  "UNANSWERABLE_FROM_SOURCE",
  "ANSWER_NOT_SUPPORTED",
  "MULTIPLE_CORRECT_ANSWERS",
  "UNSUPPORTED_CONDITION",
  "UNSUPPORTED_EXCEPTION",
  "UNSUPPORTED_CLAIM",
  "OTHER_MADHHAB",
  "AMBIGUOUS_QUESTION",
  "EXPLANATION_OUTSIDE_SOURCE",
  "UNSAFE_DISTRACTOR",
  "REQUIRES_OUTSIDE_KNOWLEDGE",
  "EVIDENCE_NOT_SUPPORTING",
  "CONCEPT_DRIFT",
  "NOT_NOVEL",
  "POOR_LANGUAGE",
  "MEANING_SHIFT",
] as const;

/** Issues detected by deterministic server-side checks (no model involved). */
export const DETERMINISTIC_ISSUE_CODES = [
  "SCHEMA_INVALID",
  "OPTION_COUNT_INVALID",
  "OPTION_IDS_INVALID",
  "CORRECT_ANSWER_NOT_IN_OPTIONS",
  "DUPLICATE_OPTIONS",
  "NEAR_DUPLICATE_OPTIONS",
  "BANNED_OPTION_PATTERN",
  "OPTION_HAS_LABEL",
  "OPTION_LENGTH_IMBALANCE",
  "CORRECT_ANSWER_LENGTH_GIVEAWAY",
  "ANSWER_EVIDENCE_NOT_VERBATIM",
  "EXPLANATION_EVIDENCE_NOT_VERBATIM",
  "EVIDENCE_TOO_BROAD",
  "ANSWER_EVIDENCE_NOT_RELEVANT",
  "EXPLANATION_EVIDENCE_NOT_RELEVANT",
  "ANSWER_REVEALED_IN_QUESTION",
  "MEANING_SHIFT_MARKER",
  "ANSWER_NOT_GROUNDED",
  "QUESTION_NOT_GROUNDED",
  "EXPLANATION_NOT_GROUNDED",
  "EXPLANATION_EMPTY",
  "OTHER_MADHHAB_MARKER",
  "TARJIH_MARKER",
  "OUTSIDE_EVIDENCE_MARKER",
  "UNSUPPORTED_CONDITION_MARKER",
  "UNSUPPORTED_EXCEPTION_MARKER",
  "UNSUPPORTED_REASON_MARKER",
  "SCHOLAR_NAME_NOT_IN_SOURCE",
  "NUMBER_NOT_IN_SOURCE",
  "INTERNAL_WORDING",
  "LANGUAGE_INVALID",
  "TEXT_TOO_LONG",
  "DUPLICATE_OF_PREVIOUS",
  "REPEATS_BASELINE",
  "VALIDATOR_INCONSISTENT",
] as const;

export type ModelIssueCode = (typeof MODEL_ISSUE_CODES)[number];
export type DeterministicIssueCode = (typeof DETERMINISTIC_ISSUE_CODES)[number];
export type IssueCode = ModelIssueCode | DeterministicIssueCode;

/** The approved passage, always resolved by the server from the database. */
export type TrustedPassage = {
  id: string;
  version: number;
  text: string;
  sourceTitle: string;
  sourceAuthor: string;
  sourceReference: string;
};

/** The question the learner has just answered. Context for choosing an angle — never a source of facts. */
export type PreviousQuestionContext = {
  stage: "BASELINE" | AdaptiveStage;
  question: string;
  options: string[];
  studentAnswer: string;
  correctAnswer: string;
};

export type GenerationRequest = {
  lessonId: string;
  conceptId: string;
  conceptTitle: string;
  passage: TrustedPassage;
  stage: AdaptiveStage;
  /** Always MCQ for runtime AI questions. */
  questionType: QuestionKind;
  targetDifficulty: Difficulty;
  previous: PreviousQuestionContext | null;
  /** Every question already shown or banked for this concept — the new one must differ from all of them. */
  previousQuestions: string[];
  /** The correct answers of those questions, so the new question can test a different statement of the source. */
  previousAnswers?: string[];
  /** Reviewer feedback from an earlier rejected draft for this same slot. */
  previousRejections: IssueCode[];
  /** The reviewer's short notes on the rejected draft (data, passed back so the retry can fix the problem). */
  rejectionNotes?: string[];
};

/** One option as the model returns it. */
export type CandidateOption = { id: OptionId; text: string };

/** Normalised generator result (the spec's structured output shape). */
export type CandidateQuestion = {
  status: "OK";
  questionType: QuestionKind;
  question: string;
  /** Option texts in A–D order. */
  options: string[];
  correctOptionId: OptionId;
  /** Text of the correct option (derived from correctOptionId). */
  correctAnswer: string;
  explanation: string;
  /** Internal only — never shown to learners. */
  answerEvidence: string;
  explanationEvidence: string;
};

export type GeneratorResult = CandidateQuestion | { status: "INSUFFICIENT_SOURCE"; reason: string };

export type ValidationRequest = {
  passage: TrustedPassage;
  conceptTitle: string;
  candidate: CandidateQuestion;
  correctIndex: number;
  previousQuestions: string[];
};

/** How one statement of the question/answer/explanation relates to the words of the source that back it. */
export const CLAIM_RELATIONS = ["IDENTICAL", "WIDER", "NARROWER", "DIFFERENT", "UNSUPPORTED"] as const;
export type ClaimRelation = (typeof CLAIM_RELATIONS)[number];

export const CLAIM_SUBJECTS = ["question", "correctAnswer", "explanation"] as const;
export type ClaimSubject = (typeof CLAIM_SUBJECTS)[number];

/** One atomic assertion, the verbatim source words that back it, and whether it says exactly the same thing. */
export type ValidatedClaim = { subject: ClaimSubject; claim: string; sourceQuote: string; relation: ClaimRelation };

export type ModelValidation = {
  /** Claim-by-claim fidelity review (verified server-side: quotes must exist verbatim, only IDENTICAL passes). */
  claims: ValidatedClaim[];
  valid: boolean;
  checks: Record<ValidatorCheck, boolean>;
  issues: ModelIssueCode[];
  supportedOptionIndices: number[];
  reasons: string[];
};

/** What a provider returns: raw JSON + call metadata. Parsing happens in the generator/validator. */
export type ProviderResponse = {
  data: unknown;
  provider: string;
  model: string;
  latencyMs: number;
  stopReason?: string | null;
  usage?: Record<string, unknown>;
};

/**
 * Memorization performance analysis. The payload is built by the application from stored self-assessment history only:
 * no audio, no canonical Matn text and no personal data ever reach the provider (see src/server/memorization/analysis.ts).
 */
export type PerformanceAnalysisRequest = { payload: Record<string, unknown> };

/**
 * Immediate memorization reinforcement planning. The payload is deterministic facts only (pseudonymous unit refs,
 * token positions, learner-chosen states, comparable history, neighbour availability, allowed enums):
 * no audio, no transcript, no canonical Matn text, no personal data (see src/server/memorization/reinforcement/).
 */
export type ReinforcementPlanRequest = { payload: Record<string, unknown> };

/**
 * One decision of the interactive reinforcement coach. The payload is session-local structured facts only (unit refs,
 * token indexes, learner self-reports, exercise history, previous intervention outcomes, allowed enums): no audio, no
 * transcript, no Matn text, no personal data (see src/server/memorization/reinforcement/coach.ts).
 */
export type ReinforcementExerciseRequest = { payload: Record<string, unknown> };
