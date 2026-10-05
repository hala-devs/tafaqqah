/**
 * Exports the HUMAN-APPROVED content of a Tafaqqah database into prisma/seed-data/release-content.json, so a fresh
 * install (`npm run db:seed`, Docker) shows exactly the content a person already approved in /admin.
 *
 * Read-only against the source database. Nothing is approved here: only rows that are already approved/published are
 * exported, text is copied byte-for-byte, and provenance fields are kept. Never exported: users, approver ids, learner
 * attempts, sessions, AI logs, generated questions, sample/demo rows (those come from seed-data/curriculum.ts).
 *
 * Usage: DATABASE_URL=<source db> npx tsx scripts/export-release-content.ts
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const OUT = "prisma/seed-data/release-content.json";
const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function main() {
  // Understanding journey: published, non-sample lessons with ALL of their passages approved by a person.
  const lessons = await db.lesson.findMany({
    where: { status: "PUBLISHED", isSample: false },
    orderBy: { id: "asc" },
    include: {
      chapter: true,
      concepts: { orderBy: [{ order: "asc" }, { id: "asc" }] },
      passages: { orderBy: [{ order: "asc" }, { id: "asc" }] },
      fixedQuestions: { where: { approved: true }, orderBy: [{ order: "asc" }, { id: "asc" }] },
    },
  });
  const exported = lessons.filter((l) => l.passages.length > 0 && l.passages.every((p) => p.approved));
  for (const l of lessons) if (!exported.includes(l)) console.warn(`skip ${l.id}: not every passage is approved`);

  const chapters = [...new Map(exported.map((l) => [l.chapter.id, l.chapter])).values()].sort((a, b) => a.id.localeCompare(b.id)).map((c) => ({ id: c.id, courseId: c.courseId, title: c.title, description: c.description, order: c.order }));

  // Memorization journey: approved Matn rows only (a passage is shown to learners only when it and all its units are approved).
  const sections = await db.matnSection.findMany({
    where: { status: "APPROVED" },
    orderBy: [{ courseId: "asc" }, { order: "asc" }, { id: "asc" }],
    include: { passages: { where: { status: "APPROVED" }, orderBy: [{ order: "asc" }, { id: "asc" }], include: { units: { where: { status: "APPROVED" }, orderBy: [{ order: "asc" }, { id: "asc" }] } } } },
  });
  const quotes = await db.quote.findMany({ where: { approved: true }, orderBy: { id: "asc" } });

  const snapshot = {
    format: "tafaqqah-release-content/v1",
    note: "Human-approved content exported from a Tafaqqah database. Do not edit by hand; re-export after approving in /admin.",
    lessons: exported.map((l) => ({
      id: l.id,
      chapterId: l.chapterId,
      title: l.title,
      description: l.description,
      objectives: l.objectives,
      order: l.order,
      status: l.status,
      isSample: l.isSample,
      estimatedMinutes: l.estimatedMinutes,
      measurementEnabled: l.measurementEnabled,
      pdfOnlyUntimedText: l.pdfOnlyUntimedText,
      pdfOnlyUntimedNote: l.pdfOnlyUntimedNote,
      concepts: l.concepts.map((c) => ({
        id: c.id, title: c.title, description: c.description, order: c.order,
        videoUrl: c.videoUrl, videoStartSecond: c.videoStartSecond, videoEndSecond: c.videoEndSecond,
        videoApproved: c.videoApproved, videoApprovedAt: iso(c.videoApprovedAt),
      })),
      passages: l.passages.map((p) => ({
        id: p.id, conceptId: p.conceptId, text: p.text, rawBahethText: p.rawBahethText, reviewText: p.reviewText, rawPdfText: p.rawPdfText,
        pdfSource: p.pdfSource, pdfPageStart: p.pdfPageStart, pdfPageEnd: p.pdfPageEnd, bahethUrl: p.bahethUrl, videoUrl: p.videoUrl,
        alignmentStatus: p.alignmentStatus, alignmentConfidence: p.alignmentConfidence, humanReviewRequired: p.humanReviewRequired, alignmentDetails: p.alignmentDetails,
        sourceTitle: p.sourceTitle, sourceAuthor: p.sourceAuthor, sourceReference: p.sourceReference, sourceUrl: p.sourceUrl,
        startSecond: p.startSecond, endSecond: p.endSecond, edition: p.edition, license: p.license, permissionNote: p.permissionNote,
        version: p.version, approved: p.approved, approvedAt: iso(p.approvedAt), approvedTextHash: p.approvedTextHash, isSample: p.isSample, order: p.order,
      })),
      fixedQuestions: l.fixedQuestions.map((q) => ({
        id: q.id, conceptId: q.conceptId, sourcePassageId: q.sourcePassageId, questionType: q.questionType, question: q.question,
        options: q.options, correctIndex: q.correctIndex, explanation: q.explanation, difficulty: q.difficulty, order: q.order, approved: q.approved, isSample: q.isSample,
      })),
    })),
    chapters,
    matnSections: sections.map((s) => ({
      id: s.id, courseId: s.courseId, order: s.order, title: s.title, titleIsDerived: s.titleIsDerived, groupTitle: s.groupTitle, sourceHeading: s.sourceHeading,
      status: s.status, approvedAt: iso(s.approvedAt), importBatch: s.importBatch,
      passages: s.passages.map((p) => ({
        id: p.id, order: p.order, title: p.title, titleIsDerived: p.titleIsDerived, status: p.status, approvedAt: iso(p.approvedAt),
        units: p.units.map((u) => ({ id: u.id, order: u.order, canonicalText: u.canonicalText, status: u.status, reviewNotes: u.reviewNotes, approvedAt: iso(u.approvedAt), approvedTextHash: u.approvedTextHash })),
      })),
    })),
    quotes: quotes.map((q) => ({ id: q.id, text: q.text, author: q.author, source: q.source, approved: q.approved, approvedAt: iso(q.approvedAt) })),
  };
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
  const units = snapshot.matnSections.reduce((n, s) => n + s.passages.reduce((m, p) => m + p.units.length, 0), 0);
  console.log(`✔ ${OUT}: ${snapshot.lessons.length} lesson(s), ${snapshot.matnSections.length} Matn section(s), ${units} unit(s), ${quotes.length} quote(s).`);
}

main().finally(() => db.$disconnect());
