import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchNext } from "@/components/learning/next-request";

/**
 * Browser half of «never report a saved question as a failure». `fetch` is scripted: each call is answered by the
 * next handler, which sees whether it was the read-only peek or a real request.
 */
type Call = { peek: boolean };
type Handler = (call: Call) => Response | "NETWORK";

const URL = "/api/assessment/s1/next";
const POLL = { tries: 5, ms: 0 };
const QUESTION = { kind: "question", question: { id: "q-saved" }, progress: {} };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const failure = (code: string, status = 503) => json({ error: { code, message: "…" } }, status);

function script(handlers: Handler[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const call = { peek: Boolean(JSON.parse(String(init.body)).peek) };
      calls.push(call);
      const handler = handlers.shift();
      if (!handler) throw new Error("unexpected extra request");
      const result = handler(call);
      if (result === "NETWORK") throw new TypeError("Failed to fetch");
      return result;
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("next question requests (client)", () => {
  it("A — a normal success is returned as is, with one request", async () => {
    const calls = script([() => json(QUESTION)]);
    await expect(fetchNext(URL, () => ({}), { poll: POLL })).resolves.toEqual(QUESTION);
    expect(calls).toEqual([{ peek: false }]);
  });

  it("B — the response is lost after the server saved the question → the saved question is shown, no failure", async () => {
    const calls = script([() => "NETWORK", () => json(QUESTION)]);
    await expect(fetchNext(URL, () => ({}), { poll: POLL })).resolves.toEqual(QUESTION);
    // The second call was the read-only peek, not a new generation.
    expect(calls).toEqual([{ peek: false }, { peek: true }]);
  });

  it("B — a proxy error page (non-JSON 502) while the server finishes → waits for the generation, then shows it", async () => {
    const calls = script([() => new Response("<html>bad gateway</html>", { status: 502 }), () => json({ kind: "pending" }), () => json(QUESTION)]);
    await expect(fetchNext(URL, () => ({}), { poll: POLL })).resolves.toEqual(QUESTION);
    expect(calls.slice(1).every((c) => c.peek)).toBe(true);
  });

  it("C — retry when the question is already saved shows it without any generation request", async () => {
    const calls = script([() => json(QUESTION)]);
    await expect(fetchNext(URL, () => ({}), { checkFirst: true, poll: POLL })).resolves.toEqual(QUESTION);
    expect(calls).toEqual([{ peek: true }]);
  });

  it("E — a genuine failure (nothing saved) is reported, and retry then makes ONE real request", async () => {
    script([() => failure("GENERATION_FAILED"), () => json({ kind: "none" })]);
    const error = await fetchNext(URL, () => ({}), { poll: POLL }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).failure.code).toBe("GENERATION_FAILED");

    const calls = script([() => json({ kind: "none" }), () => json(QUESTION)]);
    await expect(fetchNext(URL, () => ({}), { checkFirst: true, poll: POLL })).resolves.toEqual(QUESTION);
    expect(calls).toEqual([{ peek: true }, { peek: false }]);
  });

  it("final refusals are not reconciled (no extra request)", async () => {
    for (const code of ["INSUFFICIENT_SOURCE", "AI_NOT_CONFIGURED", "RATE_LIMITED", "NOT_FOUND"]) {
      const calls = script([() => failure(code, 400)]);
      await expect(fetchNext(URL, () => ({}), { poll: POLL })).rejects.toBeInstanceOf(ApiError);
      expect(calls).toHaveLength(1);
    }
  });

  it("a lost connection with nothing saved still ends in the network message (peek also unreachable)", async () => {
    script([() => "NETWORK", () => "NETWORK", () => "NETWORK", () => "NETWORK"]);
    const error = (await fetchNext(URL, () => ({}), { poll: POLL }).catch((e) => e)) as ApiError;
    expect(error.failure.code).toBe("NETWORK");
  });
});
