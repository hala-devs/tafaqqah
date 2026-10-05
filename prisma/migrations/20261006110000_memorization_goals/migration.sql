-- Optional memorization goals and idempotent first-new-unit credits.
CREATE TYPE "MemorizationGoalPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

CREATE TABLE "MemorizationGoal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "targetUnits" INTEGER NOT NULL,
  "period" "MemorizationGoalPeriod" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemorizationGoal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MemorizationGoal_userId_key" ON "MemorizationGoal"("userId");
ALTER TABLE "MemorizationGoal" ADD CONSTRAINT "MemorizationGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MemorizationGoalCredit" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemorizationGoalCredit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MemorizationGoalCredit_attemptId_idx" ON "MemorizationGoalCredit"("attemptId");
CREATE UNIQUE INDEX "MemorizationGoalCredit_userId_unitId_key" ON "MemorizationGoalCredit"("userId", "unitId");
CREATE INDEX "MemorizationGoalCredit_userId_createdAt_idx" ON "MemorizationGoalCredit"("userId", "createdAt");
ALTER TABLE "MemorizationGoalCredit" ADD CONSTRAINT "MemorizationGoalCredit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemorizationGoalCredit" ADD CONSTRAINT "MemorizationGoalCredit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "MatnUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemorizationGoalCredit" ADD CONSTRAINT "MemorizationGoalCredit_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "RecitationAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
