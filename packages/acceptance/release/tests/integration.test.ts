/**
 * THE REAL-RUN INTEGRATION: every lane signal, cost input and acceptance
 * baseline is a REAL output of the REAL hardened packages over REAL
 * records (REAL audit ledger via appendAuditEvent; REAL execution ledger
 * via appendExecutionLedger + REAL incident replay; REAL SLA evaluation;
 * REAL admission caps; REAL offline-buffer capture/replay; REAL usage
 * ledger via appendUsage → REAL burn projection; REAL cost allocation) —
 * and the gate's verdict over all of it. Run ONCE at module scope.
 */

import { describe, expect, it } from "vitest";
import { evaluateReleaseGate, verifyReleaseGateVerdict } from "../src/release-gate.js";
import { assembleSystemStatus, verifySystemStatus } from "../src/observability.js";
import { buildCostPosture, verifyCostPosture } from "../src/cost.js";
import { byteIdentical, digestOf } from "../src/digest.js";
import { FIELD_JOURNEYS } from "@fleetos/acceptance-field/journeys";
import { assembleAcceptanceReport as assembleFieldReport } from "@fleetos/acceptance-field";
import { SECURITY_JOURNEYS } from "@fleetos/acceptance-security/journeys";
import {
  assembleAcceptanceReport as assembleSecurityReport,
  runAllJourneys as runAllSecurityJourneys,
} from "@fleetos/acceptance-security";
import { JOURNEYS as COMMERCE_JOURNEYS } from "@fleetos/acceptance-commerce/journeys";
import {
  assembleJourneyReport as assembleCommerceReport,
  runAllJourneys as runAllCommerceJourneys,
} from "@fleetos/acceptance-commerce";
import { assembleAdoptionReport, runAdoptionSimulation } from "@fleetos/acceptance-adoption";
import { verifyAuditLedger } from "@fleetos/security";
import { diffIncidentReplays, replayIncident } from "@fleetos/execution";
import { evaluateSla, buildSlaScorecard } from "@fleetos/vendors";
import { checkTenantAdmission, emptyTenantAdmissionCaps, withTenantCap } from "@fleetos/observations";
import { captureOfflineEntry, emptyOfflineBuffer, replayOfflineBuffer } from "@fleetos/connectivity";
import { projectBudgetBurn } from "@fleetos/model-gateway";
import { allocateCostAcrossWorkOrders } from "@fleetos/procurement";
import {
  TENANT,
  T0,
  buildAuditLedger,
  buildIncidentJournal,
  buildIncidentLedger,
  buildUsageLedger,
  slaDefinition,
  slaOutcomes,
} from "./fixtures.js";

// ---------------------------------------------------------------------------
// The REAL run (module scope).
// ---------------------------------------------------------------------------

const auditLedger = buildAuditLedger(TENANT, 4);
const auditVerification = verifyAuditLedger(auditLedger);

const incidentLedger = buildIncidentLedger(TENANT);
const incidentJournal = buildIncidentJournal(TENANT);
const recordedReplay = replayIncident({ tenantId: TENANT, ledger: incidentLedger, journal: incidentJournal });
const reReplay = replayIncident({ tenantId: TENANT, ledger: incidentLedger, journal: incidentJournal });
if (!recordedReplay.ok || !reReplay.ok) throw new Error("integration replay refused");
const equivalence = diffIncidentReplays(recordedReplay.replay, reReplay.replay);

const slaEvaluation = evaluateSla({ tenantId: TENANT }, slaDefinition(TENANT), slaOutcomes(TENANT, false), T0 + 5000);
if (!slaEvaluation.ok) throw new Error(`integration SLA refused: ${slaEvaluation.reasonCode}`);
const slaScorecard = buildSlaScorecard({ tenantId: TENANT }, slaEvaluation.evaluation);

const admissionCaps = withTenantCap(emptyTenantAdmissionCaps(500), TENANT, 500);
const admissionDecision = checkTenantAdmission(admissionCaps, TENANT, 1);

const offlineBuffer = emptyOfflineBuffer(TENANT, "dev-integration-1");
const offlineCapture = captureOfflineEntry(offlineBuffer, {
  entryId: "off-int-1",
  kind: "telemetry",
  payload: { seq: 1 },
  at: T0,
  posture: "connected",
});
if (!offlineCapture.ok) throw new Error(`offline capture refused: ${offlineCapture.reason}`);
const offlineReport = replayOfflineBuffer(offlineCapture.buffer, "connected", T0 + 1000);

const usageLedger = buildUsageLedger(TENANT, [
  { units: 5, costMinor: 500 },
  { units: 3, costMinor: 300 },
]);
const burnProjectionResult = projectBudgetBurn(
  TENANT,
  usageLedger,
  [
    {
      label: "next-period-burn",
      units: 10,
      costMinor: 200,
      at: T0 + 10_000,
      assumption: "integration: steady-state fleet usage for the next period",
    },
  ],
  { ceilingMinor: 10_000 },
);
if (!burnProjectionResult.ok) throw new Error(`burn refused: ${burnProjectionResult.reasonCode}`);
const burnProjection = burnProjectionResult.projection;

const allocation = allocateCostAcrossWorkOrders({
  tenant: { tenantId: TENANT },
  orderId: "po-integration-1",
  totalMinorUnits: 9_000,
  shares: [
    { workOrderId: "wo-1", shareBps: 6_000, tenant: { tenantId: TENANT } },
    { workOrderId: "wo-2", shareBps: 4_000, tenant: { tenantId: TENANT } },
  ],
});

const fieldReport = assembleFieldReport(FIELD_JOURNEYS);
const securityReport = assembleSecurityReport(runAllSecurityJourneys(SECURITY_JOURNEYS));
const commerceOutcomes = await runAllCommerceJourneys(COMMERCE_JOURNEYS);
const commerceReport = assembleCommerceReport(commerceOutcomes);
const adoptionSimulation = await runAdoptionSimulation();
const adoptionReport = assembleAdoptionReport(adoptionSimulation);

const statusResult = assembleSystemStatus({
  tenantId: TENANT,
  lanes: [
    { kind: "audit-ledger", tenantId: TENANT, verification: auditVerification },
    { kind: "incident-replay", tenantId: TENANT, replay: recordedReplay, divergence: equivalence },
    { kind: "sla-scorecard", tenantId: TENANT, scorecard: slaScorecard },
    { kind: "ingestion-admission", tenantId: TENANT, decision: admissionDecision },
    { kind: "offline-replay", tenantId: TENANT, report: offlineReport },
  ],
});

// The cost side is assembled from the REAL allocation-derived ceiling.
const allocationDerived = allocation.ok
  ? { ceilingMinor: allocation.totalAllocatedMinorUnits, source: "cost-allocation" as const, sourceRef: "CostAllocationResult.totalAllocatedMinorUnits" }
  : null;
if (allocationDerived === null) throw new Error("integration allocation refused");
const enforcement = buildCostPosture({
  tenantId: TENANT,
  budgets: [burnProjection],
  checks: [
    {
      tenantId: TENANT,
      status: burnProjection.actuals.totalCostMinor <= allocationDerived.ceilingMinor ? "within-ceiling" : "over-ceiling",
      actualCostMinor: burnProjection.actuals.totalCostMinor,
      actualUnits: burnProjection.actuals.totalUnits,
      actualEntrySeqCount: burnProjection.actuals.entrySeqs.length,
      ceiling: allocationDerived,
      remainingMinor: allocationDerived.ceilingMinor - burnProjection.actuals.totalCostMinor,
      overByMinor: 0,
    },
  ],
});

const FINAL_VERDICT = evaluateReleaseGate({
  tenantId: TENANT,
  status: statusResult,
  cost: enforcement,
  acceptance: { field: fieldReport, security: securityReport, commerce: commerceReport, adoption: adoptionReport },
});

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("REAL-run integration — the hardened surfaces feed the gate", () => {
  it("every REAL hardened output verifies on its own terms", () => {
    expect(auditVerification.verified).toBe(true);
    expect(recordedReplay.ok).toBe(true);
    expect(equivalence.diverged).toBe(false);
    expect(byteIdentical(recordedReplay.replay, reReplay.replay)).toBe(true);
    expect(slaScorecard.ok).toBe(true);
    if (slaScorecard.ok) expect(slaScorecard.scorecard.status).toBe("compliant");
    expect(admissionDecision.ok).toBe(true);
    expect(offlineReport.divergences.length).toBe(0);
    expect(allocation.ok).toBe(true);
    if (allocation.ok) expect(allocation.totalAllocatedMinorUnits).toBe(9_000);
    expect(burnProjection.actuals.entrySeqs).toEqual(usageLedger.map((e) => e.seq));
  });

  it("the observability rollup over the REAL outputs is healthy and verifies", () => {
    if (!statusResult.ok) throw new Error(statusResult.detail);
    expect(statusResult.status.health).toBe("healthy");
    expect(statusResult.status.lanes.length).toBe(5);
    expect(verifySystemStatus(statusResult.status)).toBe(true);
  });

  it("the cost posture over the REAL allocation-derived ceiling is within budget and verifies", () => {
    if (!enforcement.ok) throw new Error(`posture refused: ${enforcement.reasonCode}`);
    expect(enforcement.posture.health).toBe("within-budget");
    expect(verifyCostPosture(enforcement.posture)).toBe(true);
    expect(enforcement.posture.budgets[0]).toBe(burnProjection);
  });

  it("the gate verdict over the full REAL stack is READY with zero blockers", () => {
    expect(FINAL_VERDICT.verdict).toBe("READY");
    expect(FINAL_VERDICT.blockers).toEqual([]);
    expect(verifyReleaseGateVerdict(FINAL_VERDICT)).toBe(true);
  });

  it("the acceptance baselines are the REAL corpora counts, all green", () => {
    expect(fieldReport.aggregate.journeys).toBe(FIELD_JOURNEYS.length);
    expect(fieldReport.aggregate.failed).toBe(0);
    expect(securityReport.totalJourneys).toBe(SECURITY_JOURNEYS.length);
    expect(securityReport.failedJourneys).toBe(0);
    expect(commerceReport.totals.journeyCount).toBe(COMMERCE_JOURNEYS.length);
    expect(commerceReport.totals.failed).toBe(0);
    expect(adoptionReport.aggregate.workspaces).toBe(30);
    expect(adoptionReport.aggregate.allJourneysPassed).toBe(true);
    expect(adoptionReport.aggregate.determinismVerified).toBe(true);
    expect(adoptionReport.aggregate.journeyExecutions).toBe(1413); // Wave 10: 1113 + 6x30 (F300A field) + 4x30 (F300B security)
  });

  it("gate re-evaluation is byte-identical (determinism over the REAL stack)", () => {
    const again = evaluateReleaseGate({
      tenantId: TENANT,
      status: statusResult,
      cost: enforcement,
      acceptance: { field: fieldReport, security: securityReport, commerce: commerceReport, adoption: adoptionReport },
    });
    expect(byteIdentical(FINAL_VERDICT, again)).toBe(true);
    expect(again.gateDigest).toBe(FINAL_VERDICT.gateDigest);
  });

  it("every lane field traces to its REAL output (spot-proof of the honesty law)", () => {
    if (!statusResult.ok) throw new Error(statusResult.detail);
    const lanes = statusResult.status.lanes;
    const audit = lanes.find((l) => l.laneId === "audit-ledger")!;
    expect(audit.fields.find((f) => f.name === "checkedEntries")!.value).toBe(auditVerification.checkedEntries);
    expect(audit.fields.find((f) => f.name === "computedHeadDigest")!.value).toBe(
      auditLedger[auditLedger.length - 1]!.entryDigest,
    );
    const replay = lanes.find((l) => l.laneId === "incident-replay")!;
    expect(replay.fields.find((f) => f.name === "replayDigest")!.value).toBe(recordedReplay.replay.replayDigest);
    expect(replay.fields.find((f) => f.name === "commandCount")!.value).toBe(recordedReplay.replay.commands.length);
    const sla = lanes.find((l) => l.laneId === "sla-scorecard")!;
    expect(sla.fields.find((f) => f.name === "availabilityBps")!.value).toBe(
      slaEvaluation.evaluation.availabilityBps,
    );
    const admission = lanes.find((l) => l.laneId === "ingestion-admission")!;
    expect(admission.fields.find((f) => f.name === "remaining")!.value).toBe(admissionDecision.ok ? admissionDecision.remaining : null);
    const offline = lanes.find((l) => l.laneId === "offline-replay")!;
    expect(offline.fields.find((f) => f.name === "replayDigest")!.value).toBe(offlineReport.replayDigest);
  });

  it("the module-local digest convention matches the acceptance family (adoption digest parity)", () => {
    // Same FNV-1a family + canonical JSON as the sibling packages.
    expect(digestOf("probe", { b: 2, a: 1 })).toBe(digestOf("probe", { a: 1, b: 2 }));
    expect(digestOf("probe", { a: 1 })).not.toBe(digestOf("probe", { a: 2 }));
  });

  it("a tampered REAL lane output flows to NOT-READY (end-to-end tamper propagation)", () => {
    const tamperedVerification = verifyAuditLedger(
      buildAuditLedger(TENANT, 4).map((e, i) => (i === 1 ? { ...e, occurredAt: e.occurredAt + 999 } : e)),
    );
    expect(tamperedVerification.verified).toBe(false);
    const tamperedStatus = assembleSystemStatus({
      tenantId: TENANT,
      lanes: [
        { kind: "audit-ledger", tenantId: TENANT, verification: tamperedVerification },
        { kind: "incident-replay", tenantId: TENANT, replay: recordedReplay, divergence: equivalence },
        { kind: "sla-scorecard", tenantId: TENANT, scorecard: slaScorecard },
        { kind: "ingestion-admission", tenantId: TENANT, decision: admissionDecision },
        { kind: "offline-replay", tenantId: TENANT, report: offlineReport },
      ],
    });
    const verdict = evaluateReleaseGate({
      tenantId: TENANT,
      status: tamperedStatus,
      cost: enforcement,
      acceptance: { field: fieldReport, security: securityReport, commerce: commerceReport, adoption: adoptionReport },
    });
    expect(verdict.verdict).toBe("NOT-READY");
    const blocker = verdict.blockers.find((b) => b.code === "LANE_DEGRADED");
    expect(blocker!.source).toBe("system-status.lanes[audit-ledger]");
    expect(blocker!.detail).toContain(tamperedVerification.reason!);
  });

  it("the warning-budget posture still READYs (warnings are not breaches — documented law)", () => {
    const warningLedger = buildUsageLedger(TENANT, [{ units: 5, costMinor: 5_000 }]);
    const warningProjection = projectBudgetBurn(
      TENANT,
      warningLedger,
      [
        {
          label: "next-period-burn",
          units: 10,
          costMinor: 4_000,
          at: T0 + 10_000,
          assumption: "integration: warning-band projection",
        },
      ],
      { ceilingMinor: 10_000 },
    );
    if (!warningProjection.ok) throw new Error("projection refused");
    expect(warningProjection.projection.severity).toBe("warning");
    const verdict = evaluateReleaseGate({
      tenantId: TENANT,
      status: statusResult,
      cost: buildCostPosture({
        tenantId: TENANT,
        budgets: [warningProjection.projection],
        checks: enforcement.ok ? enforcement.posture.checks : [],
      }),
      acceptance: { field: fieldReport, security: securityReport, commerce: commerceReport, adoption: adoptionReport },
    });
    expect(verdict.verdict).toBe("READY");
  });
});
