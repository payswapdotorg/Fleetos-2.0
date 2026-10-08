/**
 * @fleetos/aurum — Wave 5 sync-reconciliation tests (operational-truth grade).
 *
 * Themes: the four reconciliation classes; repair plans as PURE PROPOSALS
 * (adapters never execute); deterministic ordering + digests; tenant and
 * snapshot input fail-closed.
 */
import { describe, expect, it } from "vitest";
import {
  applyDeltaBatch,
  computeReconciliationDigest,
  listLiveProjections,
  openProjectionStore,
  reconcileProjectionSet,
  type ExternalProjectionDelta,
  type ExternalProjectionSnapshot,
  type ProjectionStore,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const SOURCE = "aurum-prod";

function seededStore(deltas: readonly ExternalProjectionDelta[]): ProjectionStore {
  const opened = openProjectionStore(TENANT, SOURCE);
  if (!opened.ok) throw new Error("open failed");
  if (deltas.length === 0) return opened.store;
  const applied = applyDeltaBatch(opened.store, {
    kind: "external-projection-batch",
    tenant: TENANT,
    source: SOURCE,
    deltas,
  });
  if (!applied.ok) throw new Error("seed apply failed");
  return applied.store;
}

function snap(externalId: string, payload: Record<string, unknown>, logicalTime: number): ExternalProjectionSnapshot {
  return { externalId, payload, logicalTime };
}

describe("sync-reconciliation — classification", () => {
  it("classifies in-sync when the external snapshot matches the local replica exactly", () => {
    const store = seededStore([{ op: "upsert", externalId: "a-1", payload: { v: 1 }, logicalTime: 10, idempotencyKey: "k-1" }]);
    const result = reconcileProjectionSet(store, [snap("a-1", { v: 1 }, 10)], SOURCE, 500);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.classification).toBe("in-sync");
    expect(result.report.matchedIds).toEqual(["a-1"]);
    expect(result.report.repairPlan).toEqual([]);
  });

  it("classifies external-ahead when external has projections the replica lacks", () => {
    const store = seededStore([{ op: "upsert", externalId: "a-1", payload: { v: 1 }, logicalTime: 10, idempotencyKey: "k-1" }]);
    const result = reconcileProjectionSet(store, [snap("a-1", { v: 1 }, 10), snap("a-2", { v: 2 }, 20)], SOURCE, 500);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.classification).toBe("external-ahead");
    expect(result.report.externalOnly).toEqual(["a-2"]);
  });

  it("classifies local-ahead when the replica has live projections external lacks", () => {
    const store = seededStore([
      { op: "upsert", externalId: "a-1", payload: { v: 1 }, logicalTime: 10, idempotencyKey: "k-1" },
      { op: "upsert", externalId: "a-2", payload: { v: 2 }, logicalTime: 12, idempotencyKey: "k-2" },
    ]);
    const result = reconcileProjectionSet(store, [snap("a-1", { v: 1 }, 10)], SOURCE, 500);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.classification).toBe("local-ahead");
    expect(result.report.localOnly).toEqual(["a-2"]);
  });

  it("classifies diverged on same-id content divergence (with both digests reported)", () => {
    const store = seededStore([{ op: "upsert", externalId: "a-1", payload: { v: 1 }, logicalTime: 10, idempotencyKey: "k-1" }]);
    const result = reconcileProjectionSet(store, [snap("a-1", { v: 999 }, 10)], SOURCE, 500);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.classification).toBe("diverged");
    expect(result.report.divergent).toHaveLength(1);
    expect(result.report.divergent[0]?.externalDigest).not.toBe(result.report.divergent[0]?.localDigest);
  });

  it("classifies diverged when drift appears on BOTH sides at once", () => {
    const store = seededStore([{ op: "upsert", externalId: "local-only", payload: { v: 1 }, logicalTime: 10, idempotencyKey: "k-1" }]);
    const result = reconcileProjectionSet(store, [snap("external-only", { v: 2 }, 5)], SOURCE, 500);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.classification).toBe("diverged");
    expect(result.report.externalOnly).toEqual(["external-only"]);
    expect(result.report.localOnly).toEqual(["local-only"]);
  });

  it("ignores tombstones: a locally deleted projection is local-ahead only if external still lists it", () => {
    const store = seededStore([
      { op: "upsert", externalId: "a-1", payload: { v: 1 }, logicalTime: 10, idempotencyKey: "k-1" },
      { op: "delete", externalId: "a-1", payload: null, logicalTime: 20, idempotencyKey: "k-2" },
    ]);
    expect(listLiveProjections(store)).toHaveLength(0);
    const result = reconcileProjectionSet(store, [], SOURCE, 500);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.classification).toBe("in-sync");
    expect(result.report.localOnly).toEqual([]);
  });
});

describe("sync-reconciliation — repair plans are PURE PROPOSALS", () => {
  it("emits fetch-external/purge-local/manual-review proposals tagged adapter-never-executes", () => {
    const store = seededStore([{ op: "upsert", externalId: "stale-local", payload: { v: 1 }, logicalTime: 10, idempotencyKey: "k-1" }]);
    const result = reconcileProjectionSet(store, [snap("fresh-external", { v: 2 }, 5), snap("stale-local", { v: 999 }, 10)], SOURCE, 500);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const plan = result.report.repairPlan;
    expect(plan.map((p) => p.action)).toEqual(["fetch-external", "manual-review"]);
    for (const proposal of plan) {
      expect(proposal.kind).toBe("repair-proposal");
      expect(proposal.note).toBe("adapter-never-executes");
    }
  });

  it("proposals carry no executable members (inert data only)", () => {
    const store = seededStore([]);
    const result = reconcileProjectionSet(store, [snap("x", { v: 1 }, 1)], SOURCE, 500);
    if (!result.ok) return;
    for (const proposal of result.report.repairPlan) {
      for (const value of Object.values(proposal)) {
        expect(typeof value).not.toBe("function");
      }
    }
  });
});

describe("sync-reconciliation — determinism + digests", () => {
  it("is input-order independent: identical inputs in any snapshot order produce byte-identical reports", () => {
    const store = seededStore([{ op: "upsert", externalId: "a-1", payload: { v: 1 }, logicalTime: 10, idempotencyKey: "k-1" }]);
    const snapshots = [snap("a-1", { v: 1 }, 10), snap("b-2", { v: 2 }, 20), snap("c-3", { v: 3 }, 30)];
    const a = reconcileProjectionSet(store, snapshots, SOURCE, 500);
    const b = reconcileProjectionSet(store, [...snapshots].reverse(), SOURCE, 500);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.report.digest).toBe(b.report.digest);
    expect(a.report.repairPlan).toEqual(b.report.repairPlan);
  });

  it("report digest recomputes and reflects content", () => {
    const store = seededStore([{ op: "upsert", externalId: "a-1", payload: { v: 1 }, logicalTime: 10, idempotencyKey: "k-1" }]);
    const a = reconcileProjectionSet(store, [snap("a-1", { v: 1 }, 10)], SOURCE, 500);
    const b = reconcileProjectionSet(store, [snap("a-1", { v: 1 }, 10)], SOURCE, 501);
    if (!a.ok || !b.ok) return;
    expect(computeReconciliationDigest(a.report)).toBe(a.report.digest);
    expect(a.report.digest).not.toBe(b.report.digest);
  });
});

describe("sync-reconciliation — fail-closed inputs", () => {
  it("refuses a source mismatch (SOURCE_MISMATCH)", () => {
    const store = seededStore([]);
    expect(reconcileProjectionSet(store, [], "other-source", 500)).toMatchObject({ ok: false, reasonCode: "SOURCE_MISMATCH" });
  });

  it("refuses malformed snapshots with SNAPSHOT_MALFORMED (nothing computed)", () => {
    const store = seededStore([]);
    const malformed = [{ externalId: "", payload: {}, logicalTime: 1 }] as readonly ExternalProjectionSnapshot[];
    expect(reconcileProjectionSet(store, malformed, SOURCE, 500)).toMatchObject({ ok: false, reasonCode: "SNAPSHOT_MALFORMED" });
    const badTime = [{ externalId: "a", payload: {}, logicalTime: -1 }] as readonly ExternalProjectionSnapshot[];
    expect(reconcileProjectionSet(store, badTime, SOURCE, 500)).toMatchObject({ ok: false, reasonCode: "SNAPSHOT_MALFORMED" });
  });

  it("refuses duplicate snapshot ids with SNAPSHOT_MALFORMED", () => {
    const store = seededStore([]);
    const dupes = [snap("a", {}, 1), snap("a", {}, 1)];
    expect(reconcileProjectionSet(store, dupes, SOURCE, 500)).toMatchObject({ ok: false, reasonCode: "SNAPSHOT_MALFORMED" });
  });

  it("refuses an invalid logical now with LOGICAL_TIME_INVALID", () => {
    const store = seededStore([]);
    expect(reconcileProjectionSet(store, [], SOURCE, -5)).toMatchObject({ ok: false, reasonCode: "LOGICAL_TIME_INVALID" });
  });
});
