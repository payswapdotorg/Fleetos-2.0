/**
 * @fleetos/acceptance-field — journeys: simulation-driven experiment +
 * mission replay (cross-plane structural) + handoff pair + mobile shape +
 * tenant isolation.
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import {
  AST_TRUCK,
  DEV_GATEWAY,
  DEV_MISSION,
  DEV_TELEMETRY,
  FIELD_LAB_SCENARIO,
  FIELD_LAB_WORLD,
  FOREIGN_TENANT,
  T0,
} from "../fixtures.js";

export const simulationDrivenJourney: AcceptanceJourney = {
  id: "simulation-driven-experiment",
  persona: "sim-engineer",
  capability: "simulation",
  goal: "Run a sim-worlds experiment with a fault script and read the experiment view: EXPERIMENTAL markers, world + scenario digests, byte-identical replay.",
  steps: [
    { id: "t1", summary: "run the world engine over the fault scenario", op: { kind: "sim.run-world", runId: "run-lab-02", worldId: FIELD_LAB_WORLD.worldId, steps: 6, scenarioId: FIELD_LAB_SCENARIO.scenarioId } },
    { id: "t2", summary: "run the same experiment through the kernel adapter", op: { kind: "sim.adapter-run", runId: "run-lab-02", worldId: FIELD_LAB_WORLD.worldId, scenarioId: FIELD_LAB_SCENARIO.scenarioId, steps: 6 } },
    { id: "t3", summary: "re-run the adapter experiment (replay)", op: { kind: "sim.adapter-run", runId: "run-lab-02b", worldId: FIELD_LAB_WORLD.worldId, scenarioId: FIELD_LAB_SCENARIO.scenarioId, steps: 6 } },
  ],
  assertions: [
    { id: "x1", description: "the engine run's journal verifies", reading: "t1.run.journalVerified", op: "deep-equals", expected: true },
    { id: "x2", description: "the injected fault fired in the window", reading: "t1.run.injectedFailures", op: "deep-equals", expected: 1 },
    { id: "x3", description: "the kernel output is typed EXPERIMENTAL (A11)", reading: "t2.sim.kind", op: "deep-equals", expected: "EXPERIMENTAL" },
    { id: "x4", description: "the run summary repeats the EXPERIMENTAL evidence kind", reading: "t2.sim.evidenceKind", op: "deep-equals", expected: "EXPERIMENTAL" },
    { id: "x5", description: "the output carries the world digest", reading: "t2.sim.worldDigest", op: "not-null" },
    { id: "x6", description: "the output carries the scenario digest", reading: "t2.sim.scenarioDigest", op: "not-null" },
    { id: "x7", description: "the kernel flags the run deterministic", reading: "t2.sim.deterministic", op: "deep-equals", expected: true },
    { id: "x8", description: "the experiment produced events", reading: "t2.sim.eventCount", op: "number-gte", expected: 1 },
    { id: "x9", description: "a replayed experiment is byte-identical (same canonical length)", reading: "t3.sim.canonicalLength", op: "reading-equals", expected: "t2.sim.canonicalLength" },
    { id: "x10", description: "the replayed world digest is identical", reading: "t3.sim.worldDigest", op: "reading-equals", expected: "t2.sim.worldDigest" },
  ],
};

export const missionReplayJourney: AcceptanceJourney = {
  id: "mission-replay-resume",
  persona: "fleet-operator",
  capability: "mission-replay",
  goal: "Replay an important mission: a 4-stage observation-ingestion mission suspends after stage 2; resuming NEVER re-executes the completed stages and re-issues work orders for the incomplete ones with the SAME idempotency keys.",
  steps: [
    { id: "t1", summary: "admit the asset", op: { kind: "asset.admit", assetId: AST_TRUCK, assetKind: "vehicle", displayName: "Relay Truck 07" } },
    { id: "t2", summary: "enroll the mission relay device", op: { kind: "device.enroll", deviceId: DEV_MISSION, assetId: AST_TRUCK, serial: "SN-MISS-7" } },
    {
      id: "t3",
      summary: "run stages 1-2 of the mission, then suspend (4 stages total)",
      op: { kind: "mission.run-stages", missionId: "msn_relay-replay-01", definitionId: "def-relay-batch-01", deviceId: DEV_MISSION, stageCount: 4, batchPerStage: 3, observationKind: "telemetry.mission", firstObservedAt: T0 + 1_000, stepMs: 1_000, suspendAfterStage: 2 },
    },
    { id: "t4", summary: "fold the suspended mission journal", op: { kind: "mission.fold", missionId: "msn_relay-replay-01" } },
    { id: "t5", summary: "resume the mission from the checkpoint", op: { kind: "mission.resume", missionId: "msn_relay-replay-01" } },
    { id: "t6", summary: "fold the completed mission journal", op: { kind: "mission.fold", missionId: "msn_relay-replay-01" } },
  ],
  assertions: [
    { id: "n1", description: "the initial run executed exactly the first two stages", reading: "t3.mission.executedCount", op: "deep-equals", expected: 2 },
    { id: "n2", description: "the lane state agrees: 2 stages x 3 twin revisions", reading: "t3.mission.twinRevisionCount", op: "deep-equals", expected: 6 },
    { id: "n3", description: "the suspended journal digest verifies", reading: "t3.mission.journalVerified", op: "deep-equals", expected: true },
    { id: "n4", description: "the folded view is suspended", reading: "t4.mission.state", op: "deep-equals", expected: "suspended" },
    { id: "n5", description: "stages 1-2 completed, 3-4 pending", reading: "t4.mission.stageStates", op: "deep-equals", expected: ["completed", "completed", "pending", "pending"] },
    { id: "n6", description: "only the executed stages hold work orders before resume", reading: "t4.mission.stageWorkOrderCounts", op: "deep-equals", expected: [1, 1, 0, 0] },
    { id: "n7", description: "the fold is pure (re-fold is identical)", reading: "t4.mission.foldPure", op: "deep-equals", expected: true },
    { id: "n8", description: "resume re-issued ONLY the incomplete stages", reading: "t5.mission.reissuedStages", op: "deep-equals", expected: ["stage-3", "stage-4"] },
    { id: "n9", description: "the completed stages were skipped (never re-executed)", reading: "t5.mission.skippedStages", op: "deep-equals", expected: ["stage-1", "stage-2"] },
    { id: "n10", description: "re-issued stages reuse the SAME idempotency keys", reading: "t5.mission.reissuedKeys", op: "deep-equals", expected: ["wo:msn_relay-replay-01:stage-3", "wo:msn_relay-replay-01:stage-4"] },
    { id: "n11", description: "the lane state agrees after resume: 12 twin revisions", reading: "t5.mission.twinRevisionCount", op: "deep-equals", expected: 12 },
    { id: "n12", description: "the twin head seq equals all 12 observations", reading: "t5.mission.twinLastSeq", op: "deep-equals", expected: 12 },
    { id: "n13", description: "all 12 mission observations were really admitted", reading: "t5.mission.observationCount", op: "deep-equals", expected: 12 },
    { id: "n14", description: "the resumed journal digest verifies", reading: "t5.mission.journalVerified", op: "deep-equals", expected: true },
    { id: "n15", description: "the mission completes after the resume", reading: "t6.mission.state", op: "deep-equals", expected: "completed" },
    { id: "n16", description: "every stage completed exactly once", reading: "t6.mission.stageStates", op: "deep-equals", expected: ["completed", "completed", "completed", "completed"] },
    { id: "n17", description: "NO completed stage received a second work order (never re-executed)", reading: "t6.mission.stageWorkOrderCounts", op: "deep-equals", expected: [1, 1, 1, 1] },
    { id: "n18", description: "stage keys are stable across issuance and resume", reading: "t6.mission.stageFirstKeys", op: "deep-equals", expected: ["wo:msn_relay-replay-01:stage-1", "wo:msn_relay-replay-01:stage-2", "wo:msn_relay-replay-01:stage-3", "wo:msn_relay-replay-01:stage-4"] },
    { id: "n19", description: "the final fold is still pure", reading: "t6.mission.foldPure", op: "deep-equals", expected: true },
    { id: "n20", description: "the checkpoint advanced to the last completed stage", reading: "t4.mission.lastCheckpointStage", op: "deep-equals", expected: "stage-2" },
  ],
};

export const handoffPublishJourney: AcceptanceJourney = {
  id: "handoff-field-to-operator-publish",
  persona: "field-technician",
  capability: "handoff",
  goal: "As a field technician, close the shift by publishing a digest-covered handoff of the REAL field state (findings, open case, recovery intent) to the fleet operator.",
  steps: [
    { id: "t1", summary: "admit the asset", op: { kind: "asset.admit", assetId: AST_TRUCK, assetKind: "vehicle", displayName: "Truck Alpha 01" } },
    { id: "t2", summary: "enroll the device", op: { kind: "device.enroll", deviceId: DEV_TELEMETRY, assetId: AST_TRUCK, serial: "SN-1001" } },
    { id: "t3", summary: "ingest the shift's health warnings", op: { kind: "observation.ingest-batch", deviceId: DEV_TELEMETRY, fromSeq: 1, count: 2, observationKind: "health.warn", firstObservedAt: T0 + 1_000, stepMs: 1_000 } },
    { id: "t4", summary: "triage the findings", op: { kind: "health.triage" } },
    { id: "t5", summary: "build the recovery-request intent (REAL command-intents)", op: { kind: "intent.recovery-request", deviceId: DEV_TELEMETRY } },
    { id: "t6", summary: "validate the draft against the mirrored submit boundary", op: { kind: "intent.validate" } },
    { id: "t7", summary: "open the recovery case for the operator", op: { kind: "recovery.open", caseId: "rc_handoff-0001", deviceId: DEV_TELEMETRY } },
    { id: "t8", summary: "publish the handoff carrier", op: { kind: "handoff.publish", handoffId: "hd_field-to-ops-01", fromRole: "field-technician", toRole: "fleet-operator" } },
  ],
  assertions: [
    { id: "h1", description: "the triage produced one warning finding", reading: "t4.triage.count", op: "deep-equals", expected: 1 },
    { id: "h2", description: "the recovery intent draft is digest-verified", reading: "t5.intent.digestVerified", op: "deep-equals", expected: true },
    { id: "h3", description: "the intent is a recovery request", reading: "t5.intent.kind", op: "deep-equals", expected: "recovery.request" },
    { id: "h4", description: "the draft carries the capability REQUEST (never an authorization)", reading: "t5.intent.capability", op: "deep-equals", expected: "recovery.request" },
    { id: "h5", description: "the draft validates against the mirrored submit boundary", reading: "t6.validate.ok", op: "deep-equals", expected: true },
    { id: "h6", description: "the submit projection carries the intent kind", reading: "t6.submit.kind", op: "deep-equals", expected: "recovery.request" },
    { id: "h7", description: "the recovery case opened", reading: "t7.case.state", op: "deep-equals", expected: "open" },
    { id: "h8", description: "the carrier digest verifies (chain of custody)", reading: "t8.handoff.digestVerified", op: "deep-equals", expected: true },
    { id: "h9", description: "the carrier holds the one finding", reading: "t8.handoff.findings", op: "deep-equals", expected: 1 },
    { id: "h10", description: "the carrier lists the open case", reading: "t8.handoff.openCases", op: "deep-equals", expected: ["rc_handoff-0001"] },
    { id: "h11", description: "the carrier carries the intent's idempotency key", reading: "t8.handoff.intentKey", op: "not-null" },
  ],
};

export const handoffConsumeJourney: AcceptanceJourney = {
  id: "handoff-field-to-operator-consume",
  persona: "fleet-operator",
  capability: "handoff",
  goal: "As the fleet operator, pick up the technician's handoff: verify the carrier against the SAME real state and act on it (investigate the case).",
  consumesHandoff: true,
  steps: [
    { id: "t1", summary: "consume and verify the handoff carrier", op: { kind: "handoff.consume", handoffId: "hd_field-to-ops-01" } },
    { id: "t2", summary: "act on the handoff: start investigating the case", op: { kind: "recovery.command", caseId: "rc_handoff-0001", command: "investigate", reason: "operator acknowledged the field handoff" } },
    { id: "t3", summary: "confirm the case is visible in the open-recovery timeline", op: { kind: "view.recovery-timeline", now: T0 + 10_000 } },
  ],
  assertions: [
    { id: "k1", description: "a carrier was received", reading: "t1.handoff.received", op: "deep-equals", expected: true },
    { id: "k2", description: "it is the expected handoff", reading: "t1.handoff.receivedId", op: "deep-equals", expected: "hd_field-to-ops-01" },
    { id: "k3", description: "the carrier's digest verifies on the consumer side", reading: "t1.handoff.verified", op: "deep-equals", expected: true },
    { id: "k4", description: "the operator re-derived the same field-view digest (state agreement)", reading: "t1.handoff.fieldDigestMatches", op: "deep-equals", expected: true },
    { id: "k5", description: "the findings count matches the carrier", reading: "t1.handoff.findingsMatch", op: "deep-equals", expected: true },
    { id: "k6", description: "the open case list matches the carrier", reading: "t1.handoff.casesMatch", op: "deep-equals", expected: true },
    { id: "k7", description: "the intent idempotency key matches the carrier", reading: "t1.handoff.intentKeyMatches", op: "deep-equals", expected: true },
    { id: "k8", description: "the investigation started", reading: "t2.case.state", op: "deep-equals", expected: "investigating" },
    { id: "k9", description: "the timeline shows the investigating case", reading: "t3.timeline.case0.state", op: "deep-equals", expected: "investigating" },
    { id: "k10", description: "the timeline digest verifies for the operator", reading: "t3.timeline.digestVerified", op: "deep-equals", expected: true },
  ],
};

export const mobileFieldShapeJourney: AcceptanceJourney = {
  id: "mobile-field-shape",
  persona: "field-technician",
  capability: "mobile",
  goal: "The field view is phone-shaped: every section is size-bounded, attribute excerpts are bounded, ordering is priority-first — machine-checked, not assumed.",
  steps: [
    { id: "t1", summary: "admit the asset", op: { kind: "asset.admit", assetId: AST_TRUCK, assetKind: "vehicle", displayName: "Truck Alpha 01" } },
    { id: "t2", summary: "enroll the telemetry device", op: { kind: "device.enroll", deviceId: DEV_TELEMETRY, assetId: AST_TRUCK, serial: "SN-1001" } },
    { id: "t3", summary: "enroll the gateway device", op: { kind: "device.enroll", deviceId: DEV_GATEWAY, assetId: AST_TRUCK, serial: "SN-2002" } },
    { id: "t4", summary: "four errors on the telemetry device (critical)", op: { kind: "observation.ingest-batch", deviceId: DEV_TELEMETRY, fromSeq: 1, count: 4, observationKind: "health.error", firstObservedAt: T0 + 1_000, stepMs: 1_000 } },
    { id: "t5", summary: "one warning on the gateway", op: { kind: "observation.ingest-batch", deviceId: DEV_GATEWAY, fromSeq: 1, count: 1, observationKind: "health.warn", firstObservedAt: T0 + 1_000, stepMs: 1_000 } },
    { id: "t6", summary: "two oks on the gateway", op: { kind: "observation.ingest-batch", deviceId: DEV_GATEWAY, fromSeq: 2, count: 2, observationKind: "state.ok", firstObservedAt: T0 + 2_000, stepMs: 1_000 } },
    { id: "t7", summary: "triage", op: { kind: "health.triage" } },
    { id: "t8", summary: "assemble the phone view with mobile limits", op: { kind: "view.field-mode", now: T0 + 10_000, limits: { alerts: 3, recoveries: 5, maintenance: 5, connectivity: 12, attributeKeys: 2 } } },
  ],
  assertions: [
    { id: "p1", description: "three findings across both devices", reading: "t7.triage.count", op: "deep-equals", expected: 3 },
    { id: "p2", description: "severity ordering: critical, warning, info", reading: "t7.triage.severities", op: "deep-equals", expected: ["critical", "warning", "info"] },
    { id: "p3", description: "the phone view assembled", reading: "t8.field.ok", op: "deep-equals", expected: true },
    { id: "p4", description: "MACHINE CHECK: every section is bounded within its limit", reading: "t8.field.sectionsBounded", op: "deep-equals", expected: true },
    { id: "p5", description: "MACHINE CHECK: connectivity attribute excerpts are bounded (no unbounded tables)", reading: "t8.field.connectivityAttributesBounded", op: "deep-equals", expected: true },
    { id: "p6", description: "the alerts section holds exactly its bounded entries", reading: "t8.field.alerts", op: "deep-equals", expected: 3 },
    { id: "p7", description: "no connectivity truncation under the mobile limit", reading: "t8.field.connectivityTruncated", op: "deep-equals", expected: false },
    { id: "p8", description: "every device appears in the bounded connectivity section", reading: "t8.field.connectivity", op: "deep-equals", expected: 2 },
    { id: "p9", description: "priority ordering is severity-first", reading: "t8.field.alertOrderSeverities", op: "deep-equals", expected: ["critical", "warning", "info"] },
    { id: "p10", description: "the phone view digest verifies", reading: "t8.field.digestVerified", op: "deep-equals", expected: true },
    { id: "p11", description: "unknown connectivity is declared last-known (honest mobile state)", reading: "t8.field.lastKnownSections", op: "deep-equals", expected: ["connectivity-status"] },
  ],
};

export const tenantIsolationJourney: AcceptanceJourney = {
  id: "tenant-isolation-fail-closed",
  persona: "site-manager",
  capability: "tenant-isolation",
  goal: "Tenant fail-closed everywhere: a foreign-tenant record REFUSES every read-model, cross-tenant lookups fail closed, and idempotency keys never dedup across tenants.",
  steps: [
    { id: "t1", summary: "admit the home asset", op: { kind: "asset.admit", assetId: AST_TRUCK, assetKind: "vehicle", displayName: "Truck Alpha 01" } },
    { id: "t2", summary: "enroll the home device", op: { kind: "device.enroll", deviceId: DEV_TELEMETRY, assetId: AST_TRUCK, serial: "SN-1001" } },
    { id: "t3", summary: "inject a foreign-tenant asset into the slice (the attack)", op: { kind: "slice.taint-foreign-asset", assetId: "ast_foreign-9999", tenantId: FOREIGN_TENANT } },
    { id: "t4", summary: "fleet overview must refuse the whole slice", op: { kind: "view.fleet-overview", now: T0 + 1_000 } },
    { id: "t5", summary: "field view must refuse the whole slice", op: { kind: "view.field-mode", now: T0 + 1_000 } },
    { id: "t6", summary: "health board must refuse the whole slice", op: { kind: "view.health-board", now: T0 + 1_000 } },
    { id: "t7", summary: "run the REAL cross-tenant probes", op: { kind: "tenancy.probe", deviceId: DEV_TELEMETRY, idempotencyKey: "iso-ping-01", foreignTenantId: FOREIGN_TENANT } },
    { id: "t8", summary: "issue an in-tenant command (still works after the probes)", op: { kind: "adcos.issue", deviceId: DEV_TELEMETRY, commandKind: "ping", idempotencyKey: "iso-ping-01" } },
  ],
  assertions: [
    { id: "o1", description: "the taint is in place", reading: "t3.taint.tenantId", op: "deep-equals", expected: FOREIGN_TENANT },
    { id: "o2", description: "the fleet overview REFUSES (cross-tenant-ref)", reading: "t4.overview.ok", op: "deep-equals", expected: false },
    { id: "o3", description: "the refusal code is cross-tenant-ref", reading: "t4.overview.rejected", op: "deep-equals", expected: "cross-tenant-ref" },
    { id: "o4", description: "the field view REFUSES (no partial state)", reading: "t5.field.rejected", op: "deep-equals", expected: "cross-tenant-ref" },
    { id: "o5", description: "the health board REFUSES", reading: "t6.board.rejected", op: "deep-equals", expected: "cross-tenant-ref" },
    { id: "o6", description: "the foreign tenant sees ZERO assets (tenant-scoped read)", reading: "t7.tenancy.foreignAssets", op: "deep-equals", expected: 0 },
    { id: "o7", description: "the foreign tenant's directory check fails closed (tenant-scoped registry: not found)", reading: "t7.tenancy.enrollmentOk", op: "deep-equals", expected: false },
    { id: "o7b", description: "the directory refusal is the honest not-enrolled code", reading: "t7.tenancy.enrollmentReason", op: "deep-equals", expected: "device-not-enrolled" },
    { id: "o7c", description: "the REAL checkEnrollment boundary names the tenant mismatch on the same record", reading: "t7.tenancy.mismatchReason", op: "deep-equals", expected: "device-tenant-mismatch" },
    { id: "o8", description: "cross-tenant isolation refuses (tenancy vocabulary)", reading: "t7.tenancy.isolationOk", op: "deep-equals", expected: false },
    { id: "o9", description: "the isolation refusal names cross-tenant-forbidden", reading: "t7.tenancy.isolationReason", op: "deep-equals", expected: "cross-tenant-forbidden" },
    { id: "o10", description: "the same idempotency key under a foreign tenant is a SEPARATE command (no cross-tenant dedup)", reading: "t7.tenancy.adcosKeySeparated", op: "deep-equals", expected: true },
    { id: "o11", description: "a malformed tenant context is refused by identity", reading: "t7.tenancy.tenantContextOk", op: "deep-equals", expected: false },
    { id: "o12", description: "the malformed context refusal names the malformed tenant id", reading: "t7.tenancy.tenantContextReason", op: "deep-equals", expected: "malformed-tenant-id" },
    { id: "o13", description: "the in-tenant command still issues fine", reading: "t8.cmd.duplicate", op: "deep-equals", expected: false },
  ],
};
