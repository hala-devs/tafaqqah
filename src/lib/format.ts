const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

/** Converts Western digits to Arabic-Indic digits for display. */
export function ar(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => ARABIC_DIGITS[Number(d)]);
}

/** Two-digit, Arabic-Indic step number used on the learning path (٠١، ٠٢ …). */
export function stepNumber(n: number): string {
  return ar(String(n).padStart(2, "0"));
}

const ORDINALS = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر"];

export function ordinalLesson(n: number): string {
  return n >= 1 && n <= ORDINALS.length ? `الدرس ${ORDINALS[n - 1]}` : `الدرس ${ar(n)}`;
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-arab", { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(date),
  );
}

/** Arabic plural forms for counted nouns: [one, two, few (3–10), many (11+)]. */
export function countLabel(n: number, forms: [string, string, string, string]): string {
  if (n === 1) return forms[0];
  if (n === 2) return forms[1];
  if (n >= 3 && n <= 10) return `${ar(n)} ${forms[2]}`;
  return `${ar(n)} ${forms[3]}`;
}

/** Natural learner-facing count for lessons that are available to study. */
export function availableLessonsLabel(n: number): string {
  if (n === 0) return "لا دروس متاحة الآن";
  if (n === 1) return "درس واحد متاح";
  if (n === 2) return "درسان متاحان";
  return n <= 10 ? `${ar(n)} دروس متاحة` : `${ar(n)} درسًا متاحًا`;
}

/** A compact, grammatical denominator for progress statements. */
export function lessonDenominator(n: number): string {
  if (n === 1) return "درس واحد";
  if (n === 2) return "درسين";
  return n <= 10 ? `${ar(n)} دروس` : `${ar(n)} درسًا`;
}

/** Internal staging notes stored in content descriptions — never shown to learners. */
const INTERNAL_DESCRIPTION_NOTES = [
  /^مادة تفريغ زمنية مورّدة للمراجعة البشرية قبل النشر والاعتماد\.?$/,
  /^فقه العبادات — تفريغ زمني مورّد للمراجعة البشرية قبل النشر\.?$/,
  /\s*تُفتح بعد إدخال المادة المعتمدة\.?/,
];

/** Learner-facing copy of a lesson/chapter description, without internal staging notes. */
export function learnerDescription(text: string | null | undefined): string {
  let out = (text ?? "").trim();
  for (const note of INTERNAL_DESCRIPTION_NOTES) out = out.replace(note, "").trim();
  return out;
}
