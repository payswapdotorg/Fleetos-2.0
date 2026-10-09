/**
 * @fleetos/observations — Wave 8 fleet-scale ingestion hardening (F280A).
 *
 * The F220A pipeline (ingestion.ts) proved admission semantics at unit
 * scale; F230A added the store-and-forward receiving side. This module
 * hardens the SAME pipeline for fleet-scale ingestion:
 *
 *   - **Bounded ingestion buffers** — a REAL bounded buffer of raw entries
 *     (per-tenant scope) with an explicit, caller-chosen overflow policy:
 *     `drop-oldest` (shed the oldest entry to make room, the evicted entry
 *     is SURFACED — never silently dropped) or `reject-newest` (refuse the
 *     new entry with `buffer-full`). Both policies are tested at the limit.
 *     Byte-accounting bound: the buffer refuses entries that would exceed
 *     `maxTotalPayloadBytes` regardless of entry count.
 *   - **Per-tenant admission caps** — fail-closed over-capacity refusals
 *     with REAL reason codes carrying the actual numbers (cap, used,
 *     requested). Tenant cap state is isolated per tenant: one tenant's
 *     burst never consumes another tenant's cap.
 *   - **Batch-size limits with honest partial-accept semantics** — a batch
 *     larger than `maxBatchSize` is refused WHOLE (`batch-too-large`;
 *     nothing admitted — fail-closed). Within an accepted batch, each item
 *     is admitted or refused independently with a per-item ack; items that
 *     exceed the tenant cap are refused `tenant-cap-exceeded` while earlier
 *     items in the same batch stay admitted (partial accept, never a
 *     silently truncated batch). Duplicate acks consume NO cap budget.
 *
 * ## Memory-shape bounds (documented worst case for a max batch)
 *
 * With `maxBatchSize = B` (default 256) and `maxPayloadBytesPerItem = P`
 * (default 8192), one `admitBatchWithLimits` call touches at most:
 *   - `B × P` payload bytes ≈ 2 MiB at the defaults (256 × 8192 = 2,097,152)
 *     — the caller-supplied input array itself; the pipeline adds no
 *     payload copies (digesting is streaming over the same bytes);
 *   - `B` per-item ack records (fixed small structs);
 *   - ≤ B new admission-store entries (one per ACCEPTED item, keyed
 *     `deviceId:seq`), i.e. the store grows by at most B entries per call —
 *     bounded by caller admitted volume, not by refused volume;
 *   - ≤ B canonical-field maps during normalize (transient, one at a time).
 * The ingestion buffer holds at most `maxEntries` entries totalling at
 * most `maxTotalPayloadBytes` payload bytes (both enforced, both tested).
 *
 * Pure deterministic TypeScript; logical `now` / caller-supplied inputs
 * everywhere; no Date.now, no Math.random, no network, no timers.
 */

import {
  runPipeline,
  type PipelineStage,
  type RawObservationInput,
  type StageFailureCode,
  type StageMetrics,
} from "./ingestion.js";
import type { AdmissionStore, TenantIdLike } from "./observations.js";

export type { PipelineStage, RawObservationInput, StageMetrics };

// ---------------------------------------------------------------------------
// Ingestion overflow policy — caller-chosen; both branches tested.
// ---------------------------------------------------------------------------

export type IngestionOverflowPolicy = "drop-oldest" | "reject-newest";

export interface IngestionBufferPolicy {
  readonly maxEntries: number;
  readonly maxTotalPayloadBytes: number;
  readonly overflow: IngestionOverflowPolicy;
}

export function defaultIngestionBufferPolicy(): IngestionBufferPolicy {
  return { maxEntries: 1024, maxTotalPayloadBytes: 4 * 1024 * 1024, overflow: "reject-newest" };
}

// ---------------------------------------------------------------------------
// Bounded ingestion buffer — a REAL FIFO buffer of raw payloads, per-tenant.
// ---------------------------------------------------------------------------

export interface IngestionBufferEntry {
  readonly tenantId: TenantIdLike;
  readonly deviceId: string;
  readonly sequence: number; // per-buffer monotonic capture order (FIFO law)
  readonly capturedAt: number; // logical time
  readonly payloadBytes: number;
  readonly payload: Readonly<Uint8Array>;
}

export interface IngestionBuffer {
  readonly tenantId: TenantIdLike; // fail-closed tenant scope
  readonly entries: ReadonlyArray<IngestionBufferEntry>;
  readonly nextSequence: number;
  readonly totalPayloadBytes: number;
  readonly policy: IngestionBufferPolicy;
  readonly droppedOldest: number; // honest counters — never hidden
  readonly rejectedNewest: number;
}

export type IngestionBufferRejectionCode =
  | "invalid-buffer-policy"
  | "missing-tenant-id"
  | "missing-device-id"
  | "tenant-mismatch"
  | "missing-payload"
  | "payload-too-large" // a single entry larger than the whole byte budget
  | "buffer-full"; // reject-newest policy at the entry or byte bound

export type IngestionBufferOutcome =
  | {
      readonly ok: true;
      readonly entry: IngestionBufferEntry;
      readonly buffer: IngestionBuffer;
      readonly evicted: IngestionBufferEntry | null; // drop-oldest only — surfaced
    }
  | { readonly ok: false; readonly reason: IngestionBufferRejectionCode; readonly buffer: IngestionBuffer };

export function emptyIngestionBuffer(tenantId: TenantIdLike, policy: IngestionBufferPolicy): IngestionBuffer {
  if (policy.maxEntries < 1 || policy.maxTotalPayloadBytes < 1) {
    throw new TypeError("emptyIngestionBuffer: maxEntries and maxTotalPayloadBytes must be >= 1");
  }
  return {
    tenantId,
    entries: [],
    nextSequence: 1,
    totalPayloadBytes: 0,
    policy,
    droppedOldest: 0,
    rejectedNewest: 0,
  };
}

export function bufferIngestionEntry(
  buffer: IngestionBuffer,
  input: { readonly deviceId: string; readonly payload: Readonly<Uint8Array>; readonly at: number },
): IngestionBufferOutcome {
  if (input.deviceId === "") return { ok: false, reason: "missing-device-id", buffer };
  if (!(input.payload instanceof Uint8Array) || input.payload.length === 0) {
    return { ok: false, reason: "missing-payload", buffer };
  }
  const payloadBytes = input.payload.length;
  if (payloadBytes > buffer.policy.maxTotalPayloadBytes) {
    return { ok: false, reason: "payload-too-large", buffer };
  }

  const entry: IngestionBufferEntry = {
    tenantId: buffer.tenantId,
    deviceId: input.deviceId,
    sequence: buffer.nextSequence,
    capturedAt: input.at,
    payloadBytes,
    payload: input.payload,
  };

  // Drop-oldest shed loop: evict from the front until the new entry fits.
  let entries = [...buffer.entries];
  let totalPayloadBytes = buffer.totalPayloadBytes;
  let droppedOldest = buffer.droppedOldest;
  let evicted: IngestionBufferEntry | null = null;
  let lastEvicted: IngestionBufferEntry | null = null;

  const entryCountExceeded = entries.length >= buffer.policy.maxEntries;
  const byteBudgetExceeded = totalPayloadBytes + payloadBytes > buffer.policy.maxTotalPayloadBytes;
  if ((entryCountExceeded || byteBudgetExceeded) && buffer.policy.overflow === "reject-newest") {
    return {
      ok: false,
      reason: "buffer-full",
      buffer: { ...buffer, rejectedNewest: buffer.rejectedNewest + 1 },
    };
  }
  while (
    entries.length >= buffer.policy.maxEntries ||
    totalPayloadBytes + payloadBytes > buffer.policy.maxTotalPayloadBytes
  ) {
    if (entries.length === 0) break; // single entry larger than budget handled above
    lastEvicted = entries[0]!;
    entries = entries.slice(1);
    totalPayloadBytes -= lastEvicted.payloadBytes;
    droppedOldest += 1;
  }
  evicted = lastEvicted;

  entries = [...entries, entry];
  totalPayloadBytes += payloadBytes;
  return {
    ok: true,
    entry,
    evicted,
    buffer: {
      ...buffer,
      entries,
      nextSequence: buffer.nextSequence + 1,
      totalPayloadBytes,
      droppedOldest,
    },
  };
}

// ---------------------------------------------------------------------------
// Tenant admission caps — fail-closed over-capacity refusals.
// ---------------------------------------------------------------------------

export interface TenantAdmissionCap {
  readonly tenantId: TenantIdLike;
  readonly cap: number;
  readonly used: number;
}

export interface TenantAdmissionCaps {
  readonly tenants: ReadonlyMap<TenantIdLike, TenantAdmissionCap>;
  readonly defaultCap: number;
}

export function emptyTenantAdmissionCaps(defaultCap: number): TenantAdmissionCaps {
  if (defaultCap < 1) throw new TypeError("emptyTenantAdmissionCaps: defaultCap must be >= 1");
  return { tenants: new Map(), defaultCap };
}

export function withTenantCap(caps: TenantAdmissionCaps, tenantId: TenantIdLike, cap: number): TenantAdmissionCaps {
  if (tenantId === "") throw new TypeError("withTenantCap: missing tenantId");
  if (cap < 1) throw new TypeError("withTenantCap: cap must be >= 1");
  const tenants = new Map(caps.tenants);
  const existing = tenants.get(tenantId);
  tenants.set(tenantId, { tenantId, cap, used: existing?.used ?? 0 });
  return { ...caps, tenants };
}

export type AdmissionCapDecision =
  | { readonly ok: true; readonly cap: number; readonly used: number; readonly remaining: number }
  | {
      readonly ok: false;
      readonly reason: "missing-tenant-id" | "tenant-cap-exceeded";
      readonly cap: number;
      readonly used: number;
      readonly requested: number;
    };

export function checkTenantAdmission(
  caps: TenantAdmissionCaps,
  tenantId: TenantIdLike,
  requested: number,
): AdmissionCapDecision {
  return checkAdmissionAgainst(caps, tenantId, requested, 0);
}

/** Cap check with extra in-flight usage (batch running usage) projected in. */
function checkAdmissionAgainst(
  caps: TenantAdmissionCaps,
  tenantId: TenantIdLike,
  requested: number,
  inFlight: number,
): AdmissionCapDecision {
  if (tenantId === "" || !Number.isFinite(requested) || requested < 0) {
    return { ok: false, reason: "missing-tenant-id", cap: 0, used: 0, requested };
  }
  const entry = caps.tenants.get(tenantId);
  const cap = entry?.cap ?? caps.defaultCap;
  const used = (entry?.used ?? 0) + inFlight;
  if (used + requested > cap) {
    // Fail-closed over-capacity refusal with the REAL numbers.
    return { ok: false, reason: "tenant-cap-exceeded", cap, used, requested };
  }
  return { ok: true, cap, used, remaining: cap - used - requested };
}

export function recordTenantAdmissions(
  caps: TenantAdmissionCaps,
  tenantId: TenantIdLike,
  admitted: number,
): TenantAdmissionCaps {
  if (tenantId === "") throw new TypeError("recordTenantAdmissions: missing tenantId");
  if (admitted < 0) throw new TypeError("recordTenantAdmissions: admitted must be >= 0");
  if (admitted === 0) return caps;
  const tenants = new Map(caps.tenants);
  const existing = tenants.get(tenantId);
  const cap = existing?.cap ?? caps.defaultCap;
  const used = existing?.used ?? 0;
  tenants.set(tenantId, { tenantId, cap, used: used + admitted });
  return { ...caps, tenants };
}

// ---------------------------------------------------------------------------
// Bounded batch admission — batch-size limits + honest partial accept.
// ---------------------------------------------------------------------------

export interface IngestionLimits {
  readonly maxBatchSize: number;
  readonly maxPayloadBytesPerItem: number;
}

export function defaultIngestionLimits(): IngestionLimits {
  // Worst-case batch footprint at these defaults: 256 × 8192 = 2,097,152
  // payload bytes ≈ 2 MiB (see module doc for the full memory-shape law).
  return { maxBatchSize: 256, maxPayloadBytesPerItem: 8192 };
}

export type LimitedBatchRejectionCode =
  | StageFailureCode
  | "tenant-cap-exceeded"
  | "payload-too-large";

export interface LimitedBatchAck {
  readonly index: number;
  readonly ok: boolean;
  readonly duplicate?: boolean;
  readonly observationId?: string;
  readonly reason?: LimitedBatchRejectionCode;
  readonly cap?: number; // populated on tenant-cap-exceeded — the REAL numbers
  readonly used?: number;
  readonly requested?: number;
}

export type LimitedBatchResult =
  | { readonly ok: false; readonly reason: "batch-too-large"; readonly size: number; readonly maxBatchSize: number }
  | {
      readonly ok: true;
      readonly acks: ReadonlyArray<LimitedBatchAck>;
      readonly store: AdmissionStore;
      readonly metrics: StageMetrics;
      readonly caps: TenantAdmissionCaps;
      readonly admittedCount: number;
      readonly duplicateCount: number;
      readonly refusedCount: number;
    };

export function admitBatchWithLimits(
  store: AdmissionStore,
  metrics: StageMetrics,
  caps: TenantAdmissionCaps,
  inputs: ReadonlyArray<RawObservationInput>,
  limits: IngestionLimits,
): LimitedBatchResult {
  if (limits.maxBatchSize < 1 || limits.maxPayloadBytesPerItem < 1) {
    throw new TypeError("admitBatchWithLimits: limits must be >= 1");
  }
  // Fail-closed whole-batch refusal: an over-limit batch admits NOTHING.
  if (inputs.length > limits.maxBatchSize) {
    return { ok: false, reason: "batch-too-large", size: inputs.length, maxBatchSize: limits.maxBatchSize };
  }

  let s = store;
  let m = metrics;
  let nextCaps = caps;
  const acks: LimitedBatchAck[] = [];
  // Running per-tenant usage across THIS batch so the cap law holds for the
  // batch as a whole, not just per item in isolation.
  const pendingUsage = new Map<TenantIdLike, number>();
  const admittedPerTenant = new Map<TenantIdLike, number>();
  let admittedCount = 0;
  let duplicateCount = 0;
  let refusedCount = 0;

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    if (input.payload.length > limits.maxPayloadBytesPerItem) {
      acks.push({ index: i, ok: false, reason: "payload-too-large" });
      refusedCount += 1;
      continue;
    }
    // Idempotency law: a re-delivered (deviceId, seq) that the store already
    // knows is a DUPLICATE — it consumes no admission resources, so the cap
    // gate only applies to genuinely-new items. (The pipeline still produces
    // the per-item ack; a by-key duplicate that fails validation is refused
    // by its stage code and consumes nothing either.)
    const duplicateByKey = s.known.has(`${input.deviceId}:${input.seq}`);
    if (!duplicateByKey) {
      // Cap law holds across the WHOLE batch: running usage from earlier
      // items in this batch counts against the tenant's cap for later items.
      const decision = checkAdmissionAgainst(
        caps,
        input.tenantId,
        1,
        pendingUsage.get(input.tenantId) ?? 0,
      );
      if (!decision.ok) {
        if (decision.reason === "tenant-cap-exceeded") {
          // Fail-closed per-item refusal — earlier items STAY admitted.
          acks.push({
            index: i,
            ok: false,
            reason: "tenant-cap-exceeded",
            cap: decision.cap,
            used: decision.used,
            requested: decision.requested,
          });
        } else {
          acks.push({ index: i, ok: false, reason: "missing-tenant-id" });
        }
        refusedCount += 1;
        continue;
      }
    }

    const r = runPipeline(s, m, input);
    m = r.metrics;
    if (r.ok) {
      s = r.store;
      const duplicate = r.ack.duplicate;
      if (duplicate) {
        // Idempotent duplicate ack — consumes NO cap budget (store unchanged).
        duplicateCount += 1;
      } else {
        admittedCount += 1;
        pendingUsage.set(input.tenantId, (pendingUsage.get(input.tenantId) ?? 0) + 1);
        admittedPerTenant.set(input.tenantId, (admittedPerTenant.get(input.tenantId) ?? 0) + 1);
      }
      acks.push({ index: i, ok: true, duplicate, observationId: r.observation.id });
    } else {
      acks.push({ index: i, ok: false, reason: r.reason });
      refusedCount += 1;
    }
  }

  // Commit the batch's admitted volume into the durable cap state.
  for (const [tenantId, admitted] of admittedPerTenant) {
    nextCaps = recordTenantAdmissions(nextCaps, tenantId, admitted);
  }
  return {
    ok: true,
    acks,
    store: s,
    metrics: m,
    caps: nextCaps,
    admittedCount,
    duplicateCount,
    refusedCount,
  };
}
