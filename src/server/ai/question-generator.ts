import { AIProviderError, type AIProvider } from "./provider";
import { buildGeneratorUserPrompt, GENERATOR_PROMPT_VERSION, GENERATOR_SYSTEM_PROMPT } from "./prompts";
import { parseGeneratorOutput } from "./schemas";
import type { CandidateQuestion, GenerationRequest, ProviderResponse } from "./types";

export type CallMeta = {
  provider: string;
  model: string;
  promptVersion: string;
  latencyMs: number;
  stopReason?: string | null;
  usage?: Record<string, unknown>;
};

export type GenerationOutcome =
  | { kind: "OK"; candidate: CandidateQuestion; meta: CallMeta; raw: unknown }
  | { kind: "INSUFFICIENT_SOURCE"; reason: string; meta: CallMeta; raw: unknown }
  | { kind: "MALFORMED"; error: string; meta: CallMeta; raw: unknown }
  | { kind: "PROVIDER_ERROR"; error: AIProviderError; meta: CallMeta };

const MIN_PASSAGE_CHARS = 40;

/**
 * QuestionGenerator — turns ONE approved, server-resolved passage into a candidate question.
 * It never sees client input, and its output is untrusted until QuestionValidator approves it.
 */
export class QuestionGenerator {
  constructor(private readonly provider: AIProvider) {}

  async generate(request: GenerationRequest, options: { timeoutMs?: number } = {}): Promise<GenerationOutcome> {
    const baseMeta: CallMeta = {
      provider: this.provider.name,
      model: this.provider.generatorModel,
      promptVersion: GENERATOR_PROMPT_VERSION,
      latencyMs: 0,
    };

    // Too little text can never support a trustworthy question — don't even ask the model.
    if (request.passage.text.trim().length < MIN_PASSAGE_CHARS) {
      return { kind: "INSUFFICIENT_SOURCE", reason: "Passage below minimum length.", meta: baseMeta, raw: null };
    }

    let response: ProviderResponse;
    try {
      response = await this.provider.generateQuestion(request, {
        system: GENERATOR_SYSTEM_PROMPT,
        user: buildGeneratorUserPrompt(request),
        timeoutMs: options.timeoutMs,
      });
    } catch (error) {
      const err = error instanceof AIProviderError ? error : new AIProviderError("UNAVAILABLE", "Generator call failed", { cause: error });
      return { kind: "PROVIDER_ERROR", error: err, meta: baseMeta };
    }

    const meta: CallMeta = {
      ...baseMeta,
      model: response.model,
      latencyMs: response.latencyMs,
      stopReason: response.stopReason,
      usage: response.usage,
    };
    const parsed = parseGeneratorOutput(response.data);
    if (!parsed.ok) return { kind: "MALFORMED", error: parsed.error, meta, raw: response.data };
    if (parsed.value.status === "INSUFFICIENT_SOURCE") {
      return { kind: "INSUFFICIENT_SOURCE", reason: parsed.value.reason, meta, raw: response.data };
    }
    return { kind: "OK", candidate: parsed.value, meta, raw: response.data };
  }
}
