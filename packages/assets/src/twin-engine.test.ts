/**
 * @fleetos/assets — Wave 2 twin-engine tests (F220A).
 *
 * Covers:
 *   - event-sourced fold over the revision log with checkpointing contracts
 *     (resume-from-sequence)
 *   - deterministic replay (same log -> byte-identical twin state)
 *   - conflict detection (concurrent revision sequences on the same device)
 *   - managed-asset registry: lineage references (A17 relational model)
 *   - lifecycle projections per asset
 *   - enrollment boundary (an observation from an unenrolled device is
 *     refused with a machine-stable reason)
 */

import { describe, it, expect } from "vitest";
import {
  type AssetId,
  type DeviceId,
  type TwinRevision,
} from "./assets.js";
import {
  checkEnrollment,
  declareLineage,
  detectConflicts,
  emptyFoldState,
  emptyLineageRegistry,
  EnrollmentDirectory,
  gateObservationOnEnrollment,
  InMemoryEnrollmentRegistry,
  foldRevisions,
  listLineageFrom,
  listLineageTo,
  projectLifecycle,
  registerLineage,
  verifyDeterministicReplay,
  type EnrollmentRecord,
  type LineageRelationKind,
  type LifecycleAuditEntry,
  type TwinRevisionWithDigest,
} from "./twin-engine.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const DEV1 = "dev_truck-001" as DeviceId;
const ASSET1 = "ast_asset-001" as AssetId;
const ASSET2 = "ast_asset-002" as AssetId;

function revision(seq: number, attrs: Record<string, unknown>, observedAt?: number): TwinRevision {
  return {
    seq: seq as never,
    observedAt: observedAt ?? NOW + seq * 1000,
    appliedAt: NOW + seq * 1000 + 1,
    source: "observation",
    attributes: attrs,
  };
}

function revisionWithDigest(
  seq: number,
  attrs: Record<string, unknown>,
  parentDigest: string,
  observedAt?: number,
): TwinRevisionWithDigest {
  const r = revision(seq, attrs, observedAt);
  // Digest depends on the attrs (keys + values) + seq + parent so two
  // distinct revisions produce distinct digests (mirrors the Wave 1
  // admitTwinRevision contract).
  const attrsJson = JSON.stringify(
    Object.keys(attrs).sort().map((k) => [k, attrs[k]]),
  );
  const digest = `dg_${seq}_${parentDigest.slice(-6)}_${attrsJson.slice(-12)}`;
  return { ...r, revisionDigest: digest, parentDigest };
}

// ---------------------------------------------------------------------------
// foldRevisions — event-sourced fold with checkpointing.
// ---------------------------------------------------------------------------

describe("twin-engine: foldRevisions", () => {
  it("folds an empty log into the empty state", () => {
    const { state, checkpoint } = foldRevisions([], DEV1, TENANT_A);
    expect(state.attributes).toEqual({});
    expect(state.lastSeq).toBe(0);
    expect(state.headDigest).toBeNull();
    expect(state.revisionCount).toBe(0);
    expect(checkpoint.lastAppliedSeq).toBe(0);
    expect(checkpoint.atRevisionIndex).toBe(0);
  });

  it("folds a single revision into a state with the revision's attributes", () => {
    const revs = [revision(1, { color: "red" })];
    const { state, checkpoint } = foldRevisions(revs, DEV1, TENANT_A);
    expect(state.attributes).toEqual({ color: "red" });
    expect(state.lastSeq).toBe(1);
    expect(state.revisionCount).toBe(1);
    expect(checkpoint.lastAppliedSeq).toBe(1);
    expect(checkpoint.atRevisionIndex).toBe(1);
  });

  it("folds multiple revisions, last-writer-wins per key", () => {
    const revs = [
      revision(1, { color: "red", speed: 30 }),
      revision(2, { color: "blue" }),
      revision(3, { speed: 50 }),
    ];
    const { state } = foldRevisions(revs, DEV1, TENANT_A);
    expect(state.attributes).toEqual({ color: "blue", speed: 50 });
    expect(state.lastSeq).toBe(3);
    expect(state.revisionCount).toBe(3);
  });

  it("resume-from-sequence skips revisions with seq <= resumeFromSeq", () => {
    const revs = [revision(1, { a: 1 }), revision(2, { b: 2 }), revision(3, { c: 3 })];
    const { state, checkpoint } = foldRevisions(revs, DEV1, TENANT_A, 1);
    // Resume from seq=1: skip seq=1, apply seq=2 and seq=3.
    expect(state.lastSeq).toBe(3);
    expect(state.attributes).toEqual({ b: 2, c: 3 });
    expect(checkpoint.lastAppliedSeq).toBe(3);
  });

  it("checkpoint digest is deterministic for identical fold results", () => {
    const revs = [revision(1, { a: 1 }), revision(2, { b: 2 })];
    const a = foldRevisions(revs, DEV1, TENANT_A);
    const b = foldRevisions(revs, DEV1, TENANT_A);
    expect(a.checkpoint.checkpointDigest).toBe(b.checkpoint.checkpointDigest);
  });

  it("checkpoint digest changes when the log changes", () => {
    const r1 = foldRevisions([revision(1, { a: 1 })], DEV1, TENANT_A);
    const r2 = foldRevisions([revision(1, { a: 1 }), revision(2, { b: 2 })], DEV1, TENANT_A);
    expect(r1.checkpoint.checkpointDigest).not.toBe(r2.checkpoint.checkpointDigest);
  });

  it("emptyFoldState returns a state with revisionCount=0 and no headDigest", () => {
    const s = emptyFoldState(DEV1, TENANT_A);
    expect(s.revisionCount).toBe(0);
    expect(s.headDigest).toBeNull();
    expect(s.lastSeq).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// verifyDeterministicReplay — same log -> byte-identical state.
// ---------------------------------------------------------------------------

describe("twin-engine: deterministic replay verification", () => {
  it("two folds over the same log produce identical state (byte-identical)", () => {
    const revs = [
      revision(1, { a: 1, b: { nested: true } }),
      revision(2, { c: [1, 2, 3] }),
      revision(3, { a: 99 }),
    ];
    const { deterministic, a, b } = verifyDeterministicReplay(revs, DEV1, TENANT_A);
    expect(deterministic).toBe(true);
    expect(a).toEqual(b);
    expect(a.attributes).toEqual({ a: 99, b: { nested: true }, c: [1, 2, 3] });
  });

  it("deterministic for an empty log", () => {
    const { deterministic } = verifyDeterministicReplay([], DEV1, TENANT_A);
    expect(deterministic).toBe(true);
  });

  it("deterministic for a single-revision log", () => {
    const revs = [revision(1, { color: "red" })];
    const { deterministic } = verifyDeterministicReplay(revs, DEV1, TENANT_A);
    expect(deterministic).toBe(true);
  });

  it("deterministic across complex nested attributes", () => {
    const revs = [
      revision(1, { telemetry: { temp: 90, humidity: 45 } }),
      revision(2, { telemetry: { temp: 91 } }),
      revision(3, { location: { lat: 1.0, lng: 2.0 } }),
    ];
    const { deterministic } = verifyDeterministicReplay(revs, DEV1, TENANT_A);
    expect(deterministic).toBe(true);
  });

  it("deterministic across many revisions (50+)", () => {
    const revs: TwinRevision[] = [];
    for (let i = 1; i <= 50; i++) revs.push(revision(i, { [`k${i}`]: i }));
    const { deterministic } = verifyDeterministicReplay(revs, DEV1, TENANT_A);
    expect(deterministic).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectConflicts — concurrent revision sequences on the same device.
// ---------------------------------------------------------------------------

describe("twin-engine: conflict detection", () => {
  it("returns no conflicts for a linear log", () => {
    const revs = [
      revisionWithDigest(1, { a: 1 }, "genesis"),
      revisionWithDigest(2, { a: 2 }, "dg_1_genesis"),
      revisionWithDigest(3, { a: 3 }, "dg_2_genesis"),
    ];
    const conflicts = detectConflicts(revs);
    expect(conflicts).toHaveLength(0);
  });

  it("detects a fork — two revisions sharing a parent", () => {
    const revs = [
      revisionWithDigest(1, { a: 1 }, "genesis"),
      revisionWithDigest(2, { a: 2, branch: "A" }, "dg_1_genesis"),
      revisionWithDigest(2, { a: 3, branch: "B" }, "dg_1_genesis"), // same parent, different digest
    ];
    const conflicts = detectConflicts(revs);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.commonParent).toBe("dg_1_genesis");
    expect(conflicts[0]!.branchA.digest).not.toBe(conflicts[0]!.branchB.digest);
  });

  it("does not flag identical revisions sharing a parent as a conflict", () => {
    // Two revisions with the same digest and seq are NOT a conflict —
    // they're the same revision re-applied (idempotent).
    const revs = [
      revisionWithDigest(1, { a: 1 }, "genesis"),
      revisionWithDigest(2, { a: 2 }, "dg_1_genesis"),
      revisionWithDigest(2, { a: 2 }, "dg_1_genesis"),
    ];
    const conflicts = detectConflicts(revs);
    // The two seq=2 revisions have identical digest, so they're NOT a conflict.
    expect(conflicts).toHaveLength(0);
  });

  it("detects multiple forks — two distinct parent forks", () => {
    const revs = [
      revisionWithDigest(1, { a: 1 }, "genesis"),
      revisionWithDigest(2, { a: 2, branch: "A1" }, "dg_1_genesis"),
      revisionWithDigest(2, { a: 3, branch: "B1" }, "dg_1_genesis"), // fork 1
      revisionWithDigest(3, { a: 4, branch: "A2" }, "dg_2_genesis"),
      revisionWithDigest(3, { a: 5, branch: "B2" }, "dg_2_genesis"), // fork 2
    ];
    const conflicts = detectConflicts(revs);
    expect(conflicts).toHaveLength(2);
  });

  it("returns empty for an empty log", () => {
    expect(detectConflicts([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lineage references (A17 — relational model).
// ---------------------------------------------------------------------------

describe("twin-engine: lineage references (A17)", () => {
  it("declares a lineage reference with a stable id, relation, and audit", () => {
    const r = declareLineage({
      lineageId: "lin_alpha01",
      tenantId: TENANT_A,
      fromAssetId: ASSET1,
      toAssetId: ASSET2,
      relation: "asset-part-of-asset",
      declaredAt: NOW,
      declaredBy: "act_admin",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineage.fromAssetId).toBe(ASSET1);
    expect(r.lineage.toAssetId).toBe(ASSET2);
    expect(r.audit.intent).toBe("asset:lineage:asset-part-of-asset");
    expect(r.audit.tenant).toBe(TENANT_A);
  });

  it("refuses malformed lineage id", () => {
    const r = declareLineage({
      lineageId: "bad-id",
      tenantId: TENANT_A,
      fromAssetId: ASSET1,
      toAssetId: ASSET2,
      relation: "asset-part-of-asset",
      declaredAt: NOW,
      declaredBy: "act_admin",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("malformed-lineage-id");
  });

  it("refuses self-reference (fromAssetId === toAssetId)", () => {
    const r = declareLineage({
      lineageId: "lin_beta02",
      tenantId: TENANT_A,
      fromAssetId: ASSET1,
      toAssetId: ASSET1,
      relation: "asset-part-of-asset",
      declaredAt: NOW,
      declaredBy: "act_admin",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("self-reference");
  });

  it("refuses unknown relation kind", () => {
    const r = declareLineage({
      lineageId: "lin_gamma03",
      tenantId: TENANT_A,
      fromAssetId: ASSET1,
      toAssetId: ASSET2,
      relation: "totally-not-real" as LineageRelationKind,
      declaredAt: NOW,
      declaredBy: "act_admin",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unknown-relation");
  });

  it("refuses duplicate lineage (same from/to/relation)", () => {
    const existing = [
      {
        id: "lin_existing_alpha",
        tenantId: TENANT_A,
        fromAssetId: ASSET1,
        toAssetId: ASSET2,
        relation: "asset-part-of-asset" as LineageRelationKind,
        declaredAt: NOW - 1000,
        declaredBy: "act_admin",
      },
    ];
    const r = declareLineage({
      lineageId: "lin_dupl04",
      tenantId: TENANT_A,
      fromAssetId: ASSET1,
      toAssetId: ASSET2,
      relation: "asset-part-of-asset",
      declaredAt: NOW,
      declaredBy: "act_admin",
      existing,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("duplicate-lineage");
  });

  it("allows the same pair with a different relation", () => {
    const existing = [
      {
        id: "lin_a_alpha",
        tenantId: TENANT_A,
        fromAssetId: ASSET1,
        toAssetId: ASSET2,
        relation: "asset-part-of-asset" as LineageRelationKind,
        declaredAt: NOW - 1000,
        declaredBy: "act_admin",
      },
    ];
    const r = declareLineage({
      lineageId: "lin_b_beta",
      tenantId: TENANT_A,
      fromAssetId: ASSET1,
      toAssetId: ASSET2,
      relation: "asset-serviced-by-vendor",
      declaredAt: NOW,
      declaredBy: "act_admin",
      existing,
    });
    expect(r.ok).toBe(true);
  });
});

describe("twin-engine: lineage registry", () => {
  it("registerLineage adds the lineage to the registry", () => {
    let reg = emptyLineageRegistry();
    const r = declareLineage({
      lineageId: "lin_alpha01",
      tenantId: TENANT_A,
      fromAssetId: ASSET1,
      toAssetId: ASSET2,
      relation: "asset-part-of-asset",
      declaredAt: NOW,
      declaredBy: "act_admin",
    });
    if (!r.ok) throw new Error();
    reg = registerLineage(reg, r.lineage);
    expect(reg.byId.size).toBe(1);
  });

  it("listLineageFrom returns outbound lineage for an asset, tenant-fail-closed", () => {
    let reg = emptyLineageRegistry();
    const r = declareLineage({
      lineageId: "lin_alpha01",
      tenantId: TENANT_A,
      fromAssetId: ASSET1,
      toAssetId: ASSET2,
      relation: "asset-part-of-asset",
      declaredAt: NOW,
      declaredBy: "act_admin",
    });
    if (!r.ok) throw new Error();
    reg = registerLineage(reg, r.lineage);
    expect(listLineageFrom(reg, TENANT_A, ASSET1)).toHaveLength(1);
    expect(listLineageFrom(reg, TENANT_B, ASSET1)).toHaveLength(0); // tenant fail-closed
  });

  it("listLineageTo returns inbound lineage for an asset", () => {
    let reg = emptyLineageRegistry();
    const r = declareLineage({
      lineageId: "lin_alpha01",
      tenantId: TENANT_A,
      fromAssetId: ASSET1,
      toAssetId: ASSET2,
      relation: "asset-part-of-asset",
      declaredAt: NOW,
      declaredBy: "act_admin",
    });
    if (!r.ok) throw new Error();
    reg = registerLineage(reg, r.lineage);
    expect(listLineageTo(reg, TENANT_A, ASSET2)).toHaveLength(1);
    expect(listLineageTo(reg, TENANT_A, ASSET1)).toHaveLength(0); // ASSET1 is the source, not the target
  });

  it("listLineageFrom filters by relation kind", () => {
    let reg = emptyLineageRegistry();
    const r1 = declareLineage({
      lineageId: "lin_alpha01",
      tenantId: TENANT_A,
      fromAssetId: ASSET1,
      toAssetId: ASSET2,
      relation: "asset-part-of-asset",
      declaredAt: NOW,
      declaredBy: "act_admin",
    });
    if (!r1.ok) throw new Error();
    reg = registerLineage(reg, r1.lineage);
    const r2 = declareLineage({
      lineageId: "lin_beta02",
      tenantId: TENANT_A,
      fromAssetId: ASSET1,
      toAssetId: ASSET2,
      relation: "asset-serviced-by-vendor",
      declaredAt: NOW + 1,
      declaredBy: "act_admin",
    });
    if (!r2.ok) throw new Error();
    reg = registerLineage(reg, r2.lineage);

    expect(listLineageFrom(reg, TENANT_A, ASSET1)).toHaveLength(2);
    expect(listLineageFrom(reg, TENANT_A, ASSET1, "asset-part-of-asset")).toHaveLength(1);
    expect(listLineageFrom(reg, TENANT_A, ASSET1, "asset-serviced-by-vendor")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle projection per asset.
// ---------------------------------------------------------------------------

describe("twin-engine: lifecycle projection", () => {
  function auditEntry(cmd: LifecycleAuditEntry["command"], at: number): LifecycleAuditEntry {
    return { assetId: ASSET1, tenantId: TENANT_A, command: cmd, at };
  }

  it("projects an empty history into state=admitted", () => {
    const p = projectLifecycle(ASSET1, TENANT_A, []);
    expect(p.state).toBe("admitted");
    expect(p.transitionCount).toBe(0);
  });

  it("admit -> activate produces state=active with enrolledAt", () => {
    const p = projectLifecycle(ASSET1, TENANT_A, [
      auditEntry("admit", NOW),
      auditEntry("activate", NOW + 1000),
    ]);
    expect(p.state).toBe("active");
    expect(p.enrolledAt).toBe(NOW + 1000);
    expect(p.transitionCount).toBe(2);
  });

  it("admit -> activate -> retire produces state=retired", () => {
    const p = projectLifecycle(ASSET1, TENANT_A, [
      auditEntry("admit", NOW),
      auditEntry("activate", NOW + 1000),
      auditEntry("retire", NOW + 2000),
    ]);
    expect(p.state).toBe("retired");
    expect(p.retiredAt).toBe(NOW + 2000);
    expect(p.transitionCount).toBe(3);
  });

  it("ignores audit entries for other assets/tenants", () => {
    const p = projectLifecycle(ASSET1, TENANT_A, [
      auditEntry("admit", NOW),
      { assetId: ASSET2, tenantId: TENANT_A, command: "retire", at: NOW + 1 },
      { assetId: ASSET1, tenantId: TENANT_B, command: "retire", at: NOW + 2 },
    ]);
    expect(p.state).toBe("admitted"); // only the matching admit was applied
    expect(p.transitionCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Enrollment boundary — an observation from an unenrolled device is refused.
// ---------------------------------------------------------------------------

describe("twin-engine: enrollment boundary", () => {
  it("checkEnrollment refuses a null enrollment record", () => {
    const r = checkEnrollment(null, TENANT_A, DEV1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("device-not-enrolled");
  });

  it("checkEnrollment refuses a revoked enrollment", () => {
    const rec: EnrollmentRecord = {
      deviceId: DEV1,
      tenantId: TENANT_A,
      enrolledAt: NOW,
      revokedAt: NOW + 1000,
    };
    const r = checkEnrollment(rec, TENANT_A, DEV1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("device-enrollment-revoked");
  });

  it("checkEnrollment refuses a tenant-mismatch enrollment", () => {
    const rec: EnrollmentRecord = {
      deviceId: DEV1,
      tenantId: TENANT_B,
      enrolledAt: NOW,
      revokedAt: null,
    };
    const r = checkEnrollment(rec, TENANT_A, DEV1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("device-tenant-mismatch");
  });

  it("checkEnrollment accepts a valid active enrollment", () => {
    const rec: EnrollmentRecord = {
      deviceId: DEV1,
      tenantId: TENANT_A,
      enrolledAt: NOW,
      revokedAt: null,
    };
    const r = checkEnrollment(rec, TENANT_A, DEV1);
    expect(r.ok).toBe(true);
  });
});

describe("twin-engine: EnrollmentDirectory", () => {
  it("enroll creates a new enrollment record + audit", () => {
    const dir = new EnrollmentDirectory(new InMemoryEnrollmentRegistry());
    const r = dir.enroll({
      deviceId: DEV1,
      tenantId: TENANT_A,
      enrolledAt: NOW,
      actor: "act_admin",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.enrollment.deviceId).toBe(DEV1);
    expect(r.enrollment.revokedAt).toBeNull();
    expect(r.audit.intent).toBe("asset:enroll");
  });

  it("refuses to enroll the same device twice (duplicate-enrollment)", () => {
    const dir = new EnrollmentDirectory(new InMemoryEnrollmentRegistry());
    dir.enroll({ deviceId: DEV1, tenantId: TENANT_A, enrolledAt: NOW, actor: "act_admin" });
    const r2 = dir.enroll({ deviceId: DEV1, tenantId: TENANT_A, enrolledAt: NOW + 1, actor: "act_admin" });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.reason).toBe("duplicate-enrollment");
  });

  it("revokes an active enrollment", () => {
    const dir = new EnrollmentDirectory(new InMemoryEnrollmentRegistry());
    dir.enroll({ deviceId: DEV1, tenantId: TENANT_A, enrolledAt: NOW, actor: "act_admin" });
    const r = dir.revoke({ tenantId: TENANT_A, deviceId: DEV1, revokedAt: NOW + 1000, actor: "act_admin" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.enrollment.revokedAt).toBe(NOW + 1000);
    expect(r.audit.intent).toBe("asset:enroll:revoke");
  });

  it("refuses to revoke an already-revoked enrollment", () => {
    const dir = new EnrollmentDirectory(new InMemoryEnrollmentRegistry());
    dir.enroll({ deviceId: DEV1, tenantId: TENANT_A, enrolledAt: NOW, actor: "act_admin" });
    dir.revoke({ tenantId: TENANT_A, deviceId: DEV1, revokedAt: NOW + 1000, actor: "act_admin" });
    const r = dir.revoke({ tenantId: TENANT_A, deviceId: DEV1, revokedAt: NOW + 2000, actor: "act_admin" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("already-revoked");
  });

  it("refuses to revoke an unknown enrollment", () => {
    const dir = new EnrollmentDirectory(new InMemoryEnrollmentRegistry());
    const r = dir.revoke({ tenantId: TENANT_A, deviceId: DEV1, revokedAt: NOW, actor: "act_admin" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("unknown-enrollment");
  });

  it("refuses malformed deviceId", () => {
    const dir = new EnrollmentDirectory(new InMemoryEnrollmentRegistry());
    const r = dir.enroll({ deviceId: "bad", tenantId: TENANT_A, enrolledAt: NOW, actor: "act_admin" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("malformed-device-id");
  });

  it("refuses missing tenantId", () => {
    const dir = new EnrollmentDirectory(new InMemoryEnrollmentRegistry());
    const r = dir.enroll({ deviceId: DEV1, tenantId: "", enrolledAt: NOW, actor: "act_admin" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("missing-tenant-id");
  });

  it("allows re-enrollment after a revocation (revoked device, new enrollment)", () => {
    const dir = new EnrollmentDirectory(new InMemoryEnrollmentRegistry());
    dir.enroll({ deviceId: DEV1, tenantId: TENANT_A, enrolledAt: NOW, actor: "act_admin" });
    dir.revoke({ tenantId: TENANT_A, deviceId: DEV1, revokedAt: NOW + 1000, actor: "act_admin" });
    const r = dir.enroll({ deviceId: DEV1, tenantId: TENANT_A, enrolledAt: NOW + 2000, actor: "act_admin" });
    expect(r.ok).toBe(true);
  });

  it("gateObservationOnEnrollment refuses an unenrolled device with machine-stable reason", () => {
    const dir = new EnrollmentDirectory(new InMemoryEnrollmentRegistry());
    const r = gateObservationOnEnrollment(dir, TENANT_A, DEV1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("device-not-enrolled");
  });

  it("gateObservationOnEnrollment accepts an enrolled device", () => {
    const dir = new EnrollmentDirectory(new InMemoryEnrollmentRegistry());
    dir.enroll({ deviceId: DEV1, tenantId: TENANT_A, enrolledAt: NOW, actor: "act_admin" });
    const r = gateObservationOnEnrollment(dir, TENANT_A, DEV1);
    expect(r.ok).toBe(true);
  });
});
