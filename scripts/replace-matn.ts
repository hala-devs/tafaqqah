/**
 * Retires the previous Matn dataset of «أخصر المختصرات» and imports the corrected canonical source
 * (content/sources/akhsar-al-mukhtasarat-matn.md → content/matn-akhsar.structure.json) in ONE transaction.
 *
 * Scope of deletion — ONLY:
 *  - every MatnSection of the course (cascades to its MatnPassage and MatnUnit rows);
 *  - learner memorization rows that reference those passages/units (RecitationAttempt, RecitationUnitResult,
 *    MemorizationGoalCredit, MemorizationMastery), so no history points at retired text.
 * Never touched: users, sessions, MemorizationGoal settings, lessons, concepts, source passages, assessments,
 * AuditEvent history, AI logs.
 *
 * Every new row is DRAFT (approval only through /admin/matn). No AI provider is called.
 *
 * Usage: npm run content:replace-matn            (dry run: prints what would change, writes nothing)
 *        npm run content:replace-matn -- --apply
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { normalizeWhitespace } from "../src/server/memorization/canonical";
import { planImport, structureStats, verifyStructure, type MatnStructure } from "../src/server/memorization/matn-import";
import { canonicalMatnText, parseCanonicalMatn } from "../src/server/memorization/matn-source";

async function main() {
  const apply = process.argv.includes("--apply");
  const root = process.cwd();
  const canonical = parseCanonicalMatn(readFileSync(join(root, "content/sources/akhsar-al-mukhtasarat-matn.md"), "utf8"));
  const source = readFileSync(join(root, "content/matn-akhsar.source.txt"), "utf8");
  const structure = JSON.parse(readFileSync(join(root, "content/matn-akhsar.structure.json"), "utf8")) as MatnStructure;

  // Integrity gates before any database access.
  const verification = verifyStructure(source, structure);
  if (!verification.ok) throw new Error(`Structure does not reproduce the unit file: ${JSON.stringify(verification.firstMismatch)}`);
  const plan = planImport(structure);
  const plannedText = normalizeWhitespace(plan.flatMap((s) => s.passages.flatMap((p) => p.units.map((u) => u.text))).join(" "));
  if (plannedText !== canonicalMatnText(canonical)) throw new Error("Units do not reproduce the canonical source. Nothing changed.");
  const stats = structureStats(plan);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const batch = `akhsar-matn-rakaez-${new Date().toISOString().slice(0, 10)}`;

  try {
    const course = await db.course.findUnique({ where: { id: structure.courseId }, select: { id: true } });
    if (!course) throw new Error(`Course ${structure.courseId} is missing.`);

    const oldSections = await db.matnSection.findMany({ where: { courseId: course.id }, select: { id: true } });
    const allSections = await db.matnSection.count();
    if (allSections !== oldSections.length) throw new Error("Matn sections exist for another course; refusing to guess the scope.");
    const sectionIds = oldSections.map((s) => s.id);
    const passageIds = (await db.matnPassage.findMany({ where: { sectionId: { in: sectionIds } }, select: { id: true } })).map((p) => p.id);
    const unitIds = (await db.matnUnit.findMany({ where: { passageId: { in: passageIds } }, select: { id: true } })).map((u) => u.id);

    const affected = {
      sections: sectionIds.length,
      passages: passageIds.length,
      units: unitIds.length,
      approvedSections: await db.matnSection.count({ where: { id: { in: sectionIds }, status: "APPROVED" } }),
      approvedPassages: await db.matnPassage.count({ where: { id: { in: passageIds }, status: "APPROVED" } }),
      approvedUnits: await db.matnUnit.count({ where: { id: { in: unitIds }, status: "APPROVED" } }),
      recitationAttempts: await db.recitationAttempt.count({ where: { passageId: { in: passageIds } } }),
      recitationUnitResults: await db.recitationUnitResult.count({ where: { unitId: { in: unitIds } } }),
      goalCredits: await db.memorizationGoalCredit.count({ where: { unitId: { in: unitIds } } }),
      memorizationMastery: await db.memorizationMastery.count({ where: { passageId: { in: passageIds } } }),
    };
    const preserved = {
      memorizationGoals: await db.memorizationGoal.count(),
      matnAuditEvents: await db.auditEvent.count({ where: { action: { startsWith: "matn." } } }),
    };
    const planned = { sections: stats.sections, passages: stats.passages, units: stats.units };

    if (!apply) {
      console.log(JSON.stringify({ mode: "dry-run (nothing written)", willDelete: affected, willPreserve: preserved, willCreateAsDraft: planned }, null, 2));
      return;
    }

    const removed = await db.$transaction(
      async (tx) => {
        // Learner rows that reference retired units/passages first (RESTRICT relations), then the Matn itself.
        const goalCredits = await tx.memorizationGoalCredit.deleteMany({ where: { unitId: { in: unitIds } } });
        const unitResults = await tx.recitationUnitResult.deleteMany({ where: { unitId: { in: unitIds } } });
        const attempts = await tx.recitationAttempt.deleteMany({ where: { passageId: { in: passageIds } } });
        const mastery = await tx.memorizationMastery.deleteMany({ where: { passageId: { in: passageIds } } });
        const units = await tx.matnUnit.deleteMany({ where: { id: { in: unitIds } } });
        const passages = await tx.matnPassage.deleteMany({ where: { id: { in: passageIds } } });
        const sections = await tx.matnSection.deleteMany({ where: { id: { in: sectionIds } } });
        if (sections.count !== affected.sections || passages.count !== affected.passages || units.count !== affected.units) {
          throw new Error("Deleted row counts differ from the preflight; rolled back.");
        }

        for (const s of plan) {
          await tx.matnSection.create({
            data: { id: s.id, courseId: course.id, order: s.order, title: s.title, titleIsDerived: s.titleIsDerived, groupTitle: s.groupTitle, sourceHeading: s.sourceHeading, status: "DRAFT", importBatch: batch },
          });
          for (const p of s.passages) {
            await tx.matnPassage.create({ data: { id: p.id, sectionId: s.id, order: p.order, title: p.title, titleIsDerived: true, status: "DRAFT" } });
            await tx.matnUnit.createMany({
              data: p.units.map((u) => ({ id: u.id, passageId: p.id, order: u.order, canonicalText: u.text, reviewNotes: u.notes, status: "DRAFT" as const })),
            });
          }
        }
        return { sections: sections.count, passages: passages.count, units: units.count, goalCredits: goalCredits.count, unitResults: unitResults.count, attempts: attempts.count, mastery: mastery.count };
      },
      { timeout: 120_000 },
    );

    // Read back what is stored and prove it reproduces the canonical source exactly.
    const stored = await db.matnUnit.findMany({
      where: { passage: { section: { courseId: course.id } } },
      orderBy: [{ passage: { section: { order: "asc" } } }, { passage: { order: "asc" } }, { order: "asc" }],
      select: { canonicalText: true, status: true },
    });
    const storedText = normalizeWhitespace(stored.map((u) => u.canonicalText).join(" "));
    const totals = {
      sections: await db.matnSection.count(),
      passages: await db.matnPassage.count(),
      units: stored.length,
      approved: {
        sections: await db.matnSection.count({ where: { status: "APPROVED" } }),
        passages: await db.matnPassage.count({ where: { status: "APPROVED" } }),
        units: stored.filter((u) => u.status === "APPROVED").length,
      },
    };
    console.log(
      JSON.stringify(
        {
          mode: "applied",
          removed,
          preservedAfter: { memorizationGoals: await db.memorizationGoal.count(), matnAuditEvents: await db.auditEvent.count({ where: { action: { startsWith: "matn." } } }) },
          totalsInDatabase: totals,
          storedTextMatchesCanonical: storedText === canonicalMatnText(canonical),
          canonicalChars: canonicalMatnText(canonical).length,
          storedChars: storedText.length,
        },
        null,
        2,
      ),
    );
    if (storedText !== canonicalMatnText(canonical)) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
