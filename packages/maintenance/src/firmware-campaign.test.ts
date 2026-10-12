/**
 * @fleetos/maintenance — F331A firmware-campaign domain tests (Wave 13
 * lane A, row 39). The REAL campaign laws: staged waves, halt/resume,
 * rollback over applied devices, fail-closed refusals, journal
 * tamper-evidence, deterministic re-runs.
 */

import { describe, expect, it } from "vitest";
import {
  announceFirmwareCampaign,
  declareFirmwareCampaign,
  haltFirmwareCampaign,
  recordCampaignDeviceOutcome,
  recordCampaignDeviceRollback,
  resumeFirmwareCampaign,
  rollbackFirmwareCampaign,
  startCampaignWave,
  compareFirmwareVersions,
  type FirmwareCampaign,
  type FirmwareCampaignResult,
  type FirmwareCampaignRejection,
} from "./firmware-campaign.js";
import { campaignProgress } from "./firmware-campaign-progress.js";
import { verifyFirmwareCampaignJournal } from "./firmware-campaign-journal.js";

const TENANT = "tnt_field-accept-01";
const ACTOR = "act_edge-edda-01";

const WAVES = [
  { waveId: "wave-canary", deviceIds: ["dev_gate-2002"] },
  { waveId: "wave-fleet", deviceIds: ["dev_telem-1001", "dev_mission-relay-7"] },
];

function unwrap(result: FirmwareCampaignResult<FirmwareCampaign>): FirmwareCampaign {
  if (!result.ok) throw new Error(`expected success, got refusal: ${result.reason}`);
  return result.campaign;
}

function reasonOf(result: FirmwareCampaignResult<FirmwareCampaign>): FirmwareCampaignRejection {
  if (result.ok) throw new Error("expected refusal, got success");
  return result.reason;
}

function declared(): FirmwareCampaign {
  return unwrap(declareFirmwareCampaign({
    id: "fwc_gateway-2.4.1",
    tenantId: TENANT,
    firmwareId: "fw_edge-gateway",
    fromVersion: "2.4.0",
    toVersion: "2.4.1",
    declaredAt: 1_000,
    waves: WAVES,
  }));
}

function announced(): FirmwareCampaign {
  return unwrap(announceFirmwareCampaign(declared(), { tenantId: TENANT, at: 2_000, actor: ACTOR }));
}

describe("F331A firmware campaign declaration", () => {
  it("declares a staged campaign in draft with sorted deterministic waves", () => {
    const c = declared();
    expect(c.state).toBe("draft");
    expect(c.waves.map((w) => w.waveId)).toEqual(["wave-canary", "wave-fleet"]);
    expect(c.waves[0]!.deviceIds).toEqual(["dev_gate-2002"]);
    expect(c.waves[1]!.deviceIds).toEqual(["dev_mission-relay-7", "dev_telem-1001"]);
    expect(verifyFirmwareCampaignJournal(c.events)).toBe(true);
  });

  it("refuses a version regression and malformed versions", () => {
    expect(reasonOf(declareFirmwareCampaign({ id: "fwc_bad", tenantId: TENANT, firmwareId: "fw", fromVersion: "2.4.1", toVersion: "2.4.0", declaredAt: 1, waves: WAVES }))).toBe("version-regression");
    expect(reasonOf(declareFirmwareCampaign({ id: "fwc_bad", tenantId: TENANT, firmwareId: "fw", fromVersion: "2.4.x", toVersion: "2.4.1", declaredAt: 1, waves: WAVES }))).toBe("malformed-version");
  });

  it("refuses duplicate wave ids, empty waves and a device in two waves", () => {
    expect(reasonOf(declareFirmwareCampaign({ id: "fwc_bad", tenantId: TENANT, firmwareId: "fw", fromVersion: "1.0.0", toVersion: "1.0.1", declaredAt: 1, waves: [{ waveId: "w", deviceIds: ["d1"] }, { waveId: "w", deviceIds: ["d2"] }] }))).toBe("duplicate-wave-id");
    expect(reasonOf(declareFirmwareCampaign({ id: "fwc_bad", tenantId: TENANT, firmwareId: "fw", fromVersion: "1.0.0", toVersion: "1.0.1", declaredAt: 1, waves: [] }))).toBe("empty-wave");
    expect(reasonOf(declareFirmwareCampaign({ id: "fwc_bad", tenantId: TENANT, firmwareId: "fw", fromVersion: "1.0.0", toVersion: "1.0.1", declaredAt: 1, waves: [{ waveId: "w1", deviceIds: ["d1", "d2"] }, { waveId: "w2", deviceIds: ["d2"] }] }))).toBe("device-in-two-waves");
  });

  it("dotted versions compare numerically (2.10.0 > 2.9.9)", () => {
    expect(compareFirmwareVersions("2.10.0", "2.9.9")).toBeGreaterThan(0);
    expect(compareFirmwareVersions("2.4.1", "2.4.1")).toBe(0);
  });
});

describe("F331A staged wave execution", () => {
  it("waves run strictly in order; out-of-order starts are refused", () => {
    const c = announced();
    expect(reasonOf(startCampaignWave(c, { tenantId: TENANT, waveId: "wave-fleet", at: 3_000, actor: ACTOR }))).toBe("wave-out-of-order");
    const started = startCampaignWave(c, { tenantId: TENANT, waveId: "wave-canary", at: 3_000, actor: ACTOR });
    const campaign = unwrap(started);
    expect(campaign.state).toBe("deploying");
    expect(campaign.waves[0]!.state).toBe("deploying");
  });

  it("a wave auto-verifies when every cohort device reported; the next wave may then start", () => {
    let c = announced();
    c = unwrap(startCampaignWave(c, { tenantId: TENANT, waveId: "wave-canary", at: 3_000, actor: ACTOR }));
    c = unwrap(recordCampaignDeviceOutcome(c, { tenantId: TENANT, deviceId: "dev_gate-2002", ok: true, at: 4_000, actor: ACTOR }));
    expect(c.waves[0]!.state).toBe("verified");
    expect(c.state).toBe("announced");
    expect(campaignProgress(c).applied).toBe(1);
    expect(unwrap(startCampaignWave(c, { tenantId: TENANT, waveId: "wave-fleet", at: 5_000, actor: ACTOR })).state).toBe("deploying");
  });

  it("the campaign completes after the last wave is fully accounted", () => {
    let c = announced();
    c = unwrap(startCampaignWave(c, { tenantId: TENANT, waveId: "wave-canary", at: 3_000, actor: ACTOR }));
    c = unwrap(recordCampaignDeviceOutcome(c, { tenantId: TENANT, deviceId: "dev_gate-2002", ok: true, at: 4_000, actor: ACTOR }));
    c = unwrap(startCampaignWave(c, { tenantId: TENANT, waveId: "wave-fleet", at: 5_000, actor: ACTOR }));
    c = unwrap(recordCampaignDeviceOutcome(c, { tenantId: TENANT, deviceId: "dev_mission-relay-7", ok: false, at: 6_000, actor: ACTOR, failureReason: "flash-write-error" }));
    expect(c.state).toBe("deploying"); // not yet accounted
    c = unwrap(recordCampaignDeviceOutcome(c, { tenantId: TENANT, deviceId: "dev_telem-1001", ok: true, at: 7_000, actor: ACTOR }));
    expect(c.state).toBe("completed");
    expect(verifyFirmwareCampaignJournal(c.events)).toBe(true);
    const p = campaignProgress(c);
    expect(p.applied).toBe(2);
    expect(p.failed).toBe(1);
    expect(p.waves.map((w) => w.state)).toEqual(["verified", "verified"]);
  });

  it("refuses outcomes for devices outside the current wave and duplicates", () => {
    let c = announced();
    c = unwrap(startCampaignWave(c, { tenantId: TENANT, waveId: "wave-canary", at: 3_000, actor: ACTOR }));
    expect(reasonOf(recordCampaignDeviceOutcome(c, { tenantId: TENANT, deviceId: "dev_telem-1001", ok: true, at: 4_000, actor: ACTOR }))).toBe("device-not-in-current-wave");
    // The canary wave verifies (single device), then the duplicate is probed
    // inside the still-deploying fleet wave.
    c = unwrap(recordCampaignDeviceOutcome(c, { tenantId: TENANT, deviceId: "dev_gate-2002", ok: true, at: 4_000, actor: ACTOR }));
    c = unwrap(startCampaignWave(c, { tenantId: TENANT, waveId: "wave-fleet", at: 5_000, actor: ACTOR }));
    c = unwrap(recordCampaignDeviceOutcome(c, { tenantId: TENANT, deviceId: "dev_telem-1001", ok: true, at: 6_000, actor: ACTOR }));
    expect(reasonOf(recordCampaignDeviceOutcome(c, { tenantId: TENANT, deviceId: "dev_telem-1001", ok: true, at: 7_000, actor: ACTOR }))).toBe("duplicate-device-outcome");
  });

  it("a foreign tenant is refused fail-closed on every command", () => {
    const c = announced();
    expect(reasonOf(announceFirmwareCampaign(c, { tenantId: "tnt_other-9", at: 9, actor: ACTOR }))).toBe("tenant-mismatch");
    expect(reasonOf(startCampaignWave(c, { tenantId: "tnt_other-9", waveId: "wave-canary", at: 9, actor: ACTOR }))).toBe("tenant-mismatch");
    expect(reasonOf(recordCampaignDeviceOutcome(c, { tenantId: "tnt_other-9", deviceId: "dev_gate-2002", ok: true, at: 9, actor: ACTOR }))).toBe("tenant-mismatch");
    expect(reasonOf(haltFirmwareCampaign(c, { tenantId: "tnt_other-9", reason: "x", at: 9, actor: ACTOR }))).toBe("tenant-mismatch");
  });
});

describe("F331A halt, resume and rollback", () => {
  it("halt requires a reason and freezes the campaign; resume restores the pre-halt state", () => {
    let c = announced();
    c = unwrap(startCampaignWave(c, { tenantId: TENANT, waveId: "wave-canary", at: 3_000, actor: ACTOR }));
    expect(reasonOf(haltFirmwareCampaign(c, { tenantId: TENANT, at: 4_000, actor: ACTOR }))).toBe("halt-reason-required");
    const halted = unwrap(haltFirmwareCampaign(c, { tenantId: TENANT, reason: "canary battery regression reported", at: 4_000, actor: ACTOR }));
    expect(halted.state).toBe("halted");
    expect(halted.halt?.reason).toBe("canary battery regression reported");
    // Frozen: wave starts and outcomes are refused while halted.
    expect(reasonOf(startCampaignWave(halted, { tenantId: TENANT, waveId: "wave-fleet", at: 5_000, actor: ACTOR }))).toBe("campaign-halted");
    expect(reasonOf(recordCampaignDeviceOutcome(halted, { tenantId: TENANT, deviceId: "dev_gate-2002", ok: true, at: 5_000, actor: ACTOR }))).toBe("campaign-halted");
    const resumed = unwrap(resumeFirmwareCampaign(halted, { tenantId: TENANT, at: 6_000, actor: ACTOR }));
    expect(resumed.state).toBe("deploying"); // pre-halt sub-state restored
  });

  it("rollback requires a halt first, refuses when nothing applied, and rolls applied devices back terminally", () => {
    let c = announced();
    expect(reasonOf(rollbackFirmwareCampaign(c, { tenantId: TENANT, at: 4_000, actor: ACTOR }))).toBe("halt-first");
    c = unwrap(startCampaignWave(c, { tenantId: TENANT, waveId: "wave-canary", at: 3_000, actor: ACTOR }));
    c = unwrap(haltFirmwareCampaign(c, { tenantId: TENANT, reason: "halt before any device applied", at: 4_000, actor: ACTOR }));
    expect(reasonOf(rollbackFirmwareCampaign(c, { tenantId: TENANT, at: 5_000, actor: ACTOR }))).toBe("no-applied-devices");
    // Resume, apply on the canary, then halt again and roll back.
    c = unwrap(resumeFirmwareCampaign(c, { tenantId: TENANT, at: 5_000, actor: ACTOR }));
    c = unwrap(recordCampaignDeviceOutcome(c, { tenantId: TENANT, deviceId: "dev_gate-2002", ok: true, at: 6_000, actor: ACTOR }));
    c = unwrap(startCampaignWave(c, { tenantId: TENANT, waveId: "wave-fleet", at: 7_000, actor: ACTOR }));
    c = unwrap(recordCampaignDeviceOutcome(c, { tenantId: TENANT, deviceId: "dev_telem-1001", ok: true, at: 8_000, actor: ACTOR }));
    c = unwrap(haltFirmwareCampaign(c, { tenantId: TENANT, reason: "fleet regression after second wave", at: 9_000, actor: ACTOR }));
    const rb = unwrap(rollbackFirmwareCampaign(c, { tenantId: TENANT, reason: "regression triage", at: 10_000, actor: ACTOR }));
    expect(rb.state).toBe("rolling-back");
    // A device that never applied is not part of the rollback wave.
    expect(reasonOf(recordCampaignDeviceRollback(rb, { tenantId: TENANT, deviceId: "dev_mission-relay-7", at: 11_000, actor: ACTOR }))).toBe("unknown-device-ref");
    let r = unwrap(recordCampaignDeviceRollback(rb, { tenantId: TENANT, deviceId: "dev_telem-1001", at: 11_000, actor: ACTOR }));
    expect(r.state).toBe("rolling-back"); // one applied device still pending
    expect(reasonOf(recordCampaignDeviceRollback(r, { tenantId: TENANT, deviceId: "dev_telem-1001", at: 12_000, actor: ACTOR }))).toBe("duplicate-device-outcome");
    r = unwrap(recordCampaignDeviceRollback(r, { tenantId: TENANT, deviceId: "dev_gate-2002", at: 13_000, actor: ACTOR }));
    expect(r.state).toBe("rolled-back");
    expect(campaignProgress(r).rolledBack).toBe(2);
    expect(verifyFirmwareCampaignJournal(r.events)).toBe(true);
    // Terminal: nothing moves after a terminal rollback.
    expect(reasonOf(resumeFirmwareCampaign(r, { tenantId: TENANT, at: 14_000, actor: ACTOR }))).toBe("illegal-transition");
  });
});

describe("F331A campaign determinism + tamper evidence", () => {
  it("an identical command sequence yields a byte-identical journal + progress digest", () => {
    const run = (): FirmwareCampaign => {
      let c = announced();
      c = unwrap(startCampaignWave(c, { tenantId: TENANT, waveId: "wave-canary", at: 3_000, actor: ACTOR }));
      c = unwrap(recordCampaignDeviceOutcome(c, { tenantId: TENANT, deviceId: "dev_gate-2002", ok: true, at: 4_000, actor: ACTOR }));
      c = unwrap(startCampaignWave(c, { tenantId: TENANT, waveId: "wave-fleet", at: 5_000, actor: ACTOR }));
      c = unwrap(recordCampaignDeviceOutcome(c, { tenantId: TENANT, deviceId: "dev_telem-1001", ok: false, at: 6_000, actor: ACTOR, failureReason: "flash-write-error" }));
      return c;
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(campaignProgress(a).digest).toBe(campaignProgress(b).digest);
  });

  it("a tampered journal event is detected by the hash-chain verifier", () => {
    let c = announced();
    c = unwrap(startCampaignWave(c, { tenantId: TENANT, waveId: "wave-canary", at: 3_000, actor: ACTOR }));
    expect(verifyFirmwareCampaignJournal(c.events)).toBe(true);
    const tampered: FirmwareCampaign = {
      ...c,
      events: c.events.map((e, i) => (i === 1 ? { ...e, detail: "forged" } : e)),
    };
    expect(verifyFirmwareCampaignJournal(tampered.events)).toBe(false);
  });
});
