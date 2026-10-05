import "server-only";
import { ApiError, GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { GENERATION_RULES } from "@/server/assessment/config";
import { AIProviderError, type AIProvider, type PromptInput } from "./provider";
import { ANALYSIS_JSON_SCHEMA, GENERATOR_JSON_SCHEMA, REINFORCEMENT_EXERCISE_JSON_SCHEMA, REINFORCEMENT_PLAN_JSON_SCHEMA, VALIDATOR_JSON_SCHEMA } from "./schemas";
import type { GenerationRequest, PerformanceAnalysisRequest, ProviderResponse, ReinforcementExerciseRequest, ReinforcementPlanRequest, ValidationRequest } from "./types";

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

type GeminiClient = { models: { generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse> } };

/** Gemini implementation. No tools are configured: only the server-built prompt's approved passage is available. */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  readonly isDevelopmentMock = false;
  readonly generatorModel: string;
  readonly validatorModel: string;
  private readonly client: GeminiClient;

  constructor(apiKey: string, client: GeminiClient = new GoogleGenAI({ apiKey, httpOptions: { timeout: GENERATION_RULES.callTimeoutMs } })) {
    this.client = client;
    // The model that is verified to work with structured output on this account. GEMINI_MODEL may override it.
    this.generatorModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    this.validatorModel = this.generatorModel;
  }

  generateQuestion(_request: GenerationRequest, prompt: PromptInput): Promise<ProviderResponse> {
    return this.call(this.generatorModel, prompt, GENERATOR_JSON_SCHEMA);
  }

  validateQuestion(_request: ValidationRequest, prompt: PromptInput): Promise<ProviderResponse> {
    return this.call(this.validatorModel, prompt, VALIDATOR_JSON_SCHEMA);
  }

  analyzePerformance(_request: PerformanceAnalysisRequest, prompt: PromptInput): Promise<ProviderResponse> {
    return this.call(this.generatorModel, prompt, ANALYSIS_JSON_SCHEMA);
  }

  planReinforcement(_request: ReinforcementPlanRequest, prompt: PromptInput): Promise<ProviderResponse> {
    return this.call(this.generatorModel, prompt, REINFORCEMENT_PLAN_JSON_SCHEMA);
  }

  decideReinforcementExercise(_request: ReinforcementExerciseRequest, prompt: PromptInput): Promise<ProviderResponse> {
    return this.call(this.generatorModel, prompt, REINFORCEMENT_EXERCISE_JSON_SCHEMA);
  }

  private async call(model: string, prompt: PromptInput, schema: Record<string, unknown>): Promise<ProviderResponse> {
    const started = Date.now();
    let response: GenerateContentResponse;
    try {
      response = await this.client.models.generateContent({
        model,
        contents: prompt.user,
        config: {
          systemInstruction: prompt.system,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
          httpOptions: { timeout: Math.min(prompt.timeoutMs ?? GENERATION_RULES.callTimeoutMs, GENERATION_RULES.callTimeoutMs) },
        },
      });
    } catch (error) {
      throw mapError(error);
    }

    const stopReason = response.candidates?.[0]?.finishReason;
    if (stopReason === "SAFETY" || stopReason === "RECITATION") throw new AIProviderError("REFUSAL", "Gemini declined the request");
    if (stopReason === "MAX_TOKENS") throw new AIProviderError("TRUNCATED", "Gemini output was truncated");

    const text = response.text;
    if (!text) throw new AIProviderError("BAD_RESPONSE", "Gemini returned no JSON response");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new AIProviderError("BAD_RESPONSE", "Gemini response was not valid JSON", { cause: error });
    }
    return {
      data,
      provider: this.name,
      model: response.modelVersion || model,
      latencyMs: Date.now() - started,
      stopReason: stopReason ?? null,
      usage: response.usageMetadata ? { ...response.usageMetadata } : undefined,
    };
  }
}

function mapError(error: unknown): AIProviderError {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return new AIProviderError("NOT_CONFIGURED", "Gemini rejected the credentials", { cause: error });
    if (error.status === 429) return new AIProviderError("RATE_LIMITED", "Gemini rate limit reached", { cause: error });
    if (error.status === 400 || error.status === 404) return new AIProviderError("BAD_REQUEST", "Gemini rejected the request", { cause: error });
    if (error.status === 408 || error.status === 504) return new AIProviderError("TIMEOUT", "Gemini request timed out", { cause: error });
    return new AIProviderError("UNAVAILABLE", `Gemini API error ${error.status}`, { cause: error });
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError" || /timed? ?out|deadline/i.test(error.message))) {
    return new AIProviderError("TIMEOUT", "Gemini request timed out", { cause: error });
  }
  return new AIProviderError("UNAVAILABLE", "Unexpected Gemini provider failure", { cause: error });
}
