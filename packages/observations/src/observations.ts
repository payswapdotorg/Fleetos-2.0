/**
 * @fleetos/observations — Wave 0 contracts.
 *
 * Pure TypeScript domain contracts ONLY. No I/O, no servers, no databases.
 *
 * Owns (per spec/BOUNDED-CONTEXTS.md "Observations & Evidence"):
 *   - immutable observations/events;
 *   - idempotent admission with ack semantics;
 *   - raw stays raw — no interpretation, no derivation.
 *
 * Architecture laws:
 *   - A3: raw observations/events are immutable;
 *   - A8: tenant context established at boundary, fail-closed cross-tenant.
 *
 * Cross-worker seam: uses structural `TenantIdLike`, `DeviceIdLike` instead
 * of importing @fleetos/identity or @fleetos/assets.
 *
 * Note on digest: `computePayloadDigest` is a pure, deterministic SHA-256 hex
 * digest over a UTF-8/byte payload. It uses `node:crypto` for the hash
 * primitive only — no I/O, no network, no process spawn. This is a
 * computational primitive, not an I/O dependency.
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Structural seam types
// ---------------------------------------------------------------------------

export type TenantIdLike = string;
export type DeviceIdLike = string;

// ---------------------------------------------------------------------------
// Branded ids
// ---------------------------------------------------------------------------

declare const __brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [__brand]: B };
export type ObservationId = Brand<string, "ObservationId">;
export type ObservationSeq = Brand<number, "ObservationSeq">;

const OBSERVATION_ID_RE = /^obs_[A-Za-z0-9_-]{8,256}$/;

export const isObservationId = (v: string): v is ObservationId =>
  typeof v === "string" && OBSERVATION_ID_RE.test(v);

// ---------------------------------------------------------------------------
// Observation — immutable by construction.
// ---------------------------------------------------------------------------

export type ObservationKind = string;

export interface Observation {
  readonly id: ObservationId;
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly seq: ObservationSeq;
  readonly observedAt: number;
  readonly kind: ObservationKind;
  readonly payloadDigest: string;
  /** Raw payload is preserved verbatim. The digest is computed once. */
  readonly payload?: Readonly<Uint8Array>;
  readonly admittedAt: number;
}

// ---------------------------------------------------------------------------
// Admission — idempotent, fail-closed, dedup by (deviceId, seq).
// ---------------------------------------------------------------------------

export type AdmissionRejectionCode =
  | "missing-device-id"
  | "missing-tenant-id"
  | "non-monotonic-seq"
  | "duplicate-seq"
  | "malformed-payload"
  | "invalid-observed-at";

export interface AdmissionInput {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly seq: number;
  readonly observedAt: number;
  readonly kind: ObservationKind;
  readonly payload?: Readonly<Uint8Array>;
  readonly admittedAt: number;
}

export interface AdmissionAck {
  readonly id: ObservationId;
  readonly deviceId: DeviceIdLike;
  readonly seq: ObservationSeq;
  readonly duplicate: boolean;
  readonly payloadDigest: string;
}

export type AdmissionResult =
  | {
      readonly ok: true;
      readonly observation: Observation;
      readonly ack: AdmissionAck;
    }
  | {
      readonly ok: false;
      readonly reason: AdmissionRejectionCode;
    };

// Pure, deterministic digest. Same payload bytes -> same digest, always.
export function computePayloadDigest(payload: Readonly<Uint8Array>): string {
  return createHash("sha256").update(payload).digest("hex");
}

// Idempotent admission store — a pure function over a small in-memory map.
// In Wave 0 this is the deterministic reference admission gate; persistence
// is the TL's responsibility at F211.
export interface AdmissionStore {
  /** Known (deviceId, seq) -> Observation.id map. */
  readonly known: ReadonlyMap<string, ObservationId>;
  /** Latest seq per deviceId (for monotonic enforcement). */
  readonly lastSeq: ReadonlyMap<string, number>;
}

export function emptyAdmissionStore(): AdmissionStore {
  return { known: new Map(), lastSeq: new Map() };
}

function makeObservationId(input: AdmissionInput, digest: string): ObservationId {
  // Deterministic id from (deviceId, seq, digest) — content-addressed.
  const raw = `obs_${input.deviceId}_${input.seq}_${digest.slice(0, 16)}`;
  return raw as ObservationId;
}

export function admitObservation(
  store: AdmissionStore,
  input: AdmissionInput,
): { readonly result: AdmissionResult; readonly store: AdmissionStore } {
  // Fail-closed validations.
  if (typeof input.tenantId !== "string" || input.tenantId === "") {
    return {
      result: { ok: false, reason: "missing-tenant-id" },
      store,
    };
  }
  if (typeof input.deviceId !== "string" || input.deviceId === "") {
    return {
      result: { ok: false, reason: "missing-device-id" },
      store,
    };
  }
  if (!Number.isFinite(input.observedAt) || input.observedAt <= 0) {
    return {
      result: { ok: false, reason: "invalid-observed-at" },
      store,
    };
  }

  const payload: Uint8Array = input.payload ?? new Uint8Array(0);
  if (!(payload instanceof Uint8Array)) {
    return { result: { ok: false, reason: "malformed-payload" }, store };
  }

  const digest = computePayloadDigest(payload);
  const id = makeObservationId(input, digest);
  const key = `${input.deviceId}:${input.seq}`;
  const seq = input.seq as ObservationSeq;

  // Dedup: idempotent ack for an already-known (deviceId, seq) pair.
  const existingId = store.known.get(key);
  if (existingId !== undefined) {
    const ack: AdmissionAck = {
      id: existingId,
      deviceId: input.deviceId,
      seq,
      duplicate: true,
      payloadDigest: digest,
    };
    return {
      result: { ok: true, observation: duplicateObservation(existingId, input, digest), ack },
      store, // store untouched — idempotent
    };
  }

  // Monotonic seq: this seq must exceed the latest known seq for the device.
  const last = store.lastSeq.get(input.deviceId) ?? 0;
  if (input.seq <= last) {
    return { result: { ok: false, reason: "non-monotonic-seq" }, store };
  }

  const observation: Observation = {
    id,
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    seq,
    observedAt: input.observedAt,
    kind: input.kind,
    payloadDigest: digest,
    payload: payload,
    admittedAt: input.admittedAt,
  };

  // Build a new store (immutably) — never mutate the input store.
  const known = new Map(store.known);
  known.set(key, id);
  const lastSeq = new Map(store.lastSeq);
  lastSeq.set(input.deviceId, input.seq);

  const ack: AdmissionAck = {
    id,
    deviceId: input.deviceId,
    seq,
    duplicate: false,
    payloadDigest: digest,
  };

  return {
    result: { ok: true, observation, ack },
    store: { known, lastSeq },
  };
}

function duplicateObservation(
  id: ObservationId,
  input: AdmissionInput,
  digest: string,
): Observation {
  const seq = input.seq as ObservationSeq;
  return {
    id,
    tenantId: input.tenantId,
    deviceId: input.deviceId,
    seq,
    observedAt: input.observedAt,
    kind: input.kind,
    payloadDigest: digest,
    admittedAt: input.admittedAt,
  };
}
