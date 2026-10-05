-- Forward-only, idempotent release fix. Guarantees the word-level self-assessment enum and columns from
-- 20261004110000_recitation_word_self_assessment exist on every database:
--   - existing databases (where 20261004110000 already added them): no-op;
--   - fresh databases (where 20261004110000 ran before the table existed): adds them now.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SelfAssessmentScope') THEN
    CREATE TYPE "SelfAssessmentScope" AS ENUM ('WORDS', 'FULL_UNIT');
  END IF;
END $$;

ALTER TABLE "RecitationUnitResult"
  ADD COLUMN IF NOT EXISTS "selfAssessmentScope" "SelfAssessmentScope",
  ADD COLUMN IF NOT EXISTS "wordIndexes" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
