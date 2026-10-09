/**
 * @fleetos/acceptance-release — deterministic system-status rollups over the
 * REAL Wave-8 hardened surfaces (F280A / F280B / F280C).
 *
 * The rollup assembles per-lane status records from REAL package outputs
 * (each lane signal IS a REAL output of the owning hardened module — the
 * module never re-runs, re-scores or re-computes a lane's numbers; it
 * presents them verbatim and derives only counts + a digest):
 *
 *   - audit-ledger        — `verifyAuditLedger` → `AuditVerification`
 *                           (@fleetos/security, F280B D1)
 *   - incident-replay     — `replayIncident` → `IncidentReplayResult` and
 *                           `diffIncidentReplays` → `ReplayDivergence`
 *                           (@fleetos/execution, F280B D2)
 *   - sla-scorecard       — `buildSlaScorecard` → `SlaScorecardResult`
 *                           (@fleetos/vendors, F280C 3.1)
 *   - ingestion-admission — `checkTenantAdmission` → `AdmissionCapDecision`
 *                           (@fleetos/observations, F280A 3.1)
 *   - offline-replay      — `replayOfflineBuffer` → `OfflineReplayReport`
 *                           (@fleetos/connectivity, F280A 3.2)
 *
 * Every field of every lane record carries the REAL output field it was
 * copied from (the `source` string on each `LaneStatusField`). A degraded
 * lane's reason code is the REAL output's own code, surfaced VERBATIM.
 *
 * HONESTY LAW (F281): every number in this view equals a REAL package
 * output field, or is a derived COUNT of REAL records (healthyLaneCount /
 * degradedLaneCount — documented as such), or is a recorded refusal.
 *
 * Tenant law (A8, fail-closed): the view is tenant-scoped; a lane signal
 * whose tenant scope does not match the view tenant refuses the WHOLE
 * rollup naming the offender lane — foreign lanes are never silently
 * filtered. Where the REAL output itself carries a tenant (scorecard,
 * offline report, successful replay), that carried tenant is cross-checked
 * against the caller-recorded pairing and a disagreement refuses too.
 *
 * Pure deterministic TS: no clock, no randomness, no network, no timers.
 * Lane records are presented in the canonical LANE_IDS order — input order
 * never leaks.
 */

import type { AuditVerification } from "@fleetos/security";
import type { IncidentReplayResult, ReplayDivergence } from "@fleetos/execution";
import type { SlaScorecardResult } from "@fleetos/vendors";
import type { AdmissionCapDecision } from "@fleetos/observations";
import type { OfflineReplayReport } from "@fleetos/connectivity";
import { digestOf } from "./digest.js";

export const OBSERVABILITY_SCHEMA_VERSION = 1;

/** The five hardened Wave-8 lanes this rollup covers (canonical order). */
export const LANE_IDS = [
  "audit-ledger",
  "incident-replay",
  "sla-scorecard",
  "ingestion-admission",
  "offline-replay",
] as const;

export type LaneId = (typeof LANE_IDS)[number];

export type LaneHealth = "healthy" | "degraded";

/** One presented field — value copied verbatim, source documented. */
export interface LaneStatusField {
  readonly name: string;
  readonly value: string | number | boolean | null;
  /** The REAL output field this value was copied from. */
  readonly source: string;
}

/** One lane's status record — assembled from ONE REAL package output. */
export interface LaneStatus {
  readonly laneId: LaneId;
  /** The lane's tenant scope (caller-recorded pairing; cross-checked where the output carries its own). */
  readonly tenantId: string;
  readonly health: LaneHealth;
  /** The REAL module + function + output type this record was assembled from. */
  readonly source: string;
  /** The degraded reason code, VERBATIM from the REAL output (null when healthy). */
  readonly reason: string | null;
  readonly fields: readonly LaneStatusField[];
}

export type SystemHealth = "healthy" | "degraded";

export interface SystemStatus {
  readonly schemaVersion: typeof OBSERVABILITY_SCHEMA_VERSION;
  readonly tenantId: string;
  /** Lane records in canonical LANE_IDS order. */
  readonly lanes: readonly LaneStatus[];
  /** Derived COUNT of REAL healthy lane records. */
  readonly healthyLaneCount: number;
  /** Derived COUNT of REAL degraded lane records. */
  readonly degradedLaneCount: number;
  /** Lane ids of the degraded records, in canonical order. */
  readonly degradedLaneIds: readonly LaneId[];
  readonly health: SystemHealth;
  readonly statusDigest: string;
}

export type StatusRefusalCode =
  | "TENANT_ID_EMPTY"
  | "NO_LANES"
  | "DUPLICATE_LANE"
  | "LANE_TENANT_MISMATCH";

export type SystemStatusResult =
  | { readonly ok: true; readonly status: SystemStatus }
  | {
      readonly ok: false;
      readonly reasonCode: StatusRefusalCode;
      readonly lane: LaneId | null;
      readonly detail: string;
    };

/**
 * One lane signal = one REAL output of the owning hardened module, plus the
 * caller-recorded tenant pairing (`tenantId`). The rollup never re-runs the
 * owning function; the signal IS the output.
 */
export type LaneSignal =
  | {
    readonly kind: "audit-ledger";
    /** Caller-recorded tenant scope of the verified ledger (the verification output carries no tenant). */
    readonly tenantId: string;
    /** REAL output: `verifyAuditLedger(ledger)` (@fleetos/security). */
    readonly verification: AuditVerification;
  }
  | {
    readonly kind: "incident-replay";
    readonly tenantId: string;
    /** REAL output: `replayIncident({tenantId, ledger, journal})` (@fleetos/execution). */
    readonly replay: IncidentReplayResult;
    /** REAL output: `diffIncidentReplays(recorded, replayed)` (@fleetos/execution). */
    readonly divergence: ReplayDivergence;
  }
  | {
    readonly kind: "sla-scorecard";
    readonly tenantId: string;
    /** REAL output: `buildSlaScorecard(tenant, evaluation)` (@fleetos/vendors). */
    readonly scorecard: SlaScorecardResult;
  }
  | {
    readonly kind: "ingestion-admission";
    readonly tenantId: string;
    /** REAL output: `checkTenantAdmission(caps, tenantId, requested)` (@fleetos/observations). */
    readonly decision: AdmissionCapDecision;
  }
  | {
    readonly kind: "offline-replay";
    readonly tenantId: string;
    /** REAL output: `replayOfflineBuffer(buffer, posture, now)` (@fleetos/connectivity). */
    readonly report: OfflineReplayReport;
  };

// ---------------------------------------------------------------------------
// Per-lane assembly — fields copied verbatim, sources documented.
// ---------------------------------------------------------------------------

const AUDIT_SOURCE = "@fleetos/security verifyAuditLedger → AuditVerification";
const REPLAY_SOURCE =
  "@fleetos/execution replayIncident → IncidentReplayResult; diffIncidentReplays → ReplayDivergence";
const SLA_SOURCE = "@fleetos/vendors buildSlaScorecard → SlaScorecardResult";
const ADMISSION_SOURCE = "@fleetos/observations checkTenantAdmission → AdmissionCapDecision";
const OFFLINE_SOURCE = "@fleetos/connectivity replayOfflineBuffer → OfflineReplayReport";

function auditLane(tenantId: string, verification: AuditVerification): LaneStatus {
  return {
    laneId: "audit-ledger",
    tenantId,
    health: verification.verified ? "healthy" : "degraded",
    source: AUDIT_SOURCE,
    reason: verification.verified ? null : verification.reason,
    fields: [
      { name: "verified", value: verification.verified, source: "AuditVerification.verified" },
      { name: "checkedEntries", value: verification.checkedEntries, source: "AuditVerification.checkedEntries" },
      { name: "brokenAt", value: verification.brokenAt, source: "AuditVerification.brokenAt" },
      { name: "gapAt", value: verification.gapAt, source: "AuditVerification.gapAt" },
      { name: "computedHeadDigest", value: verification.computedHeadDigest, source: "AuditVerification.computedHeadDigest" },
    ],
  };
}

function replayLane(
  tenantId: string,
  replay: IncidentReplayResult,
  divergence: ReplayDivergence,
): LaneStatus {
  if (!replay.ok) {
    return {
      laneId: "incident-replay",
      tenantId,
      health: "degraded",
      source: REPLAY_SOURCE,
      reason: replay.reason,
      fields: [
        { name: "replayOk", value: false, source: "IncidentReplayResult.ok" },
        { name: "refusalReason", value: replay.reason, source: "IncidentReplayResult.reason" },
        { name: "offender", value: replay.offender, source: "IncidentReplayResult.offender" },
        { name: "diverged", value: divergence.diverged, source: "ReplayDivergence.diverged" },
      ],
    };
  }
  const diverged = divergence.diverged;
  return {
    laneId: "incident-replay",
    tenantId,
    health: diverged ? "degraded" : "healthy",
    source: REPLAY_SOURCE,
    // Degraded-by-divergence: the REAL DivergenceField class of the first
    // divergent timeline step, surfaced verbatim.
    reason: diverged ? divergence.field : null,
    fields: [
      { name: "replayOk", value: true, source: "IncidentReplayResult.ok" },
      { name: "replayDigest", value: replay.replay.replayDigest, source: "IncidentReplay.replayDigest" },
      { name: "timelineSteps", value: replay.replay.timeline.length, source: "IncidentReplay.timeline.length" },
      { name: "commandCount", value: replay.replay.commands.length, source: "IncidentReplay.commands.length" },
      { name: "diverged", value: diverged, source: "ReplayDivergence.diverged" },
      { name: "divergenceStepIndex", value: divergence.stepIndex, source: "ReplayDivergence.stepIndex" },
      { name: "divergenceField", value: divergence.field, source: "ReplayDivergence.field" },
      { name: "divergenceExpected", value: divergence.expected, source: "ReplayDivergence.expected" },
      { name: "divergenceActual", value: divergence.actual, source: "ReplayDivergence.actual" },
    ],
  };
}

function slaLane(tenantId: string, scorecard: SlaScorecardResult): LaneStatus {
  if (!scorecard.ok) {
    return {
      laneId: "sla-scorecard",
      tenantId,
      health: "degraded",
      source: SLA_SOURCE,
      reason: scorecard.reasonCode,
      fields: [
        { name: "scorecardOk", value: false, source: "SlaScorecardResult.ok" },
        { name: "refusalReason", value: scorecard.reasonCode, source: "SlaScorecardResult.reasonCode" },
      ],
    };
  }
  const card = scorecard.scorecard;
  const compliant = card.status === "compliant";
  return {
    laneId: "sla-scorecard",
    tenantId,
    health: compliant ? "healthy" : "degraded",
    source: SLA_SOURCE,
    // Degraded: the REAL scorecard status, surfaced verbatim.
    reason: compliant ? null : card.status,
    fields: [
      { name: "scorecardOk", value: true, source: "SlaScorecardResult.ok" },
      { name: "slaId", value: card.slaId, source: "SlaScorecard.slaId" },
      { name: "vendorId", value: card.vendorId, source: "SlaScorecard.vendorId" },
      { name: "evaluationDigest", value: card.evaluationDigest, source: "SlaScorecard.evaluationDigest" },
      { name: "evaluatedAt", value: card.evaluatedAt, source: "SlaScorecard.evaluatedAt" },
      { name: "availabilityBps", value: card.availabilityBps, source: "SlaScorecard.availabilityBps" },
      { name: "availabilityTargetBps", value: card.availabilityTargetBps, source: "SlaScorecard.availabilityTargetBps" },
      { name: "availabilityMet", value: card.availabilityMet, source: "SlaScorecard.availabilityMet" },
      { name: "breachCount", value: card.breachCount, source: "SlaScorecard.breachCount" },
      { name: "totalPenaltyBps", value: card.totalPenaltyBps, source: "SlaScorecard.totalPenaltyBps" },
      { name: "capApplied", value: card.capApplied, source: "SlaScorecard.capApplied" },
      { name: "status", value: card.status, source: "SlaScorecard.status" },
    ],
  };
}

function admissionLane(tenantId: string, decision: AdmissionCapDecision): LaneStatus {
  if (!decision.ok) {
    return {
      laneId: "ingestion-admission",
      tenantId,
      health: "degraded",
      source: ADMISSION_SOURCE,
      reason: decision.reason,
      fields: [
        { name: "admitted", value: false, source: "AdmissionCapDecision.ok" },
        { name: "refusalReason", value: decision.reason, source: "AdmissionCapDecision.reason" },
        { name: "cap", value: decision.cap, source: "AdmissionCapDecision.cap" },
        { name: "used", value: decision.used, source: "AdmissionCapDecision.used" },
        { name: "requested", value: decision.requested, source: "AdmissionCapDecision.requested" },
      ],
    };
  }
  return {
    laneId: "ingestion-admission",
    tenantId,
    health: "healthy",
    source: ADMISSION_SOURCE,
    reason: null,
    fields: [
      { name: "admitted", value: true, source: "AdmissionCapDecision.ok" },
      { name: "cap", value: decision.cap, source: "AdmissionCapDecision.cap" },
      { name: "used", value: decision.used, source: "AdmissionCapDecision.used" },
      { name: "remaining", value: decision.remaining, source: "AdmissionCapDecision.remaining" },
    ],
  };
}

function offlineLane(tenantId: string, report: OfflineReplayReport): LaneStatus {
  const divergences = report.divergences;
  const first = divergences.length > 0 ? divergences[0]! : null;
  return {
    laneId: "offline-replay",
    tenantId,
    health: divergences.length === 0 ? "healthy" : "degraded",
    source: OFFLINE_SOURCE,
    // Degraded: the REAL OfflineDivergenceRecord.reason, surfaced verbatim.
    reason: first === null ? null : first.reason,
    fields: [
      { name: "deviceId", value: report.deviceId, source: "OfflineReplayReport.deviceId" },
      { name: "replayedPosture", value: report.replayedPosture, source: "OfflineReplayReport.replayedPosture" },
      { name: "replayedAt", value: report.replayedAt, source: "OfflineReplayReport.replayedAt" },
      { name: "entryCount", value: report.entries.length, source: "OfflineReplayReport.entries.length" },
      { name: "divergenceCount", value: divergences.length, source: "OfflineReplayReport.divergences.length" },
      { name: "replayDigest", value: report.replayDigest, source: "OfflineReplayReport.replayDigest" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tenant scope — paired (caller-recorded) vs carried (the output's own).
// ---------------------------------------------------------------------------

function signalTenantOf(signal: LaneSignal): { paired: string; carried: string | null } {
  switch (signal.kind) {
    case "audit-ledger":
      // AuditVerification carries no tenant — the pairing is the record.
      return { paired: signal.tenantId, carried: null };
    case "incident-replay":
      return {
        paired: signal.tenantId,
        carried: signal.replay.ok ? signal.replay.replay.tenantId : null,
      };
    case "sla-scorecard":
      return {
        paired: signal.tenantId,
        carried: signal.scorecard.ok ? signal.scorecard.scorecard.tenant.tenantId : null,
      };
    case "ingestion-admission":
      // AdmissionCapDecision carries no tenant — the pairing is the record.
      return { paired: signal.tenantId, carried: null };
    case "offline-replay":
      return { paired: signal.tenantId, carried: signal.report.tenantId };
  }
}

// ---------------------------------------------------------------------------
// Assembly.
// ---------------------------------------------------------------------------

function statusDigestOf(status: Omit<SystemStatus, "statusDigest">): string {
  return digestOf("system-status", status as unknown as object);
}

/**
 * Assemble the tenant-scoped system status view. Fail-closed: an empty
 * view tenant, zero lanes, a duplicate lane kind, or a lane whose tenant
 * scope does not match the view tenant refuses the WHOLE rollup with the
 * offender named — never a silently filtered lane.
 */
export function assembleSystemStatus(input: {
  readonly tenantId: string;
  readonly lanes: readonly LaneSignal[];
}): SystemStatusResult {
  if (input.tenantId === "") {
    return { ok: false, reasonCode: "TENANT_ID_EMPTY", lane: null, detail: "view tenant id is empty" };
  }
  if (input.lanes.length === 0) {
    return { ok: false, reasonCode: "NO_LANES", lane: null, detail: "no lane signals supplied" };
  }
  const byKind = new Map<LaneId, LaneSignal>();
  for (const signal of input.lanes) {
    if (byKind.has(signal.kind)) {
      return {
        ok: false,
        reasonCode: "DUPLICATE_LANE",
        lane: signal.kind,
        detail: `lane ${signal.kind} supplied more than once`,
      };
    }
    byKind.set(signal.kind, signal);
  }
  for (const signal of input.lanes) {
    const { paired, carried } = signalTenantOf(signal);
    if (paired !== input.tenantId) {
      return {
        ok: false,
        reasonCode: "LANE_TENANT_MISMATCH",
        lane: signal.kind,
        detail: `lane ${signal.kind} is scoped to tenant ${paired} but the view tenant is ${input.tenantId}`,
      };
    }
    if (carried !== null && carried !== paired) {
      return {
        ok: false,
        reasonCode: "LANE_TENANT_MISMATCH",
        lane: signal.kind,
        detail: `lane ${signal.kind} output carries tenant ${carried} but the recorded pairing is ${paired}`,
      };
    }
  }
  // Canonical lane order — input order never leaks.
  const lanes: LaneStatus[] = [];
  for (const id of LANE_IDS) {
    const signal = byKind.get(id);
    if (signal === undefined) continue;
    switch (signal.kind) {
      case "audit-ledger":
        lanes.push(auditLane(input.tenantId, signal.verification));
        break;
      case "incident-replay":
        lanes.push(replayLane(input.tenantId, signal.replay, signal.divergence));
        break;
      case "sla-scorecard":
        lanes.push(slaLane(input.tenantId, signal.scorecard));
        break;
      case "ingestion-admission":
        lanes.push(admissionLane(input.tenantId, signal.decision));
        break;
      case "offline-replay":
        lanes.push(offlineLane(input.tenantId, signal.report));
        break;
    }
  }
  const degraded = lanes.filter((l) => l.health === "degraded");
  const base: Omit<SystemStatus, "statusDigest"> = {
    schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
    tenantId: input.tenantId,
    lanes,
    healthyLaneCount: lanes.length - degraded.length,
    degradedLaneCount: degraded.length,
    degradedLaneIds: degraded.map((l) => l.laneId),
    health: degraded.length === 0 ? "healthy" : "degraded",
  };
  return { ok: true, status: { ...base, statusDigest: statusDigestOf(base) } };
}

/** Recompute the status digest — false means the presented view was tampered. */
export function verifySystemStatus(status: SystemStatus): boolean {
  const { statusDigest, ...rest } = status;
  return statusDigestOf(rest) === statusDigest;
}
