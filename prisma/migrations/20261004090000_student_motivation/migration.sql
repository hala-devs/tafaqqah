-- Student motivation (additive, forward-only): optional goals + the learner's timezone, and one row
-- per local day on which real learning happened (the source of the learning streak).

-- CreateEnum
CREATE TYPE "MonthlyGoalKind" AS ENUM ('LESSONS', 'CONCEPTS');

-- CreateTable
CREATE TABLE "LearnerSettings" (
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    "weeklyLessonGoal" INTEGER,
    "monthlyGoalKind" "MonthlyGoalKind",
    "monthlyGoalTarget" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "LearningDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningDay_userId_day_idx" ON "LearningDay"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "LearningDay_userId_day_key" ON "LearningDay"("userId", "day");

-- AddForeignKey
ALTER TABLE "LearnerSettings" ADD CONSTRAINT "LearnerSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningDay" ADD CONSTRAINT "LearningDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
