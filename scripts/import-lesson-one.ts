/**
 * Imports the owner-supplied timestamped transcript for the first real lesson.
 *
 * This script deliberately does not contain the transcript or fetch any remote URL.
 * It accepts a local owner-supplied source file, preserves its concept-scoped text,
 * and creates only unapproved content. Run it again safely: unchanged text preserves
 * an existing human approval; changed text revokes it for review.
 *
 * Usage:
 *   npx tsx scripts/import-lesson-one.ts --input C:\path\to\transcript.txt --confirm-owner-supplied
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const VIDEO_URL = "https://youtu.be/FdxZylJyi-w";
const TRANSCRIPT_URL =
  "https://baheth.ieasybooks.com/ar/media/%D8%B4%D8%B1%D8%AD-%D8%A3%D8%AE%D8%B5%D8%B1-%D8%A7%D9%84%D9%85%D8%AE%D8%AA%D8%B5%D8%B1%D8%A7%D8%AA-1-%D8%A7%D9%84%D8%B4%D9%8A%D8%AE-%D9%85%D8%AD%D9%85%D8%AF-%D8%A8%D8%A7%D8%AC%D8%A7%D8%A8%D8%B1";
const PATH_ID = "path-hanbali-fiqh";
const LEVEL_ID = "path-hanbali-fiqh-level-1";
const COURSE_ID = "course-hanbali-path";
const CHAPTER_ID = "chapter-akhsar-lesson-one";
const LESSON_ID = "lesson-akhsar-01";
const HUMAN_REVIEW =
  "HUMAN_REVIEW_REQUIRED: تفريغ آلي مورّد من مالك المشروع؛ راجع ألفاظ التفريغ وارتباط الفيديو قبل اعتماد النص أو التوقيت.";

type ConceptSpec = { order: number; title: string; start: number; end: number };

const concepts: ConceptSpec[] = [
  { order: 1, title: "تعريف الفقه وموضوع الدورة", start: 46, end: 135 },
  { order: 2, title: "التدرج في طلب العلم", start: 136, end: 324 },
  { order: 3, title: "منهج شرح المختصر", start: 325, end: 373 },
  { order: 4, title: "وصايا ابن بدران في طرق التعلم", start: 374, end: 623 },
  { order: 5, title: "التمذهب وطريق المبتدئ", start: 624, end: 809 },
  { order: 6, title: "دراسة المتن وأهمية المراجعة", start: 810, end: 1045 },
  { order: 7, title: "التعريف بأخصر المختصرات ومؤلفه", start: 1046, end: 1215 },
  { order: 8, title: "منهج شرح الكتاب ومصطلحات المذهب", start: 1216, end: 1348 },
  { order: 9, title: "خطبة المصنف ومقصد الكتاب", start: 1349, end: 1539 },
  { order: 10, title: "كتاب الطهارة: تعريف الطهارة والحدث", start: 1540, end: 1902 },
  { order: 11, title: "أقسام المياه: الماء الطهور", start: 1903, end: 2102 },
  { order: 12, title: "تغير الماء: المجاور والممازج وغير الممازج", start: 2103, end: 2321 },
];

function seconds(marker: string) {
  const [minutes, seconds] = marker.split(":").map(Number);
  return minutes * 60 + seconds;
}

function stamp(value: number) {
  const minutes = Math.floor(value / 60);
  return `${String(minutes).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function readArgs() {
  const inputIndex = process.argv.indexOf("--input");
  const input = inputIndex >= 0 ? process.argv[inputIndex + 1] : undefined;
  if (!input || !process.argv.includes("--confirm-owner-supplied")) {
    throw new Error("Usage: npx tsx scripts/import-lesson-one.ts --input <owner-supplied transcript.txt> --confirm-owner-supplied");
  }
  return input;
}

function parseTranscript(raw: string) {
  const normalizeText = (text: string) => text.replace(/اشتركوا في القناة[.،!\s]*/gu, "").replace(/\s+/gu, " ").trim();

  const bracketedRows = [...raw.matchAll(/\[(\d{2}:\d{2})\]\s*\r?\n([\s\S]*?)(?=\r?\n\s*\[\d{2}:\d{2}\]|\s*$)/g)].map((match) => ({
    at: seconds(match[1]),
    // The only mechanical cleanup intentionally applied: a known platform artefact.
    text: normalizeText(match[2]),
  }));
  if (bracketedRows.length >= 12) return bracketedRows;

  const srtRows = [...raw.matchAll(/(?:^|\r?\n)\d+\s*\r?\n(\d{2}):(\d{2}):(\d{2})[,.]\d+\s+-->[^\r\n]*\r?\n([\s\S]*?)(?=\r?\n\r?\n\d+\s*\r?\n|\s*$)/g)].map((match) => ({
    at: Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]),
    text: normalizeText(match[4]),
  }));
  if (srtRows.length >= 12) return srtRows;

  const rows = bracketedRows.length > 0 ? bracketedRows : srtRows;
  if (rows.length < 12) throw new Error("The supplied file did not contain the expected timestamped transcript rows.");
  return rows;
}

async function main() {
  const input = readArgs();
  const transcript = parseTranscript(await readFile(input, "utf8"));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    await db.learningPath.upsert({
      where: { id: PATH_ID },
      create: {
        id: PATH_ID,
        slug: "hanbali-fiqh",
        title: "المسار العلمي في تفقّه",
        description: "مسار دراسي للمذهب الحنبلي.",
        order: 0,
        isSample: false,
      },
      update: { title: "المسار العلمي في تفقّه", isSample: false },
    });
    await db.level.upsert({
      where: { id: LEVEL_ID },
      create: { id: LEVEL_ID, pathId: PATH_ID, order: 1, title: "المستوى الأول", status: "ACTIVE" },
      update: { pathId: PATH_ID, order: 1, title: "المستوى الأول", status: "ACTIVE" },
    });
    await db.course.upsert({
      where: { id: COURSE_ID },
      create: {
        id: COURSE_ID,
        levelId: LEVEL_ID,
        slug: "hanbali-fiqh-path",
        title: "أخصر المختصرات",
        description: "المستوى الأول من المسار.",
        madhhab: "الحنبلي",
        order: 0,
        isSample: false,
      },
      update: { levelId: LEVEL_ID, title: "أخصر المختصرات", isSample: false },
    });
    await db.chapter.upsert({
      where: { id: CHAPTER_ID },
      create: {
        id: CHAPTER_ID,
        courseId: COURSE_ID,
        order: 0,
        title: "الدرس الأول",
        description: "مادة تفريغ زمنية مورّدة للمراجعة البشرية قبل النشر والاعتماد.",
      },
      update: { courseId: COURSE_ID, order: 0, title: "الدرس الأول", description: "مادة تفريغ زمنية مورّدة للمراجعة البشرية قبل النشر والاعتماد." },
    });
    await db.lesson.upsert({
      where: { id: LESSON_ID },
      create: {
        id: LESSON_ID,
        chapterId: CHAPTER_ID,
        order: 1,
        title: "الدرس الأول",
        description: "فقه العبادات — تفريغ زمني مورّد للمراجعة البشرية قبل النشر.",
        objectives: [],
        status: "DRAFT",
        isSample: false,
        estimatedMinutes: 39,
        measurementEnabled: false,
      },
      update: {
        chapterId: CHAPTER_ID,
        order: 1,
        title: "الدرس الأول",
        description: "فقه العبادات — تفريغ زمني مورّد للمراجعة البشرية قبل النشر.",
        objectives: [],
        status: "DRAFT",
        isSample: false,
        estimatedMinutes: 39,
        measurementEnabled: false,
      },
    });

    for (const spec of concepts) {
      const conceptId = `${LESSON_ID}-concept-${String(spec.order).padStart(2, "0")}`;
      const passageId = `${LESSON_ID}-passage-${String(spec.order).padStart(2, "0")}`;
      const text = transcript
        .filter((row) => row.at >= spec.start && row.at <= spec.end)
        .map((row) => row.text)
        .filter(Boolean)
        .join("\n\n");
      if (text.length < 10) throw new Error(`No transcript text found for concept ${spec.order} (${stamp(spec.start)}–${stamp(spec.end)}).`);

      const existingConcept = await db.concept.findUnique({ where: { id: conceptId } });
      const videoUnchanged =
        existingConcept?.videoUrl === VIDEO_URL &&
        existingConcept.videoStartSecond === spec.start &&
        existingConcept.videoEndSecond === spec.end;
      await db.concept.upsert({
        where: { id: conceptId },
        create: {
          id: conceptId,
          lessonId: LESSON_ID,
          order: spec.order,
          title: spec.title,
          description: `مقطع التفريغ من ${stamp(spec.start)} إلى ${stamp(spec.end)}؛ يحتاج إلى مراجعة بشرية قبل الاعتماد.`,
          videoUrl: VIDEO_URL,
          videoStartSecond: spec.start,
          videoEndSecond: spec.end,
          videoApproved: false,
        },
        update: {
          lessonId: LESSON_ID,
          order: spec.order,
          title: spec.title,
          description: `مقطع التفريغ من ${stamp(spec.start)} إلى ${stamp(spec.end)}؛ يحتاج إلى مراجعة بشرية قبل الاعتماد.`,
          videoUrl: VIDEO_URL,
          videoStartSecond: spec.start,
          videoEndSecond: spec.end,
          ...(videoUnchanged ? {} : { videoApproved: false, videoApprovedAt: null, videoApprovedById: null }),
        },
      });

      const existingPassage = await db.sourcePassage.findUnique({ where: { id: passageId } });
      const unchanged = existingPassage?.text === text;
      await db.sourcePassage.upsert({
        where: { id: passageId },
        create: {
          id: passageId,
          lessonId: LESSON_ID,
          conceptId,
          order: 1,
          text,
          sourceTitle: "الدرس الأول — أخصر المختصرات",
          sourceAuthor: "الشيخ محمد بن أحمد باجابر (شرح مورّد)",
          sourceReference: `تفريغ زمني ${stamp(spec.start)}–${stamp(spec.end)}`,
          sourceUrl: TRANSCRIPT_URL,
          startSecond: spec.start,
          endSecond: spec.end,
          edition: "تفريغ زمني مورّد من مالك المشروع",
          license: null,
          permissionNote: HUMAN_REVIEW,
          approved: false,
          isSample: false,
        },
        update: {
          lessonId: LESSON_ID,
          conceptId,
          order: 1,
          text,
          sourceTitle: "الدرس الأول — أخصر المختصرات",
          sourceAuthor: "الشيخ محمد بن أحمد باجابر (شرح مورّد)",
          sourceReference: `تفريغ زمني ${stamp(spec.start)}–${stamp(spec.end)}`,
          sourceUrl: TRANSCRIPT_URL,
          startSecond: spec.start,
          endSecond: spec.end,
          edition: "تفريغ زمني مورّد من مالك المشروع",
          license: null,
          permissionNote: HUMAN_REVIEW,
          ...(unchanged ? {} : { version: (existingPassage?.version ?? 0) + 1, approved: false, approvedAt: null, approvedById: null }),
          isSample: false,
        },
      });
    }
    console.log(`Imported ${LESSON_ID}: ${concepts.length} draft concepts and ${concepts.length} unapproved source passages.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
