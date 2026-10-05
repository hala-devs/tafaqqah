/**
 * Verifies content/matn-akhsar.structure.json against content/matn-akhsar.source.txt and prints the COMPLETE
 * segmentation + artifact report (also written to docs/matn-akhsar-segmentation-report.md). No database access.
 *
 * Usage: npm run content:matn-report
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { countArabicWords } from "../src/server/memorization/canonical";
import { planImport, structureStats, verifyStructure, UNIT_WORDS, PASSAGE_UNITS, type MatnStructure } from "../src/server/memorization/matn-import";

const root = process.cwd();
const source = readFileSync(join(root, "content/matn-akhsar.source.txt"), "utf8");
const structure = JSON.parse(readFileSync(join(root, "content/matn-akhsar.structure.json"), "utf8")) as MatnStructure;

const verification = verifyStructure(source, structure);
const plan = planImport(structure);
const stats = structureStats(plan);

const out: string[] = [];
const line = (s = "") => out.push(s);

line("# تقرير تقسيم متن أخصر المختصرات (مسودة — بانتظار المراجعة البشرية)");
line();
line("## 1. التحقق من النص القانوني");
line();
line(`- تطابق الكلمات مع المصدر (بعد إزالة artifacts والعناوين الهيكلية فقط): **${verification.ok ? "نعم — لا تغيير في أي كلمة" : "لا — يوجد اختلاف"}**`);
line(`- عدد كلمات المصدر المتوقعة: ${verification.sourceTokenCount} — كلمات الوحدات: ${verification.unitTokenCount}`);
if (verification.firstMismatch) line(`- أول اختلاف: الموضع ${verification.firstMismatch.index} — المتوقع «${verification.firstMismatch.expected}» والفعلي «${verification.firstMismatch.actual}»`);
line();
line("## 2. Artifacts المحذوفة");
line();
line(`- \`svgsvgsvg\`: **${verification.report.artifactCount}** موضعًا حُذفت كلها:`);
verification.report.artifactContexts.forEach((c, i) => line(`  ${i + 1}. «${c.before}» ⟨svgsvgsvg⟩ «${c.after}»`));
line("- عناصر هيكلية استُبعدت من وحدات الحفظ (تنقّل فقط، ليست artifacts):");
verification.report.structuralRemoved.forEach((s) => line(`  - ${s.label}: ${s.count}`));
line("- لا artifacts أخرى حُذفت.");
line();
line("## 3. رموز مشبوهة (لم تُحذف — مُعلَّمة)");
line();
if (stats.suspicious.length === 0) line("- لا شيء.");
for (const s of stats.suspicious) line(`- \`${s.id}\`: ${s.tokens.map((t) => `«${t}»`).join("، ")} — يمنع الاعتماد حتى يحرر المراجع النص.`);
line();
line("## 4. ملاحظات المراجعة المسجلة على الوحدات");
line();
for (const n of stats.withNotes) for (const note of n.notes) line(`- \`${n.id}\`: ${note}`);
line();
line("## 5. الإحصاءات");
line();
line(`- الأقسام: ${stats.sections} — المقاطع: ${stats.passages} — الوحدات: ${stats.units}`);
line(`- وحدات طويلة (> ${UNIT_WORDS.max} كلمة): ${stats.longUnits.length ? stats.longUnits.map((u) => `${u.id} (${u.words})`).join("، ") : "لا يوجد"}`);
line(`- وحدات قصيرة (< ${UNIT_WORDS.min} كلمات): ${stats.shortUnits.length ? stats.shortUnits.map((u) => `${u.id} (${u.words}: «${u.text}»)`).join("، ") : "لا يوجد"}`);
line(`- مقاطع خارج ${PASSAGE_UNITS.min}–${PASSAGE_UNITS.max} وحدات: ${stats.oddPassages.length ? stats.oddPassages.map((p) => `${p.id} (${p.units} وحدة)`).join("، ") : "لا يوجد"}`);
line();
line("## 6. التقسيم الكامل");
line();
let lastGroup: string | null | undefined;
for (const s of plan) {
  if (s.groupTitle !== lastGroup && s.groupTitle) line(`### ${s.groupTitle}`);
  lastGroup = s.groupTitle;
  line(`SECTION: ${s.title}${s.titleIsDerived ? "  (عنوان تنقّل مشتق من التطبيق — ليس من نص المتن)" : ""}`);
  line();
  s.passages.forEach((p) => {
    const words = p.units.reduce((n, u) => n + countArabicWords(u.text), 0);
    line(`PASSAGE ${p.order}: ${p.title}  — ${p.units.length} وحدات، ${words} كلمة`);
    for (const u of p.units) {
      const flags = [u.notes.length ? "⚑ ملاحظة" : ""].filter(Boolean).join(" ");
      line(`${u.order}. ${u.text}${flags ? `   ${flags}` : ""}`);
    }
    line();
  });
}

const text = out.join("\n");
writeFileSync(join(root, "docs/matn-akhsar-segmentation-report.md"), text + "\n", "utf8");
console.log(text);
if (!verification.ok) process.exit(1);
