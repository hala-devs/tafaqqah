-- CreateEnum
CREATE TYPE "LevelStatus" AS ENUM ('ACTIVE', 'COMING_SOON');

-- CreateEnum
CREATE TYPE "MasteryState" AS ENUM ('LEARNING', 'NEEDS_REINFORCEMENT', 'GOOD', 'MASTERED');

-- AlterEnum
ALTER TYPE "AssessmentPurpose" ADD VALUE 'REASSESSMENT';

-- AlterTable
ALTER TABLE "AssessmentSession" ADD COLUMN     "focusConceptIds" TEXT[];

-- AlterTable
ALTER TABLE "Concept" ADD COLUMN     "videoApproved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "videoApprovedAt" TIMESTAMP(3),
ADD COLUMN     "videoApprovedById" TEXT,
ADD COLUMN     "videoEndSecond" INTEGER,
ADD COLUMN     "videoStartSecond" INTEGER,
ADD COLUMN     "videoUrl" TEXT;

-- AlterTable
ALTER TABLE "ConceptMastery" ADD COLUMN     "recentOutcomes" BOOLEAN[] DEFAULT ARRAY[]::BOOLEAN[],
ADD COLUMN     "state" "MasteryState" NOT NULL DEFAULT 'LEARNING';

-- AlterTable
ALTER TABLE "Course" ADD COLUMN     "levelId" TEXT;

-- AlterTable
ALTER TABLE "GeneratedQuestion" ADD COLUMN     "number" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Lesson" ADD COLUMN     "measurementEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SourcePassage" ADD COLUMN     "edition" TEXT,
ADD COLUMN     "license" TEXT,
ADD COLUMN     "permissionNote" TEXT;

-- CreateTable
CREATE TABLE "LearningPath" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningPath_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Level" (
    "id" TEXT NOT NULL,
    "pathId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "LevelStatus" NOT NULL DEFAULT 'COMING_SOON',

    CONSTRAINT "Level_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonMeasurement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "preSessionId" TEXT,
    "postSessionId" TEXT,
    "preScore" DOUBLE PRECISION,
    "postScore" DOUBLE PRECISION,
    "masteryBefore" JSONB,
    "masteryAfter" JSONB,
    "weakBefore" TEXT[],
    "weakAfter" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearningPath_slug_key" ON "LearningPath"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Level_pathId_order_key" ON "Level"("pathId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "LessonMeasurement_preSessionId_key" ON "LessonMeasurement"("preSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonMeasurement_postSessionId_key" ON "LessonMeasurement"("postSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "LessonMeasurement_userId_lessonId_key" ON "LessonMeasurement"("userId", "lessonId");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedQuestion_number_key" ON "GeneratedQuestion"("number");

-- AddForeignKey
ALTER TABLE "Level" ADD CONSTRAINT "Level_pathId_fkey" FOREIGN KEY ("pathId") REFERENCES "LearningPath"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonMeasurement" ADD CONSTRAINT "LessonMeasurement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonMeasurement" ADD CONSTRAINT "LessonMeasurement_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

