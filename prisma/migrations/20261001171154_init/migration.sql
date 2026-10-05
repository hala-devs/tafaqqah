-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'ADMIN');

-- CreateEnum
CREATE TYPE "EvaluationGroup" AS ENUM ('ADAPTIVE', 'FIXED');

-- CreateEnum
CREATE TYPE "LessonStatus" AS ENUM ('DRAFT', 'COMING_SOON', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "AssessmentMode" AS ENUM ('ADAPTIVE', 'FIXED');

-- CreateEnum
CREATE TYPE "AssessmentPurpose" AS ENUM ('PRACTICE', 'PRE_TEST', 'POST_TEST');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MCQ', 'TRUE_FALSE');

-- CreateEnum
CREATE TYPE "QuestionOrigin" AS ENUM ('AI_GENERATED', 'FIXED_BANK');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('VALID', 'REJECTED');

-- CreateEnum
CREATE TYPE "AIInteractionType" AS ENUM ('GENERATE', 'VALIDATE');

-- CreateEnum
CREATE TYPE "AIInteractionStatus" AS ENUM ('SUCCESS', 'INSUFFICIENT_SOURCE', 'REJECTED', 'MALFORMED_OUTPUT', 'PROVIDER_ERROR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "evaluationGroup" "EvaluationGroup" NOT NULL DEFAULT 'ADAPTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "madhhab" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "objectives" TEXT[],
    "order" INTEGER NOT NULL,
    "status" "LessonStatus" NOT NULL DEFAULT 'DRAFT',
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "estimatedMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Concept" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcePassage" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceAuthor" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourcePassage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "studied" BOOLEAN NOT NULL DEFAULT false,
    "studiedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "LessonProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConceptMastery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "masteryScore" INTEGER NOT NULL DEFAULT 50,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "incorrectCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveCorrect" INTEGER NOT NULL DEFAULT 0,
    "consecutiveIncorrect" INTEGER NOT NULL DEFAULT 0,
    "lastDifficulty" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConceptMastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "mode" "AssessmentMode" NOT NULL DEFAULT 'ADAPTIVE',
    "purpose" "AssessmentPurpose" NOT NULL DEFAULT 'PRACTICE',
    "status" "SessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "insufficientConceptIds" TEXT[],
    "generationLockUntil" TIMESTAMP(3),
    "report" JSONB,

    CONSTRAINT "AssessmentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedQuestion" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "sourcePassageId" TEXT NOT NULL,
    "questionType" "QuestionType" NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[],
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedQuestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "sourcePassageId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "sourceSnapshot" TEXT NOT NULL,
    "origin" "QuestionOrigin" NOT NULL DEFAULT 'AI_GENERATED',
    "fixedQuestionId" TEXT,
    "questionType" "QuestionType" NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[],
    "correctIndex" INTEGER NOT NULL,
    "correctAnswer" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "sourceSupport" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "validationStatus" "ValidationStatus" NOT NULL,
    "validationIssues" TEXT[],
    "generatorMetadata" JSONB NOT NULL,
    "sequence" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentAnswer" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "selectedIndex" INTEGER NOT NULL,
    "selectedAnswer" TEXT NOT NULL,
    "correct" BOOLEAN NOT NULL,
    "masteryBefore" INTEGER NOT NULL,
    "masteryAfter" INTEGER NOT NULL,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearnerFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIInteractionLog" (
    "id" TEXT NOT NULL,
    "type" "AIInteractionType" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "sourcePassageId" TEXT,
    "sourceVersion" INTEGER,
    "sessionId" TEXT,
    "userId" TEXT,
    "questionId" TEXT,
    "status" "AIInteractionStatus" NOT NULL,
    "latencyMs" INTEGER,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInteractionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Course_slug_key" ON "Course"("slug");

-- CreateIndex
CREATE INDEX "Chapter_courseId_order_idx" ON "Chapter"("courseId", "order");

-- CreateIndex
CREATE INDEX "Lesson_chapterId_order_idx" ON "Lesson"("chapterId", "order");

-- CreateIndex
CREATE INDEX "Concept_lessonId_order_idx" ON "Concept"("lessonId", "order");

-- CreateIndex
CREATE INDEX "SourcePassage_conceptId_approved_idx" ON "SourcePassage"("conceptId", "approved");

-- CreateIndex
CREATE INDEX "SourcePassage_lessonId_idx" ON "SourcePassage"("lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonProgress_userId_lessonId_key" ON "LessonProgress"("userId", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "ConceptMastery_userId_conceptId_key" ON "ConceptMastery"("userId", "conceptId");

-- CreateIndex
CREATE INDEX "AssessmentSession_userId_lessonId_status_idx" ON "AssessmentSession"("userId", "lessonId", "status");

-- CreateIndex
CREATE INDEX "FixedQuestion_lessonId_order_idx" ON "FixedQuestion"("lessonId", "order");

-- CreateIndex
CREATE INDEX "GeneratedQuestion_sessionId_validationStatus_idx" ON "GeneratedQuestion"("sessionId", "validationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedQuestion_sessionId_sequence_key" ON "GeneratedQuestion"("sessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "StudentAnswer_questionId_key" ON "StudentAnswer"("questionId");

-- CreateIndex
CREATE INDEX "StudentAnswer_sessionId_idx" ON "StudentAnswer"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "LearnerFeedback_sessionId_key" ON "LearnerFeedback"("sessionId");

-- CreateIndex
CREATE INDEX "AIInteractionLog_sessionId_idx" ON "AIInteractionLog"("sessionId");

-- CreateIndex
CREATE INDEX "AIInteractionLog_userId_type_createdAt_idx" ON "AIInteractionLog"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "AIInteractionLog_createdAt_idx" ON "AIInteractionLog"("createdAt");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Concept" ADD CONSTRAINT "Concept_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcePassage" ADD CONSTRAINT "SourcePassage_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcePassage" ADD CONSTRAINT "SourcePassage_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonProgress" ADD CONSTRAINT "LessonProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonProgress" ADD CONSTRAINT "LessonProgress_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptMastery" ADD CONSTRAINT "ConceptMastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptMastery" ADD CONSTRAINT "ConceptMastery_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentSession" ADD CONSTRAINT "AssessmentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentSession" ADD CONSTRAINT "AssessmentSession_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedQuestion" ADD CONSTRAINT "FixedQuestion_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedQuestion" ADD CONSTRAINT "FixedQuestion_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedQuestion" ADD CONSTRAINT "FixedQuestion_sourcePassageId_fkey" FOREIGN KEY ("sourcePassageId") REFERENCES "SourcePassage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedQuestion" ADD CONSTRAINT "GeneratedQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedQuestion" ADD CONSTRAINT "GeneratedQuestion_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedQuestion" ADD CONSTRAINT "GeneratedQuestion_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedQuestion" ADD CONSTRAINT "GeneratedQuestion_sourcePassageId_fkey" FOREIGN KEY ("sourcePassageId") REFERENCES "SourcePassage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAnswer" ADD CONSTRAINT "StudentAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "GeneratedQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAnswer" ADD CONSTRAINT "StudentAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAnswer" ADD CONSTRAINT "StudentAnswer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerFeedback" ADD CONSTRAINT "LearnerFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerFeedback" ADD CONSTRAINT "LearnerFeedback_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AssessmentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
