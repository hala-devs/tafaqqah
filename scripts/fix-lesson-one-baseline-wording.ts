/**
 * One-off, wording-only clean-up of the approved Lesson 1 base questions.
 *
 * Student-facing phrases that point at «the text / the lesson / the explanation» ("في النص المنقول في الدرس",
 * "كما ورد في الدرس", "وفق شرح الدرس", "بحسب الشرح"…) are rewritten so the question reads naturally.
 * The options, the correct answer, the explanation, the concept and the passage are NOT touched.
 *
 * It goes through the real workflow: `updateFixedQuestionWording` revokes the approval and writes an audit event,
 * then `setFixedQuestionApproval` re-approves — both as the admin account (ADMIN_EMAIL).
 *
 *   npx tsx --conditions=react-server scripts/fix-lesson-one-baseline-wording.ts          # dry run
 *   npx tsx --conditions=react-server scripts/fix-lesson-one-baseline-wording.ts --apply
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { setFixedQuestionApproval, updateFixedQuestionWording } from "../src/server/admin/content";

const REWRITES: Record<string, { from: string; to: string }> = {
  "lesson-akhsar-01-base-01": { from: "ما تعريف الفقه في الاصطلاح كما ورد في الدرس؟", to: "ما تعريف الفقه في الاصطلاح؟" },
  "lesson-akhsar-01-base-02": { from: "الأحكام المكتسبة من الأدلة الإجمالية تدخل -وفق شرح الدرس- في:", to: "الأحكام المكتسبة من الأدلة الإجمالية تدخل في:" },
  "lesson-akhsar-01-base-03": { from: "ما الترتيب الذي ذكره الشرح لطالب العلم المبتدئ؟", to: "ما الترتيب المناسب لطالب العلم المبتدئ في الكتب؟" },
  "lesson-akhsar-01-base-04": { from: "ما إحدى النتائج التي ذكرها الشرح للبدء بالكتب المطولة قبل التأهل لها؟", to: "ما إحدى نتائج البدء بالكتب المطولة قبل التأهل لها؟" },
  "lesson-akhsar-01-base-06": { from: "ما العامل الذي ذكره الشرح باعتباره قد يؤثر في اختيار المذهب الذي يبدأ الطالب بالتفقه عليه؟", to: "ما العامل الذي قد يؤثر في اختيار المذهب الذي يبدأ الطالب بالتفقه عليه؟" },
  "lesson-akhsar-01-base-07": { from: "كيف وصف ابن بدران طريقة شرح المتن للمبتدئ في النص المنقول في الدرس؟", to: "كيف وصف ابن بدران طريقة شرح المتن للمبتدئ؟" },
  "lesson-akhsar-01-base-08": { from: "بماذا شبّه الشرح إتقان المتن المختصر؟", to: "بماذا يُشبَّه إتقان المتن المختصر؟" },
  "lesson-akhsar-01-base-12": { from: "عندما يقول الحنابلة «رواية»، فما المقصود بحسب الدرس؟", to: "عندما يقول الحنابلة «رواية»، فما المقصود؟" },
  "lesson-akhsar-01-base-13": { from: "أي عبارة تمثل تعريف الطهارة الموسع المذكور في الدرس؟", to: "أي عبارة تمثل تعريف الطهارة الموسع؟" },
  "lesson-akhsar-01-base-14": { from: "ما الحدث بحسب الشرح؟", to: "ما المقصود بالحدث؟" },
  "lesson-akhsar-01-base-15": { from: "أي عبارة صحيحة عن الماء الطهور كما ورد في الدرس؟", to: "أي عبارة صحيحة عن الماء الطهور؟" },
  "lesson-akhsar-01-base-16": { from: "ماء تغير بسبب قطعة خشب دخلت فيه ولم تذب فيه. كيف وصف الشرح هذا النوع؟", to: "ماء تغير بسبب قطعة خشب دخلت فيه ولم تذب فيه. كيف يوصف هذا النوع؟" },
};

async function main() {
  const apply = process.argv.includes("--apply");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const admin = await db.user.findUniqueOrThrow({ where: { email: process.env.ADMIN_EMAIL ?? "" } });
  if (admin.role !== "ADMIN") throw new Error("ADMIN_EMAIL is not an admin");
  const actor = { id: admin.id, role: admin.role };

  for (const [id, { from, to }] of Object.entries(REWRITES)) {
    const row = await db.fixedQuestion.findUniqueOrThrow({ where: { id } });
    if (row.question === to) {
      console.log(`= ${id}: already rewritten`);
      continue;
    }
    if (row.question !== from) throw new Error(`${id}: unexpected current wording «${row.question}» — refusing to overwrite`);
    console.log(`${apply ? "→" : "?"} ${id}\n    - ${from}\n    + ${to}`);
    if (!apply) continue;
    const before = { options: row.options, correctIndex: row.correctIndex, explanation: row.explanation, conceptId: row.conceptId, sourcePassageId: row.sourcePassageId };
    const edited = await updateFixedQuestionWording(db, actor, { id, question: to });
    if (edited.approved) throw new Error(`${id}: approval was not revoked`);
    await setFixedQuestionApproval(db, actor, { id, approved: "true" });
    const after = await db.fixedQuestion.findUniqueOrThrow({ where: { id } });
    if (JSON.stringify(before) !== JSON.stringify({ options: after.options, correctIndex: after.correctIndex, explanation: after.explanation, conceptId: after.conceptId, sourcePassageId: after.sourcePassageId }) || !after.approved) {
      throw new Error(`${id}: unexpected change after rewrite`);
    }
  }
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
