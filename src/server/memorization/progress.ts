import type { PrismaClient } from "@/generated/prisma/client";
import { canonicalResultOrder, visiblePassageWhere } from "./content";
import { DUE_REVIEW_LIMIT, STATE_RANK, type MemorizationStateKey } from "./config";

export type MemorizationSummary = {
  courseId: string;
  courseTitle: string;
  totalPassages: number;
  attemptedPassages: number;
  /** State «متقن». */
  masteredPassages: number;
  /** State «جيد». */
  goodPassages: number;
  /** States «يحتاج إلى تثبيت» and «يحتاج إلى مراجعة». */
  needsReinforcementPassages: number;
  dueCount: number;
  /**
   * Average passage mastery over ALL visible passages of the book (a passage never recited counts as 0):
   * round(Σ masteryScore ÷ totalPassages). Real data only — never a combined «Islamic learning» number.
   */
  progressPct: number;
};

/** One summary per book that has visible (approved) passages. Empty when nothing is approved yet. */
export async function getMemorizationSummaries(db: PrismaClient, userId: string, now: Date = new Date()): Promise<MemorizationSummary[]> {
  const courses = await db.course.findMany({
    where: { matnSections: { some: { status: "APPROVED", passages: { some: visiblePassageWhere } } } },
    orderBy: { order: "asc" },
    select: {
      id: true,
      title: true,
      matnSections: {
        where: { status: "APPROVED" },
        select: { passages: { where: visiblePassageWhere, select: { id: true, mastery: { where: { userId }, select: { masteryScore: true, state: true, nextReviewAt: true, attempts: true } } } } },
      },
    },
  });

  return courses.map((course) => {
    const passages = course.matnSections.flatMap((s) => s.passages);
    const rows = passages.map((p) => p.mastery[0] ?? null);
    const attempted = rows.filter((m) => m && m.attempts > 0);
    const count = (state: MemorizationStateKey) => attempted.filter((m) => m!.state === state).length;
    const total = passages.length;
    const sum = rows.reduce((n, m) => n + (m?.masteryScore ?? 0), 0);
    return {
      courseId: course.id,
      courseTitle: course.title,
      totalPassages: total,
      attemptedPassages: attempted.length,
      masteredPassages: count("MASTERED"),
      goodPassages: count("GOOD"),
      needsReinforcementPassages: count("NEEDS_REINFORCEMENT") + count("NEEDS_REVIEW"),
      dueCount: attempted.filter((m) => m!.nextReviewAt.getTime() <= now.getTime()).length,
      progressPct: total > 0 ? Math.round(sum / total) : 0,
    };
  });
}

export type DueReview = {
  passageId: string;
  passageTitle: string;
  sectionTitle: string;
  courseTitle: string;
  state: MemorizationStateKey;
  masteryScore: number;
  repeatedWeakness: boolean;
  dueAt: Date;
};

/**
 * Passages whose deterministic nextReviewAt has arrived, most urgent first: repeated weakness, then the weakest state,
 * then the longest overdue. Only visible (approved) passages are listed.
 */
export async function getDueReviews(db: PrismaClient, userId: string, now: Date = new Date(), limit: number = DUE_REVIEW_LIMIT, courseId?: string): Promise<DueReview[]> {
  const rows = await db.memorizationMastery.findMany({
    where: {
      userId,
      nextReviewAt: { lte: now },
      passage: courseId ? { ...visiblePassageWhere, section: { courseId } } : visiblePassageWhere,
    },
    include: { passage: { select: { title: true, section: { select: { title: true, course: { select: { title: true } } } } } } },
  });
  return rows
    .map((m) => ({
      passageId: m.passageId,
      passageTitle: m.passage.title,
      sectionTitle: m.passage.section.title,
      courseTitle: m.passage.section.course.title,
      state: m.state,
      masteryScore: m.masteryScore,
      repeatedWeakness: m.consecutiveWeak >= 2,
      dueAt: m.nextReviewAt,
    }))
    .sort(
      (a, b) =>
        Number(b.repeatedWeakness) - Number(a.repeatedWeakness) ||
        STATE_RANK[a.state] - STATE_RANK[b.state] ||
        a.dueAt.getTime() - b.dueAt.getTime(),
    )
    .slice(0, limit);
}

export type MemorizationContinue = { passageId: string; passageTitle: string; sectionTitle: string; courseTitle: string; startUnitId: string; kind: "FIRST" | "REINFORCE" };

/**
 * Where «واصل الحفظ» goes: the first approved unit without a completed NEW (PRACTICE) attempt,
 * in course → section → passage → unit order. Reviews never move this position backwards.
 */
export async function getMemorizationContinue(db: PrismaClient, userId: string, courseId?: string): Promise<MemorizationContinue | null> {
  const passages = await db.matnPassage.findMany({
    where: courseId ? { ...visiblePassageWhere, section: { courseId } } : visiblePassageWhere,
    orderBy: [{ section: { course: { order: "asc" } } }, { section: { order: "asc" } }, { order: "asc" }],
    select: {
      id: true,
      title: true,
      section: { select: { title: true, course: { select: { title: true } } } },
      units: { orderBy: { order: "asc" }, select: { id: true, results: { where: { attempt: { userId, kind: "PRACTICE" } }, select: { id: true } } } },
      mastery: { where: { userId }, select: { state: true, masteryScore: true, attempts: true } },
    },
  });
  const describe = (p: (typeof passages)[number], startUnitId: string, kind: MemorizationContinue["kind"]): MemorizationContinue => ({
    passageId: p.id,
    passageTitle: p.title,
    sectionTitle: p.section.title,
    courseTitle: p.section.course.title,
    startUnitId,
    kind,
  });
  for (const passage of passages) {
    const unit = passage.units.find((unit) => unit.results.length === 0);
    if (unit) return describe(passage, unit.id, "FIRST");
  }
  const weakest = passages
    .filter((p) => p.mastery[0] && p.mastery[0].state !== "MASTERED")
    .sort((a, b) => a.mastery[0]!.masteryScore - b.mastery[0]!.masteryScore)[0];
  return weakest ? describe(weakest, weakest.units[0]!.id, "REINFORCE") : null;
}

/**
 * Timestamps of the learner's latest meaningful activity in each journey. Used by the home «واصل من حيث توقفت» rule:
 * the hero resumes memorization only when it is the most recent of the two.
 */
export async function getLatestJourneyActivity(db: PrismaClient, userId: string): Promise<{ memorizationAt: Date | null; understandingAt: Date | null }> {
  const [attempt, studied, completed, answer, session] = await Promise.all([
    db.recitationAttempt.findFirst({ where: { userId }, orderBy: { completedAt: "desc" }, select: { completedAt: true } }),
    db.lessonProgress.findFirst({ where: { userId, studiedAt: { not: null } }, orderBy: { studiedAt: "desc" }, select: { studiedAt: true } }),
    db.lessonProgress.findFirst({ where: { userId, completedAt: { not: null } }, orderBy: { completedAt: "desc" }, select: { completedAt: true } }),
    db.studentAnswer.findFirst({ where: { userId }, orderBy: { answeredAt: "desc" }, select: { answeredAt: true } }),
    db.assessmentSession.findFirst({ where: { userId, completedAt: { not: null } }, orderBy: { completedAt: "desc" }, select: { completedAt: true } }),
  ]);
  const times = [studied?.studiedAt, completed?.completedAt, answer?.answeredAt, session?.completedAt].filter((d): d is Date => Boolean(d));
  return {
    memorizationAt: attempt?.completedAt ?? null,
    understandingAt: times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null,
  };
}

/** Recent attempts of one learner on one passage (own data only), newest first. */
export async function getRecentAttempts(db: PrismaClient, userId: string, passageId: string, take = 5) {
  return db.recitationAttempt.findMany({
    where: { userId, passageId },
    orderBy: { completedAt: "desc" },
    take,
    select: { id: true, scorePercentage: true, correctUnits: true, totalUnits: true, completedAt: true, kind: true },
  });
}

export type AttemptResult = {
  id: string;
  passage: { id: string; title: string; sectionTitle: string; courseId: string; courseTitle: string };
  kind: "PRACTICE" | "REVIEW";
  totalUnits: number;
  correctUnits: number;
  incorrectUnits: number;
  forgottenUnits: number;
  scorePercentage: number;
  completedAt: Date;
  masteryBefore: number | null;
  masteryAfter: number;
  stateAfter: MemorizationStateKey;
  nextReviewAt: Date;
  analysisStatus: "ANALYZED" | "FALLBACK" | null;
  analysis: { summary: string; patterns: string[]; priorities: { unitNumber: number; reason: string }[]; progressObservation: string | null } | null;
  historyAttempts: number;
  details: { unitId: string; unitOrder: number; text: string; status: "CORRECT" | "INCORRECT" | "FORGOTTEN"; scope: "WORDS" | "FULL_UNIT" | null; wordIndexes: number[]; forgottenWordIndexes: number[] }[];
};

/** One attempt, only if it belongs to `userId` — otherwise null (the caller answers 404). */
export async function getAttemptResult(db: PrismaClient, userId: string, attemptId: string): Promise<AttemptResult | null> {
  const a = await db.recitationAttempt.findFirst({
    where: { id: attemptId, userId },
    include: {
      passage: { select: { id: true, title: true, section: { select: { title: true, course: { select: { id: true, title: true } } } } } },
      results: { include: { unit: { select: { order: true, canonicalText: true } } }, orderBy: canonicalResultOrder },
    },
  });
  if (!a) return null;
  const historyAttempts = await db.recitationAttempt.count({ where: { userId, passageId: a.passageId, completedAt: { lt: a.completedAt } } });
  return {
    id: a.id,
    passage: { id: a.passage.id, title: a.passage.title, sectionTitle: a.passage.section.title, courseId: a.passage.section.course.id, courseTitle: a.passage.section.course.title },
    kind: a.kind,
    totalUnits: a.totalUnits,
    correctUnits: a.correctUnits,
    incorrectUnits: a.incorrectUnits,
    forgottenUnits: a.forgottenUnits,
    scorePercentage: a.scorePercentage,
    completedAt: a.completedAt,
    masteryBefore: a.masteryBefore,
    masteryAfter: a.masteryAfter,
    stateAfter: a.stateAfter,
    nextReviewAt: a.nextReviewAt,
    analysisStatus: a.analysisStatus,
    analysis: a.analysisStatus === "ANALYZED" ? (a.analysis as AttemptResult["analysis"]) : null,
    historyAttempts,
    details: a.results.map((result) => ({ unitId: result.unitId, unitOrder: result.unit.order, text: result.unit.canonicalText, status: result.selfAssessmentStatus, scope: result.selfAssessmentScope, wordIndexes: result.wordIndexes, forgottenWordIndexes: result.forgottenWordIndexes })),
  };
}

export type MemorizationProgressDetail = {
  summaries: MemorizationSummary[];
  totalAttempts: number;
  /** Passages with at least two attempts whose latest score is higher than their first — only real history. */
  improvedPassages: number;
  /** Units not CORRECT in the latest attempt of their passage. */
  unitsNeedingReinforcement: number;
};

/** The «حفظ المتن» dimension of the progress screen. Never combined with understanding progress. */
export async function getMemorizationProgressDetail(db: PrismaClient, userId: string, now: Date = new Date()): Promise<MemorizationProgressDetail | null> {
  const summaries = await getMemorizationSummaries(db, userId, now);
  if (summaries.length === 0) return null;
  const attempts = await db.recitationAttempt.findMany({
    where: { userId, passage: visiblePassageWhere },
    orderBy: { completedAt: "asc" },
    select: { passageId: true, scorePercentage: true, results: { select: { selfAssessmentStatus: true } } },
  });
  const byPassage = new Map<string, typeof attempts>();
  for (const a of attempts) byPassage.set(a.passageId, [...(byPassage.get(a.passageId) ?? []), a]);
  let improved = 0;
  let needing = 0;
  for (const list of byPassage.values()) {
    const first = list[0];
    const last = list[list.length - 1];
    if (list.length >= 2 && last.scorePercentage > first.scorePercentage) improved += 1;
    needing += last.results.filter((r) => r.selfAssessmentStatus !== "CORRECT").length;
  }
  return { summaries, totalAttempts: attempts.length, improvedPassages: improved, unitsNeedingReinforcement: needing };
}
