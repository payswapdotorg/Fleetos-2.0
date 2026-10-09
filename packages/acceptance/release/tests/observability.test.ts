/**
 * Observability rollups: per-lane assembly over REAL outputs, verbatim
 * field tracing, degraded-reason propagation (verbatim), tenant
 * fail-closed, canonical lane order, digest + tamper, determinism.
 */

import { describe, expect, it } from "vitest";
import {
  assembleSystemStatus,
  LANE_IDS,
  verifySystemStatus,
  type LaneSignal,
  type SystemStatus,
} from "../src/observability.js";
import { byteIdentical } from "../src/digest.js";
import {
  TENANT,
  breachedSlaScorecard,
  divergentOfflineReport,
  divergentReplayOutcome,
  gappedAuditVerification,
  healthyAdmission,
  healthyAuditVerification,
  healthyDivergence,
  healthyLaneSignals,
  healthyOfflineReport,
  healthyReplay,
  healthySlaScorecard,
  overCapAdmission,
  refusedReplay,
  tamperedPayloadAuditVerification,
} from "./fixtures.js";

function fieldOf(status: SystemStatus, lane: string, name: string) {
  const record = status.lanes.find((l) => l.laneId === lane);
  if (record === undefined) throw new Error(`lane ${lane} absent`);
  const field = record.fields.find((f) => f.name === name);
  if (field === undefined) throw new Error(`field ${name} absent on ${lane}`);
  return field.value;
}

describe("observability — healthy assembly over REAL outputs", () => {
  it("assembles all five healthy lanes: health healthy, counts 5/0, no degraded ids", () => {
    const result = assembleSystemStatus({ tenantId: TENANT, lanes: healthyLaneSignals(TENANT) });
    if (!result.ok) throw new Error(result.detail);
    expect(result.status.health).toBe("healthy");
    expect(result.status.healthyLaneCount).toBe(5);
    expect(result.status.degradedLaneCount).toBe(0);
    expect(result.status.degradedLaneIds).toEqual([]);
    expect(result.status.lanes.map((l) => l.laneId)).toEqual([...LANE_IDS]);
    expect(result.status.tenantId).toBe(TENANT);
  });

  it("audit-lane fields copy the REAL AuditVerification verbatim (with documented sources)", () => {
    const verification = healthyAuditVerification(TENANT);
    const result = assembleSystemStatus({
      tenantId: TENANT,
      lanes: [{ kind: "audit-ledger", tenantId: TENANT, verification }],
    });
    if (!result.ok) throw new Error(result.detail);
    const lane = result.status.lanes[0]!;
    expect(lane.health).toBe("healthy");
    expect(lane.reason).toBeNull();
    expect(fieldOf(result.status, "audit-ledger", "checkedEntries")).toBe(verification.checkedEntries);
    expect(fieldOf(result.status, "audit-ledger", "brokenAt")).toBe(verification.brokenAt);
    expect(fieldOf(result.status, "audit-ledger", "gapAt")).toBe(verification.gapAt);
    expect(fieldOf(result.status, "audit-ledger", "computedHeadDigest")).toBe(verification.computedHeadDigest);
    expect(lane.fields.every((f) => f.source.startsWith("AuditVerification."))).toBe(true);
    expect(lane.source).toContain("verifyAuditLedger");
  });

  it("incident-replay fields copy the REAL replay + divergence outputs verbatim", () => {
    const replay = healthyReplay(TENANT);
    if (!replay.ok) throw new Error("replay refused");
    const divergence = healthyDivergence(TENANT);
    const result = assembleSystemStatus({
      tenantId: TENANT,
      lanes: [{ kind: "incident-replay", tenantId: TENANT, replay, divergence }],
    });
    if (!result.ok) throw new Error(result.detail);
    const lane = result.status.lanes[0]!;
    expect(lane.health).toBe("healthy");
    expect(fieldOf(result.status, "incident-replay", "replayDigest")).toBe(replay.replay.replayDigest);
    expect(fieldOf(result.status, "incident-replay", "timelineSteps")).toBe(replay.replay.timeline.length);
    expect(fieldOf(result.status, "incident-replay", "commandCount")).toBe(replay.replay.commands.length);
    expect(fieldOf(result.status, "incident-replay", "diverged")).toBe(false);
  });

  it("sla-scorecard fields copy the REAL scorecard verbatim (status compliant → healthy)", () => {
    const scorecard = healthySlaScorecard(TENANT);
    if (!scorecard.ok) throw new Error("scorecard refused");
    const result = assembleSystemStatus({
      tenantId: TENANT,
      lanes: [{ kind: "sla-scorecard", tenantId: TENANT, scorecard }],
    });
    if (!result.ok) throw new Error(result.detail);
    const card = scorecard.scorecard;
    expect(fieldOf(result.status, "sla-scorecard", "availabilityBps")).toBe(card.availabilityBps);
    expect(fieldOf(result.status, "sla-scorecard", "breachCount")).toBe(card.breachCount);
    expect(fieldOf(result.status, "sla-scorecard", "status")).toBe(card.status);
    expect(fieldOf(result.status, "sla-scorecard", "evaluationDigest")).toBe(card.evaluationDigest);
    expect(result.status.lanes[0]!.health).toBe("healthy");
  });

  it("ingestion-admission fields copy the REAL AdmissionCapDecision verbatim", () => {
    const decision = healthyAdmission(TENANT, 100);
    if (!decision.ok) throw new Error("fixture admission refused");
    const result = assembleSystemStatus({
      tenantId: TENANT,
      lanes: [{ kind: "ingestion-admission", tenantId: TENANT, decision }],
    });
    if (!result.ok) throw new Error(result.detail);
    expect(fieldOf(result.status, "ingestion-admission", "cap")).toBe(decision.cap);
    expect(fieldOf(result.status, "ingestion-admission", "used")).toBe(decision.used);
    expect(fieldOf(result.status, "ingestion-admission", "remaining")).toBe(decision.remaining);
    expect(result.status.lanes[0]!.health).toBe("healthy");
  });

  it("offline-replay fields copy the REAL OfflineReplayReport verbatim", () => {
    const report = healthyOfflineReport(TENANT);
    const result = assembleSystemStatus({
      tenantId: TENANT,
      lanes: [{ kind: "offline-replay", tenantId: TENANT, report }],
    });
    if (!result.ok) throw new Error(result.detail);
    expect(fieldOf(result.status, "offline-replay", "deviceId")).toBe(report.deviceId);
    expect(fieldOf(result.status, "offline-replay", "entryCount")).toBe(report.entries.length);
    expect(fieldOf(result.status, "offline-replay", "divergenceCount")).toBe(report.divergences.length);
    expect(fieldOf(result.status, "offline-replay", "replayDigest")).toBe(report.replayDigest);
    expect(result.status.lanes[0]!.health).toBe("healthy");
  });
});

describe("observability — degraded propagation (reason codes VERBATIM)", () => {
  it("audit gap: a removed interior entry degrades the lane with reason 'audit.gap'", () => {
    const verification = gappedAuditVerification(TENANT);
    expect(verification.verified).toBe(false);
    const result = assembleSystemStatus({
      tenantId: TENANT,
      lanes: healthyLaneSignals(TENANT).map((s) =>
        s.kind === "audit-ledger" ? { ...s, verification } : s,
      ),
    });
    if (!result.ok) throw new Error(result.detail);
    expect(result.status.health).toBe("degraded");
    expect(result.status.degradedLaneIds).toEqual(["audit-ledger"]);
    expect(result.status.healthyLaneCount).toBe(4);
    const lane = result.status.lanes.find((l) => l.laneId === "audit-ledger")!;
    expect(lane.reason).toBe("audit.gap");
    expect(fieldOf(result.status, "audit-ledger", "gapAt")).toBe(verification.gapAt);
  });

  it("audit payload tamper: reason 'audit.payload_digest_mismatch' verbatim", () => {
    const verification = tamperedPayloadAuditVerification(TENANT);
    const result = assembleSystemStatus({ tenantId: TENANT, lanes: [{ kind: "audit-ledger", tenantId: TENANT, verification }] });
    if (!result.ok) throw new Error(result.detail);
    expect(result.status.lanes[0]!.reason).toBe("audit.payload_digest_mismatch");
  });

  it("replay refusal: a foreign-tenant journal degrades with reason 'replay.tenant-mismatch' verbatim", () => {
    const replay = refusedReplay(TENANT);
    expect(replay.ok).toBe(false);
    const divergence = healthyDivergence(TENANT);
    const result = assembleSystemStatus({
      tenantId: TENANT,
      lanes: [{ kind: "incident-replay", tenantId: TENANT, replay, divergence }],
    });
    if (!result.ok) throw new Error(result.detail);
    expect(result.status.lanes[0]!.reason).toBe("replay.tenant-mismatch");
    expect(fieldOf(result.status, "incident-replay", "refusalReason")).toBe("replay.tenant-mismatch");
    expect(fieldOf(result.status, "incident-replay", "offender")).toBe("journal:audit-intent-1");
  });

  it("replay divergence: a diverged equivalence outcome degrades with the REAL divergence field verbatim", () => {
    const { recorded, replayed, divergence } = divergentReplayOutcome(TENANT);
    expect(divergence.diverged).toBe(true);
    const result = assembleSystemStatus({
      tenantId: TENANT,
      lanes: [
        {
          kind: "incident-replay",
          tenantId: TENANT,
          replay: { ok: true, replay: recorded },
          divergence,
        },
      ],
    });
    if (!result.ok) throw new Error(result.detail);
    const lane = result.status.lanes[0]!;
    expect(lane.health).toBe("degraded");
    expect(lane.reason).toBe(divergence.field);
    expect(fieldOf(result.status, "incident-replay", "divergenceExpected")).toBe(divergence.expected);
    expect(fieldOf(result.status, "incident-replay", "divergenceActual")).toBe(divergence.actual);
    expect(replayed.ok).toBe(true);
  });

  it("sla penalty: a breached SLA degrades with reason 'penalty' verbatim", () => {
    const scorecard = breachedSlaScorecard(TENANT);
    if (!scorecard.ok) throw new Error("scorecard refused");
    expect(scorecard.scorecard.status).toBe("penalty");
    const result = assembleSystemStatus({
      tenantId: TENANT,
      lanes: healthyLaneSignals(TENANT).map((s) =>
        s.kind === "sla-scorecard" ? { ...s, scorecard } : s,
      ),
    });
    if (!result.ok) throw new Error(result.detail);
    const lane = result.status.lanes.find((l) => l.laneId === "sla-scorecard")!;
    expect(lane.reason).toBe("penalty");
    expect(fieldOf(result.status, "sla-scorecard", "breachCount")).toBe(scorecard.scorecard.breachCount);
    expect(fieldOf(result.status, "sla-scorecard", "totalPenaltyBps")).toBe(scorecard.scorecard.totalPenaltyBps);
  });

  it("ingestion over-cap: degrades with reason 'tenant-cap-exceeded' verbatim (REAL cap/used/requested)", () => {
    const decision = overCapAdmission(TENANT);
    if (decision.ok) throw new Error("fixture admission unexpectedly admitted");
    expect(decision.ok).toBe(false);
    const result = assembleSystemStatus({
      tenantId: TENANT,
      lanes: [{ kind: "ingestion-admission", tenantId: TENANT, decision }],
    });
    if (!result.ok) throw new Error(result.detail);
    const lane = result.status.lanes[0]!;
    expect(lane.health).toBe("degraded");
    expect(lane.reason).toBe("tenant-cap-exceeded");
    expect(fieldOf(result.status, "ingestion-admission", "cap")).toBe(decision.cap);
    expect(fieldOf(result.status, "ingestion-admission", "used")).toBe(decision.used);
    expect(fieldOf(result.status, "ingestion-admission", "requested")).toBe(decision.requested);
  });

  it("offline divergence: degrades with reason 'posture-changed-while-offline' verbatim", () => {
    const report = divergentOfflineReport(TENANT);
    expect(report.divergences.length).toBe(1);
    const result = assembleSystemStatus({
      tenantId: TENANT,
      lanes: [{ kind: "offline-replay", tenantId: TENANT, report }],
    });
    if (!result.ok) throw new Error(result.detail);
    const lane = result.status.lanes[0]!;
    expect(lane.health).toBe("degraded");
    expect(lane.reason).toBe("posture-changed-while-offline");
    expect(fieldOf(result.status, "offline-replay", "divergenceCount")).toBe(1);
  });
});

describe("observability — fail-closed refusals", () => {
  it("empty view tenant refuses TENANT_ID_EMPTY", () => {
    const result = assembleSystemStatus({ tenantId: "", lanes: healthyLaneSignals(TENANT) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("TENANT_ID_EMPTY");
  });

  it("a lane paired to a foreign tenant refuses LANE_TENANT_MISMATCH naming the lane", () => {
    const signals = healthyLaneSignals(TENANT).map((s) =>
      s.kind === "sla-scorecard"
        ? { ...s, tenantId: "tnt_other-firm", scorecard: healthySlaScorecard("tnt_other-firm") }
        : s,
    );
    const result = assembleSystemStatus({ tenantId: TENANT, lanes: signals });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("LANE_TENANT_MISMATCH");
      expect(result.lane).toBe("sla-scorecard");
      expect(result.detail).toContain("tnt_other-firm");
    }
  });

  it("a REAL output tenant that disagrees with the pairing refuses (carried vs paired)", () => {
    // The offline report REALLY carries tenant tnt_other-firm; the pairing lies.
    const report = healthyOfflineReport("tnt_other-firm");
    const result = assembleSystemStatus({
      tenantId: "tnt_other-firm",
      lanes: [{ kind: "offline-replay", tenantId: TENANT, report }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("LANE_TENANT_MISMATCH");
      expect(result.lane).toBe("offline-replay");
    }
  });

  it("duplicate lane kind refuses DUPLICATE_LANE", () => {
    const signals = [...healthyLaneSignals(TENANT)];
    const dup: LaneSignal = { kind: "audit-ledger", tenantId: TENANT, verification: healthyAuditVerification(TENANT) };
    const result = assembleSystemStatus({ tenantId: TENANT, lanes: [...signals, dup] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("DUPLICATE_LANE");
      expect(result.lane).toBe("audit-ledger");
    }
  });

  it("zero lanes refuses NO_LANES", () => {
    const result = assembleSystemStatus({ tenantId: TENANT, lanes: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("NO_LANES");
  });
});

describe("observability — determinism + tamper detection", () => {
  it("canonical lane order: permuted input assembles a byte-identical view", () => {
    const signals = healthyLaneSignals(TENANT);
    const a = assembleSystemStatus({ tenantId: TENANT, lanes: signals });
    const b = assembleSystemStatus({ tenantId: TENANT, lanes: [...signals].reverse() });
    if (!a.ok || !b.ok) throw new Error("assembly refused");
    expect(byteIdentical(a.status, b.status)).toBe(true);
    expect(a.status.statusDigest).toBe(b.status.statusDigest);
  });

  it("byte-identical re-runs (determinism law)", () => {
    const a = assembleSystemStatus({ tenantId: TENANT, lanes: healthyLaneSignals(TENANT) });
    const b = assembleSystemStatus({ tenantId: TENANT, lanes: healthyLaneSignals(TENANT) });
    if (!a.ok || !b.ok) throw new Error("assembly refused");
    expect(byteIdentical(a.status, b.status)).toBe(true);
  });

  it("verifySystemStatus detects a tampered field (digest recompute)", () => {
    const result = assembleSystemStatus({ tenantId: TENANT, lanes: healthyLaneSignals(TENANT) });
    if (!result.ok) throw new Error(result.detail);
    expect(verifySystemStatus(result.status)).toBe(true);
    const tampered: SystemStatus = {
      ...result.status,
      healthyLaneCount: 99,
    };
    expect(verifySystemStatus(tampered)).toBe(false);
  });

  it("a degraded status verifies (the digest covers the honest degraded content)", () => {
    const signals = healthyLaneSignals(TENANT).map((s) =>
      s.kind === "audit-ledger" ? { ...s, verification: gappedAuditVerification(TENANT) } : s,
    );
    const result = assembleSystemStatus({ tenantId: TENANT, lanes: signals });
    if (!result.ok) throw new Error(result.detail);
    expect(result.status.health).toBe("degraded");
    expect(verifySystemStatus(result.status)).toBe(true);
  });
});
