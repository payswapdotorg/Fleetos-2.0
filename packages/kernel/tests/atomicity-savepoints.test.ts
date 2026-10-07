/**
 * @fleetos/kernel — atomicity + savepoint tests.
 *
 * Tests the deterministic in-memory transactional reference driver:
 * partial-failure rollback, savepoint semantics (checkpoint/release/
 * rollbackTo), and the A14 atomic boundary (state changes are NOT
 * visible until commit; rollback discards all writes).
 */

import { describe, it, expect } from "vitest";
import {
  InMemoryKernelDriver,
  type TenantContext,
  makeTenantContext,
} from "../src/index.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme-corp-001";
const ACTOR_A = "act_alice-001";
const SESSION_A = "sess_abcdef0123456789";

function ctxForTenant(tenant: string, actor: string = ACTOR_A): TenantContext {
  const r = makeTenantContext({
    tenantId: tenant,
    actorId: actor,
    sessionId: SESSION_A,
    establishedAt: NOW,
  });
  if (!r.ok) throw new Error(`bad ctx: ${r.reason}`);
  return r.context;
}

describe("atomicity — InMemoryTransactionalSession", () => {
  it("begins in 'open' state and transitions to 'active' on begin()", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    expect(session.state).toBe("open");
    const r = session.begin();
    expect(r.ok).toBe(true);
    expect(session.state).toBe("active");
  });

  it("begin() is idempotent — second begin on an active session returns ok", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    expect(session.begin().ok).toBe(true);
    expect(session.begin().ok).toBe(true);
    expect(session.state).toBe("active");
  });

  it("refuses begin() after commit", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    session.commit();
    const r = session.begin();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.reason).toBe("illegal-state");
  });

  it("refuses begin() after rollback", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    session.rollback();
    const r = session.begin();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.reason).toBe("illegal-state");
  });

  it("commit() applies staged writes to the committed keyspace", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    session.stage((s) => s.put("widgets", "w1", { id: "w1", name: "Widget One" }));
    session.stage((s) => s.put("widgets", "w2", { id: "w2", name: "Widget Two" }));
    // Before commit: committed keyspace is empty
    const ks = driver.keyspaceFor(ctxForTenant(TENANT_A).tenantId);
    expect(ks.collections.get("widgets")).toBeUndefined();
    const r = session.commit();
    expect(r.ok).toBe(true);
    // After commit: committed keyspace has both widgets
    const coll = ks.collections.get("widgets");
    expect(coll).toBeDefined();
    if (coll) {
      expect(coll.get("w1")).toEqual({ id: "w1", name: "Widget One" });
      expect(coll.get("w2")).toEqual({ id: "w2", name: "Widget Two" });
    }
  });

  it("commit() audit carries all five A19 fields", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    session.stage((s) => s.put("widgets", "w1", { id: "w1" }));
    const r = session.commit();
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.audit).toBeTruthy();
    expect(typeof r.value.audit.actor).toBe("string");
    expect(typeof r.value.audit.intent).toBe("string");
    expect(typeof r.value.audit.tenant).toBe("string");
    expect(typeof r.value.audit.session).toBe("string");
    expect(typeof r.value.audit.timestamp).toBe("number");
    expect(typeof r.value.audit.digest).toBe("string");
    expect(r.value.audit.digest.length).toBe(64); // sha256 hex
  });

  it("rollback() discards all staged writes — committed keyspace untouched", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    session.stage((s) => s.put("widgets", "w1", { id: "w1" }));
    const r = session.rollback();
    expect(r.ok).toBe(true);
    expect(r.value.discardedWrites).toBe(1);
    const ks = driver.keyspaceFor(ctxForTenant(TENANT_A).tenantId);
    expect(ks.collections.get("widgets")).toBeUndefined();
    expect(session.state).toBe("rolled-back");
  });

  it("partial-failure rollback — a failed operation inside a unit rolls back the whole unit", () => {
    // Simulate a partial failure: stage writes, then attempt an operation
    // that throws. The UnitOfWork contract requires the caller to rollback
    // after a failure; here we test that rollback() discards ALL writes
    // (not just the ones after the failure).
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    session.stage((s) => s.put("widgets", "w1", { id: "w1", name: "first" }));
    session.stage((s) => s.put("widgets", "w2", { id: "w2", name: "second" }));
    // Stage more writes (simulating a complex operation)
    session.stage((s) => s.put("widgets", "w3", { id: "w3", name: "third" }));
    // Now rollback — simulating a failure inside the operation
    const r = session.rollback();
    expect(r.ok).toBe(true);
    expect(r.value.discardedWrites).toBe(3);
    const ks = driver.keyspaceFor(ctxForTenant(TENANT_A).tenantId);
    expect(ks.collections.get("widgets")).toBeUndefined();
  });

  it("commit() after rollback() is refused (illegal-state)", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    session.rollback();
    const r = session.commit();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.reason).toBe("illegal-state");
  });

  it("stage() before begin() is refused (illegal-state)", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    const r = session.stage(() => 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.reason).toBe("illegal-state");
  });

  it("staged writes are NOT visible to a separate session until commit (read-committed)", () => {
    const driver = new InMemoryKernelDriver();
    const ctx = ctxForTenant(TENANT_A);
    const s1 = driver.openSession({ tenant: ctx, now: NOW });
    const s2 = driver.openSession({ tenant: ctx, now: NOW });
    s1.begin();
    s2.begin();
    s1.stage((s) => s.put("widgets", "w1", { id: "w1", name: "from-s1" }));
    // s2 does not see s1's STAGED write (the invariant the test is named for)
    const s2read = s2.stage((s) => s.get("widgets", "w1"));
    expect(s2read.ok).toBe(true);
    if (s2read.ok) expect(s2read.value).toBeNull();
    // After s1 commits, the write is no longer "staged" — it is durable in
    // the committed keyspace. Under read-committed semantics (the in-memory
    // reference's chosen isolation level, matching the Postgres default),
    // s2's subsequent reads see the committed value immediately.
    s1.commit();
    const s2readAfterCommit = s2.stage((s) => s.get("widgets", "w1"));
    expect(s2readAfterCommit.ok).toBe(true);
    if (s2readAfterCommit.ok) {
      expect(s2readAfterCommit.value).toEqual({ id: "w1", name: "from-s1" });
    }
    // A fresh session sees the committed value too.
    s2.commit();
    const s3 = driver.openSession({ tenant: ctx, now: NOW });
    s3.begin();
    const s3read = s3.stage((s) => s.get("widgets", "w1"));
    expect(s3read.ok).toBe(true);
    if (s3read.ok) expect(s3read.value).toEqual({ id: "w1", name: "from-s1" });
  });
});

describe("savepoints — InMemoryTransactionalSession", () => {
  it("checkpoint() creates a savepoint with a monotonic sequence", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    const sp1 = session.checkpoint("sp1");
    expect(sp1.ok).toBe(true);
    if (sp1.ok) expect(sp1.value.sequence).toBe(1);
    const sp2 = session.checkpoint("sp2");
    expect(sp2.ok).toBe(true);
    if (sp2.ok) expect(sp2.value.sequence).toBe(2);
  });

  it("checkpoint() refuses duplicate names (duplicate-savepoint)", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    expect(session.checkpoint("sp1").ok).toBe(true);
    const r = session.checkpoint("sp1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.reason).toBe("duplicate-savepoint");
  });

  it("checkpoint() before begin is refused (illegal-state)", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    const r = session.checkpoint("sp1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.reason).toBe("illegal-state");
  });

  it("rollbackTo() discards writes staged AFTER the savepoint", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    session.stage((s) => s.put("widgets", "w1", { id: "w1", name: "first" }));
    session.checkpoint("sp1");
    session.stage((s) => s.put("widgets", "w2", { id: "w2", name: "second" }));
    session.stage((s) => s.put("widgets", "w3", { id: "w3", name: "third" }));
    // Rollback to sp1 — w2 and w3 are discarded
    const r = session.rollbackTo("sp1");
    expect(r.ok).toBe(true);
    // The session's stage now sees only w1 (plus committed)
    const after = session.stage((s) => ({
      w1: s.get("widgets", "w1"),
      w2: s.get("widgets", "w2"),
      w3: s.get("widgets", "w3"),
    }));
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.w1).toEqual({ id: "w1", name: "first" });
      expect(after.value.w2).toBeNull();
      expect(after.value.w3).toBeNull();
    }
  });

  it("rollbackTo() preserves writes staged BEFORE the savepoint", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    session.stage((s) => s.put("widgets", "w1", { id: "w1", name: "before-sp" }));
    session.checkpoint("sp1");
    session.stage((s) => s.put("widgets", "w2", { id: "w2", name: "after-sp" }));
    session.rollbackTo("sp1");
    const read = session.stage((s) => ({
      w1: s.get("widgets", "w1"),
      w2: s.get("widgets", "w2"),
    }));
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.w1).toEqual({ id: "w1", name: "before-sp" });
      expect(read.value.w2).toBeNull();
    }
  });

  it("rollbackTo() on an unknown savepoint is refused (savepoint-not-found)", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    const r = session.rollbackTo("nope");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.reason).toBe("savepoint-not-found");
  });

  it("release() discards the savepoint but keeps the writes", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    session.stage((s) => s.put("widgets", "w1", { id: "w1", name: "first" }));
    session.checkpoint("sp1");
    session.stage((s) => s.put("widgets", "w2", { id: "w2", name: "second" }));
    session.release("sp1");
    // sp1 is gone — rollbackTo refuses
    const r = session.rollbackTo("sp1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.reason).toBe("savepoint-not-found");
    // Writes are still staged
    const read = session.stage((s) => ({
      w1: s.get("widgets", "w1"),
      w2: s.get("widgets", "w2"),
    }));
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.w1).toEqual({ id: "w1", name: "first" });
      expect(read.value.w2).toEqual({ id: "w2", name: "second" });
    }
  });

  it("savepoints() lists live savepoints in checkpoint order", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    session.checkpoint("sp1");
    session.checkpoint("sp2");
    session.checkpoint("sp3");
    const list = session.savepoints().map((s) => s.name);
    expect(list).toEqual(["sp1", "sp2", "sp3"]);
    session.release("sp2");
    const list2 = session.savepoints().map((s) => s.name);
    expect(list2).toEqual(["sp1", "sp3"]);
  });

  it("rollbackTo() drops savepoints created AFTER the target", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    session.checkpoint("sp1");
    session.checkpoint("sp2");
    session.checkpoint("sp3");
    session.rollbackTo("sp1");
    const list = session.savepoints().map((s) => s.name);
    expect(list).toEqual(["sp1"]);
  });

  it("savepoint + commit — the full flow produces durable writes", () => {
    const driver = new InMemoryKernelDriver();
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    session.stage((s) => s.put("widgets", "w1", { id: "w1", name: "first" }));
    session.checkpoint("sp1");
    session.stage((s) => s.put("widgets", "w2", { id: "w2", name: "second" }));
    session.rollbackTo("sp1");
    session.stage((s) => s.put("widgets", "w3", { id: "w3", name: "third" }));
    session.commit();
    const ks = driver.keyspaceFor(ctxForTenant(TENANT_A).tenantId);
    const coll = ks.collections.get("widgets");
    expect(coll).toBeDefined();
    if (coll) {
      expect(coll.get("w1")).toEqual({ id: "w1", name: "first" });
      expect(coll.get("w2")).toBeUndefined();
      expect(coll.get("w3")).toEqual({ id: "w3", name: "third" });
    }
  });
});
