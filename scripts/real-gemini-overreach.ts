/**
 * REAL Gemini test of SEMANTIC OVERREACH — no mocks.
 *
 * Takes the approved Lesson 1 passages and builds candidate questions that are well-formed and verbatim-grounded
 * but whose paraphrase CHANGES or WIDENS the meaning (negation, degree, generality, necessity, causality…).
 * Each case is run two ways:
 *   FULL    the production QuestionValidator (server checks, then the model) — what a learner is protected by
 *   MODEL   only the real Gemini validator, bypassing the server checks — proves the model itself rejects
 * Faithful controls must PASS, so the guard is not simply rejecting everything.
 *
 *   npx tsx --conditions=react-server scripts/real-gemini-overreach.ts [outfile.json]
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { getAIProvider } from "../src/server/ai/factory";
import { containsNormalized } from "../src/server/ai/arabic";
import { buildValidatorUserPrompt, VALIDATOR_SYSTEM_PROMPT } from "../src/server/ai/prompts";
import { evaluateModelReview, QuestionValidator } from "../src/server/ai/question-validator";
import { parseValidatorOutput } from "../src/server/ai/schemas";
import type { CandidateQuestion, TrustedPassage } from "../src/server/ai/types";

type Case = {
  id: string;
  kind: string;
  passage: string;
  /** What the learner must be protected from (or, for controls, what is faithful). */
  note: string;
  expect: "REJECT" | "PASS";
  question: string;
  options: [string, string, string, string];
  correct: 0 | 1 | 2 | 3;
  explanation: string;
  answerEvidence: [string, string];
  explanationEvidence: [string, string];
};

/** Verbatim slice of the passage from `start` up to and including `end`. */
function cut(raw: string, [start, end]: [string, string]): string {
  const text = raw.replace(/s+/g, " ");
  const from = text.indexOf(start);
  if (from < 0) throw new Error(`start phrase not found: ${start}`);
  // "phrase|+N" = through the N words that follow the phrase
  const [phrase, extra] = end.split("|+");
  const to = text.indexOf(phrase, from);
  if (to < 0) throw new Error(`end phrase not found: ${phrase}`);
  let stop = to + phrase.length;
  for (let i = 0; i < Number(extra ?? 0); i++) {
    const next = text.indexOf(" ", stop + 1);
    stop = next < 0 ? text.length : next;
  }
  return text.slice(from, stop);
}

const CASES: Case[] = [
  {
    id: "C0",
    kind: "control: faithful restatement",
    passage: "lesson-akhsar-01-passage-04",
    note: "explanation restates the excerpt without changing it",
    expect: "PASS",
    question: "ما السبب الأول الذي ذكره ابن بدران لعدم ارتقاء الطالب رغم طول السنين؟",
    options: ["عدم الذكاء الفطري", "الجهل بطرق التعليم", "كثرة حضور الدروس", "قلة عدد المشايخ"],
    correct: 0,
    explanation: "السبب الأول هو عدم الذكاء الفطري وانتفاء الإدراك التصوري.",
    answerEvidence: ["قال احدهما عدم الذكاء الفطري", "الادراك التصوري"],
    explanationEvidence: ["قال احدهما عدم الذكاء الفطري", "الادراك التصوري"],
  },
  {
    id: "C1",
    kind: "THE REPORTED EXAMPLE: «لا كلام لنا فيه ولا في علاجه» → «ليس له علاج»",
    passage: "lesson-akhsar-01-passage-04",
    note: "the cited excerpt puts the remedy outside the discussion; it does not say there is no remedy",
    expect: "REJECT",
    question: "ما السبب الأول الذي ذكره ابن بدران لعدم ارتقاء الطالب رغم طول السنين؟",
    options: ["عدم الذكاء الفطري", "الجهل بطرق التعليم", "كثرة حضور الدروس", "قلة عدد المشايخ"],
    correct: 0,
    explanation: "السبب الأول هو عدم الذكاء الفطري وانتفاء الإدراك التصوري، وهذا ليس له علاج.",
    answerEvidence: ["قال احدهما عدم الذكاء الفطري", "الادراك التصوري"],
    explanationEvidence: ["قال احدهما عدم الذكاء الفطري", "ولا في علاجه"],
  },
  {
    id: "C1b",
    kind: "same overreach, worded to avoid the negation word «ليس» (only the model can catch it)",
    passage: "lesson-akhsar-01-passage-04",
    note: "«لا علاج له» still asserts that no remedy exists",
    expect: "REJECT",
    question: "ما السبب الأول الذي ذكره ابن بدران لعدم ارتقاء الطالب رغم طول السنين؟",
    options: ["عدم الذكاء الفطري", "الجهل بطرق التعليم", "كثرة حضور الدروس", "قلة عدد المشايخ"],
    correct: 0,
    explanation: "السبب الأول هو عدم الذكاء الفطري وانتفاء الإدراك التصوري، ولا علاج له.",
    answerEvidence: ["قال احدهما عدم الذكاء الفطري", "الادراك التصوري"],
    explanationEvidence: ["قال احدهما عدم الذكاء الفطري", "ولا في علاجه"],
  },
  {
    id: "C2",
    kind: "control: the same claim IS supported when the cited excerpt states it",
    passage: "lesson-akhsar-01-passage-04",
    note: "the lecturer's own gloss «هذا ليس له علاج هذا علاج بيد الله» is the cited evidence",
    expect: "PASS",
    question: "ما السبب الأول الذي ذكره ابن بدران لعدم ارتقاء الطالب رغم طول السنين؟",
    options: ["عدم الذكاء الفطري", "الجهل بطرق التعليم", "كثرة حضور الدروس", "قلة عدد المشايخ"],
    correct: 0,
    explanation: "عدم الذكاء الفطري ليس له علاج، وعلاجه بيد الله.",
    answerEvidence: ["قال احدهما عدم الذكاء الفطري", "الادراك التصوري"],
    explanationEvidence: ["يقول عدم الذكاء الفطري", "بيد الله"],
  },
  {
    id: "C3",
    kind: "generality: «بعض أو أكثر أو كل» → «كل»",
    passage: "lesson-akhsar-01-passage-08",
    note: "the source says some, most or all of the imams; the answer says all (narrows it)",
    expect: "REJECT",
    question: "ماذا يراد بمصطلح «وجه» عند الحنابلة؟",
    options: ["قول لكل أئمة المذهب", "قول من الإمام أحمد", "رأي مخالف للمذهب", "حديث نبوي مرفوع"],
    correct: 0,
    explanation: "إذا قيل وجه فيراد به قول لكل أئمة المذهب.",
    answerEvidence: ["واذا قيل وجه فيراد به", "او كل|+2"],
    explanationEvidence: ["واذا قيل وجه فيراد به", "او كل|+2"],
  },
  {
    id: "C4",
    kind: "degree dropped: «أحيانًا … تكون» → «تكون»",
    passage: "lesson-akhsar-01-passage-06",
    note: "the source says the hurry is SOMETIMES from the devil; the answer says it is (always) from the devil",
    expect: "REJECT",
    question: "ما مصدر العجلة في طلب العلم؟",
    options: ["الحرص على الوقت", "باعث من الشيطان", "قوة الذكاء", "كثرة المشايخ"],
    correct: 1,
    explanation: "العجلة في طلب العلم تكون بباعث من الشيطان.",
    answerEvidence: ["واحيانا العجلة تكون بباعث من الشيطان", "لمة ملك"],
    explanationEvidence: ["واحيانا العجلة تكون بباعث من الشيطان", "لمة ملك"],
  },
  {
    id: "C5",
    kind: "quantifier dropped: «غالب المعلمين» → «المعلمون»",
    passage: "lesson-akhsar-01-passage-04",
    note: "the source says most teachers fell into this; the answer says the teachers (all)",
    expect: "REJECT",
    question: "من الذين وقعوا في الجهل بطرق التعليم؟",
    options: ["المعلمون", "الطلاب المبتدئون", "أصحاب الحواشي", "أهل النحو"],
    correct: 0,
    explanation: "وقع في الجهل بطرق التعليم المعلمون.",
    answerEvidence: ["والثاني الجهل بطرق التعليم", "غالب المعلمين"],
    explanationEvidence: ["والثاني الجهل بطرق التعليم", "غالب المعلمين"],
  },
  {
    id: "C6",
    kind: "affirmation flipped to negation: «يسلبه الطهورية» → «لا يسلبه الطهورية»",
    passage: "lesson-akhsar-01-passage-12",
    note: "the source says a mixing substance DOES take away purifying power; the answer negates it",
    expect: "REJECT",
    question: "ما أثر التغير بشيء ممازج يذوب في الماء؟",
    options: ["لا يسلب الماء الطهورية", "يسلب الماء الطهورية", "يجعل الماء نجسا", "يجعل الماء مكروها"],
    correct: 0,
    explanation: "التغير بالممازج الذي يذوب في الماء لا يسلب الماء الطهورية.",
    answerEvidence: ["بممازج طيب هذا الممازج الذي يذوب في الماء ويمتزج به", "يسلبه الطهورية"],
    explanationEvidence: ["بممازج طيب هذا الممازج الذي يذوب في الماء ويمتزج به", "يسلبه الطهورية"],
  },
  {
    id: "C7",
    kind: "distractor that is also correct (two faithful options)",
    passage: "lesson-akhsar-01-passage-08",
    note: "options A and B both restate «قول من الإمام أحمد» — more than one correct answer",
    expect: "REJECT",
    question: "ماذا يعني الحنابلة بمصطلح «رواية»؟",
    options: ["قول من الإمام أحمد", "قول للإمام أحمد", "قول لأئمة المذهب", "رأي لأحد المشايخ"],
    correct: 0,
    explanation: "إذا قالوا رواية فيعنون قولا من الإمام أحمد.",
    answerEvidence: ["إذا قالوا رواية يعني هو قول من الإمام احمد", "للامام احمد"],
    explanationEvidence: ["إذا قالوا رواية يعني هو قول من الإمام احمد", "للامام احمد"],
  },
  {
    id: "C8",
    kind: "question presupposes an unsupported claim",
    passage: "lesson-akhsar-01-passage-04",
    note: "the question assumes that the remedy is impossible, which the source never says",
    expect: "REJECT",
    question: "لماذا يستحيل علاج عدم الذكاء الفطري؟",
    options: ["لأنه راجع إلى الفطرة", "لأنه قليل الحدوث", "لأن المشايخ كثيرون", "لأن الكتب مطولة"],
    correct: 0,
    explanation: "عدم الذكاء الفطري مرده إلى الفطرة.",
    answerEvidence: ["مرده رجوعه إلى الفطرة", "رجوعه إلى الفطرة"],
    explanationEvidence: ["مرده رجوعه إلى الفطرة", "رجوعه إلى الفطرة"],
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Real calls on a free-tier key: pace them and wait out 429s instead of reporting them as verdicts. */
async function withRetry<T>(fn: () => Promise<T>, isRateLimit: (value: T) => boolean = () => false): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const value = await fn();
      if (!isRateLimit(value) || attempt >= 4) return value;
    } catch (error) {
      if (!(error instanceof Error && /rate limit/i.test(error.message)) || attempt >= 4) throw error;
    }
    await sleep(25_000);
  }
}

async function main() {
  const outFile = process.argv[2];
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const provider = getAIProvider();
  if (provider.isDevelopmentMock) throw new Error("Refusing to run with the development mock.");
  console.log(`provider=${provider.name} validatorModel=${provider.validatorModel}\n`);
  const validator = new QuestionValidator(provider);
  const rows: unknown[] = [];

  for (const c of CASES) {
    const row = await db.sourcePassage.findUniqueOrThrow({ where: { id: c.passage } });
    const passage: TrustedPassage = { id: row.id, version: row.version, text: row.text, sourceTitle: row.sourceTitle, sourceAuthor: row.sourceAuthor, sourceReference: row.sourceReference };
    const answerEvidence = cut(row.text, c.answerEvidence);
    const explanationEvidence = cut(row.text, c.explanationEvidence);
    if (!containsNormalized(row.text, answerEvidence) || !containsNormalized(row.text, explanationEvidence)) throw new Error(`${c.id}: evidence not verbatim`);
    const candidate: CandidateQuestion = {
      status: "OK",
      questionType: "MCQ",
      question: c.question,
      options: [...c.options],
      correctOptionId: (["A", "B", "C", "D"] as const)[c.correct],
      correctAnswer: c.options[c.correct],
      explanation: c.explanation,
      answerEvidence,
      explanationEvidence,
    };

    // FULL: the production validator (server checks + model).
    const full = await withRetry(
      () => validator.validate({ passage, conceptTitle: "تحقق", candidate, previousQuestions: [], previousAnswers: [] }),
      (v) => v.providerError?.code === "RATE_LIMITED",
    );
    const fullLayer = full.deterministicIssues.length ? "SERVER CHECKS" : full.providerError ? "PROVIDER ERROR" : "GEMINI VALIDATOR";

    // MODEL: Gemini alone, twice, bypassing the server checks.
    const model: string[] = [];
    const modelDetail: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      const request = { passage, conceptTitle: "تحقق", candidate, correctIndex: c.correct, previousQuestions: [] as string[] };
      try {
        await sleep(2500);
        const response = await withRetry(() => provider.validateQuestion(request, { system: VALIDATOR_SYSTEM_PROMPT, user: buildValidatorUserPrompt(request) }));
        const parsed = parseValidatorOutput(response.data);
        if (!parsed.ok) {
          model.push("MALFORMED");
          continue;
        }
        // The reviewer model's own verdict, judged by the server's claim-by-claim rules but WITHOUT the server's lexical checks.
        const review = evaluateModelReview(passage, candidate, c.correct, parsed.value);
        const ownVerdict = parsed.value.valid && parsed.value.claims.every((claim) => claim.relation === "IDENTICAL");
        model.push(review.issues.size === 0 ? "PASS" : "REJECT");
        modelDetail.push({
          modelSaidValid: parsed.value.valid,
          modelOwnClaimsAllIdentical: ownVerdict,
          relations: parsed.value.claims.map((claim) => `${claim.subject}:${claim.relation}`),
          serverIssues: [...review.issues],
          claimReasons: review.claimReasons,
        });
      } catch (error) {
        model.push(`ERROR ${error instanceof Error ? error.message : error}`);
      }
    }

    const fullVerdict = full.valid ? "PASS" : "REJECT";
    const ok = fullVerdict === c.expect;
    console.log(`${ok ? "✔" : "✘"} ${c.id} [expected ${c.expect}] FULL=${fullVerdict}${full.valid ? "" : ` by ${fullLayer} (${full.issues.join(", ")})`}  MODEL-ONLY=${model.join("/")}\n    ${c.kind}`);
    rows.push({ id: c.id, kind: c.kind, expect: c.expect, fullVerdict, fullLayer: full.valid ? null : fullLayer, fullIssues: full.issues, fullReasons: full.result.reasons, modelOnly: model, modelDetail, candidate, note: c.note });
  }

  const wrong = (rows as { id: string; expect: string; fullVerdict: string }[]).filter((r) => r.expect !== r.fullVerdict);
  console.log(`\nFULL pipeline matched expectation in ${rows.length - wrong.length}/${rows.length} cases${wrong.length ? ` — MISMATCH: ${wrong.map((w) => w.id).join(", ")}` : ""}`);
  if (outFile) writeFileSync(outFile, JSON.stringify(rows, null, 2), "utf8");
  await db.$disconnect();
  if (wrong.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
