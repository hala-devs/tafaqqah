/**
 * Pure helpers for canonical Matn text. Nothing here rewrites Arabic wording: the only transformation ever applied
 * to supplied text is removing the known technical extraction artifact and normalising whitespace.
 */

/** Known technical extraction artifact (a page-break marker from the PDF extraction). It is never Matn. */
export const EXTRACTION_ARTIFACT = "svgsvgsvg";

export function stripExtractionArtifacts(raw: string): { text: string; removed: number } {
  const parts = raw.split(EXTRACTION_ARTIFACT);
  return { text: parts.join(" "), removed: parts.length - 1 };
}

export function tokenize(text: string): string[] {
  return text.split(/\s+/u).filter(Boolean);
}

/** Collapses whitespace only. Arabic letters, diacritics and spelling are untouched. */
export function normalizeWhitespace(text: string): string {
  return tokenize(text).join(" ");
}

const ARABIC_LETTER = /[ء-يٱ-ۓ]/u;

/**
 * Tokens that are unlikely to be Matn wording: digits, Latin letters, or standalone punctuation/symbols (e.g. «2 -»).
 * They are flagged — never silently removed — and a unit that contains one cannot be approved until a human edits it.
 */
export function detectSuspiciousTokens(text: string): string[] {
  const found: string[] = [];
  for (const token of tokenize(text)) {
    if (/[0-9٠-٩]/u.test(token) || /[A-Za-z]/u.test(token) || !ARABIC_LETTER.test(token)) found.push(token);
  }
  return found;
}

/** Number of whitespace-separated words that contain an Arabic letter. */
export function countArabicWords(text: string): number {
  return tokenize(text).filter((t) => ARABIC_LETTER.test(t)).length;
}
