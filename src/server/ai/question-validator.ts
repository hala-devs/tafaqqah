import { containsNormalized, normalizeArabic } from "./arabic";
import { explainRejection, runDeterministicChecks, shiftWordsNotIn } from "./checks";
import { AIProviderError, type AIProvider } from "./provider";
import { buildValidatorUserPrompt, VALIDATOR_PROMPT_VERSION, VALIDATOR_SYSTEM_PROMPT } from "./prompts";
import { parseValidatorOutput } from "./schemas";
import type { CallMeta } from "./question-generator";
import {
  OPTION_IDS,
  VALIDATOR_CHECKS,
  type CandidateQuestion,
  type DeterministicIssueCode,
  type IssueCode,
  type ModelIssueCode,
  type ModelValidation,
  type TrustedPassage,
  type ValidatedClaim,
  type ValidatorCheck,
} from "./types";

export type ValidationInput = {
  passage: TrustedPassage;
  conceptTitle: string;
  candidate: CandidateQuestion;
  /** Every question already shown or banked for the concept. */
  previousQuestions: string[];
  /** The approved baseline questions of the concept. */
  baselineQuestions?: string[];
  /** The correct answer of each entry of `previousQuestions` (same index; "" when unknown). */
  previousAnswers?: string[];
};

/** Structured verdict stored with the question for admin arbitration. */
export type ValidatorResult = {
  verdict: "PASS" | "REJECT";
  deterministicIssues: DeterministicIssueCode[];
  modelChecks: Record<ValidatorCheck, boolean> | null;
  modelIssues: ModelIssueCode[];
  supportedOptionIds: string[] | null;
  reasons: string[];
  /** Claim-by-claim fidelity review as returned by the reviewer (admin trace). */
  claims?: ValidatedClaim[];
};

export type ValidationOutcome = {
  valid: boolean;
  issues: IssueCode[];
  deterministicIssues: DeterministicIssueCode[];
  modelIssues: ModelIssueCode[];
  supportedOptionIndices: number[] | null;
  result: ValidatorResult;
  /** null when the semantic review was skipped because deterministic checks already failed. */
  meta: CallMeta | null;
  raw: unknown;
  providerError?: AIProviderError;
};

const ISSUE_FOR_FAILED_CHECK: Record<ValidatorCheck, ModelIssueCode> = {
  question: "UNANSWERABLE_FROM_SOURCE",
  correctAnswer: "ANSWER_NOT_SUPPORTED",
  distractors: "UNSAFE_DISTRACTOR",
  explanation: "EXPLANATION_OUTSIDE_SOURCE",
  fidelity: "MEANING_SHIFT",
  evidence: "EVIDENCE_NOT_SUPPORTING",
  concept: "CONCEPT_DRIFT",
  novelty: "NOT_NOVEL",
  language: "POOR_LANGUAGE",
};

/**
 * Judges the reviewer model's structured verdict. Everything the model says is verified here: failed parts, reported issues,
 * the options it says are supported, and — claim by claim — that every quote exists verbatim in the source and that every
 * claim is IDENTICAL to it (including degree / negation words). Exported so the model's own rejections can be measured in isolation.
 */
export function evaluateModelReview(passage: TrustedPassage, candidate: CandidateQuestion, correctIndex: number, verdict: ModelValidation) {
  const issues = new Set<IssueCode>(verdict.issues);
  const failedChecks = VALIDATOR_CHECKS.filter((check) => !verdict.checks[check]);
  for (const check of failedChecks) issues.add(ISSUE_FOR_FAILED_CHECK[check]);
  const supported = Array.from(new Set(verdict.supportedOptionIndices));
  // Claim-by-claim fidelity, verified by the server: every quote must exist in the source and every claim must be IDENTICAL to it.
  const claimReasons: string[] = [];
  for (const subject of ["correctAnswer", "explanation"] as const) {
    if (!verdict.claims.some((c) => c.subject === subject)) {
      issues.add("VALIDATOR_INCONSISTENT");
      claimReasons.push(`No claims were reviewed for the ${subject}.`);
    }
  }
  for (const c of verdict.claims) {
    const quoted = normalizeArabic(c.sourceQuote).length >= 6 && containsNormalized(passage.text, c.sourceQuote);
    // A question asserts nothing by itself: it needs no quote, only to keep the meaning of what it presupposes.
    const needsQuote = c.subject !== "question";
    // The degree-word comparison uses the quote the reviewer chose AND the excerpt the candidate cites for that part.
    const evidence = c.subject === "correctAnswer" ? candidate.answerEvidence : c.subject === "explanation" ? candidate.explanationEvidence : passage.text;
    const reference = `${c.sourceQuote} ${evidence}`;
    if (c.relation === "UNSUPPORTED" || (needsQuote && !quoted)) {
      issues.add("UNSUPPORTED_CLAIM");
      claimReasons.push(`Claim not backed by a verbatim source quote: «${c.claim}»`);
    } else if (c.relation !== "IDENTICAL") {
      issues.add("MEANING_SHIFT");
      claimReasons.push(`Claim is ${c.relation} relative to its quote: «${c.claim}» vs «${c.sourceQuote}»`);
    } else if (shiftWordsNotIn(c.claim, reference).length > 0) {
      issues.add("MEANING_SHIFT");
      claimReasons.push(`Claim carries degree words absent from its quote (${shiftWordsNotIn(c.claim, reference).join("، ")}): «${c.claim}»`);
    }
  }
  if (supported.length > 1) issues.add("MULTIPLE_CORRECT_ANSWERS");
  if (!supported.includes(correctIndex)) issues.add("ANSWER_NOT_SUPPORTED");
  if (verdict.valid && (verdict.issues.length > 0 || failedChecks.length > 0)) issues.add("VALIDATOR_INCONSISTENT");
  if (!verdict.valid && issues.size === 0) issues.add("VALIDATOR_INCONSISTENT");
  return { issues, supported, claimReasons, verdict, failedChecks };
}

/**
 * QuestionValidator — two independent layers, BOTH must pass:
 *
 *  1. Deterministic checks (no model): structure, evidence found verbatim in the approved
 *     passage, grounding of answer/question/explanation, markers of knowledge the passage
 *     does not contain (other madhhabs, tarjih, evidence, conditions, exceptions, reasons,
 *     scholars, numbers), internal wording, option balance, novelty.
 *  2. A separate model call with its own reviewer prompt. It judges question, correct answer,
 *     distractors, explanation, evidence, concept, novelty and language independently, must
 *     identify exactly one supported option, and it must be the expected one.
 *
 * Conservative by construction: any failed check, issue, contradiction or malformed review rejects.
 */
export class QuestionValidator {
  constructor(private readonly provider: AIProvider) {}

  async validate(input: ValidationInput, options: { timeoutMs?: number } = {}): Promise<ValidationOutcome> {
    const correctIndex = input.candidate.options.findIndex((o) => o.trim() === input.candidate.correctAnswer.trim());
    const deterministicIssues = runDeterministicChecks(input.candidate, {
      passageText: input.passage.text,
      previousQuestions: input.previousQuestions,
      baselineQuestions: input.baselineQuestions,
      previousAnswers: input.previousAnswers,
    });
    const rejectedResult = (extra: Partial<ValidatorResult> = {}): ValidatorResult => ({
      verdict: "REJECT",
      deterministicIssues,
      modelChecks: null,
      modelIssues: [],
      supportedOptionIds: null,
      reasons: [],
      ...extra,
    });

    if (deterministicIssues.length > 0) {
      return {
        valid: false,
        issues: deterministicIssues,
        deterministicIssues,
        modelIssues: [],
        supportedOptionIndices: null,
        result: rejectedResult({ reasons: ["Rejected by deterministic server checks before the model review.", ...explainRejection(input.candidate, input.passage.text)] }),
        meta: null,
        raw: null,
      };
    }

    const baseMeta: CallMeta = {
      provider: this.provider.name,
      model: this.provider.validatorModel,
      promptVersion: VALIDATOR_PROMPT_VERSION,
      latencyMs: 0,
    };
    const request = {
      passage: input.passage,
      conceptTitle: input.conceptTitle,
      candidate: input.candidate,
      correctIndex,
      previousQuestions: input.previousQuestions,
    };

    let data: unknown;
    let meta: CallMeta;
    try {
      const response = await this.provider.validateQuestion(request, {
        system: VALIDATOR_SYSTEM_PROMPT,
        user: buildValidatorUserPrompt(request),
        timeoutMs: options.timeoutMs,
      });
      data = response.data;
      meta = { ...baseMeta, model: response.model, latencyMs: response.latencyMs, stopReason: response.stopReason, usage: response.usage };
    } catch (error) {
      const providerError =
        error instanceof AIProviderError ? error : new AIProviderError("UNAVAILABLE", "Validator call failed", { cause: error });
      return {
        valid: false,
        issues: [],
        deterministicIssues: [],
        modelIssues: [],
        supportedOptionIndices: null,
        result: rejectedResult({ reasons: ["Validator call failed."] }),
        meta: baseMeta,
        raw: null,
        providerError,
      };
    }

    const parsed = parseValidatorOutput(data);
    if (!parsed.ok) {
      return {
        valid: false,
        issues: ["VALIDATOR_INCONSISTENT"],
        deterministicIssues: ["VALIDATOR_INCONSISTENT"],
        modelIssues: [],
        supportedOptionIndices: null,
        result: rejectedResult({ deterministicIssues: ["VALIDATOR_INCONSISTENT"], reasons: [`Malformed validator output: ${parsed.error}`] }),
        meta,
        raw: data,
      };
    }

    const review = evaluateModelReview(input.passage, input.candidate, correctIndex, parsed.value);
    const { issues, supported, claimReasons, verdict } = review;

    const valid = issues.size === 0;
    return {
      valid,
      issues: [...issues],
      deterministicIssues: [],
      modelIssues: verdict.issues,
      supportedOptionIndices: supported,
      result: {
        verdict: valid ? "PASS" : "REJECT",
        deterministicIssues: [],
        modelChecks: verdict.checks,
        modelIssues: verdict.issues,
        supportedOptionIds: supported.map((i) => OPTION_IDS[i]),
        reasons: [...verdict.reasons, ...claimReasons],
        claims: verdict.claims,
      },
      meta,
      raw: data,
    };
  }
}
