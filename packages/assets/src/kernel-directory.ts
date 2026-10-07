/**
 * @fleetos/assets — Wave 1 kernel directory (F210A).
 *
 * Lifecycle admission (admit -> enrolled -> retired) over a structural
 * AssetRepositoryPort + in-memory reference implementation. Tenant-scoped
 * reads fail-closed. Audit emission on every consequential operation (A19).
 *
 * Pure TypeScript over injected PORT interfaces. No I/O, no servers, no
 * databases. Persistence lands at F211 (TL lane).
 */

import {
  evaluateAssetTransition,
  type AssetId,
  type AssetKind,
  type AssetLifecycleCommand,
  type AssetLifecycleState,
  type DeviceId,
  type DeviceTwin,
  type TenantIdLike,
} from "./assets.js";
import type { AuditEventRef } from "./kernel-audit.js";
import { digestOf } from "./kernel-audit.js";

// ---------------------------------------------------------------------------
// ManagedAssetRecord — the durable asset entity the kernel operates on.
// ---------------------------------------------------------------------------

export interface ManagedAssetRecord {
  readonly id: AssetId;
  readonly tenantId: TenantIdLike;
  readonly kind: AssetKind;
  readonly displayName: string;
  readonly lifecycle: AssetLifecycleState;
  readonly createdAt: number;
  readonly enrolledAt: number | null;
  readonly retiredAt: number | null;
}

// ---------------------------------------------------------------------------
// AssetRepositoryPort — structural seam.
// ---------------------------------------------------------------------------

export interface AssetRepositoryPort {
  readonly saveAsset: (asset: ManagedAssetRecord) => void;
  readonly findAsset: (tenantId: TenantIdLike, id: AssetId) => ManagedAssetRecord | null;
  readonly listAssetsByTenant: (tenantId: TenantIdLike) => ReadonlyArray<ManagedAssetRecord>;
  readonly saveTwin: (twin: DeviceTwin) => void;
  readonly findTwin: (tenantId: TenantIdLike, deviceId: DeviceId) => DeviceTwin | null;
}

// ---------------------------------------------------------------------------
// InMemoryAssetRepository — deterministic reference.
// ---------------------------------------------------------------------------

export class InMemoryAssetRepository implements AssetRepositoryPort {
  private readonly assets = new Map<string, ManagedAssetRecord>();
  private readonly twins = new Map<string, DeviceTwin>();
  saveAsset(a: ManagedAssetRecord): void {
    this.assets.set(`${a.tenantId}:${a.id}`, a);
  }
  findAsset(t: TenantIdLike, id: AssetId): ManagedAssetRecord | null {
    return this.assets.get(`${t}:${id}`) ?? null;
  }
  listAssetsByTenant(t: TenantIdLike): ReadonlyArray<ManagedAssetRecord> {
    const out: ManagedAssetRecord[] = [];
    for (const a of this.assets.values()) if (a.tenantId === t) out.push(a);
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  saveTwin(twin: DeviceTwin): void {
    this.twins.set(`${twin.tenantId}:${twin.deviceId}`, twin);
  }
  findTwin(t: TenantIdLike, id: DeviceId): DeviceTwin | null {
    return this.twins.get(`${t}:${id}`) ?? null;
  }
}

// ---------------------------------------------------------------------------
// AssetDirectory — kernel service.
// ---------------------------------------------------------------------------

export type AssetAdmissionRejectionCode =
  | "duplicate-asset"
  | "malformed-asset-id"
  | "missing-display-name"
  | "invalid-created-at"
  | "unknown-asset"
  | "illegal-transition"
  | "already-in-target-state"
  | "tenant-mismatch";

export type AssetAdmissionResult =
  | { readonly ok: true; readonly asset: ManagedAssetRecord; readonly audit: AuditEventRef }
  | { readonly ok: false; readonly reason: AssetAdmissionRejectionCode };

const ASSET_ID_RE = /^ast_[A-Za-z0-9_-]{4,128}$/;

export class AssetDirectory {
  constructor(private readonly port: AssetRepositoryPort) {}

  admitAsset(input: {
    readonly assetId: string;
    readonly tenantId: TenantIdLike;
    readonly kind: AssetKind;
    readonly displayName: string;
    readonly createdAt: number;
    readonly actor: string;
  }): AssetAdmissionResult {
    if (typeof input.assetId !== "string" || !ASSET_ID_RE.test(input.assetId)) {
      return { ok: false, reason: "malformed-asset-id" };
    }
    if (input.displayName === "") return { ok: false, reason: "missing-display-name" };
    if (!Number.isFinite(input.createdAt) || input.createdAt <= 0) {
      return { ok: false, reason: "invalid-created-at" };
    }
    if (this.port.findAsset(input.tenantId, input.assetId as AssetId)) {
      return { ok: false, reason: "duplicate-asset" };
    }
    const asset: ManagedAssetRecord = {
      id: input.assetId as AssetId,
      tenantId: input.tenantId,
      kind: input.kind,
      displayName: input.displayName,
      lifecycle: "admitted",
      createdAt: input.createdAt,
      enrolledAt: null,
      retiredAt: null,
    };
    this.port.saveAsset(asset);
    const audit: AuditEventRef = {
      actor: input.actor,
      intent: "asset:admit",
      tenant: input.tenantId,
      timestamp: input.createdAt,
      digest: digestOf(input.assetId, "admit", input.createdAt),
    };
    return { ok: true, asset, audit };
  }

  transitionAsset(input: {
    readonly tenantId: TenantIdLike;
    readonly assetId: AssetId;
    readonly command: AssetLifecycleCommand;
    readonly at: number;
    readonly actor: string;
  }): AssetAdmissionResult {
    const asset = this.port.findAsset(input.tenantId, input.assetId);
    if (!asset) return { ok: false, reason: "unknown-asset" };
    if (asset.tenantId !== input.tenantId) return { ok: false, reason: "tenant-mismatch" };
    const r = evaluateAssetTransition(asset.lifecycle, input.command);
    if (!r.ok) {
      if (r.reason === "illegal-transition") return { ok: false, reason: "illegal-transition" };
      if (r.reason === "already-in-target-state") return { ok: false, reason: "already-in-target-state" };
      return { ok: false, reason: "illegal-transition" };
    }
    const next: ManagedAssetRecord = {
      ...asset,
      lifecycle: r.to,
      enrolledAt: input.command === "activate" ? input.at : asset.enrolledAt,
      retiredAt: input.command === "retire" ? input.at : asset.retiredAt,
    };
    this.port.saveAsset(next);
    const audit: AuditEventRef = {
      actor: input.actor,
      intent: `asset:${input.command}`,
      tenant: input.tenantId,
      timestamp: input.at,
      digest: digestOf(input.assetId, input.command, input.at),
    };
    return { ok: true, asset: next, audit };
  }

  lookupAsset(tenantId: TenantIdLike, id: AssetId): ManagedAssetRecord | null {
    return this.port.findAsset(tenantId, id);
  }

  listAssets(tenantId: TenantIdLike): ReadonlyArray<ManagedAssetRecord> {
    return this.port.listAssetsByTenant(tenantId);
  }
}
