import { z } from "zod";
import { AppError } from "@/server/errors";

/**
 * Request bodies for the assessment API. All schemas are `.strict()`: the client can only
 * send identifiers, an option index and the "I reviewed this part" flag. Any attempt to send source text, a passage id,
 * a "correct answer", or other fields is rejected — the server resolves approved passages
 * itself from the database.
 */
export const nextQuestionBody = z.object({ reviewed: z.boolean().optional(), peek: z.boolean().optional() }).strict();

export const answerBody = z
  .object({
    questionId: z.string().min(1).max(64),
    selectedIndex: z.number().int().min(0).max(3),
  })
  .strict();

export const sessionIdParam = z.string().min(1).max(64);

export function parseWith<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AppError("BAD_REQUEST");
  return parsed.data;
}
