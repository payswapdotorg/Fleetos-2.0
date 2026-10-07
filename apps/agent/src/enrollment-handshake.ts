/**
 * @fleetos/agent — Wave 3 enrollment handshake (F230A).
 *
 * The F220A `edge-path.ts` shipped the agent's telemetry batcher + durable
 * ack log + reconciliation planner. The Wave 1 `kernel.ts` shipped the
 * audited agent loop + EnrollmentToken lifecycle. F230A advances to the
 * EDGE-grade enrollment handshake:
 *
 *   - **device identity + attestation refs** — the handshake carries the
 *     device's identity (deviceId + tenantId) AND a set of attestation
 *     references (e.g., TPM quote digests, secure-boot measurements). The
 *     receiving side refuses a handshake with missing attestation refs.
 *   - **nonce-based replay protection** — the agent includes a nonce in
 *     the handshake; the receiving side tracks nonces in a bounded cache.
 *     A reused nonce is refused with `nonce-replay-detected`. This prevents
 *     a captured handshake from being replayed by an attacker.
 *   - **idempotent re-enrollment after reset** — a device that has been
 *     factory-reset may re-enroll with the SAME deviceId + tenantId but a
 *     NEW nonce. The enrollment directory re-uses the existing enrollment
 *     record (idempotent) and refuses if the reset was not declared
 *     (the prior enrollment is still active -> `duplicate-enrollment`).
 *   - **refusal reasons** — `device-not-enrolled`, `device-enrollment-revoked`,
 *     `device-tenant-mismatch`, `nonce-replay-detected`, `attestation-missing`,
 *     `attestation-invalid`. Reuse the F220A enrollment gate vocabulary.
 *
 * Pure TypeScript. No I/O, no servers, no databases. Persistence lands at
 * F211 (TL lane).
 */

import { createHash } from "node:crypto";
import type { AgentIdLike, DeviceIdLike, TenantIdLike } from "./agent.js";
import type { AuditEventRef } from "./kernel.js";

export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Attestation references — typed evidence the device presents at handshake
// time. These are REFERENCES (digests), not raw attestation payloads. The
// receiving side verifies the references against its attestation trust
// store (out of scope for the kernel; the kernel exposes the contract).
// ---------------------------------------------------------------------------

export interface AttestationRef {
  readonly kind: string; // e.g., "tpm.quote", "secure-boot.measurement", "device.serial"
  readonly digest: string; // sha-256 of the attestation payload
  readonly measuredAt: number;
}

export interface AttestationTrustStore {
  readonly isTrusted: (ref: AttestationRef) => boolean;
}

// ---------------------------------------------------------------------------
// Handshake request + response
// ---------------------------------------------------------------------------

export interface EnrollmentHandshakeRequest {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly nonce: string; // caller-generated, ideally CSPRNG
  readonly attestation: ReadonlyArray<AttestationRef>;
  readonly declaredReset: boolean; // true if the device was factory-reset and is re-enrolling
  readonly at: number;
}

export interface EnrollmentHandshakeResponse {
  readonly accepted: boolean;
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly nonce: string;
  readonly at: number;
  readonly audit: AuditEventRef;
  readonly reason?: EnrollmentHandshakeRejectionCode;
}

export type EnrollmentHandshakeRejectionCode =
  | "missing-agent-id"
  | "missing-tenant-id"
  | "missing-device-id"
  | "missing-nonce"
  | "attestation-missing"
  | "attestation-invalid"
  | "nonce-replay-detected"
  | "device-not-enrolled"
  | "device-enrollment-revoked"
  | "device-tenant-mismatch"
  | "duplicate-enrollment";

// ---------------------------------------------------------------------------
// NonceReplayCache — bounded cache of recently-seen nonces. A nonce in
// the cache means the handshake was attempted recently; re-using it is
// refused. The cache is bounded; oldest entries are evicted when full.
//
// The cache is per-(tenantId, deviceId) — the same nonce from a different
// device is not a replay.
// ---------------------------------------------------------------------------

export interface NonceReplayCache {
  readonly seen: ReadonlyMap<string, number>; // `${tenantId}:${deviceId}:${nonce}` -> at
  readonly maxSize: number;
}

export function emptyNonceReplayCache(maxSize = 1024): NonceReplayCache {
  return { seen: new Map(), maxSize };
}

export type NonceCheckResult =
  | { readonly ok: true; readonly cache: NonceReplayCache }
  | { readonly ok: false; readonly reason: "nonce-replay-detected"; readonly cache: NonceReplayCache };

export function checkNonce(
  cache: NonceReplayCache,
  tenantId: TenantIdLike,
  deviceId: DeviceIdLike,
  nonce: string,
  at: number,
): NonceCheckResult {
  const key = `${tenantId}:${deviceId}:${nonce}`;
  if (cache.seen.has(key)) {
    return { ok: false, reason: "nonce-replay-detected", cache };
  }
  let seen = cache.seen;
  if (seen.size >= cache.maxSize) {
    // Drop oldest ~25% (Map iteration order = insertion order).
    const keep = Math.floor(cache.maxSize * 0.75);
    const arr = [...seen.entries()];
    seen = new Map(arr.slice(arr.length - keep));
  }
  const next = new Map(seen);
  next.set(key, at);
  return { ok: true, cache: { seen: next, maxSize: cache.maxSize } };
}

// ---------------------------------------------------------------------------
// EnrollmentGatePort — the structural seam the handshake consults. The
// implementation may wrap the F220A EnrollmentDirectory (in production)
// or a deterministic in-memory reference (in tests). The kernel does NOT
// depend on the F220A package directly (cross-package import).
// ---------------------------------------------------------------------------

export interface EnrollmentGatePort {
  readonly check: (tenantId: TenantIdLike, deviceId: DeviceIdLike) =>
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: "device-not-enrolled" | "device-enrollment-revoked" | "device-tenant-mismatch" };
  readonly admitReenrollment: (input: {
    readonly tenantId: TenantIdLike;
    readonly deviceId: DeviceIdLike;
    readonly declaredReset: boolean;
    readonly at: number;
  }) =>
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: "duplicate-enrollment" | "declared-reset-required" };
}

// ---------------------------------------------------------------------------
// performEnrollmentHandshake — the pure handshake function. Consults the
// attestation trust store, the nonce replay cache, and the enrollment gate.
// Returns a typed response; the response carries the audit event.
// ---------------------------------------------------------------------------

export function performEnrollmentHandshake(
  request: EnrollmentHandshakeRequest,
  cache: NonceReplayCache,
  trustStore: AttestationTrustStore,
  gate: EnrollmentGatePort,
): { readonly response: EnrollmentHandshakeResponse; readonly cache: NonceReplayCache } {
  // Stage 1: structural validations (fail-closed).
  if (request.agentId === "") return fail(request, "missing-agent-id", cache);
  if (request.tenantId === "") return fail(request, "missing-tenant-id", cache);
  if (request.deviceId === "") return fail(request, "missing-device-id", cache);
  if (request.nonce === "") return fail(request, "missing-nonce", cache);

  // Stage 2: attestation refs required + trusted.
  if (request.attestation.length === 0) return fail(request, "attestation-missing", cache);
  for (const ref of request.attestation) {
    if (!trustStore.isTrusted(ref)) return fail(request, "attestation-invalid", cache);
  }

  // Stage 3: nonce replay protection.
  const nonceCheck = checkNonce(cache, request.tenantId, request.deviceId, request.nonce, request.at);
  if (!nonceCheck.ok) return fail(request, nonceCheck.reason, nonceCheck.cache);
  const nextCache = nonceCheck.cache;

  // Stage 4: enrollment gate — check current enrollment status.
  const enrolled = gate.check(request.tenantId, request.deviceId);
  if (enrolled.ok) {
    // Device is already enrolled. If the device declares a reset, admit
    // the re-enrollment (idempotent). Otherwise refuse as duplicate.
    if (!request.declaredReset) {
      return fail(request, "duplicate-enrollment", nextCache);
    }
    const re = gate.admitReenrollment({
      tenantId: request.tenantId,
      deviceId: request.deviceId,
      declaredReset: request.declaredReset,
      at: request.at,
    });
    if (!re.ok) return fail(request, "duplicate-enrollment", nextCache);
  } else {
    // Device is NOT enrolled OR the enrollment is revoked OR tenant-mismatch.
    // - device-not-enrolled: FIRST-TIME enrollment — ACCEPTED (the handshake
    //   IS the enrollment; the operator does NOT pre-register).
    // - device-enrollment-revoked: REFUSED.
    // - device-tenant-mismatch: REFUSED.
    if (enrolled.reason === "device-enrollment-revoked") {
      return fail(request, "device-enrollment-revoked", nextCache);
    }
    if (enrolled.reason === "device-tenant-mismatch") {
      return fail(request, "device-tenant-mismatch", nextCache);
    }
    // device-not-enrolled — first-time enrollment; fall through to success.
  }

  // Stage 5: success — emit audit + return response.
  const audit: AuditEventRef = {
    actor: request.agentId,
    intent: `agent:enroll:handshake${request.declaredReset ? ":reset" : ""}`,
    tenant: request.tenantId,
    timestamp: request.at,
    digest: digestOf(request.agentId, request.tenantId, request.deviceId, request.nonce, request.at),
  };
  const response: EnrollmentHandshakeResponse = {
    accepted: true,
    agentId: request.agentId,
    tenantId: request.tenantId,
    deviceId: request.deviceId,
    nonce: request.nonce,
    at: request.at,
    audit,
  };
  return { response, cache: nextCache };
}

function fail(
  request: EnrollmentHandshakeRequest,
  reason: EnrollmentHandshakeRejectionCode,
  cache: NonceReplayCache,
): { readonly response: EnrollmentHandshakeResponse; readonly cache: NonceReplayCache } {
  const audit: AuditEventRef = {
    actor: request.agentId,
    intent: `agent:enroll:handshake:refused:${reason}`,
    tenant: request.tenantId,
    timestamp: request.at,
    digest: digestOf(request.agentId, request.tenantId, request.deviceId, reason, request.at),
  };
  const response: EnrollmentHandshakeResponse = {
    accepted: false,
    agentId: request.agentId,
    tenantId: request.tenantId,
    deviceId: request.deviceId,
    nonce: request.nonce,
    at: request.at,
    audit,
    reason,
  };
  return { response, cache };
}

// ---------------------------------------------------------------------------
// Reference trust store + gate — deterministic System-1 reference path.
// ---------------------------------------------------------------------------

export function trustingAllAttestations(): AttestationTrustStore {
  return { isTrusted: () => true };
}

export function trustingNoAttestations(): AttestationTrustStore {
  return { isTrusted: () => false };
}

export function trustingAttestationKinds(kinds: ReadonlySet<string>): AttestationTrustStore {
  return { isTrusted: (ref) => kinds.has(ref.kind) };
}

export function alwaysEnrolledGate(): EnrollmentGatePort {
  return {
    check: () => ({ ok: true }),
    admitReenrollment: () => ({ ok: true }),
  };
}

export function neverEnrolledGate(): EnrollmentGatePort {
  return {
    check: () => ({ ok: false, reason: "device-not-enrolled" }),
    admitReenrollment: () => ({ ok: false, reason: "declared-reset-required" }),
  };
}
