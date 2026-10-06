import type { PrismaClient } from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { assertAdmin } from "@/server/auth/authorization";
import type { SessionUser } from "@/server/auth/session-store";
import { resolveAIStatus } from "@/server/ai/factory";
import { readReport } from "@/server/assessment/report";
import { AUDIT_ACTIONS } from "./audit";
import { getLatencySummary } from "./evaluation";
import { getReviewQueue, type ReviewKind } from "./content-overview";

type Actor = Pick<SessionUser, "id" | "role"> | null;

const num = (value: unknown) => Number(value ?? 0);
const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

// ───────────────────────────── Dashboard ─────────────────────────────

export async function getDashboard(db: PrismaClient, actor: Actor) {
  assertAdmin(actor);
  const [levels, lessons, published, concepts, approvedPassages, totalPassages, approvedTimestamps, students, completedAssessments, aiValid, aiRejected, aiRejectedUnreviewed, queue] =
    await Promise.all([
      db.level.count(),
      db.lesson.count(),
      db.lesson.count({ where: { status: "PUBLISHED" } }),
      db.concept.count(),
      db.sourcePassage.count({ where: { approved: true } }),
      db.sourcePassage.count(),
      db.concept.count({ where: { videoApproved: true } }),
      db.user.count({ where: { role: "STUDENT" } }),
      db.assessmentSession.count({ where: { status: "COMPLETED" } }),
      db.generatedQuestion.count({ where: { origin: "AI_GENERATED", validationStatus: "VALID" } }),
      db.generatedQuestion.count({ where: { origin: "AI_GENERATED", validationStatus: "REJECTED" } }),
      db.generatedQuestion.findFirst({ where: { origin: "AI_GENERATED", validationStatus: "REJECTED" }, orderBy: { createdAt: "desc" }, select: { number: true } }),
      getReviewQueue(db, actor),
    ]);

  const byKind = (kind: ReviewKind) => queue.items.filter((item) => item.kind === kind);
  return {
    totals: {
      levels,
      lessons,
      published,
      inPreparation: lessons - published,
      concepts,
      approvedPassages,
      pendingPassages: totalPassages - approvedPassages,
      approvedTimestamps,
      students,
      completedAssessments,
      aiGenerated: aiValid + aiRejected,
      aiValid,
      aiRejected,
    },
    actions: {
      lessonsAwaitingApproval: queue.lessons.filter((l) => l.contentStatus === "READY_FOR_REVIEW"),
      humanReview: byKind("HUMAN_REVIEW"),
      textUnapproved: byKind("TEXT_UNAPPROVED"),
      timestampUnapproved: byKind("TIMESTAMP_UNAPPROVED"),
      readyToPublish: queue.lessons.filter((l) => l.readyToPublish),
      publishedWithRevokedApproval: queue.lessons.filter((l) => l.publishedWithRevokedApproval),
      aiRejected,
      latestRejectedQuestionNumber: aiRejectedUnreviewed?.number ?? null,
    },
  };
}

// ───────────────────────────── Students ─────────────────────────────

/** Masks an email for display: first letter + domain only. Admins need to tell students apart, not to read their mail. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "—";
  return `${local.slice(0, 1)}•••@${domain}`;
}

export async function getStudents(db: PrismaClient, actor: Actor) {
  assertAdmin(actor);
  const users = await db.user.findMany({
    where: { role: "STUDENT" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      lessonProgress: { select: { lessonId: true, studied: true, completedAt: true } },
      assessmentSessions: { select: { lessonId: true, status: true } },
      masteries: { where: { attempts: { gt: 0 } }, select: { masteryScore: true, state: true } },
    },
  });
  return users.map((user) => {
    const started = new Set([...user.lessonProgress.filter((p) => p.studied).map((p) => p.lessonId), ...user.assessmentSessions.map((s) => s.lessonId)]);
    return {
      id: user.id,
      name: user.name,
      maskedEmail: maskEmail(user.email),
      joinedAt: user.createdAt,
      lessonsStarted: started.size,
      lessonsCompleted: user.lessonProgress.filter((p) => p.completedAt).length,
      assessments: user.assessmentSessions.filter((s) => s.status === "COMPLETED").length,
      avgMastery: avg(user.masteries.map((m) => m.masteryScore)),
      masteredConcepts: user.masteries.filter((m) => m.state === "MASTERED").length,
      reinforceConcepts: user.masteries.filter((m) => m.state === "NEEDS_REINFORCEMENT").length,
    };
  });
}

export async function getStudentDetail(db: PrismaClient, actor: Actor, studentId: string) {
  assertAdmin(actor);
  const user = await db.user.findFirst({
    where: { id: studentId, role: "STUDENT" },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      lessonProgress: { select: { lessonId: true, studied: true, studiedAt: true, completedAt: true } },
      masteries: {
        where: { attempts: { gt: 0 } },
        orderBy: [{ masteryScore: "asc" }],
        select: { masteryScore: true, state: true, attempts: true, correctCount: true, incorrectCount: true, concept: { select: { id: true, title: true, lesson: { select: { id: true, title: true } } } } },
      },
      assessmentSessions: {
        where: { status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        select: { id: true, purpose: true, mode: true, completedAt: true, report: true, lesson: { select: { id: true, title: true } } },
      },
    },
  });
  if (!user) return null;
  const lessons = await db.lesson.findMany({ where: { status: { in: ["PUBLISHED", "COMING_SOON"] } }, orderBy: [{ chapter: { order: "asc" } }, { order: "asc" }], select: { id: true, title: true, status: true } });
  const progress = new Map(user.lessonProgress.map((p) => [p.lessonId, p]));
  return {
    id: user.id,
    name: user.name,
    maskedEmail: maskEmail(user.email),
    joinedAt: user.createdAt,
    path: lessons.map((lesson) => ({
      id: lesson.id,
      title: lesson.title,
      published: lesson.status === "PUBLISHED",
      studied: Boolean(progress.get(lesson.id)?.studied),
      completed: Boolean(progress.get(lesson.id)?.completedAt),
    })),
    masteries: user.masteries.map((m) => ({
      conceptId: m.concept.id,
      conceptTitle: m.concept.title,
      lessonId: m.concept.lesson.id,
      lessonTitle: m.concept.lesson.title,
      score: m.masteryScore,
      state: m.state,
      attempts: m.attempts,
      correct: m.correctCount,
      incorrect: m.incorrectCount,
    })),
    attempts: user.assessmentSessions.map((s) => {
      const report = readReport(s.report);
      return {
        id: s.id,
        lessonId: s.lesson.id,
        lessonTitle: s.lesson.title,
        purpose: s.purpose,
        mode: s.mode,
        completedAt: s.completedAt,
        accuracy: report?.accuracy ?? null,
        totalQuestions: report?.totalQuestions ?? null,
      };
    }),
  };
}

// ───────────────────────────── Analytics ─────────────────────────────

/** Real aggregates only. A metric with no underlying rows is returned as null/[] so the UI shows an empty state. */
export async function getAnalytics(db: PrismaClient, actor: Actor) {
  assertAdmin(actor);
  const [progressByLesson, lessons, sessions, missed, reinforce, recovery, aiTotals] = await Promise.all([
    db.lessonProgress.groupBy({ by: ["lessonId"], _count: { _all: true }, where: { studied: true } }),
    db.lesson.findMany({ select: { id: true, title: true, order: true } }),
    db.assessmentSession.findMany({ where: { status: "COMPLETED" }, select: { lessonId: true, purpose: true, report: true } }),
    db.$queryRaw<{ conceptId: string; title: string; lessonTitle: string; wrong: bigint; total: bigint }[]>(Prisma.sql`
      SELECT q."conceptId", c.title, l.title AS "lessonTitle",
             count(*) FILTER (WHERE NOT a.correct) AS wrong, count(*) AS total
      FROM "StudentAnswer" a
      JOIN "GeneratedQuestion" q ON q.id = a."questionId"
      JOIN "Concept" c ON c.id = q."conceptId"
      JOIN "Lesson" l ON l.id = q."lessonId"
      GROUP BY q."conceptId", c.title, l.title
      HAVING count(*) FILTER (WHERE NOT a.correct) > 0
      ORDER BY wrong DESC, total DESC
      LIMIT 8`),
    db.conceptMastery.groupBy({ by: ["conceptId"], where: { state: "NEEDS_REINFORCEMENT" }, _count: { _all: true }, orderBy: { _count: { conceptId: "desc" } }, take: 8 }),
    db.$queryRaw<{ total: bigint; recovered: bigint }[]>(Prisma.sql`
      WITH ever AS (
        SELECT DISTINCT a."userId", q."conceptId"
        FROM "StudentAnswer" a JOIN "GeneratedQuestion" q ON q.id = a."questionId"
        WHERE a."stateBefore" = 'NEEDS_REINFORCEMENT' OR a."stateAfter" = 'NEEDS_REINFORCEMENT')
      SELECT count(*) AS total, count(*) FILTER (WHERE m.state IN ('GOOD', 'MASTERED')) AS recovered
      FROM ever e LEFT JOIN "ConceptMastery" m ON m."userId" = e."userId" AND m."conceptId" = e."conceptId"`),
    db.generatedQuestion.groupBy({ by: ["validationStatus"], where: { origin: "AI_GENERATED" }, _count: { _all: true } }),
  ]);

  const lessonMap = new Map(lessons.map((l) => [l.id, l]));
  const startedByLesson = new Map(progressByLesson.map((p) => [p.lessonId, p._count._all]));
  const completedProgress = await db.lessonProgress.groupBy({ by: ["lessonId"], _count: { _all: true }, where: { completedAt: { not: null } } });
  const completedByLesson = new Map(completedProgress.map((p) => [p.lessonId, p._count._all]));

  const lessonRows = [...startedByLesson.entries()]
    .map(([lessonId, started]) => ({
      lessonId,
      title: lessonMap.get(lessonId)?.title ?? "—",
      started,
      completed: completedByLesson.get(lessonId) ?? 0,
      completionRate: (completedByLesson.get(lessonId) ?? 0) / started,
    }))
    .sort((a, b) => b.started - a.started);

  const practice = sessions.filter((s) => s.purpose === "PRACTICE");
  const accuracies = practice.map((s) => readReport(s.report)?.accuracy).filter((v): v is number => typeof v === "number");

  const concepts = await db.concept.findMany({ where: { id: { in: reinforce.map((r) => r.conceptId) } }, select: { id: true, title: true, lesson: { select: { title: true } } } });
  const conceptMap = new Map(concepts.map((c) => [c.id, c]));
  const valid = aiTotals.find((t) => t.validationStatus === "VALID")?._count._all ?? 0;
  const rejected = aiTotals.find((t) => t.validationStatus === "REJECTED")?._count._all ?? 0;
  const recoveryRow = recovery[0];

  return {
    lessonRows,
    avgAccuracy: avg(accuracies),
    completedAssessments: sessions.length,
    missedConcepts: missed.map((m) => ({ conceptId: m.conceptId, title: m.title, lessonTitle: m.lessonTitle, wrong: num(m.wrong), total: num(m.total) })),
    repeatedReview: reinforce.map((r) => ({
      conceptId: r.conceptId,
      title: conceptMap.get(r.conceptId)?.title ?? "—",
      lessonTitle: conceptMap.get(r.conceptId)?.lesson.title ?? "—",
      students: r._count._all,
    })),
    recovery: num(recoveryRow?.total) > 0 ? { total: num(recoveryRow?.total), recovered: num(recoveryRow?.recovered) } : null,
    ai: { generated: valid + rejected, valid, rejected, acceptanceRate: valid + rejected > 0 ? valid / (valid + rejected) : null },
  };
}

// ───────────────────────────── AI / assessments ─────────────────────────────

export async function getAiOverview(db: PrismaClient, actor: Actor) {
  assertAdmin(actor);
  const trial = { metadata: { path: ["trial"], equals: true } } satisfies Prisma.AIInteractionLogWhereInput;
  const [logGroups, trialGenerations, trialValidations, rejected, valid, reasons, recentErrors, latency, conceptRows, stageGroups, failureKindRows, modelRows] = await Promise.all([
    db.aIInteractionLog.groupBy({ by: ["type", "status"], _count: { _all: true } }),
    db.aIInteractionLog.count({ where: { type: "GENERATE", ...trial } }),
    db.aIInteractionLog.count({ where: { type: "VALIDATE", ...trial } }),
    db.generatedQuestion.count({ where: { origin: "AI_GENERATED", validationStatus: "REJECTED" } }),
    db.generatedQuestion.count({ where: { origin: "AI_GENERATED", validationStatus: "VALID" } }),
    db.$queryRaw<{ issue: string; n: bigint }[]>(Prisma.sql`
      SELECT issue, count(*) AS n FROM "GeneratedQuestion", unnest("validationIssues") AS issue
      WHERE "validationStatus" = 'REJECTED' AND origin = 'AI_GENERATED'
      GROUP BY issue ORDER BY n DESC LIMIT 12`),
    db.aIInteractionLog.findMany({
      where: { status: { in: ["PROVIDER_ERROR", "MALFORMED_OUTPUT"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, type: true, status: true, provider: true, model: true, createdAt: true, metadata: true },
    }),
    getLatencySummary(db, actor),
    db.concept.findMany({
      where: { passages: { some: { approved: true } } },
      orderBy: [{ lesson: { order: "asc" } }, { order: "asc" }],
      select: { id: true, title: true, lesson: { select: { id: true, title: true } } },
    }),
    db.generatedQuestion.groupBy({ by: ["stage", "validationStatus"], where: { origin: "AI_GENERATED" }, _count: { _all: true } }),
    db.$queryRaw<{ kind: string; n: bigint }[]>(Prisma.sql`
      SELECT metadata->>'failureKind' AS kind, count(*) AS n FROM "AIInteractionLog"
      WHERE metadata->>'failureKind' IS NOT NULL GROUP BY kind ORDER BY n DESC`),
    db.aIInteractionLog.groupBy({ by: ["provider", "model"], where: { type: "GENERATE", status: "SUCCESS" }, _count: { _all: true }, _max: { createdAt: true } }),
  ]);
  const count = (type: "GENERATE" | "VALIDATE", status?: string) =>
    logGroups.filter((g) => g.type === type && (!status || g.status === status)).reduce((sum, g) => sum + g._count._all, 0);

  return {
    status: resolveAIStatus(),
    generations: count("GENERATE"),
    validations: count("VALIDATE"),
    insufficientSource: count("GENERATE", "INSUFFICIENT_SOURCE"),
    providerErrors: logGroups.filter((g) => g.status === "PROVIDER_ERROR").reduce((s, g) => s + g._count._all, 0),
    malformed: logGroups.filter((g) => g.status === "MALFORMED_OUTPUT").reduce((s, g) => s + g._count._all, 0),
    trialGenerations,
    trialValidations,
    accepted: valid,
    rejected,
    reasons: reasons.map((r) => ({ issue: r.issue, n: num(r.n) })),
    recentErrors: recentErrors.map((e) => ({
      id: e.id,
      type: e.type,
      status: e.status,
      provider: e.provider,
      model: e.model,
      createdAt: e.createdAt,
      code: ((e.metadata ?? {}) as { errorCode?: string }).errorCode ?? null,
    })),
    latency,
    stages: (["VERIFICATION", "SECOND_VERIFICATION", "REASSESSMENT"] as const).map((stage) => ({
      stage,
      passed: stageGroups.filter((g) => g.stage === stage && g.validationStatus === "VALID").reduce((n, g) => n + g._count._all, 0),
      rejected: stageGroups.filter((g) => g.stage === stage && g.validationStatus === "REJECTED").reduce((n, g) => n + g._count._all, 0),
    })),
    failureKinds: failureKindRows.map((r) => ({ kind: r.kind, n: num(r.n) })),
    modelsUsed: modelRows
      .map((r) => ({ provider: r.provider, model: r.model, calls: r._count._all, lastUsedAt: r._max.createdAt }))
      .filter((r) => r.provider !== "server" && r.provider !== "deterministic")
      .sort((a, b) => (b.lastUsedAt?.getTime() ?? 0) - (a.lastUsedAt?.getTime() ?? 0)),
    trialConcepts: conceptRows.map((c) => ({ id: c.id, title: c.title, lessonId: c.lesson.id, lessonTitle: c.lesson.title })),
  };
}

// ───────────────────────────── Audit timeline ─────────────────────────────

export type AuditCategory = "approval" | "revocation" | "edit" | "publication" | "ai";
export const AUDIT_CATEGORY_LABEL: Record<AuditCategory, string> = {
  approval: "اعتماد",
  revocation: "إلغاء اعتماد",
  edit: "تعديل",
  publication: "نشر",
  ai: "الذكاء الاصطناعي",
};

export type AuditRow = {
  key: string;
  at: Date;
  category: AuditCategory;
  label: string;
  summary: string;
  actorName: string | null;
  lessonId: string | null;
  lessonTitle: string | null;
  /** audit = recorded by this log; legacy = reconstructed from approval fields saved before the log existed; ai = AI interaction log. */
  source: "audit" | "legacy" | "ai";
};

function categoryOf(action: string): AuditCategory {
  if (action.endsWith(".approved") || action === "lesson.bulk_approved") return "approval";
  if (action.endsWith(".revoked")) return "revocation";
  if (action === "lesson.published" || action === "lesson.unpublished") return "publication";
  if (action.startsWith("ai.")) return "ai";
  return "edit";
}

/**
 * One timeline from data that already exists: AuditEvent rows, the approver/approval-time fields on
 * passages and concepts (for approvals made before the log), and the AI interaction log.
 */
export async function getAuditTimeline(db: PrismaClient, actor: Actor, limit = 250): Promise<AuditRow[]> {
  assertAdmin(actor);
  const [events, firstEvent, passages, concepts, aiLogs, lessons] = await Promise.all([
    db.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: limit }),
    db.auditEvent.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.sourcePassage.findMany({ where: { approved: true, approvedAt: { not: null } }, select: { lessonId: true, approvedAt: true, approvedById: true } }),
    db.concept.findMany({ where: { videoApproved: true, videoApprovedAt: { not: null } }, select: { lessonId: true, videoApprovedAt: true, videoApprovedById: true } }),
    db.aIInteractionLog.findMany({
      where: { type: { not: "GENERATION_REQUEST" }, OR: [{ type: "VALIDATE" }, { status: { not: "SUCCESS" } }] },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: { id: true, type: true, status: true, provider: true, model: true, createdAt: true, metadata: true, sessionId: true },
    }),
    db.lesson.findMany({ select: { id: true, title: true } }),
  ]);
  const cutoff = firstEvent?.createdAt ?? new Date(8.64e15);
  const lessonTitle = new Map(lessons.map((l) => [l.id, l.title]));

  const rows: AuditRow[] = events.map((e) => ({
    key: `a:${e.id}`,
    at: e.createdAt,
    category: categoryOf(e.action),
    label: AUDIT_ACTIONS[e.action as keyof typeof AUDIT_ACTIONS] ?? e.action,
    summary: e.summary,
    actorName: e.actorId,
    lessonId: e.lessonId,
    lessonTitle: e.lessonId ? (lessonTitle.get(e.lessonId) ?? null) : null,
    source: "audit",
  }));

  // Pre-log approvals, grouped by lesson + approver + minute so a bulk approval is one line.
  const legacy = new Map<string, { at: Date; actorId: string | null; lessonId: string; kind: "text" | "timestamp"; n: number }>();
  const add = (kind: "text" | "timestamp", lessonId: string, at: Date, actorId: string | null) => {
    if (at >= cutoff) return;
    const key = `${kind}:${lessonId}:${actorId}:${Math.floor(at.getTime() / 60_000)}`;
    const existing = legacy.get(key);
    if (existing) existing.n += 1;
    else legacy.set(key, { at, actorId, lessonId, kind, n: 1 });
  };
  for (const p of passages) add("text", p.lessonId, p.approvedAt as Date, p.approvedById);
  for (const c of concepts) add("timestamp", c.lessonId, c.videoApprovedAt as Date, c.videoApprovedById);
  for (const [key, l] of legacy) {
    rows.push({
      key: `l:${key}`,
      at: l.at,
      category: "approval",
      label: l.kind === "text" ? AUDIT_ACTIONS["passage.approved"] : AUDIT_ACTIONS["timestamp.approved"],
      summary: l.kind === "text" ? `اعتماد ${l.n} مقطعًا مصدريًا (سجل محفوظ قبل تفعيل سجل العمليات)` : `اعتماد ${l.n} توقيتًا (سجل محفوظ قبل تفعيل سجل العمليات)`,
      actorName: l.actorId,
      lessonId: l.lessonId,
      lessonTitle: lessonTitle.get(l.lessonId) ?? null,
      source: "legacy",
    });
  }

  for (const log of aiLogs) {
    const meta = (log.metadata ?? {}) as { trial?: boolean; issues?: string[]; errorCode?: string };
    const outcome = log.status === "SUCCESS" ? "مقبول" : log.status === "REJECTED" ? `مرفوض${meta.issues?.length ? ` (${meta.issues.join("، ")})` : ""}` : log.status === "INSUFFICIENT_SOURCE" ? "مصدر غير كافٍ" : `خطأ${meta.errorCode ? ` (${meta.errorCode})` : ""}`;
    rows.push({
      key: `i:${log.id}`,
      at: log.createdAt,
      category: "ai",
      label: log.type === "VALIDATE" ? "تدقيق سؤال" : "توليد سؤال",
      summary: `${meta.trial ? "[تجريبي] " : ""}${log.provider}/${log.model} — ${outcome}`,
      actorName: null,
      lessonId: null,
      lessonTitle: null,
      source: "ai",
    });
  }

  // Resolve actor ids to display names.
  const actorIds = [...new Set(rows.map((r) => r.actorName).filter((v): v is string => Boolean(v)))];
  const users = await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  for (const row of rows) row.actorName = row.actorName ? (names.get(row.actorName) ?? "حساب محذوف") : null;

  return rows.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
