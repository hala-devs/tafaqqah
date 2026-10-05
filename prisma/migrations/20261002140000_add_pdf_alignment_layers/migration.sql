-- AlterTable
ALTER TABLE "SourcePassage" ADD COLUMN     "rawPdfText" TEXT,
ADD COLUMN     "pdfSource" TEXT,
ADD COLUMN     "pdfPageStart" INTEGER,
ADD COLUMN     "pdfPageEnd" INTEGER,
ADD COLUMN     "bahethUrl" TEXT,
ADD COLUMN     "videoUrl" TEXT,
ADD COLUMN     "alignmentStatus" TEXT,
ADD COLUMN     "alignmentConfidence" DOUBLE PRECISION,
ADD COLUMN     "humanReviewRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "alignmentDetails" JSONB;
