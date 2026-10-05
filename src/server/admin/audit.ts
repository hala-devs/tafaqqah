import type { PrismaClient } from "@/generated/prisma/client";
import { assertAdmin } from "@/server/auth/authorization";
import type { SessionUser } from "@/server/auth/session-store";

type Actor = Pick<SessionUser, "id" | "role"> | null;
type AuditDb = Pick<PrismaClient, "auditEvent">;

/** Audit actions. The dotted key is stable; the Arabic label is for display only. */
export const AUDIT_ACTIONS = {
  "passage.approved": "اعتماد نص المقطع",
  "passage.revoked": "إلغاء اعتماد المقطع",
  "passage.edited": "تعديل مقطع مصدري",
  "passage.created": "إضافة مقطع مصدري",
  "timestamp.approved": "اعتماد التوقيت",
  "timestamp.revoked": "إلغاء اعتماد التوقيت",
  "timestamp.edited": "تعديل التوقيت",
  "concept.approved": "اعتماد المفهوم",
  "concept.revoked": "إلغاء اعتماد المفهوم",
  "concept.edited": "تعديل مفهوم",
  "concept.created": "إضافة مفهوم",
  "lesson.bulk_approved": "اعتماد الدرس كاملًا",
  "lesson.published": "نشر الدرس للطلاب",
  "lesson.unpublished": "إلغاء نشر الدرس",
  "lesson.edited": "تعديل بيانات الدرس",
  "lesson.created": "إنشاء درس",
  "level.status_changed": "تغيير حالة مستوى",
  "ai.trial_generation": "توليد سؤال تجريبي",
  "fixed_question.edited": "تعديل صياغة سؤال معتمد",
  "fixed_question.approved": "اعتماد سؤال أساسي",
  "fixed_question.revoked": "إلغاء اعتماد سؤال أساسي",
  "matn.section_approved": "اعتماد قسم من المتن",
  "matn.section_revoked": "إلغاء اعتماد قسم من المتن",
  "matn.passage_approved": "اعتماد مقطع من المتن",
  "matn.passage_revoked": "إلغاء اعتماد مقطع من المتن",
  "matn.unit_edited": "تعديل نص وحدة من المتن",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export type AuditInput = {
  action: AuditAction;
  entityType: "passage" | "concept" | "lesson" | "level" | "fixed_question" | "matn_section" | "matn_passage" | "matn_unit";
  entityId: string;
  lessonId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

/**
 * Appends an audit event. Called by the same service functions that perform the change, so the
 * record can never drift from the data (and cannot be written by a client).
 */
export async function recordAudit(db: AuditDb, actor: Actor, input: AuditInput): Promise<void> {
  assertAdmin(actor);
  await db.auditEvent.create({
    data: {
      action: input.action,
      actorId: actor.id,
      entityType: input.entityType,
      entityId: input.entityId,
      lessonId: input.lessonId ?? null,
      summary: input.summary,
      metadata: JSON.parse(JSON.stringify(input.metadata ?? {})),
    },
  });
}
