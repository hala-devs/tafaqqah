import { continueCtaLabel, type StageKey } from "@/lib/home-state";
import type { MasteryLevel } from "@/lib/mastery-levels";
import { memorizePassageHref, reviewHref } from "@/lib/routes";
import type { MemorizeNextStep } from "@/server/memorization/path-view";

/**
 * View model of /progress. Pure presentation over values that other modules already computed — no scoring, no
 * scheduling and no new mastery rule. Understanding and memorization are NEVER combined into one number.
 */

export type ConceptRow = { id: string; title: string; state: MasteryLevel | null };
export type ConceptGroups = { mastered: ConceptRow[]; learning: ConceptRow[]; reinforce: ConceptRow[]; unassessed: ConceptRow[] };

/** Same grouping as the home page and lesson result: «متقن» = GOOD or MASTERED; null = not assessed yet. */
export function groupConcepts(concepts: ConceptRow[]): ConceptGroups {
  return {
    mastered: concepts.filter((c) => c.state === "GOOD" || c.state === "MASTERED"),
    learning: concepts.filter((c) => c.state === "LEARNING"),
    reinforce: concepts.filter((c) => c.state === "NEEDS_REINFORCEMENT"),
    unassessed: concepts.filter((c) => c.state === null),
  };
}

/** The understanding continue target as computed by getContinueTarget (stage + where it leads). */
export type LearningTargetLike = { stage: StageKey; href: string; inProgress?: boolean } | null;

export type CardAction = { label: string; href: string } | null;

/** The understanding card's own action: start → test → resume test → reinforce; nothing when all is done. */
export function understandingAction(target: LearningTargetLike, hasActivity: boolean): CardAction {
  if (!target) return null;
  if (target.stage === "LEARN") return { label: hasActivity ? "ابدأ الدرس التالي" : "ابدأ من درسك الحالي", href: target.href };
  if (target.stage === "REVIEW") return { label: "راجع ما يحتاج إلى تثبيت", href: target.href };
  return { label: continueCtaLabel(target), href: target.href };
}

/** The memorization card's own action, from the same next step /memorize shows. */
export function memorizationAction(step: MemorizeNextStep): CardAction {
  switch (step.kind) {
    case "REVIEW":
      return { label: "راجع محفوظك", href: memorizePassageHref(step.passageId) };
    case "START":
      return { label: "ابدأ الحفظ", href: memorizePassageHref(step.passageId, step.startUnitId) };
    case "CONTINUE":
      return { label: "تابع الحفظ", href: memorizePassageHref(step.passageId, step.startUnitId) };
    case "REINFORCE":
      return { label: "ثبّت محفوظك", href: memorizePassageHref(step.passageId, step.startUnitId) };
    case "DONE":
      return null;
  }
}

export type HomeTargetLike = { stage: StageKey; href: string; inProgress?: boolean; headline?: string; lesson: { title: string } | null; detail: string | null; bookTitle: string } | null;

export type OverallNext = { journey: "UNDERSTANDING" | "MEMORIZATION"; title: string; text: string; label: string; href: string; tone: "ink" | "review" } | null;

/**
 * ONE recommended action. Priority (unchanged, shared with the home hero): the home continue target first — it already
 * prefers an open assessment, resumes memorization only when that was the latest activity, then the current lesson,
 * then weak-concept review. Only when it is empty does memorization's own next step (review first) take over.
 */
export function overallNext(home: HomeTargetLike, memo: { step: MemorizeNextStep; bookTitle: string } | null): OverallNext {
  if (home && home.stage !== "DONE") {
    const label = continueCtaLabel(home);
    if (home.stage === "MEMORIZE") return { journey: "MEMORIZATION", title: "تابع الحفظ من موضعك", text: home.headline ?? home.bookTitle, label, href: home.href, tone: "ink" };
    if (home.stage === "REVIEW") return { journey: "UNDERSTANDING", title: "ثبّت مفهومًا يحتاج إلى مراجعة", text: home.detail ?? "", label, href: home.href, tone: "review" };
    if (home.stage === "LEARN") return { journey: "UNDERSTANDING", title: `ابدأ ${home.lesson?.title ?? "درسك"}`, text: home.bookTitle, label, href: home.href, tone: "ink" };
    return { journey: "UNDERSTANDING", title: home.inProgress ? "تابع اختبار فهمك" : "اختبر فهمك", text: `${home.lesson?.title ?? ""}${home.lesson ? " — " : ""}${home.bookTitle}`, label, href: home.href, tone: "ink" };
  }
  if (memo) {
    const action = memorizationAction(memo.step);
    if (action && memo.step.kind !== "DONE") {
      const where = `${memo.step.sectionTitle} — ${memo.step.passageTitle}`;
      if (memo.step.kind === "REVIEW") return { journey: "MEMORIZATION", title: "راجع محفوظك", text: where, ...action, tone: "review" };
      return { journey: "MEMORIZATION", title: memo.step.kind === "START" ? `ابدأ حفظ ${memo.bookTitle}` : memo.step.kind === "CONTINUE" ? "تابع الحفظ من موضعك" : "ثبّت محفوظك", text: where, ...action, tone: "ink" };
    }
  }
  return null;
}

/** A weak concept's targeted review (the existing review flow). */
export function conceptReviewHref(lessonId: string, conceptId: string): string {
  return reviewHref(lessonId, conceptId);
}

/** The understanding journey has started once a lesson was studied, an assessment finished, or a concept assessed. */
export function understandingStarted(input: { studiedOrCompletedLessons: number; completedAttempts: number; groups: ConceptGroups }): boolean {
  const assessed = input.groups.mastered.length + input.groups.learning.length + input.groups.reinforce.length;
  return input.studiedOrCompletedLessons > 0 || input.completedAttempts > 0 || assessed > 0;
}
