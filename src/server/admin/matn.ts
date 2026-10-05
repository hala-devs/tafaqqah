import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { assertAdmin } from "@/server/auth/authorization";
import type { SessionUser } from "@/server/auth/session-store";
import { AppError } from "@/server/errors";
import { countArabicWords, detectSuspiciousTokens, normalizeWhitespace } from "@/server/memorization/canonical";
import { recordAudit } from "./audit";

type Actor = Pick<SessionUser, "id" | "role"> | null;

const idInput = z.object({ id: z.string().trim().min(1).max(100), approved: z.enum(["true", "false"]).transform((v) => v === "true"), cascade: z.enum(["true", "false"]).optional() });
const unitTextInput = z.object({ unitId: z.string().trim().min(1).max(100), text: z.string().max(2000) });

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export type MatnAdminUnit = { id: string; order: number; text: string; status: "DRAFT" | "APPROVED"; words: number; suspicious: string[]; notes: string[] };
export type MatnAdminPassage = { id: string; order: number; title: string; status: "DRAFT" | "APPROVED"; units: MatnAdminUnit[]; words: number };
export type MatnAdminSection = {
  id: string;
  order: number;
  title: string;
  titleIsDerived: boolean;
  groupTitle: string | null;
  sourceHeading: string | null;
  status: "DRAFT" | "APPROVED";
  passages: MatnAdminPassage[];
};

/** Everything an admin needs to review the segmentation: section → passage → unit number → canonical text. */
export async function getMatnOverview(db: PrismaClient, courseId?: string): Promise<{ courseTitle: string; sections: MatnAdminSection[] }[]> {
  const courses = await db.course.findMany({
    where: { matnSections: { some: {} }, ...(courseId ? { id: courseId } : {}) },
    orderBy: { order: "asc" },
    select: {
      title: true,
      matnSections: {
        orderBy: { order: "asc" },
        include: { passages: { orderBy: { order: "asc" }, include: { units: { orderBy: { order: "asc" } } } } },
      },
    },
  });
  return courses.map((c) => ({
    courseTitle: c.title,
    sections: c.matnSections.map((s) => ({
      id: s.id,
      order: s.order,
      title: s.title,
      titleIsDerived: s.titleIsDerived,
      groupTitle: s.groupTitle,
      sourceHeading: s.sourceHeading,
      status: s.status,
      passages: s.passages.map((p) => {
        const units = p.units.map((u) => ({
          id: u.id,
          order: u.order,
          text: u.canonicalText,
          status: u.status,
          words: countArabicWords(u.canonicalText),
          suspicious: detectSuspiciousTokens(u.canonicalText),
          notes: u.reviewNotes,
        }));
        return { id: p.id, order: p.order, title: p.title, status: p.status, units, words: units.reduce((n, u) => n + u.words, 0) };
      }),
    })),
  }));
}

type PassageWithUnits = { id: string; title: string; units: { id: string; order: number; canonicalText: string }[] };

/** A passage can be approved only when it has units and none contains an unresolved suspicious token. */
function assertApprovable(passage: PassageWithUnits) {
  if (passage.units.length === 0) throw new AppError("BAD_REQUEST", `المقطع «${passage.title}» لا يحتوي وحدات، فلا يمكن اعتماده.`);
  for (const u of passage.units) {
    if (u.canonicalText.trim().length === 0) throw new AppError("BAD_REQUEST", `الوحدة ${u.order} في «${passage.title}» فارغة.`);
    const bad = detectSuspiciousTokens(u.canonicalText);
    if (bad.length) {
      throw new AppError("BAD_REQUEST", `الوحدة ${u.order} في «${passage.title}» تحتوي رمزًا مشبوهًا (${bad.join(" ")}). حرّر النص بعد المراجعة ثم اعتمد.`);
    }
  }
}

async function approvePassageRows(db: PrismaClient, actor: { id: string }, passage: PassageWithUnits, now: Date) {
  assertApprovable(passage);
  for (const u of passage.units) {
    await db.matnUnit.update({ where: { id: u.id }, data: { status: "APPROVED", approvedAt: now, approvedById: actor.id, approvedTextHash: hash(u.canonicalText) } });
  }
  await db.matnPassage.update({ where: { id: passage.id }, data: { status: "APPROVED", approvedAt: now, approvedById: actor.id } });
}

async function revokePassageRows(db: PrismaClient, passageId: string) {
  await db.matnUnit.updateMany({ where: { passageId }, data: { status: "DRAFT", approvedAt: null, approvedById: null, approvedTextHash: null } });
  await db.matnPassage.update({ where: { id: passageId }, data: { status: "DRAFT", approvedAt: null, approvedById: null } });
}

/**
 * Approves or revokes ONE passage with all of its units (units are approved only through their passage).
 * Approving also approves the parent section container so the passage becomes reachable.
 */
export async function setMatnPassageApproval(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = idInput.parse(raw);
  const passage = await db.matnPassage.findUnique({
    where: { id: input.id },
    include: { units: { orderBy: { order: "asc" }, select: { id: true, order: true, canonicalText: true } }, section: { select: { id: true, status: true, title: true } } },
  });
  if (!passage) throw new AppError("NOT_FOUND", "المقطع غير موجود.");
  const now = new Date();

  if (input.approved) {
    await approvePassageRows(db, actor, passage, now);
    if (passage.section.status !== "APPROVED") {
      await db.matnSection.update({ where: { id: passage.section.id }, data: { status: "APPROVED", approvedAt: now, approvedById: actor.id } });
      await recordAudit(db, actor, { action: "matn.section_approved", entityType: "matn_section", entityId: passage.section.id, summary: `اعتماد القسم «${passage.section.title}» تبعًا لاعتماد مقطعه`, metadata: { via: "passage" } });
    }
  } else {
    await revokePassageRows(db, passage.id);
  }
  await recordAudit(db, actor, {
    action: input.approved ? "matn.passage_approved" : "matn.passage_revoked",
    entityType: "matn_passage",
    entityId: passage.id,
    summary: `${input.approved ? "اعتماد" : "إلغاء اعتماد"} المقطع «${passage.title}» (${passage.units.length} وحدات)`,
    metadata: { units: passage.units.length },
  });
}

/** Approves/revokes a section container; with cascade=true it also (un)approves every passage and unit inside it. */
export async function setMatnSectionApproval(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = idInput.parse(raw);
  const section = await db.matnSection.findUnique({
    where: { id: input.id },
    include: { passages: { orderBy: { order: "asc" }, include: { units: { orderBy: { order: "asc" }, select: { id: true, order: true, canonicalText: true } } } } },
  });
  if (!section) throw new AppError("NOT_FOUND", "القسم غير موجود.");
  const cascade = input.cascade === "true";
  const now = new Date();

  if (input.approved) {
    if (cascade) {
      // Validate everything first so a bad unit leaves the section untouched.
      for (const p of section.passages) assertApprovable(p);
      for (const p of section.passages) await approvePassageRows(db, actor, p, now);
    }
    await db.matnSection.update({ where: { id: section.id }, data: { status: "APPROVED", approvedAt: now, approvedById: actor.id } });
  } else {
    if (cascade) for (const p of section.passages) await revokePassageRows(db, p.id);
    await db.matnSection.update({ where: { id: section.id }, data: { status: "DRAFT", approvedAt: null, approvedById: null } });
  }
  await recordAudit(db, actor, {
    action: input.approved ? "matn.section_approved" : "matn.section_revoked",
    entityType: "matn_section",
    entityId: section.id,
    summary: `${input.approved ? "اعتماد" : "إلغاء اعتماد"} القسم «${section.title}»${cascade ? " مع مقاطعه" : ""}`,
    metadata: { cascade, passages: section.passages.length },
  });
}

/**
 * Human edit of one unit's canonical text (e.g. to resolve a flagged token). It revokes the unit's approval, which hides
 * its whole passage from learners until the passage is approved again. Only an admin can do this — never AI, never a learner.
 */
export async function updateMatnUnitText(db: PrismaClient, actor: Actor, raw: unknown) {
  assertAdmin(actor);
  const input = unitTextInput.parse(raw);
  const text = normalizeWhitespace(input.text);
  if (text.length === 0) throw new AppError("BAD_REQUEST", "نص الوحدة لا يمكن أن يكون فارغًا.");
  const unit = await db.matnUnit.findUnique({ where: { id: input.unitId }, include: { passage: { select: { id: true, title: true } } } });
  if (!unit) throw new AppError("NOT_FOUND", "الوحدة غير موجودة.");
  if (unit.canonicalText === text) return;
  await db.matnUnit.update({ where: { id: unit.id }, data: { canonicalText: text, status: "DRAFT", approvedAt: null, approvedById: null, approvedTextHash: null } });
  await recordAudit(db, actor, {
    action: "matn.unit_edited",
    entityType: "matn_unit",
    entityId: unit.id,
    summary: `تعديل نص الوحدة ${unit.order} في «${unit.passage.title}» (أُلغي اعتمادها)`,
    metadata: { before: unit.canonicalText, after: text, passageId: unit.passage.id },
  });
}
