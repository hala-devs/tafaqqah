import type { GenerationRequest, PerformanceAnalysisRequest, ProviderResponse, ReinforcementExerciseRequest, ReinforcementPlanRequest, ValidationRequest } from "./types";

/**
 * Provider abstraction. The rest of the app never talks to a vendor SDK directly.
 * Implementations receive fully-resolved, server-side inputs (the passage comes from
 * the database) and return raw JSON plus call metadata; parsing and safety checks are
 * done by QuestionGenerator / QuestionValidator, independent of the vendor.
 *
 * Learner feedback is deliberately NOT a separate model call: the explanation shown
 * after an answer is the one that already passed validation together with the question.
 */
export interface AIProvider {
  readonly name: string;
  /** True only for the development mock — surfaced in the UI and in logs. */
  readonly isDevelopmentMock: boolean;
  readonly generatorModel: string;
  readonly validatorModel: string;
  generateQuestion(request: GenerationRequest, prompt: PromptInput): Promise<ProviderResponse>;
  validateQuestion(request: ValidationRequest, prompt: PromptInput): Promise<ProviderResponse>;
  /** Memorization performance analysis: structured history in, structured observations out. Never audio. */
  analyzePerformance(request: PerformanceAnalysisRequest, prompt: PromptInput): Promise<ProviderResponse>;
  /** Memorization reinforcement planning: deterministic facts in, a bounded enum-only plan out. Never audio or Matn text. */
  planReinforcement(request: ReinforcementPlanRequest, prompt: PromptInput): Promise<ProviderResponse>;
  /** Reinforcement coach: session facts in, ONE bounded exercise decision out. Never audio or Matn text. */
  decideReinforcementExercise(request: ReinforcementExerciseRequest, prompt: PromptInput): Promise<ProviderResponse>;
}

/** System + user prompt, plus an optional per-call timeout derived from the question budget. */
export type PromptInput = { system: string; user: string; timeoutMs?: number };

export type AIProviderErrorCode = "NOT_CONFIGURED" | "UNAVAILABLE" | "TIMEOUT" | "RATE_LIMITED" | "REFUSAL" | "TRUNCATED" | "BAD_RESPONSE" | "BAD_REQUEST";

export class AIProviderError extends Error {
  readonly code: AIProviderErrorCode;
  constructor(code: AIProviderErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AIProviderError";
    this.code = code;
  }
}

export type AIStatus =
  | { configured: true; provider: string; isDevelopmentMock: boolean; generatorModel: string; validatorModel: string }
  | { configured: false; provider: string; reason: string };
