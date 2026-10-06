/**
 * Browser half of «get the next question», kept free of React so it can be tested directly.
 *
 * The server saves a question before its HTTP response leaves. If that response is lost (connection dropped, tab
 * suspended on mobile, proxy error, a slow poll giving up), the question still exists. So no failure is shown before
 * the server has been asked — with the read-only `peek` request, which never generates — whether a question is waiting.
 */

export type ApiFailure = { code: string; message: string };

export class ApiError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.code);
  }
}

export const NETWORK_FAILURE: ApiFailure = {
  code: "NETWORK",
  message: "تعذّر الاتصال بالخادم. تحقّق من اتصالك ثم حاول مرة أخرى.",
};

/** Codes for which retrying the same step makes no sense. */
export const NO_RETRY_CODES = new Set(["AI_NOT_CONFIGURED", "INSUFFICIENT_SOURCE", "SOURCE_NOT_APPROVED"]);

/** Final refusals (nothing can be waiting on the server); every other failure is checked against the server first. */
const FINAL_CODES = new Set([...NO_RETRY_CODES, "RATE_LIMITED", "NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED", "BAD_REQUEST"]);

export function isReconcilable(error: unknown): boolean {
  return !(error instanceof ApiError) || !FINAL_CODES.has(error.failure.code);
}

export async function post<T>(url: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(NETWORK_FAILURE);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = (data as { error?: ApiFailure } | null)?.error;
    throw new ApiError(failure ?? { code: "INTERNAL", message: "حدث خطأ غير متوقع. حاول مرة أخرى." });
  }
  return data as T;
}

type Kinded = { kind: string };
export type Poll = { tries: number; ms: number };

export const DEFAULT_POLL: Poll = { tries: 60, ms: 2500 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read-only check of what the server already has (`{ peek: true }`): the saved unanswered question or the end of the
 * session; waits while another request still holds the generation lock; null when nothing exists.
 */
export async function reconcileNext<T extends Kinded>(url: string, poll: Poll = DEFAULT_POLL): Promise<T | null> {
  let failures = 0;
  for (let i = 0; i < poll.tries; i++) {
    let data: T | { kind: "none" | "pending" };
    try {
      data = await post<T | { kind: "none" | "pending" }>(url, { peek: true });
    } catch {
      if (++failures >= 3) return null;
      await sleep(poll.ms);
      continue;
    }
    if (data.kind === "none") return null;
    if (data.kind !== "pending") return data as T;
    await sleep(poll.ms);
  }
  return null;
}

/**
 * Asks for the next step. With `checkFirst` (the retry button) the server is asked for an already-saved question before
 * anything new is requested. A failed request is reconciled before it is reported: if the server saved a question,
 * that question is returned instead of an error.
 */
export async function fetchNext<T extends Kinded>(url: string, body: () => unknown, options: { checkFirst?: boolean; poll?: Poll } = {}): Promise<T> {
  const poll = options.poll ?? DEFAULT_POLL;
  try {
    if (options.checkFirst) {
      const existing = await reconcileNext<T>(url, poll);
      if (existing) return existing;
    }
    // "pending" means another request is already generating this session's question.
    for (let attempt = 0; attempt < poll.tries; attempt++) {
      const data = await post<T>(url, body());
      if (data.kind !== "pending") return data;
      await sleep(poll.ms);
    }
    throw new ApiError({ code: "AI_TIMEOUT", message: "استغرق تجهيز السؤال وقتًا أطول من المعتاد. حاول مرة أخرى." });
  } catch (error) {
    if (!isReconcilable(error)) throw error;
    const existing = await reconcileNext<T>(url, poll);
    if (existing) return existing;
    throw error;
  }
}
