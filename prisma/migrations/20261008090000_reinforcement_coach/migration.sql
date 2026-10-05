-- Forward-only: interactive reinforcement coach + evaluation condition. Additive only — no existing data changes.
-- Why: (1) exercises are now decided one at a time and answered by the learner, which needs one row per exercise
-- (order, decision, self-report, timestamps) to be idempotent and reconstructable; (2) the evaluation baseline must be
-- distinguishable from the adaptive condition on the same session row.

-- AlterEnum
ALTER TYPE "ReinforcementPlanSource" ADD VALUE 'NONE';

-- AlterEnum
ALTER TYPE "AIInteractionType" ADD VALUE 'DECIDE_MEMORIZATION_EXERCISE';

-- CreateEnum
CREATE TYPE "ReinforcementReviewMode" AS ENUM ('AI_ADAPTIVE_REVIEW', 'BASELINE_REVIEW');

-- CreateEnum
CREATE TYPE "ReinforcementExerciseType" AS ENUM ('CLOZE_RECALL', 'CONTEXT_RECALL', 'REDUCED_CUE_RECALL', 'SEQUENCE_RECALL', 'DELAYED_RECALL', 'WHOLE_UNIT_RECALL', 'LINKED_SEQUENCE_RECALL');

-- CreateEnum
CREATE TYPE "ReinforcementResponse" AS ENUM ('RECALLED', 'PARTIAL', 'NOT_RECALLED');

-- CreateEnum
CREATE TYPE "ReinforcementDecisionSource" AS ENUM ('AI', 'DETERMINISTIC', 'FALLBACK');

-- AlterTable (existing rows were adaptive sessions)
ALTER TABLE "MemorizationReinforcementPlan" ADD COLUMN "reviewMode" "ReinforcementReviewMode" NOT NULL DEFAULT 'AI_ADAPTIVE_REVIEW';

-- CreateTable
CREATE TABLE "MemorizationReinforcementExercise" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "exerciseType" "ReinforcementExerciseType",
    "decisionSource" "ReinforcementDecisionSource",
    "decisionOutcome" TEXT,
    "promptVersion" TEXT,
    "decision" JSONB,
    "reasonCode" TEXT,
    "contextLevel" TEXT,
    "cueLevel" TEXT,
    "targetRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "response" "ReinforcementResponse",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "revealedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "MemorizationReinforcementExercise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemorizationReinforcementExercise_planId_order_key" ON "MemorizationReinforcementExercise"("planId", "order");

-- AddForeignKey
ALTER TABLE "MemorizationReinforcementExercise" ADD CONSTRAINT "MemorizationReinforcementExercise_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MemorizationReinforcementPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
