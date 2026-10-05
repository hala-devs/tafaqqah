"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db";
import { requireApiLearner } from "@/server/auth/current-user";
import { startAssessment, type StartOptions } from "@/server/assessment/engine";
import { isAppError } from "@/server/errors";
import { assessmentHref } from "@/lib/routes";

export type StartState = { error?: string };

/**
 * What to start:
 *   "DEFAULT"            the lesson assessment: approved base questions + runtime follow-ups after errors
 *   "FIXED"              the human-approved fixed bank
 *   "PRE_TEST"/"POST_TEST" measurement tests (fixed bank, mastery unchanged)
 *   "REASSESS:<conceptId>" focused reassessment after targeted review
 *   "REASSESS_FIXED:<conceptId>" the same, from the fixed bank (when AI is unavailable)
 */
export type StartKind = "DEFAULT" | "FIXED" | "PRE_TEST" | "POST_TEST" | `REASSESS:${string}` | `REASSESS_FIXED:${string}`;

function optionsFor(kind: StartKind): StartOptions {
  if (kind === "FIXED") return { mode: "FIXED" };
  if (kind === "PRE_TEST" || kind === "POST_TEST") return { purpose: kind };
  if (kind.startsWith("REASSESS:")) return { purpose: "REASSESSMENT", focusConceptIds: [kind.slice("REASSESS:".length)] };
  if (kind.startsWith("REASSESS_FIXED:")) {
    return { purpose: "REASSESSMENT", mode: "FIXED", focusConceptIds: [kind.slice("REASSESS_FIXED:".length)] };
  }
  return {};
}

/** Creates (or resumes) a session, then opens the focused assessment screen. */
export async function startAssessmentAction(lessonId: string, kind: StartKind, _prev: StartState): Promise<StartState> {
  let target: string;
  try {
    const user = await requireApiLearner();
    const started = await startAssessment({ db: prisma }, user.id, lessonId, optionsFor(kind));
    target = assessmentHref(lessonId, started.sessionId);
  } catch (error) {
    if (isAppError(error) && error.code === "AI_NOT_CONFIGURED") {
      const focus = kind.startsWith("REASSESS:") ? `&focus=${encodeURIComponent(kind.slice(9))}` : "";
      target = `/lessons/${lessonId}/assessment?notice=ai-unavailable${focus}`;
    } else if (isAppError(error)) {
      return { error: error.userMessage };
    } else {
      console.error("[assessment] start failed", error instanceof Error ? error.message : error);
      return { error: "تعذّر بدء الاختبار الآن. حاول مرة أخرى." };
    }
  }
  revalidatePath(`/lessons/${lessonId}`);
  redirect(target);
}
