import { contentTokens, jaccard, normalizeArabic, splitSentences } from "./arabic";
import type { AIProvider } from "./provider";
import { OPTION_IDS, VALIDATOR_CHECKS, type GenerationRequest, type PerformanceAnalysisRequest, type ProviderResponse, type ReinforcementExerciseRequest, type ReinforcementPlanRequest, type ValidationRequest } from "./types";

/**
 * ⚠ DEVELOPMENT-ONLY MOCK PROVIDER ⚠
 *
 * Lets the full learning loop run locally without an API key. It does NOT use any model:
 *  - "generation" turns one sentence of the approved passage into a fill-in-the-blank MCQ;
 *  - "validation" mechanically re-checks that exactly one option reconstructs text that
 *    exists in the passage.
 * The factory refuses to create it when NODE_ENV === "production", and every question it
 * produces is labelled in the UI and in AIInteractionLog.
 */
const BLANK = "……";
const PLACEHOLDER_MARKER = normalizeArabic("محتوى تجريبي — يُستبدل");

function delay(ms: number) {
  return process.env.NODE_ENV === "test" ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
}

function stripEndPunctuation(sentence: string): string {
  return sentence.replace(/[.!؟?؛،]+$/u, "").trim();
}

function wordsOf(sentence: string): string[] {
  return sentence.split(/\s+/).map((w) => w.replace(/^[«"(]+|[»")،.؛:!?؟]+$/gu, "")).filter(Boolean);
}

function isContentWord(word: string): boolean {
  return word.length >= 4 && contentTokens(word).length === 1;
}

export class MockProvider implements AIProvider {
  readonly name = "mock";
  readonly isDevelopmentMock = true;
  readonly generatorModel = "mock-generator (development only)";
  readonly validatorModel = "mock-validator (development only)";

  async generateQuestion(request: GenerationRequest): Promise<ProviderResponse> {
    const started = Date.now();
    await delay(700);
    const data = this.buildQuestion(request);
    return { data, provider: this.name, model: this.generatorModel, latencyMs: Date.now() - started, stopReason: "end_turn" };
  }

  async validateQuestion(request: ValidationRequest): Promise<ProviderResponse> {
    const started = Date.now();
    await delay(500);
    const passage = normalizeArabic(request.passage.text);
    const { candidate } = request;
    let supported: number[] = [];

    const quoted = candidate.question.match(/«([^»]+)»/u)?.[1];
    if (quoted && quoted.includes(BLANK)) {
      supported = candidate.options
        .map((option, index) => ({ index, text: normalizeArabic(quoted.replace(BLANK, option)) }))
        .filter((o) => passage.includes(o.text))
        .map((o) => o.index);
    }

    const valid = supported.length === 1 && supported[0] === request.correctIndex;
    const issues = valid ? [] : supported.length > 1 ? ["MULTIPLE_CORRECT_ANSWERS"] : supported.length === 0 ? ["UNANSWERABLE_FROM_SOURCE"] : ["ANSWER_NOT_SUPPORTED"];
    return {
      data: {
        claims: valid
          ? [
              { subject: "correctAnswer", claim: candidate.correctAnswer, sourceQuote: candidate.answerEvidence, relation: "IDENTICAL" },
              { subject: "explanation", claim: candidate.explanation, sourceQuote: candidate.explanationEvidence, relation: "IDENTICAL" },
            ]
          : [],
        valid,
        checks: Object.fromEntries(VALIDATOR_CHECKS.map((check) => [check, valid])),
        issues,
        supportedOptionIds: supported.map((i) => OPTION_IDS[i]),
        reasons: ["Development mock validator (string-substitution check)."],
      },
      provider: this.name,
      model: this.validatorModel,
      latencyMs: Date.now() - started,
      stopReason: "end_turn",
    };
  }

  /** Development-only: a deterministic observation built purely from the structured history it is given. */
  async analyzePerformance(request: PerformanceAnalysisRequest): Promise<ProviderResponse> {
    const started = Date.now();
    await delay(300);
    const p = request.payload as {
      historyAttempts?: number;
      currentAttempt?: { correct?: number; total?: number };
      weakUnits?: { unitId: string; currentStatus: string; previousOutcomes: string[] }[];
    };
    const history = p.historyAttempts ?? 0;
    const weak = p.weakUnits ?? [];
    const repeated = weak.filter((u) => u.currentStatus !== "CORRECT" && u.previousOutcomes.some((o) => o !== "CORRECT"));
    const current = weak.filter((u) => u.currentStatus !== "CORRECT");
    const patterns: string[] = [];
    if (repeated.length > 0) patterns.push("تكرر ضعف بعض الأجزاء في أكثر من محاولة.");
    else if (current.length > 0) patterns.push("ظهرت أجزاء تحتاج إلى مراجعة في هذه المحاولة.");
    return {
      data: {
        summary: current.length === 0 ? "كانت جميع الأجزاء ثابتة في هذه المحاولة." : "معظم الأجزاء ثابتة لديك، وبعضها يحتاج إلى مراجعة في المرة القادمة.",
        patterns,
        priorities: (repeated.length ? repeated : current).slice(0, 3).map((u) => ({ unitId: u.unitId, reason: "هذا الجزء لم يكن ثابتًا في تسميعك." })),
        progressObservation: history >= 1 && current.length === 0 ? "ثبتت لديك الأجزاء التي كانت تحتاج إلى مراجعة سابقًا." : "",
      },
      provider: this.name,
      model: this.generatorModel,
      latencyMs: Date.now() - started,
      stopReason: "end_turn",
    };
  }

  /**
   * Development-only reinforcement plan: one target per affected unit, previous-line context when it exists, repeated
   * evidence brought back later. Built only from the payload's allowed values; still goes through validatePlan().
   */
  async planReinforcement(request: ReinforcementPlanRequest): Promise<ProviderResponse> {
    const started = Date.now();
    await delay(300);
    type MockUnit = { ref: string; evidence: string; incorrectTokens: number[]; forgottenTokens: number[]; previousNeighborAvailable: boolean; supportedReasonCodes: string[] };
    const p = request.payload as { units?: MockUnit[]; allowed?: { observationKeys?: string[] } };
    let repeats = 0;
    const targets = (p.units ?? [])
      .filter((u) => u.evidence !== "CORRECT")
      .map((u) => {
        const reasonCode = u.supportedReasonCodes.find((r) => r.startsWith("REPEATED") || r === "FULL_UNIT_FORGOTTEN") ?? u.supportedReasonCodes[0] ?? "CURRENT_INCORRECT";
        const urgent = reasonCode.startsWith("REPEATED") || reasonCode === "FULL_UNIT_FORGOTTEN";
        const repeat = urgent && repeats < 3;
        if (repeat) repeats += 1;
        return {
          unitRefs: [u.ref],
          tokens: u.evidence === "WORDS" ? [...new Set([...u.incorrectTokens, ...u.forgottenTokens])].sort((a, b) => a - b).map((index) => ({ unitRef: u.ref, index })) : [],
          priority: urgent ? "HIGH" : "MEDIUM",
          contextStrategy: u.previousNeighborAvailable ? "PREVIOUS_AND_TARGET" : "TARGET_UNIT_ONLY",
          strategy: u.evidence === "WORDS" ? "TARGETED_RECALL" : "FULL_UNIT_RECALL",
          repeatPolicy: repeat ? "REPEAT_LATER_IN_SESSION" : "ONCE",
          reasonCode,
          urgent,
        };
      })
      .sort((a, b) => Number(b.urgent) - Number(a.urgent))
      .map(({ urgent: _urgent, ...t }) => t);
    return {
      data: { observationKey: p.allowed?.observationKeys?.[0] ?? "SINGLE_ISSUE", targets },
      provider: this.name,
      model: this.generatorModel,
      latencyMs: Date.now() - started,
      stopReason: "end_turn",
    };
  }

  /**
   * Development-only coach: a small adaptive policy over the payload (react to a failed recall with more context or the
   * whole unit, reduce the cue after a supported recall, come back later once, then finish). Built only from the
   * payload's facts; still goes through validateCoachDecision() like any provider output.
   */
  async decideReinforcementExercise(request: ReinforcementExerciseRequest): Promise<ProviderResponse> {
    const started = Date.now();
    await delay(250);
    type Last = { exerciseType: string; contextLevel: string; cueLevel: string } | null;
    type Target = { ref: string; open: boolean; exposures: number; delayedReturns: number; lastResponse: string | null; lastExercise: Last; exercisesSinceLast: number };
    type Unit = { ref: string; evidence: string; incorrectTokens: number[]; forgottenTokens: number[]; previousNeighborAvailable: boolean; nextNeighborAvailable: boolean; positions: { history: string }[]; previousIntervention: { outcome: string } | null };
    const p = request.payload as { units: Unit[]; targets: Target[]; adjacency: { boundaryPairs: [string, string][] } };
    const units = new Map(p.units.map((u) => [u.ref, u]));
    const order = p.units.map((u) => u.ref);
    const marked = (u: Unit) => [...new Set([...u.incorrectTokens, ...u.forgottenTokens])].sort((a, b) => a - b).map((index) => ({ unitRef: u.ref, index }));
    const exercise = (exerciseType: string, unitRefs: string[], hiddenTokens: { unitRef: string; index: number }[], contextLevel: string, cueLevel: string, reasonCode: string) => ({ action: "EXERCISE", exerciseType, unitRefs, hiddenTokens, contextLevel, cueLevel, reasonCode });
    const respond = (data: unknown): ProviderResponse => ({ data, provider: this.name, model: this.generatorModel, latencyMs: Date.now() - started, stopReason: "end_turn" });
    const open = p.targets.filter((t) => t.open);
    const firstReason = (u: Unit) =>
      u.previousIntervention && u.previousIntervention.outcome !== "NO_FOLLOW_UP" ? "PREVIOUS_INTERVENTION_REMAINED" : u.positions.some((x) => x.history === "REPEATED") ? "REPEATED_TARGET" : u.positions.some((x) => x.history === "PERSISTENT") ? "PERSISTENT_TARGET" : "NEW_SINGLE_TARGET";

    // 1. React to a failed or partial recall: change the strategy.
    for (const t of open) {
      const u = units.get(t.ref)!;
      if (t.lastResponse !== "NOT_RECALLED" && t.lastResponse !== "PARTIAL") continue;
      if (u.evidence === "WORDS" && t.lastExercise?.contextLevel === "NONE" && t.lastExercise.exerciseType !== "WHOLE_UNIT_RECALL") {
        const ctx = u.previousNeighborAvailable || order.indexOf(u.ref) > 0 ? "PREVIOUS" : u.nextNeighborAvailable || order.indexOf(u.ref) < order.length - 1 ? "NEXT" : null;
        if (ctx) return respond(exercise("CONTEXT_RECALL", [u.ref], marked(u), ctx, "FULL", "FAILED_TARGETED_RECALL"));
      }
      if (t.lastExercise?.exerciseType !== "WHOLE_UNIT_RECALL") return respond(exercise("WHOLE_UNIT_RECALL", [u.ref], [], "NONE", "NONE", "FAILED_TARGETED_RECALL"));
    }
    // 2. Practise every target once (cloze, whole unit for unit-level evidence; a previous intervention that did not hold → whole unit).
    for (const t of open) {
      if (t.exposures > 0) continue;
      const u = units.get(t.ref)!;
      if (u.evidence !== "WORDS") return respond(exercise("WHOLE_UNIT_RECALL", [u.ref], [], "NONE", "NONE", "FULL_UNIT_WEAKNESS"));
      if (u.previousIntervention && u.previousIntervention.outcome !== "NO_FOLLOW_UP") return respond(exercise("WHOLE_UNIT_RECALL", [u.ref], [], "NONE", "NONE", "PREVIOUS_INTERVENTION_REMAINED"));
      return respond(exercise("CLOZE_RECALL", [u.ref], marked(u), "NONE", "FULL", firstReason(u)));
    }
    // 3. Recalled with a strong cue → reduce the cue.
    for (const t of open) {
      const u = units.get(t.ref)!;
      if (u.evidence !== "WORDS" || t.lastResponse !== "RECALLED" || !t.lastExercise || t.lastExercise.cueLevel !== "FULL" || t.lastExercise.exerciseType === "WHOLE_UNIT_RECALL") continue;
      return respond(exercise("REDUCED_CUE_RECALL", [u.ref], marked(u), "NONE", "MINIMAL", "SUCCEEDED_WITH_CONTEXT"));
    }
    // 4. Come back once after another exercise.
    for (const t of open) {
      const u = units.get(t.ref)!;
      if (t.delayedReturns > 0 || t.exercisesSinceLast < 1) continue;
      return respond(exercise("DELAYED_RECALL", [u.ref], u.evidence === "WORDS" ? marked(u) : [], "NONE", u.evidence === "WORDS" ? "PARTIAL" : "NONE", "DELAYED_RECHECK"));
    }
    return respond({ action: "FINISH", exerciseType: "CLOZE_RECALL", unitRefs: [], hiddenTokens: [], contextLevel: "NONE", cueLevel: "FULL", reasonCode: "NEW_SINGLE_TARGET" });
  }

  private buildQuestion(request: GenerationRequest) {
    const insufficient = (reason: string) => ({
      status: "INSUFFICIENT_SOURCE",
      insufficientReason: reason,
      questionType: "MCQ",
      question: "",
      options: [],
      correctOptionId: "",
      explanation: "",
      grounding: { answerEvidence: "", explanationEvidence: "" },
    });
    const text = request.passage.text;
    if (normalizeArabic(text).includes(PLACEHOLDER_MARKER) || normalizeArabic(text).length < 60) {
      return insufficient("Passage is a placeholder or too short.");
    }

    const sentences = splitSentences(text)
      .map(stripEndPunctuation)
      .filter((s) => wordsOf(s).length >= 5);
    const offset = request.previousQuestions.length + request.previousRejections.length;
    const ordered = sentences.map((_, i) => sentences[(i + offset) % sentences.length]);
    // Never reuse a question the learner already saw (the validator enforces the same rule).
    const isNew = (q: string) => request.previousQuestions.every((prev) => jaccard(prev, q) < 0.6);

    for (const sentence of ordered) {
      const words = wordsOf(sentence);
      const sentenceNorm = new Set(words.map(normalizeArabic));
      const pool = Array.from(
        new Set(
          sentences
            .filter((s) => s !== sentence)
            .flatMap(wordsOf)
            .filter((w) => isContentWord(w) && !sentenceNorm.has(normalizeArabic(w))),
        ),
      );
      // Different blanked words give differently worded questions from the same sentence.
      const targets = Array.from(new Set(words.filter(isContentWord))).sort((a, b) => b.length - a.length).slice(0, 3);
      for (const target of targets) {
        // Distractors of a similar length, so the answer cannot be guessed from its size.
        const distractors = [...pool].sort((a, b) => Math.abs(a.length - target.length) - Math.abs(b.length - target.length)).slice(0, 3);
        if (distractors.length < 3) continue;
        // The correct word must not stand out by size either.
        const others = distractors.map((d) => d.length);
        if (target.length > Math.max(...others) && target.length > (others.reduce((a, b) => a + b, 0) / others.length) * 1.25) continue;
        const question = `أكمل العبارة: «${sentence.replace(target, BLANK)}»`;
        if (!isNew(question)) continue;
        const options = [target, ...distractors];
        return {
          status: "OK",
          insufficientReason: "",
          questionType: "MCQ",
          question,
          options: options.map((option, i) => ({ id: OPTION_IDS[i], text: option })),
          correctOptionId: "A",
          explanation: `${sentence}.`,
          grounding: { answerEvidence: sentence, explanationEvidence: sentence },
        };
      }
    }
    return insufficient("No new question can be built from this passage.");
  }
}
