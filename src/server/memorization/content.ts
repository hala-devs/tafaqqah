import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { countArabicWords } from "./canonical";
import type { MemorizationStateKey } from "./config";

/**
 * Learner-facing reads of the Matn. Fail closed: a passage is visible only when the passage AND its section are
 * APPROVED, it has at least one unit, and EVERY one of its units is APPROVED. Drafts, partly-approved passages and
 * empty passages never reach a learner. Nothing here writes — canonical text is never mutated by a learner flow.
 */
export const visiblePassageWhere: Prisma.MatnPassageWhereInput = {
  status: "APPROVED",
  section: { status: "APPROVED" },
  units: { some: {}, none: { status: { not: "APPROVED" } } },
};

export type PassageCard = {
  id: string;
  title: string;
  order: number;
  unitCount: number;
  wordCount: number;
  state: MemorizationStateKey | null;
  masteryScore: number | null;
  attempts: number;
  nextReviewAt: Date | null;
  due: boolean;
};

export type SectionCard = {
  id: string;
  title: string;
  titleIsDerived: boolean;
  groupTitle: string | null;
  order: number;
  passages: PassageCard[];
  masteredPassages: number;
  attemptedPassages: number;
  dueCount: number;
};

export type BookHome = {
  course: { id: string; title: string; description: string };
  sections: SectionCard[];
};

async function visibleSections(db: PrismaClient, userId: string, courseId: string, now: Date, onlySectionId?: string): Promise<SectionCard[]> {
  const sections = await db.matnSection.findMany({
    where: { courseId, status: "APPROVED", ...(onlySectionId ? { id: onlySectionId } : {}) },
    orderBy: { order: "asc" },
    include: {
      passages: {
        where: visiblePassageWhere,
        orderBy: { order: "asc" },
        include: {
          units: { select: { canonicalText: true } },
          mastery: { where: { userId } },
        },
      },
    },
  });
  return sections
    .filter((s) => s.passages.length > 0)
    .map((s) => {
      const passages: PassageCard[] = s.passages.map((p) => {
        const m = p.mastery[0] ?? null;
        return {
          id: p.id,
          title: p.title,
          order: p.order,
          unitCount: p.units.length,
          wordCount: p.units.reduce((n, u) => n + countArabicWords(u.canonicalText), 0),
          state: m?.state ?? null,
          masteryScore: m?.masteryScore ?? null,
          attempts: m?.attempts ?? 0,
          nextReviewAt: m?.nextReviewAt ?? null,
          due: m ? m.nextReviewAt.getTime() <= now.getTime() : false,
        };
      });
      return {
        id: s.id,
        title: s.title,
        titleIsDerived: s.titleIsDerived,
        groupTitle: s.groupTitle,
        order: s.order,
        passages,
        masteredPassages: passages.filter((p) => p.state === "MASTERED").length,
        attemptedPassages: passages.filter((p) => p.attempts > 0).length,
        dueCount: passages.filter((p) => p.due).length,
      };
    });
}

/** Books that have at least one approved, visible passage. */
export async function listMemorizationBooks(db: PrismaClient): Promise<{ id: string; title: string; description: string }[]> {
  const courses = await db.course.findMany({
    where: { matnSections: { some: { status: "APPROVED", passages: { some: visiblePassageWhere } } } },
    orderBy: { order: "asc" },
    select: { id: true, title: true, description: true },
  });
  return courses;
}

export async function getBookHome(db: PrismaClient, userId: string, courseId: string, now: Date = new Date()): Promise<BookHome | null> {
  const course = await db.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, description: true } });
  if (!course) return null;
  const sections = await visibleSections(db, userId, courseId, now);
  if (sections.length === 0) return null;
  return { course, sections };
}

export async function getSectionView(db: PrismaClient, userId: string, sectionId: string, now: Date = new Date()) {
  const row = await db.matnSection.findUnique({ where: { id: sectionId }, select: { courseId: true, course: { select: { id: true, title: true } } } });
  if (!row) return null;
  const [section] = await visibleSections(db, userId, row.courseId, now, sectionId);
  return section ? { course: row.course, section } : null;
}

export type PassageStart = {
  id: string;
  title: string;
  section: { id: string; title: string; groupTitle: string | null };
  course: { id: string; title: string };
  unitCount: number;
  wordCount: number;
  state: MemorizationStateKey | null;
  masteryScore: number | null;
  attempts: number;
  lastScore: number | null;
  nextReviewAt: Date | null;
  due: boolean;
  previousDetails: { unitId: string; status: "INCORRECT" | "FORGOTTEN"; scope: "WORDS" | "FULL_UNIT" | null; wordIndexes: number[]; forgottenWordIndexes: number[] }[];
  /** Selection metadata only; canonical text is returned only after a STUDY selection. */
  units: { id: string; order: number; wordCount: number }[];
};

/** Everything the start screen needs — deliberately WITHOUT the canonical text, which is revealed only after recitation. */
export async function getPassageStart(db: PrismaClient, userId: string, passageId: string, now: Date = new Date()): Promise<PassageStart | null> {
  const p = await db.matnPassage.findFirst({
    where: { id: passageId, ...visiblePassageWhere },
    include: {
      section: { select: { id: true, title: true, groupTitle: true, course: { select: { id: true, title: true } } } },
      units: { orderBy: { order: "asc" }, select: { id: true, order: true, canonicalText: true } },
      mastery: { where: { userId } },
      attempts: { where: { userId }, orderBy: { completedAt: "desc" }, take: 1, select: { results: { where: { selfAssessmentStatus: { not: "CORRECT" } }, select: { unitId: true, selfAssessmentStatus: true, selfAssessmentScope: true, wordIndexes: true, forgottenWordIndexes: true } } } },
    },
  });
  if (!p) return null;
  const m = p.mastery[0] ?? null;
  return {
    id: p.id,
    title: p.title,
    section: { id: p.section.id, title: p.section.title, groupTitle: p.section.groupTitle },
    course: p.section.course,
    unitCount: p.units.length,
    wordCount: p.units.reduce((n, u) => n + countArabicWords(u.canonicalText), 0),
    state: m?.state ?? null,
    masteryScore: m?.masteryScore ?? null,
    attempts: m?.attempts ?? 0,
    lastScore: m?.lastScore ?? null,
    nextReviewAt: m?.nextReviewAt ?? null,
    due: m ? m.nextReviewAt.getTime() <= now.getTime() : false,
    previousDetails: (p.attempts[0]?.results ?? []).map((result) => ({ unitId: result.unitId, status: result.selfAssessmentStatus as "INCORRECT" | "FORGOTTEN", scope: result.selfAssessmentScope, wordIndexes: result.wordIndexes, forgottenWordIndexes: result.forgottenWordIndexes })),
    units: p.units.map((u) => ({ id: u.id, order: u.order, wordCount: countArabicWords(u.canonicalText) })),
  };
}

export type RevealedUnit = { id: string; order: number; text: string };

export const MAX_MEMORIZATION_SESSION_UNITS = 20;

type SessionUnit = RevealedUnit & { passageId: string };

/**
 * Resolves consecutive approved units from one canonical Matn book. A hidden, partial, or draft passage is a hard
 * boundary: it is never skipped, which keeps the returned sequence contiguous in canonical order.
 */
async function sessionUnitsFrom(db: PrismaClient, passageId: string, startUnitId: string): Promise<SessionUnit[] | null> {
  const startPassage = await db.matnPassage.findFirst({
    where: { id: passageId, ...visiblePassageWhere },
    select: { section: { select: { courseId: true } } },
  });
  if (!startPassage) return null;

  const sections = await db.matnSection.findMany({
    where: { courseId: startPassage.section.courseId },
    orderBy: { order: "asc" },
    select: {
      status: true,
      passages: {
        orderBy: { order: "asc" },
        select: { id: true, status: true, units: { orderBy: { order: "asc" }, select: { id: true, order: true, canonicalText: true, status: true } } },
      },
    },
  });

  const canonicalPassages = sections.flatMap((section) => section.passages.map((passage) => ({ ...passage, sectionStatus: section.status })));
  const startPassageIndex = canonicalPassages.findIndex((passage) => passage.id === passageId);
  const startUnitIndex = canonicalPassages[startPassageIndex]?.units.findIndex((unit) => unit.id === startUnitId) ?? -1;
  if (startPassageIndex < 0 || startUnitIndex < 0) return null;

  const eligible = (passage: (typeof canonicalPassages)[number]) =>
    passage.sectionStatus === "APPROVED" && passage.status === "APPROVED" && passage.units.length > 0 && passage.units.every((unit) => unit.status === "APPROVED");
  if (!eligible(canonicalPassages[startPassageIndex]!)) return null;

  const units: SessionUnit[] = [];
  for (let passageIndex = startPassageIndex; passageIndex < canonicalPassages.length; passageIndex++) {
    const passage = canonicalPassages[passageIndex]!;
    if (!eligible(passage)) break;
    const from = passageIndex === startPassageIndex ? startUnitIndex : 0;
    units.push(...passage.units.slice(from).map((unit) => ({ id: unit.id, order: unit.order, text: unit.canonicalText, passageId: passage.id })));
  }
  return units;
}

/** The number of eligible consecutive units remaining from a valid start, without exposing canonical text to setup UI. */
export async function getMemorizationSessionAvailability(db: PrismaClient, passageId: string, startUnitId: string): Promise<number | null> {
  const units = await sessionUnitsFrom(db, passageId, startUnitId);
  return units?.length ?? null;
}

/** Server-authoritative session selection: 1–20 canonical, approved, consecutive units in the current book only. */
export async function getMemorizationSessionUnits(db: PrismaClient, passageId: string, startUnitId: string, count: number): Promise<RevealedUnit[] | null> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_MEMORIZATION_SESSION_UNITS) return null;
  const units = await sessionUnitsFrom(db, passageId, startUnitId);
  if (!units || count > units.length) return null;
  return units.slice(0, count).map(({ id, order, text }) => ({ id, order, text }));
}

/** The approved canonical units of a visible passage, in order. Called only after the learner has finished recording. */
export async function getPassageUnits(db: PrismaClient, passageId: string, selectedUnitIds?: string[]): Promise<RevealedUnit[] | null> {
  const p = await db.matnPassage.findFirst({
    where: { id: passageId, ...visiblePassageWhere },
    select: { units: { orderBy: { order: "asc" }, select: { id: true, order: true, canonicalText: true } } },
  });
  if (!p) return null;
  if (!selectedUnitIds) return p.units.map((u) => ({ id: u.id, order: u.order, text: u.canonicalText }));
  if (selectedUnitIds.length === 0 || new Set(selectedUnitIds).size !== selectedUnitIds.length) return null;
  const selected = new Set(selectedUnitIds);
  const positions = p.units.map((u, index) => (selected.has(u.id) ? index : -1)).filter((index) => index >= 0);
  if (positions.length !== selectedUnitIds.length || positions.at(-1)! - positions[0]! + 1 !== positions.length) return null;
  return p.units.filter((u) => selected.has(u.id)).map((u) => ({ id: u.id, order: u.order, text: u.canonicalText }));
}

/**
 * Canonical order of a learner's recitation results. `MatnUnit.order` is local to its passage, and a session may run
 * across passages, so results are ordered by section → passage → unit (a session never leaves its book).
 */
export const canonicalResultOrder = [
  { unit: { passage: { section: { order: "asc" } } } },
  { unit: { passage: { order: "asc" } } },
  { unit: { order: "asc" } },
] satisfies Prisma.RecitationUnitResultOrderByWithRelationInput[];
