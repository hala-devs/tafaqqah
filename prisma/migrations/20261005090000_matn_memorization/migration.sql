-- CreateEnum
CREATE TYPE "MatnStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "SelfAssessmentStatus" AS ENUM ('CORRECT', 'INCORRECT', 'FORGOTTEN');

-- CreateEnum
CREATE TYPE "MemorizationState" AS ENUM ('NEEDS_REVIEW', 'NEEDS_REINFORCEMENT', 'GOOD', 'MASTERED');

-- CreateEnum
CREATE TYPE "RecitationKind" AS ENUM ('PRACTICE', 'REVIEW');

-- CreateEnum
CREATE TYPE "MemorizationAnalysisStatus" AS ENUM ('ANALYZED', 'FALLBACK');

-- AlterEnum
ALTER TYPE "AIInteractionType" ADD VALUE 'ANALYZE_MEMORIZATION';

-- CreateTable
CREATE TABLE "MatnSection" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "titleIsDerived" BOOLEAN NOT NULL DEFAULT false,
    "groupTitle" TEXT,
    "sourceHeading" TEXT,
    "status" "MatnStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "importBatch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatnSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatnPassage" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "titleIsDerived" BOOLEAN NOT NULL DEFAULT true,
    "status" "MatnStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatnPassage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatnUnit" (
    "id" TEXT NOT NULL,
    "passageId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "canonicalText" TEXT NOT NULL,
    "status" "MatnStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewNotes" TEXT[],
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedTextHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatnUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecitationAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passageId" TEXT NOT NULL,
    "clientAttemptId" TEXT NOT NULL,
    "kind" "RecitationKind" NOT NULL DEFAULT 'PRACTICE',
    "totalUnits" INTEGER NOT NULL,
    "correctUnits" INTEGER NOT NULL,
    "incorrectUnits" INTEGER NOT NULL,
    "forgottenUnits" INTEGER NOT NULL,
    "scorePercentage" DOUBLE PRECISION NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "masteryBefore" INTEGER,
    "masteryAfter" INTEGER NOT NULL,
    "stateAfter" "MemorizationState" NOT NULL,
    "nextReviewAt" TIMESTAMP(3) NOT NULL,
    "analysisStatus" "MemorizationAnalysisStatus",
    "analysis" JSONB,
    "analysisModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecitationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecitationUnitResult" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "selfAssessmentStatus" "SelfAssessmentStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecitationUnitResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemorizationMastery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passageId" TEXT NOT NULL,
    "masteryScore" INTEGER NOT NULL,
    "state" "MemorizationState" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveCorrect" INTEGER NOT NULL DEFAULT 0,
    "consecutiveWeak" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "forgottenCount" INTEGER NOT NULL DEFAULT 0,
    "lastScore" DOUBLE PRECISION NOT NULL,
    "lastReviewedAt" TIMESTAMP(3) NOT NULL,
    "nextReviewAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemorizationMastery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatnSection_courseId_order_key" ON "MatnSection"("courseId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "MatnPassage_sectionId_order_key" ON "MatnPassage"("sectionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "MatnUnit_passageId_order_key" ON "MatnUnit"("passageId", "order");

-- CreateIndex
CREATE INDEX "RecitationAttempt_userId_completedAt_idx" ON "RecitationAttempt"("userId", "completedAt");

-- CreateIndex
CREATE INDEX "RecitationAttempt_passageId_idx" ON "RecitationAttempt"("passageId");

-- CreateIndex
CREATE UNIQUE INDEX "RecitationAttempt_userId_clientAttemptId_key" ON "RecitationAttempt"("userId", "clientAttemptId");

-- CreateIndex
CREATE INDEX "RecitationUnitResult_unitId_idx" ON "RecitationUnitResult"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "RecitationUnitResult_attemptId_unitId_key" ON "RecitationUnitResult"("attemptId", "unitId");

-- CreateIndex
CREATE INDEX "MemorizationMastery_userId_nextReviewAt_idx" ON "MemorizationMastery"("userId", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "MemorizationMastery_userId_passageId_key" ON "MemorizationMastery"("userId", "passageId");

-- AddForeignKey
ALTER TABLE "MatnSection" ADD CONSTRAINT "MatnSection_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatnPassage" ADD CONSTRAINT "MatnPassage_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "MatnSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatnUnit" ADD CONSTRAINT "MatnUnit_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "MatnPassage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecitationAttempt" ADD CONSTRAINT "RecitationAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecitationAttempt" ADD CONSTRAINT "RecitationAttempt_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "MatnPassage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecitationUnitResult" ADD CONSTRAINT "RecitationUnitResult_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "RecitationAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecitationUnitResult" ADD CONSTRAINT "RecitationUnitResult_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "MatnUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorizationMastery" ADD CONSTRAINT "MemorizationMastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorizationMastery" ADD CONSTRAINT "MemorizationMastery_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "MatnPassage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

