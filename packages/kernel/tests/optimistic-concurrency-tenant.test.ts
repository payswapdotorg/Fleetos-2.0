/**
 * @fleetos/kernel — optimistic concurrency + tenant fail-closed tests.
 *
 * RepositoryPort base contract: a stale revision write is refused with
 * a machine-stable reason code (`STALE_REVISION`/`UNKNOWN_RECORD`).
 * Tenant isolation (A8): a missing TenantContext fails closed; cross-
 * tenant access returns null.
 */

import { describe, it, expect } from "vitest";
import {
  InMemoryKernelDriver,
  InMemoryRepository,
  type TenantContext,
  makeTenantContext,
  type Entity,
  type TenantId,
  type RevisionGuard,
} from "../src/index.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme-corp-001";
const TENANT_B = "tnt_other-corp-002";
const ACTOR_A = "act_alice-001";
const SESSION_A = "sess_abcdef0123456789";

function ctxForTenant(tenant: string): TenantContext {
  const r = makeTenantContext({
    tenantId: tenant,
    actorId: ACTOR_A,
    sessionId: SESSION_A,
    establishedAt: NOW,
  });
  if (!r.ok) throw new Error(`bad ctx: ${r.reason}`);
  return r.context;
}

interface Widget extends Entity {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly revision: number;
  readonly recordedAt: number;
  readonly name: string;
}

function widget(id: string, tenant: string, name: string, revision = 0): Widget {
  return {
    id,
    tenantId: tenant as TenantId,
    revision,
    recordedAt: 0,
    name,
  };
}

function guard(id: string, expectRevision: number): RevisionGuard {
  return { id, expectRevision };
}

describe("optimistic concurrency — InMemoryRepository.save()", () => {
  it("creates an entity at revision 1 (expected revision 0)", () => {
    const driver = new InMemoryKernelDriver();
    const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    const r = repo.save({
      ctx,
      session,
      entity: widget("w1", TENANT_A, "first"),
      expected: guard("w1", 0),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.revision).toBe(1);
      expect(r.value.recordedAt).toBe(NOW);
    }
    session.commit();
    const read = repo.findById(ctx, "w1");
    if (!read.ok) throw new Error("expected ok");
    expect(read.value?.name).toBe("first");
  });

  it("refuses a stale-revision write with STALE_REVISION + recorded revision", () => {
    const driver = new InMemoryKernelDriver();
    const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
    const ctx = ctxForTenant(TENANT_A);
    // Initial write at revision 1
    const s1 = driver.openSession({ tenant: ctx, now: NOW });
    s1.begin();
    repo.save({
      ctx,
      session: s1,
      entity: widget("w1", TENANT_A, "first"),
      expected: guard("w1", 0),
    });
    s1.commit();
    // Stale write — caller still expects revision 0 (the prior committed was 1)
    const s2 = driver.openSession({ tenant: ctx, now: NOW + 1 });
    s2.begin();
    const r = repo.save({
      ctx,
      session: s2,
      entity: widget("w1", TENANT_A, "stale"),
      expected: guard("w1", 0), // STALE — recorded is 1
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const rej = r.reason as { reason: string; recordedRevision: number | null };
      expect(rej.reason).toBe("STALE_REVISION");
      expect(rej.recordedRevision).toBe(1);
    }
    s2.rollback();
  });

  it("accepts a write at the recorded revision (advances to next revision)", () => {
    const driver = new InMemoryKernelDriver();
    const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
    const ctx = ctxForTenant(TENANT_A);
    // Initial write
    const s1 = driver.openSession({ tenant: ctx, now: NOW });
    s1.begin();
    repo.save({
      ctx,
      session: s1,
      entity: widget("w1", TENANT_A, "first"),
      expected: guard("w1", 0),
    });
    s1.commit();
    // Update — caller reads committed (revision 1), expects 1, advances to 2
    const s2 = driver.openSession({ tenant: ctx, now: NOW + 1 });
    s2.begin();
    const r = repo.save({
      ctx,
      session: s2,
      entity: widget("w1", TENANT_A, "second"),
      expected: guard("w1", 1),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.revision).toBe(2);
    s2.commit();
    const read = repo.findById(ctx, "w1");
    if (!read.ok) throw new Error("expected ok");
    expect(read.value?.name).toBe("second");
    expect(read.value?.revision).toBe(2);
  });

  it("refuses a save when the session is not active (session-not-active)", () => {
    const driver = new InMemoryKernelDriver();
    const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    // NOT calling begin()
    const r = repo.save({
      ctx,
      session,
      entity: widget("w1", TENANT_A, "first"),
      expected: guard("w1", 0),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toEqual({ reason: "session-not-active" });
  });

  it("refuses a save when the entity belongs to a different tenant (tenant-mismatch)", () => {
    const driver = new InMemoryKernelDriver();
    const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
    const ctxA = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctxA, now: NOW });
    session.begin();
    const r = repo.save({
      ctx: ctxA,
      session,
      // Entity claims to belong to tenant B; caller's ctx is tenant A — refused
      entity: widget("w1", TENANT_B, "cross-tenant-write"),
      expected: guard("w1", 0),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toEqual({ reason: "tenant-mismatch" });
  });

  it("refuses a save with a cross-tenant session (session-bound tenant != ctx.tenantId)", () => {
    const driver = new InMemoryKernelDriver();
    const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
    // Session is bound to tenant A
    const session = driver.openSession({ tenant: ctxForTenant(TENANT_A), now: NOW });
    session.begin();
    // Caller presents ctx for tenant B (does not match session-bound tenant)
    const ctxB = ctxForTenant(TENANT_B);
    const r = repo.save({
      ctx: ctxB,
      session,
      entity: widget("w1", TENANT_B, "wrong-session"),
      expected: guard("w1", 0),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toEqual({ reason: "session-not-active" });
  });
});

describe("optimistic concurrency — InMemoryRepository.remove()", () => {
  it("removes a record at the recorded revision", () => {
    const driver = new InMemoryKernelDriver();
    const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
    const ctx = ctxForTenant(TENANT_A);
    const s1 = driver.openSession({ tenant: ctx, now: NOW });
    s1.begin();
    repo.save({
      ctx,
      session: s1,
      entity: widget("w1", TENANT_A, "first"),
      expected: guard("w1", 0),
    });
    s1.commit();
    const s2 = driver.openSession({ tenant: ctx, now: NOW + 1 });
    s2.begin();
    const r = repo.remove({
      ctx,
      session: s2,
      id: "w1",
      expected: guard("w1", 1),
    });
    expect(r.ok).toBe(true);
    s2.commit();
    const read = repo.findById(ctx, "w1");
    if (!read.ok) throw new Error("expected ok");
    expect(read.value).toBeNull();
  });

  it("refuses a remove with a stale revision (STALE_REVISION)", () => {
    const driver = new InMemoryKernelDriver();
    const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
    const ctx = ctxForTenant(TENANT_A);
    const s1 = driver.openSession({ tenant: ctx, now: NOW });
    s1.begin();
    repo.save({
      ctx,
      session: s1,
      entity: widget("w1", TENANT_A, "first"),
      expected: guard("w1", 0),
    });
    s1.commit();
    const s2 = driver.openSession({ tenant: ctx, now: NOW + 1 });
    s2.begin();
    const r = repo.remove({
      ctx,
      session: s2,
      id: "w1",
      expected: guard("w1", 0), // STALE — recorded is 1
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const rej = r.reason as { reason: string; recordedRevision: number | null };
      expect(rej.reason).toBe("STALE_REVISION");
      expect(rej.recordedRevision).toBe(1);
    }
  });

  it("refuses a remove on a non-existent record with a non-zero expected revision (UNKNOWN_RECORD)", () => {
    const driver = new InMemoryKernelDriver();
    const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    const r = repo.remove({
      ctx,
      session,
      id: "w1",
      expected: guard("w1", 5),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const rej = r.reason as { reason: string; recordedRevision: number | null };
      expect(rej.reason).toBe("UNKNOWN_RECORD");
      expect(rej.recordedRevision).toBeNull();
    }
  });

  it("accepts an idempotent remove on a non-existent record when expected revision is 0", () => {
    const driver = new InMemoryKernelDriver();
    const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    const r = repo.remove({
      ctx,
      session,
      id: "w1",
      expected: guard("w1", 0),
    });
    expect(r.ok).toBe(true);
  });
});

describe("tenant fail-closed (A8) — InMemoryRepository reads", () => {
  it("findById returns null for cross-tenant reads", () => {
    const driver = new InMemoryKernelDriver();
    const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
    // Write as tenant A
    const ctxA = ctxForTenant(TENANT_A);
    const s1 = driver.openSession({ tenant: ctxA, now: NOW });
    s1.begin();
    repo.save({
      ctx: ctxA,
      session: s1,
      entity: widget("w1", TENANT_A, "first"),
      expected: guard("w1", 0),
    });
    s1.commit();
    // Read as tenant B — fail closed (return null)
    const ctxB = ctxForTenant(TENANT_B);
    const r = repo.findById(ctxB, "w1");
    if (!r.ok) throw new Error("expected ok");
    expect(r.value).toBeNull();
  });

  it("listByTenant returns only same-tenant entities", () => {
    const driver = new InMemoryKernelDriver();
    const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
    const ctxA = ctxForTenant(TENANT_A);
    const ctxB = ctxForTenant(TENANT_B);
    // Write 2 for A and 2 for B
    for (const [tenant, ctx] of [[TENANT_A, ctxA], [TENANT_B, ctxB]] as const) {
      const s = driver.openSession({ tenant: ctx, now: NOW });
      s.begin();
      repo.save({
        ctx,
        session: s,
        entity: widget("w-a-1", tenant, "1"),
        expected: guard("w-a-1", 0),
      });
      repo.save({
        ctx,
        session: s,
        entity: widget("w-a-2", tenant, "2"),
        expected: guard("w-a-2", 0),
      });
      s.commit();
    }
    expect(repo.listByTenant(ctxA).length).toBe(2);
    expect(repo.listByTenant(ctxB).length).toBe(2);
    // Sanity: same ids differ across tenants (no leakage)
    const aIds = repo.listByTenant(ctxA).map((w) => w.id).sort();
    expect(aIds).toEqual(["w-a-1", "w-a-2"]);
  });

  it("query() filters + limits tenant-scoped reads", () => {
    const driver = new InMemoryKernelDriver();
    const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
    const ctxA = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctxA, now: NOW });
    session.begin();
    for (let i = 0; i < 10; i++) {
      repo.save({
        ctx: ctxA,
        session,
        entity: widget(`w${i}`, TENANT_A, `name-${i}`),
        expected: guard(`w${i}`, 0),
      });
    }
    session.commit();
    const r = repo.query(ctxA, {
      filter: (w) => w.name.endsWith("5") || w.name.endsWith("3"),
      orderBy: (a, b) => a.id.localeCompare(b.id),
      limit: 10,
    });
    expect(r.length).toBe(2);
    expect(r[0]?.id).toBe("w3");
    expect(r[1]?.id).toBe("w5");
  });

  it("findById on a non-existent record returns null", () => {
    const driver = new InMemoryKernelDriver();
    const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
    const ctx = ctxForTenant(TENANT_A);
    const r = repo.findById(ctx, "nope");
    if (!r.ok) throw new Error("expected ok");
    expect(r.value).toBeNull();
  });

  it("makeTenantContext rejects a malformed tenant id (fail-closed)", () => {
    const r = makeTenantContext({
      tenantId: "BAD_TENANT",
      actorId: ACTOR_A,
      sessionId: SESSION_A,
      establishedAt: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed-tenant-id");
  });

  it("makeTenantContext rejects an empty tenant id (missing-tenant-id)", () => {
    const r = makeTenantContext({
      tenantId: "",
      actorId: ACTOR_A,
      sessionId: SESSION_A,
      establishedAt: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-tenant-id");
  });

  it("makeTenantContext rejects cross-tenant-forbidden scope", () => {
    const r = makeTenantContext({
      tenantId: TENANT_A,
      actorId: ACTOR_A,
      sessionId: SESSION_A,
      establishedAt: NOW,
      scope: "cross-tenant-forbidden",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("cross-tenant-forbidden");
  });

  it("makeTenantContext rejects an invalid establishedAt (invalid-established-at)", () => {
    const r = makeTenantContext({
      tenantId: TENANT_A,
      actorId: ACTOR_A,
      sessionId: SESSION_A,
      establishedAt: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-established-at");
  });
});

describe("determinism — same operation sequence produces identical state", () => {
  it("two drivers seeded with the same operations have identical snapshots", () => {
    function run(driver: InMemoryKernelDriver) {
      const ctx = ctxForTenant(TENANT_A);
      const s = driver.openSession({ tenant: ctx, now: NOW });
      s.begin();
      s.stage((st) => st.put("widgets", "w1", { id: "w1", name: "first" }));
      s.stage((st) => st.put("widgets", "w2", { id: "w2", name: "second" }));
      s.commit();
      const s2 = driver.openSession({ tenant: ctx, now: NOW + 1 });
      s2.begin();
      s2.stage((st) => st.put("widgets", "w3", { id: "w3", name: "third" }));
      s2.rollback();
    }
    const d1 = new InMemoryKernelDriver();
    const d2 = new InMemoryKernelDriver();
    run(d1);
    run(d2);
    // Compare committed keyspace snapshots
    const ks1 = d1.snapshot(ctxForTenant(TENANT_A).tenantId);
    const ks2 = d2.snapshot(ctxForTenant(TENANT_A).tenantId);
    expect(ks1.outboxCount).toBe(ks2.outboxCount);
    const coll1 = ks1.collections.get("widgets");
    const coll2 = ks2.collections.get("widgets");
    expect(coll1?.size).toBe(coll2?.size);
    expect(JSON.stringify([...(coll1?.entries() ?? [])])).toBe(
      JSON.stringify([...(coll2?.entries() ?? [])]),
    );
  });

  it("audit digests are byte-identical for byte-identical inputs (A19)", () => {
    const driver = new InMemoryKernelDriver();
    const ctx = ctxForTenant(TENANT_A);
    const s1 = driver.openSession({ tenant: ctx, now: NOW });
    s1.begin();
    s1.stage((st) => st.put("widgets", "w1", { id: "w1" }));
    const r1 = s1.commit();
    const driver2 = new InMemoryKernelDriver();
    const s2 = driver2.openSession({ tenant: ctx, now: NOW });
    s2.begin();
    s2.stage((st) => st.put("widgets", "w1", { id: "w1" }));
    const r2 = s2.commit();
    if (!r1.ok || !r2.ok) throw new Error("expected ok");
    expect(r1.value.audit.digest).toBe(r2.value.audit.digest);
  });
});
