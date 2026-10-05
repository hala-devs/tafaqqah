/**
 * ─────────────────────────────────────────────────────────────────────────────
 * DEVELOPMENT SEED CONTENT — محتوى تجريبي
 * يُستبدل بالمادة العلمية المعتمدة قبل التقييم النهائي
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This file intentionally contains NO fiqh rulings.
 *
 * 1. Chapter "مدخل" holds two fully working demo lessons whose text describes
 *    Tafaqqah's own learning method. Every statement in them is true of this
 *    codebase (e.g. mastery starts at 50, < 40 → foundational question, a
 *    question is regenerated at most 3 times, an assessment has 5–10 questions),
 *    so the whole AI pipeline can be demonstrated without fabricating fiqh.
 *
 * 2. Chapter "كتاب الطهارة" lists placeholder lessons (status COMING_SOON) for the
 *    intended source «أخصر المختصرات». Their passages are placeholders and are
 *    NOT approved, so the AI can never receive them. Titles are provisional and
 *    must be checked against the verified edition.
 *
 * To publish real content: replace the placeholder passages below with verified
 * text (or use /admin), set `approved: true`, set the lesson status to
 * PUBLISHED and `isSample: false`, then run `npm run db:seed`.
 * See content/README.md for the full workflow.
 */

export type SeedPassage = {
  id: string;
  text: string;
  sourceTitle: string;
  sourceAuthor: string;
  sourceReference: string;
  approved: boolean;
  isSample: boolean;
};

export type SeedConcept = { id: string; title: string; description: string; passages: SeedPassage[] };

export type SeedFixedQuestion = {
  id: string;
  conceptId: string;
  passageId: string;
  questionType: "MCQ" | "TRUE_FALSE";
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  difficulty: 1 | 2 | 3;
};

export type SeedLesson = {
  id: string;
  /** Pre-test before study + post-test after assessment (pre/post measurement). */
  measurementEnabled?: boolean;
  title: string;
  description: string;
  objectives: string[];
  status: "DRAFT" | "COMING_SOON" | "PUBLISHED";
  isSample: boolean;
  estimatedMinutes?: number;
  concepts: SeedConcept[];
  fixedQuestions: SeedFixedQuestion[];
};

export type SeedChapter = { id: string; title: string; description?: string; lessons: SeedLesson[] };

export type SeedCourse = {
  id: string;
  /** Order of the level this book belongs to in LEARNING_PATH. */
  levelOrder: number;
  slug: string;
  title: string;
  description: string;
  madhhab: string;
  isSample: boolean;
  chapters: SeedChapter[];
};

const METHOD_SOURCE = {
  sourceTitle: "دليل منهج تفقّه",
  sourceAuthor: "فريق تفقّه",
  approved: true,
  isSample: true,
} as const;

const PLACEHOLDER_TEXT =
  "[محتوى تجريبي — يُستبدل بالمادة العلمية المعتمدة قبل التقييم النهائي] يُدرج هنا نص «أخصر المختصرات» الخاص بهذا الباب بعد التحقق منه من طبعة معتمدة.";

function placeholderLesson(id: string, title: string): SeedLesson {
  return {
    id,
    title,
    description: "درس قيد الإعداد. تُضاف مادته من «أخصر المختصرات» بعد التحقق منها واعتمادها.",
    objectives: [],
    status: "COMING_SOON",
    isSample: true,
    concepts: [
      {
        id: `${id}-concept`,
        title: "مادة الدرس",
        description: "مفهوم مؤقت إلى حين إدخال المادة المعتمدة وتقسيمها إلى مفاهيم.",
        passages: [
          {
            id: `${id}-passage`,
            text: PLACEHOLDER_TEXT,
            sourceTitle: "أخصر المختصرات",
            sourceAuthor: "محمد بن بدر الدين بن بلبان الحنبلي",
            sourceReference: "يُحدَّد الموضع من الطبعة المعتمدة",
            approved: false,
            isSample: true,
          },
        ],
      },
    ],
    fixedQuestions: [],
  };
}

/**
 * The multi-level roadmap. Only Level 1 is active in the MVP; levels 2–7 are shown as
 * future stages and contain NO content. The sequence is presented as Tafaqqah's planned
 * roadmap only — it is not attributed to any scholar.
 */
export const LEARNING_PATH = {
  id: "path-hanbali-fiqh",
  slug: "hanbali-fiqh",
  title: "المسار العلمي في تفقّه",
  description: "مسار متدرج من سبعة مستويات، يبدأ بمتن مختصر ثم يتدرّج. المستوى الأول متاح الآن، وتُفتح المستويات التالية بعد إعداد مادتها واعتمادها.",
  isSample: true,
  levels: [
    { order: 1, title: "المستوى الأول", status: "ACTIVE" as const },
    { order: 2, title: "الأصول من علم الأصول", status: "COMING_SOON" as const },
    { order: 3, title: "دليل الطالب", status: "COMING_SOON" as const },
    { order: 4, title: "زاد المستقنع", status: "COMING_SOON" as const },
    { order: 5, title: "شرح المحلي على الورقات", status: "COMING_SOON" as const },
    { order: 6, title: "عمدة الأحكام", status: "COMING_SOON" as const },
    { order: 7, title: "الروض المربع", status: "COMING_SOON" as const },
  ],
};

export const CURRICULUM: SeedCourse[] = [
  {
    id: "course-hanbali-path",
    levelOrder: 1,
    slug: "hanbali-fiqh-path",
    title: "أخصر المختصرات",
    description:
      "المستوى الأول من المسار. يبدأ بدرسين تعريفيين يشرحان منهج التعلّم في تفقّه، ثم ينتقل إلى أبواب «أخصر المختصرات» بعد اعتماد مادتها.",
    madhhab: "الحنبلي",
    isSample: true,
    chapters: [
      {
        id: "chapter-intro",
        title: "مدخل: كيف تتعلّم في تفقّه",
        description: "درسان تعريفيان يوضّحان رحلة التعلّم من الدراسة إلى الاختبار والمراجعة.",
        lessons: [
          {
            id: "lesson-method",
            title: "منهج الدراسة والاختبار",
            description: "كيف تُعرض المادة المعتمدة، ومتى يُفتح الاختبار، وكيف تُبنى الأسئلة ويُتحقق منها قبل عرضها.",
            objectives: [
              "أن تميّز بين المادة العلمية المعتمدة وبين أسئلة الاختبار.",
              "أن تعرف مرحلتي الدرس وترتيبهما.",
              "أن تفهم كيف يُتحقق من السؤال قبل عرضه عليك.",
            ],
            status: "PUBLISHED",
            isSample: true,
            estimatedMinutes: 6,
            concepts: [
              {
                id: "concept-approved-source",
                title: "المادة العلمية المعتمدة",
                description: "مصدر المعلومة في الدرس وحدود دور الذكاء الاصطناعي.",
                passages: [
                  {
                    id: "passage-approved-source",
                    ...METHOD_SOURCE,
                    sourceReference: "نص تعريفي — الفقرة ١",
                    text: "تعتمد تفقّه في كل درس على مادة علمية يراجعها فريق المحتوى ويعتمدها قبل نشرها. ولا يُعرض على المتعلم من نص الدرس إلا المقاطع المعتمدة. ولا يعيد الذكاء الاصطناعي صياغة هذه المقاطع، ولا يضيف إليها حكمًا أو شرطًا أو استثناءً. ويظهر مع كل مقطع بيان مصدره: عنوان الكتاب، واسم المؤلف، وموضع النص.",
                  },
                ],
              },
              {
                id: "concept-study-stages",
                title: "مرحلتا الدرس",
                description: "مرحلة التعلّم ثم مرحلة قياس الفهم، وشرط الانتقال بينهما.",
                passages: [
                  {
                    id: "passage-study-stages",
                    ...METHOD_SOURCE,
                    sourceReference: "نص تعريفي — الفقرة ٢",
                    text: "يمرّ كل درس بمرحلتين متتاليتين: مرحلة التعلّم ثم مرحلة قياس الفهم. ففي مرحلة التعلّم يقرأ المتعلم المادة المعتمدة كاملة. فإذا أتمّ القراءة ضغط زر «أكملت دراسة الدرس». ولا يُفتح اختبار الفهم إلا بعد تسجيل إتمام الدراسة.",
                  },
                ],
              },
              {
                id: "concept-question-validation",
                title: "بناء الأسئلة والتحقق منها",
                description: "من أين يُبنى السؤال، وكيف يُفحص قبل أن يراه المتعلم.",
                passages: [
                  {
                    id: "passage-question-validation",
                    ...METHOD_SOURCE,
                    sourceReference: "نص تعريفي — الفقرة ٣",
                    text: "يُبنى كل سؤال من مقطع معتمد واحد يسترجعه الخادم بنفسه من قاعدة البيانات، ولا يُقبل نص المصدر من المتصفح. ثم يفحص مدقق مستقل السؤال قبل عرضه، فيتحقق من أن السؤال يُجاب عنه من المقطع وحده، وأن له إجابة صحيحة واحدة. فإن رُفض السؤال أُعيد توليده، وإن تكرر الرفض ثلاث مرات لم يُعرض سؤال مختلَق. وإذا لم يكن في المقطع ما يكفي لسؤال موثوق، عُدّ المقطع غير كافٍ ولم يُبنَ عليه سؤال.",
                  },
                ],
              },
            ],
            fixedQuestions: [
              {
                id: "fixed-method-1",
                conceptId: "concept-approved-source",
                passageId: "passage-approved-source",
                questionType: "MCQ",
                question: "ما الذي يظهر مع كل مقطع من المادة المعتمدة؟",
                options: [
                  "بيان مصدره: عنوان الكتاب، واسم المؤلف، وموضع النص",
                  "ملخص يكتبه الذكاء الاصطناعي للمقطع",
                  "سؤال اختبار عن المقطع",
                  "تقييم المتعلمين للمقطع",
                ],
                correctIndex: 0,
                explanation: "ذكر النص أنه «يظهر مع كل مقطع بيان مصدره: عنوان الكتاب، واسم المؤلف، وموضع النص».",
                difficulty: 1,
              },
              {
                id: "fixed-method-2",
                conceptId: "concept-approved-source",
                passageId: "passage-approved-source",
                questionType: "TRUE_FALSE",
                question: "لا يضيف الذكاء الاصطناعي إلى المقاطع المعتمدة حكمًا أو شرطًا أو استثناءً.",
                options: ["صحيح", "خطأ"],
                correctIndex: 0,
                explanation: "نص الدرس: «ولا يعيد الذكاء الاصطناعي صياغة هذه المقاطع، ولا يضيف إليها حكمًا أو شرطًا أو استثناءً».",
                difficulty: 1,
              },
              {
                id: "fixed-method-3",
                conceptId: "concept-study-stages",
                passageId: "passage-study-stages",
                questionType: "MCQ",
                question: "ما المرحلتان اللتان يمرّ بهما كل درس بالترتيب؟",
                options: [
                  "مرحلة التعلّم ثم مرحلة قياس الفهم",
                  "مرحلة قياس الفهم ثم مرحلة التعلّم",
                  "مرحلة المراجعة ثم مرحلة التعلّم",
                  "مرحلة التعلّم ثم مرحلة المراجعة",
                ],
                correctIndex: 0,
                explanation: "ذكر النص أن كل درس «يمرّ بمرحلتين متتاليتين: مرحلة التعلّم ثم مرحلة قياس الفهم».",
                difficulty: 2,
              },
              {
                id: "fixed-method-4",
                conceptId: "concept-study-stages",
                passageId: "passage-study-stages",
                questionType: "TRUE_FALSE",
                question: "يمكن بدء اختبار الفهم قبل تسجيل إتمام دراسة الدرس.",
                options: ["صحيح", "خطأ"],
                correctIndex: 1,
                explanation: "العبارة خطأ؛ فالنص يقول: «ولا يُفتح اختبار الفهم إلا بعد تسجيل إتمام الدراسة».",
                difficulty: 1,
              },
              {
                id: "fixed-method-5",
                conceptId: "concept-question-validation",
                passageId: "passage-question-validation",
                questionType: "MCQ",
                question: "ماذا يحدث إذا رفض المدقق المستقل السؤال؟",
                options: [
                  "يُعاد توليد السؤال",
                  "يُعرض السؤال مع تنبيه",
                  "يُحذف المقطع من الدرس",
                  "يُطلب من المتعلم تصحيحه",
                ],
                correctIndex: 0,
                explanation: "ذكر النص: «فإن رُفض السؤال أُعيد توليده».",
                difficulty: 2,
              },
              {
                id: "fixed-method-6",
                conceptId: "concept-question-validation",
                passageId: "passage-question-validation",
                questionType: "TRUE_FALSE",
                question: "يقبل الخادم نص المصدر المرسل من المتصفح لبناء السؤال.",
                options: ["صحيح", "خطأ"],
                correctIndex: 1,
                explanation: "العبارة خطأ؛ فالخادم يسترجع المقطع بنفسه، والنص يقول: «ولا يُقبل نص المصدر من المتصفح».",
                difficulty: 1,
              },
            ],
          },
          {
            id: "lesson-mastery",
            measurementEnabled: true,
            title: "الإتقان والتكيّف والمراجعة",
            description: "كيف يُقاس مستوى إتقانك لكل مفهوم، وكيف تتكيّف الأسئلة معه، وكيف تقودك النتيجة إلى المراجعة.",
            objectives: [
              "أن تقرأ مستوى الإتقان بوصفه مؤشرًا تعليميًا.",
              "أن تعرف كيف يتغيّر مستوى صعوبة الأسئلة.",
              "أن تستعمل نتيجة الدرس للعودة إلى المواضع التي تحتاج إلى مراجعة.",
            ],
            status: "PUBLISHED",
            isSample: true,
            estimatedMinutes: 6,
            concepts: [
              {
                id: "concept-mastery-level",
                title: "مستوى الإتقان",
                description: "نقطة البداية وأسباب الارتفاع والانخفاض وأوصاف المستوى.",
                passages: [
                  {
                    id: "passage-mastery-level",
                    ...METHOD_SOURCE,
                    sourceReference: "نص تعريفي — الفقرة ٤",
                    text: "لكل مفهوم في الدرس مستوى إتقان يبدأ من خمسين درجة من مئة. ويرتفع المستوى مع الإجابة الصحيحة، ويزيد الارتفاع كلما كان السؤال أصعب. وينخفض المستوى مع الإجابة الخاطئة، ويكون الانخفاض أكبر إذا تكرر الخطأ في المفهوم نفسه. ولا يُعدّ المفهوم محتاجًا إلى تثبيت من خطأ واحد، بل إذا تكرر الخطأ فيه. ويُعرض المستوى بأوصاف تعليمية هي: يحتاج إلى تثبيت، وقيد التعلّم، وجيد، ومتقن.",
                  },
                ],
              },
              {
                id: "concept-adaptation",
                title: "تكيّف الأسئلة",
                description: "اختيار المفهوم التالي ومستوى الصعوبة وحدود طول الاختبار.",
                passages: [
                  {
                    id: "passage-adaptation",
                    ...METHOD_SOURCE,
                    sourceReference: "نص تعريفي — الفقرة ٥",
                    text: "تختار المنصة المفهوم التالي بحسب إجابات المتعلم، فتقدّم المفاهيم التي لم تُختبر بعد، ثم المفاهيم الأضعف مستوى. ويُحدَّد مستوى صعوبة السؤال من مستوى الإتقان: فإذا كان المستوى أقل من أربعين جاء السؤال تأسيسيًا، وإذا كان بين أربعين وأربعة وسبعين جاء متوسطًا، وإذا بلغ خمسة وسبعين فأكثر جاء تطبيقيًا. وينتهي الاختبار بعد خمسة أسئلة على الأقل وعشرة أسئلة على الأكثر.",
                  },
                ],
              },
              {
                id: "concept-guided-review",
                title: "المراجعة الموجّهة",
                description: "كيف تقود نتيجة الدرس إلى مواضع المراجعة في النص.",
                passages: [
                  {
                    id: "passage-guided-review",
                    ...METHOD_SOURCE,
                    sourceReference: "نص تعريفي — الفقرة ٦",
                    text: "عند انتهاء الاختبار تعرض المنصة نتيجة الدرس، فتبيّن الأجزاء التي أظهر المتعلم فهمها، والأجزاء التي تحتاج إلى تثبيت. ويرتبط كل جزء يحتاج إلى تثبيت بموضعه في نص الدرس، وبالمقطع المعتمد من الشرح المرئي إن وُجد، فيراجعه المتعلم ثم يختبر فهمه له مرة أخرى بأسئلة جديدة. وتُعرض نسبة الإتقان مؤشرًا تعليميًا تقريبيًا، لا قياسًا علميًا دقيقًا.",
                  },
                ],
              },
            ],
            fixedQuestions: [
              {
                id: "fixed-mastery-1",
                conceptId: "concept-mastery-level",
                passageId: "passage-mastery-level",
                questionType: "MCQ",
                question: "من كم درجة يبدأ مستوى الإتقان لكل مفهوم؟",
                options: ["خمسين درجة من مئة", "صفر درجة", "أربعين درجة", "خمس وسبعين درجة"],
                correctIndex: 0,
                explanation: "ذكر النص أن لكل مفهوم «مستوى إتقان يبدأ من خمسين درجة من مئة».",
                difficulty: 1,
              },
              {
                id: "fixed-mastery-2",
                conceptId: "concept-mastery-level",
                passageId: "passage-mastery-level",
                questionType: "TRUE_FALSE",
                question: "يكون انخفاض المستوى أكبر إذا تكرر الخطأ في المفهوم نفسه.",
                options: ["صحيح", "خطأ"],
                correctIndex: 0,
                explanation: "نص الدرس: «ويكون الانخفاض أكبر إذا تكرر الخطأ في المفهوم نفسه».",
                difficulty: 2,
              },
              {
                id: "fixed-mastery-7",
                conceptId: "concept-mastery-level",
                passageId: "passage-mastery-level",
                questionType: "TRUE_FALSE",
                question: "يُعدّ المفهوم محتاجًا إلى تثبيت من خطأ واحد فيه.",
                options: ["صحيح", "خطأ"],
                correctIndex: 1,
                explanation: "العبارة خطأ؛ فالنص يقول: «ولا يُعدّ المفهوم محتاجًا إلى تثبيت من خطأ واحد، بل إذا تكرر الخطأ فيه».",
                difficulty: 1,
              },
              {
                id: "fixed-mastery-3",
                conceptId: "concept-adaptation",
                passageId: "passage-adaptation",
                questionType: "MCQ",
                question: "إذا كان مستوى الإتقان أقل من أربعين، فما نوع السؤال التالي؟",
                options: ["تأسيسي", "متوسط", "تطبيقي", "لا يُعرض سؤال"],
                correctIndex: 0,
                explanation: "ذكر النص: «فإذا كان المستوى أقل من أربعين جاء السؤال تأسيسيًا».",
                difficulty: 2,
              },
              {
                id: "fixed-mastery-4",
                conceptId: "concept-adaptation",
                passageId: "passage-adaptation",
                questionType: "MCQ",
                question: "متعلم بلغ مستوى إتقانه في مفهوم ثمانين درجة. ما مستوى صعوبة السؤال التالي عن هذا المفهوم؟",
                options: ["تطبيقي", "تأسيسي", "متوسط", "ينتهي الاختبار فورًا"],
                correctIndex: 0,
                explanation: "ثمانون أكبر من خمسة وسبعين، والنص يقول: «وإذا بلغ خمسة وسبعين فأكثر جاء تطبيقيًا».",
                difficulty: 3,
              },
              {
                id: "fixed-mastery-5",
                conceptId: "concept-guided-review",
                passageId: "passage-guided-review",
                questionType: "MCQ",
                question: "بماذا يرتبط كل جزء يحتاج إلى تثبيت في نتيجة الدرس؟",
                options: ["بموضعه في نص الدرس", "بسؤال يكتبه المتعلم", "بقائمة مصادر خارجية", "بملخص عام للمسار"],
                correctIndex: 0,
                explanation: "ذكر النص: «ويرتبط كل جزء يحتاج إلى تثبيت بموضعه في نص الدرس».",
                difficulty: 2,
              },
              {
                id: "fixed-mastery-6",
                conceptId: "concept-guided-review",
                passageId: "passage-guided-review",
                questionType: "TRUE_FALSE",
                question: "تُعرض نسبة الإتقان قياسًا علميًا دقيقًا.",
                options: ["صحيح", "خطأ"],
                correctIndex: 1,
                explanation: "العبارة خطأ؛ فالنص يقول إنها تُعرض «مؤشرًا تعليميًا تقريبيًا، لا قياسًا علميًا دقيقًا».",
                difficulty: 1,
              },
            ],
          },
        ],
      },
      {
        id: "chapter-taharah",
        title: "كتاب الطهارة",
        description: "أبواب الطهارة من «أخصر المختصرات». تُفتح بعد إدخال المادة المعتمدة.",
        lessons: [
          placeholderLesson("lesson-taharah-water", "باب المياه"),
          placeholderLesson("lesson-taharah-vessels", "باب الآنية"),
          placeholderLesson("lesson-taharah-istinja", "باب الاستنجاء"),
          placeholderLesson("lesson-taharah-siwak", "باب السواك"),
        ],
      },
    ],
  },
];
