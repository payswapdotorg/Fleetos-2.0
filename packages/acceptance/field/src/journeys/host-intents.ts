/**
 * @fleetos/acceptance-field — journeys: host intent -> execution ->
 * verification (F300A). The end-to-end device command journeys: a UI
 * intent on the host surface builds an inert CommandDraft, the mirrored
 * submit boundary validates it, the REAL domain command path executes
 * the approved recovery/maintenance command, and the host view models
 * verify the recorded outcome.
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { AST_TRAILER, AST_TRUCK, DEV_GATEWAY, DEV_TELEMETRY, T0 } from "../fixtures.js";

export const hostRecoveryIntentToVerificationJourney: AcceptanceJourney = {
  id: "host-recovery-intent-to-verification",
  persona: "fleet-operator",
  capability: "host-integration",
  goal: "From Device 360's request-recovery UI intent to a VERIFIED resolution: inert draft -> mirrored submit boundary -> real recovery command path -> outcome verified through both the host view models and the lane's own timeline read-model.",
  steps: [
    { id: "t1", summary: "admit the asset", op: { kind: "asset.admit", assetId: AST_TRUCK, assetKind: "vehicle", displayName: "Truck Alpha 01" } },
    { id: "t2", summary: "enroll the device", op: { kind: "device.enroll", deviceId: DEV_TELEMETRY, assetId: AST_TRUCK, serial: "SN-1001" } },
    { id: "t3", summary: "ingest two health warnings", op: { kind: "observation.ingest-batch", deviceId: DEV_TELEMETRY, fromSeq: 1, count: 2, observationKind: "health.warn", firstObservedAt: T0 + 1_000, stepMs: 1_000 } },
    { id: "t4", summary: "triage the findings", op: { kind: "health.triage" } },
    { id: "t5", summary: "Device 360 shows the degraded posture (the intent's trigger)", op: { kind: "host.build-view-models", now: T0 + 5_000 } },
    { id: "t6", summary: "fire the Device 360 request-recovery UI intent", op: { kind: "host.intent-draft", event: "device-360:request-recovery", role: "fleet-operator", deviceId: DEV_TELEMETRY, reason: "host: request recovery from Device 360" } },
    { id: "t7", summary: "validate the draft against the mirrored submit boundary", op: { kind: "intent.validate" } },
    { id: "t8", summary: "execute the approved intent on the real command path (open the case)", op: { kind: "recovery.open", caseId: "rc_host-ui-0001", deviceId: DEV_TELEMETRY } },
    { id: "t9", summary: "investigate the case", op: { kind: "recovery.command", caseId: "rc_host-ui-0001", command: "investigate", reason: "operator acknowledged the Device 360 intent" } },
    { id: "t10", summary: "propose the resolution path", op: { kind: "recovery.command", caseId: "rc_host-ui-0001", command: "propose", reason: "replace battery pack" } },
    { id: "t11", summary: "resolve WITH evidence from the triage findings", op: { kind: "recovery.command", caseId: "rc_host-ui-0001", command: "resolve", reason: "battery replaced and verified", withEvidence: true } },
    { id: "t12", summary: "verification: rebuild the host view models over the resolved state", op: { kind: "host.build-view-models", now: T0 + 30_000 } },
    { id: "t13", summary: "independent verification: the lane's own timeline read-model agrees", op: { kind: "view.recovery-timeline", now: T0 + 30_000 } },
  ],
  assertions: [
    { id: "v1", description: "Device 360 showed the warning posture before the intent", reading: "t5.host.device360.sheet0.posture", op: "deep-equals", expected: "warning" },
    { id: "v2", description: "the host bundle assembled (purity held at the trigger)", reading: "t5.host.pure", op: "deep-equals", expected: true },
    { id: "v3", description: "the UI intent built a recovery.request draft", reading: "t6.intent.kind", op: "deep-equals", expected: "recovery.request" },
    { id: "v4", description: "the draft carries the capability REQUEST (never an authorization)", reading: "t6.intent.capability", op: "deep-equals", expected: "recovery.request" },
    { id: "v5", description: "the intent fired from the device-360 route", reading: "t6.intent.routeId", op: "deep-equals", expected: "device-360" },
    { id: "v6", description: "the draft validates against the mirrored submit boundary", reading: "t7.validate.ok", op: "deep-equals", expected: true },
    { id: "v7", description: "the submit projection carries the intent kind", reading: "t7.submit.kind", op: "deep-equals", expected: "recovery.request" },
    { id: "v8", description: "the case opened on the real command path", reading: "t8.case.state", op: "deep-equals", expected: "open" },
    { id: "v9", description: "investigation moved the case", reading: "t9.case.state", op: "deep-equals", expected: "investigating" },
    { id: "v10", description: "the proposal moved the case to proposal", reading: "t10.case.state", op: "deep-equals", expected: "proposal" },
    { id: "v11", description: "the evidence-backed resolution completed the case", reading: "t11.case.state", op: "deep-equals", expected: "resolved" },
    { id: "v12", description: "the resolution attached the finding evidence", reading: "t11.case.evidenceCount", op: "deep-equals", expected: 1 },
    { id: "v13", description: "VERIFICATION: the host timeline shows no open case after resolution", reading: "t12.host.recoveryTimeline.open", op: "deep-equals", expected: 0 },
    { id: "v14", description: "the verification rebuild is byte-identical (pure law held)", reading: "t12.host.pure", op: "deep-equals", expected: true },
    { id: "v15", description: "the verification rebuild's digest verifies", reading: "t12.host.digestVerified", op: "deep-equals", expected: true },
    { id: "v16", description: "the lane's own timeline read-model AGREES (no second truth)", reading: "t13.timeline.open", op: "deep-equals", expected: 0 },
    { id: "v17", description: "the lane timeline's digest verifies too", reading: "t13.timeline.digestVerified", op: "deep-equals", expected: true },
  ],
};

export const hostMaintenanceIntentToVerificationJourney: AcceptanceJourney = {
  id: "host-maintenance-intent-to-verification",
  persona: "maintenance-planner",
  capability: "host-integration",
  goal: "From Device 360's schedule-maintenance UI intent to a VERIFIED completed order: inert draft -> mirrored submit boundary -> real maintenance plan/order command path -> the maintenance board verifies the completed state and upcoming run.",
  steps: [
    { id: "t1", summary: "admit the conveyor asset", op: { kind: "asset.admit", assetId: AST_TRAILER, assetKind: "fixed", displayName: "Conveyor Beta 02" } },
    { id: "t2", summary: "enroll its gateway device", op: { kind: "device.enroll", deviceId: DEV_GATEWAY, assetId: AST_TRAILER, serial: "SN-2002" } },
    { id: "t3", summary: "fire the Device 360 schedule-maintenance UI intent", op: { kind: "host.intent-draft", event: "device-360:schedule-maintenance", role: "maintenance-planner", assetId: AST_TRAILER, planId: "plan_host-pm-01", schedule: { kind: "recurring", intervalMs: 86_400_000, startsAt: T0 + 86_400_000 }, reason: "host: schedule preventive maintenance from Device 360" } },
    { id: "t4", summary: "validate the draft against the mirrored submit boundary", op: { kind: "intent.validate" } },
    { id: "t5", summary: "execute the intent on the real command path (declare the plan)", op: { kind: "maintenance.plan", planId: "plan_host-pm-01", assetId: AST_TRAILER, planKind: "preventive", schedule: { kind: "recurring", intervalMs: 86_400_000, startsAt: T0 + 86_400_000 } } },
    { id: "t6", summary: "create the maintenance order", op: { kind: "maintenance.order", orderId: "mo_host-svc-0001", planId: "plan_host-pm-01", assignedTo: "tech-ada" } },
    { id: "t7", summary: "start the order", op: { kind: "maintenance.command", orderId: "mo_host-svc-0001", command: "start" } },
    { id: "t8", summary: "complete the order", op: { kind: "maintenance.command", orderId: "mo_host-svc-0001", command: "complete" } },
    { id: "t9", summary: "verification: rebuild the host view models over the completed state", op: { kind: "host.build-view-models", now: T0 + 3_600_000 } },
  ],
  assertions: [
    { id: "w1", description: "the UI intent built a maintenance.schedule draft", reading: "t3.intent.kind", op: "deep-equals", expected: "maintenance.schedule" },
    { id: "w2", description: "the draft carries the capability REQUEST", reading: "t3.intent.capability", op: "deep-equals", expected: "maintenance.schedule" },
    { id: "w3", description: "the draft validates against the mirrored submit boundary", reading: "t4.validate.ok", op: "deep-equals", expected: true },
    { id: "w4", description: "the submit projection carries the intent kind", reading: "t4.submit.kind", op: "deep-equals", expected: "maintenance.schedule" },
    { id: "w5", description: "the real plan's next run is the domain schedule's start", reading: "t5.plan.nextRunAt", op: "deep-equals", expected: T0 + 86_400_000 },
    { id: "w6", description: "the order was created scheduled", reading: "t6.order.state", op: "deep-equals", expected: "scheduled" },
    { id: "w7", description: "start moved the order to in-progress", reading: "t7.order.state", op: "deep-equals", expected: "in-progress" },
    { id: "w8", description: "complete finished the order", reading: "t8.order.state", op: "deep-equals", expected: "completed" },
    { id: "w9", description: "VERIFICATION: the host maintenance board shows the completed order", reading: "t9.host.maintenanceBoard.completed", op: "deep-equals", expected: 1 },
    { id: "w10", description: "the scheduled column is empty after completion", reading: "t9.host.maintenanceBoard.scheduled", op: "deep-equals", expected: 0 },
    { id: "w11", description: "the upcoming plan run surfaces on the board", reading: "t9.host.maintenanceBoard.upcoming", op: "deep-equals", expected: ["plan_host-pm-01"] },
    { id: "w12", description: "the upcoming next run is the daily schedule's start", reading: "t9.host.maintenanceBoard.upcoming0.nextRunAt", op: "deep-equals", expected: T0 + 86_400_000 },
    { id: "w13", description: "the field workflow's next-maintenance section carries the plan", reading: "t9.host.fieldWorkflow.maintenance", op: "deep-equals", expected: 1 },
    { id: "w14", description: "the Device 360 route honestly marks offline write-sync NOT implemented", reading: "t9.host.markers.device360", op: "includes", expected: "offline-write-sync:not-implemented" },
    { id: "w15", description: "the verification rebuild is byte-identical (pure law held)", reading: "t9.host.pure", op: "deep-equals", expected: true },
    { id: "w16", description: "the verification rebuild's digest verifies", reading: "t9.host.digestVerified", op: "deep-equals", expected: true },
  ],
};
