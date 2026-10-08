/**
 * @fleetos/acceptance-commerce — the journey contract (Wave 7 lane C).
 *
 * Same shape/vocabulary as the F270A/F270B acceptance lanes: a journey is
 * DATA + assertions, never imperative glue that can hide failures.
 *   - `AcceptanceJourney`: id, persona (fixed 7-persona vocabulary),
 *     goal, capability, typed domain-operation steps, read-model
 *     assertions (declared, with expected values).
 *   - `JourneyOutcome`: pass/fail per step + per assertion with the
 *     ACTUAL vs EXPECTED values; a failing assertion fails the journey
 *     (no soft passes).
 *   - `JourneyReport`: digest + verify; deterministic (byte-identical
 *     re-runs).
 *
 * Pure deterministic TS: no clock, no randomness, no network, no timers.
 * Every timestamp/money value is caller-supplied journey data. FNV-1a
 * digests (the lane convention, evidence-grade).
 */

// ---------------------------------------------------------------------------
// Fixed vocabularies.
// ---------------------------------------------------------------------------

/** The fixed 7-persona vocabulary for the work/commerce/project lane. */
export const JOURNEY_PERSONAS: readonly string[] = [
  "operations-manager",
  "procurement-lead",
  "project-manager",
  "vendor-manager",
  "software-admin",
  "org-optimizer",
  "finance-controller",
] as const;

export type JourneyPersona = (typeof JOURNEY_PERSONAS)[number];

/** The capability vocabulary the corpus may claim coverage for. */
export const JOURNEY_CAPABILITIES: readonly string[] = [
  "create-work",
  "approve-execute-work",
  "stage-gated-projects",
  "workload-allocation",
  "procurement-spine",
  "quote-scoring",
  "order-reconciliation",
  "vendor-management",
  "software-entitlements",
  "external-catalog-sync",
  "actor-jobs",
  "optimization-review",
  "cross-role-handoff",
  "tenant-isolation",
  "settlement-adapter",
] as const;

export type JourneyCapability = (typeof JOURNEY_CAPABILITIES)[number];

// ---------------------------------------------------------------------------
// Facts + assertions.
// ---------------------------------------------------------------------------

/** A serializable observed fact extracted from a REAL package output. */
export type FactValue = string | number | boolean | null | readonly string[];

/**
 * An assertion compares an observed fact against the expected value with a
 * fixed operator vocabulary. The runner records BOTH values on the
 * outcome; a missing fact fails the assertion regardless of operator
 * (missing evidence is never a pass).
 */
export type AssertionOperator =
  | "eq"
  | "deepEq"
  | "gt"
  | "gte"
  | "lt"
  | "includes"
  | "uniform";

export interface JourneyAssertion {
  readonly id: string;
  readonly description: string;
  /** The fact key produced by a step driver (stable, namespaced). */
  readonly fact: string;
  readonly op: AssertionOperator;
  readonly expected: FactValue;
}

export interface AssertionOutcome {
  readonly assertionId: string;
  readonly description: string;
  readonly ok: boolean;
  readonly op: AssertionOperator;
  readonly actual: FactValue | typeof MISSING_FACT;
  readonly expected: FactValue;
}

/** Sentinel recorded when the referenced fact was never produced. */
export const MISSING_FACT = "__missing-fact__" as const;

// ---------------------------------------------------------------------------
// Steps — typed domain operations (pure data; the runner interprets them
// against the REAL packages through the step drivers).
// ---------------------------------------------------------------------------

export interface JourneyStepBase {
  readonly stepId: string;
}

export type WorkStep =
  | (JourneyStepBase & { readonly kind: "work-create"; readonly itemId: string; readonly title: string; readonly projectId: string | null; readonly deadline: string | null })
  | (JourneyStepBase & { readonly kind: "work-assign"; readonly itemId: string; readonly assignmentId: string; readonly assigneeId: string })
  | (JourneyStepBase & { readonly kind: "work-transition"; readonly itemId: string; readonly command: "start" | "block" | "unblock" | "complete" | "cancel"; readonly reason?: string })
  | (JourneyStepBase & { readonly kind: "work-board"; readonly computedAt: string; readonly redactAssignees?: boolean })
  | (JourneyStepBase & { readonly kind: "project-create"; readonly projectId: string; readonly name: string })
  | (JourneyStepBase & { readonly kind: "stage-create"; readonly stageId: string; readonly name: string; readonly checkpoints: readonly { id: string; mandatory: boolean }[] })
  | (JourneyStepBase & { readonly kind: "stage-checkpoint"; readonly stageId: string; readonly checkpointId: string })
  | (JourneyStepBase & { readonly kind: "stage-transition"; readonly stageId: string; readonly command: "start" | "close" })
  | (JourneyStepBase & { readonly kind: "stage-gate-view"; readonly computedAt: string })
  | (JourneyStepBase & { readonly kind: "milestone-create"; readonly milestoneId: string; readonly name: string; readonly workItemIds: readonly string[] })
  | (JourneyStepBase & { readonly kind: "milestone-gate" })
  | (JourneyStepBase & { readonly kind: "ledger-post"; readonly entryKind: "actual" | "commitment" | "credit"; readonly amountMinorUnits: number; readonly note: string | null })
  | (JourneyStepBase & { readonly kind: "budget-position" })
  | (JourneyStepBase & { readonly kind: "workload-apply"; readonly demandKey: string; readonly units: number; readonly owner: string })
  | (JourneyStepBase & { readonly kind: "workload-lifecycle"; readonly recordId: string; readonly command: "commit" | "activate" | "release" | "retire"; readonly reason?: string })
  | (JourneyStepBase & { readonly kind: "workload-window-check"; readonly windows: readonly { id: string; start: number; end: number }[] })
  | (JourneyStepBase & { readonly kind: "workload-rollup-view"; readonly computedAt: string });

export type CommerceStep =
  | (JourneyStepBase & { readonly kind: "demand-flow"; readonly command: "solicit" | "award" | "close" | "cancel"; readonly authorized: boolean; readonly evidenceId: string; readonly evidenceTenantId: string; readonly reason?: string })
  | (JourneyStepBase & { readonly kind: "quote-create"; readonly quoteId: string; readonly vendorId: string; readonly unitCost: number; readonly totalCost: number; readonly tenantId?: string })
  | (JourneyStepBase & { readonly kind: "quote-transition"; readonly quoteId: string; readonly command: "submit" | "accept" | "reject" | "expire" | "withdraw" })
  | (JourneyStepBase & { readonly kind: "quote-supersede"; readonly previousQuoteId: string; readonly newQuoteId: string; readonly unitCost: number; readonly totalCost: number })
  | (JourneyStepBase & { readonly kind: "quote-score-view"; readonly computedAt: string; readonly quotes: readonly { quoteId: string; vendorId: string; unitCostMinor: number; totalCostMinor: number; leadTimeDays: number; capabilityTags: readonly string[]; submittedAtEpoch: number }[] })
  | (JourneyStepBase & { readonly kind: "award-quote"; readonly quoteId: string; readonly authorized: boolean; readonly evidenceId: string; readonly evidenceTenantId?: string })
  | (JourneyStepBase & { readonly kind: "order-transition"; readonly command: "confirm" | "ship" | "receive" | "cancel" })
  | (JourneyStepBase & { readonly kind: "fulfillment-transition"; readonly command: "start_transit" | "deliver" | "verify" | "fail"; readonly evidenceId?: string; readonly evidenceTenantId?: string })
  | (JourneyStepBase & { readonly kind: "spine-board"; readonly computedAt: string })
  | (JourneyStepBase & { readonly kind: "reconcile"; readonly orderedQuantity: number; readonly receipts: readonly number[] })
  | (JourneyStepBase & { readonly kind: "vendor-lifecycle"; readonly command: "activate" | "suspend" | "reinstate" | "terminate"; readonly reason?: string })
  | (JourneyStepBase & { readonly kind: "vendor-verify-capability"; readonly tag: string; readonly evidenceId: string | null })
  | (JourneyStepBase & { readonly kind: "vendor-exposure"; readonly op: "commit" | "release"; readonly amountMinorUnits: number })
  | (JourneyStepBase & { readonly kind: "vendor-kpi-view"; readonly computedAt: string })
  | (JourneyStepBase & { readonly kind: "entitlement-check"; readonly requestedSeats: number })
  | (JourneyStepBase & { readonly kind: "grant-assign"; readonly grantId: string; readonly seats: number; readonly assigneeId: string })
  | (JourneyStepBase & { readonly kind: "grant-revoke"; readonly grantId: string; readonly reason: string })
  | (JourneyStepBase & { readonly kind: "seat-view"; readonly now: string; readonly computedAt: string })
  | (JourneyStepBase & { readonly kind: "catalog-import"; readonly entries: readonly { externalId: string; vendorExternalId: string; displayName: string; capabilities: readonly string[]; logicalTime: number }[] })
  | (JourneyStepBase & { readonly kind: "catalog-verify"; readonly externalId: string; readonly capability: string; readonly evidenceId: string | null })
  | (JourneyStepBase & { readonly kind: "catalog-metrics"; readonly drafts: readonly { metricId: string; vendorExternalId: string; metric: string; window: string; valueBps: number; weightBps: number; dependsOnCapability: string | null }[] })
  | (JourneyStepBase & { readonly kind: "catalog-scorecards"; readonly currentWindow: string; readonly previousWindow: string })
  | (JourneyStepBase & { readonly kind: "catalog-revoke"; readonly externalId: string; readonly capability: string; readonly reason: string })
  | (JourneyStepBase & { readonly kind: "apify-job-create"; readonly jobId: string; readonly actorId: string; readonly window: string })
  | (JourneyStepBase & { readonly kind: "apify-job-authorize"; readonly decisionId: string; readonly authorized: boolean; readonly reasonCode: string })
  | (JourneyStepBase & { readonly kind: "apify-job-schedule"; readonly units: number })
  | (JourneyStepBase & { readonly kind: "apify-job-transition"; readonly command: "start" | "complete" | "fail" | "expire" })
  | (JourneyStepBase & { readonly kind: "apify-ingest-result"; readonly resultId: string; readonly payload: "structured" | "empty" | "malformed" })
  | (JourneyStepBase & { readonly kind: "apify-attach-evidence"; readonly bundleId: string; readonly digest: string; readonly digestShapeValid: boolean });

export type OrgStep =
  | (JourneyStepBase & { readonly kind: "usage-append"; readonly requestRef: string; readonly agentId: string; readonly modelId: string; readonly providerId: string; readonly capability: string; readonly units: number; readonly costMinor: number })
  | (JourneyStepBase & { readonly kind: "usage-rollup-view"; readonly computedAt: string })
  | (JourneyStepBase & { readonly kind: "org-journal-append"; readonly events: readonly { kind: string; agentId?: string; teamId?: string; roleId?: string; capability?: string; units?: number; spendMinor?: number }[] })
  | (JourneyStepBase & { readonly kind: "org-prepare-optimization" })
  | (JourneyStepBase & { readonly kind: "org-allocate-roles" })
  | (JourneyStepBase & { readonly kind: "org-what-if" })
  | (JourneyStepBase & { readonly kind: "org-budget-board"; readonly computedAt: string });

export type AurumStep =
  | (JourneyStepBase & { readonly kind: "aurum-invoke"; readonly intent: string; readonly idempotencyKey: string; readonly foreignTenant?: boolean })
  | (JourneyStepBase & { readonly kind: "aurum-outage-invoke"; readonly intent: string; readonly idempotencyKey: string })
  | (JourneyStepBase & { readonly kind: "aurum-boundary"; readonly projectionKind: string });

export type JourneyStep = WorkStep | CommerceStep | OrgStep | AurumStep;

// ---------------------------------------------------------------------------
// The journey.
// ---------------------------------------------------------------------------

export interface AcceptanceJourney {
  readonly id: string;
  readonly persona: JourneyPersona;
  readonly capability: JourneyCapability;
  readonly goal: string;
  readonly steps: readonly JourneyStep[];
  readonly assertions: readonly JourneyAssertion[];
}

// ---------------------------------------------------------------------------
// Outcomes.
// ---------------------------------------------------------------------------

export interface StepOutcome {
  readonly stepId: string;
  readonly kind: string;
  /** True when the driver executed the step (a domain refusal is still an executed step — see facts). */
  readonly executed: boolean;
  readonly ok: boolean;
}

export interface JourneyOutcome {
  readonly journeyId: string;
  readonly persona: JourneyPersona;
  readonly capability: JourneyCapability;
  readonly goal: string;
  readonly stepOutcomes: readonly StepOutcome[];
  readonly assertionOutcomes: readonly AssertionOutcome[];
  readonly passed: boolean;
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Digests — FNV-1a over canonical JSON (lane convention).
// ---------------------------------------------------------------------------

export function fnv1a32(parts: readonly unknown[]): string {
  const joined = parts.map((p) => (typeof p === "string" ? p : canonicalJson(p))).join("\u241f");
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Deterministic key-sorted JSON serialization (input key order irrelevant). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
}

/** Journey-outcome digest — byte-identical for byte-identical runs. */
export function computeJourneyDigest(outcome: Omit<JourneyOutcome, "digest">): string {
  return `journey_${fnv1a32([
    outcome.journeyId,
    outcome.passed,
    outcome.stepOutcomes.map((s) => `${s.stepId}:${s.kind}:${s.executed}:${s.ok}`),
    outcome.assertionOutcomes.map(
      (a) =>
        `${a.assertionId}:${a.ok}:${a.op}:${typeof a.actual === "string" ? a.actual : canonicalJson(a.actual)}:${canonicalJson(a.expected)}`,
    ),
  ])}`;
}
