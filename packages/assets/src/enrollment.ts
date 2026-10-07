/**
 * @fleetos/assets — Wave 2 enrollment boundary (F220A).
 *
 * The enrollment boundary — an observation from an unenrolled device is
 * refused with a machine-stable reason. The kernel exposes the
 * EnrollmentDirectory service and the gateObservationOnEnrollment
 * predicate; the application layer consults it before admitting any
 * observation.
 *
 * Pure TypeScript. No I/O, no servers, no databases. Persistence lands
 * at F211 (TL lane).
 */

import type { DeviceId, TenantIdLike } from "./assets.js";
import type { AuditEventRef } from "./kernel-audit.js";
import { digestOf } from "./kernel-audit.js";

// ---------------------------------------------------------------------------
// EnrollmentRecord — the durable record of a device's enrollment in a tenant.
// ---------------------------------------------------------------------------

export interface EnrollmentRecord {
  readonly deviceId: DeviceId;
  readonly tenantId: TenantIdLike;
  readonly enrolledAt: number;
  readonly revokedAt: number | null;
}

export type EnrollmentRejectionCode =
  | "device-not-enrolled"
  | "device-enrollment-revoked"
  | "device-tenant-mismatch";

export type EnrollmentCheck =
  | { readonly ok: true; readonly enrollment: EnrollmentRecord }
  | { readonly ok: false; readonly reason: EnrollmentRejectionCode };

export function checkEnrollment(
  enrollment: EnrollmentRecord | null,
  tenantId: TenantIdLike,
  // The deviceId parameter is part of the public signature so callers can
  // pass it for symmetry; the implementation does not need to consult it
  // (the enrollment record's own deviceId is the source of truth).
  _deviceId: DeviceId,
): EnrollmentCheck {
  if (!enrollment) return { ok: false, reason: "device-not-enrolled" };
  if (enrollment.tenantId !== tenantId) return { ok: false, reason: "device-tenant-mismatch" };
  if (enrollment.revokedAt !== null) return { ok: false, reason: "device-enrollment-revoked" };
  return { ok: true, enrollment };
}

// ---------------------------------------------------------------------------
// EnrollmentRegistryPort — structural seam.
// ---------------------------------------------------------------------------

export interface EnrollmentRegistryPort {
  readonly save: (record: EnrollmentRecord) => void;
  readonly find: (tenantId: TenantIdLike, deviceId: DeviceId) => EnrollmentRecord | null;
}

export class InMemoryEnrollmentRegistry implements EnrollmentRegistryPort {
  private readonly records = new Map<string, EnrollmentRecord>();
  save(r: EnrollmentRecord): void {
    this.records.set(`${r.tenantId}:${r.deviceId}`, r);
  }
  find(t: TenantIdLike, d: DeviceId): EnrollmentRecord | null {
    return this.records.get(`${t}:${d}`) ?? null;
  }
}

// ---------------------------------------------------------------------------
// EnrollmentDirectory — the kernel service that admits an enrollment and
// emits an audit event. The directory pairs with the AssetDirectory's
// `transitionAsset` for the "activate" transition.
// ---------------------------------------------------------------------------

export type EnrollmentDirectoryRejectionCode =
  | "malformed-device-id"
  | "missing-tenant-id"
  | "duplicate-enrollment"
  | "unknown-enrollment"
  | "already-revoked";

export type EnrollmentDirectoryResult =
  | { readonly ok: true; readonly enrollment: EnrollmentRecord; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: EnrollmentDirectoryRejectionCode };

const DEVICE_ID_RE = /^dev_[A-Za-z0-9_-]{4,128}$/;

export class EnrollmentDirectory {
  constructor(private readonly port: EnrollmentRegistryPort) {}

  enroll(input: {
    readonly deviceId: string;
    readonly tenantId: TenantIdLike;
    readonly enrolledAt: number;
    readonly actor: string;
  }): EnrollmentDirectoryResult {
    if (typeof input.deviceId !== "string" || !DEVICE_ID_RE.test(input.deviceId)) {
      return { ok: false, reason: "malformed-device-id" };
    }
    if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
    const existing = this.port.find(input.tenantId, input.deviceId as DeviceId);
    if (existing && existing.revokedAt === null) {
      return { ok: false, reason: "duplicate-enrollment" };
    }
    const record: EnrollmentRecord = {
      deviceId: input.deviceId as DeviceId,
      tenantId: input.tenantId,
      enrolledAt: input.enrolledAt,
      revokedAt: null,
    };
    this.port.save(record);
    const audit: AuditEventRef = {
      actor: input.actor,
      intent: "asset:enroll",
      tenant: input.tenantId,
      timestamp: input.enrolledAt,
      digest: digestOf(input.deviceId, "enroll", input.enrolledAt),
    };
    return { ok: true, enrollment: record, audit };
  }

  revoke(input: {
    readonly tenantId: TenantIdLike;
    readonly deviceId: DeviceId;
    readonly revokedAt: number;
    readonly actor: string;
  }): EnrollmentDirectoryResult {
    const existing = this.port.find(input.tenantId, input.deviceId);
    if (!existing) return { ok: false, reason: "unknown-enrollment" };
    if (existing.revokedAt !== null) return { ok: false, reason: "already-revoked" };
    const next: EnrollmentRecord = { ...existing, revokedAt: input.revokedAt };
    this.port.save(next);
    const audit: AuditEventRef = {
      actor: input.actor,
      intent: "asset:enroll:revoke",
      tenant: input.tenantId,
      timestamp: input.revokedAt,
      digest: digestOf(input.deviceId, "enroll-revoke", input.revokedAt),
    };
    return { ok: true, enrollment: next, audit };
  }

  check(tenantId: TenantIdLike, deviceId: DeviceId): EnrollmentCheck {
    const r = this.port.find(tenantId, deviceId);
    return checkEnrollment(r, tenantId, deviceId);
  }
}

// ---------------------------------------------------------------------------
// Observation admission gated on enrollment — the canonical check the
// ingestion layer consults before admitting an observation. Refuses with
// machine-stable reason codes; never silently accepts.
// ---------------------------------------------------------------------------

export type ObservationAdmissionDecision =
  | { readonly ok: true; readonly enrollment: EnrollmentRecord }
  | { readonly ok: false; readonly reason: EnrollmentRejectionCode };

export function gateObservationOnEnrollment(
  directory: EnrollmentDirectory,
  tenantId: TenantIdLike,
  deviceId: DeviceId,
): ObservationAdmissionDecision {
  return directory.check(tenantId, deviceId);
}
