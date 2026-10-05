import { AppError } from "@/server/errors";
import { AnthropicProvider } from "./anthropic-provider";
import { DEFAULT_GEMINI_MODEL, GeminiProvider } from "./gemini-provider";
import { MockProvider } from "./mock-provider";
import type { AIProvider, AIStatus } from "./provider";

let cached: { key: string; provider: AIProvider } | null = null;

function configuredName(): string {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit) return explicit;
  return process.env.GEMINI_API_KEY ? "gemini" : process.env.ANTHROPIC_API_KEY ? "anthropic" : "";
}

/** Describes the AI configuration without exposing secrets (used by UI, admin and /api/health). */
export function resolveAIStatus(): AIStatus {
  const name = configuredName();
  if (!name) return { configured: false, provider: "none", reason: "AI_PROVIDER is not set." };
  if (name === "mock") {
    if (process.env.NODE_ENV === "production") {
      return { configured: false, provider: "mock", reason: "The development mock provider is disabled in production." };
    }
    const mock = new MockProvider();
    return { configured: true, provider: "mock", isDevelopmentMock: true, generatorModel: mock.generatorModel, validatorModel: mock.validatorModel };
  }
  if (name === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) return { configured: false, provider: "anthropic", reason: "ANTHROPIC_API_KEY is not set." };
    return {
      configured: true,
      provider: "anthropic",
      isDevelopmentMock: false,
      generatorModel: process.env.AI_GENERATOR_MODEL || "claude-opus-5-5",
      validatorModel: process.env.AI_VALIDATOR_MODEL || "claude-opus-5-5",
    };
  }
  if (name === "gemini") {
    if (!process.env.GEMINI_API_KEY) return { configured: false, provider: "gemini", reason: "GEMINI_API_KEY is not set." };
    const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    return { configured: true, provider: "gemini", isDevelopmentMock: false, generatorModel: model, validatorModel: model };
  }
  return { configured: false, provider: name, reason: `Unknown AI_PROVIDER "${name}".` };
}

/** Returns the configured provider or throws AI_NOT_CONFIGURED — never silently substitutes. */
export function getAIProvider(): AIProvider {
  const status = resolveAIStatus();
  if (!status.configured) {
    console.warn(`[ai] provider not configured: ${status.reason}`);
    throw new AppError("AI_NOT_CONFIGURED");
  }
  const key = `${status.provider}:${status.generatorModel}:${status.validatorModel}`;
  if (cached?.key === key) return cached.provider;
  const provider = status.provider === "mock"
    ? new MockProvider()
    : status.provider === "gemini"
      ? new GeminiProvider(process.env.GEMINI_API_KEY as string)
      : new AnthropicProvider(process.env.ANTHROPIC_API_KEY as string);
  cached = { key, provider };
  return provider;
}
