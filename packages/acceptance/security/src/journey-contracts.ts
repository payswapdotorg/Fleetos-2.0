/**
 * @fleetos/acceptance-security — journey contracts (Wave 7 lane B, F270B).
 *
 * A journey is DATA + assertions, never imperative glue that can hide
 * failures:
 *   - each STEP names the REAL public entry points it drives (package +
 *     operation) and records plain JSON facts under stable paths;
 *   - each ASSERTION is declarative (a fact path + an expected value);
 *   - the RUNNER (never the journey) evaluates assertions against the
 *     recorded facts and decides pass/fail with actual-vs-expected evidence.
 *
 * Vocabulary laws:
 *   - the persona vocabulary is FIXED at 7 (the safety/intelligence lane's
 *     reading of the acceptance personas; TL unifies across lanes later);
 *   - the capability vocabulary is FIXED and mirrors the F270B deliverable
 *     list (investigate/evidence/Guardian/plans/execution/reasoning/advice/
 *     counterfactual/inspect/learning/benchmarks/agent-safety + the
 *     tenant-isolation cross-cut);
 *   - a journey may only declare packages from THIS lane (verified by the
 *     boundary self-check in tests).
 *
 * Determinism: no Date.now(), no Math.random(), no network, no timers.
 * Logical `now` is caller-supplied everywhere (the corpus pins fixed epochs).
 */

// ---------------------------------------------------------------------------
// Fixed vocabularies
// ---------------------------------------------------------------------------

/** The fixed 7-persona vocabulary for the safety/intelligence acceptance lane. */
export const JOURNEY_PERSONAS = [
  "security-analyst",
  "remediation-engineer",
  "tenant-operator",
  "automation-agent",
  "site-reliability-engineer",
  "compliance-auditor",
  "ml-engineer",
] as const;
export type JourneyPersona = (typeof JOURNEY_PERSONAS)[number];

/** The fixed capability vocabulary (the F270B deliverable list). */
export const JOURNEY_CAPABILITIES = [
  "investigate-findings",
  "understand-evidence",
  "guardian-decision",
  "action-plans",
  "execution-ledger",
  "reasoning-context",
  "predictive-advice",
  "counterfactual-reasoning",
  "decision-provenance",
  "learning-from-outcomes",
  "benchmark-trust",
  "agent-safety",
  "tenant-isolation",
] as const;
export type JourneyCapability = (typeof JOURNEY_CAPABILITIES)[number];

/** The lane packages a journey step is allowed to declare. */
export const JOURNEY_ALLOWED_PACKAGES = [
  "@fleetos/security",
  "@fleetos/policy",
  "@fleetos/actions",
  "@fleetos/execution",
  "@fleetos/evidence",
  "@fleetos/predictive",
  "@fleetos/world-model",
  "@fleetos/world-context",
  "@fleetos/learning",
  "@fleetos/arena",
  "@fleetos/simulation",
  "@fleetos/experience-safety-intel",
] as const;

/** Typed step kinds — the closed vocabulary of domain operations. */
export type JourneyStepKind =
  | "intake"
  | "evidence"
  | "guardian-decision"
  | "plan"
  | "queue"
  | "ledger"
  | "context-assembly"
  | "projection"
  | "counterfactual"
  | "provenance-inspect"
  | "evaluation"
  | "lifecycle"
  | "benchmark"
  | "grant-chain"
  | "view-read"
  | "negative-check";

// ---------------------------------------------------------------------------
// Facts — plain JSON values recorded under stable paths
// ---------------------------------------------------------------------------

/** JSON-safe fact object — interface form breaks the type-alias circularity. */
export interface JourneyFactObject {
  readonly [key: string]: JourneyFactValue;
}

export type JourneyFactValue =
  | string
  | number
  | boolean
  | null
  | readonly JourneyFactValue[]
  | JourneyFactObject;

/** Where a step records what the REAL packages actually produced. */
export interface JourneyRecorder {
  /** Record a fact under a stable dotted path (flat map — exact match only). */
  record(path: string, value: JourneyFactValue): void;
}

export type JourneyFactMap = Readonly<Record<string, JourneyFactValue>>;

// ---------------------------------------------------------------------------
// Steps + assertions — data, evaluated by the runner
// ---------------------------------------------------------------------------

export interface JourneyStep {
  readonly stepId: string;
  readonly kind: JourneyStepKind;
  readonly description: string;
  /** Lane packages this step drives (validated against JOURNEY_ALLOWED_PACKAGES). */
  readonly packages: readonly string[];
  /** The REAL public operations this step drives (e.g. "runFindingIntake"). */
  readonly operations: readonly string[];
  /** Drives the REAL packages and records facts. A thrown error fails the step. */
  readonly run: (ctx: JourneyRecorder) => void;
}

export interface JourneyAssertion {
  readonly assertionId: string;
  readonly description: string;
  /** The recorded fact path this assertion examines. */
  readonly path: string;
  /** The expected value (deep-compared canonically against the actual). */
  readonly expected: JourneyFactValue;
}

export interface AcceptanceJourney {
  readonly journeyId: string;
  readonly persona: JourneyPersona;
  readonly capabilities: readonly JourneyCapability[];
  readonly goal: string;
  readonly steps: readonly JourneyStep[];
  readonly assertions: readonly JourneyAssertion[];
}

// ---------------------------------------------------------------------------
// Outcomes — per-step + per-assertion, actual vs expected
// ---------------------------------------------------------------------------

export interface JourneyStepResult {
  readonly stepId: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface JourneyAssertionResult {
  readonly assertionId: string;
  readonly path: string;
  readonly expected: JourneyFactValue;
  readonly actual: JourneyFactValue | null;
  readonly pass: boolean;
  readonly reason: string;
}

export interface JourneyOutcome {
  readonly journeyId: string;
  readonly persona: JourneyPersona;
  readonly capabilities: readonly JourneyCapability[];
  readonly goal: string;
  readonly pass: boolean;
  readonly steps: readonly JourneyStepResult[];
  readonly assertions: readonly JourneyAssertionResult[];
  readonly passedStepCount: number;
  readonly failedAssertionCount: number;
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Deterministic digests (FNV-1a, the lane's presentation convention)
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit — deterministic, no deps, no wall-clock. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Canonical JSON: object keys sorted recursively — value order never matters. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value) ?? "null";
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

/** Deep equality via canonical serialization — JSON-safe values only. */
export function canonicalEquals(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** The digest over a journey outcome's semantic content (excludes the digest itself). */
export function journeyOutcomeDigest(outcome: Omit<JourneyOutcome, "digest">): string {
  const payload = {
    journeyId: outcome.journeyId,
    persona: outcome.persona,
    capabilities: [...outcome.capabilities],
    goal: outcome.goal,
    pass: outcome.pass,
    steps: outcome.steps.map((s) => `${s.stepId}:${s.ok ? 1 : 0}:${s.detail}`),
    assertions: outcome.assertions.map((a) => ({
      assertionId: a.assertionId,
      path: a.path,
      expected: a.expected,
      actual: a.actual,
      pass: a.pass,
      reason: a.reason,
    })),
  };
  return fnv1a(`journey|v1|${canonicalJson(payload)}`);
}

/** Verify a journey outcome — recomputes the digest over the presented content. */
export function verifyJourneyOutcome(outcome: JourneyOutcome): boolean {
  const { digest, ...rest } = outcome;
  return journeyOutcomeDigest(rest) === digest;
}

// ---------------------------------------------------------------------------
// Journey report — the double-digest presentation form
// ---------------------------------------------------------------------------

/** A journey outcome in its report form (double-digest covered). */
export interface JourneyReport extends JourneyOutcome {
  /** Digest over the WHOLE outcome (including its inner digest). */
  readonly reportDigest: string;
}

/** Turn a journey outcome into its report form (double-digest covered). */
export function toJourneyReport(outcome: JourneyOutcome): JourneyReport {
  return { ...outcome, reportDigest: fnv1a(`journey-report|v1|${canonicalJson(outcome)}`) };
}

/**
 * Verify a journey report — BOTH digests must hold: the outer report digest
 * covers the presented content verbatim (including the inner digest), and
 * the inner digest covers the semantic content. Tampering with any
 * presented field breaks at least one of them.
 */
export function verifyJourneyReport(report: JourneyReport): boolean {
  const { reportDigest, ...outcome } = report;
  return (
    fnv1a(`journey-report|v1|${canonicalJson(outcome)}`) === reportDigest &&
    verifyJourneyOutcome(outcome)
  );
}
