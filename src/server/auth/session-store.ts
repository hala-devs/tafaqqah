import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a session row and returns the raw token (only ever placed in an httpOnly cookie). */
export async function createAuthSession(db: PrismaClient, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.authSession.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function findUserBySessionToken(db: PrismaClient, token: string): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const session = await db.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true, role: true } } },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await db.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

export async function deleteAuthSession(db: PrismaClient, token: string): Promise<void> {
  await db.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
}
