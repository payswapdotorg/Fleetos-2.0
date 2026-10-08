/**
 * @fleetos/aurum — Wave 5 delta-apply tests (operational-truth grade).
 *
 * Themes: LWW conflict-resolution determinism; quarantine reason codes
 * (never silently dropped); atomic batch semantics (no partial application
 * on malformed envelopes); projection/store digests; tenant fail-closed.
 */
import { describe, expect, it } from "vitest";
import {
  applyDeltaBatch,
  computeBatchDigest,
  computeStoreDigest,
  listLiveProjections,
  openProjectionStore,
  verifyStoreDigest,
  type ExternalProjectionBatch,
  type ExternalProjectionDelta,
  type ProjectionStore,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const SOURCE = "aurum-prod";

function upsert(externalId: string, payload: Record<string, unknown>, logicalTime: number, key: string): ExternalProjectionDelta {
  return { op: "upsert", externalId, payload, logicalTime, idempotencyKey: key };
}

function batch(deltas: readonly ExternalProjectionDelta[], tenant: TenantScope = TENANT, source = SOURCE): ExternalProjectionBatch {
  return { kind: "external-projection-batch", tenant, source, deltas };
}

function open(): ProjectionStore {
  const opened = openProjectionStore(TENANT, SOURCE);
  if (!opened.ok) throw new Error("openProjectionStore failed");
  return opened.store;
}

describe("delta-apply — LWW conflict resolution (documented rule)", () => {
  it("a newer logical time WINS over the stored projection", () => {
    const store = open();
    const first = applyDeltaBatch(store, batch([upsert("a-1", { v: 1 }, 10, "k-1")]));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyDeltaBatch(first.store, batch([upsert("a-1", { v: 2 }, 20, "k-2")]));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const live = listLiveProjections(second.store);
    expect(live[0]?.payload).toEqual({ v: 2 });
    expect(live[0]?.logicalTime).toBe(20);
    expect(second.outcome.applied).toEqual(["a-1"]);
    expect(second.outcome.skippedStale).toEqual([]);
  });

  it("an OLDER logical time is SKIPPED as stale — recorded, never applied", () => {
    const store = open();
    const first = applyDeltaBatch(store, batch([upsert("a-1", { v: 2 }, 20, "k-1")]));
    if (!first.ok) return;
    const second = applyDeltaBatch(first.store, batch([upsert("a-1", { v: 1 }, 10, "k-2")]));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.outcome.applied).toEqual([]);
    expect(second.outcome.skippedStale).toEqual(["a-1"]);
    expect(listLiveProjections(second.store)[0]?.payload).toEqual({ v: 2 });
  });

  it("equal tuple + identical payload is an idempotent duplicate (skipped, not applied)", () => {
    const store = open();
    const first = applyDeltaBatch(store, batch([upsert("a-1", { v: 1 }, 10, "k-1")]));
    if (!first.ok) return;
    const second = applyDeltaBatch(first.store, batch([upsert("a-1", { v: 1 }, 10, "k-2")]));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.outcome.skippedDuplicate).toEqual(["a-1"]);
    expect(second.outcome.applied).toEqual([]);
  });

  it("equal tuple + DIFFERENT payload is QUARANTINED with CONFLICT_SAME_TUPLE_DIFFERENT_PAYLOAD", () => {
    const store = open();
    const first = applyDeltaBatch(store, batch([upsert("a-1", { v: 1 }, 10, "k-1")]));
    if (!first.ok) return;
    const second = applyDeltaBatch(first.store, batch([upsert("a-1", { v: 999 }, 10, "k-2")]));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.outcome.quarantined).toHaveLength(1);
    expect(second.outcome.quarantined[0]?.reasonCode).toBe("CONFLICT_SAME_TUPLE_DIFFERENT_PAYLOAD");
    // The stored projection is untouched by the conflicting delta.
    expect(listLiveProjections(second.store)[0]?.payload).toEqual({ v: 1 });
  });

  it("deletes win at a newer logical time and leave a tombstone (not resurrected by stale upserts)", () => {
    const store = open();
    const seeded = applyDeltaBatch(store, batch([upsert("a-1", { v: 1 }, 10, "k-1")]));
    if (!seeded.ok) return;
    const deleted = applyDeltaBatch(seeded.store, batch([{ op: "delete", externalId: "a-1", payload: null, logicalTime: 30, idempotencyKey: "k-2" }]));
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(listLiveProjections(deleted.store)).toHaveLength(0);
    const resurrect = applyDeltaBatch(deleted.store, batch([upsert("a-1", { v: 2 }, 20, "k-3")]));
    expect(resurrect.ok).toBe(true);
    if (!resurrect.ok) return;
    expect(resurrect.outcome.skippedStale).toEqual(["a-1"]);
    expect(listLiveProjections(resurrect.store)).toHaveLength(0);
  });
});

describe("delta-apply — quarantine honesty (never silently dropped)", () => {
  it("quarantines an upsert without payload with MALFORMED_UPSERT_WITHOUT_PAYLOAD and keeps the original delta", () => {
    const store = open();
    const malformed: ExternalProjectionDelta = { op: "upsert", externalId: "a-1", payload: null, logicalTime: 10, idempotencyKey: "k-1" };
    const result = applyDeltaBatch(store, batch([malformed]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.quarantined[0]?.reasonCode).toBe("MALFORMED_UPSERT_WITHOUT_PAYLOAD");
    expect(result.outcome.quarantined[0]?.delta).toEqual(malformed);
    expect(result.store.projections.size).toBe(0);
  });

  it("quarantines a delete for an unknown external id with DELETE_TARGET_UNKNOWN", () => {
    const result = applyDeltaBatch(open(), batch([{ op: "delete", externalId: "ghost", payload: null, logicalTime: 10, idempotencyKey: "k-1" }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.quarantined[0]?.reasonCode).toBe("DELETE_TARGET_UNKNOWN");
  });

  it("quarantines a malformed logical time with MALFORMED_LOGICAL_TIME and applies the healthy deltas of the same batch", () => {
    const result = applyDeltaBatch(open(), batch([
      upsert("good", { v: 1 }, 5, "k-good"),
      { op: "upsert", externalId: "bad", payload: { v: 1 }, logicalTime: -3, idempotencyKey: "k-bad" },
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.applied).toEqual(["good"]);
    expect(result.outcome.quarantined.map((q) => q.reasonCode)).toEqual(["MALFORMED_LOGICAL_TIME"]);
  });

  it("quarantine accumulates across batches and is part of the committed store", () => {
    const first = applyDeltaBatch(open(), batch([{ op: "delete", externalId: "ghost-1", payload: null, logicalTime: 1, idempotencyKey: "k-1" }]));
    if (!first.ok) return;
    const second = applyDeltaBatch(first.store, batch([{ op: "delete", externalId: "ghost-2", payload: null, logicalTime: 2, idempotencyKey: "k-2" }]));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.store.quarantined).toHaveLength(2);
  });
});

describe("delta-apply — atomic batch semantics", () => {
  it("refuses a batch whose duplicate idempotency key carries two payloads — NOTHING is applied", () => {
    const result = applyDeltaBatch(open(), batch([
      upsert("a-1", { v: 1 }, 10, "same-key"),
      upsert("a-2", { v: 2 }, 10, "same-key"),
    ]));
    expect(result).toMatchObject({ ok: false, reasonCode: "DUPLICATE_IDEMPOTENCY_KEY_IN_BATCH" });
  });

  it("refuses an empty batch with EMPTY_BATCH (nothing changes)", () => {
    expect(applyDeltaBatch(open(), batch([]))).toMatchObject({ ok: false, reasonCode: "EMPTY_BATCH" });
  });

  it("refuses a malformed batch kind with BATCH_KIND_INVALID", () => {
    const bad = { ...batch([upsert("a", { v: 1 }, 1, "k")]), kind: "not-a-batch" } as unknown as ExternalProjectionBatch;
    expect(applyDeltaBatch(open(), bad)).toMatchObject({ ok: false, reasonCode: "BATCH_KIND_INVALID" });
  });

  it("never mutates the input store on refusal", () => {
    const store = open();
    const before = computeStoreDigest(store);
    applyDeltaBatch(store, batch([]));
    expect(computeStoreDigest(store)).toBe(before);
  });
});

describe("delta-apply — digests and determinism", () => {
  it("batch digest is input-order independent (canonical ordering)", () => {
    const a = batch([upsert("a-1", { v: 1 }, 10, "k-1"), upsert("a-2", { v: 2 }, 20, "k-2")]);
    const b = batch([upsert("a-2", { v: 2 }, 20, "k-2"), upsert("a-1", { v: 1 }, 10, "k-1")]);
    expect(computeBatchDigest(a)).toBe(computeBatchDigest(b));
  });

  it("batch digest is payload key-order independent", () => {
    const a = batch([upsert("a-1", { x: 1, y: 2 }, 10, "k-1")]);
    const b = batch([upsert("a-1", { y: 2, x: 1 }, 10, "k-1")]);
    expect(computeBatchDigest(a)).toBe(computeBatchDigest(b));
  });

  it("store digest verification detects tampering with an applied projection", () => {
    const result = applyDeltaBatch(open(), batch([upsert("a-1", { v: 1 }, 10, "k-1")]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(verifyStoreDigest(result.store).ok).toBe(true);
    const projections = new Map(result.store.projections);
    const original = projections.get("a-1");
    if (original === undefined) throw new Error("missing projection");
    projections.set("a-1", { ...original, payload: { v: 999 } });
    const tampered: ProjectionStore = { ...result.store, projections };
    expect(verifyStoreDigest(tampered).ok).toBe(false);
  });
});

describe("delta-apply — tenant fail-closed", () => {
  it("refuses an invalid tenant scope with TENANT_SCOPE_MISSING", () => {
    expect(openProjectionStore({ tenantId: "" } as unknown as TenantScope, SOURCE)).toMatchObject({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
    const result = applyDeltaBatch(open(), batch([upsert("a", { v: 1 }, 1, "k")], { tenantId: "" } as unknown as TenantScope));
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });

  it("refuses a cross-tenant batch with TENANT_MISMATCH and applies nothing", () => {
    const result = applyDeltaBatch(open(), batch([upsert("a", { v: 1 }, 1, "k")], { tenantId: "other" }));
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("refuses a cross-source batch with SOURCE_MISMATCH", () => {
    const result = applyDeltaBatch(open(), batch([upsert("a", { v: 1 }, 1, "k")], TENANT, "other-source"));
    expect(result).toMatchObject({ ok: false, reasonCode: "SOURCE_MISMATCH" });
  });
});
