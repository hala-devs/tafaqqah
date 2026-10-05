import "dotenv/config";
import { getAIProvider } from "../src/server/ai/factory";
import { QuestionGenerator } from "../src/server/ai/question-generator";
import { QuestionValidator } from "../src/server/ai/question-validator";
import type { TrustedPassage } from "../src/server/ai/types";
import { CURRICULUM } from "../prisma/seed-data/curriculum";

/**
 * Measures real generator + validator latency with the configured provider.
 * Usage (needs AI_PROVIDER=anthropic and ANTHROPIC_API_KEY):
 *   npm run measure:latency -- 6
 * Uses the demo passages (no database needed). Costs real API calls.
 */
const runs = Math.max(1, Math.min(20, Number(process.argv[2] ?? 4)));

function pct(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  const provider = getAIProvider();
  if (provider.isDevelopmentMock) console.warn("⚠ Using the development mock — numbers do not reflect a real model.");
  const passages = CURRICULUM.flatMap((c) => c.chapters.flatMap((ch) => ch.lessons.flatMap((l) => l.concepts)))
    .filter((c) => c.passages[0]?.approved)
    .map((c) => ({ concept: c, passage: c.passages[0] }));

  const generator = new QuestionGenerator(provider);
  const validator = new QuestionValidator(provider);
  const gen: number[] = [];
  const val: number[] = [];
  const total: number[] = [];
  let valid = 0;

  for (let i = 0; i < runs; i++) {
    const { concept, passage } = passages[i % passages.length];
    const trusted: TrustedPassage = { ...passage, version: 1 };
    const started = Date.now();
    const g = await generator.generate({
      lessonId: "measure",
      conceptId: concept.id,
      conceptTitle: concept.title,
      passage: trusted,
      stage: "VERIFICATION",
      questionType: "MCQ",
      targetDifficulty: 2,
      previous: null,
      previousQuestions: [],
      previousRejections: [],
    });
    gen.push(g.meta.latencyMs);
    if (g.kind !== "OK") {
      console.log(`#${i + 1} ${concept.id}: generator ${g.kind}`);
      total.push(Date.now() - started);
      continue;
    }
    const v = await validator.validate({ passage: trusted, conceptTitle: concept.title, candidate: g.candidate, previousQuestions: [] });
    if (v.meta) val.push(v.meta.latencyMs);
    if (v.valid) valid++;
    total.push(Date.now() - started);
    console.log(`#${i + 1} ${concept.id}: ${v.valid ? "VALID" : `REJECTED ${v.issues.join(",")}`} · gen ${g.meta.latencyMs}ms · val ${v.meta?.latencyMs ?? "skipped"}ms`);
  }

  const row = (label: string, xs: number[]) =>
    xs.length ? `${label.padEnd(22)} n=${xs.length}  p50=${(pct(xs, 50) / 1000).toFixed(1)}s  p95=${(pct(xs, 95) / 1000).toFixed(1)}s  max=${(Math.max(...xs) / 1000).toFixed(1)}s` : `${label}: no data`;
  console.log(`\nprovider=${provider.name} generator=${provider.generatorModel} validator=${provider.validatorModel}`);
  console.log(row("generator call", gen));
  console.log(row("validator call", val));
  console.log(row("one attempt (gen+val)", total));
  console.log(`valid on first attempt: ${valid}/${runs}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
