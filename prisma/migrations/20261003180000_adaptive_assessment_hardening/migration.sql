-- Adaptive assessment hardening:
--   • question stage + full admin traceability columns on GeneratedQuestion
--   • sourceSupport is renamed answerEvidence (verbatim proof of the correct answer) and gains explanationEvidence
--   • SourcePassage.approvedTextHash, stamped by a trigger when a passage becomes approved, so the
--     AI pipeline can prove that the text it reads is the text a human approved.

-- CreateEnum
CREATE TYPE "QuestionStage" AS ENUM ('BASELINE', 'VERIFICATION', 'SECOND_VERIFICATION', 'REASSESSMENT');

-- AlterTable
ALTER TABLE "GeneratedQuestion" RENAME COLUMN "sourceSupport" TO "answerEvidence";
ALTER TABLE "GeneratedQuestion"
  ADD COLUMN "explanationEvidence" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "stage" "QuestionStage" NOT NULL DEFAULT 'BASELINE',
  ADD COLUMN "previousQuestionId" TEXT,
  ADD COLUMN "studentPreviousAnswer" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "promptVersion" TEXT,
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "generatorRaw" JSONB,
  ADD COLUMN "validatorResult" JSONB;

-- Questions generated before stages existed were all post-error verification checks.
UPDATE "GeneratedQuestion"
SET "stage" = 'VERIFICATION'
WHERE "origin" = 'AI_GENERATED' AND "generatorMetadata" ? 'verificationFor';

ALTER TABLE "GeneratedQuestion"
  ADD CONSTRAINT "GeneratedQuestion_previousQuestionId_fkey"
  FOREIGN KEY ("previousQuestionId") REFERENCES "GeneratedQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "SourcePassage" ADD COLUMN "approvedTextHash" TEXT;

-- Passages that are approved today were approved with their current text (editing text revokes approval).
UPDATE "SourcePassage"
SET "approvedTextHash" = encode(sha256(convert_to("text", 'UTF8')), 'hex')
WHERE "approved" = true;

-- Stamp the hash whenever a passage BECOMES approved (insert or false → true); clear it on revocation.
-- Editing the text of an already-approved row leaves the stamped hash untouched, so a mismatch is detectable.
CREATE OR REPLACE FUNCTION "stamp_source_passage_approval_hash"() RETURNS trigger AS $$
BEGIN
  IF NEW."approved" THEN
    IF TG_OP = 'INSERT' OR OLD."approved" IS DISTINCT FROM TRUE THEN
      NEW."approvedTextHash" := encode(sha256(convert_to(NEW."text", 'UTF8')), 'hex');
    END IF;
  ELSE
    NEW."approvedTextHash" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SourcePassage_stamp_approval_hash"
BEFORE INSERT OR UPDATE ON "SourcePassage"
FOR EACH ROW EXECUTE FUNCTION "stamp_source_passage_approval_hash"();
