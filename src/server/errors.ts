/**
 * Application errors carry a stable machine code plus a calm Arabic message that is
 * safe to show to learners. Internal details never leave the server.
 */
export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "LESSON_LOCKED"
  | "LESSON_NOT_STUDIED"
  | "SESSION_COMPLETED"
  | "QUESTION_ALREADY_ANSWERED"
  | "RATE_LIMITED"
  | "AI_NOT_CONFIGURED"
  | "AI_UNAVAILABLE"
  | "AI_RATE_LIMIT"
  | "AI_TIMEOUT"
  | "SOURCE_NOT_APPROVED"
  | "GENERATION_FAILED"
  | "INSUFFICIENT_SOURCE"
  | "NO_FIXED_QUESTIONS"
  | "BUSY"
  | "INTERNAL";

const DEFAULT_MESSAGES: Record<AppErrorCode, string> = {
  UNAUTHENTICATED: "يرجى تسجيل الدخول للمتابعة.",
  FORBIDDEN: "لا تملك صلاحية الوصول إلى هذه الصفحة.",
  NOT_FOUND: "لم نجد ما تبحث عنه.",
  BAD_REQUEST: "تعذّر فهم الطلب. حاول مرة أخرى.",
  LESSON_LOCKED: "هذا الدرس غير متاح بعد. أكمل دراسة الدرس السابق أولًا.",
  LESSON_NOT_STUDIED: "أكمل دراسة الدرس أولًا لبدء اختبار الفهم.",
  SESSION_COMPLETED: "اكتمل هذا الاختبار بالفعل.",
  QUESTION_ALREADY_ANSWERED: "سُجّلت إجابتك على هذا السؤال من قبل.",
  RATE_LIMITED: "طلبت أسئلة كثيرة في وقت قصير. خذ استراحة قصيرة ثم تابع.",
  AI_NOT_CONFIGURED: "الاختبار التكيفي غير مهيّأ حاليًا على هذا الخادم.",
  AI_UNAVAILABLE: "تعذّر تجهيز السؤال الآن. حاول مرة أخرى.",
  AI_RATE_LIMIT: "الخدمة مشغولة قليلًا الآن. انتظر لحظات ثم حاول مرة أخرى.",
  AI_TIMEOUT: "استغرق تجهيز السؤال وقتًا أطول من المعتاد. حاول مرة أخرى.",
  SOURCE_NOT_APPROVED: "لا توجد مادة معتمدة كافية لإنشاء سؤال موثوق لهذا الجزء.",
  GENERATION_FAILED: "تعذّر تجهيز سؤال موثوق الآن. حاول مرة أخرى بعد قليل.",
  INSUFFICIENT_SOURCE: "لا توجد مادة كافية لإنشاء سؤال موثوق لهذا الجزء.",
  NO_FIXED_QUESTIONS: "لا توجد أسئلة معتمدة لهذا الدرس بعد.",
  BUSY: "نجهّز سؤالك الآن…",
  INTERNAL: "حدث خطأ غير متوقع. حاول مرة أخرى.",
};

const HTTP_STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  BAD_REQUEST: 400,
  LESSON_LOCKED: 403,
  LESSON_NOT_STUDIED: 409,
  SESSION_COMPLETED: 409,
  QUESTION_ALREADY_ANSWERED: 409,
  RATE_LIMITED: 429,
  AI_NOT_CONFIGURED: 503,
  AI_UNAVAILABLE: 503,
  AI_RATE_LIMIT: 503,
  AI_TIMEOUT: 503,
  SOURCE_NOT_APPROVED: 422,
  GENERATION_FAILED: 503,
  INSUFFICIENT_SOURCE: 422,
  NO_FIXED_QUESTIONS: 409,
  BUSY: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;

  constructor(code: AppErrorCode, userMessage?: string, options?: { cause?: unknown }) {
    super(code, options);
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage ?? DEFAULT_MESSAGES[code];
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function messageFor(code: AppErrorCode): string {
  return DEFAULT_MESSAGES[code];
}
