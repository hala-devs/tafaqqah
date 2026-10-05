-- Detail is forward-only. Existing results remain unit-level records with NULL scope and no indexes.
--
-- RELEASE FIX (ordering): this migration's timestamp sorts BEFORE 20261005090000_matn_memorization, which creates
-- "RecitationUnitResult". On databases where the table already existed when this ran, it behaves exactly as before.
-- On a fresh, empty database the table does not exist yet, so this is a no-op and
-- 20261008100000_ensure_recitation_word_self_assessment adds the same enum and columns after the table exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SelfAssessmentScope') THEN
    CREATE TYPE "SelfAssessmentScope" AS ENUM ('WORDS', 'FULL_UNIT');
  END IF;
  IF to_regclass('"RecitationUnitResult"') IS NOT NULL THEN
    ALTER TABLE "RecitationUnitResult"
      ADD COLUMN IF NOT EXISTS "selfAssessmentScope" "SelfAssessmentScope",
      ADD COLUMN IF NOT EXISTS "wordIndexes" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
  END IF;
END $$;
