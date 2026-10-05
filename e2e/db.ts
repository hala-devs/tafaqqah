import "dotenv/config";
import { Client } from "pg";

/**
 * Test-side database access for the end-to-end journey (never used by the app).
 * Lets the test answer deliberately right or wrong, and attach a temporary approved
 * review video to a sample concept (always cleaned up).
 */
export async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function questionKey(questionId: string): Promise<{ correctIndex: number; conceptId: string; optionCount: number }> {
  return withDb(async (db) => {
    const { rows } = await db.query(
      'SELECT "correctIndex", "conceptId", array_length("options", 1) AS "optionCount" FROM "GeneratedQuestion" WHERE id = $1',
      [questionId],
    );
    return rows[0];
  });
}

export async function setConceptVideo(
  conceptId: string,
  video: { url: string; start: number; end: number } | null,
): Promise<void> {
  await withDb(async (db) => {
    if (video) {
      await db.query(
        'UPDATE "Concept" SET "videoUrl" = $2, "videoStartSecond" = $3, "videoEndSecond" = $4, "videoApproved" = true, "videoApprovedAt" = now() WHERE id = $1',
        [conceptId, video.url, video.start, video.end],
      );
    } else {
      await db.query(
        'UPDATE "Concept" SET "videoUrl" = NULL, "videoStartSecond" = NULL, "videoEndSecond" = NULL, "videoApproved" = false, "videoApprovedAt" = NULL WHERE id = $1',
        [conceptId],
      );
    }
  });
}

export type QuestionInfo = {
  correctIndex: number;
  conceptId: string;
  optionCount: number;
  stage: "BASELINE" | "VERIFICATION" | "SECOND_VERIFICATION" | "REASSESSMENT";
  origin: "AI_GENERATED" | "FIXED_BANK";
  question: string;
  explanation: string;
  answerEvidence: string;
  explanationEvidence: string;
  sessionId: string;
  validationStatus: string;
};

/** Full stored row of a served question (test-side only): what the learner saw plus the internal evidence. */
export async function questionInfo(questionId: string): Promise<QuestionInfo> {
  return withDb(async (db) => {
    const { rows } = await db.query(
      `SELECT "correctIndex", "conceptId", array_length("options", 1) AS "optionCount", stage, origin, question, explanation,
              "answerEvidence", "explanationEvidence", "sessionId", "validationStatus"
         FROM "GeneratedQuestion" WHERE id = $1`,
      [questionId],
    );
    return rows[0];
  });
}

export async function conceptVideo(conceptId: string): Promise<{ url: string | null; start: number | null; end: number | null; approved: boolean }> {
  return withDb(async (db) => {
    const { rows } = await db.query(
      `SELECT "videoUrl" AS url, "videoStartSecond" AS start, "videoEndSecond" AS "end", "videoApproved" AS approved FROM "Concept" WHERE id = $1`,
      [conceptId],
    );
    return rows[0];
  });
}

export async function geminiCallsForSession(sessionId: string): Promise<{ type: string; status: string; model: string; n: number }[]> {
  return withDb(async (db) => {
    const { rows } = await db.query(
      `SELECT type, status, model, count(*)::int AS n FROM "AIInteractionLog" WHERE "sessionId" = $1 GROUP BY type, status, model ORDER BY type, status`,
      [sessionId],
    );
    return rows;
  });
}
