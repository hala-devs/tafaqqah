import { AppError } from "@/server/errors";
import type { SessionUser } from "./session-store";

type Actor = Pick<SessionUser, "id" | "role"> | null | undefined;

/** Single gate for every admin mutation. Throws for anonymous users and students. */
export function assertAdmin(actor: Actor): asserts actor is Pick<SessionUser, "id" | "role"> {
  if (!actor) throw new AppError("UNAUTHENTICATED");
  if (actor.role !== "ADMIN") throw new AppError("FORBIDDEN");
}
