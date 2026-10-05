import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";
import { describe, expect, it } from "vitest";
import { GENERATOR_SYSTEM_PROMPT, VALIDATOR_SYSTEM_PROMPT } from "@/server/ai/prompts";
import { REINFORCEMENT_SYSTEM_PROMPT } from "@/server/memorization/reinforcement/ai-planner";
import { COACH_SYSTEM_PROMPT } from "@/server/memorization/reinforcement/coach-ai";

/**
 * P. No secrets or server-only material in the browser bundle.
 * Runs against the production build output (`npm run build` first); skipped otherwise.
 */
const STATIC_DIR = join(process.cwd(), ".next", "static");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe.skipIf(!existsSync(STATIC_DIR))("P. client bundle contains no secrets", () => {
  const env = existsSync(".env") ? parse(readFileSync(".env")) : {};
  const bundle = files(STATIC_DIR)
    .filter((f) => /\.(js|css|json|txt|html)$/.test(f))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  it("does not include environment secrets", () => {
    for (const key of ["DATABASE_URL", "TEST_DATABASE_URL", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "ADMIN_PASSWORD"]) {
      const value = env[key];
      if (value && value.length >= 8) expect(bundle.includes(value), `${key} leaked`).toBe(false);
    }
    expect(bundle).not.toMatch(/sk-ant-[A-Za-z0-9]/);
    expect(bundle).not.toMatch(/AIza[A-Za-z0-9_-]{20,}/);
    expect(bundle).not.toMatch(/postgres(ql)?:\/\/[^"'\s]+@/);
  });

  it("does not ship the AI prompts or server modules", () => {
    expect(bundle.includes(GENERATOR_SYSTEM_PROMPT.slice(0, 60))).toBe(false);
    expect(bundle.includes(VALIDATOR_SYSTEM_PROMPT.slice(0, 60))).toBe(false);
    expect(bundle.includes(REINFORCEMENT_SYSTEM_PROMPT.slice(0, 60))).toBe(false);
    expect(bundle.includes(COACH_SYSTEM_PROMPT.slice(0, 60))).toBe(false);
    expect(bundle).not.toContain("@anthropic-ai/sdk");
    expect(bundle).not.toContain("@google/genai");
  });
});
