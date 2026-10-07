/**
 * @fleetos/observations — Wave 3 store-and-forward tests (F230A).
 *
 * Covers:
 *   - Bundle digest: deterministic over sorted observations
 *   - Bundle signature: sign + verify (constant-time-ish comparison)
 *   - Bundle integrity: digest matches observations
 *   - receiveBundle: signature verification refuses forged bundle
 *   - receiveBundle: integrity verification refuses tampered bundle
 *   - receiveBundle: duplicate bundle returns idempotent ack (no re-admission)
 *   - receiveBundle: per-observation dedup counts admitted vs duplicates
 *   - Gap detection: missing seqs surface as typed GapMarkers (never silent holes)
 *   - Sequence report: known gaps computed from the reception log
 *   - Tenant isolation: log is per-tenant (caller constructs one per tenant)
 */

import { describe, it, expect } from "vitest";
import {
  assertLogTenantScope,
  buildSequenceReport,
  computeBundleDigest,
  emptyBundleReceptionLog,
  makeGapMarker,
  receiveBundle,
  signBundle,
  verifyBundleIntegrity,
  verifyBundleSignature,
  type BundleObservation,
  type ObservationBundle,
} from "./store-forward.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const DEVICE_1 = "dev_truck-001";
const AGENT_KEY = "agent-secret-key";

function mkObs(seq: number, deviceId = DEVICE_1, payloadDigest = `pd-${seq}`): BundleObservation {
  return { deviceId, seq, observedAt: NOW + seq, kind: "telemetry.temp", payloadDigest };
}

function mkBundle(
  id: string,
  seq: number,
  observations: ReadonlyArray<BundleObservation>,
  tenantId = TENANT_A,
  deviceId = DEVICE_1,
): ObservationBundle {
  const partial = { id, tenantId, deviceId, seq, observations, createdAt: NOW };
  return signBundle(partial, AGENT_KEY);
}

// ---------------------------------------------------------------------------
// Bundle digest
// ---------------------------------------------------------------------------

describe("observations store-forward: bundle digest", () => {
  it("computeBundleDigest is deterministic over identical inputs", () => {
    const obs = [mkObs(1), mkObs(2), mkObs(3)];
    expect(computeBundleDigest(obs)).toBe(computeBundleDigest(obs));
  });

  it("computeBundleDigest is order-independent (sorted canonical form)", () => {
    const a = [mkObs(1), mkObs(2), mkObs(3)];
    const b = [mkObs(3), mkObs(1), mkObs(2)];
    expect(computeBundleDigest(a)).toBe(computeBundleDigest(b));
  });

  it("computeBundleDigest differs for different observations", () => {
    const a = [mkObs(1), mkObs(2)];
    const b = [mkObs(1), mkObs(2, DEVICE_1, "different-digest")];
    expect(computeBundleDigest(a)).not.toBe(computeBundleDigest(b));
  });

  it("computeBundleDigest produces 64-char hex", () => {
    expect(computeBundleDigest([mkObs(1)])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("computeBundleDigest is stable for empty observation list", () => {
    expect(computeBundleDigest([])).toBe(computeBundleDigest([]));
  });
});

// ---------------------------------------------------------------------------
// Bundle signature + integrity
// ---------------------------------------------------------------------------

describe("observations store-forward: signature + integrity", () => {
  it("signBundle produces a bundle with digest + agentSignature", () => {
    const b = mkBundle("bundle-1", 1, [mkObs(1), mkObs(2)]);
    expect(b.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(b.agentSignature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifyBundleSignature: true for the correct agent key", () => {
    const b = mkBundle("bundle-1", 1, [mkObs(1)]);
    expect(verifyBundleSignature(b, AGENT_KEY)).toBe(true);
  });

  it("verifyBundleSignature: false for the wrong agent key", () => {
    const b = mkBundle("bundle-1", 1, [mkObs(1)]);
    expect(verifyBundleSignature(b, "wrong-key")).toBe(false);
  });

  it("verifyBundleIntegrity: true for a freshly signed bundle", () => {
    const b = mkBundle("bundle-1", 1, [mkObs(1), mkObs(2)]);
    expect(verifyBundleIntegrity(b)).toBe(true);
  });

  it("verifyBundleIntegrity: false for a tampered bundle (observation added post-sign)", () => {
    const b = mkBundle("bundle-1", 1, [mkObs(1), mkObs(2)]);
    const tampered: ObservationBundle = { ...b, observations: [...b.observations, mkObs(3)] };
    expect(verifyBundleIntegrity(tampered)).toBe(false);
  });

  it("verifyBundleIntegrity: false for a tampered bundle (digest replaced)", () => {
    const b = mkBundle("bundle-1", 1, [mkObs(1)]);
    const tampered: ObservationBundle = { ...b, digest: "0".repeat(64) };
    expect(verifyBundleIntegrity(tampered)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// receiveBundle — happy path
// ---------------------------------------------------------------------------

describe("observations store-forward: receiveBundle happy path", () => {
  it("admits a fresh bundle and returns a typed ack", () => {
    const log = emptyBundleReceptionLog();
    const bundle = mkBundle("bundle-1", 1, [mkObs(1), mkObs(2)]);
    const r = receiveBundle(log, bundle, AGENT_KEY, NOW, () => false);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ack.bundleId).toBe("bundle-1");
      expect(r.ack.duplicate).toBe(false);
      expect(r.ack.admittedCount).toBe(2);
      expect(r.ack.duplicateCount).toBe(0);
      expect(r.ack.gaps).toHaveLength(0);
      expect(r.audit.intent).toBe("observations:bundle:receive");
    }
  });

  it("per-observation dedup counts admitted vs duplicates", () => {
    const log = emptyBundleReceptionLog();
    const bundle = mkBundle("bundle-1", 1, [mkObs(1), mkObs(2), mkObs(3)]);
    // Observations 1 and 3 are duplicates; 2 is new.
    const r = receiveBundle(log, bundle, AGENT_KEY, NOW, (obs) => obs.seq === 1 || obs.seq === 3);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ack.admittedCount).toBe(1);
      expect(r.ack.duplicateCount).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// receiveBundle — refusals
// ---------------------------------------------------------------------------

describe("observations store-forward: receiveBundle refusals", () => {
  it("refuses missing bundle id", () => {
    const bundle = mkBundle("", 1, [mkObs(1)]);
    const r = receiveBundle(emptyBundleReceptionLog(), bundle, AGENT_KEY, NOW, () => false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-bundle-id");
  });

  it("refuses missing tenant id", () => {
    const partial = { id: "b1", tenantId: "", deviceId: DEVICE_1, seq: 1, observations: [mkObs(1)], createdAt: NOW };
    const bundle = signBundle(partial, AGENT_KEY);
    const r = receiveBundle(emptyBundleReceptionLog(), bundle, AGENT_KEY, NOW, () => false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-tenant-id");
  });

  it("refuses missing device id", () => {
    const partial = { id: "b1", tenantId: TENANT_A, deviceId: "", seq: 1, observations: [mkObs(1, "")], createdAt: NOW };
    const bundle = signBundle(partial, AGENT_KEY);
    const r = receiveBundle(emptyBundleReceptionLog(), bundle, AGENT_KEY, NOW, () => false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-device-id");
  });

  it("refuses invalid seq (zero)", () => {
    const partial = { id: "b1", tenantId: TENANT_A, deviceId: DEVICE_1, seq: 0, observations: [mkObs(1)], createdAt: NOW };
    const bundle = signBundle(partial, AGENT_KEY);
    const r = receiveBundle(emptyBundleReceptionLog(), bundle, AGENT_KEY, NOW, () => false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-seq");
  });

  it("refuses bundle with invalid signature (wrong agent key)", () => {
    const bundle = mkBundle("b1", 1, [mkObs(1)]);
    const r = receiveBundle(emptyBundleReceptionLog(), bundle, "wrong-key", NOW, () => false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("signature-invalid");
  });

  it("refuses bundle with tampered integrity (observations modified post-sign)", () => {
    const b = mkBundle("b1", 1, [mkObs(1)]);
    const tampered: ObservationBundle = { ...b, observations: [...b.observations, mkObs(2)] };
    const r = receiveBundle(emptyBundleReceptionLog(), tampered, AGENT_KEY, NOW, () => false);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("integrity-invalid");
  });
});

// ---------------------------------------------------------------------------
// receiveBundle — duplicate bundles (idempotent, no re-admission)
// ---------------------------------------------------------------------------

describe("observations store-forward: duplicate bundles", () => {
  it("re-delivered bundle returns duplicate=true with no re-admission", () => {
    const log0 = emptyBundleReceptionLog();
    const bundle = mkBundle("bundle-1", 1, [mkObs(1), mkObs(2)]);
    const r1 = receiveBundle(log0, bundle, AGENT_KEY, NOW, () => false);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.ack.duplicate).toBe(false);
    expect(r1.ack.admittedCount).toBe(2);

    // Re-deliver the same bundle — should be a duplicate.
    const r2 = receiveBundle(r1.log, bundle, AGENT_KEY, NOW + 1000, () => {
      throw new Error("should not be called for duplicate bundle");
    });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.ack.duplicate).toBe(true);
      expect(r2.ack.admittedCount).toBe(0);
      expect(r2.ack.duplicateCount).toBe(2); // all observations counted as duplicates
      expect(r2.audit.intent).toBe("observations:bundle:receive:duplicate");
    }
  });

  it("duplicate bundle leaves the log unchanged (idempotent)", () => {
    const bundle = mkBundle("bundle-1", 1, [mkObs(1)]);
    const r1 = receiveBundle(emptyBundleReceptionLog(), bundle, AGENT_KEY, NOW, () => false);
    if (!r1.ok) return;
    const r2 = receiveBundle(r1.log, bundle, AGENT_KEY, NOW + 1000, () => false);
    if (!r2.ok) return;
    expect(r2.log.received.size).toBe(r1.log.received.size);
    expect(r2.log.lastSeqByDevice.get(DEVICE_1)).toBe(r1.log.lastSeqByDevice.get(DEVICE_1));
  });
});

// ---------------------------------------------------------------------------
// Gap detection — never silent holes
// ---------------------------------------------------------------------------

describe("observations store-forward: gap detection", () => {
  it("no gap when bundle.seq = lastSeq + 1", () => {
    const log = emptyBundleReceptionLog();
    const b1 = mkBundle("b1", 1, [mkObs(1)]);
    const b2 = mkBundle("b2", 2, [mkObs(2)]);
    const r1 = receiveBundle(log, b1, AGENT_KEY, NOW, () => false);
    if (!r1.ok) return;
    const r2 = receiveBundle(r1.log, b2, AGENT_KEY, NOW + 1, () => false);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.ack.gaps).toHaveLength(0);
  });

  it("gap detected when bundle.seq > lastSeq + 1 (one missing seq)", () => {
    const log = emptyBundleReceptionLog();
    const b1 = mkBundle("b1", 1, [mkObs(1)]);
    const b3 = mkBundle("b3", 3, [mkObs(3)]); // seq jumps from 1 to 3 — gap at 2
    const r1 = receiveBundle(log, b1, AGENT_KEY, NOW, () => false);
    if (!r1.ok) return;
    const r3 = receiveBundle(r1.log, b3, AGENT_KEY, NOW + 2, () => false);
    expect(r3.ok).toBe(true);
    if (r3.ok) {
      expect(r3.ack.gaps).toHaveLength(1);
      expect(r3.ack.gaps[0]!.missingSeq).toBe(2);
      expect(r3.ack.gaps[0]!.expectedAfter).toBe(1);
      expect(r3.ack.gaps[0]!.tenantId).toBe(TENANT_A);
      expect(r3.ack.gaps[0]!.deviceId).toBe(DEVICE_1);
      expect(r3.audit.intent).toBe("observations:bundle:receive:with-gaps");
    }
  });

  it("multiple gaps detected when bundle.seq >> lastSeq + 1", () => {
    const log = emptyBundleReceptionLog();
    const b1 = mkBundle("b1", 1, [mkObs(1)]);
    const b6 = mkBundle("b6", 6, [mkObs(6)]); // gaps at 2,3,4,5
    const r1 = receiveBundle(log, b1, AGENT_KEY, NOW, () => false);
    if (!r1.ok) return;
    const r6 = receiveBundle(r1.log, b6, AGENT_KEY, NOW + 5, () => false);
    expect(r6.ok).toBe(true);
    if (r6.ok) {
      expect(r6.ack.gaps).toHaveLength(4);
      expect(r6.ack.gaps.map((g) => g.missingSeq)).toEqual([2, 3, 4, 5]);
    }
  });

  it("out-of-order delivery (bundle 2 arrives after bundle 3) does not regress lastSeq", () => {
    const log = emptyBundleReceptionLog();
    const b1 = mkBundle("b1", 1, [mkObs(1)]);
    const b3 = mkBundle("b3", 3, [mkObs(3)]);
    const b2 = mkBundle("b2", 2, [mkObs(2)]); // arrives last
    let l = log;
    const r1 = receiveBundle(l, b1, AGENT_KEY, NOW, () => false);
    if (r1.ok) l = r1.log;
    const r3 = receiveBundle(l, b3, AGENT_KEY, NOW + 2, () => false);
    if (r3.ok) l = r3.log;
    // Now deliver b2 — lastSeq should remain 3 (b3's seq).
    const r2 = receiveBundle(l, b2, AGENT_KEY, NOW + 3, () => false);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.log.lastSeqByDevice.get(DEVICE_1)).toBe(3);
      expect(r2.ack.gaps).toHaveLength(0); // b2 is filling the gap; no new gaps
    }
  });

  it("makeGapMarker produces a typed marker with stable fields", () => {
    const g = makeGapMarker(TENANT_A, DEVICE_1, 5, 3, NOW);
    expect(g.tenantId).toBe(TENANT_A);
    expect(g.deviceId).toBe(DEVICE_1);
    expect(g.missingSeq).toBe(5);
    expect(g.expectedAfter).toBe(3);
    expect(g.detectedAt).toBe(NOW);
  });
});

// ---------------------------------------------------------------------------
// Sequence report — honest gap state per device
// ---------------------------------------------------------------------------

describe("observations store-forward: sequence report", () => {
  it("empty log: lastReceivedSeq=0, expectedNextSeq=1, no gaps", () => {
    const r = buildSequenceReport(emptyBundleReceptionLog(), TENANT_A, DEVICE_1);
    expect(r.lastReceivedSeq).toBe(0);
    expect(r.expectedNextSeq).toBe(1);
    expect(r.knownGaps).toEqual([]);
  });

  it("fully contiguous sequence: no known gaps", () => {
    let log = emptyBundleReceptionLog();
    for (let s = 1; s <= 5; s++) {
      const r = receiveBundle(log, mkBundle(`b${s}`, s, [mkObs(s)]), AGENT_KEY, NOW + s, () => false);
      if (r.ok) log = r.log;
    }
    const report = buildSequenceReport(log, TENANT_A, DEVICE_1);
    expect(report.lastReceivedSeq).toBe(5);
    expect(report.expectedNextSeq).toBe(6);
    expect(report.knownGaps).toEqual([]);
  });

  it("gap in sequence: knownGaps surfaces the missing seqs", () => {
    let log = emptyBundleReceptionLog();
    // Deliver 1, 2, 4, 5 (skip 3).
    for (const s of [1, 2, 4, 5]) {
      const r = receiveBundle(log, mkBundle(`b${s}`, s, [mkObs(s)]), AGENT_KEY, NOW + s, () => false);
      if (r.ok) log = r.log;
    }
    const report = buildSequenceReport(log, TENANT_A, DEVICE_1);
    expect(report.lastReceivedSeq).toBe(5);
    expect(report.knownGaps).toEqual([3]);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe("observations store-forward: tenant isolation", () => {
  it("two tenants' reception logs are disjoint (caller constructs one per tenant)", () => {
    const logA = emptyBundleReceptionLog();
    const logB = emptyBundleReceptionLog();
    const bundleA = mkBundle("bA", 1, [mkObs(1)], TENANT_A, DEVICE_1);
    const bundleB = mkBundle("bB", 1, [mkObs(1)], TENANT_B, DEVICE_1);
    const rA = receiveBundle(logA, bundleA, AGENT_KEY, NOW, () => false);
    const rB = receiveBundle(logB, bundleB, AGENT_KEY, NOW, () => false);
    expect(rA.ok).toBe(true);
    expect(rB.ok).toBe(true);
    if (rA.ok && rB.ok) {
      expect(rA.log.received.has("bB")).toBe(false);
      expect(rB.log.received.has("bA")).toBe(false);
    }
  });

  it("assertLogTenantScope is a contract anchor (always true for well-formed logs)", () => {
    expect(assertLogTenantScope(emptyBundleReceptionLog(), TENANT_A)).toBe(true);
  });

  it("audit.tenant matches the bundle's tenant", () => {
    const bundle = mkBundle("b1", 1, [mkObs(1)], TENANT_B, DEVICE_1);
    const r = receiveBundle(emptyBundleReceptionLog(), bundle, AGENT_KEY, NOW, () => false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.audit.tenant).toBe(TENANT_B);
  });
});

// ---------------------------------------------------------------------------
// Audit determinism
// ---------------------------------------------------------------------------

describe("observations store-forward: audit determinism", () => {
  it("identical bundle + log state -> identical audit digest", () => {
    const bundle = mkBundle("b1", 1, [mkObs(1), mkObs(2)]);
    const r1 = receiveBundle(emptyBundleReceptionLog(), bundle, AGENT_KEY, NOW, () => false);
    const r2 = receiveBundle(emptyBundleReceptionLog(), bundle, AGENT_KEY, NOW, () => false);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r1.audit.digest).toBe(r2.audit.digest);
  });
});
