import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { TrustedPassage } from "./types";

/**
 * Server-side retrieval of the ONLY text a generated question may be built from.
 *
 * The browser never sends source text, a passage id or a concept id for generation: the
 * server decides lessonId / conceptId / sourcePassageId and loads the approved passage itself.
 * Before any model is called, every one of these must hold:
 *
 *   1. the concept exists and belongs to the lesson of the session
 *   2. the passage exists and belongs to that same concept and lesson
 *   3. the passage is approved
 *   4. the text is not empty
 *   5. the text is still the text that was approved (hash stamped by a database trigger the moment the passage became approved)
 *
 * Anything else fails closed — the model is not called.
 */
export type SourceFailure = "NO_PASSAGE" | "NOT_APPROVED" | "EDITED_AFTER_APPROVAL" | "EMPTY_TEXT" | "CONCEPT_MISMATCH";

export type SourceResolution =
  | { ok: true; passage: TrustedPassage; textHash: string }
  | { ok: false; failure: SourceFailure; detail: string };

export function hashPassageText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function resolveApprovedSource(
  db: PrismaClient,
  input: { sessionId: string; lessonId: string; conceptId: string },
): Promise<SourceResolution> {
  const concept = await db.concept.findUnique({ where: { id: input.conceptId }, select: { id: true, lessonId: true } });
  if (!concept || concept.lessonId !== input.lessonId) {
    return { ok: false, failure: "CONCEPT_MISMATCH", detail: "The concept does not belong to this lesson." };
  }

  const passages = await db.sourcePassage.findMany({
    where: { conceptId: input.conceptId, lessonId: input.lessonId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      version: true,
      text: true,
      sourceTitle: true,
      sourceAuthor: true,
      sourceReference: true,
      approved: true,
      approvedTextHash: true,
    },
  });
  if (passages.length === 0) return { ok: false, failure: "NO_PASSAGE", detail: "No source passage is linked to this concept." };

  const failures: SourceFailure[] = [];
  const usable: Array<(typeof passages)[number]> = [];
  for (const passage of passages) {
    if (!passage.approved) failures.push("NOT_APPROVED");
    else if (!passage.text.trim()) failures.push("EMPTY_TEXT");
    else if (!passage.approvedTextHash || passage.approvedTextHash !== hashPassageText(passage.text)) failures.push("EDITED_AFTER_APPROVAL");
    else usable.push(passage);
  }
  if (usable.length === 0) {
    const failure = failures.includes("EDITED_AFTER_APPROVAL") ? "EDITED_AFTER_APPROVAL" : failures[0] ?? "NOT_APPROVED";
    return { ok: false, failure, detail: `No usable approved passage (${failure}).` };
  }

  // Least-used approved passage in this session first, so a concept with several passages is varied.
  const usage = await db.generatedQuestion.groupBy({
    by: ["sourcePassageId"],
    where: { sessionId: input.sessionId, conceptId: input.conceptId, validationStatus: "VALID" },
    _count: { _all: true },
  });
  const used = new Map(usage.map((u) => [u.sourcePassageId, u._count._all]));
  const chosen = [...usable].sort((a, b) => (used.get(a.id) ?? 0) - (used.get(b.id) ?? 0))[0];
  return {
    ok: true,
    textHash: chosen.approvedTextHash as string,
    passage: {
      id: chosen.id,
      version: chosen.version,
      text: chosen.text,
      sourceTitle: chosen.sourceTitle,
      sourceAuthor: chosen.sourceAuthor,
      sourceReference: chosen.sourceReference,
    },
  };
}

/** Re-checks right before a question is shown that the passage it was built from is still the approved one. */
export async function sourceStillApproved(db: PrismaClient, passage: Pick<TrustedPassage, "id" | "version">, textHash: string): Promise<boolean> {
  const current = await db.sourcePassage.findUnique({
    where: { id: passage.id },
    select: { approved: true, version: true, text: true, approvedTextHash: true },
  });
  return Boolean(
    current &&
      current.approved &&
      current.version === passage.version &&
      current.approvedTextHash === textHash &&
      hashPassageText(current.text) === textHash,
  );
}
