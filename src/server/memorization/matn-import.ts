import { countArabicWords, detectSuspiciousTokens, stripExtractionArtifacts, tokenize } from "./canonical";

/** Shape of content/matn-akhsar.structure.json (a human-reviewable proposal; every row imports as DRAFT). */
export type MatnStructure = {
  courseId: string;
  source: {
    file: string;
    title: string;
    author?: string;
    purpose?: string;
    transcriptionEdition?: string;
    editors?: string;
    publisher?: string;
    edition?: string;
    year?: string;
    transcriptionNote?: string;
    digitalReference?: string;
    referenceUrl?: string;
    note?: string;
    structuralLines: string[];
  };
  sections: {
    key: string;
    title: string;
    titleIsDerived: boolean;
    groupTitle: string | null;
    sourceHeading: string | null;
    passages: { title: string; units: { text: string; notes?: string[] }[] }[];
  }[];
};

/**
 * Structural, non-memorized text of the supplied source: the book title line, headings and the «فصل» markers.
 * They organise navigation and are excluded from recitation units. Each entry must occur exactly `count` times.
 */
export const STRUCTURAL_SEQUENCES: { label: string; tokens: string[]; count: number }[] = [
  { label: "book title line", tokens: tokenize("أخصر المختصرات فِي الْفِقْه على مَذْهَب الامام احْمَد بن حَنْبَل"), count: 1 },
  { label: "heading: خطبة المؤلف", tokens: tokenize("خطْبَة الْمُؤلف"), count: 1 },
  { label: "heading: = كتاب الطهارة =", tokens: tokenize("= كتاب الطَّهَارَة ="), count: 1 },
  { label: "«فصل» heading marker", tokens: ["فصل"], count: 8 },
];

function removeSequence(tokens: string[], seq: string[], expected: number): { out: string[]; removed: number } {
  const out: string[] = [];
  let removed = 0;
  for (let i = 0; i < tokens.length; ) {
    if (seq.every((t, k) => tokens[i + k] === t)) {
      removed += 1;
      i += seq.length;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }
  if (removed !== expected) throw new Error(`structural sequence «${seq.join(" ")}» occurred ${removed} times, expected ${expected}`);
  return { out, removed };
}

export type ArtifactReport = {
  artifactCount: number;
  /** Words around every removed artifact, for the human-readable report. */
  artifactContexts: { before: string; after: string }[];
  structuralRemoved: { label: string; count: number }[];
};

/** The source tokens that must be reproduced exactly (and in order) by the concatenated units. */
export function expectedTokens(rawSource: string): { tokens: string[]; report: ArtifactReport } {
  const { text, removed } = stripExtractionArtifacts(rawSource);
  const contexts: ArtifactReport["artifactContexts"] = [];
  const pieces = rawSource.split("svgsvgsvg");
  for (let i = 0; i < pieces.length - 1; i++) {
    const before = tokenize(pieces[i]).slice(-3).join(" ");
    const after = tokenize(pieces[i + 1]).slice(0, 3).join(" ");
    contexts.push({ before, after });
  }
  let tokens = tokenize(text);
  const structuralRemoved: ArtifactReport["structuralRemoved"] = [];
  for (const seq of STRUCTURAL_SEQUENCES) {
    const result = removeSequence(tokens, seq.tokens, seq.count);
    tokens = result.out;
    structuralRemoved.push({ label: seq.label, count: result.removed });
  }
  return { tokens, report: { artifactCount: removed, artifactContexts: contexts, structuralRemoved } };
}

/**
 * Removes only source lines explicitly identified as navigation headings. Every remaining source line is a
 * canonical memorization unit and is compared as an exact display string before import.
 */
export function expectedUnitLines(rawSource: string, structure: MatnStructure): { lines: string[]; report: ArtifactReport } {
  const { text, removed } = stripExtractionArtifacts(rawSource);
  const sourceLines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const structuralLines = new Set(structure.source.structuralLines);
  const requiredCounts = new Map<string, number>();
  for (const line of structure.source.structuralLines) requiredCounts.set(line, (requiredCounts.get(line) ?? 0) + 1);
  const structuralRemoved = [...requiredCounts.entries()].map(([line, expected]) => ({ label: line, count: sourceLines.filter((sourceLine) => sourceLine === line).length, expected }));
  if (structuralRemoved.some(({ count, expected }) => count !== expected)) throw new Error(`The structural-line inventory does not match the canonical source: ${JSON.stringify(structuralRemoved)}`);
  return { lines: sourceLines.filter((line) => !structuralLines.has(line)), report: { artifactCount: removed, artifactContexts: [], structuralRemoved } };
}

export type VerificationResult = {
  ok: boolean;
  sourceTokenCount: number;
  unitTokenCount: number;
  /** First position where the units diverge from the source, if any. */
  firstMismatch: { index: number; expected: string | undefined; actual: string | undefined } | null;
  report: ArtifactReport;
};

/**
 * Proves that the structured units contain EXACTLY the supplied Arabic wording: concatenating every unit in order
 * must reproduce the source tokens (minus the removed artifacts and structural headings), word for word.
 */
export function verifyStructure(rawSource: string, structure: MatnStructure): VerificationResult {
  const { lines, report } = expectedUnitLines(rawSource, structure);
  const actualLines = structure.sections.flatMap((s) => s.passages.flatMap((p) => p.units.map((u) => u.text)));
  const firstLineMismatch = Math.max(lines.length, actualLines.length) && lines.findIndex((line, index) => line !== actualLines[index]);
  if (firstLineMismatch >= 0 || lines.length !== actualLines.length) {
    const index = firstLineMismatch >= 0 ? firstLineMismatch : Math.min(lines.length, actualLines.length);
    return { ok: false, sourceTokenCount: lines.flatMap(tokenize).length, unitTokenCount: actualLines.flatMap(tokenize).length, firstMismatch: { index, expected: lines[index], actual: actualLines[index] }, report };
  }
  const expected = lines.flatMap(tokenize);
  const actual = actualLines.flatMap(tokenize);
  let firstMismatch: VerificationResult["firstMismatch"] = null;
  const max = Math.max(expected.length, actual.length);
  for (let i = 0; i < max; i++) {
    if (expected[i] !== actual[i]) {
      firstMismatch = { index: i, expected: expected[i], actual: actual[i] };
      break;
    }
  }
  return { ok: firstMismatch === null, sourceTokenCount: expected.length, unitTokenCount: actual.length, firstMismatch, report };
}

export type PlannedUnit = { id: string; order: number; text: string; notes: string[] };
export type PlannedPassage = { id: string; order: number; title: string; units: PlannedUnit[] };
export type PlannedSection = {
  id: string;
  order: number;
  title: string;
  titleIsDerived: boolean;
  groupTitle: string | null;
  sourceHeading: string | null;
  passages: PlannedPassage[];
};

/** Deterministic ids and 1-based orders, so re-running the import updates rows in place. */
export function planImport(structure: MatnStructure, prefix = "matn-akhsar"): PlannedSection[] {
  return structure.sections.map((s, si) => {
    const sectionId = `${prefix}-${s.key}`;
    return {
      id: sectionId,
      order: si + 1,
      title: s.title,
      titleIsDerived: s.titleIsDerived,
      groupTitle: s.groupTitle,
      sourceHeading: s.sourceHeading,
      passages: s.passages.map((p, pi) => ({
        id: `${sectionId}-p${pi + 1}`,
        order: pi + 1,
        title: p.title,
        units: p.units.map((u, ui) => ({
          id: `${sectionId}-p${pi + 1}-u${ui + 1}`,
          order: ui + 1,
          // Canonical reviewed display text must never be normalized or rewritten on import.
          text: u.text,
          notes: u.notes ?? [],
        })),
      })),
    };
  });
}

export type StructureStats = {
  sections: number;
  passages: number;
  units: number;
  longUnits: { id: string; words: number; text: string }[];
  shortUnits: { id: string; words: number; text: string }[];
  /** Passages outside the 3–7 unit target. */
  oddPassages: { id: string; units: number; words: number }[];
  suspicious: { id: string; tokens: string[] }[];
  withNotes: { id: string; notes: string[] }[];
};

export const UNIT_WORDS = { min: 3, max: 15 } as const;
export const PASSAGE_UNITS = { min: 3, max: 7 } as const;

export function structureStats(plan: PlannedSection[]): StructureStats {
  const stats: StructureStats = { sections: plan.length, passages: 0, units: 0, longUnits: [], shortUnits: [], oddPassages: [], suspicious: [], withNotes: [] };
  for (const s of plan) {
    for (const p of s.passages) {
      stats.passages += 1;
      let words = 0;
      for (const u of p.units) {
        stats.units += 1;
        const w = countArabicWords(u.text);
        words += w;
        if (w > UNIT_WORDS.max) stats.longUnits.push({ id: u.id, words: w, text: u.text });
        if (w < UNIT_WORDS.min) stats.shortUnits.push({ id: u.id, words: w, text: u.text });
        const bad = detectSuspiciousTokens(u.text);
        if (bad.length) stats.suspicious.push({ id: u.id, tokens: bad });
        if (u.notes.length) stats.withNotes.push({ id: u.id, notes: u.notes });
      }
      if (p.units.length < PASSAGE_UNITS.min || p.units.length > PASSAGE_UNITS.max) stats.oddPassages.push({ id: p.id, units: p.units.length, words });
    }
  }
  return stats;
}
