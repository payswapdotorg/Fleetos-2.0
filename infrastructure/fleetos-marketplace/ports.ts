/**
 * infrastructure/fleetos-marketplace/ports.ts — the REAL F361A kernel
 * ports over the authoritative PostgreSQL store (F370C, Wave 18 lane C).
 *
 * The F361A enrollment machine composes through three SYNCHRONOUS
 * structural seams (packages/assets, unedited — compose never
 * re-implement):
 *   - AssetRepositoryPort (saveAsset / findAsset / listAssetsByTenant)
 *   - ReceiptEnrollmentRegistryPort (save / find by tenant+serial)
 *   - TwinPort (findTwin / saveTwin)
 *
 * A real database is asynchronous, so each port instance keeps a WRITE-
 * BACK MIRROR of its PostgreSQL record set: saves update the mirror and
 * mark the record dirty; the service's one flush() per request writes
 * every dirty record in a single PostgreSQL transaction BEFORE the HTTP
 * response (the write-before-ack law — the mirror is a staging area,
 * never the truth). On boot, load() rebuilds the mirrors FROM the store
 * (A1: PostgreSQL is authoritative; the mirror is a cache of it, and it
 * is born empty — a restarted service serves only what the database
 * proves).
 *
 * Tenant law (A8): every port operation is scoped by the tenant the
 * caller supplies; the mirror is keyed tenant-first exactly like the
 * in-memory reference (the ports' own convention). Cross-tenant finds
 * find NOTHING (the reference behaviour, verbatim).
 */

import type {
  AssetEnrollmentRecord,
  AssetId,
  AssetLifecycleState,
  AssetRepositoryPort,
  DeviceId,
  DeviceTwin,
  ManagedAssetRecord,
  ReceiptEnrollmentRegistryPort,
  TenantIdLike,
  TwinPort,
} from "@fleetos/assets";
import type { MarketplaceStore, MarketplaceStoreCaller } from "./store.js";

/** The PG-backed ports for one service instance (one flush boundary). */
export class PgRegistryPorts implements AssetRepositoryPort, ReceiptEnrollmentRegistryPort, TwinPort {
  private readonly store: MarketplaceStore;
  private readonly assets = new Map<string, ManagedAssetRecord>();
  private readonly twins = new Map<string, DeviceTwin>();
  private readonly enrollments = new Map<string, AssetEnrollmentRecord>();
  private readonly dirtyAssets = new Set<string>();
  private readonly dirtyTwins = new Set<string>();
  private readonly dirtyEnrollments = new Set<string>();

  constructor(store: MarketplaceStore) {
    this.store = store;
  }

  /** Boot: rebuild the mirrors FROM the authoritative store (maintenance
   *  reads — the service's own rehydration, never exposed over HTTP). */
  async load(): Promise<{ assets: number; twins: number; enrollments: number }> {
    for (const asset of await this.store.listAllAssets()) {
      this.assets.set(`${asset.tenantId}:${asset.id}`, asset);
    }
    for (const enrollment of await this.store.listAllEnrollments()) {
      this.enrollments.set(`${enrollment.tenantId}:${enrollment.serial}`, enrollment);
    }
    for (const twin of await this.store.listAllTwins()) {
      this.twins.set(`${twin.tenantId}:${twin.deviceId}`, twin);
    }
    return { assets: this.assets.size, twins: this.twins.size, enrollments: this.enrollments.size };
  }

  /** Write-before-ack: commit every dirty record in ONE transaction. */
  async flush(): Promise<void> {
    if (this.dirtyAssets.size === 0 && this.dirtyTwins.size === 0 && this.dirtyEnrollments.size === 0) return;
    const callerOf = (tenantId: TenantIdLike): MarketplaceStoreCaller => ({ tenantId: String(tenantId) });
    await this.store.transact(async (tx) => {
      for (const key of this.dirtyAssets) {
        const asset = this.assets.get(key);
        if (asset !== undefined) await tx.saveAsset(callerOf(asset.tenantId), asset);
      }
      for (const key of this.dirtyTwins) {
        const twin = this.twins.get(key);
        if (twin !== undefined) await tx.saveTwin(callerOf(twin.tenantId), twin);
      }
      for (const key of this.dirtyEnrollments) {
        const enrollment = this.enrollments.get(key);
        if (enrollment !== undefined) await tx.saveEnrollment(callerOf(enrollment.tenantId), enrollment);
      }
    });
    this.dirtyAssets.clear();
    this.dirtyTwins.clear();
    this.dirtyEnrollments.clear();
  }

  // --- AssetRepositoryPort ---

  saveAsset(asset: ManagedAssetRecord): void {
    this.assets.set(`${asset.tenantId}:${asset.id}`, asset);
    this.dirtyAssets.add(`${asset.tenantId}:${asset.id}`);
  }

  findAsset(tenantId: TenantIdLike, id: AssetId): ManagedAssetRecord | null {
    return this.assets.get(`${String(tenantId)}:${String(id)}`) ?? null;
  }

  listAssetsByTenant(tenantId: TenantIdLike): ReadonlyArray<ManagedAssetRecord> {
    const out: ManagedAssetRecord[] = [];
    for (const asset of this.assets.values()) {
      if (asset.tenantId === String(tenantId)) out.push(asset);
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  // --- ReceiptEnrollmentRegistryPort ---

  save(record: AssetEnrollmentRecord): void {
    this.enrollments.set(`${record.tenantId}:${record.serial}`, record);
    this.dirtyEnrollments.add(`${record.tenantId}:${record.serial}`);
  }

  find(tenantId: TenantIdLike, serial: string): AssetEnrollmentRecord | null {
    return this.enrollments.get(`${String(tenantId)}:${serial}`) ?? null;
  }

  // --- TwinPort ---

  saveTwin(twin: DeviceTwin): void {
    this.twins.set(`${twin.tenantId}:${twin.deviceId}`, twin);
    this.dirtyTwins.add(`${twin.tenantId}:${twin.deviceId}`);
  }

  findTwin(tenantId: TenantIdLike, deviceId: DeviceId): DeviceTwin | null {
    return this.twins.get(`${String(tenantId)}:${String(deviceId)}`) ?? null;
  }
}

/** Deterministic lifecycle rank for state read-models (the driver convention). */
export function lifecycleRank(value: AssetLifecycleState): number {
  const order: readonly AssetLifecycleState[] = ["admitted", "active", "retired"];
  const index = order.indexOf(value);
  return index === -1 ? 99 : index;
}
