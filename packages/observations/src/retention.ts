/**
 * @fleetos/observations — Wave 2 retention/read-model projection contracts (F220A).
 *
 * Per the storage-authority table in DEPENDENCY-GRAPH.md:
 *   - PostgreSQL = business truth (immutable observation store lives here).
 *   - Redis/Queue = coordination only (no business truth).
 *   - Search/index projections = disposable projections (rebuildable).
 *
 * The kernel exposes the typed contracts; the actual persistence lands at
 * F211 (TL lane).
 */

import { createHash } from "node:crypto";
import type {
  DeviceIdLike,
  Observation,
  ObservationKind,
  TenantIdLike,
} from "./observations.js";

// ---------------------------------------------------------------------------
// ImmutableObservationStore — the durable, append-only observation store.
// ---------------------------------------------------------------------------

export interface ImmutableObservationStore {
  /** Tenant-scoped, fail-closed reads. */
  readonly findByKey: (tenantId: TenantIdLike, deviceId: DeviceIdLike, seq: number) => Observation | null;
  readonly listByDevice: (tenantId: TenantIdLike, deviceId: DeviceIdLike) => ReadonlyArray<Observation>;
  readonly lastSeqForDevice: (deviceId: DeviceIdLike) => number;
  readonly size: number;
}

export interface InMemoryImmutableStore extends ImmutableObservationStore {
  readonly append: (observation: Observation) => void;
}

export function createInMemoryImmutableStore(): InMemoryImmutableStore {
  const byKey = new Map<string, Observation>();
  const byDevice = new Map<DeviceIdLike, Observation[]>();
  const lastSeq = new Map<DeviceIdLike, number>();
  return {
    append(obs: Observation) {
      const key = `${obs.tenantId}:${obs.deviceId}:${obs.seq}`;
      if (byKey.has(key)) return; // idempotent
      byKey.set(key, obs);
      const list = byDevice.get(obs.deviceId) ?? [];
      list.push(obs);
      byDevice.set(obs.deviceId, list);
      const last = lastSeq.get(obs.deviceId) ?? 0;
      if ((obs.seq as number) > last) lastSeq.set(obs.deviceId, obs.seq as number);
    },
    findByKey(t: TenantIdLike, d: DeviceIdLike, seq: number) {
      const obs = byKey.get(`${t}:${d}:${seq}`);
      if (!obs) return null;
      if (obs.tenantId !== t) return null; // fail-closed
      return obs;
    },
    listByDevice(t: TenantIdLike, d: DeviceIdLike) {
      const list = byDevice.get(d) ?? [];
      return list.filter((o) => o.tenantId === t);
    },
    lastSeqForDevice(d: DeviceIdLike) {
      return lastSeq.get(d) ?? 0;
    },
    get size() {
      return byKey.size;
    },
  };
}

// ---------------------------------------------------------------------------
// Disposable projection contracts. A projection is built FROM the immutable
// store; it is rebuildable at any time and carries no business truth of its
// own. The projection lifecycle: build -> use -> invalidate -> rebuild.
// ---------------------------------------------------------------------------

export interface ProjectionMetadata {
  readonly id: string;
  readonly kind: "device-summary" | "tenant-rollup" | "kind-index";
  readonly tenantId: TenantIdLike;
  readonly builtAt: number;
  readonly sourceHash: string; // sha-256 over the source observations
}

export interface DeviceSummaryProjection {
  readonly meta: ProjectionMetadata;
  readonly deviceId: DeviceIdLike;
  readonly count: number;
  readonly lastSeq: number;
  readonly lastObservedAt: number;
  readonly kinds: ReadonlyArray<ObservationKind>;
}

export function buildDeviceSummary(
  store: ImmutableObservationStore,
  tenantId: TenantIdLike,
  deviceId: DeviceIdLike,
  builtAt: number,
): DeviceSummaryProjection {
  const obs = store.listByDevice(tenantId, deviceId);
  const kinds = new Set<ObservationKind>();
  let lastSeq = 0;
  let lastObservedAt = 0;
  for (const o of obs) {
    kinds.add(o.kind);
    if ((o.seq as number) > lastSeq) lastSeq = o.seq as number;
    if (o.observedAt > lastObservedAt) lastObservedAt = o.observedAt;
  }
  const sourceHash = createHash("sha256")
    .update(obs.map((o) => o.id).join("|"))
    .digest("hex");
  return {
    meta: { id: `proj_device_summary_${tenantId}_${deviceId}_${builtAt}`, kind: "device-summary", tenantId, builtAt, sourceHash },
    deviceId,
    count: obs.length,
    lastSeq,
    lastObservedAt,
    kinds: [...kinds].sort(),
  };
}

// ---------------------------------------------------------------------------
// Retention policy — the immutable store is append-only; projections may be
// discarded and rebuilt at any time. The kernel exposes the policy as a
// typed value so callers know when to rebuild projections.
// ---------------------------------------------------------------------------

export interface RetentionPolicy {
  readonly immutableStoreTtl: number | null; // null = forever
  readonly projectionTtlMs: number;
  readonly rebuildOnDrift: boolean;
}

export function defaultRetentionPolicy(): RetentionPolicy {
  return {
    immutableStoreTtl: null,
    projectionTtlMs: 5 * 60 * 1000,
    rebuildOnDrift: true,
  };
}

export function projectionStale(meta: ProjectionMetadata, now: number, policy: RetentionPolicy): boolean {
  return now - meta.builtAt > policy.projectionTtlMs;
}
