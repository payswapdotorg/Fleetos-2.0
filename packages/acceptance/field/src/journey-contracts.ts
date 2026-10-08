/**
 * @fleetos/acceptance-field — the journey contracts.
 *
 * A journey is DATA: a fixed persona + goal, a list of TYPED domain
 * operations (executed by the deterministic runner against the REAL public
 * APIs of this lane's packages), and declarative READ-MODEL ASSERTIONS —
 * expected values checked against readings the runner records from REAL
 * outputs. No journey code executes anything itself; no assertion can hide
 * a failure because the comparison is the runner's, never the journey's.
 *
 * Pure deterministic TS; logical `now` everywhere.
 */

import type { AssetKind } from "@fleetos/assets";
import type { RecoveryCommandKind } from "@fleetos/recovery";
import type { Schedule } from "@fleetos/maintenance";
import type { AdcosCommandKind, AdcosRejectionCode } from "@fleetos/adcos";
import type { FieldSectionLimits } from "@fleetos/experience-asset-field";
import { deepEquals, digestOf } from "./determinism.js";

// ---------------------------------------------------------------------------
// Fixed vocabulary — personas (7) + capabilities.
// ---------------------------------------------------------------------------

export const PERSONAS = [
  "field-technician",
  "fleet-operator",
  "maintenance-planner",
  "recovery-coordinator",
  "sim-engineer",
  "edge-operator",
  "site-manager",
] as const;
export type Persona = (typeof PERSONAS)[number];

export const CAPABILITIES = [
  "enrollment",
  "trustworthy-state",
  "investigation",
  "recovery",
  "maintenance",
  "field-mode",
  "connectivity",
  "edge-command",
  "simulation",
  "mission-replay",
  "handoff",
  "mobile",
  "tenant-isolation",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// ---------------------------------------------------------------------------
// Typed domain operations (data only — the runner executes them).
// ---------------------------------------------------------------------------

export type ObservationPayload = Readonly<Record<string, string | number | boolean | null>>;

export type JourneyOperation =
  // assets / identity / enrollment
  | { readonly kind: "asset.admit"; readonly assetId: string; readonly assetKind: AssetKind; readonly displayName: string }
  | { readonly kind: "asset.activate"; readonly assetId: string }
  | { readonly kind: "device.enroll"; readonly deviceId: string; readonly assetId: string; readonly serial: string }
  | { readonly kind: "enrollment.check"; readonly deviceId: string; readonly tenantId?: string }
  | { readonly kind: "twin.admit"; readonly deviceId: string; readonly seq: number; readonly observedAt: number; readonly attributes: ObservationPayload }
  // observations / health
  | {
      readonly kind: "observation.ingest";
      readonly deviceId: string;
      readonly seq: number;
      readonly observedAt: number;
      readonly observationKind: string;
      readonly payload: ObservationPayload;
    }
  | {
      readonly kind: "observation.ingest-batch";
      readonly deviceId: string;
      readonly fromSeq: number;
      readonly count: number;
      readonly observationKind: string;
      readonly firstObservedAt: number;
      readonly stepMs: number;
    }
  | { readonly kind: "health.triage" }
  // recovery
  | { readonly kind: "recovery.open"; readonly caseId: string; readonly deviceId: string }
  | { readonly kind: "recovery.command"; readonly caseId: string; readonly command: RecoveryCommandKind; readonly reason?: string; readonly withEvidence?: boolean }
  // maintenance
  | {
      readonly kind: "maintenance.plan";
      readonly planId: string;
      readonly assetId: string;
      readonly planKind: "preventive" | "corrective" | "predictive";
      readonly schedule: Schedule;
    }
  | { readonly kind: "maintenance.order"; readonly orderId: string; readonly planId: string; readonly assignedTo?: string }
  | { readonly kind: "maintenance.command"; readonly orderId: string; readonly command: "start" | "complete" | "cancel"; readonly reason?: string }
  // connectivity
  | { readonly kind: "connectivity.record"; readonly deviceId: string; readonly state: "online" | "offline"; readonly observedAt: number }
  | { readonly kind: "connectivity.propose-intent"; readonly deviceId: string; readonly desiredState: "online" | "offline"; readonly idempotencyKey: string }
  | {
      readonly kind: "connectivity.transition-intent";
      readonly idempotencyKey: string;
      readonly eventKind: "authorize" | "activate" | "suspend" | "resume" | "terminate" | "withdraw";
      readonly reason?: string;
      readonly grant?: { readonly grantedBy: string; readonly authorizationDigest: string; readonly grantedAt: number; readonly expiresAt: number } | null;
      readonly ceiling?: { readonly effect: "allow" | "deny"; readonly reason: string } | null;
    }
  | { readonly kind: "connectivity.rollup-posture" }
  // ADCOS edge commands
  | { readonly kind: "adcos.issue"; readonly deviceId: string; readonly commandKind: AdcosCommandKind; readonly idempotencyKey: string; readonly expiresAt?: number }
  | { readonly kind: "adcos.dispatch"; readonly idempotencyKey: string }
  | { readonly kind: "adcos.dispatch-failure"; readonly idempotencyKey: string; readonly code: AdcosRejectionCode }
  | { readonly kind: "adcos.ack"; readonly idempotencyKey: string; readonly requestId: string }
  | { readonly kind: "adcos.result"; readonly idempotencyKey: string; readonly ok: boolean }
  | { readonly kind: "adcos.reconcile"; readonly idempotencyKey: string }
  | { readonly kind: "adcos.expire"; readonly now: number }
  | { readonly kind: "adcos.health-rollup"; readonly now: number }
  // simulation worlds
  | { readonly kind: "sim.run-world"; readonly runId: string; readonly worldId: string; readonly steps: number; readonly scenarioId?: string }
  | { readonly kind: "sim.adapter-run"; readonly runId: string; readonly worldId: string; readonly scenarioId: string; readonly steps: number }
  | { readonly kind: "sim.ingest-emissions"; readonly runId: string; readonly deviceId?: string }
  // experience command intents
  | { readonly kind: "intent.enroll-asset"; readonly assetId: string; readonly deviceId: string; readonly serial?: string; readonly displayName?: string }
  | { readonly kind: "intent.recovery-request"; readonly deviceId: string }
  | { readonly kind: "intent.maintenance-schedule"; readonly assetId: string; readonly planId: string; readonly schedule: Schedule }
  | { readonly kind: "intent.validate" }
  // experience views
  | { readonly kind: "view.fleet-overview"; readonly now: number }
  | { readonly kind: "view.asset-detail"; readonly assetId: string; readonly now: number }
  | { readonly kind: "view.field-mode"; readonly now: number; readonly limits?: FieldSectionLimits }
  | { readonly kind: "view.health-board"; readonly now: number }
  | { readonly kind: "view.recovery-timeline"; readonly now: number }
  | { readonly kind: "view.maintenance-board"; readonly now: number }
  // handoff / mission replay / tenant isolation
  | { readonly kind: "handoff.publish"; readonly handoffId: string; readonly fromRole: "field-technician" | "fleet-operator"; readonly toRole: "field-technician" | "fleet-operator" }
  | { readonly kind: "handoff.consume"; readonly handoffId: string }
  | {
      readonly kind: "mission.run-stages";
      readonly missionId: string;
      readonly definitionId: string;
      readonly deviceId: string;
      readonly stageCount: number;
      readonly batchPerStage: number;
      readonly observationKind: string;
      readonly firstObservedAt: number;
      readonly stepMs: number;
      readonly suspendAfterStage: number;
    }
  | { readonly kind: "mission.resume"; readonly missionId: string }
  | { readonly kind: "mission.fold"; readonly missionId: string }
  | { readonly kind: "slice.taint-foreign-asset"; readonly assetId: string; readonly tenantId: string }
  | { readonly kind: "tenancy.probe"; readonly deviceId: string; readonly idempotencyKey: string; readonly foreignTenantId: string };

export interface JourneyStep {
  readonly id: string;
  readonly op: JourneyOperation;
  /** Human-facing description of what the persona is doing at this step. */
  readonly summary: string;
  /** True when this step deliberately probes a REAL refusal path: the step
   * PASSES only when the REAL API refuses (fail-closed verification), and
   * FAILS if the API unexpectedly succeeds. The refusal's reason code is
   * still recorded as a reading the assertions pin. */
  readonly expectRefusal?: boolean;
}

// ---------------------------------------------------------------------------
// Declarative read-model assertions (data; the runner evaluates them).
// ---------------------------------------------------------------------------

export type AssertionOperator =
  | "deep-equals"
  | "not-deep-equals"
  | "reading-equals"
  | "number-gte"
  | "number-lte"
  | "includes"
  | "length-eq"
  | "is-null"
  | "not-null";

export interface JourneyAssertion {
  readonly id: string;
  readonly description: string;
  /** The reading key the runner recorded from a REAL output (`stepId.name`). */
  readonly reading: string;
  readonly op: AssertionOperator;
  readonly expected?: unknown;
}

export interface AssertionOutcome {
  readonly id: string;
  readonly description: string;
  readonly reading: string;
  readonly op: AssertionOperator;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly pass: boolean;
}

// ---------------------------------------------------------------------------
// The journey (pure data).
// ---------------------------------------------------------------------------

export interface AcceptanceJourney {
  readonly id: string;
  readonly persona: Persona;
  readonly capability: Capability;
  readonly goal: string;
  readonly steps: readonly JourneyStep[];
  readonly assertions: readonly JourneyAssertion[];
  /** True when this journey consumes the previous journey's handoff carrier
   * (the runner threads the publishing context forward — the chain). */
  readonly consumesHandoff?: boolean;
}

// ---------------------------------------------------------------------------
// Outcomes — pass/fail per step + per assertion, with actual vs expected.
// ---------------------------------------------------------------------------

export interface StepOutcome {
  readonly id: string;
  readonly kind: JourneyOperation["kind"];
  readonly summary: string;
  readonly ok: boolean;
  /** Failure note for refused operations (the REAL package's reason code). */
  readonly note: string | null;
}

export interface JourneyOutcome {
  readonly journeyId: string;
  readonly persona: Persona;
  readonly capability: Capability;
  readonly goal: string;
  readonly steps: readonly StepOutcome[];
  readonly assertions: readonly AssertionOutcome[];
  /** ALL steps ok AND ALL assertions pass — a failing assertion fails the
   * journey; there are no soft passes. */
  readonly passed: boolean;
  readonly handoff: { readonly handoffId: string; readonly digest: string } | null;
  readonly digest: string;
}

export type JourneyReport = JourneyOutcome & { readonly reportDigest: string };

function outcomeDigestOf(outcome: Omit<JourneyOutcome, "digest">): string {
  return digestOf("journey-outcome", outcome as unknown as object);
}

/** Digest the runner stamps on every outcome (tamper-evident). */
export function journeyOutcomeDigest(outcome: Omit<JourneyOutcome, "digest">): string {
  return outcomeDigestOf(outcome);
}

/** Recompute an outcome's digest; false means tampered content. */
export function verifyJourneyOutcome(outcome: JourneyOutcome): boolean {
  const { digest, ...rest } = outcome;
  return outcomeDigestOf(rest) === digest;
}

/** Turn a journey outcome into its report form (double-digest covered). */
export function toJourneyReport(outcome: JourneyOutcome): JourneyReport {
  return { ...outcome, reportDigest: digestOf("journey-report", outcome as unknown as object) };
}

// ---------------------------------------------------------------------------
// Assertion evaluation — pure, on recorded readings.
// ---------------------------------------------------------------------------

const MISSING = "<missing-reading>";

export function evaluateAssertion(
  assertion: JourneyAssertion,
  readings: ReadonlyMap<string, unknown>,
): AssertionOutcome {
  const actual = readings.has(assertion.reading) ? readings.get(assertion.reading) : MISSING;
  let pass = false;
  switch (assertion.op) {
    case "deep-equals":
      pass = actual !== MISSING && deepEquals(actual, assertion.expected);
      break;
    case "reading-equals": {
      // `expected` names ANOTHER reading key; both must exist and match.
      const other = assertion.expected;
      const otherValue = typeof other === "string" && readings.has(other) ? readings.get(other) : MISSING;
      pass = actual !== MISSING && otherValue !== MISSING && deepEquals(actual, otherValue);
      break;
    }
    case "not-deep-equals":
      pass = actual !== MISSING && !deepEquals(actual, assertion.expected);
      break;
    case "number-gte":
      pass = typeof actual === "number" && typeof assertion.expected === "number" && actual >= assertion.expected;
      break;
    case "number-lte":
      pass = typeof actual === "number" && typeof assertion.expected === "number" && actual <= assertion.expected;
      break;
    case "includes":
      pass = Array.isArray(actual) && actual.some((v) => deepEquals(v, assertion.expected));
      break;
    case "length-eq":
      pass = Array.isArray(actual) && actual.length === assertion.expected;
      break;
    case "is-null":
      pass = actual === null;
      break;
    case "not-null":
      pass = actual !== null && actual !== MISSING;
      break;
  }
  return {
    id: assertion.id,
    description: assertion.description,
    reading: assertion.reading,
    op: assertion.op,
    expected: assertion.expected ?? null,
    actual: actual === MISSING ? MISSING : (actual ?? null),
    pass,
  };
}
