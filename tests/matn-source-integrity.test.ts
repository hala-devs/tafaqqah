import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeWhitespace } from "@/server/memorization/canonical";
import { planImport, verifyStructure, type MatnStructure } from "@/server/memorization/matn-import";
import { buildMatnStructure, canonicalMatnText, parseCanonicalMatn } from "@/server/memorization/matn-source";

const root = process.cwd();
const markdown = readFileSync(join(root, "content/sources/akhsar-al-mukhtasarat-matn.md"), "utf8");
const canonical = parseCanonicalMatn(markdown);
const sourceTxt = readFileSync(join(root, "content/matn-akhsar.source.txt"), "utf8");
const structure = JSON.parse(readFileSync(join(root, "content/matn-akhsar.structure.json"), "utf8")) as MatnStructure;
const unitTexts = planImport(structure).flatMap((s) => s.passages.flatMap((p) => p.units.map((u) => u.text)));

/** The only five wording corrections authorized by the content owner (2026-10-04). */
const AUTHORIZED_CORRECTIONS = [
  ["وَمَنْ اسْتَجْمَرَ ثُمَّ اسْتَنْجَى بِمَاءٍ،", "وَسُنَّ اسْتِجْمَارٌ ثُمَّ اسْتِنْجَاءٌ بِمَاءٍ،"],
  ["وَسنُّ عِنْدَ دُخُولِ خَلَاءٍ", "وَسُنَّ عِنْدَ دُخُولِ خَلَاءٍ"],
  ["وَكْرَهُ دُخُولُ خَلَاءٍ", "وَكُرِهَ دُخُولُ خَلَاءٍ"],
  ["وَحْرُمُ اسْتِقْبَالُ قِبْلَةٍ", "وَحَرُمَ اسْتِقْبَالُ قِبْلَةٍ"],
  ["كَمَنِيٍّ لَا دَمَ لَهُ سَائِلٌ", "كَمِمَّا لَا دَمَ لَهُ سَائِلٌ"],
] as const;

/** Editorial/structural lines of the supplied file that must never become Matn. */
const NON_MATN = ["الصفحة الثانية", "الصفحة الثالثة", "أكيد. نسختها", "تكملة فصل الاستنجاء", "فصل — فروض الوضوء", "فصل — المسح", "فصل — نواقض الوضوء"];

describe("canonical Matn source (content/sources/akhsar-al-mukhtasarat-matn.md)", () => {
  it("records the source metadata without unsupported claims", () => {
    // The imported Matn is attributed to the Rakaez critical edition (bibliographic attribution only).
    expect(canonical.meta).toMatchObject({
      title: "أخصر المختصرات",
      author: "محمد بن بدر الدين بن بلبان الحنبلي",
      editors: "د. أنس بن عادل اليتامى؛ د. عبدالعزيز بن عدنان العيدان",
      publisher: "دار ركائز للنشر والتوزيع",
      edition: "الطبعة الأولى",
      year: "1441هـ / 2019م",
    });
    // IslamHouse is not the source of the imported text.
    expect(canonical.meta.digitalReference).toBeUndefined();
    expect(markdown).not.toMatch(/islamhouse/iu);
    expect(markdown).not.toMatch(/إذن|اعتماد إسلام هاوس|endorse|permission/iu);
  });

  it("contains exactly the five authorized corrections and none of the replaced wording", () => {
    for (const [before, after] of AUTHORIZED_CORRECTIONS) {
      expect(markdown.split(after).length - 1).toBe(1);
      expect(markdown).not.toContain(before);
    }
  });

  it("keeps editorial/structural lines out of the Matn", () => {
    const matn = canonicalMatnText(canonical);
    for (const line of NON_MATN) expect(matn).not.toContain(line);
  });

  it("keeps the vocalized «فَصْلٌ» headings of the Matn as canonical text", () => {
    const lines = canonical.sections.flatMap((s) => s.lines);
    expect(lines.filter((l) => l === "فَصْلٌ")).toHaveLength(9);
    expect(lines).toContain("فَصْلٌ فِي الْحَيْضِ");
    expect(lines).toContain("كِتَابُ الطَّهَارَةِ");
  });

  it("starts at the author's introduction and ends with the chapter on menstruation and postpartum bleeding", () => {
    expect(canonical.sections.map((s) => s.title)).toEqual([
      "مقدمة المؤلف", "المياه", "الآنية", "الاستنجاء", "السواك", "فروض الوضوء",
      "المسح", "نواقض الوضوء", "موجبات الغسل", "التيمم", "إزالة النجاسة", "الحيض والنفاس",
    ]);
  });
});

describe("stored memorization units reproduce the canonical source exactly", () => {
  it("joins every unit, in order, back into the canonical Matn — letters and diacritics included", () => {
    const rebuilt = normalizeWhitespace(unitTexts.join(" "));
    expect(rebuilt).toBe(canonicalMatnText(canonical));
    expect(rebuilt.length).toBe(canonicalMatnText(canonical).length);
  });

  it("is exactly what the builder produces from the canonical source (no hand edits)", () => {
    expect(buildMatnStructure(canonical)).toEqual(structure);
  });

  it("matches the importer's line-exact contract", () => {
    const result = verifyStructure(sourceTxt, structure);
    expect(result.ok).toBe(true);
    expect(sourceTxt.trimEnd().split("\n")).toEqual(unitTexts);
  });

  it("never stores navigation titles or editorial lines inside a unit", () => {
    for (const text of unitTexts) {
      expect(text).not.toMatch(/^##|<!--|الصفحة|أكيد|تكملة|فصل —/u);
    }
  });
});
