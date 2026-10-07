import { describe, it, expect } from "vitest";
import {
  admitToLog,
  assertObservationImmutable,
  emptyAdmittedLog,
  evaluateBackpressure,
  listObservationsForDevice,
  normalizeObservation,
  type BackpressureThresholds,
  type NormalizationContext,
} from "./kernel.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const DEV1 = "dev_truck-001";

function admissionInput(seq: number, payload: Uint8Array = new TextEncoder().encode(`{"temp":90}`), kind: string = "telemetry.temp") {
  return {
    tenantId: TENANT_A,
    deviceId: DEV1,
    seq,
    observedAt: NOW + seq * 1000,
    kind,
    payload,
    admittedAt: NOW + seq * 1000 + 1,
  };
}

describe("observations kernel: back-pressure signaling", () => {
  const thresholds: BackpressureThresholds = { warn: 10, critical: 50 };

  it("returns ok when pending < warn", () => {
    const s = evaluateBackpressure(5, thresholds, DEV1);
    expect(s.level).toBe("ok");
    expect(s.suggestedAction).toBe("accept");
  });

  it("returns warn when pending >= warn and < critical", () => {
    const s = evaluateBackpressure(10, thresholds, DEV1);
    expect(s.level).toBe("warn");
    expect(s.suggestedAction).toBe("shed");
  });

  it("returns critical when pending >= critical", () => {
    const s = evaluateBackpressure(50, thresholds, DEV1);
    expect(s.level).toBe("critical");
    expect(s.suggestedAction).toBe("reject");
  });

  it("signal is deterministic for identical inputs", () => {
    const a = evaluateBackpressure(15, thresholds, DEV1);
    const b = evaluateBackpressure(15, thresholds, DEV1);
    expect(a).toEqual(b);
  });

  it("signal carries the deviceId", () => {
    const s = evaluateBackpressure(0, thresholds, "dev_x");
    expect(s.deviceId).toBe("dev_x");
  });
});

describe("observations kernel: immutability check (refuse mutation by construction)", () => {
  it("returns ok when the candidate digest matches the store", async () => {
    const log = emptyAdmittedLog();
    const payload = new TextEncoder().encode('{"temp":90}');
    const r1 = admitToLog(log, admissionInput(1, payload));
    if (!r1.ok) throw new Error("admit failed");
    const candidate = { deviceId: DEV1, seq: 1, payloadDigest: r1.observation.payloadDigest };
    const check = assertObservationImmutable(r1.observation, candidate);
    expect(check.ok).toBe(true);
  });

  it("rejects with digest-mismatch when the caller mutated the payload", async () => {
    const log = emptyAdmittedLog();
    const r1 = admitToLog(log, admissionInput(1, new TextEncoder().encode('{"temp":90}')));
    if (!r1.ok) throw new Error("admit failed");
    const candidate = { deviceId: DEV1, seq: 1, payloadDigest: "0".repeat(64) };
    const check = assertObservationImmutable(r1.observation, candidate);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe("digest-mismatch");
  });

  it("rejects with device-mismatch when deviceId differs", async () => {
    const log = emptyAdmittedLog();
    const r1 = admitToLog(log, admissionInput(1));
    if (!r1.ok) throw new Error("admit failed");
    const check = assertObservationImmutable(r1.observation, { deviceId: "dev_other", seq: 1, payloadDigest: r1.observation.payloadDigest });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe("device-mismatch");
  });

  it("rejects with seq-mismatch when seq differs", async () => {
    const log = emptyAdmittedLog();
    const r1 = admitToLog(log, admissionInput(1));
    if (!r1.ok) throw new Error("admit failed");
    const check = assertObservationImmutable(r1.observation, { deviceId: DEV1, seq: 99, payloadDigest: r1.observation.payloadDigest });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe("seq-mismatch");
  });
});

describe("observations kernel: idempotent admission (double-admission acks identical)", () => {
  it("first admission succeeds, second admission is idempotent (ack identical, log untouched)", () => {
    const log0 = emptyAdmittedLog();
    const payload = new TextEncoder().encode('{"temp":90}');
    const r1 = admitToLog(log0, admissionInput(1, payload));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.ack.duplicate).toBe(false);
    expect(r1.audit.intent).toBe("observation:admit");

    const r2 = admitToLog(r1.log, admissionInput(1, payload));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.ack.duplicate).toBe(true);
    expect(r2.ack.id).toBe(r1.ack.id);
    expect(r2.ack.payloadDigest).toBe(r1.ack.payloadDigest);
    expect(r2.audit.intent).toBe("observation:admit:idempotent");
    // The log is unchanged (idempotent — no new entry).
    expect(r2.log.byKey.size).toBe(r1.log.byKey.size);
  });

  it("rejects non-monotonic seq (seq=2 then seq=2 again but as duplicate of non-existent seq=1)", () => {
    // Actually: seq=2 then seq=1 again should be non-monotonic-seq (since seq=1 < lastSeq=2)
    const log0 = emptyAdmittedLog();
    const r1 = admitToLog(log0, admissionInput(2));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = admitToLog(r1.log, admissionInput(1));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("non-monotonic-seq");
  });

  it("rejects missing-tenant-id (empty tenantId)", () => {
    const log0 = emptyAdmittedLog();
    const r = admitToLog(log0, { ...admissionInput(1), tenantId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-tenant-id");
  });

  it("rejects missing-device-id (empty deviceId)", () => {
    const log0 = emptyAdmittedLog();
    const r = admitToLog(log0, { ...admissionInput(1), deviceId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-device-id");
  });

  it("rejects invalid-observed-at (NaN or <=0)", () => {
    const log0 = emptyAdmittedLog();
    const r = admitToLog(log0, { ...admissionInput(1), observedAt: NaN });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-observed-at");
  });
});

describe("observations kernel: listObservationsForDevice tenant fail-closed", () => {
  it("returns observations for the matching tenant", () => {
    const log = emptyAdmittedLog();
    const r = admitToLog(log, admissionInput(1));
    if (!r.ok) throw new Error("admit failed");
    const list = listObservationsForDevice(r.log, TENANT_A, DEV1);
    expect(list).toHaveLength(1);
  });

  it("returns empty list when caller is from a different tenant (fail-closed)", () => {
    const log = emptyAdmittedLog();
    const r = admitToLog(log, admissionInput(1));
    if (!r.ok) throw new Error("admit failed");
    const list = listObservationsForDevice(r.log, TENANT_B, DEV1);
    expect(list).toHaveLength(0);
  });

  it("returns empty list for unknown device", () => {
    const log = emptyAdmittedLog();
    expect(listObservationsForDevice(log, TENANT_A, "dev_unknown")).toHaveLength(0);
  });
});

describe("observations kernel: normalizeObservation pipeline", () => {
  function ctx(payload: Uint8Array, kind: string = "telemetry.temp"): NormalizationContext {
    return { tenantId: TENANT_A, deviceId: DEV1, seq: 1, observedAt: NOW, kind, rawPayload: payload };
  }

  it("succeeds for a well-formed telemetry payload", () => {
    const r = normalizeObservation(ctx(new TextEncoder().encode('{"temp":90,"humidity":50}')));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.canonical.fields).toEqual({ humidity: 50, temp: 90 });
      expect(r.canonical.canonicalDigest).toBeTruthy();
      expect(r.stages).toEqual([
        "validate-shape",
        "validate-kind",
        "decode-payload",
        "canonicalize-fields",
        "emit-canonical",
      ]);
      expect(r.audit.intent).toBe("observation:normalize");
    }
  });

  it("rejects missing-tenant-id at validate-shape stage", () => {
    const r = normalizeObservation({ ...ctx(new TextEncoder().encode('{"temp":90}')), tenantId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("missing-tenant-id");
      expect(r.stage).toBe("validate-shape");
    }
  });

  it("rejects missing-device-id at validate-shape stage", () => {
    const r = normalizeObservation({ ...ctx(new TextEncoder().encode('{"temp":90}')), deviceId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("missing-device-id");
      expect(r.stage).toBe("validate-shape");
    }
  });

  it("rejects invalid-observed-at at validate-shape stage", () => {
    const r = normalizeObservation({ ...ctx(new TextEncoder().encode('{"temp":90}')), observedAt: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("invalid-observed-at");
      expect(r.stage).toBe("validate-shape");
    }
  });

  it("rejects missing-kind at validate-kind stage", () => {
    const r = normalizeObservation({ ...ctx(new TextEncoder().encode('{"temp":90}')), kind: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("missing-kind");
      expect(r.stage).toBe("validate-kind");
    }
  });

  it("rejects unknown-kind at validate-kind stage", () => {
    const r = normalizeObservation(ctx(new TextEncoder().encode('{"temp":90}'), "weird.kind"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("unknown-kind");
      expect(r.stage).toBe("validate-kind");
    }
  });

  it("rejects payload-empty at decode-payload stage", () => {
    const r = normalizeObservation(ctx(new Uint8Array(0)));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("payload-empty");
      expect(r.stage).toBe("decode-payload");
    }
  });

  it("rejects payload-not-json at decode-payload stage", () => {
    const r = normalizeObservation(ctx(new TextEncoder().encode("not-json")));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("payload-not-json");
      expect(r.stage).toBe("decode-payload");
    }
  });

  it("rejects payload-not-object at decode-payload stage (array)", () => {
    const r = normalizeObservation(ctx(new TextEncoder().encode("[1,2,3]")));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("payload-not-object");
      expect(r.stage).toBe("decode-payload");
    }
  });

  it("rejects payload-not-object at decode-payload stage (number literal)", () => {
    const r = normalizeObservation(ctx(new TextEncoder().encode("42")));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("payload-not-object");
  });

  it("canonicalDigest is deterministic for identical inputs", () => {
    const a = normalizeObservation(ctx(new TextEncoder().encode('{"temp":90}')));
    const b = normalizeObservation(ctx(new TextEncoder().encode('{"temp":90}')));
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.canonical.canonicalDigest).toBe(b.canonical.canonicalDigest);
  });

  it("canonicalDigest changes when fields change (tamper-evident)", () => {
    const a = normalizeObservation(ctx(new TextEncoder().encode('{"temp":90}')));
    const b = normalizeObservation(ctx(new TextEncoder().encode('{"temp":95}')));
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.canonical.canonicalDigest).not.toBe(b.canonical.canonicalDigest);
  });

  it("canonicalize-fields sorts keys for deterministic digest regardless of input order", () => {
    const a = normalizeObservation(ctx(new TextEncoder().encode('{"temp":90,"humidity":50}')));
    const b = normalizeObservation(ctx(new TextEncoder().encode('{"humidity":50,"temp":90}')));
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.canonical.canonicalDigest).toBe(b.canonical.canonicalDigest);
  });
});
