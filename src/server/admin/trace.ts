/**
 * Turns a stored question candidate into an auditable verdict:
 *   Question #142 · Generator: PASSED · Deterministic checks: PASSED · Validator: PASSED · Displayed: YES
 * Derived only from stored data (validation status, issues, metadata). No chain-of-thought exists
 * or is stored — only structured verdicts and short reviewer notes.
 */
export type StageVerdict = "PASSED" | "REJECTED" | "SKIPPED" | "NOT_APPLICABLE";

export type QuestionVerdict = {
  generator: StageVerdict;
  deterministic: StageVerdict;
  deterministicIssues: string[];
  validator: StageVerdict;
  validatorIssues: string[];
  displayed: boolean;
  answered: boolean;
  attempt: number;
  retries: number;
};

type Row = {
  origin: "AI_GENERATED" | "FIXED_BANK";
  validationStatus: "VALID" | "REJECTED";
  validationIssues: string[];
  generatorMetadata: unknown;
  sequence: number | null;
  answer?: unknown;
};

export function questionVerdict(row: Row): QuestionVerdict {
  const meta = (row.generatorMetadata ?? {}) as { deterministicIssues?: string[]; modelIssues?: string[]; attempt?: number };
  const displayed = row.sequence != null;
  const answered = Boolean(row.answer);
  if (row.origin === "FIXED_BANK") {
    return {
      generator: "NOT_APPLICABLE",
      deterministic: "NOT_APPLICABLE",
      deterministicIssues: [],
      validator: "NOT_APPLICABLE",
      validatorIssues: [],
      displayed,
      answered,
      attempt: 1,
      retries: 0,
    };
  }
  const deterministicIssues = meta.deterministicIssues ?? [];
  const deterministicFailed = deterministicIssues.length > 0;
  const validatorIssues = deterministicFailed
    ? []
    : row.validationIssues.filter((issue) => !deterministicIssues.includes(issue));
  const attempt = meta.attempt ?? 1;
  return {
    generator: "PASSED",
    deterministic: deterministicFailed ? "REJECTED" : "PASSED",
    deterministicIssues,
    validator: deterministicFailed ? "SKIPPED" : row.validationStatus === "VALID" ? "PASSED" : "REJECTED",
    validatorIssues,
    displayed,
    answered,
    attempt,
    retries: Math.max(0, attempt - 1),
  };
}

export const VERDICT_LABEL: Record<StageVerdict, string> = {
  PASSED: "PASSED",
  REJECTED: "REJECTED",
  SKIPPED: "SKIPPED",
  NOT_APPLICABLE: "—",
};
