import {
  contentTokens,
  containsNormalized,
  containsPhrase,
  groundingRatio,
  jaccard,
  lightStem,
  normalizeArabic,
  stripConjunction,
  tokenize,
} from "./arabic";
import { OPTION_IDS, type CandidateQuestion, type DeterministicIssueCode } from "./types";

/**
 * Deterministic, model-free checks applied to every generated question BEFORE the
 * semantic validator runs. Any issue here rejects the question outright.
 *
 * These are conservative heuristics, not proofs: they catch the obvious ways a model
 * leaks knowledge that is not in the approved passage (names, numbers, evidence, reasons,
 * other madhhabs…) and the obvious quality problems. The independent validator then judges
 * what only reading can judge. Thresholds are intentionally strict — a false rejection only
 * costs a regeneration; a false acceptance costs trust.
 */
export const GROUNDING_THRESHOLDS = {
  correctAnswer: 0.6,
  questionStem: 0.3,
  explanation: 0.5,
  /** Content-word overlap at or above which two question stems count as "the same question". */
  duplicateQuestion: 0.7,
  /** The evidence must actually speak about the answer / the explanation it is attached to. */
  answerEvidenceRelevance: 0.5,
  explanationEvidenceRelevance: 0.4,
  /** An answer whose words are mostly already in the question is circular. */
  answerRevealedInQuestion: 0.7,
  /** Two options this alike are the same answer worded twice (so "exactly one correct" cannot hold). */
  nearDuplicateOptions: 0.8,
  /** Lower overlap that already counts as a repeat when the correct answer is the same as the earlier question's. */
  sameAnswerOverlap: 0.4,
  minEvidenceChars: 12,
  maxEvidenceChars: 500,
  maxQuestionChars: 260,
  maxOptionChars: 160,
  maxExplanationChars: 380,
  /** Longest option may be at most this many times the shortest. */
  optionLengthRatio: 2.5,
  /** The correct option may not be the longest by more than this factor over the other options' mean. */
  lengthGiveawayFactor: 1.4,
} as const;

const BANNED_OPTION_PATTERNS = [
  "جميع ما سبق",
  "كل ما سبق",
  "لا شيء مما سبق",
  "لا شيء مما ذكر",
  "جميع ما ذكر",
  "كل ما ذكر",
  "جميع الإجابات",
  "كل الإجابات",
  "جميع الخيارات",
  "كل الخيارات",
  "كلا الخيارين",
  "الخيارات الثلاثة",
  "جميع الإجابات السابقة",
  "كلاهما",
  "لا أعلم",
  "ليس مما سبق",
  "غير ما ذكر",
  "all of the above",
  "none of the above",
].map(normalizeArabic);

/** Names of other madhhabs / their founders / "the majority". Hanbali references are allowed. */
const OTHER_MADHHAB_MARKERS = [
  "الحنفية",
  "الحنفي",
  "الأحناف",
  "أبي حنيفة",
  "أبو حنيفة",
  "المالكية",
  "المالكي",
  "الإمام مالك",
  "مذهب مالك",
  "عند مالك",
  "الشافعية",
  "الشافعي",
  "الظاهرية",
  "ابن حزم",
  "الجعفرية",
  "الزيدية",
  "الإباضية",
  "مذهب آخر",
  "المذاهب الأخرى",
  "المذاهب الأربعة",
  "المذاهب",
  "الجمهور",
  "جمهور العلماء",
  "جمهور الفقهاء",
  "بعض العلماء",
  "أهل العلم",
];

const TARJIH_MARKERS = [
  "الراجح",
  "الأرجح",
  "والراجح",
  "الصحيح من القولين",
  "القول الثاني",
  "القول الآخر",
  "في رواية",
  "وقيل",
  "اختلف العلماء",
  "اختلف الفقهاء",
  "محل خلاف",
  "خلاف",
  "على الصحيح",
  "على الراجح",
];

/** Qur'an / hadith / consensus / scholarly-evidence vocabulary. Rejected unless the passage itself uses it. */
const OUTSIDE_EVIDENCE_MARKERS = [
  "قال رسول الله",
  "قال النبي",
  "قوله تعالى",
  "قال تعالى",
  "في الحديث",
  "الحديث",
  "حديث",
  "رواه",
  "أخرجه",
  "متفق عليه",
  "صلى الله عليه وسلم",
  "ﷺ",
  "رضي الله عنه",
  "رضي الله عنها",
  "رضي الله عنهم",
  "البخاري",
  "مسلم",
  "الترمذي",
  "أبو داود",
  "النسائي",
  "ابن ماجه",
  "آية",
  "الآية",
  "سورة",
  "القرآن",
  "الأثر",
  "الإجماع",
  "بالإجماع",
  "الدليل",
  "الدليل على",
];

const CONDITION_MARKERS = ["بشرط", "شرط", "شرطه", "شروط", "شريطة", "يشترط", "ويشترط", "مشروط"];
const EXCEPTION_MARKERS = ["استثناء", "باستثناء", "يستثنى", "ويستثنى", "ما عدا", "عدا", "إلا إذا", "إلا أن", "إلا أنه", "مستثنى"];
const REASON_MARKERS = ["لأن", "لأنه", "لأنها", "بسبب", "علة", "العلة", "والعلة", "تعليل", "حكمة", "لحكمة", "السبب", "والسبب", "لذلك"];

const SCHOLAR_TITLES = ["الإمام", "الشيخ", "العلامة", "الحافظ", "القاضي", "شيخ الإسلام", "ابن", "أبو", "أبي", "أبا"];

/** Counting words: a quantity the passage does not state is outside knowledge. (The single "واحد" is exempt.) */
const NUMBER_WORDS = [
  "اثنان", "اثنين", "اثنتان", "اثنتين", "ثلاث", "ثلاثة", "أربع", "أربعة", "خمس", "خمسة", "ست", "ستة", "سبع", "سبعة",
  "ثمان", "ثمانية", "تسع", "تسعة", "عشر", "عشرة", "عشرون", "عشرين", "ثلاثون", "ثلاثين", "أربعون", "أربعين", "خمسون", "خمسين",
  "مائة", "مئة", "ألف", "ألفان",
].map((w) => lightStem(normalizeArabic(w)));

/**
 * Phrases that expose the internal architecture or talk about "the text". Always rejected
 * in student-facing fields. The learner never sees a source passage, so wording that refers
 * to one is both confusing and a leak of how the platform works.
 */
const INTERNAL_PHRASES = [
  "المصدر المقدم للنموذج",
  "المصدر المقدم",
  "النص المزود",
  "النص المقدم للنموذج",
  "السياق المعطى للنموذج",
  "سياق النموذج",
  "كتلة الدليل",
  "بلوك الدليل",
  "النص المعتمد",
  "المصدر المعتمد",
  "المقطع المعتمد",
  "السياق المسترجع",
];

/**
 * "According to / as stated in / based on … the text, source, lesson, passage" in ANY wording: a word that points at
 * a document within three words of a word that names a document. Always rejected in student-facing fields.
 */
const REFERRER_WORDS = [
  "بحسب", "حسب", "وفق", "وفقا", "طبقا", "ورد", "وردت", "جاء", "جاءت", "ذكر", "ذكرت", "ذكره", "يذكر", "تذكر", "استنادا", "بناء",
  "قال", "قاله", "يقول", "يقوله", "تقول", "ينص", "نصت", "يوضح", "اوضح", "حسبما", "يشير", "يبين", "يبينه", "يذكره",
  // participles that point at an unnamed document: «التوجيه الوارد في الدرس», «التفصيل المذكور في الطهارة»
  "الوارد", "الواردة", "المذكور", "المذكورة", "المنصوص", "المشار", "المبين", "المبينة",
].map((w) => normalizeArabic(w));
const DOCUMENT_WORDS = ["النص", "المصدر", "الدرس", "المقطع", "السياق", "الفقرة"].map((w) => normalizeArabic(w));
const REFERRER_WINDOW = 3;

/** «كما ورد»، «وفقًا لما ورد»، «بحسب ما ذُكر» — pointing at an unnamed document. */
const POINTER_STANDALONE = ["ورد", "وردت", "يرد", "وفقا", "طبقا", "استنادا", "حسبما"].map((w) => normalizeArabic(w));
const POINTER_PAIR_FIRST = ["كما", "لما"].map((w) => normalizeArabic(w));
const POINTER_PAIR_SECOND = ["جاء", "جاءت", "ذكر", "ذكره", "ذكرت", "يذكر", "نص", "ينص"].map((w) => normalizeArabic(w));

/** «بحسب ما ذكر», «وفقًا لما سبق», «التفصيل المذكور»: an anchor followed closely by a "what was said" word. */
const ANCHORS = ["بحسب", "حسب", "وفق", "وفقا", "طبقا", "استنادا", "كما", "لما", "حسبما"].map((w) => normalizeArabic(w));
const SAID_WORDS = ["ذكر", "ذكره", "سبق", "تقدم", "مر", "ورد", "جاء", "المذكور", "المذكوره", "الوارد", "الوارده", "المتقدم", "المتقدمه"].map((w) => normalizeArabic(w));
const STANDALONE_SAID = ["المذكور", "المذكوره", "الوارد", "الوارده", "المتقدم", "المتقدمه"].map((w) => normalizeArabic(w));

function _unnamedPointer(text: string, passage: string): string | null {
  const tokens = tokenize(text).map(stripConjunction);
  const passageTokens = new Set(tokenize(passage).map(stripConjunction));
  for (let i = 0; i < tokens.length; i++) {
    if (STANDALONE_SAID.includes(tokens[i]) && !passageTokens.has(tokens[i])) return tokens[i];
    if (ANCHORS.includes(tokens[i])) {
      for (let j = i + 1; j <= Math.min(tokens.length - 1, i + 3); j++) {
        if (SAID_WORDS.includes(tokens[j]) && !passageTokens.has(tokens[j])) return `${tokens[i]} … ${tokens[j]}`;
      }
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    if (POINTER_STANDALONE.includes(tokens[i]) && !passageTokens.has(tokens[i])) return tokens[i];
    if (POINTER_PAIR_FIRST.includes(tokens[i]) && POINTER_PAIR_SECOND.includes(tokens[i + 1] ?? "")) return `${tokens[i]} ${tokens[i + 1]}`;
  }
  return null;
}

function _mentionsDocument(text: string): string | null {
  const tokens = tokenize(text).map(stripConjunction);
  for (let i = 0; i < tokens.length; i++) {
    if (!DOCUMENT_WORDS.includes(tokens[i])) continue;
    for (let j = Math.max(0, i - REFERRER_WINDOW); j < i; j++) {
      if (REFERRER_WORDS.includes(tokens[j])) return `${tokens[j]} … ${tokens[i]}`;
    }
    // «الدرس يقول …», «النص يذكر …»
    for (let j = i + 1; j <= Math.min(tokens.length - 1, i + 2); j++) {
      if (REFERRER_WORDS.includes(tokens[j]) && !tokens[j].startsWith("ال")) return `${tokens[i]} … ${tokens[j]}`;
    }
  }
  return null;
}

/** Single words that are internal vocabulary — rejected unless the passage itself uses them. */
const _INTERNAL_WORDS = ["النص", "المصدر", "السياق", "المقطع", "الفقرة", "المعتمد", "المعتمدة"];

const LATIN_INTERNAL = /source\s*passage|sourcepassage|provided\s+source|retrieved\s+context|\brag\b|validator|gemini|\bai\b|approved\s+source|prompt|grounding|\bllm\b|evidence\s+block/i;

/**
 * Words that carry the DEGREE of a statement: negation, absoluteness, quantity and the ruling category.
 * A paraphrase that brings one of them in without the excerpt that proves it containing the same word
 * changes the meaning ("لا كلام لنا فيه ولا في علاجه" → "ليس له علاج"). Rejected; regeneration will quote or restate faithfully.
 */
const SHIFT_WORDS = [
  // negation
  "ليس", "ليست", "لا", "لم", "لن", "غير", "بلا", "دون", "عدم",
  // absoluteness / quantity
  "كل", "كلها", "جميع", "كافة", "دائما", "ابدا", "مطلقا", "تماما", "نهائيا", "قطعا", "حتما", "بالضرورة", "فقط", "وحده", "حصرا",
  "بعض", "معظم", "اغلب", "اكثر", "اقل", "غالبا", "احيانا", "كثيرا", "قليلا",
  // possibility / necessity / ruling category
  "قد", "ربما", "يمكن", "يجوز", "يجب", "واجب", "ينبغي", "يستحب", "مستحب", "مباح", "مكروه", "يكره", "حرام", "يحرم",
].map((w) => stripConjunction(normalizeArabic(w)));

/** A token and, when it starts with a conjunction (و/ف), the token without it — «ولا» also counts as «لا». */
function conjunctionForms(token: string): string[] {
  const forms = [stripConjunction(token)];
  if (token.length >= 3 && (token.startsWith("و") || token.startsWith("ف"))) forms.push(token.slice(1));
  forms.push(token);
  return forms;
}

export function shiftWordsNotIn(generated: string, reference: string): string[] {
  const ref = new Set(tokenize(reference).flatMap(conjunctionForms));
  const found: string[] = [];
  for (const token of tokenize(generated)) {
    const word = conjunctionForms(token).find((form) => SHIFT_WORDS.includes(form));
    if (word && !ref.has(word)) found.push(word);
  }
  return Array.from(new Set(found));
}

/** Hedges and quantifiers: dropping one turns "sometimes / most / may" into a flat statement. */
const HEDGES = [
  "احيانا", "غالب", "غالبا", "اغلب", "معظم", "بعض", "اكثر", "اقل", "كثيرا", "كثير", "قليلا", "نادرا", "قلما", "ربما", "يمكن", "عادة",
].map((w) => stripConjunction(normalizeArabic(w)));

/**
 * Hedge words the cited excerpt contains, and that the generated statement DROPS while re-using the words they modify
 * («واحيانا العجلة تكون بباعث من الشيطان» → «العجلة تكون بباعث من الشيطان»;
 *  «وقع فيه غالب المعلمين» → «وقع فيه المعلمون»).
 */
export function droppedHedges(generated: string, evidence: string): string[] {
  const ev = tokenize(evidence);
  const genForms = new Set(tokenize(generated).flatMap(conjunctionForms));
  const genStems = new Set(tokenize(generated).map((t) => lightStem(stripConjunction(t))));
  const dropped: string[] = [];
  for (let i = 0; i < ev.length; i++) {
    const hedge = conjunctionForms(ev[i]).find((form) => HEDGES.includes(form));
    if (!hedge || genForms.has(hedge)) continue;
    // the two content words that follow the hedge in the excerpt
    const modified = ev.slice(i + 1, i + 5).filter((t) => contentTokens(t).length > 0).slice(0, 2);
    if (modified.some((t) => genStems.has(lightStem(stripConjunction(t))))) dropped.push(hedge);
  }
  return Array.from(new Set(dropped));
}

/**
 * A negation word must keep the SAME next word as in the excerpt: «ولا في علاجه» may be restated as «ولا في علاجه»,
 * not as «لا علاج له». (Compared by light stem; a restatement that changes what the negation applies to is rejected.)
 */
const NEGATION_WORDS = ["ليس", "ليست", "لا", "لم", "لن", "غير", "بلا", "دون", "عدم"].map((w) => stripConjunction(normalizeArabic(w)));

export function shiftContextMismatch(generated: string, evidence: string): string[] {
  const ev = tokenize(evidence);
  const gen = tokenize(generated);
  const nextAfter = new Map<string, Set<string>>();
  for (let i = 0; i < ev.length - 1; i++) {
    const word = conjunctionForms(ev[i]).find((form) => NEGATION_WORDS.includes(form));
    if (!word) continue;
    if (!nextAfter.has(word)) nextAfter.set(word, new Set());
    nextAfter.get(word)!.add(lightStem(stripConjunction(ev[i + 1])));
  }
  const mismatched: string[] = [];
  for (let i = 0; i < gen.length - 1; i++) {
    const word = conjunctionForms(gen[i]).find((form) => NEGATION_WORDS.includes(form));
    const allowed = word ? nextAfter.get(word) : undefined;
    if (!word || !allowed) continue; // absent from the excerpt altogether → handled by shiftWordsNotIn
    if (!allowed.has(lightStem(stripConjunction(gen[i + 1])))) mismatched.push(`${word} ${gen[i + 1]}`);
  }
  return Array.from(new Set(mismatched));
}

/** Concrete, student-safe pointers for the retry: WHICH phrase / word triggered a deterministic rejection. */
export function explainRejection(candidate: CandidateQuestion, passage: string): string[] {
  const notes: string[] = [];
  const studentFacing = [candidate.question, ...candidate.options, candidate.explanation].join(" ");
  const wording = findInternalWording(studentFacing, passage);
  if (wording.length) notes.push(`Remove these references to a text/lesson/source and state the point directly: ${wording.join(" | ")}`);
  const parts: Array<[string, string, string]> = [
    ["correct answer", candidate.correctAnswer, candidate.answerEvidence],
    ["explanation", candidate.explanation, candidate.explanationEvidence],
  ];
  for (const [label, text, evidence] of parts) {
    const added = shiftWordsNotIn(text, evidence);
    if (added.length) notes.push(`The ${label} uses degree/negation words that its excerpt does not contain: ${added.join("، ")} — use the excerpt's own words`);
    const dropped = droppedHedges(text, evidence);
    if (dropped.length) notes.push(`The ${label} drops the hedge/quantifier «${dropped.join("، ")}» that its excerpt contains`);
    const moved = shiftContextMismatch(text, evidence);
    if (moved.length) notes.push(`The ${label} changes what a negation applies to (${moved.join(" | ")}) — keep the excerpt's wording after the negation`);
  }
  const inQuestion = shiftWordsNotIn(candidate.question, passage);
  if (inQuestion.length) notes.push(`The question uses degree/negation words not found in the source: ${inQuestion.join("، ")}`);
  return notes;
}

export type CheckContext = {
  passageText: string;
  /** Questions already shown (or banked) for this concept: the new one must differ from every one. */
  previousQuestions: string[];
  /** The approved baseline questions of the concept (a separate rejection code). */
  baselineQuestions?: string[];
  /** The correct answer of each entry of `previousQuestions` (same index; "" when unknown). */
  previousAnswers?: string[];
};

/** Exposed so the UI/tests can apply the same guard to any student-facing string. */
export function findInternalWording(text: string, _passage = ""): string[] {
  const found: string[] = [];
  for (const phrase of INTERNAL_PHRASES) {
    if (containsPhrase(text, phrase)) found.push(phrase);
  }
  const latin = text.match(LATIN_INTERNAL);
  if (latin) found.push(latin[0]);
  return Array.from(new Set(found));
}

function markerPresent(generated: string, passage: string, markers: string[]): boolean {
  return markers.some((m) => containsPhrase(generated, m) && !containsPhrase(passage, m));
}

function arabicDigitsToLatin(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function numbersNotInSource(generated: string, passage: string): boolean {
  const digitsOf = (text: string) => new Set(arabicDigitsToLatin(text).match(/\d+/g) ?? []);
  const passageDigits = digitsOf(passage);
  for (const digits of digitsOf(generated)) if (!passageDigits.has(digits)) return true;

  const stems = (text: string) => new Set(tokenize(text).map((t) => lightStem(stripConjunction(t))));
  const passageStems = stems(passage);
  for (const stem of stems(generated)) if (NUMBER_WORDS.includes(stem) && !passageStems.has(stem)) return true;
  return false;
}

function scholarNameNotInSource(generated: string, passage: string): boolean {
  const generatedTokens = tokenize(generated);
  const passageNames = new Set(tokenize(passage).map((token) => lightStem(stripConjunction(token))));
  const titles = SCHOLAR_TITLES.map(normalizeArabic);
  const genericFollowers = new Set(
    ["في", "من", "عن", "على", "عند", "بعد", "قبل", "ما", "ماذا", "الذي", "التي", "هذا", "ذلك", "فعله", "لنا", "لدفع", "كاساس", "كالاساس", "مباشر", "المباشر", "يقول", "قال", "ذكر"].map(
      (word) => lightStem(stripConjunction(normalizeArabic(word))),
    ),
  );
  for (let i = 0; i < generatedTokens.length - 1; i++) {
    const title = stripConjunction(generatedTokens[i]);
    if (!titles.includes(title)) continue;
    let nameIndex = i + 1;
    if (["ابن", "ابو", "ابي", "ابا"].includes(stripConjunction(generatedTokens[nameIndex])) && nameIndex + 1 < generatedTokens.length) nameIndex++;
    const name = lightStem(stripConjunction(generatedTokens[nameIndex]));
    if (genericFollowers.has(name)) continue;
    // Verify the identifying name, not an exact title/name bigram: titles vary harmlessly.
    if (!passageNames.has(name)) return true;
  }
  // "شيخ الإسلام ابن تيمية" style multi-word titles
  for (const phrase of ["شيخ الاسلام"]) {
    if (containsPhrase(generated, phrase) && !containsPhrase(passage, phrase)) return true;
  }
  return false;
}

function arabicRatio(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return 1;
  const arabic = text.match(/[؀-ۿݐ-ݿࢠ-ࣿ]/gu) ?? [];
  return arabic.length / letters.length;
}

const OPTION_LABEL = /^\s*(?:[A-Da-d]|[أبجد])\s*[).:\-–]\s+/;

export function runDeterministicChecks(candidate: CandidateQuestion, ctx: CheckContext): DeterministicIssueCode[] {
  const issues = new Set<DeterministicIssueCode>();
  const passage = ctx.passageText;
  const options = candidate.options.map((o) => o.trim());
  const studentFacing = [candidate.question, ...options, candidate.explanation].join(" \n ");

  // ── Structure ──
  if (options.length !== OPTION_IDS.length) issues.add("OPTION_COUNT_INVALID");
  if (!OPTION_IDS.includes(candidate.correctOptionId)) issues.add("OPTION_IDS_INVALID");
  const correctIndex = OPTION_IDS.indexOf(candidate.correctOptionId);
  if (correctIndex < 0 || options[correctIndex] !== candidate.correctAnswer.trim()) issues.add("CORRECT_ANSWER_NOT_IN_OPTIONS");
  const normalizedOptions = options.map(normalizeArabic);
  if (new Set(normalizedOptions).size !== normalizedOptions.length) issues.add("DUPLICATE_OPTIONS");
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      if (jaccard(options[i], options[j]) >= GROUNDING_THRESHOLDS.nearDuplicateOptions) issues.add("NEAR_DUPLICATE_OPTIONS");
    }
  }
  if (normalizedOptions.some((o) => BANNED_OPTION_PATTERNS.some((p) => o.includes(p)))) issues.add("BANNED_OPTION_PATTERN");
  if (options.some((o) => OPTION_LABEL.test(o))) issues.add("OPTION_HAS_LABEL");
  if (!candidate.explanation.trim()) issues.add("EXPLANATION_EMPTY");

  // ── Length / balance of options ──
  const lengths = normalizedOptions.map((o) => o.length);
  if (lengths.length === OPTION_IDS.length && Math.min(...lengths) > 0) {
    if (Math.max(...lengths) / Math.min(...lengths) > GROUNDING_THRESHOLDS.optionLengthRatio) issues.add("OPTION_LENGTH_IMBALANCE");
    if (correctIndex >= 0) {
      const others = lengths.filter((_, i) => i !== correctIndex);
      const mean = others.reduce((a, b) => a + b, 0) / others.length;
      if (lengths[correctIndex] > Math.max(...others) && lengths[correctIndex] > mean * GROUNDING_THRESHOLDS.lengthGiveawayFactor) {
        issues.add("CORRECT_ANSWER_LENGTH_GIVEAWAY");
      }
    }
  }
  if (
    candidate.question.length > GROUNDING_THRESHOLDS.maxQuestionChars ||
    options.some((o) => o.length > GROUNDING_THRESHOLDS.maxOptionChars) ||
    candidate.explanation.length > GROUNDING_THRESHOLDS.maxExplanationChars
  ) {
    issues.add("TEXT_TOO_LONG");
  }

  // ── Evidence: both excerpts must exist verbatim in the approved passage (server-verified) ──
  const answerEvidence = candidate.answerEvidence.trim();
  const explanationEvidence = candidate.explanationEvidence.trim();
  const evidenceOk = (value: string) => normalizeArabic(value).length >= GROUNDING_THRESHOLDS.minEvidenceChars && containsNormalized(passage, value);
  if (!evidenceOk(answerEvidence)) issues.add("ANSWER_EVIDENCE_NOT_VERBATIM");
  if (!evidenceOk(explanationEvidence)) issues.add("EXPLANATION_EVIDENCE_NOT_VERBATIM");
  if (answerEvidence.length > GROUNDING_THRESHOLDS.maxEvidenceChars || explanationEvidence.length > GROUNDING_THRESHOLDS.maxEvidenceChars) {
    issues.add("EVIDENCE_TOO_BROAD");
  }

  // An evidence excerpt that is verbatim but about something else proves nothing.
  if (evidenceOk(answerEvidence) && groundingRatio(candidate.correctAnswer, answerEvidence) < GROUNDING_THRESHOLDS.answerEvidenceRelevance) {
    issues.add("ANSWER_EVIDENCE_NOT_RELEVANT");
  }
  if (evidenceOk(explanationEvidence) && candidate.explanation.trim() && groundingRatio(candidate.explanation, `${explanationEvidence} ${candidate.question}`) < GROUNDING_THRESHOLDS.explanationEvidenceRelevance) {
    issues.add("EXPLANATION_EVIDENCE_NOT_RELEVANT");
  }
  // Degree / negation / modality words must come from the excerpt that proves the statement (the question: from the passage).
  if (
    (evidenceOk(answerEvidence) &&
      (shiftWordsNotIn(candidate.correctAnswer, answerEvidence).length > 0 ||
        droppedHedges(candidate.correctAnswer, answerEvidence).length > 0 ||
        shiftContextMismatch(candidate.correctAnswer, answerEvidence).length > 0)) ||
    (evidenceOk(explanationEvidence) &&
      (shiftWordsNotIn(candidate.explanation, explanationEvidence).length > 0 ||
        droppedHedges(candidate.explanation, explanationEvidence).length > 0 ||
        shiftContextMismatch(candidate.explanation, explanationEvidence).length > 0)) ||
    shiftWordsNotIn(candidate.question, passage).length > 0
  ) {
    issues.add("MEANING_SHIFT_MARKER");
  }
  // The question must not already contain its own answer.
  const answerTokens = contentTokens(candidate.correctAnswer);
  if (answerTokens.length >= 2) {
    const questionStems = new Set(contentTokens(candidate.question).map(lightStem));
    const inQuestion = answerTokens.filter((t) => questionStems.has(lightStem(t))).length / answerTokens.length;
    if (inQuestion >= GROUNDING_THRESHOLDS.answerRevealedInQuestion) issues.add("ANSWER_REVEALED_IN_QUESTION");
  }

  // ── Grounding in the approved passage ──
  if (groundingRatio(candidate.correctAnswer, passage) < GROUNDING_THRESHOLDS.correctAnswer) issues.add("ANSWER_NOT_GROUNDED");
  if (groundingRatio(candidate.question, passage) < GROUNDING_THRESHOLDS.questionStem) issues.add("QUESTION_NOT_GROUNDED");
  const explanationReference = [passage, candidate.question, ...options].join(" ");
  if (candidate.explanation.trim() && groundingRatio(candidate.explanation, explanationReference) < GROUNDING_THRESHOLDS.explanation) {
    issues.add("EXPLANATION_NOT_GROUNDED");
  }

  // ── Knowledge that must come from the passage or nowhere ──
  if (markerPresent(studentFacing, passage, OTHER_MADHHAB_MARKERS)) issues.add("OTHER_MADHHAB_MARKER");
  if (markerPresent(studentFacing, passage, TARJIH_MARKERS)) issues.add("TARJIH_MARKER");
  if (markerPresent(studentFacing, passage, OUTSIDE_EVIDENCE_MARKERS) || (/[﴿﴾]/.test(studentFacing) && !/[﴿﴾]/.test(passage))) {
    issues.add("OUTSIDE_EVIDENCE_MARKER");
  }
  if (markerPresent(studentFacing, passage, CONDITION_MARKERS)) issues.add("UNSUPPORTED_CONDITION_MARKER");
  if (markerPresent(studentFacing, passage, EXCEPTION_MARKERS)) issues.add("UNSUPPORTED_EXCEPTION_MARKER");
  if (markerPresent(studentFacing, passage, REASON_MARKERS)) issues.add("UNSUPPORTED_REASON_MARKER");
  // Inspect each learner-facing field independently so a title at the end of one field
  // cannot be paired with the first word of the next field.
  if ([candidate.question, ...options, candidate.explanation].some((field) => scholarNameNotInSource(field, passage))) issues.add("SCHOLAR_NAME_NOT_IN_SOURCE");
  // A distractor is a false statement by design, so only what the learner is told is true must carry numbers the source states.
  if (numbersNotInSource([candidate.question, candidate.correctAnswer, candidate.explanation].join(" "), passage)) issues.add("NUMBER_NOT_IN_SOURCE");

  // ── Student-facing wording and language ──
  if (findInternalWording(studentFacing, passage).length > 0) issues.add("INTERNAL_WORDING");
  if (arabicRatio(studentFacing) < 0.9 || /[A-Za-z]/.test(studentFacing)) issues.add("LANGUAGE_INVALID");

  // ── Novelty ──
  const sameAs = (list: string[]) => list.some((prev) => jaccard(prev, candidate.question) >= GROUNDING_THRESHOLDS.duplicateQuestion);
  if (ctx.baselineQuestions && sameAs(ctx.baselineQuestions)) issues.add("REPEATS_BASELINE");
  if (sameAs(ctx.previousQuestions)) issues.add("DUPLICATE_OF_PREVIOUS");
  // The same fact asked again with a reworded stem: same correct answer AND an overlapping question.
  const answer = normalizeArabic(candidate.correctAnswer);
  const restated = ctx.previousQuestions.some(
    (prev, i) => answer.length > 0 && normalizeArabic(ctx.previousAnswers?.[i] ?? "") === answer && jaccard(prev, candidate.question) >= GROUNDING_THRESHOLDS.sameAnswerOverlap,
  );
  if (restated) issues.add("DUPLICATE_OF_PREVIOUS");

  return [...issues];
}
