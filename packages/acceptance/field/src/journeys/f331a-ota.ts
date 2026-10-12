/**
 * @fleetos/acceptance-field — F331A journey: the edge firmware / OTA
 * campaign (Wave 13 lane A, work-item row 39).
 *
 * The REAL capability package is @fleetos/maintenance's firmware-campaign
 * module (`packages/maintenance/src/firmware-campaign.ts`): staged campaign
 * waves (one wave at a time, each fully accounted before the next starts),
 * halt (reason required, freezes the campaign), resume (restores the
 * pre-halt sub-state), and rollback (only after a halt, only over devices
 * that actually applied — the rollback wave). The journey drives the REAL
 * public APIs end-to-end with positive, refusal and determinism assertions.
 *
 * Vocabulary law: persona `edge-operator` + capability `maintenance` (the
 * frozen 14-capability vocabulary's maintenance family — a firmware
 * campaign is scheduled maintenance of the device fleet, in staged waves).
 * No vocabulary change was made (F321A precedent).
 */

import type { AcceptanceJourney } from "../journey-contracts.js";
import { AST_TRUCK, DEV_GATEWAY, DEV_MISSION, DEV_TELEMETRY } from "../fixtures.js";

export const edgeFirmwareOtaCampaignJourney: AcceptanceJourney = {
  id: "edge-firmware-ota-campaign",
  persona: "edge-operator",
  capability: "maintenance",
  goal: "Roll device firmware out in staged campaign waves through the real OTA campaign API: declare, announce, run the canary, halt on a regression, resume, run the fleet wave, halt mid-wave and roll the applied devices back — with every illegal move refused.",
  steps: [
    { id: "t1", summary: "admit the fleet's truck asset", op: { kind: "asset.admit", assetId: AST_TRUCK, assetKind: "vehicle", displayName: "Truck Alpha 01" } },
    { id: "t2", summary: "enroll the telemetry device", op: { kind: "device.enroll", deviceId: DEV_TELEMETRY, assetId: AST_TRUCK, serial: "SN-1001" } },
    { id: "t3", summary: "enroll the gateway device (the canary cohort)", op: { kind: "device.enroll", deviceId: DEV_GATEWAY, assetId: AST_TRUCK, serial: "SN-2002" } },
    { id: "t4", summary: "enroll the mission relay device (the fleet cohort)", op: { kind: "device.enroll", deviceId: DEV_MISSION, assetId: AST_TRUCK, serial: "SN-3003" } },
    {
      id: "t5",
      summary: "declare the staged firmware campaign (canary wave = gateway; fleet wave = telemetry + mission relay)",
      op: {
        kind: "ota.declare-campaign",
        campaignId: "fwc_gateway-2.4.1",
        firmwareId: "fw_edge-gateway",
        fromVersion: "2.4.0",
        toVersion: "2.4.1",
        waves: [
          { waveId: "wave-canary", deviceIds: [DEV_GATEWAY] },
          { waveId: "wave-fleet", deviceIds: [DEV_TELEMETRY, DEV_MISSION] },
        ],
      },
    },
    {
      id: "t6",
      summary: "declare a campaign that would DOWNGRADE firmware must be refused",
      expectRefusal: true,
      op: {
        kind: "ota.declare-campaign",
        campaignId: "fwc_downgrade-01",
        firmwareId: "fw_edge-gateway",
        fromVersion: "2.4.1",
        toVersion: "2.4.0",
        waves: [{ waveId: "wave-bad", deviceIds: [DEV_GATEWAY] }],
      },
    },
    {
      id: "t7",
      summary: "declare a campaign that puts one device in two waves must be refused",
      expectRefusal: true,
      op: {
        kind: "ota.declare-campaign",
        campaignId: "fwc_overlap-01",
        firmwareId: "fw_edge-gateway",
        fromVersion: "2.4.0",
        toVersion: "2.4.2",
        waves: [
          { waveId: "wave-a", deviceIds: [DEV_GATEWAY] },
          { waveId: "wave-b", deviceIds: [DEV_GATEWAY, DEV_TELEMETRY] },
        ],
      },
    },
    { id: "t8", summary: "announce the campaign to the fleet", op: { kind: "ota.announce", campaignId: "fwc_gateway-2.4.1" } },
    {
      id: "t9",
      summary: "starting the fleet wave before the canary must be refused (staged waves, never two at once)",
      expectRefusal: true,
      op: { kind: "ota.start-wave", campaignId: "fwc_gateway-2.4.1", waveId: "wave-fleet" },
    },
    { id: "t10", summary: "start the canary wave", op: { kind: "ota.start-wave", campaignId: "fwc_gateway-2.4.1", waveId: "wave-canary" } },
    {
      id: "t11",
      summary: "an outcome for a device outside the current wave must be refused",
      expectRefusal: true,
      op: { kind: "ota.device-outcome", campaignId: "fwc_gateway-2.4.1", deviceId: DEV_MISSION, ok: true },
    },
    {
      id: "t12",
      summary: "halting without a reason must be refused (accountability law)",
      expectRefusal: true,
      op: { kind: "ota.halt", campaignId: "fwc_gateway-2.4.1" },
    },
    { id: "t13", summary: "halt the campaign: field reports of battery drain on 2.4.1 gateways", op: { kind: "ota.halt", campaignId: "fwc_gateway-2.4.1", reason: "canary battery regression reported" } },
    {
      id: "t14",
      summary: "a device outcome while halted must be refused (the campaign is frozen)",
      expectRefusal: true,
      op: { kind: "ota.device-outcome", campaignId: "fwc_gateway-2.4.1", deviceId: DEV_GATEWAY, ok: true },
    },
    {
      id: "t15",
      summary: "rolling back with nothing applied yet must be refused",
      expectRefusal: true,
      op: { kind: "ota.rollback", campaignId: "fwc_gateway-2.4.1", reason: "premature rollback" },
    },
    { id: "t16", summary: "the battery report is traced to a local charger — resume the campaign", op: { kind: "ota.resume", campaignId: "fwc_gateway-2.4.1" } },
    { id: "t17", summary: "the canary gateway applies the firmware successfully", op: { kind: "ota.device-outcome", campaignId: "fwc_gateway-2.4.1", deviceId: DEV_GATEWAY, ok: true } },
    { id: "t18", summary: "campaign progress: canary verified, fleet pending", op: { kind: "ota.progress", campaignId: "fwc_gateway-2.4.1" } },
    { id: "t19", summary: "start the fleet wave", op: { kind: "ota.start-wave", campaignId: "fwc_gateway-2.4.1", waveId: "wave-fleet" } },
    { id: "t20", summary: "the telemetry device applies the firmware", op: { kind: "ota.device-outcome", campaignId: "fwc_gateway-2.4.1", deviceId: DEV_TELEMETRY, ok: true } },
    {
      id: "t21",
      summary: "duplicate outcome for the same device must be refused",
      expectRefusal: true,
      op: { kind: "ota.device-outcome", campaignId: "fwc_gateway-2.4.1", deviceId: DEV_TELEMETRY, ok: true },
    },
    { id: "t22", summary: "halt mid-wave: telemetry units report sensor instability on 2.4.1", op: { kind: "ota.halt", campaignId: "fwc_gateway-2.4.1", reason: "telemetry units report sensor instability on 2.4.1" } },
    { id: "t23", summary: "roll the applied devices back to 2.4.0", op: { kind: "ota.rollback", campaignId: "fwc_gateway-2.4.1", reason: "regression triage: revert to 2.4.0" } },
    {
      id: "t24",
      summary: "a rollback report for a device that never applied must be refused",
      expectRefusal: true,
      op: { kind: "ota.device-rollback", campaignId: "fwc_gateway-2.4.1", deviceId: DEV_MISSION },
    },
    {
      id: "t25",
      summary: "starting a wave while rolling back must be refused",
      expectRefusal: true,
      op: { kind: "ota.start-wave", campaignId: "fwc_gateway-2.4.1", waveId: "wave-fleet" },
    },
    { id: "t26", summary: "the gateway confirms its rollback to 2.4.0", op: { kind: "ota.device-rollback", campaignId: "fwc_gateway-2.4.1", deviceId: DEV_GATEWAY } },
    {
      id: "t27",
      summary: "a duplicate rollback report for the same device must be refused",
      expectRefusal: true,
      op: { kind: "ota.device-rollback", campaignId: "fwc_gateway-2.4.1", deviceId: DEV_GATEWAY },
    },
    { id: "t28", summary: "the telemetry device confirms its rollback to 2.4.0 (the rollback wave completes)", op: { kind: "ota.device-rollback", campaignId: "fwc_gateway-2.4.1", deviceId: DEV_TELEMETRY } },
    {
      id: "t29",
      summary: "resuming a terminally rolled-back campaign must be refused",
      expectRefusal: true,
      op: { kind: "ota.resume", campaignId: "fwc_gateway-2.4.1" },
    },
    { id: "t30", summary: "final campaign progress read (terminal state, honest accounting)", op: { kind: "ota.progress", campaignId: "fwc_gateway-2.4.1" } },
  ],
  assertions: [
    { id: "f1", description: "the campaign is declared in draft with two staged waves", reading: "t5.ota.state", op: "deep-equals", expected: "draft" },
    { id: "f2", description: "the campaign declares two waves", reading: "t5.ota.waves", op: "deep-equals", expected: 2 },
    { id: "f3", description: "the declaration journal verifies (hash chain)", reading: "t5.ota.journalVerified", op: "deep-equals", expected: true },
    { id: "f4", description: "a firmware downgrade campaign is refused (version-regression)", reading: "t6.ota.refused", op: "deep-equals", expected: "version-regression" },
    { id: "f5", description: "a device in two waves is refused (deterministic cohorts)", reading: "t7.ota.refused", op: "deep-equals", expected: "device-in-two-waves" },
    { id: "f6", description: "announcing moved the campaign to announced", reading: "t8.ota.state", op: "deep-equals", expected: "announced" },
    { id: "f7", description: "starting the second wave first is refused (wave-out-of-order)", reading: "t9.ota.refused", op: "deep-equals", expected: "wave-out-of-order" },
    { id: "f8", description: "the canary wave is deploying", reading: "t10.ota.state", op: "deep-equals", expected: "deploying" },
    { id: "f9", description: "the current wave is the canary", reading: "t10.ota.currentWaveId", op: "deep-equals", expected: "wave-canary" },
    { id: "f10", description: "an outcome outside the current wave is refused", reading: "t11.ota.refused", op: "deep-equals", expected: "device-not-in-current-wave" },
    { id: "f11", description: "halting without a reason is refused (halt-reason-required)", reading: "t12.ota.refused", op: "deep-equals", expected: "halt-reason-required" },
    { id: "f12", description: "the reasoned halt froze the campaign", reading: "t13.ota.state", op: "deep-equals", expected: "halted" },
    { id: "f13", description: "the halt reason is recorded verbatim (accountability)", reading: "t13.ota.haltReason", op: "deep-equals", expected: "canary battery regression reported" },
    { id: "f14", description: "device outcomes while halted are refused (campaign-halted)", reading: "t14.ota.refused", op: "deep-equals", expected: "campaign-halted" },
    { id: "f15", description: "rolling back with nothing applied is refused (no-applied-devices)", reading: "t15.ota.refused", op: "deep-equals", expected: "no-applied-devices" },
    { id: "f16", description: "resume restored the pre-halt deploying sub-state", reading: "t16.ota.state", op: "deep-equals", expected: "deploying" },
    { id: "f17", description: "the canary's success verified the wave and re-announced the campaign", reading: "t17.ota.state", op: "deep-equals", expected: "announced" },
    { id: "f18", description: "one device has applied the firmware", reading: "t17.ota.applied", op: "deep-equals", expected: 1 },
    { id: "f19", description: "the canary wave is verified, the fleet wave pending", reading: "t18.ota.waveStates", op: "deep-equals", expected: ["verified", "pending"] },
    { id: "f20", description: "the wave ids are the declared canary + fleet waves", reading: "t18.ota.waveIds", op: "deep-equals", expected: ["wave-canary", "wave-fleet"] },
    { id: "f21", description: "the campaign journal still verifies after the halt/resume cycle", reading: "t18.ota.journalVerified", op: "deep-equals", expected: true },
    { id: "f22", description: "nothing failed and nothing rolled back yet", reading: "t18.ota.failed", op: "deep-equals", expected: 0 },
    { id: "f23", description: "the fleet wave is deploying", reading: "t19.ota.state", op: "deep-equals", expected: "deploying" },
    { id: "f24", description: "the current wave is the fleet wave", reading: "t19.ota.currentWaveId", op: "deep-equals", expected: "wave-fleet" },
    { id: "f25", description: "two devices have applied (canary + telemetry)", reading: "t20.ota.applied", op: "deep-equals", expected: 2 },
    { id: "f26", description: "the second halt froze the campaign mid-wave", reading: "t22.ota.state", op: "deep-equals", expected: "halted" },
    { id: "f27", description: "the rollback wave started over the applied devices", reading: "t23.ota.state", op: "deep-equals", expected: "rolling-back" },
    { id: "f28", description: "the rollback reason is recorded verbatim", reading: "t23.ota.rollbackReason", op: "deep-equals", expected: "regression triage: revert to 2.4.0" },
    { id: "f29", description: "a rollback report for a never-applied device is refused (unknown-device-ref)", reading: "t24.ota.refused", op: "deep-equals", expected: "unknown-device-ref" },
    { id: "f30", description: "starting a wave while rolling back is refused (illegal-transition)", reading: "t25.ota.refused", op: "deep-equals", expected: "illegal-transition" },
    { id: "f31", description: "the campaign is still rolling back with one device pending", reading: "t26.ota.state", op: "deep-equals", expected: "rolling-back" },
    { id: "f32", description: "one device has rolled back", reading: "t26.ota.rolledBack", op: "deep-equals", expected: 1 },
    { id: "f33", description: "a duplicate rollback report is refused (duplicate-device-outcome)", reading: "t27.ota.refused", op: "deep-equals", expected: "duplicate-device-outcome" },
    { id: "f34", description: "the rollback wave completed the campaign terminally", reading: "t28.ota.state", op: "deep-equals", expected: "rolled-back" },
    { id: "f35", description: "resuming a terminal campaign is refused (illegal-transition)", reading: "t29.ota.refused", op: "deep-equals", expected: "illegal-transition" },
    { id: "f36", description: "final progress: the campaign is terminally rolled-back", reading: "t30.ota.state", op: "deep-equals", expected: "rolled-back" },
    { id: "f37", description: "final progress: both applied devices rolled back (honest accounting)", reading: "t30.ota.rolledBack", op: "deep-equals", expected: 2 },
    { id: "f38", description: "final progress: the applied set is still recorded (audit trail)", reading: "t30.ota.applied", op: "deep-equals", expected: 2 },
    { id: "f39", description: "final progress: the fleet wave was interrupted mid-deployment (honest, never fabricated)", reading: "t30.ota.waveStates", op: "deep-equals", expected: ["verified", "deploying"] },
    { id: "f40", description: "final progress: the mission relay never reported (pending)", reading: "t30.ota.wavePending", op: "deep-equals", expected: [0, 1] },
    { id: "f41", description: "final progress: the last halt reason is on the record", reading: "t30.ota.haltReason", op: "deep-equals", expected: "telemetry units report sensor instability on 2.4.1" },
    { id: "f42", description: "the full campaign journal verifies end-to-end (tamper-evident)", reading: "t30.ota.journalVerified", op: "deep-equals", expected: true },
    { id: "f43", description: "the progress read carries a machine-checkable digest", reading: "t30.ota.progressDigest", op: "not-null" },
  ],
};
