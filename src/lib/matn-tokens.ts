/**
 * Deterministic display tokens for an approved canonical Matn unit.
 *
 * A token is one non-whitespace run from the exact stored text. Punctuation remains
 * attached to the preceding word when it is written without whitespace (for example
 * `الرَّحِيمِ،` is one token); whitespace-separated punctuation is its own token.
 * No spelling, tashkeel, punctuation, or whitespace inside a token is changed.
 */
export function tokenizeCanonicalMatn(text: string): string[] {
  return text.match(/\S+/gu) ?? [];
}
