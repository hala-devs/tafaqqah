import { ApiError } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "@/server/ai/gemini-provider";
import { AIProviderError } from "@/server/ai/provider";
import { GENERATOR_JSON_SCHEMA, VALIDATOR_JSON_SCHEMA } from "@/server/ai/schemas";
import { failureKindForProviderError } from "@/server/ai/failures";
import type { GenerationRequest, TrustedPassage, ValidationRequest } from "@/server/ai/types";

const passage: TrustedPassage = { id: "p", version: 1, text: "نص معتمد كاف لبناء سؤال آمن ومتحقق منه من هذا المصدر وحده.", sourceTitle: "t", sourceAuthor: "a", sourceReference: "r" };
const generationRequest = { passage } as GenerationRequest;
const validationRequest = { passage } as ValidationRequest;
const prompt = { system: "System instructions", user: "Only the approved passage is in this prompt.", timeoutMs: 1234 };

describe("GeminiProvider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses gemini-3.5-flash-lite with structured JSON output and no external grounding tools", async () => {
    vi.stubEnv("GEMINI_MODEL", "");
    const generateContent = vi.fn().mockResolvedValue({
      text: JSON.stringify({ status: "INSUFFICIENT_SOURCE", insufficientReason: "Too short", question: "", options: [], correctOptionId: "", explanation: "", grounding: { answerEvidence: "", explanationEvidence: "" } }),
      modelVersion: "gemini-3.5-flash-lite",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 7 },
    });
    const provider = new GeminiProvider("not-a-real-key", { models: { generateContent } });

    const response = await provider.generateQuestion(generationRequest, prompt);

    expect(provider.generatorModel).toBe("gemini-3.5-flash-lite");
    expect(provider.validatorModel).toBe("gemini-3.5-flash-lite");
    expect(response.data).toMatchObject({ status: "INSUFFICIENT_SOURCE" });
    expect(response.model).toBe("gemini-3.5-flash-lite");
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.5-flash-lite",
        contents: prompt.user,
        config: expect.objectContaining({
          systemInstruction: prompt.system,
          responseMimeType: "application/json",
          responseJsonSchema: GENERATOR_JSON_SCHEMA,
        }),
      }),
    );
    // No Search / tools / grounding of any kind may be configured.
    const config = generateContent.mock.calls[0][0].config;
    for (const forbidden of ["tools", "toolConfig", "googleSearch", "googleSearchRetrieval", "retrievalConfig"]) {
      expect(config).not.toHaveProperty(forbidden);
    }
  });

  it("sends the validator schema for validation calls", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: "{}", candidates: [{ finishReason: "STOP" }] });
    await new GeminiProvider("not-a-real-key", { models: { generateContent } }).validateQuestion(validationRequest, prompt);
    expect(generateContent.mock.calls[0][0].config.responseJsonSchema).toBe(VALIDATOR_JSON_SCHEMA);
  });

  it("maps Gemini quota errors to a retryable rate-limit error", async () => {
    const provider = new GeminiProvider("not-a-real-key", { models: { generateContent: vi.fn().mockRejectedValue(new ApiError({ status: 429, message: "quota" })) } });
    const error = await provider.validateQuestion(validationRequest, prompt).catch((e: AIProviderError) => e);
    expect(error).toMatchObject({ code: "RATE_LIMITED" });
    expect(failureKindForProviderError(error as AIProviderError)).toBe("AI_RATE_LIMIT");
  });

  it("distinguishes timeouts and generic provider errors", async () => {
    const timeout = new GeminiProvider("k", { models: { generateContent: vi.fn().mockRejectedValue(Object.assign(new Error("The operation timed out"), { name: "TimeoutError" })) } });
    const timeoutError = await timeout.generateQuestion(generationRequest, prompt).catch((e: AIProviderError) => e);
    expect(timeoutError).toMatchObject({ code: "TIMEOUT" });
    expect(failureKindForProviderError(timeoutError as AIProviderError)).toBe("AI_TIMEOUT");

    const server = new GeminiProvider("k", { models: { generateContent: vi.fn().mockRejectedValue(new ApiError({ status: 503, message: "overloaded" })) } });
    const serverError = await server.generateQuestion(generationRequest, prompt).catch((e: AIProviderError) => e);
    expect(serverError).toMatchObject({ code: "UNAVAILABLE" });
    expect(failureKindForProviderError(serverError as AIProviderError)).toBe("AI_PROVIDER_ERROR");
  });

  it("treats a safety stop or an empty body as a provider failure, never as a question", async () => {
    const safety = new GeminiProvider("k", { models: { generateContent: vi.fn().mockResolvedValue({ text: "", candidates: [{ finishReason: "SAFETY" }] }) } });
    await expect(safety.generateQuestion(generationRequest, prompt)).rejects.toMatchObject({ code: "REFUSAL" });
    const empty = new GeminiProvider("k", { models: { generateContent: vi.fn().mockResolvedValue({ text: "", candidates: [{ finishReason: "STOP" }] }) } });
    await expect(empty.generateQuestion(generationRequest, prompt)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});
