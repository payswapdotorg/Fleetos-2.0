/**
 * @fleetos/aurum — Wave 5 sync-session tests (operational-truth grade).
 *
 * Themes: session lifecycle (opened→fetching→applying→committed, failed,
 * aborted); logical-time cursors; idempotent batch re-apply; sync digest
 * chaining + tamper detection; tenant fail-closed.
 */
import { describe, expect, it } from "vitest";
import {
  abortSyncSession,
  applyFetchedBatch,
  beginFetching,
  commitSyncSession,
  failSyncSession,
  openSyncSession,
  verifySyncDigest,
  type ExternalProjectionBatch,
  type ExternalProjectionDelta,
  type SyncSession,
  type TenantScope,
} from "../src/index.js";
import { openProjectionStore, type ProjectionStore } from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };
const SOURCE = "aurum-prod";

function delta(externalId: string, payload: Record<string, unknown>, logicalTime: number, key: string): ExternalProjectionDelta {
  return { op: "upsert", externalId, payload, logicalTime, idempotencyKey: key };
}

function batchOf(deltas: readonly ExternalProjectionDelta[]): ExternalProjectionBatch {
  return { kind: "external-projection-batch", tenant: TENANT, source: SOURCE, deltas };
}

function sessionAndStore(): { session: SyncSession; store: ProjectionStore } {
  const opened = openSyncSession({ tenant: TENANT, source: SOURCE, sessionId: "s-1", startCursor: { source: SOURCE, logicalTime: 0, sequence: 0 }, now: 100 });
  if (!opened.ok) throw new Error("openSyncSession failed");
  const fetching = beginFetching(opened.session, 101);
  if (!fetching.ok) throw new Error("beginFetching failed");
  const store = openProjectionStore(TENANT, SOURCE);
  if (!store.ok) throw new Error("openProjectionStore failed");
  return { session: fetching.session, store: store.store };
}

describe("sync-session — lifecycle", () => {
  it("walks opened → fetching → applying → committed and advances the logical-time cursor", () => {
    const { session, store } = sessionAndStore();
    const applied = applyFetchedBatch(session, store, batchOf([delta("a-1", { v: 1 }, 10, "k-1")]), 102);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.session.status).toBe("applying");
    expect(applied.session.cursor.logicalTime).toBe(10);
    expect(applied.session.cursor.sequence).toBe(1);
    expect(applied.outcome.applied).toEqual(["a-1"]);
    const committed = commitSyncSession(applied.session, 103);
    expect(committed).toMatchObject({ ok: true, session: { status: "committed" } });
  });

  it("refuses commit straight from opened with ILLEGAL_TRANSITION", () => {
    const opened = openSyncSession({ tenant: TENANT, source: SOURCE, sessionId: "s-1", startCursor: { source: SOURCE, logicalTime: 0, sequence: 0 }, now: 100 });
    if (!opened.ok) return;
    const committed = commitSyncSession(opened.session, 101);
    expect(committed).toMatchObject({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses applying a batch before fetching began (ILLEGAL_TRANSITION from opened)", () => {
    const opened = openSyncSession({ tenant: TENANT, source: SOURCE, sessionId: "s-1", startCursor: { source: SOURCE, logicalTime: 0, sequence: 0 }, now: 100 });
    const store = openProjectionStore(TENANT, SOURCE);
    if (!opened.ok || !store.ok) return;
    const result = applyFetchedBatch(opened.session, store.store, batchOf([delta("a", { v: 1 }, 1, "k")]), 101);
    expect(result).toMatchObject({ ok: false, reasonCode: "ILLEGAL_TRANSITION" });
  });

  it("refuses every command on terminal sessions with TERMINAL_STATE", () => {
    const { session, store } = sessionAndStore();
    const applied = applyFetchedBatch(session, store, batchOf([delta("a-1", { v: 1 }, 10, "k-1")]), 102);
    if (!applied.ok) return;
    const committed = commitSyncSession(applied.session, 103);
    if (!committed.ok) return;
    expect(beginFetching(committed.session, 104)).toMatchObject({ ok: false, reasonCode: "TERMINAL_STATE" });
    expect(commitSyncSession(committed.session, 105)).toMatchObject({ ok: false, reasonCode: "TERMINAL_STATE" });
    expect(failSyncSession(committed.session, "X", 106)).toMatchObject({ ok: false, reasonCode: "TERMINAL_STATE" });
    expect(abortSyncSession(committed.session, "reason", 107)).toMatchObject({ ok: false, reasonCode: "TERMINAL_STATE" });
  });

  it("failed and aborted are reachable from non-terminal states and record their reasons", () => {
    const { session } = sessionAndStore();
    const failed = failSyncSession(session, "AURUM_UNAVAILABLE", 102);
    expect(failed).toMatchObject({ ok: true, session: { status: "failed", failure: { reasonCode: "AURUM_UNAVAILABLE" } } });
    const { session: s2 } = sessionAndStore();
    const aborted = abortSyncSession(s2, "operator-request", 102);
    expect(aborted).toMatchObject({ ok: true, session: { status: "aborted", abortReason: "operator-request" } });
  });

  it("refuses failure/abort without a reason (typed codes)", () => {
    const { session } = sessionAndStore();
    expect(failSyncSession(session, "  ", 102)).toMatchObject({ ok: false, reasonCode: "FAILURE_REASON_REQUIRED" });
    expect(abortSyncSession(session, "", 102)).toMatchObject({ ok: false, reasonCode: "ABORT_REASON_REQUIRED" });
  });

  it("refuses opening with a cursor from a different source (CURSOR_SOURCE_MISMATCH)", () => {
    const result = openSyncSession({ tenant: TENANT, source: SOURCE, sessionId: "s-1", startCursor: { source: "other", logicalTime: 0, sequence: 0 }, now: 100 });
    expect(result).toMatchObject({ ok: false, reasonCode: "CURSOR_SOURCE_MISMATCH" });
  });
});

describe("sync-session — idempotency + cursors", () => {
  it("re-applying the SAME batch is an idempotent no-op: store and sync digest byte-identical", () => {
    const { session, store } = sessionAndStore();
    const b = batchOf([delta("a-1", { v: 1 }, 10, "k-1"), delta("a-2", { v: 2 }, 12, "k-2")]);
    const first = applyFetchedBatch(session, store, b, 102);
    if (!first.ok) throw new Error("first apply failed");
    const second = applyFetchedBatch(first.session, first.store, b, 102);
    if (!second.ok) throw new Error("second apply failed");
    expect(second.session.syncDigest).toBe(first.session.syncDigest);
    expect(second.session.batchDigests).toEqual(first.session.batchDigests);
    expect(second.session.batchesApplied).toBe(first.session.batchesApplied);
    expect(second.session.duplicatesSkipped).toBe(2);
    expect(second.store.storeDigest).toBe(first.store.storeDigest);
    expect(verifySyncDigest(second.session).ok).toBe(true);
  });

  it("refuses a batch wholly behind the cursor with CURSOR_REGRESSION (nothing applied)", () => {
    const { session, store } = sessionAndStore();
    const first = applyFetchedBatch(session, store, batchOf([delta("a-1", { v: 1 }, 20, "k-1")]), 102);
    if (!first.ok) throw new Error("first apply failed");
    const regression = applyFetchedBatch(first.session, first.store, batchOf([delta("a-2", { v: 2 }, 5, "k-9")]), 103);
    expect(regression).toMatchObject({ ok: false, reasonCode: "CURSOR_REGRESSION" });
    // Nothing was applied by the refused batch: the committed session state
    // is untouched (atomicity — batchesApplied stays at 1).
    expect(first.session.batchesApplied).toBe(1);
  });

  it("chains batch digests into the sync digest and detects tampering", () => {
    const { session, store } = sessionAndStore();
    const first = applyFetchedBatch(session, store, batchOf([delta("a-1", { v: 1 }, 10, "k-1")]), 102);
    if (!first.ok) throw new Error("apply failed");
    const second = applyFetchedBatch(first.session, first.store, batchOf([delta("a-2", { v: 2 }, 20, "k-2")]), 103);
    if (!second.ok) throw new Error("apply failed");
    expect(second.session.batchDigests).toHaveLength(2);
    expect(second.session.syncDigest).not.toBe(first.session.syncDigest);
    expect(verifySyncDigest(second.session).ok).toBe(true);
    const tampered: SyncSession = { ...second.session, batchDigests: ["batch_deadbeef", ...second.session.batchDigests.slice(1)] };
    expect(verifySyncDigest(tampered)).toMatchObject({ ok: false, reasonCode: "SYNC_DIGEST_CHAIN_BROKEN" });
  });

  it("quarantined deltas are counted on the session but do not advance the cursor over malformed times", () => {
    const { session, store } = sessionAndStore();
    const result = applyFetchedBatch(session, store, batchOf([
      { op: "delete", externalId: "ghost", payload: null, logicalTime: 30, idempotencyKey: "k-d" },
      { op: "upsert", externalId: "bad", payload: { v: 1 }, logicalTime: -7, idempotencyKey: "k-b" },
    ]), 102);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.quarantinedCount).toBe(2);
    expect(result.session.cursor.logicalTime).toBe(30);
  });
});

describe("sync-session — tenant fail-closed", () => {
  it("refuses an invalid tenant at open (TENANT_SCOPE_MISSING)", () => {
    const result = openSyncSession({ tenant: { tenantId: "" } as unknown as TenantScope, source: SOURCE, sessionId: "s", startCursor: { source: SOURCE, logicalTime: 0, sequence: 0 }, now: 1 });
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_SCOPE_MISSING" });
  });

  it("refuses a cross-tenant batch with TENANT_MISMATCH and applies nothing", () => {
    const { session, store } = sessionAndStore();
    const cross: ExternalProjectionBatch = { kind: "external-projection-batch", tenant: { tenantId: "other" }, source: SOURCE, deltas: [delta("a", { v: 1 }, 1, "k")] };
    const result = applyFetchedBatch(session, store, cross, 102);
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("refuses a cross-tenant STORE with TENANT_MISMATCH", () => {
    const { session } = sessionAndStore();
    const otherStore = openProjectionStore({ tenantId: "other" }, SOURCE);
    if (!otherStore.ok) return;
    const result = applyFetchedBatch(session, otherStore.store, batchOf([delta("a", { v: 1 }, 1, "k")]), 102);
    expect(result).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("refuses a source mismatch between session, store and batch (SOURCE_MISMATCH)", () => {
    const { session } = sessionAndStore();
    const otherStore = openProjectionStore(TENANT, "other-source");
    if (!otherStore.ok) return;
    const result = applyFetchedBatch(session, otherStore.store, batchOf([delta("a", { v: 1 }, 1, "k")]), 102);
    expect(result).toMatchObject({ ok: false, reasonCode: "SOURCE_MISMATCH" });
  });
});
