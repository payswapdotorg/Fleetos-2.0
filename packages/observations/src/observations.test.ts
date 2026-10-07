import { describe, it, expect } from "vitest";
import {
  admitObservation,
  computePayloadDigest,
  emptyAdmissionStore,
  type AdmissionInput,
} from "./observations.js";

const NOW = 1_727_000_000_000;

function payload(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function baseInput(overrides: Partial<AdmissionInput> = {}): AdmissionInput {
  return {
    tenantId: "tnt_acme",
    deviceId: "dev_truck-001",
    seq: 1,
    observedAt: NOW,
    kind: "engine.temp",
    payload: payload('{"tempC":90}'),
    admittedAt: NOW,
    ...overrides,
  };
}

describe("observations: computePayloadDigest determinism", () => {
  it("same payload -> same digest", () => {
    const a = computePayloadDigest(payload("hello"));
    const b = computePayloadDigest(payload("hello"));
    expect(a).toBe(b);
  });
  it("different payloads -> different digests", () => {
    expect(computePayloadDigest(payload("a"))).not.toBe(computePayloadDigest(payload("b")));
  });
  it("digest is 64-char hex (sha-256)", () => {
    const d = computePayloadDigest(payload("x"));
    expect(d).toMatch(/^[0-9a-f]{64}$/);
  });
  it("empty payload has stable digest", () => {
    expect(computePayloadDigest(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("observations: admitObservation happy path", () => {
  it("admits a fresh observation with ack.duplicate=false", () => {
    const store0 = emptyAdmissionStore();
    const { result, store } = admitObservation(store0, baseInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ack.duplicate).toBe(false);
      expect(result.ack.deviceId).toBe("dev_truck-001");
      expect(result.ack.seq).toBe(1);
      expect(result.observation.kind).toBe("engine.temp");
    }
    // Store updated immutably.
    expect(store.known.size).toBe(1);
    expect(store0.known.size).toBe(0); // original untouched
  });
});

describe("observations: idempotent admission (dedup)", () => {
  it("re-admitting same (deviceId, seq) returns ack.duplicate=true", () => {
    const store0 = emptyAdmissionStore();
    const { store: store1 } = admitObservation(store0, baseInput());
    const { result, store: store2 } = admitObservation(store1, baseInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ack.duplicate).toBe(true);
      expect(result.observation.id).toBe(result.ack.id);
    }
    // Idempotent: store unchanged on duplicate.
    expect(store2.known.size).toBe(store1.known.size);
  });
  it("idempotent ack returns the SAME observation id as the original", () => {
    const store0 = emptyAdmissionStore();
    const first = admitObservation(store0, baseInput());
    const second = admitObservation(first.store, baseInput());
    if (first.result.ok && second.result.ok) {
      expect(second.result.ack.id).toBe(first.result.ack.id);
    }
  });
});

describe("observations: monotonic seq enforcement", () => {
  it("rejects FRESH seq less than last (regression) — non-monotonic-seq", () => {
    const store0 = emptyAdmissionStore();
    const s1 = admitObservation(store0, baseInput({ seq: 5 }));
    // (dev_truck-001, 4) is FRESH — never admitted — but seq=4 < lastSeq=5
    const s2 = admitObservation(s1.store, baseInput({ seq: 4, observedAt: NOW + 1 }));
    expect(s2.result).toEqual({ ok: false, reason: "non-monotonic-seq" });
  });
  it("accepts strictly greater seq", () => {
    const store0 = emptyAdmissionStore();
    const s1 = admitObservation(store0, baseInput({ seq: 1 }));
    const s2 = admitObservation(s1.store, baseInput({ seq: 2 }));
    expect(s2.result.ok).toBe(true);
  });
  it("duplicate (deviceId, seq) returns idempotent ack (NOT non-monotonic-seq)", () => {
    const store0 = emptyAdmissionStore();
    const s1 = admitObservation(store0, baseInput({ seq: 5 }));
    const s2 = admitObservation(s1.store, baseInput({ seq: 5 }));
    expect(s2.result.ok).toBe(true);
    if (s2.result.ok) {
      expect(s2.result.ack.duplicate).toBe(true);
    }
  });
});

describe("observations: fail-closed validations", () => {
  it("rejects missing tenant id", () => {
    const r = admitObservation(emptyAdmissionStore(), baseInput({ tenantId: "" })).result;
    expect(r).toEqual({ ok: false, reason: "missing-tenant-id" });
  });
  it("rejects missing device id", () => {
    const r = admitObservation(emptyAdmissionStore(), baseInput({ deviceId: "" })).result;
    expect(r).toEqual({ ok: false, reason: "missing-device-id" });
  });
  it("rejects invalid observedAt (NaN)", () => {
    const r = admitObservation(emptyAdmissionStore(), baseInput({ observedAt: NaN })).result;
    expect(r).toEqual({ ok: false, reason: "invalid-observed-at" });
  });
  it("rejects malformed payload (not a Uint8Array)", () => {
    const r = admitObservation(
      emptyAdmissionStore(),
      baseInput({ payload: "not-bytes" as unknown as Uint8Array }),
    ).result;
    expect(r).toEqual({ ok: false, reason: "malformed-payload" });
  });
});

describe("observations: immutability", () => {
  it("admission does not mutate the input store", () => {
    const store0 = emptyAdmissionStore();
    admitObservation(store0, baseInput());
    expect(store0.known.size).toBe(0);
    expect(store0.lastSeq.size).toBe(0);
  });
  it("duplicate admission does not mutate the store", () => {
    const store0 = emptyAdmissionStore();
    const first = admitObservation(store0, baseInput());
    const before = first.store.known.size;
    const second = admitObservation(first.store, baseInput());
    expect(second.store.known.size).toBe(before);
  });
});
