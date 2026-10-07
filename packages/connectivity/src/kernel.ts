/**
 * @fleetos/connectivity — Wave 1 kernel (F210A).
 *
 * Advances the connectivity seam to kernel grade:
 *   - Audit reference emission (structural AuditEventRef) on every
 *     consequential decision (recordStatus, evaluate).
 *   - Tenant-scoped status reads (fail-closed): a status recorded under
 *     tenant A is invisible to tenant B.
 *   - A `ConnectivityDirectory` over a structural port + in-memory
 *     reference; the directory maintains a tenant-keyed status map and a
 *     deterministic policy evaluator.
 *   - Honest degraded state: when no status is recorded for a device,
 *     `status()` returns `unknown` (Wave 0 baseline preserved).
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import { createHash } from "node:crypto";
import {
  evaluateIntent,
  failClosedPolicy,
  type ConnectivityDecision,
  type ConnectivityIntent,
  type ConnectivityPolicy,
  type ConnectivityStatus,
  type DeviceIdLike,
  type TenantIdLike,
} from "./connectivity.js";

// ---------------------------------------------------------------------------
// AuditEventRef — structural audit reference (A19).
// ---------------------------------------------------------------------------

export interface AuditEventRef {
  readonly actor: string;
  readonly intent: string;
  readonly tenant: string;
  readonly timestamp: number;
  readonly digest: string;
}

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Tenant-scoped status record. The Wave 0 ConnectivityStatus did not carry
// a tenantId; the kernel adds a TenantStatusRecord that pairs the device
// with its tenant for fail-closed reads.
// ---------------------------------------------------------------------------

export interface TenantStatusRecord {
  readonly tenantId: TenantIdLike;
  readonly deviceId: DeviceIdLike;
  readonly state: ConnectivityStatus["state"];
  readonly observedAt: number;
}

// ---------------------------------------------------------------------------
// ConnectivityDirectoryPort — structural seam. Implementations may be
// in-memory (this package) or persistent (F211).
// ---------------------------------------------------------------------------

export interface ConnectivityDirectoryPort {
  readonly saveStatus: (status: TenantStatusRecord) => void;
  readonly findStatus: (tenantId: TenantIdLike, deviceId: DeviceIdLike) => TenantStatusRecord | null;
  readonly listStatusesByTenant: (tenantId: TenantIdLike) => ReadonlyArray<TenantStatusRecord>;
}

export class InMemoryConnectivityDirectory implements ConnectivityDirectoryPort {
  private readonly statuses = new Map<string, TenantStatusRecord>();
  saveStatus(s: TenantStatusRecord): void {
    this.statuses.set(`${s.tenantId}:${s.deviceId}`, s);
  }
  findStatus(t: TenantIdLike, d: DeviceIdLike): TenantStatusRecord | null {
    return this.statuses.get(`${t}:${d}`) ?? null;
  }
  listStatusesByTenant(t: TenantIdLike): ReadonlyArray<TenantStatusRecord> {
    const out: TenantStatusRecord[] = [];
    for (const s of this.statuses.values()) if (s.tenantId === t) out.push(s);
    return out.sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0));
  }
}

// ---------------------------------------------------------------------------
// ConnectivityDirectory — kernel service.
// ---------------------------------------------------------------------------

export type ConnectivityDirectoryRejectionCode =
  | "missing-tenant-id"
  | "missing-device-id"
  | "invalid-observed-at";

export type ConnectivityRecordResult =
  | { readonly ok: true; readonly record: TenantStatusRecord; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: ConnectivityDirectoryRejectionCode };

export class ConnectivityDirectory {
  constructor(
    private readonly port: ConnectivityDirectoryPort,
    private readonly policy: ConnectivityPolicy = failClosedPolicy(),
  ) {}

  recordStatus(input: {
    readonly tenantId: TenantIdLike;
    readonly deviceId: DeviceIdLike;
    readonly state: ConnectivityStatus["state"];
    readonly observedAt: number;
    readonly actor: string;
  }): ConnectivityRecordResult {
    if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
    if (input.deviceId === "") return { ok: false, reason: "missing-device-id" };
    if (!Number.isFinite(input.observedAt) || input.observedAt <= 0) {
      return { ok: false, reason: "invalid-observed-at" };
    }
    const record: TenantStatusRecord = {
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      state: input.state,
      observedAt: input.observedAt,
    };
    this.port.saveStatus(record);
    const audit: AuditEventRef = {
      actor: input.actor,
      intent: "connectivity:record-status",
      tenant: input.tenantId,
      timestamp: input.observedAt,
      digest: digestOf(input.tenantId, input.deviceId, input.state, input.observedAt),
    };
    return { ok: true, record, audit };
  }

  evaluate(input: {
    readonly tenantId: TenantIdLike;
    readonly deviceId: DeviceIdLike;
    readonly desiredState: "online" | "offline";
    readonly actor: string;
    readonly at: number;
  }): { readonly decision: ConnectivityDecision; readonly audit: AuditEventRef } {
    const intent: ConnectivityIntent = {
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      desiredState: input.desiredState,
    };
    const decision = evaluateIntent(intent, this.policy);
    const audit: AuditEventRef = {
      actor: input.actor,
      intent: `connectivity:evaluate:${decision.effect}`,
      tenant: input.tenantId,
      timestamp: input.at,
      digest: digestOf(input.tenantId, input.deviceId, decision.effect, input.at),
    };
    return { decision, audit };
  }

  status(tenantId: TenantIdLike, deviceId: DeviceIdLike): ConnectivityStatus {
    const rec = this.port.findStatus(tenantId, deviceId);
    if (!rec) return { deviceId, state: "unknown", observedAt: 0 };
    return { deviceId, state: rec.state, observedAt: rec.observedAt };
  }

  listStatuses(tenantId: TenantIdLike): ReadonlyArray<TenantStatusRecord> {
    return this.port.listStatusesByTenant(tenantId);
  }
}
