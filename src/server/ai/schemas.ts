import { COACH_REASON_CODES, CONTEXT_LEVELS, CUE_LEVELS, EXERCISE_TYPES } from "@/server/memorization/reinforcement/coach";
import { CONTEXT_STRATEGIES, OBSERVATION_KEYS, PRIORITIES, REASON_CODES, REPEAT_POLICIES, STRATEGIES } from "@/server/memorization/reinforcement/plan";
import { z } from "zod";
import {
  CLAIM_RELATIONS,
  CLAIM_SUBJECTS,
  MODEL_ISSUE_CODES,
  OPTION_IDS,
  VALIDATOR_CHECKS,
  type CandidateQuestion,
  type GeneratorResult,
  type ModelValidation,
  type OptionId,
  type ValidatorCheck,
} from "./types";

/**
 * Structured-output contracts.
 *  - JSON Schemas are sent to the model (structured outputs).
 *  - Zod schemas re-validate every response on the server: model output is never trusted.
 */

export const GENERATOR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "insufficientReason", "questionType", "question", "options", "correctOptionId", "explanation", "grounding"],
  properties: {
    status: { type: "string", enum: ["OK", "INSUFFICIENT_SOURCE"] },
    insufficientReason: { type: "string" },
    questionType: { type: "string", enum: ["MCQ"] },
    question: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text"],
        properties: { id: { type: "string", enum: [...OPTION_IDS] }, text: { type: "string" } },
      },
    },
    correctOptionId: { type: "string", enum: ["A", "B", "C", "D", ""] },
    explanation: { type: "string" },
    grounding: {
      type: "object",
      additionalProperties: false,
      required: ["answerEvidence", "explanationEvidence"],
      properties: { answerEvidence: { type: "string" }, explanationEvidence: { type: "string" } },
    },
  },
} as const;

const optionSchema = z.object({ id: z.enum(OPTION_IDS), text: z.string().trim().min(1).max(400) }).strict();

const generatorEnvelope = z
  .object({
    status: z.enum(["OK", "INSUFFICIENT_SOURCE"]),
    insufficientReason: z.string().max(1000).nullish(),
    questionType: z.literal("MCQ").optional(),
    question: z.string().max(1000).optional(),
    options: z.array(z.object({ id: z.string().max(4), text: z.string().max(1000) })).max(8).optional(),
    correctOptionId: z.string().max(4).optional(),
    explanation: z.string().max(2000).nullish(),
    grounding: z.object({ answerEvidence: z.string().max(3000).nullish(), explanationEvidence: z.string().max(3000).nullish() }).strict().optional(),
  })
  .strict();

export function parseGeneratorOutput(data: unknown): { ok: true; value: GeneratorResult } | { ok: false; error: string } {
  const parsed = generatorEnvelope.safeParse(data);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const value = parsed.data;
  if (value.status === "INSUFFICIENT_SOURCE") {
    return { ok: true, value: { status: "INSUFFICIENT_SOURCE", reason: value.insufficientReason ?? "" } };
  }

  const options = z.array(optionSchema).length(4).safeParse(value.options);
  if (!options.success) return { ok: false, error: "options: exactly four options with ids A–D are required" };
  const ids = options.data.map((o) => o.id);
  if (ids.join("") !== OPTION_IDS.join("")) return { ok: false, error: "options: ids must be A, B, C, D in order" };
  const correct = z.enum(OPTION_IDS).safeParse(value.correctOptionId);
  if (!correct.success) return { ok: false, error: "correctOptionId: must be one of A–D" };
  const question = (value.question ?? "").trim();
  if (question.length < 5) return { ok: false, error: "question: missing" };

  const candidate: CandidateQuestion = {
    status: "OK",
    questionType: "MCQ",
    question,
    options: options.data.map((o) => o.text),
    correctOptionId: correct.data as OptionId,
    correctAnswer: options.data[OPTION_IDS.indexOf(correct.data as OptionId)].text,
    explanation: (value.explanation ?? "").trim(),
    answerEvidence: (value.grounding?.answerEvidence ?? "").trim(),
    explanationEvidence: (value.grounding?.explanationEvidence ?? "").trim(),
  };
  return { ok: true, value: candidate };
}

const checkProps = Object.fromEntries(VALIDATOR_CHECKS.map((check) => [check, { type: "boolean" }]));

export const VALIDATOR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["claims", "checks", "issues", "supportedOptionIds", "reasons", "valid"],
  properties: {
    // First on purpose: the reviewer must decompose and quote BEFORE it gives a verdict.
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["subject", "claim", "sourceQuote", "relation"],
        properties: {
          subject: { type: "string", enum: [...CLAIM_SUBJECTS] },
          claim: { type: "string" },
          sourceQuote: { type: "string" },
          relation: { type: "string", enum: [...CLAIM_RELATIONS] },
        },
      },
    },
    checks: { type: "object", additionalProperties: false, required: [...VALIDATOR_CHECKS], properties: checkProps },
    issues: { type: "array", items: { type: "string", enum: [...MODEL_ISSUE_CODES] } },
    supportedOptionIds: { type: "array", items: { type: "string", enum: [...OPTION_IDS] } },
    reasons: { type: "array", items: { type: "string" } },
    valid: { type: "boolean" },
  },
} as const;

const validatorSchema = z
  .object({
    claims: z
      .array(z.object({ subject: z.enum(CLAIM_SUBJECTS), claim: z.string().max(600), sourceQuote: z.string().max(1500), relation: z.enum(CLAIM_RELATIONS) }).strict())
      .max(24),
    valid: z.boolean(),
    checks: z.object(Object.fromEntries(VALIDATOR_CHECKS.map((check) => [check, z.boolean()])) as Record<ValidatorCheck, z.ZodBoolean>).strict(),
    issues: z.array(z.enum(MODEL_ISSUE_CODES)).max(20),
    supportedOptionIds: z.array(z.enum(OPTION_IDS)).max(4),
    reasons: z.array(z.string().max(600)).max(12),
  })
  .strict();

export function parseValidatorOutput(data: unknown): { ok: true; value: ModelValidation } | { ok: false; error: string } {
  const parsed = validatorSchema.safeParse(data);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const { valid, checks, issues, supportedOptionIds, reasons, claims } = parsed.data;
  return {
    ok: true,
    value: { claims, valid, checks, issues, supportedOptionIndices: supportedOptionIds.map((id) => OPTION_IDS.indexOf(id)), reasons },
  };
}

/** Contract of the memorization performance analysis (history observations only — no scores, no dates, no rulings). */
export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "patterns", "priorities", "progressObservation"],
  properties: {
    summary: { type: "string" },
    patterns: { type: "array", items: { type: "string" } },
    priorities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["unitId", "reason"],
        properties: { unitId: { type: "string" }, reason: { type: "string" } },
      },
    },
    // An empty string means "no observation"; the server converts it to null.
    progressObservation: { type: "string" },
  },
} as const;

/**
 * Contract of the memorization reinforcement planner: enums, unit refs and token indexes only — no free text, so no
 * Matn, ruling or explanation can be returned. Allowed values are re-checked by validatePlan() against the facts.
 */
export const REINFORCEMENT_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["observationKey", "targets"],
  properties: {
    observationKey: { type: "string", enum: [...OBSERVATION_KEYS] },
    targets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["unitRefs", "tokens", "priority", "contextStrategy", "strategy", "repeatPolicy", "reasonCode"],
        properties: {
          unitRefs: { type: "array", items: { type: "string" } },
          tokens: {
            type: "array",
            items: { type: "object", additionalProperties: false, required: ["unitRef", "index"], properties: { unitRef: { type: "string" }, index: { type: "integer" } } },
          },
          priority: { type: "string", enum: [...PRIORITIES] },
          contextStrategy: { type: "string", enum: [...CONTEXT_STRATEGIES] },
          strategy: { type: "string", enum: [...STRATEGIES] },
          repeatPolicy: { type: "string", enum: [...REPEAT_POLICIES] },
          reasonCode: { type: "string", enum: [...REASON_CODES] },
        },
      },
    },
  },
} as const;

/**
 * Contract of ONE reinforcement-coach decision: enums, unit refs and token indexes only — no free-text field at all, so
 * no Matn, ruling, explanation or diagnosis can be returned. validateCoachDecision() re-checks everything.
 */
export const REINFORCEMENT_EXERCISE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "exerciseType", "unitRefs", "hiddenTokens", "contextLevel", "cueLevel", "reasonCode"],
  properties: {
    action: { type: "string", enum: ["EXERCISE", "FINISH"] },
    exerciseType: { type: "string", enum: [...EXERCISE_TYPES] },
    unitRefs: { type: "array", items: { type: "string" } },
    hiddenTokens: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["unitRef", "index"], properties: { unitRef: { type: "string" }, index: { type: "integer" } } },
    },
    contextLevel: { type: "string", enum: [...CONTEXT_LEVELS] },
    cueLevel: { type: "string", enum: [...CUE_LEVELS] },
    reasonCode: { type: "string", enum: [...COACH_REASON_CODES] },
  },
} as const;
