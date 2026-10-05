import type { PrismaClient } from "@/generated/prisma/client";
import { assertAdmin } from "@/server/auth/authorization";
import type { SessionUser } from "@/server/auth/session-store";
import { readReport } from "@/server/assessment/report";

/**
 * Fixed-vs-adaptive evaluation support. Reports ONLY what is in the database — no
 * comparative claims are made anywhere in the product until a real study is run.
 */
export type EvaluationRow = {
  sessionId: string;
  userId: string;
  lessonId: string;
  mode: "ADAPTIVE" | "FIXED";
  purpose: "PRACTICE" | "PRE_TEST" | "POST_TEST" | "REASSESSMENT";
  status: string;
  startedAt: string;
  completedAt: string | null;
  totalQuestions: number | null;
  correctCount: number | null;
  accuracy: number | null;
  overallMastery: number | null;
  /** Concepts that ended the session in «يحتاج إلى تثبيت». */
  reinforceConceptCount: number | null;
  feedbackRating: number | null;
};

export async function getEvaluationRows(db: PrismaClient, actor: Pick<SessionUser, "id" | "role"> | null): Promise<EvaluationRow[]> {
  assertAdmin(actor);
  const sessions = await db.assessmentSession.findMany({
    orderBy: { startedAt: "asc" },
    include: { feedback: { select: { rating: true } } },
  });
  return sessions.map((s) => {
    const report = readReport(s.report);
    return {
      sessionId: s.id,
      userId: s.userId,
      lessonId: s.lessonId,
      mode: s.mode,
      purpose: s.purpose,
      status: s.status,
      startedAt: s.startedAt.toISOString(),
      completedAt: s.completedAt?.toISOString() ?? null,
      totalQuestions: report?.totalQuestions ?? null,
      correctCount: report?.correctCount ?? null,
      accuracy: report?.accuracy ?? null,
      overallMastery: report?.overallMastery ?? null,
      reinforceConceptCount: report?.reinforceConceptIds.length ?? null,
      feedbackRating: s.feedback?.rating ?? null,
    };
  });
}

export type ModeSummary = {
  mode: "ADAPTIVE" | "FIXED";
  started: number;
  completed: number;
  completionRate: number | null;
  avgQuestions: number | null;
  avgAccuracy: number | null;
  avgReviewConcepts: number | null;
  feedbackCount: number;
  avgRating: number | null;
};

const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function summarize(rows: EvaluationRow[]): ModeSummary[] {
  return (["ADAPTIVE", "FIXED"] as const).map((mode) => {
    // Compare lesson assessments only (pre/post tests and reassessments are separate measures).
    const own = rows.filter((r) => r.mode === mode && r.purpose === "PRACTICE");
    const done = own.filter((r) => r.status === "COMPLETED");
    const ratings = own.map((r) => r.feedbackRating).filter((r): r is number => r !== null);
    return {
      mode,
      started: own.length,
      completed: done.length,
      completionRate: own.length ? done.length / own.length : null,
      avgQuestions: avg(done.map((r) => r.totalQuestions ?? 0)),
      avgAccuracy: avg(done.map((r) => r.accuracy ?? 0)),
      avgReviewConcepts: avg(done.map((r) => r.reinforceConceptCount ?? 0)),
      feedbackCount: ratings.length,
      avgRating: avg(ratings),
    };
  });
}

// ───────────────────────────── Pre / post measurement ─────────────────────────────

export type MeasurementRow = {
  userId: string;
  lessonId: string;
  preScore: number | null;
  postScore: number | null;
  weakBefore: string[];
  weakAfter: string[];
  masteryBefore: unknown;
  masteryAfter: unknown;
  createdAt: string;
};

export async function getMeasurementRows(db: PrismaClient, actor: Pick<SessionUser, "id" | "role"> | null): Promise<MeasurementRow[]> {
  assertAdmin(actor);
  const rows = await db.lessonMeasurement.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({
    userId: r.userId,
    lessonId: r.lessonId,
    preScore: r.preScore,
    postScore: r.postScore,
    weakBefore: r.weakBefore,
    weakAfter: r.weakAfter,
    masteryBefore: r.masteryBefore,
    masteryAfter: r.masteryAfter,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Aggregates only learners who completed BOTH tests. No inference beyond the data. */
export function summarizeMeasurements(rows: MeasurementRow[]) {
  const paired = rows.filter((r) => r.preScore != null && r.postScore != null);
  return {
    started: rows.length,
    paired: paired.length,
    avgPre: avg(paired.map((r) => r.preScore as number)),
    avgPost: avg(paired.map((r) => r.postScore as number)),
    avgWeakBefore: avg(paired.map((r) => r.weakBefore.length)),
    avgWeakAfter: avg(paired.map((r) => r.weakAfter.length)),
  };
}

// ───────────────────────────── Latency ─────────────────────────────

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** Measured model-call latency from AIInteractionLog (real calls only, by provider). */
export async function getLatencySummary(db: PrismaClient, actor: Pick<SessionUser, "id" | "role"> | null) {
  assertAdmin(actor);
  const logs = await db.aIInteractionLog.findMany({
    where: { latencyMs: { not: null }, status: { in: ["SUCCESS", "REJECTED", "INSUFFICIENT_SOURCE"] }, provider: { not: "deterministic" } },
    select: { type: true, provider: true, latencyMs: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const groups = new Map<string, number[]>();
  for (const log of logs) {
    const key = `${log.provider}:${log.type}`;
    groups.set(key, [...(groups.get(key) ?? []), log.latencyMs as number]);
  }
  return [...groups.entries()].map(([key, values]) => {
    const [provider, type] = key.split(":");
    const sorted = [...values].sort((a, b) => a - b);
    return { provider, type, count: values.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: sorted[sorted.length - 1] };
  });
}
