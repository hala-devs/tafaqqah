import "server-only";
import { AppError, isAppError } from "./errors";

const MAX_BODY_BYTES = 10_000;

/** Same-origin guard for state-changing API calls (defence in depth on top of SameSite cookies). */
function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new AppError("FORBIDDEN");
  } catch (error) {
    if (isAppError(error)) throw error;
    throw new AppError("FORBIDDEN");
  }
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError("BAD_REQUEST");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("BAD_REQUEST");
  }
}

export type ApiError = { error: { code: string; message: string } };

/** Uniform JSON responses. Internal errors are logged server-side and never leaked. */
export async function apiHandler(request: Request, fn: () => Promise<unknown>): Promise<Response> {
  try {
    if (request.method !== "GET") assertSameOrigin(request);
    const data = await fn();
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isAppError(error)) {
      if (error.status >= 500) console.error(`[api] ${error.code}`, error.cause instanceof Error ? error.cause.message : "");
      return Response.json({ error: { code: error.code, message: error.userMessage } } satisfies ApiError, {
        status: error.status,
        headers: { "Cache-Control": "no-store" },
      });
    }
    console.error("[api] unexpected error", error instanceof Error ? `${error.name}: ${error.message}` : error);
    const internal = new AppError("INTERNAL");
    return Response.json({ error: { code: internal.code, message: internal.userMessage } } satisfies ApiError, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
