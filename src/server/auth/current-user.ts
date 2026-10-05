import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { createAuthSession, deleteAuthSession, findUserBySessionToken, type SessionUser } from "./session-store";

export const SESSION_COOKIE = "tafaqqah_session";

export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return findUserBySessionToken(prisma, token);
});

/** For pages: redirects anonymous visitors to the login page. */
export async function requireUser(nextPath?: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  return user;
}

/** Learner-only page boundary. ADMIN sessions are redirected before any learner UI renders. */
export async function requireLearner(nextPath?: string): Promise<SessionUser> {
  const user = await requireUser(nextPath);
  if (user.role === "ADMIN") redirect("/admin");
  return user;
}

/** For admin pages: non-admins get a 404 so the admin area is not even discoverable. */
export async function requireAdminPage(): Promise<SessionUser> {
  const user = await requireUser("/admin");
  if (user.role !== "ADMIN") notFound();
  return user;
}

/** For route handlers and server actions. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("UNAUTHENTICATED");
  return user;
}

/** Learner-only action/API boundary. */
export async function requireApiLearner(): Promise<SessionUser> {
  const user = await requireApiUser();
  if (user.role === "ADMIN") throw new AppError("FORBIDDEN");
  return user;
}

export async function startSession(userId: string): Promise<void> {
  const { token, expiresAt } = await createAuthSession(prisma, userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await deleteAuthSession(prisma, token);
  store.delete(SESSION_COOKIE);
}
