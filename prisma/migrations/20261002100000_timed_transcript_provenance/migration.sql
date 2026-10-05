-- Structured, human-entered transcript provenance. These fields are not consumed as
-- instructions or fetched at runtime; every new/edited passage remains unapproved.
ALTER TABLE "SourcePassage"
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "startSecond" INTEGER,
  ADD COLUMN "endSecond" INTEGER;
