import { describe, it, expect } from "vitest";
import {
  admitTwinRevision,
  AssetDirectory,
  InMemoryAssetRepository,
  projectTwin,
  type TwinAdmissionInput,
} from "./kernel.js";
import type { DeviceId, DeviceTwin } from "./assets.js";

const NOW = 1_727_000_000_000;
const DEV1 = "dev_truck-001" as DeviceId;
const TENANT_A = "tnt_acme";

function obsRef(digest: string): { deviceId: string; seq: number; observedAt: number; payloadDigest: string } {
  return { deviceId: DEV1, seq: 1, observedAt: NOW, payloadDigest: digest };
}

function genesisInput(
  seq: number,
  observedAt: number = NOW,
  attrs: Record<string, unknown> = { engineTemp: 90 },
  observationRef?: TwinAdmissionInput["observationRef"],
): TwinAdmissionInput {
  return {
    deviceId: DEV1,
    tenantId: TENANT_A,
    seq,
    observedAt,
    appliedAt: NOW,
    source: "observation",
    attributes: attrs,
    observationRef,
    actor: "act_a-001",
  };
}

describe("assets kernel: admitTwinRevision genesis", () => {
  it("admits a genesis revision with seq=1 and emits audit", () => {
    const r = admitTwinRevision(null, genesisInput(1));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.twin.revisions).toHaveLength(1);
      expect(r.twin.lastSeq).toBe(1);
      expect(r.revision.revisionDigest).toBeTruthy();
      expect(r.audit.intent).toBe("twin:admit:genesis");
    }
  });

  it("rejects genesis with seq < 1 (non-monotonic-seq)", () => {
    const r = admitTwinRevision(null, genesisInput(0));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("non-monotonic-seq");
  });

  it("rejects genesis with malformed attributes (array)", () => {
    const r = admitTwinRevision(null, {
      ...genesisInput(1),
      attributes: [1, 2, 3] as unknown as Readonly<Record<string, unknown>>,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-attributes");
  });

  it("rejects genesis with empty device id (unknown-device)", () => {
    const r = admitTwinRevision(null, { ...genesisInput(1), deviceId: "" as DeviceId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-device");
  });

  it("rejects genesis with invalid observation digest (non-64-hex)", () => {
    const r = admitTwinRevision(null, genesisInput(1, NOW, { a: 1 }, obsRef("deadbeef")));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-observation-digest");
  });

  it("accepts genesis with valid 64-hex observation digest", () => {
    const d = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const r = admitTwinRevision(null, genesisInput(1, NOW, { a: 1 }, obsRef(d)));
    expect(r.ok).toBe(true);
  });

  it("rejects genesis with a non-genesis parentDigest (phantom prior)", () => {
    const r = admitTwinRevision(null, { ...genesisInput(1), parentDigest: "fakehash" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("conflict-parent-digest-mismatch");
  });
});

describe("assets kernel: admitTwinRevision append + conflict refusal", () => {
  it("appends a revision with strictly greater seq and matching parentDigest", () => {
    const g = admitTwinRevision(null, genesisInput(1));
    if (!g.ok) throw new Error("genesis failed");
    const headDigest = g.revision.revisionDigest;
    const r = admitTwinRevision(g.twin, {
      ...genesisInput(2, NOW + 1000, { engineTemp: 95 }),
      parentDigest: headDigest,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.twin.revisions).toHaveLength(2);
      expect(r.twin.lastSeq).toBe(2);
    }
  });

  it("rejects append with seq <= lastSeq (non-monotonic)", () => {
    const g = admitTwinRevision(null, genesisInput(1));
    if (!g.ok) throw new Error("genesis failed");
    const r = admitTwinRevision(g.twin, { ...genesisInput(1, NOW + 1000) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("non-monotonic-seq");
  });

  it("rejects append with stale observedAt (time-travel)", () => {
    const g = admitTwinRevision(null, genesisInput(1, NOW + 5000));
    if (!g.ok) throw new Error("genesis failed");
    const r = admitTwinRevision(g.twin, { ...genesisInput(2, NOW), parentDigest: g.revision.revisionDigest });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("stale-observed-at");
  });

  it("rejects append with mismatched parentDigest (conflict)", () => {
    const g = admitTwinRevision(null, genesisInput(1));
    if (!g.ok) throw new Error("genesis failed");
    const r = admitTwinRevision(g.twin, {
      ...genesisInput(2, NOW + 1000),
      parentDigest: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef00",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("conflict-parent-digest-mismatch");
  });

  it("audit digest is deterministic for identical inputs", () => {
    const a = admitTwinRevision(null, genesisInput(1));
    const b = admitTwinRevision(null, genesisInput(1));
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.audit.digest).toBe(b.audit.digest);
    expect(a.revision.revisionDigest).toBe(b.revision.revisionDigest);
  });

  it("revisionDigest changes when attributes change (tamper-evident)", () => {
    const a = admitTwinRevision(null, genesisInput(1, NOW, { engineTemp: 90 }));
    const b = admitTwinRevision(null, genesisInput(1, NOW, { engineTemp: 95 }));
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.revision.revisionDigest).not.toBe(b.revision.revisionDigest);
  });

  it("does not mutate input twin (immutability check)", () => {
    const g = admitTwinRevision(null, genesisInput(1));
    if (!g.ok) throw new Error("genesis failed");
    const beforeLen = g.twin.revisions.length;
    const frozen: DeviceTwin = g.twin;
    admitTwinRevision(frozen, { ...genesisInput(2, NOW + 1000), parentDigest: g.revision.revisionDigest });
    expect(g.twin.revisions.length).toBe(beforeLen);
  });

  it("manual-source revisions without observationRef are admitted (observationDigest=manual)", () => {
    const g = admitTwinRevision(null, { ...genesisInput(1), source: "manual", observationRef: undefined });
    expect(g.ok).toBe(true);
  });
});

describe("assets kernel: projectTwin honest degradation", () => {
  it("returns state=unknown for empty revisions", () => {
    const p = projectTwin([], DEV1, TENANT_A);
    expect(p.state).toBe("unknown");
    expect(p.attributes).toEqual({});
    expect(p.lastSeq).toBeNull();
    expect(p.headDigest).toBeNull();
  });

  it("returns state=pending when only manual revisions exist", () => {
    const g = admitTwinRevision(null, { ...genesisInput(1), source: "manual" });
    if (!g.ok) throw new Error("genesis failed");
    const p = projectTwin(g.twin.revisions, DEV1, TENANT_A);
    expect(p.state).toBe("pending");
  });

  it("returns state=current when at least one observation revision exists", () => {
    const g = admitTwinRevision(null, genesisInput(1));
    if (!g.ok) throw new Error("genesis failed");
    const p = projectTwin(g.twin.revisions, DEV1, TENANT_A);
    expect(p.state).toBe("current");
  });

  it("folds attributes — later wins", () => {
    const g = admitTwinRevision(null, genesisInput(1, NOW, { engineTemp: 90, status: "ok" }));
    if (!g.ok) throw new Error("genesis failed");
    const next = admitTwinRevision(g.twin, {
      ...genesisInput(2, NOW + 1000, { engineTemp: 95 }),
      parentDigest: g.revision.revisionDigest,
    });
    if (!next.ok) throw new Error("append failed");
    const p = projectTwin(next.twin.revisions, DEV1, TENANT_A);
    expect(p.attributes).toEqual({ engineTemp: 95, status: "ok" });
  });

  it("carries headDigest = last revision's digest", () => {
    const g = admitTwinRevision(null, genesisInput(1));
    if (!g.ok) throw new Error("genesis failed");
    const p = projectTwin(g.twin.revisions, DEV1, TENANT_A);
    expect(p.headDigest).toBe(g.revision.revisionDigest);
  });

  it("carries lastSeq and lastObservedAt from the head", () => {
    const g = admitTwinRevision(null, genesisInput(7, NOW + 5000));
    if (!g.ok) throw new Error("genesis failed");
    const p = projectTwin(g.twin.revisions, DEV1, TENANT_A);
    expect(p.lastSeq).toBe(7);
    expect(p.lastObservedAt).toBe(NOW + 5000);
  });
});

describe("assets kernel: AssetDirectory lifecycle admission", () => {
  function makeDir() {
    return new AssetDirectory(new InMemoryAssetRepository());
  }

  it("admitAsset creates an asset in the admitted state", () => {
    const dir = makeDir();
    const r = dir.admitAsset({
      assetId: "ast_truck-001",
      tenantId: TENANT_A,
      kind: "vehicle",
      displayName: "Truck 1",
      createdAt: NOW,
      actor: "act_admin-001",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.asset.lifecycle).toBe("admitted");
      expect(r.audit.intent).toBe("asset:admit");
    }
  });

  it("refuses malformed asset id", () => {
    const dir = makeDir();
    const r = dir.admitAsset({ assetId: "bad", tenantId: TENANT_A, kind: "vehicle", displayName: "x", createdAt: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-asset-id");
  });

  it("refuses empty display name", () => {
    const dir = makeDir();
    const r = dir.admitAsset({ assetId: "ast_truck-001", tenantId: TENANT_A, kind: "vehicle", displayName: "", createdAt: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-display-name");
  });

  it("refuses invalid createdAt", () => {
    const dir = makeDir();
    const r = dir.admitAsset({ assetId: "ast_truck-001", tenantId: TENANT_A, kind: "vehicle", displayName: "x", createdAt: NaN, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-created-at");
  });

  it("refuses duplicate asset (same id, same tenant)", () => {
    const dir = makeDir();
    dir.admitAsset({ assetId: "ast_truck-001", tenantId: TENANT_A, kind: "vehicle", displayName: "x", createdAt: NOW, actor: "a" });
    const r = dir.admitAsset({ assetId: "ast_truck-001", tenantId: TENANT_A, kind: "vehicle", displayName: "y", createdAt: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duplicate-asset");
  });

  it("admits the same asset id under different tenants (no duplicate-tenant collision)", () => {
    const dir = makeDir();
    dir.admitAsset({ assetId: "ast_truck-001", tenantId: TENANT_A, kind: "vehicle", displayName: "x", createdAt: NOW, actor: "a" });
    const r = dir.admitAsset({ assetId: "ast_truck-001", tenantId: "tnt_other", kind: "vehicle", displayName: "y", createdAt: NOW, actor: "a" });
    expect(r.ok).toBe(true);
  });

  it("transitionAsset: admitted -> active via activate (enrolledAt set)", () => {
    const dir = makeDir();
    dir.admitAsset({ assetId: "ast_truck-001", tenantId: TENANT_A, kind: "vehicle", displayName: "x", createdAt: NOW, actor: "a" });
    const r = dir.transitionAsset({ tenantId: TENANT_A, assetId: "ast_truck-001" as never, command: "activate", at: NOW + 1000, actor: "a" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.asset.lifecycle).toBe("active");
      expect(r.asset.enrolledAt).toBe(NOW + 1000);
      expect(r.audit.intent).toBe("asset:activate");
    }
  });

  it("transitionAsset: active -> retired via retire (retiredAt set)", () => {
    const dir = makeDir();
    dir.admitAsset({ assetId: "ast_truck-001", tenantId: TENANT_A, kind: "vehicle", displayName: "x", createdAt: NOW, actor: "a" });
    dir.transitionAsset({ tenantId: TENANT_A, assetId: "ast_truck-001" as never, command: "activate", at: NOW + 1000, actor: "a" });
    const r = dir.transitionAsset({ tenantId: TENANT_A, assetId: "ast_truck-001" as never, command: "retire", at: NOW + 2000, actor: "a" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.asset.lifecycle).toBe("retired");
      expect(r.asset.retiredAt).toBe(NOW + 2000);
    }
  });

  it("transitionAsset: retired -> activate -> illegal-transition", () => {
    const dir = makeDir();
    dir.admitAsset({ assetId: "ast_truck-001", tenantId: TENANT_A, kind: "vehicle", displayName: "x", createdAt: NOW, actor: "a" });
    dir.transitionAsset({ tenantId: TENANT_A, assetId: "ast_truck-001" as never, command: "activate", at: NOW + 1000, actor: "a" });
    dir.transitionAsset({ tenantId: TENANT_A, assetId: "ast_truck-001" as never, command: "retire", at: NOW + 2000, actor: "a" });
    const r = dir.transitionAsset({ tenantId: TENANT_A, assetId: "ast_truck-001" as never, command: "activate", at: NOW + 3000, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("illegal-transition");
  });

  it("transitionAsset: activate from active -> illegal-transition (Wave 0 contract preserves this)", () => {
    const dir = makeDir();
    dir.admitAsset({ assetId: "ast_truck-001", tenantId: TENANT_A, kind: "vehicle", displayName: "x", createdAt: NOW, actor: "a" });
    dir.transitionAsset({ tenantId: TENANT_A, assetId: "ast_truck-001" as never, command: "activate", at: NOW + 1000, actor: "a" });
    const r = dir.transitionAsset({ tenantId: TENANT_A, assetId: "ast_truck-001" as never, command: "activate", at: NOW + 2000, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("illegal-transition");
  });

  it("transitionAsset: unknown asset -> unknown-asset", () => {
    const dir = makeDir();
    const r = dir.transitionAsset({ tenantId: TENANT_A, assetId: "ast_unknown-999" as never, command: "activate", at: NOW, actor: "a" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown-asset");
  });

  it("lookupAsset is tenant-scoped (cross-tenant lookup returns null)", () => {
    const dir = makeDir();
    dir.admitAsset({ assetId: "ast_truck-001", tenantId: TENANT_A, kind: "vehicle", displayName: "x", createdAt: NOW, actor: "a" });
    expect(dir.lookupAsset(TENANT_A, "ast_truck-001" as never)).not.toBeNull();
    expect(dir.lookupAsset("tnt_other", "ast_truck-001" as never)).toBeNull();
  });

  it("listAssets returns only the requested tenant's assets", () => {
    const dir = makeDir();
    dir.admitAsset({ assetId: "ast_truck-001", tenantId: TENANT_A, kind: "vehicle", displayName: "x", createdAt: NOW, actor: "a" });
    dir.admitAsset({ assetId: "ast_truck-002", tenantId: "tnt_other", kind: "vehicle", displayName: "y", createdAt: NOW, actor: "a" });
    expect(dir.listAssets(TENANT_A)).toHaveLength(1);
    expect(dir.listAssets("tnt_other")).toHaveLength(1);
  });
});
