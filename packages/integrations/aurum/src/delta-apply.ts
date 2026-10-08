/**
 * @fleetos/aurum — incremental external projection application (Wave 5).
 *
 * Applies upsert/delete delta batches from the external Aurum system onto
 * a LOCAL REPLICA store. The store is a projection replica with provenance
 * — never business truth (law A1); the composing application reconstructs
 * authoritative records from it.
 *
 * CONFLICT RESOLUTION RULE (documented, deterministic):
 *   last-writer-wins by the (source, logical-time, id) tuple. The store is
 *   scoped to one source, so the comparison is (logical-time, external id):
 *     - incoming.logicalTime > current.logicalTime  → incoming WINS
 *     - incoming.logicalTime < current.logicalTime  → incoming is SKIPPED
 *       as stale (recorded in `skippedStale`, never silently dropped)
 *     - equal logical time, same op, same payload digest → idempotent
 *       duplicate (SKIPPED, recorded in `skippedDuplicate`)
 *     - equal logical time but different op or different payload digest →
 *       an UNRESOLVABLE tie: the delta is QUARANTINED with
 *       `CONFLICT_SAME_TUPLE_DIFFERENT_PAYLOAD` — never silently resolved.
 *
 * QUARANTINE (honest, never silent, never dropped): structurally malformed
 * deltas and unresolvable conflicts are recorded in `store.quarantined`
 * with a reason code and the ORIGINAL delta verbatim.
 *
 * ATOMIC BATCH SEMANTICS: a batch is never partially applied. A batch-level
 * refusal (invalid tenant, tenant/source mismatch, malformed envelope,
 * conflicting duplicate idempotency key inside the batch) changes NOTHING —
 * the caller keeps the original store. Delta-level quarantine is an explicit
 * recorded outcome of a committed batch, not partial application.
 *
 * All functions are pure: inputs are never mutated; time is a caller-supplied
 * logical input; no clocks, no randomness, no network.
 */
import { validateTenantScope, type TenantScope } from "./tenant.js";
import { canonicalJson, fnv1a32Hex } from "./digest.js";

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export type DeltaOp = "upsert" | "delete";

export interface ExternalProjectionDelta {
  readonly op: DeltaOp;
  readonly externalId: string;
  /** Required for upserts; ignored for deletes. */
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly logicalTime: number;
  readonly idempotencyKey: string;
}

export interface ExternalProjectionBatch {
  readonly kind: "external-projection-batch";
  readonly tenant: TenantScope;
  readonly source: string;
  readonly deltas: readonly ExternalProjectionDelta[];
}

export type QuarantineReasonCode =
  | "MALFORMED_OP_UNKNOWN"
  | "MALFORMED_EXTERNAL_ID_EMPTY"
  | "MALFORMED_UPSERT_WITHOUT_PAYLOAD"
  | "MALFORMED_LOGICAL_TIME"
  | "MALFORMED_IDEMPOTENCY_KEY_EMPTY"
  | "CONFLICT_SAME_TUPLE_DIFFERENT_PAYLOAD"
  | "DELETE_TARGET_UNKNOWN";

export interface QuarantinedDelta {
  readonly reasonCode: QuarantineReasonCode;
  readonly detail: string;
  readonly delta: ExternalProjectionDelta;
}

/** A replica projection. `deletedAt !== null` marks a tombstone (LWW memory). */
export interface AppliedProjection {
  readonly externalId: string;
  readonly source: string;
  readonly payload: Readonly<Record<string, unknown>> | null;
  readonly logicalTime: number;
  readonly idempotencyKey: string;
  readonly deletedAt: number | null;
  readonly projectionDigest: string;
}

export interface ProjectionStore {
  readonly tenant: TenantScope;
  readonly source: string;
  readonly projections: ReadonlyMap<string, AppliedProjection>;
  readonly quarantined: readonly QuarantinedDelta[];
  /** Digest over the applied projection set (law A19 replica verification). */
  readonly storeDigest: string;
}

export interface DeltaApplyOutcome {
  readonly applied: readonly string[];
  readonly skippedStale: readonly string[];
  readonly skippedDuplicate: readonly string[];
  readonly quarantined: readonly QuarantinedDelta[];
}

export type DeltaBatchRefusalCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "SOURCE_EMPTY"
  | "SOURCE_MISMATCH"
  | "BATCH_KIND_INVALID"
  | "EMPTY_BATCH"
  | "DUPLICATE_IDEMPOTENCY_KEY_IN_BATCH";

export type DeltaApplyResult =
  | {
      readonly ok: true;
      readonly store: ProjectionStore;
      readonly outcome: DeltaApplyOutcome;
      readonly batchDigest: string;
    }
  | { readonly ok: false; readonly reasonCode: DeltaBatchRefusalCode; readonly detail: string };

// ---------------------------------------------------------------------------
// Digests.
// ---------------------------------------------------------------------------

export function computeProjectionDigest(
  source: string,
  externalId: string,
  logicalTime: number,
  op: DeltaOp,
  payload: Readonly<Record<string, unknown>> | null,
): string {
  return fnv1a32Hex(
    "proj",
    [source, externalId, op, String(logicalTime), payload === null ? "\u2205" : canonicalJson(payload)].join("\u241f"),
  );
}

/** Digest over a batch's deltas in CANONICAL order — input-order independent. */
export function computeBatchDigest(batch: ExternalProjectionBatch): string {
  const keyed = [...batch.deltas]
    .map((d) => ({
      sortKey: `${d.op}\u241f${d.externalId}\u241f${String(d.logicalTime)}\u241f${d.idempotencyKey}`,
      d,
    }))
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  const joined = keyed
    .map((e) => `${e.sortKey}\u241f${e.d.payload === null ? "\u2205" : canonicalJson(e.d.payload)}`)
    .join("\u241e");
  return fnv1a32Hex("batch", `${batch.source}\u241f${joined}`);
}

export function computeStoreDigest(store: Pick<ProjectionStore, "projections">): string {
  const ids = [...store.projections.keys()].sort();
  let digest = "store_genesis";
  for (const id of ids) {
    digest = fnv1a32Hex("store", `${digest}\u241f${id}\u241f${store.projections.get(id)?.projectionDigest ?? ""}`);
  }
  return digest;
}

export function verifyStoreDigest(store: ProjectionStore): { ok: boolean; expected: string } {
  // Per-projection integrity first: every stored digest must recompute from
  // the stored fields (tampered payloads are detected here), then the chain
  // of projection digests must reproduce the stored store digest.
  for (const p of store.projections.values()) {
    const op: DeltaOp = p.deletedAt === null ? "upsert" : "delete";
    const recomputed = computeProjectionDigest(p.source, p.externalId, p.logicalTime, op, p.payload);
    if (recomputed !== p.projectionDigest) return { ok: false, expected: "projection-integrity" };
  }
  const expected = computeStoreDigest(store);
  return { ok: expected === store.storeDigest, expected };
}

/** Live (non-tombstone) projections, lexically ordered by external id. */
export function listLiveProjections(store: ProjectionStore): readonly AppliedProjection[] {
  return [...store.projections.values()]
    .filter((p) => p.deletedAt === null)
    .sort((a, b) => (a.externalId < b.externalId ? -1 : a.externalId > b.externalId ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Store construction.
// ---------------------------------------------------------------------------

export type OpenStoreResult =
  | { readonly ok: true; readonly store: ProjectionStore }
  | { readonly ok: false; readonly reasonCode: "TENANT_SCOPE_MISSING" | "SOURCE_EMPTY" };

export function openProjectionStore(tenant: TenantScope, source: string): OpenStoreResult {
  const scope = validateTenantScope(tenant);
  if (!scope.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (source.trim().length === 0) return { ok: false, reasonCode: "SOURCE_EMPTY" };
  return { ok: true, store: { tenant: scope.scope, source, projections: new Map(), quarantined: [], storeDigest: "store_genesis" } };
}

// ---------------------------------------------------------------------------
// Structural delta validation.
// ---------------------------------------------------------------------------

function structurallyMalformed(delta: ExternalProjectionDelta): QuarantinedDelta | null {
  if (delta.op !== "upsert" && delta.op !== "delete") {
    return {
      reasonCode: "MALFORMED_OP_UNKNOWN",
      detail: `op is "${String(delta.op)}"`,
      delta,
    };
  }
  if (typeof delta.externalId !== "string" || delta.externalId.trim().length === 0) {
    return { reasonCode: "MALFORMED_EXTERNAL_ID_EMPTY", detail: "externalId is empty", delta };
  }
  if (delta.op === "upsert" && (delta.payload === null || typeof delta.payload !== "object")) {
    return { reasonCode: "MALFORMED_UPSERT_WITHOUT_PAYLOAD", detail: "upsert carries no payload", delta };
  }
  if (!Number.isInteger(delta.logicalTime) || delta.logicalTime < 0) {
    return { reasonCode: "MALFORMED_LOGICAL_TIME", detail: `logicalTime is ${String(delta.logicalTime)}`, delta };
  }
  if (typeof delta.idempotencyKey !== "string" || delta.idempotencyKey.trim().length === 0) {
    return { reasonCode: "MALFORMED_IDEMPOTENCY_KEY_EMPTY", detail: "idempotencyKey is empty", delta };
  }
  return null;
}

// ---------------------------------------------------------------------------
// applyDeltaBatch — the atomic incremental application.
// ---------------------------------------------------------------------------

export function applyDeltaBatch(store: ProjectionStore, batch: ExternalProjectionBatch): DeltaApplyResult {
  const storeTenant = validateTenantScope(store.tenant);
  if (!storeTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "store tenant invalid" };
  const batchTenant = validateTenantScope(batch.tenant);
  if (!batchTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", detail: "batch tenant invalid" };
  if (batchTenant.scope.tenantId !== storeTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH", detail: "batch tenant differs from store tenant" };
  }
  if (typeof batch.source !== "string" || batch.source.trim().length === 0) {
    return { ok: false, reasonCode: "SOURCE_EMPTY", detail: "batch source is empty" };
  }
  if (batch.source !== store.source) {
    return { ok: false, reasonCode: "SOURCE_MISMATCH", detail: `batch source "${batch.source}" ≠ store source "${store.source}"` };
  }
  if (batch.kind !== "external-projection-batch") {
    return { ok: false, reasonCode: "BATCH_KIND_INVALID", detail: `kind is "${String(batch.kind)}"` };
  }
  if (batch.deltas.length === 0) {
    return { ok: false, reasonCode: "EMPTY_BATCH", detail: "batch carries no deltas" };
  }

  // Within-batch idempotency dedup: same key + same target = duplicate skip;
  // same key + different target = an honest batch-level conflict (atomic).
  const seenKeys = new Map<string, string>();
  for (const delta of batch.deltas) {
    const key = delta.idempotencyKey;
    if (typeof key !== "string" || key.trim().length === 0) continue; // malformed → quarantined below
    const target = `${delta.op}\u241f${delta.externalId}\u241f${String(delta.logicalTime)}\u241f${
      delta.payload === null ? "\u2205" : canonicalJson(delta.payload)
    }`;
    const prior = seenKeys.get(key);
    if (prior !== undefined && prior !== target) {
      return {
        ok: false,
        reasonCode: "DUPLICATE_IDEMPOTENCY_KEY_IN_BATCH",
        detail: `key "${key}" carries two different payloads in one batch`,
      };
    }
    seenKeys.set(key, target);
  }

  const projections = new Map(store.projections);
  const quarantined: QuarantinedDelta[] = [];
  const applied: string[] = [];
  const skippedStale: string[] = [];
  const skippedDuplicate: string[] = [];

  for (const delta of batch.deltas) {
    const malformed = structurallyMalformed(delta);
    if (malformed !== null) {
      quarantined.push(malformed);
      continue;
    }
    const current = projections.get(delta.externalId);
    if (current === undefined) {
      if (delta.op === "delete") {
        quarantined.push({
          reasonCode: "DELETE_TARGET_UNKNOWN",
          detail: `delete for unknown externalId "${delta.externalId}"`,
          delta,
        });
        continue;
      }
      projections.set(delta.externalId, {
        externalId: delta.externalId,
        source: batch.source,
        payload: delta.payload,
        logicalTime: delta.logicalTime,
        idempotencyKey: delta.idempotencyKey,
        deletedAt: null,
        projectionDigest: computeProjectionDigest(batch.source, delta.externalId, delta.logicalTime, "upsert", delta.payload),
      });
      applied.push(delta.externalId);
      continue;
    }
    if (delta.logicalTime > current.logicalTime) {
      applyWinner(projections, batch.source, delta);
      applied.push(delta.externalId);
      continue;
    }
    if (delta.logicalTime < current.logicalTime) {
      skippedStale.push(delta.externalId);
      continue;
    }
    const incomingDigest = computeProjectionDigest(batch.source, delta.externalId, delta.logicalTime, delta.op, delta.payload);
    const sameOpAndPayload =
      delta.op === (current.deletedAt === null ? "upsert" : "delete") && incomingDigest === current.projectionDigest;
    if (sameOpAndPayload) {
      skippedDuplicate.push(delta.externalId);
      continue;
    }
    quarantined.push({
      reasonCode: "CONFLICT_SAME_TUPLE_DIFFERENT_PAYLOAD",
      detail: `equal (source, logical-time, id) tuple with different content for "${delta.externalId}"`,
      delta,
    });
  }

  const newStore: ProjectionStore = {
    tenant: store.tenant,
    source: store.source,
    projections,
    quarantined: [...store.quarantined, ...quarantined],
    storeDigest: computeStoreDigest({ projections }),
  };
  return {
    ok: true,
    store: newStore,
    outcome: { applied, skippedStale, skippedDuplicate, quarantined },
    batchDigest: computeBatchDigest(batch),
  };
}

function applyWinner(
  projections: Map<string, AppliedProjection>,
  source: string,
  delta: ExternalProjectionDelta,
): void {
  projections.set(delta.externalId, {
    externalId: delta.externalId,
    source,
    payload: delta.op === "upsert" ? delta.payload : null,
    logicalTime: delta.logicalTime,
    idempotencyKey: delta.idempotencyKey,
    deletedAt: delta.op === "delete" ? delta.logicalTime : null,
    projectionDigest: computeProjectionDigest(source, delta.externalId, delta.logicalTime, delta.op, delta.payload),
  });
}
