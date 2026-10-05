import type { AIProvider } from "@/server/ai/provider";
import { AIProviderError } from "@/server/ai/provider";
import { OPTION_IDS, VALIDATOR_CHECKS, type GenerationRequest, type PerformanceAnalysisRequest, type ProviderResponse, type ReinforcementExerciseRequest, type ReinforcementPlanRequest, type ValidationRequest, type ValidatorCheck } from "@/server/ai/types";

type GenStep = unknown | ((req: GenerationRequest) => unknown) | AIProviderError;
type ValStep = unknown | ((req: ValidationRequest) => unknown) | AIProviderError;

/**
 * Test double for AIProvider. Each call consumes the next scripted step (or uses the
 * fallback). Records every request and prompt so tests can assert what the "model" saw.
 */
export class ScriptedProvider implements AIProvider {
  readonly name = "scripted";
  readonly isDevelopmentMock = false;
  readonly generatorModel = "scripted-generator";
  readonly validatorModel = "scripted-validator";

  readonly generateRequests: GenerationRequest[] = [];
  readonly generatePrompts: { system: string; user: string }[] = [];
  readonly validateRequests: ValidationRequest[] = [];
  readonly validatePrompts: { system: string; user: string }[] = [];

  constructor(
    private readonly genSteps: GenStep[] = [],
    private readonly valSteps: ValStep[] = [],
    private readonly fallback: { gen?: GenStep; val?: ValStep } = {},
  ) {}

  async generateQuestion(request: GenerationRequest, prompt: { system: string; user: string }): Promise<ProviderResponse> {
    this.generateRequests.push(request);
    this.generatePrompts.push(prompt);
    const step = this.genSteps.length ? this.genSteps.shift() : this.fallback.gen;
    return this.resolve(step, request);
  }

  async validateQuestion(request: ValidationRequest, prompt: { system: string; user: string }): Promise<ProviderResponse> {
    this.validateRequests.push(request);
    this.validatePrompts.push(prompt);
    const step = this.valSteps.length ? this.valSteps.shift() : this.fallback.val;
    return this.resolve(step, request);
  }

  readonly analysisRequests: PerformanceAnalysisRequest[] = [];
  readonly analysisPrompts: { system: string; user: string }[] = [];
  private analysisSteps: unknown[] = [];

  /** Scripts the next performance-analysis responses (data objects, functions, or AIProviderError). */
  scriptAnalysis(...steps: unknown[]): this {
    this.analysisSteps.push(...steps);
    return this;
  }

  async analyzePerformance(request: PerformanceAnalysisRequest, prompt: { system: string; user: string }): Promise<ProviderResponse> {
    this.analysisRequests.push(request);
    this.analysisPrompts.push(prompt);
    return this.resolve(this.analysisSteps.shift(), request);
  }

  readonly planRequests: ReinforcementPlanRequest[] = [];
  readonly planPrompts: { system: string; user: string }[] = [];
  private planSteps: unknown[] = [];

  /** Scripts the next reinforcement-plan responses (data objects, functions, or AIProviderError). */
  scriptPlan(...steps: unknown[]): this {
    this.planSteps.push(...steps);
    return this;
  }

  async planReinforcement(request: ReinforcementPlanRequest, prompt: { system: string; user: string }): Promise<ProviderResponse> {
    this.planRequests.push(request);
    this.planPrompts.push(prompt);
    return this.resolve(this.planSteps.shift(), request);
  }

  readonly decisionRequests: ReinforcementExerciseRequest[] = [];
  readonly decisionPrompts: { system: string; user: string }[] = [];
  private decisionSteps: unknown[] = [];

  /** Scripts the next coach decisions (data objects, functions of the request, or AIProviderError). */
  scriptDecision(...steps: unknown[]): this {
    this.decisionSteps.push(...steps);
    return this;
  }

  async decideReinforcementExercise(request: ReinforcementExerciseRequest, prompt: { system: string; user: string }): Promise<ProviderResponse> {
    this.decisionRequests.push(request);
    this.decisionPrompts.push(prompt);
    return this.resolve(this.decisionSteps.shift(), request);
  }

  private async resolve<R>(step: unknown, request: R): Promise<ProviderResponse> {
    if (step instanceof AIProviderError) throw step;
    if (step === undefined) throw new Error("ScriptedProvider: no scripted response left");
    const data = typeof step === "function" ? await (step as (r: R) => unknown)(request) : step;
    if (data && typeof data === "object" && "__response" in data) return (data as { __response: ProviderResponse }).__response;
    return { data, provider: this.name, model: "scripted-model", latencyMs: 1, stopReason: "end_turn" };
  }
}

/** A generator response in the structured-output shape (four options A–D, evidence under `grounding`). */
export function okQuestion(item: {
  question: string;
  options: string[];
  correctIndex?: number;
  explanation: string;
  answerEvidence: string;
  explanationEvidence?: string;
}) {
  return {
    status: "OK",
    insufficientReason: "",
    questionType: "MCQ",
    question: item.question,
    options: item.options.map((text, i) => ({ id: OPTION_IDS[i], text })),
    correctOptionId: OPTION_IDS[item.correctIndex ?? 0],
    explanation: item.explanation,
    grounding: { answerEvidence: item.answerEvidence, explanationEvidence: item.explanationEvidence ?? item.answerEvidence },
  };
}

export const INSUFFICIENT = {
  status: "INSUFFICIENT_SOURCE",
  insufficientReason: "Not enough text.",
  questionType: "MCQ",
  question: "",
  options: [],
  correctOptionId: "",
  explanation: "",
  grounding: { answerEvidence: "", explanationEvidence: "" },
};

/**
 * A validator response. `failed` lists the per-part checks that must be false. It is a function of the request so that the
 * claim quotes are, like a faithful reviewer's, verbatim copies of the candidate's own evidence excerpts.
 */
export function verdict(valid: boolean, supportedOptionIndices: number[], issues: string[] = [], failed: ValidatorCheck[] = [], claims?: unknown[]) {
  return (req: ValidationRequest) => ({
    claims: claims ?? [
      { subject: "correctAnswer", claim: req.candidate.correctAnswer, sourceQuote: req.candidate.answerEvidence, relation: "IDENTICAL" },
      { subject: "explanation", claim: req.candidate.explanation, sourceQuote: req.candidate.explanationEvidence, relation: "IDENTICAL" },
    ],
    valid,
    checks: Object.fromEntries(VALIDATOR_CHECKS.map((check) => [check, !failed.includes(check)])),
    issues,
    supportedOptionIds: supportedOptionIndices.map((i) => OPTION_IDS[i]),
    reasons: ["scripted verdict"],
  });
}
