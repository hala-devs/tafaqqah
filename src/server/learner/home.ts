import "server-only";
import { cache } from "react";
import { prisma } from "@/server/db";
import type { PrismaClient } from "@/generated/prisma/client";
import { deriveHomeState, lessonProgressPct, type HomeState, type StageKey } from "@/lib/home-state";
import { pickJourneyWindow, type JourneyNode } from "@/lib/journey";
import { assessmentHref, memorizePassageHref, reviewHref } from "@/lib/routes";
import { flattenPath, getLearningPath, type PathCourse } from "@/server/content/queries";
import { isAccessible } from "@/server/content/path-state";
import { countBaselineAnswers } from "./lesson-progress";
import { getMasteryByLesson, getWeakConcepts, type WeakConcept } from "./overview";
import { getMotivation, type Motivation } from "./motivation";
import { getDueReviews, getLatestJourneyActivity, getMemorizationContinue, getMemorizationSummaries, type MemorizationContinue, type MemorizationSummary } from "@/server/memorization/progress";

export type ContinueTarget = {
  stage: StageKey;
  href: string;
  bookTitle: string;
  levelTitle: string | null;
  lesson: { id: string; title: string; number: number; chapterTitle: string } | null;
  /** Share of the current lesson done (real state), or null when there is no current lesson. */
  progressPct: number | null;
  /** e.g. «أجبت عن ٣ من ١٦ سؤالًا». */
  detail: string | null;
  /** Memorization targets carry their own title (there is no lesson). */
  headline?: string;
  /** True only for an assessment/reassessment session the learner has already started. */
  inProgress?: boolean;
};

/** The learner's memorization state for the home page (real data only; null when nothing is approved yet). */
export type HomeMemorization = {
  summary: MemorizationSummary;
  next: MemorizationContinue | null;
  /** The most urgent passage due for review, if any. */
  firstDue: { passageId: string; passageTitle: string } | null;
};

export type MasterySummary = {
  /** «متقن»: GOOD or MASTERED — the same grouping the lesson result uses for «أتقنت». */
  mastered: number;
  learning: number;
  needsReinforcement: number;
};

export type HomeData = {
  firstName: string;
  isSample: boolean;
  target: ContinueTarget | null;
  state: HomeState;
  motivation: Motivation;
  mastery: MasterySummary;
  weak: WeakConcept[];
  journey: { bookTitle: string; levelTitle: string | null; nodes: JourneyNode[]; hidden: number } | null;
  completedLessons: number;
  publishedLessons: number;
  quote: { id: string; text: string; author: string; source: string } | null;
  memorization: HomeMemorization | null;
};

export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Deterministic pick: the same quote all day, a different one tomorrow. */
export async function getQuoteOfTheDay(db: PrismaClient, dayKey: string) {
  const quotes = await db.quote.findMany({ where: { approved: true }, orderBy: { id: "asc" } });
  const usable = quotes.filter((q) => q.text.trim() && q.author.trim() && q.source.trim());
  if (usable.length === 0) return null;
  let hash = 0;
  for (const ch of dayKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const q = usable[hash % usable.length];
  return { id: q.id, text: q.text.trim(), author: q.author.trim(), source: q.source.trim() };
}

function buildJourney(path: PathCourse[], currentLessonId: string | null) {
  const course = path.find((c) => c.chapters.some((ch) => ch.lessons.some((l) => l.id === currentLessonId))) ?? path.find((c) => c.chapters.some((ch) => ch.lessons.some((l) => l.status === "PUBLISHED"))) ?? path[0];
  if (!course) return null;
  const nodes: JourneyNode[] = course.chapters.flatMap((ch) =>
    ch.lessons.map((l): JourneyNode => {
      const state: JourneyNode["state"] = l.status === "COMING_SOON" ? "soon" : l.state === "COMPLETED" ? "done" : l.state === "CURRENT" ? "current" : "upcoming";
      return {
        id: l.id,
        number: l.number,
        title: l.title,
        state,
        statusLabel: l.state === "CURRENT" ? (l.studied ? "الدرس الحالي" : "متاح الآن") : undefined,
        href: isAccessible(l.state) ? `/lessons/${l.id}` : null,
      };
    }),
  );
  const { shown, hidden } = pickJourneyWindow(nodes);
  return { bookTitle: course.title, levelTitle: course.levelTitle, nodes: shown, hidden };
}

export async function getContinueTarget(userId: string, path: PathCourse[], weak: WeakConcept[]): Promise<ContinueTarget | null> {
  const flat = flattenPath(path);
  const byId = new Map(flat.map((e) => [e.lesson.id, e]));
  const sessions = await prisma.assessmentSession.findMany({
    where: { userId, status: "IN_PROGRESS" },
    orderBy: { startedAt: "desc" },
    select: { id: true, lessonId: true, purpose: true, _count: { select: { answers: true } } },
  });
  // 1) A started assessment or reassessment is exactly where the learner stopped.
  const open = sessions.find((s) => {
    const entry = byId.get(s.lessonId);
    return entry && entry.lesson.status === "PUBLISHED" && isAccessible(entry.lesson.state);
  });

  const lessonInfo = (e: (typeof flat)[number]) => ({ id: e.lesson.id, title: e.lesson.title, number: e.lesson.number, chapterTitle: e.chapter.title });
  const base = (e: (typeof flat)[number]) => ({ bookTitle: e.course.title, levelTitle: e.course.levelTitle, lesson: lessonInfo(e) });

  if (open) {
    const entry = byId.get(open.lessonId)!;
    const total = await prisma.fixedQuestion.count({ where: { lessonId: open.lessonId, approved: true, sourcePassage: { approved: true } } });
    const baselineAnswered = await countBaselineAnswers(open.id);
    const reassess = open.purpose === "REASSESSMENT";
    return {
      stage: reassess ? "REASSESS" : "ASSESS",
      href: assessmentHref(open.lessonId, open.id),
      inProgress: true,
      ...base(entry),
      progressPct: reassess ? null : lessonProgressPct({ studied: true, completed: false, answered: baselineAnswered, total }),
      detail: reassess || total === 0 ? null : `أجبت عن ${baselineAnswered} من ${total}`,
    };
  }

  // 2) The first open lesson of the path.
  const current = flat.find((e) => e.lesson.state === "CURRENT");
  if (current) {
    const studied = current.lesson.studied;
    return {
      stage: studied ? "ASSESS" : "LEARN",
      href: studied ? assessmentHref(current.lesson.id) : `/lessons/${current.lesson.id}`,
      ...base(current),
      progressPct: lessonProgressPct({ studied, completed: false, answered: 0, total: 1 }),
      detail: null,
    };
  }

  // 3) Lessons are finished: what remains is reinforcement.
  const top = weak[0];
  if (top) {
    const entry = byId.get(top.lessonId);
    return {
      stage: "REVIEW",
      href: reviewHref(top.lessonId, top.conceptId),
      bookTitle: entry?.course.title ?? "",
      levelTitle: entry?.course.levelTitle ?? null,
      lesson: entry ? lessonInfo(entry) : null,
      progressPct: null,
      detail: top.conceptTitle,
    };
  }
  return null;
}

/**
 * «واصل من حيث توقفت»: the hero resumes MEMORIZATION only when
 *   1) the learner has no assessment/reassessment already in progress (an open session always wins),
 *   2) there is a passage to continue, and
 *   3) the latest meaningful activity was a completed recitation (strictly newer than the latest studied lesson,
 *      answered question or completed assessment) — or the learner has never done anything on the understanding journey.
 * Otherwise the existing learning continuation is untouched.
 */
export function shouldResumeMemorization(input: { understandingInProgress: boolean; hasNext: boolean; memorizationAt: Date | null; understandingAt: Date | null }): boolean {
  if (input.understandingInProgress || !input.hasNext || !input.memorizationAt) return false;
  return input.understandingAt === null || input.memorizationAt.getTime() > input.understandingAt.getTime();
}

async function getHomeMemorization(userId: string, now: Date): Promise<{ memorization: HomeMemorization | null; memorizationAt: Date | null; understandingAt: Date | null }> {
  const [summaries, latest] = await Promise.all([
    getMemorizationSummaries(prisma, userId, now),
    getLatestJourneyActivity(prisma, userId),
  ]);
  const summary = summaries[0] ?? null;
  const bookNext = summary ? await getMemorizationContinue(prisma, userId, summary.courseId) : null;
  const bookDue = summary ? await getDueReviews(prisma, userId, now, 1, summary.courseId) : [];
  return {
    memorization: summary ? { summary, next: bookNext, firstDue: bookDue[0] ? { passageId: bookDue[0].passageId, passageTitle: bookDue[0].passageTitle } : null } : null,
    ...latest,
  };
}

export const getHomeData = cache(async (userId: string, name: string): Promise<HomeData> => {
  const path = await getLearningPath(userId);
  const [weak, masteries, motivation] = await Promise.all([
    getWeakConcepts(userId),
    getMasteryByLesson(userId),
    getMotivation(prisma, userId),
  ]);
  const learningTarget = await getContinueTarget(userId, path, weak);
  const { memorization, memorizationAt, understandingAt } = await getHomeMemorization(userId, new Date());
  const resume =
    memorization?.next && shouldResumeMemorization({ understandingInProgress: Boolean(learningTarget?.inProgress), hasNext: true, memorizationAt, understandingAt });
  const target: ContinueTarget | null =
    resume && memorization?.next
      ? {
          stage: "MEMORIZE",
          href: memorizePassageHref(memorization.next.passageId),
          bookTitle: memorization.next.courseTitle,
          levelTitle: null,
          lesson: null,
          progressPct: memorization.summary.progressPct,
          detail: memorization.next.kind === "FIRST" ? "المقطع التالي" : "تثبيت المقطع",
          headline: `${memorization.next.sectionTitle} — ${memorization.next.passageTitle}`,
        }
      : learningTarget;
  const flat = flattenPath(path);
  const published = flat.filter((e) => e.lesson.status === "PUBLISHED");

  const assessed = masteries.flatMap((l) => l.concepts.filter((c) => c.state !== null));
  const mastery: MasterySummary = {
    mastered: assessed.filter((c) => c.state === "GOOD" || c.state === "MASTERED").length,
    learning: assessed.filter((c) => c.state === "LEARNING").length,
    needsReinforcement: assessed.filter((c) => c.state === "NEEDS_REINFORCEMENT").length,
  };

  const hasAnyActivity =
    assessed.length > 0 || motivation.streak.count > 0 || flat.some((e) => e.lesson.studied || e.lesson.completed) || (await prisma.assessmentSession.count({ where: { userId } })) > 0;

  const state = deriveHomeState({
    hasAnyActivity,
    hasContinueTarget: target !== null && target.stage !== "REVIEW",
    weakCount: weak.length,
    streakCount: motivation.streak.count,
    streakActiveToday: motivation.streak.activeToday,
    weekly: motivation.weekly,
  });

  return {
    firstName: firstNameOf(name),
    isSample: path.some((c) => c.isSample),
    target,
    state,
    motivation,
    mastery,
    weak,
    journey: buildJourney(path, learningTarget?.lesson?.id ?? null),
    completedLessons: published.filter((e) => e.lesson.completed).length,
    publishedLessons: published.length,
    quote: await getQuoteOfTheDay(prisma, motivation.today),
    memorization,
  };
});
