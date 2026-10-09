/**
 * REAL-output fixture builders for the F281 test suite.
 *
 * Every lane signal / cost input is a REAL output of the owning hardened
 * module, produced by calling the module's own public functions over
 * deterministic inputs (logical times only — no clock, no randomness).
 * Negative fixtures degrade surfaces through the owning module's OWN
 * tamper/refusal semantics (dropAuditEvent, cross-tenant journal, breach
 * bands, over-cap requests, posture divergence, over-ceiling projections).
 */

import {
  appendAuditEvent,
  dropAuditEvent,
  tamperAuditPayload,
  verifyAuditLedger,
  type AuditLedgerEvent,
  type AuditVerification,
} from "@fleetos/security";
import {
  appendExecutionLedger,
  diffIncidentReplays,
  replayIncident,
  type ExecutionLedgerEntry,
  type IncidentReplay,
  type IncidentReplayResult,
  type ReplayDivergence,
} from "@fleetos/execution";
import {
  buildSlaScorecard,
  evaluateSla,
  type FulfillmentOutcomeRecord,
  type SlaDefinition,
  type SlaScorecardResult,
} from "@fleetos/vendors";
import {
  checkTenantAdmission,
  emptyTenantAdmissionCaps,
  withTenantCap,
  type AdmissionCapDecision,
} from "@fleetos/observations";
import {
  captureOfflineEntry,
  emptyOfflineBuffer,
  replayOfflineBuffer,
  type OfflineReplayReport,
} from "@fleetos/connectivity";
import {
  appendUsage,
  projectBudgetBurn,
  type BudgetBurnProjection,
  type BudgetCheckPort,
  type BurnActuals,
  type UsageLedgerEntry,
} from "@fleetos/model-gateway";
import {
  allocateCostAcrossWorkOrders,
  type CostAllocationResult,
} from "@fleetos/procurement";
import {
  deriveCeilingFromAllocation,
  enforceBudgetCeiling,
  type BudgetCeiling,
  type CeilingCheck,
  type LaneSignal,
} from "../src/index.js";

export const TENANT = "tnt_release-gate";
export const T0 = 1_774_000_000_000;

// ---------------------------------------------------------------------------
// Audit ledger (REAL @fleetos/security outputs).
// ---------------------------------------------------------------------------

export function buildAuditLedger(tenantId: string, entries = 3): readonly AuditLedgerEvent[] {
  let ledger: readonly AuditLedgerEvent[] = [];
  for (let i = 0; i < entries; i += 1) {
    const r = appendAuditEvent(ledger, {
      tenantId,
      surface: "guardian.evaluation",
      subjectId: `decision-${i}`,
      occurredAt: T0 + i,
      payload: { verdict: "allow", rule: `rule-${i}` },
    });
    if (!r.ok) throw new Error(`audit fixture append refused: ${r.reason}`);
    ledger = r.ledger;
  }
  return ledger;
}

export function healthyAuditVerification(tenantId = TENANT): AuditVerification {
  return verifyAuditLedger(buildAuditLedger(tenantId));
}

/** REAL gap degradation: an interior entry removed (dropAuditEvent). */
export function gappedAuditVerification(tenantId = TENANT): AuditVerification {
  const ledger = buildAuditLedger(tenantId, 4);
  return verifyAuditLedger(dropAuditEvent(ledger, 1));
}

/** REAL content tamper: payload mutated without re-sealing. */
export function tamperedPayloadAuditVerification(tenantId = TENANT): AuditVerification {
  const ledger = buildAuditLedger(tenantId, 3);
  return verifyAuditLedger(tamperAuditPayload(ledger, 1, { verdict: "deny" }));
}

// ---------------------------------------------------------------------------
// Incident replay (REAL @fleetos/execution outputs over a REAL ledger).
// ---------------------------------------------------------------------------

interface IncidentJournalEvent {
  readonly eventId: string;
  readonly tenantId: string;
  readonly intentId: string;
  readonly kind: "action.authorized" | "action.confirmed";
  readonly fromState: "proposed";
  readonly toState: "authorized" | "confirmed";
  readonly emittedAt: string;
  readonly actorId: string;
  readonly reason: string;
  readonly transitionDigest: string;
}

export function buildIncidentLedger(tenantId: string): readonly ExecutionLedgerEntry[] {
  let ledger: readonly ExecutionLedgerEntry[] = [];
  const steps: ReadonlyArray<{ key: string; kind: "submitted" | "acked" | "completed"; at: number }> = [
    { key: "cmd-alpha", kind: "submitted", at: T0 },
    { key: "cmd-beta", kind: "submitted", at: T0 + 50 },
    { key: "cmd-alpha", kind: "acked", at: T0 + 100 },
    { key: "cmd-beta", kind: "completed", at: T0 + 200 },
    { key: "cmd-alpha", kind: "completed", at: T0 + 300 },
  ];
  for (const step of steps) {
    const r = appendExecutionLedger(ledger, {
      tenantId,
      idempotencyKey: step.key,
      kind: step.kind,
      at: step.at,
    });
    if (!r.ok) throw new Error(`incident ledger append refused: ${r.reason}`);
    ledger = r.ledger;
  }
  return ledger;
}

export function buildIncidentJournal(tenantId: string): IncidentJournalEvent[] {
  return [
    {
      eventId: "audit-intent-1",
      tenantId,
      intentId: "intent-1",
      kind: "action.authorized",
      fromState: "proposed",
      toState: "authorized",
      emittedAt: "2026-01-01T00:00:01.000Z",
      actorId: "actor-1",
      reason: "fixture authorization",
      transitionDigest: "fixture-transition-digest-1",
    },
  ];
}

export function healthyReplay(tenantId = TENANT): IncidentReplayResult {
  return replayIncident({ tenantId, ledger: buildIncidentLedger(tenantId), journal: buildIncidentJournal(tenantId) });
}

export function healthyDivergence(tenantId = TENANT): ReplayDivergence {
  const recorded = healthyReplay(tenantId);
  if (!recorded.ok) throw new Error("fixture replay refused");
  return diffIncidentReplays(recorded.replay, recorded.replay);
}

/** REAL equivalence divergence: the journal kind differs between recordings. */
export function divergentReplayOutcome(tenantId = TENANT): {
  recorded: IncidentReplay;
  replayed: IncidentReplayResult;
  divergence: ReplayDivergence;
} {
  const recorded = healthyReplay(tenantId);
  if (!recorded.ok) throw new Error("fixture replay refused");
  const tamperedJournal = buildIncidentJournal(tenantId).map((e) =>
    e.eventId === "audit-intent-1" ? { ...e, kind: "action.confirmed" as const } : e,
  );
  const replayed = replayIncident({ tenantId, ledger: buildIncidentLedger(tenantId), journal: tamperedJournal });
  if (!replayed.ok) throw new Error("fixture re-replay refused");
  return {
    recorded: recorded.replay,
    replayed,
    divergence: diffIncidentReplays(recorded.replay, replayed.replay),
  };
}

/** REAL replay refusal: a foreign-tenant journal entry. */
export function refusedReplay(tenantId = TENANT): IncidentReplayResult {
  const foreignJournal = buildIncidentJournal(`tnt_other-firm`).map((e) => ({ ...e }));
  return replayIncident({ tenantId, ledger: buildIncidentLedger(tenantId), journal: foreignJournal });
}

// ---------------------------------------------------------------------------
// SLA scorecard (REAL @fleetos/vendors outputs).
// ---------------------------------------------------------------------------

export function slaDefinition(tenantId: string): SlaDefinition {
  return {
    slaId: "sla-gate-1",
    tenant: { tenantId },
    vendorId: "vendor-gate-1",
    availabilityTargetBps: 9000,
    responseBands: [
      { bandId: "minor", maxLatenessMs: 100, penaltyBps: 25 },
      { bandId: "major", maxLatenessMs: 10_000, penaltyBps: 200 },
    ],
    creditCapBps: 500,
    effectiveFrom: null,
    effectiveTo: null,
  };
}

export function slaOutcomes(tenantId: string, late: boolean): FulfillmentOutcomeRecord[] {
  return [
    {
      vendorId: "vendor-gate-1",
      tenant: { tenantId },
      orderId: "po-1",
      promisedAt: T0,
      deliveredAt: T0 - 10,
      quantityOrdered: 100,
      quantityReceived: 100,
    },
    {
      vendorId: "vendor-gate-1",
      tenant: { tenantId },
      orderId: "po-2",
      promisedAt: T0 + 1000,
      deliveredAt: late ? T0 + 1000 + 500 : T0 + 1000,
      quantityOrdered: 50,
      quantityReceived: 50,
    },
  ];
}

export function healthySlaScorecard(tenantId = TENANT): SlaScorecardResult {
  const evaluation = evaluateSla({ tenantId }, slaDefinition(tenantId), slaOutcomes(tenantId, false), T0 + 5000);
  if (!evaluation.ok) throw new Error(`sla fixture refused: ${evaluation.reasonCode}`);
  return buildSlaScorecard({ tenantId }, evaluation.evaluation);
}

/** REAL penalty degradation: po-2 delivered 500 ms late (major band). */
export function breachedSlaScorecard(tenantId = TENANT): SlaScorecardResult {
  const evaluation = evaluateSla({ tenantId }, slaDefinition(tenantId), slaOutcomes(tenantId, true), T0 + 5000);
  if (!evaluation.ok) throw new Error(`sla fixture refused: ${evaluation.reasonCode}`);
  return buildSlaScorecard({ tenantId }, evaluation.evaluation);
}

// ---------------------------------------------------------------------------
// Ingestion admission (REAL @fleetos/observations outputs).
// ---------------------------------------------------------------------------

export function healthyAdmission(tenantId = TENANT, cap = 100): AdmissionCapDecision {
  const caps = withTenantCap(emptyTenantAdmissionCaps(100), tenantId, cap);
  return checkTenantAdmission(caps, tenantId, 1);
}

/** REAL over-cap refusal: 11 requested against a 10 cap. */
export function overCapAdmission(tenantId = TENANT): AdmissionCapDecision {
  const caps = withTenantCap(emptyTenantAdmissionCaps(10), tenantId, 10);
  return checkTenantAdmission(caps, tenantId, 11);
}

// ---------------------------------------------------------------------------
// Offline replay (REAL @fleetos/connectivity outputs).
// ---------------------------------------------------------------------------

export function healthyOfflineReport(tenantId = TENANT, deviceId = "dev-gate-1"): OfflineReplayReport {
  const buffer = emptyOfflineBuffer(tenantId, deviceId);
  const captured = captureOfflineEntry(buffer, {
    entryId: "off-1",
    kind: "telemetry",
    payload: { seq: 1 },
    at: T0,
    posture: "connected",
  });
  if (!captured.ok) throw new Error(`offline fixture capture refused: ${captured.reason}`);
  return replayOfflineBuffer(captured.buffer, "connected", T0 + 1000);
}

/** REAL divergence: captured offline, replayed against connected. */
export function divergentOfflineReport(tenantId = TENANT, deviceId = "dev-gate-2"): OfflineReplayReport {
  const buffer = emptyOfflineBuffer(tenantId, deviceId);
  const captured = captureOfflineEntry(buffer, {
    entryId: "off-1",
    kind: "telemetry",
    payload: { seq: 1 },
    at: T0,
    posture: "offline",
  });
  if (!captured.ok) throw new Error(`offline fixture capture refused: ${captured.reason}`);
  return replayOfflineBuffer(captured.buffer, "connected", T0 + 2000);
}

// ---------------------------------------------------------------------------
// Usage ledger + burn projections + allocations (REAL F280C outputs).
// ---------------------------------------------------------------------------

const okBudgetPort: BudgetCheckPort = {
  check: () => ({ ok: true, remainingUnits: 1_000_000, remainingSpendMinor: 1_000_000 }),
};

export function buildUsageLedger(
  tenantId: string,
  entries: ReadonlyArray<{ units: number; costMinor: number }>,
): readonly UsageLedgerEntry[] {
  let ledger: readonly UsageLedgerEntry[] = [];
  entries.forEach((entry, i) => {
    const r = appendUsage(ledger, okBudgetPort, {
      tenantId,
      agentId: "agent-gate-1",
      requestRef: `req-gate-${i}`,
      modelId: "model-gate",
      providerId: "provider-gate",
      capability: "summarize",
      units: entry.units,
      costMinor: entry.costMinor,
      at: T0 + i,
    });
    if (!r.ok) throw new Error(`usage fixture append refused: ${r.reasonCode}`);
    ledger = r.ledger;
  });
  return ledger;
}

export function burnProjection(
  tenantId: string,
  ledger: readonly UsageLedgerEntry[],
  options: { readonly scheduledCostMinor: number; readonly ceilingMinor: number },
): BudgetBurnProjection {
  const r = projectBudgetBurn(
    tenantId,
    ledger,
    [
      {
        label: "next-period-burn",
        units: 10,
        costMinor: options.scheduledCostMinor,
        at: T0 + 10_000,
        assumption: "fixture: steady-state fleet usage for the next period",
      },
    ],
    { ceilingMinor: options.ceilingMinor },
  );
  if (!r.ok) throw new Error(`burn fixture refused: ${r.reasonCode}`);
  return r.projection;
}

export function healthyBurnProjection(tenantId = TENANT): BudgetBurnProjection {
  const ledger = buildUsageLedger(tenantId, [
    { units: 5, costMinor: 500 },
    { units: 3, costMinor: 300 },
  ]);
  return burnProjection(tenantId, ledger, { scheduledCostMinor: 200, ceilingMinor: 10_000 });
}

export function warningBurnProjection(tenantId = TENANT): BudgetBurnProjection {
  const ledger = buildUsageLedger(tenantId, [{ units: 5, costMinor: 5_000 }]);
  // actual 5000 + projected 4000 = 9000 of 10000 = 9000 bps >= warning threshold.
  return burnProjection(tenantId, ledger, { scheduledCostMinor: 4_000, ceilingMinor: 10_000 });
}

export function breachBurnProjection(tenantId = TENANT): BudgetBurnProjection {
  const ledger = buildUsageLedger(tenantId, [{ units: 5, costMinor: 6_000 }]);
  // actual 6000 + projected 6000 = 12000 > ceiling 10000 → REAL severity "breach".
  return burnProjection(tenantId, ledger, { scheduledCostMinor: 6_000, ceilingMinor: 10_000 });
}

export function actualsOf(projection: BudgetBurnProjection): BurnActuals {
  return projection.actuals;
}

export function allocationOk(tenantId = TENANT, totalMinorUnits = 9_000): CostAllocationResult {
  return allocateCostAcrossWorkOrders({
    tenant: { tenantId },
    orderId: "po-gate-1",
    totalMinorUnits,
    shares: [
      { workOrderId: "wo-1", shareBps: 6_000, tenant: { tenantId } },
      { workOrderId: "wo-2", shareBps: 4_000, tenant: { tenantId } },
    ],
  });
}

/** REAL allocation refusal: shares do not sum to 10000. */
export function allocationRefused(tenantId = TENANT): CostAllocationResult {
  return allocateCostAcrossWorkOrders({
    tenant: { tenantId },
    orderId: "po-gate-1",
    totalMinorUnits: 1_000,
    shares: [
      { workOrderId: "wo-1", shareBps: 6_000, tenant: { tenantId } },
      { workOrderId: "wo-2", shareBps: 3_000, tenant: { tenantId } },
    ],
  });
}

// ---------------------------------------------------------------------------
// Ceiling derivation + enforcement (over REAL outputs).
// ---------------------------------------------------------------------------

export function allocationDerivedCeiling(tenantId = TENANT): BudgetCeiling {
  const derived = deriveCeilingFromAllocation(allocationOk(tenantId, 9_000));
  if (!derived.ok) throw new Error("ceiling derivation refused");
  return derived.ceiling;
}

export function withinCeilingCheck(tenantId = TENANT): CeilingCheck {
  const projection = healthyBurnProjection(tenantId);
  const enforcement = enforceBudgetCeiling({
    tenantId,
    actuals: projection.actuals,
    ceiling: allocationDerivedCeiling(tenantId),
  });
  if (!enforcement.ok) throw new Error(`fixture enforcement refused: ${enforcement.reasonCode}`);
  return enforcement.check;
}

export function overCeilingCheck(tenantId = TENANT): CeilingCheck {
  const projection = burnProjection(
    tenantId,
    buildUsageLedger(tenantId, [{ units: 5, costMinor: 10_000 }]),
    { scheduledCostMinor: 0, ceilingMinor: 10_000 },
  );
  const enforcement = enforceBudgetCeiling({
    tenantId,
    actuals: projection.actuals,
    ceiling: { ceilingMinor: 9_000, source: "caller-declared", sourceRef: "fixture ceiling" },
  });
  if (enforcement.ok || enforcement.reasonCode !== "OVER_CEILING") {
    throw new Error("fixture enforcement unexpectedly within ceiling");
  }
  return enforcement.check;
}

// ---------------------------------------------------------------------------
// Healthy five-lane signal set.
// ---------------------------------------------------------------------------

export function healthyLaneSignals(tenantId = TENANT): readonly LaneSignal[] {
  const replay = healthyReplay(tenantId);
  if (!replay.ok) throw new Error("fixture replay refused");
  const divergence = diffIncidentReplays(replay.replay, replay.replay);
  return [
    { kind: "audit-ledger", tenantId, verification: healthyAuditVerification(tenantId) },
    { kind: "incident-replay", tenantId, replay, divergence },
    { kind: "sla-scorecard", tenantId, scorecard: healthySlaScorecard(tenantId) },
    { kind: "ingestion-admission", tenantId, decision: healthyAdmission(tenantId) },
    { kind: "offline-replay", tenantId, report: healthyOfflineReport(tenantId) },
  ];
}
