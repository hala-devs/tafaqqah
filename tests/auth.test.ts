import { beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { authenticate, isPortalRoleCompatible, registerUser } from "@/server/auth/accounts";
import { createAuthSession, deleteAuthSession, findUserBySessionToken, hashToken } from "@/server/auth/session-store";
import { assertAdmin } from "@/server/auth/authorization";
import { safeNextPath, safePortalNextPath } from "@/lib/safe-redirect";
import { AppError } from "@/server/errors";
import { hasTestDb, testDb, truncateAll } from "./helpers/db";

describe("password hashing", () => {
  it("never stores the plaintext and verifies correctly", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).not.toContain("correct horse battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("uses a unique salt per hash", async () => {
    expect(await hashPassword("same")).not.toEqual(await hashPassword("same"));
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "plain-text")).toBe(false);
  });
});

describe("safe post-login redirects", () => {
  it("accepts relative paths only", () => {
    expect(safeNextPath("/lessons/abc")).toBe("/lessons/abc");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
  });

  it("keeps callback destinations inside the authenticated portal", () => {
    expect(safePortalNextPath("/admin/settings", "ADMIN")).toBe("/admin/settings");
    expect(safePortalNextPath("/dashboard", "ADMIN")).toBe("/admin");
    expect(safePortalNextPath("/admin", "LEARNER")).toBe("/dashboard");
    expect(safePortalNextPath("https://evil.example", "LEARNER")).toBe("/dashboard");
  });
});

describe("portal-role separation", () => {
  it("accepts only the matching server-side portal and role", () => {
    expect(isPortalRoleCompatible("LEARNER", "STUDENT")).toBe(true);
    expect(isPortalRoleCompatible("ADMIN", "ADMIN")).toBe(true);
    expect(isPortalRoleCompatible("LEARNER", "ADMIN")).toBe(false);
    expect(isPortalRoleCompatible("ADMIN", "STUDENT")).toBe(false);
  });
});

describe("H. admin authorization gate", () => {
  it("denies anonymous users", () => {
    expect(() => assertAdmin(null)).toThrowError(AppError);
  });

  it("denies normal students", () => {
    try {
      assertAdmin({ id: "u1", role: "STUDENT" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("FORBIDDEN");
      expect((error as AppError).status).toBe(403);
    }
  });

  it("allows admins", () => {
    expect(() => assertAdmin({ id: "a1", role: "ADMIN" })).not.toThrow();
  });
});

describe.skipIf(!hasTestDb)("accounts and sessions (database)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("registers, rejects duplicate emails and authenticates", async () => {
    const db = testDb();
    const first = await registerUser(db, { name: "متعلم", email: "learner@example.com", password: "password-123" });
    expect(first.ok).toBe(true);
    const dup = await registerUser(db, { name: "آخر", email: "learner@example.com", password: "password-456" });
    expect(dup).toEqual({ ok: false, reason: "EMAIL_TAKEN" });

    const stored = await db.user.findUniqueOrThrow({ where: { email: "learner@example.com" } });
    expect(stored.passwordHash).not.toContain("password-123");
    expect(stored.role).toBe("STUDENT");

    expect(await authenticate(db, "learner@example.com", "password-123")).toBe(stored.id);
    expect(await authenticate(db, "learner@example.com", "nope")).toBeNull();
    expect(await authenticate(db, "missing@example.com", "password-123")).toBeNull();
  });

  it("stores only a hash of the session token and supports logout", async () => {
    const db = testDb();
    const reg = await registerUser(db, { name: "متعلم", email: "s@example.com", password: "password-123" });
    if (!reg.ok) throw new Error("registration failed");

    const { token } = await createAuthSession(db, reg.userId);
    const row = await db.authSession.findFirstOrThrow({ where: { userId: reg.userId } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toBe(token);

    expect((await findUserBySessionToken(db, token))?.id).toBe(reg.userId);
    await deleteAuthSession(db, token);
    expect(await findUserBySessionToken(db, token)).toBeNull();
  });

  it("rejects expired sessions", async () => {
    const db = testDb();
    const reg = await registerUser(db, { name: "متعلم", email: "e@example.com", password: "password-123" });
    if (!reg.ok) throw new Error("registration failed");
    const { token } = await createAuthSession(db, reg.userId);
    await db.authSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await findUserBySessionToken(db, token)).toBeNull();
  });
});
