-- Preserve existing wordIndexes as incorrect-word indexes. New rows can additionally
-- record forgotten words, without reinterpreting any historical assessment.
ALTER TABLE "RecitationUnitResult"
ADD COLUMN "forgottenWordIndexes" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
