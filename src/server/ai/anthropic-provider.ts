import Anthropic from "@anthropic-ai/sdk";
import { GENERATION_RULES } from "@/server/assessment/config";
import { AIProviderError, type AIProvider, type PromptInput } from "./provider";
import { ANALYSIS_JSON_SCHEMA, GENERATOR_JSON_SCHEMA, REINFORCEMENT_EXERCISE_JSON_SCHEMA, REINFORCEMENT_PLAN_JSON_SCHEMA, VALIDATOR_JSON_SCHEMA } from "./schemas";
import type { GenerationRequest, PerformanceAnalysisRequest, ProviderResponse, ReinforcementExerciseRequest, ReinforcementPlanRequest, ValidationRequest } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

function effortFrom(value: string | undefined, fallback: Effort): Effort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max" ? value : fallback;
}

/**
 * Claude implementation of AIProvider.
 *  - structured outputs (output_config.format json_schema) for both calls
 *  - adaptive thinking is always on for Claude Opus 5.5; depth is set with `effort`
 *  - server-side refusal fallback (`fallbacks: "default"`) so a safety-classifier
 *    decline is retried on Anthropic's recommended model instead of failing outright
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly isDevelopmentMock = false;
  readonly generatorModel: string;
  readonly validatorModel: string;
  private readonly client: Anthropic;
  private readonly generatorEffort: Effort;
  private readonly validatorEffort: Effort;

  constructor(apiKey: string) {
    // Retries are handled by the question pipeline within its time budget.
    this.client = new Anthropic({ apiKey, maxRetries: 0, timeout: GENERATION_RULES.callTimeoutMs });
    this.generatorModel = process.env.AI_GENERATOR_MODEL || "claude-opus-5-5";
    this.validatorModel = process.env.AI_VALIDATOR_MODEL || "claude-opus-5-5";
    this.generatorEffort = effortFrom(process.env.AI_GENERATOR_EFFORT, "medium");
    this.validatorEffort = effortFrom(process.env.AI_VALIDATOR_EFFORT, "high");
  }

  generateQuestion(_request: GenerationRequest, prompt: PromptInput): Promise<ProviderResponse> {
    return this.call(this.generatorModel, this.generatorEffort, prompt, GENERATOR_JSON_SCHEMA);
  }

  validateQuestion(_request: ValidationRequest, prompt: PromptInput): Promise<ProviderResponse> {
    return this.call(this.validatorModel, this.validatorEffort, prompt, VALIDATOR_JSON_SCHEMA);
  }

  analyzePerformance(_request: PerformanceAnalysisRequest, prompt: PromptInput): Promise<ProviderResponse> {
    return this.call(this.generatorModel, "low", prompt, ANALYSIS_JSON_SCHEMA);
  }

  planReinforcement(_request: ReinforcementPlanRequest, prompt: PromptInput): Promise<ProviderResponse> {
    return this.call(this.generatorModel, "low", prompt, REINFORCEMENT_PLAN_JSON_SCHEMA);
  }

  decideReinforcementExercise(_request: ReinforcementExerciseRequest, prompt: PromptInput): Promise<ProviderResponse> {
    return this.call(this.generatorModel, "low", prompt, REINFORCEMENT_EXERCISE_JSON_SCHEMA);
  }

  private async call(
    model: string,
    effort: Effort,
    prompt: PromptInput,
    schema: Record<string, unknown>,
  ): Promise<ProviderResponse> {
    const started = Date.now();
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        output_config: { effort, format: { type: "json_schema", schema } },
      }, { timeout: Math.min(prompt.timeoutMs ?? GENERATION_RULES.callTimeoutMs, GENERATION_RULES.callTimeoutMs) });
    } catch (error) {
      throw mapError(error);
    }

    if (response.stop_reason === "refusal") throw new AIProviderError("REFUSAL", "Model declined the request");
    if (response.stop_reason === "max_tokens") throw new AIProviderError("TRUNCATED", "Model output was truncated");

    const text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new AIProviderError("BAD_RESPONSE", "Response was not valid JSON", { cause: error });
    }

    return {
      data,
      provider: this.name,
      model: response.model,
      latencyMs: Date.now() - started,
      stopReason: response.stop_reason,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }
}

function mapError(error: unknown): AIProviderError {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AIProviderError("NOT_CONFIGURED", "AI provider rejected the credentials", { cause: error });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AIProviderError("RATE_LIMITED", "AI provider rate limit reached", { cause: error });
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AIProviderError("BAD_REQUEST", "AI provider rejected the request", { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AIProviderError("TIMEOUT", "AI provider request timed out", { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AIProviderError("UNAVAILABLE", "Could not reach the AI provider", { cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    return new AIProviderError("UNAVAILABLE", `AI provider error ${error.status ?? ""}`.trim(), { cause: error });
  }
  return new AIProviderError("UNAVAILABLE", "Unexpected AI provider failure", { cause: error });
}
