-- Forward-only: adds the immediate reinforcement plan (attempt → plan → re-recitation linkage). No data is changed or removed.
-- CreateEnum
CREATE TYPE "ReinforcementPlanSource" AS ENUM ('AI', 'DETERMINISTIC');

-- CreateEnum
CREATE TYPE "ReinforcementPlanStatus" AS ENUM ('PENDING', 'READY', 'COMPLETED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "AIInteractionType" ADD VALUE 'PLAN_MEMORIZATION_REINFORCEMENT';

-- CreateTable
CREATE TABLE "MemorizationReinforcementPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceAttemptId" TEXT NOT NULL,
    "status" "ReinforcementPlanStatus" NOT NULL DEFAULT 'PENDING',
    "planSource" "ReinforcementPlanSource",
    "aiOutcome" TEXT,
    "necessityReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "promptVersion" TEXT,
    "facts" JSONB,
    "observationKey" TEXT,
    "targets" JSONB,
    "targetCount" INTEGER NOT NULL DEFAULT 0,
    "exposuresCompleted" INTEGER,
    "completedAt" TIMESTAMP(3),
    "followUpAttemptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemorizationReinforcementPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemorizationReinforcementPlan_sourceAttemptId_key" ON "MemorizationReinforcementPlan"("sourceAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "MemorizationReinforcementPlan_followUpAttemptId_key" ON "MemorizationReinforcementPlan"("followUpAttemptId");

-- CreateIndex
CREATE INDEX "MemorizationReinforcementPlan_userId_createdAt_idx" ON "MemorizationReinforcementPlan"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "MemorizationReinforcementPlan" ADD CONSTRAINT "MemorizationReinforcementPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorizationReinforcementPlan" ADD CONSTRAINT "MemorizationReinforcementPlan_sourceAttemptId_fkey" FOREIGN KEY ("sourceAttemptId") REFERENCES "RecitationAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemorizationReinforcementPlan" ADD CONSTRAINT "MemorizationReinforcementPlan_followUpAttemptId_fkey" FOREIGN KEY ("followUpAttemptId") REFERENCES "RecitationAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

