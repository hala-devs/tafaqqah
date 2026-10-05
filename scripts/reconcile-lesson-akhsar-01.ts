import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const EXPECTED = [
  ["تعريف الفقه وموضوع الدورة", 46, 135], ["التدرج في طلب العلم", 136, 324], ["منهج شرح المختصر", 325, 373],
  ["وصايا ابن بدران في طرق التعلم", 374, 623], ["التمذهب وطريق المبتدئ", 624, 809], ["دراسة المتن وأهمية المراجعة", 810, 1045],
  ["التعريف بأخصر المختصرات ومؤلفه", 1046, 1215], ["منهج شرح الكتاب ومصطلحات المذهب", 1216, 1348], ["خطبة المصنف ومقصد الكتاب", 1349, 1539],
  ["كتاب الطهارة: تعريف الطهارة والحدث", 1540, 1902], ["أقسام المياه: الماء الطهور", 1903, 2102], ["تغير الماء: المجاور والممازج وغير الممازج", 2103, 2321],
] as const;

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    await db.$transaction(async (tx) => {
      const lesson = await tx.lesson.findUniqueOrThrow({ where: { id: "lesson-akhsar-01" }, include: { concepts: { orderBy: { order: "asc" }, include: { passages: { orderBy: { order: "asc" } } } } } });
      if (lesson.concepts.length !== EXPECTED.length) throw new Error(`Expected 12 concepts, found ${lesson.concepts.length}.`);
      for (const [index, concept] of lesson.concepts.entries()) {
        const [title, startSecond, endSecond] = EXPECTED[index];
        if (concept.title !== title || concept.videoStartSecond !== startSecond || concept.videoEndSecond !== endSecond || startSecond >= endSecond) throw new Error(`Concept ${index + 1} does not match the reviewed identity or timestamp boundary.`);
        if (concept.passages.length !== 1 || !concept.passages[0].text.trim()) throw new Error(`Concept ${index + 1} must have exactly one non-empty source passage.`);
        const passage = concept.passages[0];
        if (passage.startSecond !== startSecond || passage.endSecond !== endSecond) throw new Error(`Passage ${index + 1} timestamp does not match the reviewed boundary.`);
        await tx.sourcePassage.update({ where: { id: passage.id }, data: {
          rawBahethText: passage.rawBahethText ?? passage.text,
          reviewText: passage.reviewText ?? passage.text,
          approved: false, approvedAt: null, approvedById: null,
        } });
        await tx.concept.update({ where: { id: concept.id }, data: { videoApproved: false, videoApprovedAt: null, videoApprovedById: null } });
      }
      await tx.lesson.update({ where: { id: lesson.id }, data: { status: "DRAFT" } });
    });
    console.log("Lesson 1 reconciled: reviewed and raw Baheth layers preserved; all approvals remain false.");
  } finally { await db.$disconnect(); }
}
main();
