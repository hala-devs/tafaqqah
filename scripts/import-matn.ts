/**
 * Imports the structured Matn of «أخصر المختصرات» as DRAFT (never approved, never visible to learners).
 *
 * Input: content/matn-akhsar.source.txt (canonical wording) + content/matn-akhsar.structure.json (proposed segmentation).
 * Safety:
 *  - aborts unless the units reproduce the source wording word for word (see verifyStructure);
 *  - every created row is DRAFT; approval only happens through the admin console (/admin/matn);
 *  - idempotent (deterministic ids). A re-run never changes the approval of an unchanged row; a changed unit text
 *    resets that unit to DRAFT and clears its approval;
 *  - removes superseded DRAFT rows only when they have no learner references; approved or referenced rows abort;
 *  - never calls an AI provider.
 *
 * Usage: npm run content:import-matn
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { planImport, structureStats, verifyStructure, type MatnStructure } from "../src/server/memorization/matn-import";

async function main() {
  const root = process.cwd();
  const source = readFileSync(join(root, "content/matn-akhsar.source.txt"), "utf8");
  const structure = JSON.parse(readFileSync(join(root, "content/matn-akhsar.structure.json"), "utf8")) as MatnStructure;

  const verification = verifyStructure(source, structure);
  if (!verification.ok) {
    throw new Error(`The structure does not reproduce the source wording (first mismatch: ${JSON.stringify(verification.firstMismatch)}). Nothing imported.`);
  }
  const plan = planImport(structure);
  const stats = structureStats(plan);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const batch = `akhsar-matn-${new Date().toISOString().slice(0, 10)}`;

  try {
    const course = await db.course.findUnique({ where: { id: structure.courseId } });
    if (!course) throw new Error(`Course ${structure.courseId} is missing.`);

    const created = { sections: 0, passages: 0, units: 0 };
    let textChanged = 0;
    const plannedSectionIds = new Set(plan.map((section) => section.id));
    const plannedPassageIds = new Set(plan.flatMap((section) => section.passages.map((passage) => passage.id)));

    // Remove an earlier OCR segmentation only when it is entirely DRAFT and has no learner references.
    // This preflight happens before upserts because `courseId + order` is unique at the section level.
    const stalePassages = await db.matnPassage.findMany({
      where: { section: { courseId: course.id, id: { startsWith: "matn-akhsar-" } }, id: { notIn: [...plannedPassageIds] } },
      include: { attempts: { select: { id: true } }, mastery: { select: { id: true } }, units: { include: { results: { select: { id: true } } } } },
    });
    for (const passage of stalePassages) {
      const referenced = passage.attempts.length > 0 || passage.mastery.length > 0 || passage.units.some((unit) => unit.results.length > 0);
      if (passage.status !== "DRAFT" || referenced || passage.units.some((unit) => unit.status !== "DRAFT")) {
        throw new Error(`Superseded passage ${passage.id} is approved or referenced; it was not overwritten.`);
      }
      await db.matnPassage.delete({ where: { id: passage.id } });
    }
    const staleSections = await db.matnSection.findMany({ where: { courseId: course.id, id: { startsWith: "matn-akhsar-", notIn: [...plannedSectionIds] } }, include: { passages: { select: { id: true } } } });
    for (const section of staleSections) {
      if (section.status !== "DRAFT" || section.passages.length > 0) throw new Error(`Superseded section ${section.id} is approved or still contains passages; it was not overwritten.`);
      await db.matnSection.delete({ where: { id: section.id } });
    }

    // Older imports did not always use the deterministic id prefix. Identify only the known raw-extraction
    // shape before deleting it; an unrelated draft Matn is never a replacement candidate.
    const legacyRawSections = await db.matnSection.findMany({
      where: {
        courseId: course.id,
        id: { notIn: [...plannedSectionIds] },
        passages: { some: { units: { some: { OR: [{ canonicalText: { contains: "svgsvgsvg" } }, { canonicalText: { startsWith: "2 -" } }] } } } },
      },
      include: { passages: { include: { attempts: { select: { id: true } }, mastery: { select: { id: true } }, units: { include: { results: { select: { id: true } } } } } } },
    });
    for (const section of legacyRawSections) {
      const referenced = section.passages.some((passage) => passage.attempts.length > 0 || passage.mastery.length > 0 || passage.units.some((unit) => unit.results.length > 0));
      const allDraft = section.status === "DRAFT" && section.passages.every((passage) => passage.status === "DRAFT" && passage.units.every((unit) => unit.status === "DRAFT"));
      if (!allDraft || referenced) throw new Error(`Legacy raw section ${section.id} is approved or referenced; it was not overwritten.`);
      await db.matnSection.delete({ where: { id: section.id } });
    }

    for (const s of plan) {
      const sectionData = { title: s.title, titleIsDerived: s.titleIsDerived, groupTitle: s.groupTitle, sourceHeading: s.sourceHeading, order: s.order };
      const existingSection = await db.matnSection.findUnique({ where: { id: s.id } });
      if (existingSection) await db.matnSection.update({ where: { id: s.id }, data: sectionData });
      else {
        await db.matnSection.create({ data: { id: s.id, courseId: course.id, status: "DRAFT", importBatch: batch, ...sectionData } });
        created.sections += 1;
      }

      for (const p of s.passages) {
        const passageData = { title: p.title, order: p.order, titleIsDerived: true };
        const existingPassage = await db.matnPassage.findUnique({ where: { id: p.id } });
        if (existingPassage) await db.matnPassage.update({ where: { id: p.id }, data: passageData });
        else {
          await db.matnPassage.create({ data: { id: p.id, sectionId: s.id, status: "DRAFT", ...passageData } });
          created.passages += 1;
        }

        for (const u of p.units) {
          const existing = await db.matnUnit.findUnique({ where: { id: u.id } });
          if (!existing) {
            await db.matnUnit.create({ data: { id: u.id, passageId: p.id, order: u.order, canonicalText: u.text, reviewNotes: u.notes, status: "DRAFT" } });
            created.units += 1;
          } else if (existing.canonicalText !== u.text) {
            await db.matnUnit.update({
              where: { id: u.id },
              data: { canonicalText: u.text, reviewNotes: u.notes, order: u.order, status: "DRAFT", approvedAt: null, approvedById: null, approvedTextHash: null },
            });
            textChanged += 1;
          } else {
            await db.matnUnit.update({ where: { id: u.id }, data: { reviewNotes: u.notes, order: u.order } });
          }
        }

        // A reviewed passage may have fewer line-units than the raw OCR segmentation it replaces.
        // Remove only leftover DRAFT units with no learner result; otherwise fail closed.
        const staleUnits = await db.matnUnit.findMany({
          where: { passageId: p.id, id: { notIn: p.units.map((unit) => unit.id) } },
          include: { results: { select: { id: true } } },
        });
        for (const unit of staleUnits) {
          if (unit.status !== "DRAFT" || unit.results.length > 0) throw new Error(`Superseded unit ${unit.id} is approved or referenced; it was not overwritten.`);
          await db.matnUnit.delete({ where: { id: unit.id } });
        }
      }
    }

    const totals = {
      sections: await db.matnSection.count({ where: { courseId: course.id } }),
      passages: await db.matnPassage.count({ where: { section: { courseId: course.id } } }),
      units: await db.matnUnit.count({ where: { passage: { section: { courseId: course.id } } } }),
      approvedUnits: await db.matnUnit.count({ where: { status: "APPROVED", passage: { section: { courseId: course.id } } } }),
    };
    console.log(JSON.stringify({ imported: created, textChangedAndResetToDraft: textChanged, removedSupersededDraftPassages: stalePassages.length, removedLegacyRawSections: legacyRawSections.length, planned: { sections: stats.sections, passages: stats.passages, units: stats.units }, totalsInDatabase: totals }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
