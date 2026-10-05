import { AppError } from "@/server/errors";
import type { AIProviderError } from "./provider";
import type { IssueCode } from "./types";

/**
 * Internal failure taxonomy for AI generation. Recorded in logs and admin views; the
 * learner only ever sees a calm Arabic message chosen from the matching AppError.
 */
export type AIFailureKind =
  | "AI_RATE_LIMIT"
  | "AI_TIMEOUT"
  | "AI_PROVIDER_ERROR"
  | "INSUFFICIENT_SOURCE"
  | "VALIDATOR_REJECTED"
  | "INVALID_EVIDENCE"
  | "SOURCE_NOT_APPROVED"
  | "SERVER_ERROR";

export function failureKindForProviderError(error: AIProviderError): AIFailureKind {
  if (error.code === "RATE_LIMITED") return "AI_RATE_LIMIT";
  if (error.code === "TIMEOUT") return "AI_TIMEOUT";
  return "AI_PROVIDER_ERROR";
}

const EVIDENCE_ISSUES: IssueCode[] = [
  "ANSWER_EVIDENCE_NOT_VERBATIM",
  "EXPLANATION_EVIDENCE_NOT_VERBATIM",
  "EVIDENCE_TOO_BROAD",
  "EVIDENCE_NOT_SUPPORTING",
];

/** What a run of rejected drafts should be called: evidence problems are reported separately. */
export function failureKindForRejections(issues: IssueCode[]): AIFailureKind {
  return issues.some((issue) => EVIDENCE_ISSUES.includes(issue)) ? "INVALID_EVIDENCE" : "VALIDATOR_REJECTED";
}

export function appErrorForProviderError(error: AIProviderError): AppError {
  switch (error.code) {
    case "NOT_CONFIGURED":
      return new AppError("AI_NOT_CONFIGURED", undefined, { cause: error });
    case "RATE_LIMITED":
      return new AppError("AI_RATE_LIMIT", undefined, { cause: error });
    case "TIMEOUT":
      return new AppError("AI_TIMEOUT", undefined, { cause: error });
    default:
      return new AppError("AI_UNAVAILABLE", undefined, { cause: error });
  }
}
