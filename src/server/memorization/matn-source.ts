import { countArabicWords, normalizeWhitespace, tokenize } from "./canonical";
import { PASSAGE_UNITS, UNIT_WORDS, type MatnStructure } from "./matn-import";

/**
 * Canonical Matn source format (content/sources/*.md):
 *  - YAML-like front matter between `---` lines (source metadata, never Matn);
 *  - `## title` lines: application navigation headings (never Matn);
 *  - HTML comments: editorial notes (never Matn);
 *  - every other non-empty line: Matn text, verbatim.
 */
export type CanonicalMatn = {
  meta: Record<string, string>;
  sections: { title: string; lines: string[] }[];
};

export function parseCanonicalMatn(markdown: string): CanonicalMatn {
  const rows = markdown.replace(/\r\n/g, "\n").split("\n");
  const meta: Record<string, string> = {};
  let i = 0;
  if (rows[0]?.trim() === "---") {
    for (i = 1; i < rows.length && rows[i].trim() !== "---"; i++) {
      const at = rows[i].indexOf(":");
      if (at > 0) meta[rows[i].slice(0, at).trim()] = rows[i].slice(at + 1).trim();
    }
    i += 1;
  }
  const sections: CanonicalMatn["sections"] = [];
  for (; i < rows.length; i++) {
    const line = rows[i].trim();
    if (!line || (line.startsWith("<!--") && line.endsWith("-->"))) continue;
    if (line.startsWith("## ")) {
      sections.push({ title: line.slice(3).trim(), lines: [] });
      continue;
    }
    if (!sections.length) throw new Error(`Matn line before the first «##» heading: ${line}`);
    sections.at(-1)!.lines.push(line);
  }
  return { meta, sections };
}

/** All Matn text of the canonical source, whitespace-normalized (comparison only — nothing is stored this way). */
export function canonicalMatnText(source: CanonicalMatn): string {
  return normalizeWhitespace(source.sections.flatMap((s) => s.lines).join(" "));
}

/** Navigation key per heading. Titles are application labels (titleIsDerived), never part of the Matn. */
const SECTION_KEYS: Record<string, string> = {
  "مقدمة المؤلف": "muqaddima",
  المياه: "miyah",
  الآنية: "aniya",
  الاستنجاء: "istinja",
  السواك: "siwak",
  "فروض الوضوء": "furud-wudu",
  المسح: "mash",
  "نواقض الوضوء": "nawaqidh-wudu",
  "موجبات الغسل": "mujibat-ghusl",
  التيمم: "tayammum",
  "إزالة النجاسة": "izalat-najasa",
  "الحيض والنفاس": "hayd",
};

/** Vocalized heading lines of the Matn itself. They stay canonical text (recited) and are recorded as sourceHeading. */
const MATN_HEADINGS = new Set(["فَصْلٌ", "كِتَابُ الطَّهَارَةِ", "فَصْلٌ فِي الْحَيْضِ"]);
const BOOK_GROUP = "كتاب الطهارة";

/** Soft target for one unit; UNIT_WORDS.max stays the hard ceiling. */
const UNIT_TARGET = 10;
/** A source line of at most this many words is attached to its neighbour instead of standing alone. */
const SHORT_LINE = 3;

/** Splits a line into clauses after «،» «؛» «.», never inside «…» quotations and never after «:» (which introduces what follows). */
function clauses(line: string): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let depth = 0;
  for (const token of tokenize(line)) {
    current.push(token);
    depth += (token.match(/«/g)?.length ?? 0) - (token.match(/»/g)?.length ?? 0);
    if (depth <= 0 && /[،؛.]»?$/u.test(token)) {
      out.push(current);
      current = [];
      depth = 0;
    }
  }
  if (current.length) out.push(current);
  return out;
}

const words = (tokens: string[]) => countArabicWords(tokens.join(" "));

/** Packs one line's clauses into units of ≤ UNIT_TARGET words (hard max UNIT_WORDS.max). */
function packLine(line: string): string[][] {
  const units: string[][] = [];
  let current: string[] = [];
  for (const clause of clauses(line)) {
    if (current.length && words(current) + words(clause) > UNIT_TARGET && words(current) >= UNIT_WORDS.min) {
      units.push(current);
      current = [];
    }
    current = current.concat(clause);
  }
  if (current.length) {
    // A short tail is attached to the previous unit when it still fits.
    const prev = units.at(-1);
    if (prev && words(current) < UNIT_WORDS.min && words(prev) + words(current) <= UNIT_WORDS.max) prev.push(...current);
    else units.push(current);
  }
  return units;
}

/** Units of one section: short source lines (headings, «وَبَعْدُ:», …) are joined to a neighbour. */
function sectionUnits(lines: string[]): string[] {
  const units: string[][] = [];
  let carry: string[] = [];
  for (const line of lines) {
    const tokens = tokenize(line);
    if (words(tokens) <= SHORT_LINE) {
      // Attach backward to a short standalone unit (e.g. the basmala), otherwise carry forward.
      const prev = units.at(-1);
      if (!carry.length && prev && words(prev) < 5) prev.push(...tokens);
      else carry = carry.concat(tokens);
      continue;
    }
    const packed = packLine(line);
    if (carry.length) {
      packed[0] = carry.concat(packed[0]);
      carry = [];
    }
    units.push(...packed);
  }
  if (carry.length) {
    if (units.length) units.at(-1)!.push(...carry);
    else units.push(carry);
  }
  return units.map((u) => u.join(" "));
}

const endsSentence = (text: string) => /[.]»?$/u.test(text);

/** Groups units into passages of PASSAGE_UNITS.min–max, preferring cuts after a full stop. */
function groupPassages(units: string[]): string[][] {
  const n = units.length;
  const k = Math.max(1, Math.ceil(n / 6));
  const passages: string[][] = [];
  let start = 0;
  for (let p = 1; p <= k; p++) {
    if (p === k) {
      passages.push(units.slice(start));
      break;
    }
    const ideal = Math.round((p * n) / k);
    const remaining = k - p;
    const candidates = [ideal, ideal + 1, ideal - 1, ideal + 2, ideal - 2].filter((end) => {
      const size = end - start;
      const rest = n - end;
      return size >= PASSAGE_UNITS.min && size <= PASSAGE_UNITS.max && rest >= remaining * PASSAGE_UNITS.min && rest <= remaining * PASSAGE_UNITS.max;
    });
    const end = candidates.find((c) => endsSentence(units[c - 1])) ?? candidates[0] ?? ideal;
    passages.push(units.slice(start, end));
    start = end;
  }
  return passages;
}

export function buildMatnStructure(source: CanonicalMatn, courseId = "course-hanbali-path"): MatnStructure {
  return {
    courseId,
    source: {
      file: "content/sources/akhsar-al-mukhtasarat-matn.md",
      title: source.meta.title ?? "",
      author: source.meta.author,
      purpose: source.meta.purpose,
      transcriptionEdition: source.meta.transcriptionEdition,
      editors: source.meta.editors,
      publisher: source.meta.publisher,
      edition: source.meta.edition,
      year: source.meta.year,
      transcriptionNote: source.meta.transcriptionNote,
      digitalReference: source.meta.digitalReference,
      referenceUrl: source.meta.referenceUrl,
      note: source.meta.scope,
      // Every canonical source line is reproduced inside the units; there are no structural lines to remove here.
      structuralLines: [],
    },
    sections: source.sections.map((section, index) => {
      const key = SECTION_KEYS[section.title];
      if (!key) throw new Error(`No navigation key for section «${section.title}»`);
      const heading = MATN_HEADINGS.has(section.lines[0]) ? section.lines[0] : null;
      return {
        key,
        title: section.title,
        titleIsDerived: true,
        groupTitle: index === 0 ? null : BOOK_GROUP,
        sourceHeading: heading,
        passages: groupPassages(sectionUnits(section.lines)).map((units, i) => ({
          title: `المقطع ${i + 1}`,
          units: units.map((text) => ({ text })),
        })),
      };
    }),
  };
}
