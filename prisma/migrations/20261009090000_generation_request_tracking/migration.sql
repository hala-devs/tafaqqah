-- Additive only: request-level tracking rows for runtime question generation.
ALTER TYPE "AIInteractionType" ADD VALUE IF NOT EXISTS 'GENERATION_REQUEST';
ALTER TYPE "AIInteractionStatus" ADD VALUE IF NOT EXISTS 'STARTED';
ALTER TYPE "AIInteractionStatus" ADD VALUE IF NOT EXISTS 'FAILED';
