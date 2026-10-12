/**
 * @fleetos/acceptance-field — journeys: investigation (sim-driven fault) +
 * recovery lifecycle + maintenance board.
 */

import type { AcceptanceJourney, EpochExpectation } from "../journey-contracts.js";
import { EPOCH_ANCHOR_0, EPOCH_ANCHOR_1, EPOCH_ANCHOR_2, EPOCH_30D_MS } from "../epoch-schedule.js";
import { AST_TRAILER, AST_TRUCK, DEV_GATEWAY, DEV_SIM_A, DEV_SIM_B, DEV_TELEMETRY, FIELD_LAB_SCENARIO, FIELD_LAB_WORLD, T0 } from "../fixtures.js";

/** D9 frozen anchors (TL-owned values — never lane-chosen). */
const ANCHORS = [EPOCH_ANCHOR_0, EPOCH_ANCHOR_1, EPOCH_ANCHOR_2] as const;

/** D10(1) per-epoch table helper — anchor-ordered (the single-valued expected
 * must equal the anchor-0 entry; the epoch runner enforces it). */
function epochTable(at0: unknown, at1: unknown, at2: unknown): readonly EpochExpectation[] {
  return [
    { at: EPOCH_ANCHOR_0, expected: at0 },
    { at: EPOCH_ANCHOR_1, expected: at1 },
    { at: EPOCH_ANCHOR_2, expected: at2 },
  ];
}

/** The late-quarter review moment: T0+60d, the midpoint of the +30d/+90d
 * epoch anchors (a fixed calendar fact, independent of the epoch). */
const LATE_REVIEW_AT = T0 + 2 * EPOCH_30D_MS;
/** The case-SLA policy for the late review: fresh ≤15d open, stale ≤45d. */
const CASE_SLA_THRESHOLDS = { freshWithinMs: EPOCH_30D_MS / 2, staleWithinMs: (3 * EPOCH_30D_MS) / 2 } as const;

export const investigateFaultJourney: AcceptanceJourney = {
  id: "investigate-injected-fault",
  persona: "site-manager",
  capability: "investigation",
  goal: "Investigate a problem: an injected pump fault surfaces as observations, a triage finding, and the top alert of the field priority queue.",
  steps: [
    { id: "t1", summary: "admit the pump asset", op: { kind: "asset.admit", assetId: "ast_pump-alpha-01", assetKind: "fixed", displayName: "Lab Pump Alpha" } },
    { id: "t2", summary: "admit the valve asset", op: { kind: "asset.admit", assetId: "ast_valve-beta-02", assetKind: "sensor", displayName: "Lab Valve Beta" } },
    { id: "t3", summary: "enroll the pump's simulation device", op: { kind: "device.enroll", deviceId: DEV_SIM_A, assetId: "ast_pump-alpha-01", serial: "SN-SIM-A1" } },
    { id: "t4", summary: "enroll the valve's simulation device", op: { kind: "device.enroll", deviceId: DEV_SIM_B, assetId: "ast_valve-beta-02", serial: "SN-SIM-B2" } },
    { id: "t5", summary: "run the fleet world with the fault scenario (pump fails at step 4, link out 6..8)", op: { kind: "sim.run-world", runId: "run-lab-01", worldId: FIELD_LAB_WORLD.worldId, steps: 8, scenarioId: FIELD_LAB_SCENARIO.scenarioId } },
    { id: "t6", summary: "ingest the emitted observations through the REAL pipeline", op: { kind: "sim.ingest-emissions", runId: "run-lab-01" } },
    { id: "t7", summary: "triage the observations (System 1)", op: { kind: "health.triage" } },
    { id: "t8", summary: "open the field view priority queue", op: { kind: "view.field-mode", now: 12_000 } },
  ],
  assertions: [
    { id: "i1", description: "the world run emitted its journal and it verifies", reading: "t5.run.journalVerified", op: "deep-equals", expected: true },
    { id: "i2", description: "the injected asset failure fired (cause injected)", reading: "t5.run.injectedFailures", op: "deep-equals", expected: 1 },
    { id: "i3", description: "the world produced observation events", reading: "t5.run.emissions", op: "number-gte", expected: 1 },
    { id: "i4", description: "the emissions were ingested by the real pipeline", reading: "t6.emissions.ingested", op: "number-gte", expected: 1 },
    { id: "i5", description: "no emission was refused by the pipeline", reading: "t6.emissions.refused", op: "deep-equals", expected: 0 },
    { id: "i6", description: "triage produced findings from the fault stream", reading: "t7.triage.count", op: "deep-equals", expected: 1 },
    { id: "i7", description: "3+ fault occurrences escalated to critical severity", reading: "t7.triage.severities", op: "deep-equals", expected: ["critical"] },
    { id: "i8", description: "triage degrades honestly on unknown telemetry vocabulary", reading: "t7.triage.degradation", op: "deep-equals", expected: "unknown-signal-vocabulary" },
    { id: "i9", description: "the field view assembled", reading: "t8.field.ok", op: "deep-equals", expected: true },
    { id: "i10", description: "the fault surfaces as the top alert", reading: "t8.field.alerts", op: "deep-equals", expected: 1 },
    { id: "i11", description: "the top alert is the critical fault finding", reading: "t8.field.alert0.severity", op: "deep-equals", expected: "critical" },
    { id: "i12", description: "the alert names the fault code", reading: "t8.field.alert0.code", op: "deep-equals", expected: "event.fault" },
    { id: "i13", description: "the alert's last-known provenance classifies the finding fresh", reading: "t8.field.alert0.lastKnownStaleness", op: "deep-equals", expected: "fresh" },
    { id: "i14", description: "alerts are priority ordered (severity first)", reading: "t8.field.alertOrderIsPriority", op: "deep-equals", expected: true },
    { id: "i15", description: "unknown connectivity is declared a last-known section (honest)", reading: "t8.field.lastKnownSections", op: "deep-equals", expected: ["connectivity-status"] },
    { id: "i16", description: "the field view digest verifies", reading: "t8.field.digestVerified", op: "deep-equals", expected: true },
  ],
};

/**
 * F331A (Wave 13 lane A) — the D8 echo-class REWRITE of
 * `recover-lost-device` (census: "echo (strict T0 pin) | ALL Δ incl. ±1s |
 * absolute timestamp pin"; F330 §1.1). The absolute-timestamp pin (the old
 * r10 `ageMs == 20_000` arithmetic echo) is REPLACED by genuine D2(b)-family
 * transition expectations on the SAME domain API surface (the recovery
 * case lifecycle + the open-recovery timeline read-model):
 *
 *   - window boundary open/close — the timeline is AS-OF its `now`: at the
 *     fixed review moments (T0+10s/20s/30s on the quarter calendar) the
 *     epoch's case appears only when its existence window has opened
 *     (openedAt <= now);
 *   - staleness-class transition — the late-quarter review (T0+60d) classifies
 *     the still-open tracking case fresh/stale/unknown under the case-SLA
 *     policy thresholds (a REAL read-model parameter), which lands the three
 *     frozen epochs in three distinct classes (unknown / stale / not-yet-open).
 *
 * All non-time assertions (r1–r9, r11–r18) are intact; r3/r8/r9 gained
 * per-epoch tables because the as-of window responds across the frozen
 * schedule. The per-epoch tables carry NO timestamp-equality pins.
 */
export const recoverDeviceJourney: AcceptanceJourney = {
  id: "recover-lost-device",
  persona: "recovery-coordinator",
  capability: "recovery",
  goal: "Recover a degraded device: open a case, investigate, propose, resolve with evidence — the open-recovery timeline shows the case while open, completes it after resolution, and the late-quarter review classifies the still-open tracking case honestly.",
  epochs: {
    censusCitation: "F330 §1.1: recover-lost-device | echo (strict T0 pin) | ALL Δ incl. ±1s | absolute timestamp pin — REWRITTEN per the D8 rule (as-of window boundary + case staleness class)",
    anchors: ANCHORS,
  },
  steps: [
    { id: "t1", summary: "admit the asset", op: { kind: "asset.admit", assetId: AST_TRUCK, assetKind: "vehicle", displayName: "Truck Alpha 01" } },
    { id: "t2", summary: "enroll the device", op: { kind: "device.enroll", deviceId: DEV_TELEMETRY, assetId: AST_TRUCK, serial: "SN-1001" } },
    { id: "t3", summary: "ingest two health warnings (evidence for the case)", op: { kind: "observation.ingest-batch", deviceId: DEV_TELEMETRY, fromSeq: 1, count: 2, observationKind: "health.warn", firstObservedAt: T0 + 1_000, stepMs: 1_000 } },
    { id: "t4", summary: "triage the observations into findings", op: { kind: "health.triage" } },
    { id: "t5", summary: "open the recovery case", op: { kind: "recovery.open", caseId: "rc_recover-0001", deviceId: DEV_TELEMETRY } },
    { id: "t6", summary: "timeline: the open case appears", op: { kind: "view.recovery-timeline", now: T0 + 10_000 } },
    { id: "t7", summary: "start investigating (reason required)", op: { kind: "recovery.command", caseId: "rc_recover-0001", command: "investigate", reason: "battery drain reported by field tech" } },
    { id: "t8", summary: "timeline: the investigating case shows its step", op: { kind: "view.recovery-timeline", now: T0 + 20_000 } },
    { id: "t9", summary: "propose the replacement", op: { kind: "recovery.command", caseId: "rc_recover-0001", command: "propose", reason: "replace battery pack" } },
    {
      id: "t10",
      summary: "resolve WITH evidence from the triage findings",
      op: { kind: "recovery.command", caseId: "rc_recover-0001", command: "resolve", reason: "battery replaced and verified", withEvidence: true },
    },
    { id: "t11", summary: "timeline: the resolved case is terminal and excluded", op: { kind: "view.recovery-timeline", now: T0 + 30_000 } },
    {
      id: "t12",
      summary: "resolve without evidence must be refused (already resolved + evidence law)",
      expectRefusal: true,
      op: { kind: "recovery.command", caseId: "rc_recover-0001", command: "resolve", reason: "double resolve" },
    },
    { id: "t13", summary: "close the completed case", op: { kind: "recovery.command", caseId: "rc_recover-0001", command: "close", reason: "service record archived" } },
    { id: "t14", summary: "the battery degradation recurs — open a tracking case for the same device", op: { kind: "recovery.open", caseId: "rc_recover-0002", deviceId: DEV_TELEMETRY } },
    { id: "t15", summary: "start investigating the tracking case (it stays open at journey end)", op: { kind: "recovery.command", caseId: "rc_recover-0002", command: "investigate", reason: "second battery drain report within the quarter" } },
    {
      id: "t16",
      summary: "late-quarter review (T0+60d, the midpoint of the +30d/+90d epoch anchors) under the case-SLA policy: fresh ≤15d open, stale ≤45d",
      op: {
        kind: "view.recovery-timeline",
        now: LATE_REVIEW_AT,
        thresholds: CASE_SLA_THRESHOLDS,
      },
    },
  ],
  assertions: [
    { id: "r1", description: "triage produced a warning finding (2 occurrences < escalation threshold)", reading: "t4.triage.severities", op: "deep-equals", expected: ["warning"] },
    { id: "r2", description: "the case opens in state open", reading: "t5.case.state", op: "deep-equals", expected: "open" },
    {
      id: "r3",
      description: "the timeline shows exactly one open case (as-of the fixed review moment — the epoch's case appears only once its existence window has opened)",
      reading: "t6.timeline.open",
      op: "deep-equals",
      expected: 1,
      perEpoch: epochTable(1, 0, 0),
    },
    { id: "r4", description: "the case appears with zero history steps at open", reading: "t6.timeline.case0.steps", op: "deep-equals", expected: 0 },
    { id: "r5", description: "the timeline digest verifies", reading: "t6.timeline.digestVerified", op: "deep-equals", expected: true },
    { id: "r6", description: "investigate moved the case to investigating", reading: "t7.case.state", op: "deep-equals", expected: "investigating" },
    { id: "r7", description: "the case history has one step", reading: "t7.case.historyLength", op: "deep-equals", expected: 1 },
    {
      id: "r8",
      description: "the timeline shows the investigating state (as-of window)",
      reading: "t8.timeline.case0.state",
      op: "deep-equals",
      expected: "investigating",
      perEpoch: epochTable("investigating", null, null),
    },
    {
      id: "r9",
      description: "the timeline step list carries the investigate command (as-of window)",
      reading: "t8.timeline.case0.stepCommands",
      op: "deep-equals",
      expected: ["investigate"],
      perEpoch: epochTable(["investigate"], [], []),
    },
    {
      id: "r10",
      description: "the case's staleness class is accounted against the view's as-of (D2(b) staleness family — replaces the former absolute age pin)",
      reading: "t8.timeline.case0.staleness",
      op: "deep-equals",
      expected: "fresh",
      perEpoch: epochTable("fresh", null, null),
    },
    { id: "r11", description: "propose moved the case to proposal", reading: "t9.case.state", op: "deep-equals", expected: "proposal" },
    { id: "r12", description: "resolve completed the case", reading: "t10.case.state", op: "deep-equals", expected: "resolved" },
    { id: "r13", description: "the resolution carries the root cause", reading: "t10.case.resolutionRootCause", op: "deep-equals", expected: "battery replaced and verified" },
    { id: "r14", description: "resolution attached the finding evidence", reading: "t10.case.evidenceCount", op: "deep-equals", expected: 1 },
    { id: "r15", description: "the resolved case left the open timeline", reading: "t11.timeline.open", op: "deep-equals", expected: 0 },
    { id: "r16", description: "no case ids remain on the open board", reading: "t11.timeline.caseIds", op: "deep-equals", expected: [] },
    { id: "r17", description: "re-resolving a resolved case without evidence is refused (evidence law precedes the state law)", reading: "t12.case.refused", op: "deep-equals", expected: "missing-evidence" },
    { id: "r18", description: "close archived the case", reading: "t13.case.state", op: "deep-equals", expected: "closed" },
    { id: "r18b", description: "the tracking case opened in state open", reading: "t14.case.state", op: "deep-equals", expected: "open" },
    { id: "r18c", description: "the tracking case is under investigation at journey end", reading: "t15.case.state", op: "deep-equals", expected: "investigating" },
    {
      id: "r19",
      description: "late-quarter review: the still-open tracking case is on the as-of board at T0 and +30d; at +90d its window has not opened (staleness-class transition + window boundary)",
      reading: "t16.timeline.open",
      op: "deep-equals",
      expected: 1,
      perEpoch: epochTable(1, 1, 0),
    },
    {
      id: "r20",
      description: "late-quarter review: the board's case is the tracking case (the resolved pair is terminal and excluded)",
      reading: "t16.timeline.case0.caseId",
      op: "deep-equals",
      expected: "rc_recover-0002",
      perEpoch: epochTable("rc_recover-0002", "rc_recover-0002", null),
    },
    {
      id: "r21",
      description: "late-quarter review: the case's staleness class under the case-SLA policy — 60d-old (unknown) at T0, 30d-old (stale) at +30d, not-yet-open at +90d (three distinct D2(b) classes)",
      reading: "t16.timeline.case0.staleness",
      op: "deep-equals",
      expected: "unknown",
      perEpoch: epochTable("unknown", "stale", null),
    },
    { id: "r22", description: "the late-quarter board's digest verifies", reading: "t16.timeline.digestVerified", op: "deep-equals", expected: true },
  ],
};

/**
 * F331A (Wave 13 lane A) — D8 count-eligible parameterization (census:
 * "transition (forward) | +1d and beyond | maintenance window/deadline";
 * F330 §1.1). The responding assertion is m1 — the REAL domain
 * `nextRun(schedule, now)` computation: the plan's next service boundary on
 * the fixed T0 calendar. Across the frozen schedule the plan's position
 * transitions pre-start (epoch 1: next run is the plan's start) to
 * in-cycle (epochs 2/3: next run is the next daily boundary AT the anchor),
 * so the asserted reading differs genuinely per epoch. All other readings
 * (board columns at the journey's fixed board moments) are invariant.
 */
export const maintainAssetJourney: AcceptanceJourney = {
  id: "maintain-asset-schedule",
  persona: "maintenance-planner",
  capability: "maintenance",
  goal: "Schedule maintenance through the real maintenance API and see the order move across the maintenance board columns to completion.",
  epochs: {
    censusCitation: "F330 §1.1: maintain-asset-schedule | transition (forward) | +1d and beyond | maintenance window/deadline",
    anchors: ANCHORS,
  },
  steps: [
    { id: "t1", summary: "admit the conveyor asset", op: { kind: "asset.admit", assetId: AST_TRAILER, assetKind: "fixed", displayName: "Conveyor Gamma 03" } },
    { id: "t2", summary: "enroll its gateway device", op: { kind: "device.enroll", deviceId: DEV_GATEWAY, assetId: AST_TRAILER, serial: "SN-2002" } },
    { id: "t3", summary: "declare the preventive service plan (recurring daily)", op: { kind: "maintenance.plan", planId: "plan_q3-service-01", assetId: AST_TRAILER, planKind: "preventive", schedule: { kind: "recurring", intervalMs: 86_400_000, startsAt: T0 + 86_400_000 } } },
    { id: "t4", summary: "create the first maintenance order", op: { kind: "maintenance.order", orderId: "mo_service-0001", planId: "plan_q3-service-01", assignedTo: "tech-ada" } },
    { id: "t5", summary: "create a second order to cancel later", op: { kind: "maintenance.order", orderId: "mo_service-0002", planId: "plan_q3-service-01" } },
    { id: "t6", summary: "board: both orders are scheduled", op: { kind: "view.maintenance-board", now: T0 + 3_600_000 } },
    { id: "t7", summary: "start the first order", op: { kind: "maintenance.command", orderId: "mo_service-0001", command: "start" } },
    { id: "t8", summary: "board: the first order is in progress", op: { kind: "view.maintenance-board", now: T0 + 3_700_000 } },
    {
      id: "t9",
      summary: "complete an in-progress order that was never started must be refused",
      expectRefusal: true,
      op: { kind: "maintenance.command", orderId: "mo_service-0002", command: "complete" },
    },
    { id: "t10", summary: "complete the first order", op: { kind: "maintenance.command", orderId: "mo_service-0001", command: "complete" } },
    { id: "t11", summary: "cancel the second order with a reason", op: { kind: "maintenance.command", orderId: "mo_service-0002", command: "cancel", reason: "superseded by the completed service" } },
    { id: "t12", summary: "board: completed + cancelled columns and the upcoming plan run", op: { kind: "view.maintenance-board", now: T0 + 3_800_000 } },
  ],
  assertions: [
    {
      id: "m1",
      description: "the plan's next run is computed by the domain schedule (pre-start at T0; the next daily boundary at the later anchors — the census-certified maintenance window/deadline response)",
      reading: "t3.plan.nextRunAt",
      op: "deep-equals",
      expected: T0 + 86_400_000,
      perEpoch: epochTable(T0 + 86_400_000, EPOCH_ANCHOR_1 + 86_400_000, EPOCH_ANCHOR_2 + 86_400_000),
    },
    { id: "m2", description: "orders are created in the scheduled state", reading: "t4.order.state", op: "deep-equals", expected: "scheduled" },
    { id: "m3", description: "board: two scheduled orders", reading: "t6.mboard.scheduled", op: "deep-equals", expected: 2 },
    { id: "m4", description: "board: nothing in progress yet", reading: "t6.mboard.inProgress", op: "deep-equals", expected: 0 },
    { id: "m5", description: "board digest verifies", reading: "t6.mboard.digestVerified", op: "deep-equals", expected: true },
    { id: "m6", description: "start moved the order to in-progress", reading: "t7.order.state", op: "deep-equals", expected: "in-progress" },
    { id: "m7", description: "board: one in progress, one still scheduled", reading: "t8.mboard.inProgress", op: "deep-equals", expected: 1 },
    { id: "m8", description: "board: the scheduled column is down to one", reading: "t8.mboard.scheduled", op: "deep-equals", expected: 1 },
    { id: "m9", description: "completing a scheduled (not started) order is refused", reading: "t9.order.refused", op: "deep-equals", expected: "illegal-transition" },
    { id: "m10", description: "complete finished the order", reading: "t10.order.state", op: "deep-equals", expected: "completed" },
    { id: "m11", description: "cancel recorded its reason", reading: "t11.order.cancelledReason", op: "deep-equals", expected: "superseded by the completed service" },
    { id: "m12", description: "board: one completed order", reading: "t12.mboard.completed", op: "deep-equals", expected: 1 },
    { id: "m13", description: "board: one cancelled order", reading: "t12.mboard.cancelled", op: "deep-equals", expected: 1 },
    { id: "m14", description: "board: the scheduled column is empty", reading: "t12.mboard.scheduled", op: "deep-equals", expected: 0 },
    { id: "m15", description: "the upcoming plan run surfaces on the board", reading: "t12.mboard.upcoming", op: "deep-equals", expected: ["plan_q3-service-01"] },
    { id: "m16", description: "the upcoming next run is the daily schedule's start", reading: "t12.mboard.upcoming0.nextRunAt", op: "deep-equals", expected: T0 + 86_400_000 },
    { id: "m17", description: "the final board digest verifies", reading: "t12.mboard.digestVerified", op: "deep-equals", expected: true },
  ],
};
