import type { PrismaClient } from "@/generated/prisma/client";
import type { AssessmentMode, AssessmentPurpose, QuestionStage } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { getAIProvider } from "@/server/ai/factory";
import { produceValidatedQuestion, type PipelineResult } from "@/server/ai/pipeline";
import type { AIProvider } from "@/server/ai/provider";
import type { AdaptiveStage } from "@/server/ai/types";
import { assertLessonAccessible } from "@/server/content/study";
import { AppError, isAppError } from "@/server/errors";
import { finishGenerationRequest, startGenerationRequest } from "@/server/ai/log";
import { MASTERY_LEVEL_META, type MasteryLevel } from "@/lib/mastery-levels";
import { approvedVideo, type ApprovedVideo } from "@/lib/video";
import {
  decideAdaptiveCompletion,
  decideFixedCompletion,
  decideReassessmentCompletion,
  type CompletionDecision,
  type CompletionReason,
} from "./completion";
import { COMPLETION_RULES, DIFFICULTY_LABEL, GENERATION_RULES, MASTERY_RULES, REASSESSMENT_RULES } from "./config";
import { nextFollowUp, wrongAnswerFeedback, type FollowUp } from "./followup";
import { applyAnswer, initialMastery, type MasteryRecord } from "./mastery";
import { recordLearningDay } from "@/server/learner/activity";
import { recordMeasurement } from "./measurement";
import { buildReport, readReport, type SessionReport } from "./report";
import { adaptiveNote, selectNextConcept, type ConceptCandidate } from "./selection";

export type EngineDeps = { db: PrismaClient; getProvider?: () => AIProvider };

export type PublicQuestion = {
  id: string;
  sequence: number;
  /** The baseline position the learner is at (follow-up questions keep the position of the baseline they follow). */
  position: number;
  stage: QuestionStage;
  type: "MCQ" | "TRUE_FALSE";
  text: string;
  options: string[];
  conceptId: string;
  conceptTitle: string;
  difficulty: number;
  difficultyLabel: string;
  adaptiveNote: string | null;
  origin: "AI_GENERATED" | "FIXED_BANK";
  isDevelopmentMock: boolean;
};

export type SessionProgress = { answered: number; min: number; max: number; fixedTotal: number | null };

/** The review step shown after repeated errors on one concept: only the human-approved video segment. */
export type ReviewStep = { conceptId: string; conceptTitle: string; description: string; video: ApprovedVideo | null };

export type NextResult =
  | { kind: "question"; question: PublicQuestion; progress: SessionProgress }
  | { kind: "review"; review: ReviewStep; progress: SessionProgress }
  | { kind: "completed" }
  | { kind: "pending" }
  /** Peek only: nothing is waiting and nothing is being prepared — the caller may start a real request. */
  | { kind: "none" };

export type NextOptions = {
  /** The learner pressed «اختبر فهمي مرة أخرى» after the review step. */
  reviewed?: boolean;
  /**
   * Read-only reconciliation: returns the already-persisted unanswered question, «pending» while another request holds
   * the generation lock, or «none». Never generates, never serves a new bank question, never changes the session.
   */
  peek?: boolean;
};

export type AnswerResult = {
  questionId: string;
  stage: QuestionStage;
  correct: boolean;
  selectedIndex: number;
  correctIndex: number;
  correctAnswer: string;
  explanation: string;
  sourcePassageId: string;
  conceptId: string;
  conceptTitle: string;
  masteryBefore: number;
  masteryAfter: number;
  /** null for pre/post tests, which measure without changing mastery. */
  stateAfter: MasteryLevel | null;
  levelLabel: string;
  feedbackTitle: string;
  adaptiveMessage: string;
  /** What the assessment will do next because of this answer. */
  followUp: FollowUp["kind"];
  sessionComplete: boolean;
  duplicate: boolean;
  progress: SessionProgress;
};

/** Pre/post tests only measure; they never move a learner's mastery. */
export function updatesMastery(purpose: AssessmentPurpose): boolean {
  return purpose === "PRACTICE" || purpose === "REASSESSMENT";
}

// ───────────────────────────── Start ─────────────────────────────

async function countFixedQuestions(db: PrismaClient, lessonId: string, conceptIds?: string[]): Promise<number> {
  return db.fixedQuestion.count({
    where: {
      lessonId,
      approved: true,
      sourcePassage: { approved: true },
      ...(conceptIds?.length ? { conceptId: { in: conceptIds } } : {}),
    },
  });
}

export type StartOptions = {
  /** REASSESSMENT only: FIXED serves the approved bank (used solely when AI is not configured). */
  mode?: AssessmentMode;
  purpose?: AssessmentPurpose;
  /** REASSESSMENT only: the concepts to re-check. */
  focusConceptIds?: string[];
};

export async function startAssessment(
  deps: EngineDeps,
  userId: string,
  lessonId: string,
  options: StartOptions = {},
): Promise<{ sessionId: string; mode: AssessmentMode; resumed: boolean }> {
  const { db } = deps;
  const purpose = options.purpose ?? "PRACTICE";
  await assertLessonAccessible(db, userId, lessonId);
  const [progress, lesson] = await Promise.all([
    db.lessonProgress.findUnique({ where: { userId_lessonId: { userId, lessonId } } }),
    db.lesson.findUniqueOrThrow({ where: { id: lessonId }, select: { measurementEnabled: true } }),
  ]);

  let focusConceptIds: string[] = [];
  if (purpose === "PRE_TEST" || purpose === "POST_TEST") {
    if (!lesson.measurementEnabled) throw new AppError("BAD_REQUEST");
    const measurement = await db.lessonMeasurement.findUnique({ where: { userId_lessonId: { userId, lessonId } } });
    if (purpose === "PRE_TEST") {
      if (measurement?.preScore != null) throw new AppError("SESSION_COMPLETED", "أكملت الاختبار القبلي لهذا الدرس من قبل.");
    } else {
      if (measurement?.preScore == null || !progress?.completedAt) throw new AppError("LESSON_NOT_STUDIED", "يُتاح الاختبار البعدي بعد إكمال الدرس واختباره.");
      if (measurement.postScore != null) throw new AppError("SESSION_COMPLETED", "أكملت الاختبار البعدي لهذا الدرس من قبل.");
    }
  } else {
    if (!progress?.studied) throw new AppError("LESSON_NOT_STUDIED");
  }

  if (purpose === "REASSESSMENT") {
    const requested = Array.from(new Set(options.focusConceptIds ?? [])).slice(0, 3);
    const valid = await db.concept.findMany({
      where: { id: { in: requested }, lessonId, passages: { some: { approved: true } } },
      select: { id: true },
    });
    focusConceptIds = valid.map((c) => c.id);
    if (focusConceptIds.length === 0) throw new AppError("BAD_REQUEST");
  }

  // Practice starts from the human-approved database bank whenever it has an eligible question.
  // Only an empty eligible bank uses the existing source-grounded, independently validated
  // generation pipeline; explicitly fixed and measurement sessions remain fixed-only.
  const fixedCount = purpose === "PRACTICE" ? await countFixedQuestions(db, lessonId) : null;
  const mode: AssessmentMode =
    purpose === "REASSESSMENT"
      ? (options.mode ?? "ADAPTIVE")
      : purpose === "PRACTICE" && options.mode !== "FIXED" && fixedCount === 0
        ? "ADAPTIVE"
        : "FIXED";

  const active = await db.assessmentSession.findFirst({
    where: { userId, lessonId, status: "IN_PROGRESS", purpose },
    orderBy: { startedAt: "desc" },
  });
  if (active) {
    const sameFocus = purpose !== "REASSESSMENT" || [...active.focusConceptIds].sort().join() === [...focusConceptIds].sort().join();
    // A practice session left over from the old fully-adaptive design cannot continue under the baseline + follow-up flow.
    const compatible = purpose === "REASSESSMENT" || active.mode === "FIXED";
    if (sameFocus && compatible) return { sessionId: active.id, mode: active.mode, resumed: true };
    await db.assessmentSession.update({ where: { id: active.id }, data: { status: "ABANDONED", generationLockUntil: null } });
  }

  if (mode === "ADAPTIVE") {
    (deps.getProvider ?? getAIProvider)(); // throws AI_NOT_CONFIGURED — never silently swapped for fake output
  } else if ((fixedCount ?? (await countFixedQuestions(db, lessonId, focusConceptIds))) === 0) {
    throw new AppError("NO_FIXED_QUESTIONS");
  }

  const session = await db.assessmentSession.create({ data: { userId, lessonId, mode, purpose, focusConceptIds } });
  return { sessionId: session.id, mode, resumed: false };
}

// ───────────────────────────── Session state ─────────────────────────────

async function loadSession(db: PrismaClient, userId: string, sessionId: string) {
  const session = await db.assessmentSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId) throw new AppError("NOT_FOUND");
  return session;
}

type LoadedSession = Awaited<ReturnType<typeof loadSession>>;

/** True when a provider can be created right now (follow-ups are skipped, never faked, when it cannot). */
function aiAvailable(deps: EngineDeps): boolean {
  try {
    (deps.getProvider ?? getAIProvider)();
    return true;
  } catch (error) {
    if (error instanceof AppError && error.code === "AI_NOT_CONFIGURED") return false;
    throw error;
  }
}

async function loadState(deps: EngineDeps, session: LoadedSession) {
  const { db } = deps;
  const focus = session.purpose === "REASSESSMENT" ? session.focusConceptIds : null;
  const [served, concepts, masteries] = await Promise.all([
    db.generatedQuestion.findMany({
      where: { sessionId: session.id, validationStatus: "VALID", sequence: { not: null } },
      include: { answer: true, concept: { select: { title: true } } },
      orderBy: { sequence: "asc" },
    }),
    db.concept.findMany({
      where: { lessonId: session.lessonId, passages: { some: { approved: true } }, ...(focus ? { id: { in: focus } } : {}) },
      orderBy: { order: "asc" },
      select: { id: true, title: true, order: true },
    }),
    db.conceptMastery.findMany({ where: { userId: session.userId, concept: { lessonId: session.lessonId } } }),
  ]);
  const masteryByConcept = new Map(masteries.map((m) => [m.conceptId, m]));
  const answered = served.filter((q) => q.answer);

  const candidates: ConceptCandidate[] = concepts
    .filter((c) => !session.insufficientConceptIds.includes(c.id))
    .map((c) => {
      const own = answered.filter((q) => q.conceptId === c.id);
      const last = own[own.length - 1];
      let consecutiveErrors = 0;
      for (let i = own.length - 1; i >= 0 && !own[i].answer?.correct; i--) consecutiveErrors++;
      const stored = masteryByConcept.get(c.id);
      return {
        id: c.id,
        order: c.order,
        mastery: stored?.masteryScore ?? MASTERY_RULES.initial,
        sessionAttempts: own.length,
        sessionCorrect: own.filter((q) => q.answer?.correct).length,
        lastSessionResult: last ? Boolean(last.answer?.correct) : null,
        sessionConsecutiveErrors: consecutiveErrors,
        needsReinforcement: stored?.state === "NEEDS_REINFORCEMENT",
      };
    });

  const isBaselineFlow = session.mode === "FIXED" && session.purpose === "PRACTICE";
  const fixedTotal = session.mode === "FIXED" ? await countFixedQuestions(db, session.lessonId, focus ?? undefined) : null;
  const rules = session.purpose === "REASSESSMENT" ? REASSESSMENT_RULES : COMPLETION_RULES;
  const baselineAnswered = answered.filter((q) => q.stage === "BASELINE").length;
  const progress: SessionProgress = {
    answered: session.mode === "FIXED" ? baselineAnswered : answered.length,
    min: rules.minQuestions,
    max: rules.maxQuestions,
    fixedTotal,
  };

  // Follow-ups after wrong baseline answers exist only in the lesson assessment, and only when
  // a provider is available — otherwise the base assessment simply continues.
  const followUp: FollowUp =
    // A follow-up is impossible until the learner has answered. Keeping this condition before
    // aiAvailable makes first fixed-question delivery entirely database-only.
    isBaselineFlow && answered.length > 0 && aiAvailable(deps)
      ? nextFollowUp(
          served.map((q) => ({ id: q.id, conceptId: q.conceptId, stage: q.stage, correct: q.answer ? q.answer.correct : null })),
          session.insufficientConceptIds,
        )
      : { kind: "NONE" };

  return { served, answered, concepts, candidates, masteryByConcept, progress, followUp };
}

type SessionState = Awaited<ReturnType<typeof loadState>>;

function decide(session: LoadedSession, state: SessionState): CompletionDecision {
  if (session.mode === "FIXED") {
    // A pending follow-up (verification, review, reassessment) always comes before the end.
    if (state.followUp.kind !== "NONE") return { complete: false };
    return decideFixedCompletion(state.answered.filter((q) => q.stage === "BASELINE").length, state.progress.fixedTotal ?? 0);
  }
  return session.purpose === "REASSESSMENT"
    ? decideReassessmentCompletion(state.answered.length, state.candidates)
    : decideAdaptiveCompletion(state.answered.length, state.candidates);
}

function toPublic(q: SessionState["served"][number], note: string | null, served: SessionState["served"]): PublicQuestion {
  const meta = (q.generatorMetadata ?? {}) as { isDevelopmentMock?: boolean; adaptiveNote?: string | null };
  const baselineBefore = served.filter((s) => s.stage === "BASELINE" && (s.sequence ?? 0) <= (q.sequence ?? 0)).length;
  return {
    id: q.id,
    sequence: q.sequence ?? 0,
    position: q.origin === "FIXED_BANK" || q.stage === "BASELINE" ? baselineBefore : Math.max(1, baselineBefore),
    stage: q.stage,
    type: q.questionType,
    text: q.question,
    options: q.options,
    conceptId: q.conceptId,
    conceptTitle: q.concept.title,
    difficulty: q.difficulty,
    difficultyLabel: DIFFICULTY_LABEL[(q.difficulty as 1 | 2 | 3) ?? 2],
    adaptiveNote: note ?? meta.adaptiveNote ?? null,
    origin: q.origin,
    isDevelopmentMock: Boolean(meta.isDevelopmentMock),
  };
}

// ───────────────────────────── Completion ─────────────────────────────

export async function completeSession(db: PrismaClient, sessionId: string, reason: CompletionReason): Promise<SessionReport> {
  const session = await db.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } });
  if (session.status === "COMPLETED" && session.report) return readReport(session.report) as SessionReport;

  const [answers, concepts] = await Promise.all([
    db.studentAnswer.findMany({ where: { sessionId }, include: { question: { select: { conceptId: true } } } }),
    db.concept.findMany({ where: { lessonId: session.lessonId }, select: { id: true, title: true, order: true } }),
  ]);
  const report = buildReport({
    mode: session.mode,
    purpose: session.purpose,
    completionReason: reason,
    concepts,
    answers: answers.map((a) => ({
      conceptId: a.question.conceptId,
      correct: a.correct,
      masteryBefore: a.masteryBefore,
      masteryAfter: a.masteryAfter,
      stateBefore: a.stateBefore,
      stateAfter: a.stateAfter,
      answeredAt: a.answeredAt,
    })),
  });

  const now = new Date();
  const updated = await db.assessmentSession.updateMany({
    where: { id: sessionId, status: "IN_PROGRESS" },
    data: { status: "COMPLETED", completedAt: now, report: JSON.parse(JSON.stringify(report)), generationLockUntil: null },
  });
  if (updated.count === 1) {
    if (session.purpose === "PRACTICE") {
      const key = { userId_lessonId: { userId: session.userId, lessonId: session.lessonId } };
      const existing = await db.lessonProgress.findUnique({ where: key });
      await db.lessonProgress.upsert({
        where: key,
        update: { completedAt: existing?.completedAt ?? now, studied: true },
        create: { userId: session.userId, lessonId: session.lessonId, studied: true, studiedAt: now, completedAt: now },
      });
    } else if (session.purpose === "PRE_TEST" || session.purpose === "POST_TEST") {
      await recordMeasurement(db, session, report);
    }
    // A completed assessment is real learning activity: it counts for today's learning streak.
    await recordLearningDay(db, session.userId, now);
    return report;
  }
  const final = await db.assessmentSession.findUniqueOrThrow({ where: { id: sessionId } });
  return readReport(final.report) ?? report;
}

// ───────────────────────────── Next question ─────────────────────────────

function rateLimit(): number {
  const value = Number(process.env.AI_RATE_LIMIT_PER_10_MIN);
  return Number.isFinite(value) && value > 0 ? value : GENERATION_RULES.defaultRateLimitPer10Min;
}

async function assertWithinRateLimit(db: PrismaClient, userId: string) {
  const since = new Date(Date.now() - 10 * 60 * 1000);
  const recent = await db.aIInteractionLog.count({ where: { userId, type: "GENERATE", createdAt: { gte: since } } });
  if (recent >= rateLimit()) throw new AppError("RATE_LIMITED");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function serveFixed(db: PrismaClient, session: LoadedSession, state: SessionState): Promise<NextResult> {
  const focus = session.purpose === "REASSESSMENT" ? session.focusConceptIds : null;
  const fixed = await db.fixedQuestion.findMany({
    where: { lessonId: session.lessonId, approved: true, sourcePassage: { approved: true }, ...(focus ? { conceptId: { in: focus } } : {}) },
    orderBy: { order: "asc" },
    include: { sourcePassage: true },
  });
  const servedIds = new Set(state.served.map((q) => q.fixedQuestionId));
  const next = fixed.find((f) => !servedIds.has(f.id));
  if (!next) {
    await completeSession(db, session.id, "FIXED_SET_DONE");
    return { kind: "completed" };
  }
  const created = await db.generatedQuestion.create({
    data: {
      sessionId: session.id,
      lessonId: session.lessonId,
      conceptId: next.conceptId,
      sourcePassageId: next.sourcePassageId,
      sourceVersion: next.sourcePassage.version,
      sourceSnapshot: next.sourcePassage.text,
      origin: "FIXED_BANK",
      stage: "BASELINE",
      fixedQuestionId: next.id,
      questionType: next.questionType,
      question: next.question,
      options: next.options,
      correctIndex: next.correctIndex,
      correctAnswer: next.options[next.correctIndex],
      explanation: next.explanation,
      answerEvidence: "",
      difficulty: next.difficulty,
      validationStatus: "VALID",
      validationIssues: [],
      generatorMetadata: { origin: "FIXED_BANK", fixedQuestionId: next.id, approvedHumanQuestion: true },
      sequence: state.served.length + 1,
    },
    include: { answer: true, concept: { select: { title: true } } },
  });
  return { kind: "question", question: toPublic(created, null, [...state.served, created]), progress: state.progress };
}

const FOLLOW_UP_NOTE: Record<AdaptiveStage, string> = {
  VERIFICATION: "نتأكد من فهم هذه الفكرة بسؤال آخر",
  SECOND_VERIFICATION: "نتأكد من فهم هذه الفكرة بسؤال آخر",
  REASSESSMENT: "نختبر فهمك لهذه الفكرة بعد المراجعة",
};

type Served = SessionState["served"][number];

/** Question texts the new question must differ from: everything shown for the concept plus its approved bank. */
async function questionsToAvoid(db: PrismaClient, session: LoadedSession, state: SessionState, conceptId: string, includeEarlierSessions: boolean) {
  const bank = await db.fixedQuestion.findMany({ where: { lessonId: session.lessonId, conceptId, approved: true }, select: { question: true, options: true, correctIndex: true } });
  const shownRows = state.served.filter((q) => q.conceptId === conceptId);
  const earlier = includeEarlierSessions
    ? await db.generatedQuestion.findMany({
        where: {
          conceptId,
          validationStatus: "VALID",
          sequence: { not: null },
          session: { userId: session.userId },
          NOT: { sessionId: session.id },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { question: true, correctAnswer: true },
      })
    : [];
  const baseline = bank.map((b) => b.question);
  // Questions and their correct answers, aligned by index (the answers let the checks spot a reworded repeat).
  const items = new Map<string, string>();
  for (const b of bank) items.set(b.question, b.options[b.correctIndex]);
  for (const q of shownRows) items.set(q.question, q.correctAnswer);
  for (const e of earlier) items.set(e.question, e.correctAnswer);
  return { baseline, previous: [...items.keys()], answers: [...items.values()] };
}

type Generated = { kind: "VALID"; question: Served } | { kind: "SKIP"; reason: string };

/**
 * Generates one runtime question at `stage` for the concept of `previous`.
 * Provider/transient failures throw (the learner retries the same step); a concept whose source
 * cannot support a safe question — or that was rejected over and over — is skipped, never faked.
 */
async function generateFollowUp(
  deps: EngineDeps,
  session: LoadedSession,
  state: SessionState,
  input: { stage: AdaptiveStage; previous: Served | null; concept: { id: string; title: string }; trace?: Record<string, unknown> },
): Promise<Generated> {
  const { db } = deps;
  const tracking = await startGenerationRequest(db, {
    sessionId: session.id,
    userId: session.userId,
    stage: input.stage,
    conceptId: input.concept.id,
    previousQuestionId: input.previous?.id ?? null,
  });
  try {
    const generated = await runFollowUp(deps, session, state, input);
    await finishGenerationRequest(
      db,
      tracking,
      generated.kind === "VALID"
        ? { status: "SUCCESS", questionId: generated.question.id }
        : { status: generated.reason === "REPEATED_REJECTION" ? "REJECTED" : "INSUFFICIENT_SOURCE", errorCode: generated.reason, details: { conceptSkipped: true } },
    );
    return generated;
  } catch (error) {
    const code = isAppError(error) ? error.code : "INTERNAL";
    const status = code === "GENERATION_FAILED" ? "REJECTED" : code.startsWith("AI_") && code !== "AI_TIMEOUT" ? "PROVIDER_ERROR" : "FAILED";
    await finishGenerationRequest(db, tracking, { status, errorCode: code });
    throw error;
  }
}

async function runFollowUp(
  deps: EngineDeps,
  session: LoadedSession,
  state: SessionState,
  input: { stage: AdaptiveStage; previous: Served | null; concept: { id: string; title: string }; trace?: Record<string, unknown> },
): Promise<Generated> {
  const { db } = deps;
  const provider = (deps.getProvider ?? getAIProvider)();
  await assertWithinRateLimit(db, session.userId);

  const avoid = await questionsToAvoid(db, session, state, input.concept.id, input.stage === "REASSESSMENT");
  const previous = input.previous;
  const result: PipelineResult = await produceValidatedQuestion({
    db,
    provider,
    userId: session.userId,
    sessionId: session.id,
    lessonId: session.lessonId,
    concept: input.concept,
    stage: input.stage,
    targetDifficulty: 2,
    previous: previous
      ? {
          id: previous.id,
          stage: previous.stage,
          question: previous.question,
          options: previous.options,
          studentAnswer: previous.answer?.selectedAnswer ?? "",
          correctAnswer: previous.correctAnswer,
        }
      : null,
    previousQuestions: avoid.previous,
    previousAnswers: avoid.answers,
    baselineQuestions: avoid.baseline,
    trace: input.trace,
  });

  if (result.kind === "INSUFFICIENT_SOURCE" || result.kind === "SOURCE_NOT_APPROVED") return { kind: "SKIP", reason: result.kind };
  if (result.kind === "FAILED") {
    if (result.reason === "TIME_BUDGET") throw new AppError("AI_TIMEOUT");
    // The learner may retry; after repeated exhaustion for this very step the concept is skipped (fail closed).
    const rejected = await db.generatedQuestion.count({
      where: { sessionId: session.id, conceptId: input.concept.id, stage: input.stage, previousQuestionId: previous?.id ?? null, validationStatus: "REJECTED" },
    });
    if (rejected >= GENERATION_RULES.maxAttempts * 2) return { kind: "SKIP", reason: "REPEATED_REJECTION" };
    throw new AppError("GENERATION_FAILED");
  }

  const note = FOLLOW_UP_NOTE[input.stage];
  const sequence = state.served.length + 1;
  const generated = await db.generatedQuestion.update({
    where: { id: result.questionId },
    data: { sequence, generatorMetadata: await mergeMetadata(db, result.questionId, { adaptiveNote: note }) },
    include: { answer: true, concept: { select: { title: true } } },
  });
  return { kind: "VALID", question: generated };
}

async function reviewStep(db: PrismaClient, session: LoadedSession, conceptId: string): Promise<ReviewStep> {
  const concept = await db.concept.findFirstOrThrow({
    where: { id: conceptId, lessonId: session.lessonId },
    select: { id: true, title: true, description: true, videoUrl: true, videoStartSecond: true, videoEndSecond: true, videoApproved: true },
  });
  return { conceptId: concept.id, conceptTitle: concept.title, description: concept.description, video: approvedVideo(concept) };
}

async function skipConcept(db: PrismaClient, session: LoadedSession, conceptId: string) {
  const ids = Array.from(new Set([...session.insufficientConceptIds, conceptId]));
  await db.assessmentSession.update({ where: { id: session.id }, data: { insufficientConceptIds: ids } });
}

export async function getNextQuestion(
  deps: EngineDeps,
  userId: string,
  sessionId: string,
  options: NextOptions = {},
  retry = 0,
): Promise<NextResult> {
  const { db } = deps;
  const session = await loadSession(db, userId, sessionId);
  if (session.status === "COMPLETED") return { kind: "completed" };
  if (session.status !== "IN_PROGRESS") throw new AppError("NOT_FOUND");

  const state = await loadState(deps, session);
  const pending = state.served.find((q) => !q.answer);
  if (pending) return { kind: "question", question: toPublic(pending, null, state.served), progress: state.progress };
  if (options.peek) return session.generationLockUntil && session.generationLockUntil > new Date() ? { kind: "pending" } : { kind: "none" };

  const decision = decide(session, state);
  if (decision.complete) {
    await completeSession(db, session.id, decision.reason);
    return { kind: "completed" };
  }

  try {
    if (session.mode === "ADAPTIVE") return await serveAdaptive(deps, session, state);

    const followUp = state.followUp;
    if (followUp.kind === "REVIEW" && !options.reviewed) {
      return { kind: "review", review: await reviewStep(db, session, followUp.conceptId), progress: state.progress };
    }
    if (followUp.kind !== "NONE") {
      const stage: AdaptiveStage = followUp.kind === "REVIEW" ? "REASSESSMENT" : followUp.stage;
      const outcome = await withGenerationLock(db, session, async () => {
        const previous = state.served.find((q) => q.id === followUp.previousId) ?? null;
        const concept = { id: followUp.conceptId, title: previous?.concept.title ?? "" };
        return generateFollowUp(deps, session, state, { stage, previous, concept, trace: { followUpOf: followUp.previousId } });
      });
      if (outcome === "BUSY") return { kind: "pending" };
      if (outcome.kind === "VALID") {
        return { kind: "question", question: toPublic(outcome.question, FOLLOW_UP_NOTE[stage], [...state.served, outcome.question]), progress: state.progress };
      }
      // No safe question can be generated for this concept: record it and carry on with the approved bank.
      await skipConcept(db, session, followUp.conceptId);
      return getNextQuestion(deps, userId, sessionId, options, retry);
    }
    return await serveFixed(db, session, state);
  } catch (error) {
    // Two concurrent requests raced for the same sequence number: serve whichever won.
    if (isUniqueViolation(error) && retry < 2) return getNextQuestion(deps, userId, sessionId, options, retry + 1);
    throw error;
  }
}

/** Runs `work` while holding the session's generation lock; returns "BUSY" when another request holds it. */
async function withGenerationLock<T>(db: PrismaClient, session: LoadedSession, work: () => Promise<T>): Promise<T | "BUSY"> {
  const now = Date.now();
  const lock = await db.assessmentSession.updateMany({
    where: {
      id: session.id,
      status: "IN_PROGRESS",
      OR: [{ generationLockUntil: null }, { generationLockUntil: { lt: new Date(now) } }],
    },
    data: { generationLockUntil: new Date(now + GENERATION_RULES.lockMs) },
  });
  if (lock.count === 0) return "BUSY";
  try {
    return await work();
  } finally {
    await db.assessmentSession.updateMany({ where: { id: session.id }, data: { generationLockUntil: null } });
  }
}

/** REASSESSMENT sessions: focused re-check of chosen concepts, every question generated at runtime. */
async function serveAdaptive(deps: EngineDeps, session: LoadedSession, state: SessionState): Promise<NextResult> {
  const { db } = deps;
  (deps.getProvider ?? getAIProvider)();

  const outcome = await withGenerationLock(db, session, async () => {
    let pool = [...state.candidates];
    const insufficient = [...session.insufficientConceptIds];
    const lastServed = state.served[state.served.length - 1];

    while (true) {
      const decision = decideReassessmentCompletion(state.answered.length, pool);
      if (decision.complete) {
        await completeSession(db, session.id, decision.reason);
        return { done: true as const };
      }
      const selection = selectNextConcept(pool, lastServed?.conceptId ?? null);
      if (!selection) throw new AppError("INSUFFICIENT_SOURCE", "لا توجد مادة كافية لإنشاء سؤال موثوق لهذا الدرس.");

      const concept = state.concepts.find((c) => c.id === selection.conceptId)!;
      const previous = [...state.answered].reverse().find((q) => q.conceptId === concept.id) ?? null;
      const generated = await generateFollowUp(deps, session, state, {
        stage: "REASSESSMENT",
        previous,
        concept: { id: concept.id, title: concept.title },
        trace: { selection: { reason: selection.reason, score: selection.score } },
      });
      if (generated.kind === "SKIP") {
        insufficient.push(concept.id);
        await db.assessmentSession.update({ where: { id: session.id }, data: { insufficientConceptIds: insufficient } });
        pool = pool.filter((c) => c.id !== concept.id);
        continue;
      }
      const note = adaptiveNote(selection.reason, 2, generated.question.sequence ?? 1);
      return { done: false as const, question: generated.question, note };
    }
  });

  if (outcome === "BUSY") return { kind: "pending" };
  if (outcome.done) return { kind: "completed" };
  return { kind: "question", question: toPublic(outcome.question, outcome.note, [...state.served, outcome.question]), progress: state.progress };
}

async function mergeMetadata(db: PrismaClient, questionId: string, extra: Record<string, unknown>) {
  const row = await db.generatedQuestion.findUniqueOrThrow({ where: { id: questionId }, select: { generatorMetadata: true } });
  return JSON.parse(JSON.stringify({ ...((row.generatorMetadata as Record<string, unknown>) ?? {}), ...extra }));
}

// ───────────────────────────── Answer ─────────────────────────────

function feedbackFor(args: {
  correct: boolean;
  stateAfter: MasteryLevel | null;
  stage: QuestionStage;
  followUp: FollowUp["kind"];
  sessionComplete: boolean;
}): { title: string; message: string } {
  const { correct, stateAfter, stage, followUp, sessionComplete } = args;
  if (stateAfter === null) {
    return { title: correct ? "إجابة صحيحة" : "إجابة غير صحيحة", message: "سُجّلت إجابتك لقياس أثر الدرس." };
  }
  // A correct answer after the targeted review is the moment the concept is considered reinforced.
  if (correct) return stage === "REASSESSMENT" ? { title: "تم تثبيت المفهوم ✓", message: "أحسنت، أتقنت هذا المفهوم." } : { title: "إجابة صحيحة", message: "" };
  return wrongAnswerFeedback(stage, followUp, sessionComplete);
}

type QuestionWithContext = Prisma.GeneratedQuestionGetPayload<{
  include: { session: true; concept: { select: { title: true } }; answer: true };
}>;

function buildAnswerResult(
  q: QuestionWithContext,
  answer: { selectedIndex: number; correct: boolean; masteryBefore: number; masteryAfter: number; stateAfter: MasteryLevel },
  extra: { duplicate: boolean; sessionComplete: boolean; progress: SessionProgress; followUp: FollowUp["kind"] },
): AnswerResult {
  const measured = !updatesMastery(q.session.purpose);
  const stateAfter = measured ? null : answer.stateAfter;
  const feedback = feedbackFor({ correct: answer.correct, stateAfter, stage: q.stage, followUp: extra.followUp, sessionComplete: extra.sessionComplete });
  return {
    questionId: q.id,
    stage: q.stage,
    correct: answer.correct,
    selectedIndex: answer.selectedIndex,
    correctIndex: q.correctIndex,
    correctAnswer: q.options[q.correctIndex],
    explanation: q.explanation,
    sourcePassageId: q.sourcePassageId,
    conceptId: q.conceptId,
    conceptTitle: q.concept.title,
    masteryBefore: answer.masteryBefore,
    masteryAfter: answer.masteryAfter,
    stateAfter,
    levelLabel: stateAfter ? MASTERY_LEVEL_META[stateAfter].label : "",
    feedbackTitle: feedback.title,
    adaptiveMessage: feedback.message,
    followUp: answer.correct ? "NONE" : extra.followUp,
    sessionComplete: extra.sessionComplete,
    duplicate: extra.duplicate,
    progress: extra.progress,
  };
}

function toRecord(row: {
  masteryScore: number;
  attempts: number;
  correctCount: number;
  incorrectCount: number;
  consecutiveCorrect: number;
  consecutiveIncorrect: number;
  lastDifficulty: number | null;
  recentOutcomes: boolean[];
  state: MasteryLevel;
}): MasteryRecord {
  return { ...row };
}

async function recordAnswer(db: PrismaClient, q: QuestionWithContext, userId: string, selectedIndex: number) {
  const correct = selectedIndex === q.correctIndex;
  const changesMastery = updatesMastery(q.session.purpose);
  return db.$transaction(
    async (tx) => {
      const existing = await tx.conceptMastery.findUnique({ where: { userId_conceptId: { userId, conceptId: q.conceptId } } });
      const before = existing ? toRecord(existing) : initialMastery();
      const after = changesMastery ? applyAnswer(before, { correct, difficulty: q.difficulty }) : before;
      // Unique(questionId): a duplicate submission fails here and rolls back the mastery update.
      const answer = await tx.studentAnswer.create({
        data: {
          questionId: q.id,
          userId,
          sessionId: q.sessionId,
          selectedIndex,
          selectedAnswer: q.options[selectedIndex],
          correct,
          masteryBefore: before.masteryScore,
          masteryAfter: after.masteryScore,
          stateBefore: before.state,
          stateAfter: after.state,
        },
      });
      if (changesMastery) {
        const data = {
          masteryScore: after.masteryScore,
          attempts: after.attempts,
          correctCount: after.correctCount,
          incorrectCount: after.incorrectCount,
          consecutiveCorrect: after.consecutiveCorrect,
          consecutiveIncorrect: after.consecutiveIncorrect,
          lastDifficulty: after.lastDifficulty,
          recentOutcomes: after.recentOutcomes,
          state: after.state,
        };
        await tx.conceptMastery.upsert({
          where: { userId_conceptId: { userId, conceptId: q.conceptId } },
          update: data,
          create: { userId, conceptId: q.conceptId, ...data },
        });
      }
      return answer;
    },
    { isolationLevel: "Serializable" },
  );
}

export async function submitAnswer(
  deps: EngineDeps,
  userId: string,
  sessionId: string,
  questionId: string,
  selectedIndex: number,
): Promise<AnswerResult> {
  const { db } = deps;
  const include = { session: true, concept: { select: { title: true } }, answer: true } as const;
  const question = await db.generatedQuestion.findUnique({ where: { id: questionId }, include });
  if (!question || question.sessionId !== sessionId || question.session.userId !== userId) throw new AppError("NOT_FOUND");
  if (question.validationStatus !== "VALID" || question.sequence == null) throw new AppError("NOT_FOUND");
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= question.options.length) {
    throw new AppError("BAD_REQUEST");
  }

  const progressAfter = async () => {
    const session = await loadSession(db, userId, sessionId);
    const state = await loadState(deps, session);
    return { session, state };
  };

  if (question.answer) {
    const { session, state } = await progressAfter();
    return buildAnswerResult(question, question.answer, {
      duplicate: true,
      sessionComplete: session.status === "COMPLETED",
      progress: state.progress,
      followUp: state.followUp.kind,
    });
  }
  if (question.session.status !== "IN_PROGRESS") throw new AppError("SESSION_COMPLETED");

  let answer;
  let duplicate = false;
  for (let attempt = 0; ; attempt++) {
    try {
      answer = await recordAnswer(db, question, userId, selectedIndex);
      break;
    } catch (error) {
      if (isUniqueViolation(error)) {
        answer = await db.studentAnswer.findUniqueOrThrow({ where: { questionId } });
        duplicate = true;
        break;
      }
      const serializationFailure =
        error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "40001");
      if (serializationFailure && attempt < 2) continue;
      throw error;
    }
  }

  let { session, state } = await progressAfter();
  if (session.status === "IN_PROGRESS") {
    const decision = decide(session, state);
    if (decision.complete) {
      await completeSession(db, session.id, decision.reason);
      ({ session, state } = await progressAfter());
    }
  }

  return buildAnswerResult(question, answer, {
    duplicate,
    sessionComplete: session.status === "COMPLETED",
    progress: state.progress,
    followUp: state.followUp.kind,
  });
}
