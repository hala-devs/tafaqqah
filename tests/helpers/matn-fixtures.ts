import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Neutral TEST fixtures for the memorization journey (never real or religious content). Built on top of
 * seedFixtureCurriculum: course "c1".
 *
 *   sec-a  (APPROVED) ── pass-a (APPROVED, 4 approved units u-a1…u-a4)
 *                     ── pass-b (APPROVED, 3 approved units u-b1…u-b3)
 *                     ── pass-draft (DRAFT, 3 DRAFT units)
 *                     ── pass-partial (APPROVED but unit u-p3 is DRAFT)  → hidden
 *                     ── pass-empty (APPROVED, no units)                → hidden
 *   sec-draft (DRAFT) ── pass-hidden (APPROVED with approved units)     → hidden (its section is a draft)
 */
export const MATN_COURSE = "c1";

const LABEL: Record<string, string> = { "pass-a": "ألف", "pass-b": "باء", "pass-draft": "مسودة", "pass-partial": "جزئي", "pass-hidden": "مخفي" };
const NUMBER = ["الأولى", "الثانية", "الثالثة", "الرابعة"];

async function passage(db: PrismaClient, id: string, sectionId: string, order: number, title: string, status: "DRAFT" | "APPROVED", units: { id: string; status: "DRAFT" | "APPROVED" }[]) {
  await db.matnPassage.create({ data: { id, sectionId, order, title, status } });
  for (const [i, u] of units.entries()) {
    await db.matnUnit.create({ data: { id: u.id, passageId: id, order: i + 1, canonicalText: `وحدة اختبار ${LABEL[id]} ${NUMBER[i]}`, status: u.status } });
  }
}

export async function seedMatnFixture(db: PrismaClient) {
  await db.matnSection.create({ data: { id: "sec-a", courseId: MATN_COURSE, order: 1, title: "قسم اختبار", status: "APPROVED" } });
  await db.matnSection.create({ data: { id: "sec-draft", courseId: MATN_COURSE, order: 2, title: "قسم مسودة", status: "DRAFT" } });
  const approved = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i + 1}`, status: "APPROVED" as const }));
  await passage(db, "pass-a", "sec-a", 1, "مقطع اختبار أول", "APPROVED", approved("u-a", 4));
  await passage(db, "pass-b", "sec-a", 2, "مقطع اختبار ثان", "APPROVED", approved("u-b", 3));
  await passage(db, "pass-draft", "sec-a", 3, "مقطع مسودة", "DRAFT", [1, 2, 3].map((i) => ({ id: `u-d${i}`, status: "DRAFT" as const })));
  await passage(db, "pass-partial", "sec-a", 4, "مقطع جزئي", "APPROVED", [
    { id: "u-p1", status: "APPROVED" },
    { id: "u-p2", status: "APPROVED" },
    { id: "u-p3", status: "DRAFT" },
  ]);
  await db.matnPassage.create({ data: { id: "pass-empty", sectionId: "sec-a", order: 5, title: "مقطع فارغ", status: "APPROVED" } });
  await passage(db, "pass-hidden", "sec-draft", 1, "مقطع قسمه مسودة", "APPROVED", approved("u-h", 3));
}

export const PASS_A_UNITS = ["u-a1", "u-a2", "u-a3", "u-a4"];

export function results(statuses: ("CORRECT" | "INCORRECT" | "FORGOTTEN")[], unitIds: string[] = PASS_A_UNITS) {
  return unitIds.map((unitId, i) => ({ unitId, status: statuses[i] ?? "CORRECT" }));
}

let counter = 0;
export function attemptInput(passageId: string, statuses: ("CORRECT" | "INCORRECT" | "FORGOTTEN")[], unitIds: string[] = PASS_A_UNITS, clientAttemptId?: string) {
  counter += 1;
  return { passageId, clientAttemptId: clientAttemptId ?? `client-attempt-${counter}-${Date.now()}`, results: results(statuses, unitIds) };
}
