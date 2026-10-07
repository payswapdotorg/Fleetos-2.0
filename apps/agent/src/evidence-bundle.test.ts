/**
 * @fleetos/agent — Wave 3 evidence bundle tests (F230A).
 *
 * Covers:
 *   - computeBundleDigest: deterministic over sorted observations
 *   - buildBundle: produces digest + agentSignature
 *   - verifyBundleSignature: true for correct key; false for wrong key
 *   - EvidenceBundleStore: append + bounded overflow + duplicate-bundle-id refusal
 *   - markUploaded: removes from pending; adds to uploaded (bounded)
 *   - pendingBundles + isUploaded: agent-side retransmit helpers
 *   - Tenant isolation: tenant-mismatch refused
 *   - Audit determinism
 */

import { describe, it, expect } from "vitest";
import {
  appendBundle,
  buildBundle,
  computeBundleDigest,
  emptyBundleStore,
  isUploaded,
  markUploaded,
  pendingBundles,
  verifyBundleSignature,
  type BundleObservation,
} from "./evidence-bundle.js";

const NOW = 1_727_000_000_000;
const AGENT = "agent-001";
const TENANT = "tnt_acme";
const DEVICE = "dev_truck-001";
const KEY = "agent-secret";

function mkObs(seq: number, deviceId = DEVICE, payloadDigest = `pd-${seq}`): BundleObservation {
  return { deviceId, seq, observedAt: NOW + seq, kind: "telemetry.temp", payloadDigest };
}

function mkBundle(id: string, seq: number, obs: ReadonlyArray<BundleObservation> = [mkObs(seq)], tenantId = TENANT) {
  return buildBundle({ id, tenantId, deviceId: DEVICE, seq, observations: obs, createdAt: NOW, agentKey: KEY });
}

// ---------------------------------------------------------------------------
// Bundle digest + signature
// ---------------------------------------------------------------------------

describe("agent evidence-bundle: digest + signature", () => {
  it("computeBundleDigest is deterministic over identical inputs", () => {
    const obs = [mkObs(1), mkObs(2), mkObs(3)];
    expect(computeBundleDigest(obs)).toBe(computeBundleDigest(obs));
  });

  it("computeBundleDigest is order-independent (sorted canonical form)", () => {
    const a = [mkObs(1), mkObs(2), mkObs(3)];
    const b = [mkObs(3), mkObs(1), mkObs(2)];
    expect(computeBundleDigest(a)).toBe(computeBundleDigest(b));
  });

  it("buildBundle produces digest + agentSignature", () => {
    const b = mkBundle("b1", 1);
    expect(b.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(b.agentSignature).toMatch(/^[0-9a-f]{64}$/);
    expect(b.uploadedAt).toBeNull();
  });

  it("verifyBundleSignature: true for correct key", () => {
    const b = mkBundle("b1", 1);
    expect(verifyBundleSignature(b, KEY)).toBe(true);
  });

  it("verifyBundleSignature: false for wrong key", () => {
    const b = mkBundle("b1", 1);
    expect(verifyBundleSignature(b, "wrong-key")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EvidenceBundleStore append + overflow
// ---------------------------------------------------------------------------

describe("agent evidence-bundle: store append + overflow", () => {
  it("appends a new bundle to the pending list", () => {
    const store = emptyBundleStore(AGENT, TENANT);
    const r = appendBundle(store, mkBundle("b1", 1));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.store.pending).toHaveLength(1);
  });

  it("refuses missing bundle id", () => {
    const store = emptyBundleStore(AGENT, TENANT);
    const r = appendBundle(store, mkBundle("", 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-bundle-id");
  });

  it("refuses tenant-mismatch", () => {
    const store = emptyBundleStore(AGENT, TENANT);
    const r = appendBundle(store, mkBundle("b1", 1, [mkObs(1)], "tnt_other"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("tenant-mismatch");
  });

  it("refuses duplicate bundle id", () => {
    const store = emptyBundleStore(AGENT, TENANT);
    const r1 = appendBundle(store, mkBundle("b1", 1));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = appendBundle(r1.store, mkBundle("b1", 1));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("duplicate-bundle-id");
  });

  it("overflow is refuse-and-retry (NEVER silent drop)", () => {
    const store = emptyBundleStore(AGENT, TENANT, 2);
    const r1 = appendBundle(store, mkBundle("b1", 1));
    const r2 = appendBundle(r1.ok ? r1.store : store, mkBundle("b2", 2));
    const r3 = appendBundle(r2.ok ? r2.store : store, mkBundle("b3", 3));
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reason).toBe("overflow-refused");
    // First two are still pending.
    if (r2.ok) expect(r2.store.pending).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// markUploaded + pendingBundles + isUploaded
// ---------------------------------------------------------------------------

describe("agent evidence-bundle: upload lifecycle", () => {
  it("markUploaded removes from pending; adds to uploaded", () => {
    const store0 = emptyBundleStore(AGENT, TENANT);
    const r1 = appendBundle(store0, mkBundle("b1", 1));
    if (!r1.ok) return;
    const r2 = appendBundle(r1.store, mkBundle("b2", 2));
    if (!r2.ok) return;
    const acked = markUploaded(r2.store, "b1", NOW + 100);
    expect(acked.store.pending).toHaveLength(1);
    expect(acked.store.pending[0]!.id).toBe("b2");
    expect(acked.audit).not.toBeNull();
    expect(isUploaded(acked.store, "b1")).toBe(true);
    expect(isUploaded(acked.store, "b2")).toBe(false);
  });

  it("markUploaded on unknown id is a no-op (no audit)", () => {
    const store = emptyBundleStore(AGENT, TENANT);
    const acked = markUploaded(store, "no-such-bundle", NOW);
    expect(acked.store.pending).toHaveLength(0);
    expect(acked.audit).toBeNull();
  });

  it("pendingBundles returns the pending list in insertion order", () => {
    let store = emptyBundleStore(AGENT, TENANT);
    { const _r = appendBundle(store, mkBundle("b1", 1)); if (_r.ok) store = _r.store; }
    { const _r = appendBundle(store, mkBundle("b2", 2)); if (_r.ok) store = _r.store; }
    { const _r = appendBundle(store, mkBundle("b3", 3)); if (_r.ok) store = _r.store; }
    const pending = pendingBundles(store);
    expect(pending.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("uploaded set is bounded (oldest evicted when full)", () => {
    let store = emptyBundleStore(AGENT, TENANT, 4);
    for (let i = 0; i < 4; i++) {
      const r = appendBundle(store, mkBundle(`b${i}`, i + 1));
      if (r.ok) store = r.store;
    }
    // Mark all 4 as uploaded — fills the uploaded set.
    for (let i = 0; i < 4; i++) {
      const r = markUploaded(store, `b${i}`, NOW + i);
      store = r.store;
    }
    expect(store.uploaded.size).toBe(4);
    // Adding a 5th should evict ~25% (1 entry).
    const r = appendBundle(store, mkBundle("b4", 5));
    if (r.ok) store = r.store;
    const acked = markUploaded(store, "b4", NOW + 100);
    expect(acked.store.uploaded.size).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe("agent evidence-bundle: tenant isolation", () => {
  it("two tenants' stores are disjoint", () => {
    const sA = emptyBundleStore(AGENT, TENANT);
    const sB = emptyBundleStore(AGENT, "tnt_other");
    const rA = appendBundle(sA, mkBundle("bA", 1));
    const rB = appendBundle(sB, mkBundle("bB", 1, [mkObs(1)], "tnt_other"));
    expect(rA.ok).toBe(true);
    expect(rB.ok).toBe(true);
    if (rA.ok && rB.ok) {
      expect(rA.store.pending.some((b) => b.id === "bB")).toBe(false);
      expect(rB.store.pending.some((b) => b.id === "bA")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Audit determinism
// ---------------------------------------------------------------------------

describe("agent evidence-bundle: audit determinism", () => {
  it("identical append produces identical audit digest", () => {
    const r1 = appendBundle(emptyBundleStore(AGENT, TENANT), mkBundle("b1", 1));
    const r2 = appendBundle(emptyBundleStore(AGENT, TENANT), mkBundle("b1", 1));
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.audit.digest).toBe(r2.audit.digest);
  });
});
