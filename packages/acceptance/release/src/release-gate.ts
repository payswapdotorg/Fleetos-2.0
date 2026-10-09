/**
 * @fleetos/acceptance-release — the production release gate.
 *
 * Wave 8 TL lane (F281). A deterministic, BOOLEAN verdict over the
 * assembled observability + cost + acceptance signals:
 *
 *   READY      — every lane reports healthy, every acceptance baseline
 *                count is present and green, and no budget ceiling is
 *                breached.
 *   NOT-READY  — otherwise, with the exact blocking reasons; every blocker
 *                NAMES ITS SOURCE RECORD (the view/record path) and carries
 *                the REAL reason code or numbers verbatim.
 *
 * NO weighted scores, NO partial readiness — blockers.length === 0 is the
 * ONLY path to READY (a boolean gate with named blockers).
 *
 * Inputs (all REAL, all caller-assembled):
 *   - `status`  — the observability rollup result (`assembleSystemStatus`),
 *     itself assembled from REAL hardened-surface outputs (F280A/B/C).
 *   - `cost`    — the cost posture result (`buildCostPosture`), itself over
 *     REAL burn projections + enforcement checks (F280C).
 *   - `acceptance` — the REAL acceptance baseline REPORTS of the four
 *     corpora: field (`@fleetos/acceptance-field`), security
 *     (`@fleetos/acceptance-security`), commerce
 *     (`@fleetos/acceptance-commerce`) and adoption
 *     (`@fleetos/acceptance-adoption` — the F271 deployment-acceptance
 *     layer). The EXPECTED baseline counts are the REAL corpus lengths the
 *     packages themselves export (FIELD_JOURNEYS / SECURITY_JOURNEYS /
 *     JOURNEYS / WORKSPACE_POPULATION) — never a hardcoded guess.
 *
 * Tamper detection: the gate re-verifies the digest of every presented view
 * (system status, cost posture) and every REAL acceptance report (each
 * corpus's own REAL verify function). A tampered record FAILS LOUDLY — an
 * ACCEPTANCE_TAMPERED / STATUS_TAMPERED / COST_TAMPERED blocker naming the
 * record.
 *
 * Corpus reports are corpus-level baselines (the acceptance corpora run
 * under their own fixed deterministic worlds — not tenant-parameterized);
 * the gate's tenant scope applies to the status + cost views: a view
 * assembled under a tenant other than the gate's refuses with
 * STATUS_TENANT_MISMATCH / COST_TENANT_MISMATCH (fail-closed — the lanes
 * and budgets of a foreign view are never evaluated).
 *
 * Evaluation order (deterministic, documented): tenant → status → cost →
 * acceptance (field, security, commerce, adoption); within each corpus:
 * missing → tampered → count → failed. Warnings do NOT breach (the cost
 * health law, src/cost.ts).
 *
 * Pure deterministic TS: no clock, no randomness, no network, no timers.
 */

import {
  verifyAcceptanceReport as verifyFieldReport,
  type AcceptanceReport as FieldAcceptanceReport,
} from "@fleetos/acceptance-field";
import { FIELD_JOURNEYS } from "@fleetos/acceptance-field/journeys";
import {
  SECURITY_JOURNEYS,
  verifyAcceptanceReport as verifySecurityReport,
  type AcceptanceReport as SecurityAcceptanceReport,
} from "@fleetos/acceptance-security";
import {
  verifyJourneyReport,
  type JourneyReport as CommerceJourneyReport,
} from "@fleetos/acceptance-commerce";
import { JOURNEYS as COMMERCE_JOURNEYS } from "@fleetos/acceptance-commerce/journeys";
import {
  WORKSPACE_POPULATION,
  verifyAdoptionReport,
  type AdoptionReport,
} from "@fleetos/acceptance-adoption";
import { LANE_IDS, verifySystemStatus, type LaneId, type SystemStatusResult } from "./observability.js";
import { verifyCostPosture, type CostPostureResult } from "./cost.js";
import { digestOf } from "./digest.js";

export const RELEASE_GATE_SCHEMA_VERSION = 1;

export type ReleaseVerdict = "READY" | "NOT-READY";

export type ReleaseBlockerCode =
  | "TENANT_ID_EMPTY"
  | "STATUS_REFUSED"
  | "STATUS_TENANT_MISMATCH"
  | "STATUS_TAMPERED"
  | "LANE_MISSING"
  | "LANE_DEGRADED"
  | "COST_REFUSED"
  | "COST_TENANT_MISMATCH"
  | "COST_TAMPERED"
  | "CEILING_BREACHED"
  | "ACCEPTANCE_MISSING"
  | "ACCEPTANCE_TAMPERED"
  | "ACCEPTANCE_COUNT_MISMATCH"
  | "ACCEPTANCE_FAILED";

export interface ReleaseBlocker {
  readonly code: ReleaseBlockerCode;
  /** Names the source record this blocker came from. */
  readonly source: string;
  /** The REAL reason code / numbers, verbatim from the source record. */
  readonly detail: string;
}

export interface AcceptanceBaselines {
  /** REAL report: `assembleAcceptanceReport(FIELD_JOURNEYS, …)` (acceptance-field). */
  readonly field?: FieldAcceptanceReport;
  /** REAL report: `assembleAcceptanceReport(runAllJourneys(SECURITY_JOURNEYS))` (acceptance-security). */
  readonly security?: SecurityAcceptanceReport;
  /** REAL report: `assembleJourneyReport(runAllJourneys(JOURNEYS))` (acceptance-commerce). */
  readonly commerce?: CommerceJourneyReport;
  /** REAL report: `assembleAdoptionReport(runAdoptionSimulation())` (acceptance-adoption, F271). */
  readonly adoption?: AdoptionReport;
}

export interface ReleaseGateInput {
  readonly tenantId: string;
  /** The assembled observability result (refused results are blockers, not errors). */
  readonly status: SystemStatusResult;
  /** The assembled cost result (refused results are blockers, not errors). */
  readonly cost: CostPostureResult;
  readonly acceptance: AcceptanceBaselines;
  /** Lanes the gate requires (default: all five hardened lanes). */
  readonly requiredLanes?: readonly LaneId[];
}

export interface ReleaseGateVerdict {
  readonly schemaVersion: typeof RELEASE_GATE_SCHEMA_VERSION;
  readonly tenantId: string;
  readonly verdict: ReleaseVerdict;
  readonly blockers: readonly ReleaseBlocker[];
  readonly gateDigest: string;
}

function gateDigestOf(verdict: Omit<ReleaseGateVerdict, "gateDigest">): string {
  return digestOf("release-gate", verdict as unknown as object);
}

// ---------------------------------------------------------------------------
// Signal checks — each produces zero or more named blockers.
// ---------------------------------------------------------------------------

function statusBlockers(input: ReleaseGateInput): ReleaseBlocker[] {
  const blockers: ReleaseBlocker[] = [];
  if (!input.status.ok) {
    const lane = input.status.lane === null ? "" : ` lane=${input.status.lane}`;
    blockers.push({
      code: "STATUS_REFUSED",
      source: "observability.assembleSystemStatus",
      detail: `reasonCode=${input.status.reasonCode}${lane}: ${input.status.detail}`,
    });
    return blockers;
  }
  const status = input.status.status;
  if (status.tenantId !== input.tenantId) {
    // Tenant fail-closed: a status view assembled under a foreign tenant is
    // never evaluated lane-by-lane — its lanes belong to another scope.
    blockers.push({
      code: "STATUS_TENANT_MISMATCH",
      source: "system-status.tenantId",
      detail: `status view tenant ${status.tenantId} does not match gate tenant ${input.tenantId}`,
    });
    return blockers;
  }
  if (!verifySystemStatus(status)) {
    blockers.push({
      code: "STATUS_TAMPERED",
      source: "system-status.statusDigest",
      detail: "status digest mismatch — the presented system status was tampered",
    });
    return blockers;
  }
  const required = input.requiredLanes ?? LANE_IDS;
  const present = new Set(status.lanes.map((l) => l.laneId));
  for (const laneId of required) {
    if (!present.has(laneId)) {
      blockers.push({
        code: "LANE_MISSING",
        source: `system-status.lanes[${laneId}]`,
        detail: `required lane ${laneId} has no status record in the assembled view`,
      });
    }
  }
  for (const lane of status.lanes) {
    if (lane.health === "degraded") {
      blockers.push({
        code: "LANE_DEGRADED",
        source: `system-status.lanes[${lane.laneId}]`,
        detail: `lane ${lane.laneId} degraded: ${lane.reason}`,
      });
    }
  }
  return blockers;
}

function costBlockers(input: ReleaseGateInput): ReleaseBlocker[] {
  const blockers: ReleaseBlocker[] = [];
  if (!input.cost.ok) {
    const offender =
      input.cost.offenderIndex === null ? "" : ` offenderIndex=${input.cost.offenderIndex}`;
    blockers.push({
      code: "COST_REFUSED",
      source: "cost.buildCostPosture",
      detail: `reasonCode=${input.cost.reasonCode}${offender}`,
    });
    return blockers;
  }
  const posture = input.cost.posture;
  if (posture.tenantId !== input.tenantId) {
    // Tenant fail-closed: a cost posture assembled under a foreign tenant is
    // never evaluated check-by-check — its budgets belong to another scope.
    blockers.push({
      code: "COST_TENANT_MISMATCH",
      source: "cost-posture.tenantId",
      detail: `cost posture tenant ${posture.tenantId} does not match gate tenant ${input.tenantId}`,
    });
    return blockers;
  }
  if (!verifyCostPosture(posture)) {
    blockers.push({
      code: "COST_TAMPERED",
      source: "cost-posture.costDigest",
      detail: "cost digest mismatch — the presented cost posture was tampered",
    });
    return blockers;
  }
  for (let i = 0; i < posture.checks.length; i += 1) {
    const check = posture.checks[i]!;
    if (check.status === "over-ceiling") {
      blockers.push({
        code: "CEILING_BREACHED",
        source: `cost-posture.checks[${i}] (${check.ceiling.source})`,
        detail: `actual=${check.actualCostMinor} over ceiling=${check.ceiling.ceilingMinor} by ${check.overByMinor} (usage-ledger entry seqs: ${check.actualEntrySeqCount})`,
      });
    }
  }
  for (let i = 0; i < posture.budgets.length; i += 1) {
    const budget = posture.budgets[i]!;
    if (budget.severity === "breach") {
      blockers.push({
        code: "CEILING_BREACHED",
        source: `cost-posture.budgets[${i}]`,
        detail: `projectedCost=${budget.projectedTotalCostMinor} over ceiling=${budget.ceilingMinor} (REAL severity=breach, projection=true)`,
      });
    }
  }
  return blockers;
}

interface CorpusCheck {
  readonly corpus: "field" | "security" | "commerce" | "adoption";
  readonly present: boolean;
  readonly tampered: boolean;
  readonly countOk: boolean;
  readonly expectedCount: number;
  readonly actualCount: number;
  readonly failures: number;
  readonly failureDetail: string;
}

function checkFieldCorpus(report: FieldAcceptanceReport | undefined): CorpusCheck {
  const present = report !== undefined;
  const tampered = present && !verifyFieldReport(report);
  const count = report?.aggregate.journeys ?? 0;
  return {
    corpus: "field",
    present,
    tampered,
    countOk: present && count === FIELD_JOURNEYS.length,
    expectedCount: FIELD_JOURNEYS.length,
    actualCount: count,
    failures: report?.aggregate.failed ?? 0,
    failureDetail: `aggregate.failed=${report?.aggregate.failed ?? 0} of aggregate.journeys=${report?.aggregate.journeys ?? 0}`,
  };
}

function checkSecurityCorpus(report: SecurityAcceptanceReport | undefined): CorpusCheck {
  const present = report !== undefined;
  const tampered = present && !verifySecurityReport(report);
  const count = report?.totalJourneys ?? 0;
  return {
    corpus: "security",
    present,
    tampered,
    countOk: present && count === SECURITY_JOURNEYS.length,
    expectedCount: SECURITY_JOURNEYS.length,
    actualCount: count,
    failures: report?.failedJourneys ?? 0,
    failureDetail: `failedJourneys=${report?.failedJourneys ?? 0} of totalJourneys=${report?.totalJourneys ?? 0}`,
  };
}

function checkCommerceCorpus(report: CommerceJourneyReport | undefined): CorpusCheck {
  const present = report !== undefined;
  const tampered = present && !verifyJourneyReport(report);
  const count = report?.totals.journeyCount ?? 0;
  return {
    corpus: "commerce",
    present,
    tampered,
    countOk: present && count === COMMERCE_JOURNEYS.length,
    expectedCount: COMMERCE_JOURNEYS.length,
    actualCount: count,
    failures: report?.totals.failed ?? 0,
    failureDetail: `totals.failed=${report?.totals.failed ?? 0} of totals.journeyCount=${report?.totals.journeyCount ?? 0}`,
  };
}

function checkAdoptionCorpus(report: AdoptionReport | undefined): CorpusCheck {
  const present = report !== undefined;
  const tampered = present && !verifyAdoptionReport(report);
  const workspaces = report?.aggregate.workspaces ?? 0;
  const failures = present && report!.aggregate.allJourneysPassed ? 0 : 1;
  return {
    corpus: "adoption",
    present,
    tampered,
    countOk: present && workspaces === WORKSPACE_POPULATION.length,
    expectedCount: WORKSPACE_POPULATION.length,
    actualCount: workspaces,
    failures,
    failureDetail: present
      ? `allJourneysPassed=${report!.aggregate.allJourneysPassed} determinismVerified=${report!.aggregate.determinismVerified} journeyExecutions=${report!.aggregate.journeyExecutions}`
      : "adoption baseline report absent",
  };
}

function acceptanceBlockers(input: ReleaseGateInput): ReleaseBlocker[] {
  const checks = [
    checkFieldCorpus(input.acceptance.field),
    checkSecurityCorpus(input.acceptance.security),
    checkCommerceCorpus(input.acceptance.commerce),
    checkAdoptionCorpus(input.acceptance.adoption),
  ];
  const blockers: ReleaseBlocker[] = [];
  for (const check of checks) {
    const source = `acceptance.${check.corpus}`;
    if (!check.present) {
      blockers.push({
        code: "ACCEPTANCE_MISSING",
        source,
        detail: `${check.corpus} baseline report not supplied`,
      });
      continue;
    }
    if (check.tampered) {
      blockers.push({
        code: "ACCEPTANCE_TAMPERED",
        source,
        detail: `${check.corpus} report digest mismatch — the presented report was tampered`,
      });
      continue;
    }
    if (!check.countOk) {
      blockers.push({
        code: "ACCEPTANCE_COUNT_MISMATCH",
        source,
        detail: `expected ${check.expectedCount} (REAL corpus length), report carries ${check.actualCount}`,
      });
    }
    if (check.failures > 0) {
      blockers.push({
        code: "ACCEPTANCE_FAILED",
        source,
        detail: check.failureDetail,
      });
    }
  }
  return blockers;
}

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------

/**
 * Evaluate the production release gate. Pure and total: every failure mode
 * is a NAMED blocker; the function never throws. Empty tenant short-circuits
 * to a single TENANT_ID_EMPTY blocker (fail-closed — no signal is evaluated
 * without a tenant scope). READY iff blockers.length === 0.
 */
export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateVerdict {
  const blockers: ReleaseBlocker[] = [];
  if (input.tenantId === "") {
    blockers.push({
      code: "TENANT_ID_EMPTY",
      source: "release-gate.tenantId",
      detail: "the release gate requires a tenant scope; none was supplied",
    });
    return withDigest(input.tenantId, blockers);
  }
  blockers.push(...statusBlockers(input));
  blockers.push(...costBlockers(input));
  blockers.push(...acceptanceBlockers(input));
  return withDigest(input.tenantId, blockers);
}

function withDigest(tenantId: string, blockers: readonly ReleaseBlocker[]): ReleaseGateVerdict {
  const base: Omit<ReleaseGateVerdict, "gateDigest"> = {
    schemaVersion: RELEASE_GATE_SCHEMA_VERSION,
    tenantId,
    verdict: blockers.length === 0 ? "READY" : "NOT-READY",
    blockers,
  };
  return { ...base, gateDigest: gateDigestOf(base) };
}

/** Recompute the verdict digest — false means the presented verdict was tampered. */
export function verifyReleaseGateVerdict(verdict: ReleaseGateVerdict): boolean {
  const { gateDigest, ...rest } = verdict;
  return gateDigestOf(rest) === gateDigest;
}
