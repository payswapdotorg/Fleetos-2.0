/**
 * @fleetos/agent — Wave 3 enrollment handshake tests (F230A).
 *
 * Covers:
 *   - Structural validations: missing agent/tenant/device/nonce
 *   - Attestation: missing refs refused; untrusted refs refused
 *   - Nonce replay protection: first use ok; re-use of same nonce refused
 *   - Idempotent re-enrollment after reset (declaredReset=true)
 *   - Refusal reasons: device-not-enrolled, device-enrollment-revoked, etc.
 *   - Audit emission stability
 */

import { describe, it, expect } from "vitest";
import {
  alwaysEnrolledGate,
  emptyNonceReplayCache,
  neverEnrolledGate,
  performEnrollmentHandshake,
  trustingAllAttestations,
  trustingAttestationKinds,
  trustingNoAttestations,
  type AttestationRef,
  type EnrollmentGatePort,
  type EnrollmentHandshakeRequest,
} from "./enrollment-handshake.js";

const NOW = 1_727_000_000_000;
const AGENT = "agent-001";
const TENANT = "tnt_acme";
const DEVICE = "dev_truck-001";

function mkRequest(overrides: Partial<EnrollmentHandshakeRequest> = {}): EnrollmentHandshakeRequest {
  return {
    agentId: AGENT,
    tenantId: TENANT,
    deviceId: DEVICE,
    nonce: "nonce-1",
    attestation: [{ kind: "tpm.quote", digest: "abc", measuredAt: NOW }],
    declaredReset: false,
    at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structural validations
// ---------------------------------------------------------------------------

describe("agent enrollment-handshake: structural validations", () => {
  it("refuses missing agent id", () => {
    const r = performEnrollmentHandshake(mkRequest({ agentId: "" }), emptyNonceReplayCache(), trustingAllAttestations(), neverEnrolledGate());
    expect(r.response.accepted).toBe(false);
    expect(r.response.reason).toBe("missing-agent-id");
  });

  it("refuses missing tenant id", () => {
    const r = performEnrollmentHandshake(mkRequest({ tenantId: "" }), emptyNonceReplayCache(), trustingAllAttestations(), neverEnrolledGate());
    expect(r.response.accepted).toBe(false);
    expect(r.response.reason).toBe("missing-tenant-id");
  });

  it("refuses missing device id", () => {
    const r = performEnrollmentHandshake(mkRequest({ deviceId: "" }), emptyNonceReplayCache(), trustingAllAttestations(), neverEnrolledGate());
    expect(r.response.accepted).toBe(false);
    expect(r.response.reason).toBe("missing-device-id");
  });

  it("refuses missing nonce", () => {
    const r = performEnrollmentHandshake(mkRequest({ nonce: "" }), emptyNonceReplayCache(), trustingAllAttestations(), neverEnrolledGate());
    expect(r.response.accepted).toBe(false);
    expect(r.response.reason).toBe("missing-nonce");
  });
});

// ---------------------------------------------------------------------------
// Attestation refs
// ---------------------------------------------------------------------------

describe("agent enrollment-handshake: attestation", () => {
  it("refuses when attestation is empty (attestation-missing)", () => {
    const r = performEnrollmentHandshake(mkRequest({ attestation: [] }), emptyNonceReplayCache(), trustingAllAttestations(), neverEnrolledGate());
    expect(r.response.accepted).toBe(false);
    expect(r.response.reason).toBe("attestation-missing");
  });

  it("refuses when attestation ref is not trusted (attestation-invalid)", () => {
    const r = performEnrollmentHandshake(mkRequest(), emptyNonceReplayCache(), trustingNoAttestations(), neverEnrolledGate());
    expect(r.response.accepted).toBe(false);
    expect(r.response.reason).toBe("attestation-invalid");
  });

  it("trusts attestation of accepted kinds", () => {
    const ref: AttestationRef = { kind: "tpm.quote", digest: "abc", measuredAt: NOW };
    const r = performEnrollmentHandshake(
      mkRequest({ attestation: [ref] }),
      emptyNonceReplayCache(),
      trustingAttestationKinds(new Set(["tpm.quote"])),
      neverEnrolledGate(),
    );
    expect(r.response.accepted).toBe(true);
  });

  it("refuses attestation of unaccepted kinds", () => {
    const ref: AttestationRef = { kind: "unknown.kind", digest: "abc", measuredAt: NOW };
    const r = performEnrollmentHandshake(
      mkRequest({ attestation: [ref] }),
      emptyNonceReplayCache(),
      trustingAttestationKinds(new Set(["tpm.quote"])),
      neverEnrolledGate(),
    );
    expect(r.response.accepted).toBe(false);
    expect(r.response.reason).toBe("attestation-invalid");
  });
});

// ---------------------------------------------------------------------------
// Nonce replay protection
// ---------------------------------------------------------------------------

describe("agent enrollment-handshake: nonce replay protection", () => {
  it("first handshake with a fresh nonce succeeds", () => {
    const r = performEnrollmentHandshake(mkRequest({ nonce: "fresh-1" }), emptyNonceReplayCache(), trustingAllAttestations(), neverEnrolledGate());
    expect(r.response.accepted).toBe(true);
  });

  it("re-using the same nonce is refused (nonce-replay-detected)", () => {
    let cache = emptyNonceReplayCache();
    const r1 = performEnrollmentHandshake(mkRequest({ nonce: "reused-1" }), cache, trustingAllAttestations(), neverEnrolledGate());
    expect(r1.response.accepted).toBe(true);
    cache = r1.cache;
    const r2 = performEnrollmentHandshake(mkRequest({ nonce: "reused-1", at: NOW + 1 }), cache, trustingAllAttestations(), neverEnrolledGate());
    expect(r2.response.accepted).toBe(false);
    expect(r2.response.reason).toBe("nonce-replay-detected");
  });

  it("same nonce from a different device is NOT a replay (per-device cache)", () => {
    let cache = emptyNonceReplayCache();
    const r1 = performEnrollmentHandshake(mkRequest({ nonce: "shared-nonce", deviceId: "dev_a" }), cache, trustingAllAttestations(), neverEnrolledGate());
    cache = r1.cache;
    const r2 = performEnrollmentHandshake(mkRequest({ nonce: "shared-nonce", deviceId: "dev_b", at: NOW + 1 }), cache, trustingAllAttestations(), neverEnrolledGate());
    expect(r2.response.accepted).toBe(true);
  });

  it("nonce cache is bounded (oldest evicted when full)", () => {
    let cache = emptyNonceReplayCache(4);
    for (let i = 0; i < 4; i++) {
      const r = performEnrollmentHandshake(mkRequest({ nonce: `n-${i}`, at: NOW + i }), cache, trustingAllAttestations(), neverEnrolledGate());
      cache = r.cache;
    }
    expect(cache.seen.size).toBe(4);
    // Adding a 5th should evict ~25% (1 entry).
    const r = performEnrollmentHandshake(mkRequest({ nonce: "n-4", at: NOW + 4 }), cache, trustingAllAttestations(), neverEnrolledGate());
    expect(r.response.accepted).toBe(true);
    expect(r.cache.seen.size).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Idempotent re-enrollment after reset
// ---------------------------------------------------------------------------

describe("agent enrollment-handshake: re-enrollment after reset", () => {
  it("re-enrollment without declaredReset is refused (duplicate-enrollment)", () => {
    const r = performEnrollmentHandshake(mkRequest({ declaredReset: false }), emptyNonceReplayCache(), trustingAllAttestations(), alwaysEnrolledGate());
    expect(r.response.accepted).toBe(false);
    expect(r.response.reason).toBe("duplicate-enrollment");
  });

  it("re-enrollment with declaredReset=true is accepted (idempotent)", () => {
    const r = performEnrollmentHandshake(mkRequest({ declaredReset: true }), emptyNonceReplayCache(), trustingAllAttestations(), alwaysEnrolledGate());
    expect(r.response.accepted).toBe(true);
    expect(r.response.audit.intent).toContain("reset");
  });

  it("re-enrollment with declaredReset=true but gate refuses reset is refused", () => {
    const gate: EnrollmentGatePort = {
      check: () => ({ ok: true }),
      admitReenrollment: () => ({ ok: false, reason: "declared-reset-required" }),
    };
    const r = performEnrollmentHandshake(mkRequest({ declaredReset: true }), emptyNonceReplayCache(), trustingAllAttestations(), gate);
    expect(r.response.accepted).toBe(false);
    expect(r.response.reason).toBe("duplicate-enrollment");
  });
});

// ---------------------------------------------------------------------------
// Enrollment gate refusals
// ---------------------------------------------------------------------------

describe("agent enrollment-handshake: gate refusals", () => {
  it("device-enrollment-revoked: gate returns revoked", () => {
    const gate: EnrollmentGatePort = {
      check: () => ({ ok: false, reason: "device-enrollment-revoked" }),
      admitReenrollment: () => ({ ok: true }),
    };
    const r = performEnrollmentHandshake(mkRequest(), emptyNonceReplayCache(), trustingAllAttestations(), gate);
    expect(r.response.accepted).toBe(false);
    expect(r.response.reason).toBe("device-enrollment-revoked");
  });

  it("device-tenant-mismatch: gate returns mismatch", () => {
    const gate: EnrollmentGatePort = {
      check: () => ({ ok: false, reason: "device-tenant-mismatch" }),
      admitReenrollment: () => ({ ok: true }),
    };
    const r = performEnrollmentHandshake(mkRequest(), emptyNonceReplayCache(), trustingAllAttestations(), gate);
    expect(r.response.accepted).toBe(false);
    expect(r.response.reason).toBe("device-tenant-mismatch");
  });
});

// ---------------------------------------------------------------------------
// Audit emission
// ---------------------------------------------------------------------------

describe("agent enrollment-handshake: audit", () => {
  it("successful handshake emits audit with agent:enroll:handshake intent", () => {
    const r = performEnrollmentHandshake(mkRequest({ nonce: "audit-1" }), emptyNonceReplayCache(), trustingAllAttestations(), neverEnrolledGate());
    expect(r.response.accepted).toBe(true);
    expect(r.response.audit.intent).toBe("agent:enroll:handshake");
    expect(r.response.audit.actor).toBe(AGENT);
    expect(r.response.audit.tenant).toBe(TENANT);
  });

  it("refused handshake emits audit with refused:<reason> intent", () => {
    const r = performEnrollmentHandshake(mkRequest({ nonce: "" }), emptyNonceReplayCache(), trustingAllAttestations(), neverEnrolledGate());
    expect(r.response.audit.intent).toContain("refused:missing-nonce");
  });

  it("audit digest is stable for identical inputs (deterministic)", () => {
    const r1 = performEnrollmentHandshake(mkRequest({ nonce: "det-1" }), emptyNonceReplayCache(), trustingAllAttestations(), neverEnrolledGate());
    const r2 = performEnrollmentHandshake(mkRequest({ nonce: "det-1" }), emptyNonceReplayCache(), trustingAllAttestations(), neverEnrolledGate());
    expect(r1.response.audit.digest).toBe(r2.response.audit.digest);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe("agent enrollment-handshake: tenant isolation", () => {
  it("audit.tenant matches the request's tenantId", () => {
    const r = performEnrollmentHandshake(
      mkRequest({ tenantId: "tnt_other", nonce: "iso-1" }),
      emptyNonceReplayCache(),
      trustingAllAttestations(),
      neverEnrolledGate(),
    );
    expect(r.response.audit.tenant).toBe("tnt_other");
  });

  it("two tenants with the same nonce are NOT replays of each other", () => {
    let cache = emptyNonceReplayCache();
    const r1 = performEnrollmentHandshake(
      mkRequest({ tenantId: "tnt_A", deviceId: "dev_x", nonce: "shared" }),
      cache,
      trustingAllAttestations(),
      neverEnrolledGate(),
    );
    cache = r1.cache;
    const r2 = performEnrollmentHandshake(
      mkRequest({ tenantId: "tnt_B", deviceId: "dev_x", nonce: "shared", at: NOW + 1 }),
      cache,
      trustingAllAttestations(),
      neverEnrolledGate(),
    );
    expect(r2.response.accepted).toBe(true);
  });
});
