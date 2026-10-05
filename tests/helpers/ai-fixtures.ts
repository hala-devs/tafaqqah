import { QuestionValidator } from "@/server/ai/question-validator";
import type { CandidateQuestion, GenerationRequest, TrustedPassage } from "@/server/ai/types";
import type { ScriptedProvider } from "./scripted-provider";

/** Shared fixtures for the AI-safety suites: one approved passage and one fully grounded candidate. */
export const PASSAGE: TrustedPassage = {
  id: "passage-question-validation",
  version: 1,
  sourceTitle: "دليل منهج تفقّه",
  sourceAuthor: "فريق تفقّه",
  sourceReference: "الفقرة ٣",
  text: "يُبنى كل سؤال من مقطع معتمد واحد يسترجعه الخادم بنفسه من قاعدة البيانات، ولا يُقبل نص المصدر من المتصفح. ثم يفحص مدقق مستقل السؤال قبل عرضه، فيتحقق من أن السؤال يُجاب عنه من المقطع وحده، وأن له إجابة صحيحة واحدة. فإن رُفض السؤال أُعيد توليده، وإن تكرر الرفض ثلاث مرات لم يُعرض سؤال مختلَق.",
};

export const EVIDENCE = "فإن رُفض السؤال أُعيد توليده";

export const GOOD: CandidateQuestion = {
  status: "OK",
  questionType: "MCQ",
  question: "ماذا يحدث للسؤال إذا رفضه المدقق المستقل؟",
  options: ["أُعيد توليده", "يُعرض مع تنبيه", "يُقبل نص المصدر من المتصفح", "يُحذف المقطع نهائيًا"],
  correctOptionId: "A",
  correctAnswer: "أُعيد توليده",
  explanation: "إذا رُفض السؤال أُعيد توليده.",
  answerEvidence: EVIDENCE,
  explanationEvidence: EVIDENCE,
};

export function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    lessonId: "lesson-method",
    conceptId: "concept-question-validation",
    conceptTitle: "بناء الأسئلة والتحقق منها",
    passage: PASSAGE,
    stage: "VERIFICATION",
    questionType: "MCQ",
    targetDifficulty: 2,
    previous: null,
    previousQuestions: [],
    previousRejections: [],
    ...overrides,
  };
}

export function validate(provider: ScriptedProvider, candidate: CandidateQuestion, previousQuestions: string[] = [], baselineQuestions: string[] = []) {
  return new QuestionValidator(provider).validate({
    passage: PASSAGE,
    conceptTitle: "بناء الأسئلة والتحقق منها",
    candidate,
    previousQuestions,
    baselineQuestions,
  });
}

export function goodItem() {
  return {
    question: GOOD.question,
    options: GOOD.options,
    correctIndex: 0,
    explanation: GOOD.explanation,
    answerEvidence: GOOD.answerEvidence,
  };
}

