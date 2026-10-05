/**
 * Arabic text normalisation for deterministic grounding checks.
 * Removes diacritics/tatweel, unifies alef/ya/ta-marbuta/hamza carriers and strips punctuation,
 * so "يُجابُ" in a question can be matched against "يجاب" in the source.
 */
const DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const PUNCTUATION = /[«»"'“”‘’()[\]{}<>.,،؛;:!?؟…\-–—_/\\|*~`=+#%^&@$]/g;

export function normalizeArabic(text: string): string {
  return text
    .normalize("NFKC")
    .replace(DIACRITICS, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeArabic(text);
  return normalized ? normalized.split(" ") : [];
}

/** Strips one leading conjunction (و/ف) — used for phrase matching. */
export function stripConjunction(token: string): string {
  return token.length > 3 && (token.startsWith("و") || token.startsWith("ف")) ? token.slice(1) : token;
}

/** Very light stemmer: conjunction + preposition/article prefixes and common pronoun suffixes. */
export function lightStem(token: string): string {
  let w = stripConjunction(token);
  if (w.length > 4 && /^[بلك]ال/.test(w)) w = w.slice(3);
  else if (w.length > 3 && (w.startsWith("ال") || w.startsWith("لل"))) w = w.slice(2);
  else if (w.length > 3 && /^[بلك]/.test(w) && !w.startsWith("لا")) w = w.slice(1);
  if (w.length > 4 && /(ها|هم|هن|كم|نا|ات|ون|ين|ان)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && /[هي]$/.test(w)) w = w.slice(0, -1);
  return w;
}

const RAW_STOPWORDS = [
  // function words
  "في", "من", "على", "إلى", "الى", "عن", "مع", "أن", "ان", "إن", "لا", "ما", "ماذا", "هل", "هو", "هي", "هم",
  "هذا", "هذه", "ذلك", "تلك", "التي", "الذي", "الذين", "و", "او", "أو", "ثم", "بل", "قد", "كل", "بعد", "قبل",
  "عند", "حتى", "إذا", "اذا", "لم", "لن", "كان", "كانت", "يكون", "تكون", "ليس", "غير", "بين", "أي", "اي",
  "كما", "لكن", "لأن", "لان", "أنه", "انه", "أنها", "انها", "به", "بها", "له", "لها", "فيه", "فيها", "منه",
  "منها", "عليه", "عليها", "إلا", "الا", "وهو", "وهي", "أيضا", "ايضا", "فقط", "حيث", "كيف", "متى", "أين",
  "اين", "لماذا", "بم", "بماذا", "بمَ", "مما", "عما", "عن", "يا", "أم", "ام", "سوى", "دون", "نحو", "ذو", "ذات",
  // meta words used when talking about a passage
  "النص", "الدرس", "المقطع", "المادة", "المصدر", "ذكر", "يذكر", "ذكرت", "ورد", "وردت", "جاء", "يقول", "قال",
  "العبارة", "الجملة", "الإجابة", "الاجابة", "الصحيحة", "الصحيح", "صحيح", "خطأ", "خطا", "السؤال", "لذلك",
  "بحسب", "حسب", "وفق", "وفقا", "المعتمد", "المعتمدة", "نص", "يبين", "بين", "يوضح", "أوضح", "اوضح",
];

const STOPWORDS = new Set(RAW_STOPWORDS.map(normalizeArabic));

export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => t.length > 1 && !STOPWORDS.has(t) && !STOPWORDS.has(stripConjunction(t)));
}

/**
 * Fraction of the candidate's content words that also appear in the reference text
 * (matched by light stem or as a substring of the normalised reference).
 * Returns 1 when the candidate has no content words.
 */
export function groundingRatio(candidate: string, reference: string): number {
  const tokens = contentTokens(candidate);
  if (tokens.length === 0) return 1;
  const refNormalized = ` ${normalizeArabic(reference)} `;
  const refStems = new Set(tokenize(reference).map(lightStem));
  const grounded = tokens.filter((t) => refStems.has(lightStem(t)) || (t.length >= 3 && refNormalized.includes(t)));
  return grounded.length / tokens.length;
}

export function containsNormalized(haystack: string, needle: string): boolean {
  const n = normalizeArabic(needle);
  return n.length > 0 && normalizeArabic(haystack).includes(n);
}

/** Phrase match on conjunction-stripped tokens so "والشافعية" matches "الشافعيه". */
export function containsPhrase(text: string, phrase: string): boolean {
  const hay = ` ${tokenize(text).map(stripConjunction).join(" ")} `;
  const needle = tokenize(phrase).map(stripConjunction).join(" ");
  return needle.length > 0 && hay.includes(` ${needle} `);
}

export function jaccard(a: string, b: string): number {
  const sa = new Set(contentTokens(a).map(lightStem));
  const sb = new Set(contentTokens(b).map(lightStem));
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Splits a passage into sentences (used by the development mock provider). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!؟?؛])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
