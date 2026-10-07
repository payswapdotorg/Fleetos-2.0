/**
 * @fleetos/kernel — UnitOfWork tests (law A1, A14).
 *
 * The UnitOfWork groups repository read/write operations into ONE
 * atomic boundary. Commit applies all writes or none; a failed
 * operation inside the unit rolls the whole unit back. Events
 * published through the unit ARE in the same atomic boundary as the
 * state changes (A14).
 */

import { describe, it, expect } from "vitest";
import {
  InMemoryKernelDriver,
  InMemoryOutbox,
  InMemoryRepository,
  unitOfWorkFactory,
  type TenantContext,
  makeTenantContext,
  type Entity,
  type TenantId,
  type RevisionGuard,
  ok,
  unwrap,
} from "../src/index.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme-corp-001";
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

function widget(id: string, tenant: string, name: string): Widget {
  return {
    id,
    tenantId: tenant as TenantId,
    revision: 0,
    recordedAt: 0,
    name,
  };
}

function guard(id: string, expectRevision: number): RevisionGuard {
  return { id, expectRevision };
}

function newStack() {
  const driver = new InMemoryKernelDriver();
  const keyspaceMap = (driver as unknown as { keyspaces: Map<string, unknown> }).keyspaces as Map<
    string,
    ReturnType<typeof driver.keyspaceFor>
  >;
  const outbox = new InMemoryOutbox({ keyspaces: keyspaceMap });
  const factory = unitOfWorkFactory({
    createSession: (tenant: TenantContext) =>
      ok(driver.openSession({ tenant, now: NOW })),
    outbox,
  });
  const repo = new InMemoryRepository<Widget>("widgets", driver, () => NOW);
  return { driver, outbox, factory, repo };
}

describe("UnitOfWork — atomic commit/rollback", () => {
  it("open() + execute() + commit() persists all writes", () => {
    const { factory, repo } = newStack();
    const ctx = ctxForTenant(TENANT_A);
    const uow = unwrap(factory.open(ctx));
    uow.execute((session) => {
      repo.save({
        ctx,
        session,
        entity: widget("w1", TENANT_A, "first"),
        expected: guard("w1", 0),
      });
      repo.save({
        ctx,
        session,
        entity: widget("w2", TENANT_A, "second"),
        expected: guard("w2", 0),
      });
    });
    const r = uow.commit();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.stagedWrites).toBe(2);
      expect(r.value.stagedEvents).toBe(0);
    }
    expect(repo.listByTenant(ctx).length).toBe(2);
  });

  it("a thrown operation rolls back the unit (operation-failed)", () => {
    const { factory, repo } = newStack();
    const ctx = ctxForTenant(TENANT_A);
    const uow = unwrap(factory.open(ctx));
    uow.execute((session) => {
      repo.save({
        ctx,
        session,
        entity: widget("w1", TENANT_A, "first"),
        expected: guard("w1", 0),
      });
    });
    const r = uow.execute(() => {
      throw new Error("simulated failure");
    });
    expect(r.ok).toBe(false);
    if (!r.ok && "cause" in r.reason) {
      expect(r.reason.cause).toBe("simulated failure");
    }
    // After failure: commit refuses — the unit is closed (rolled back)
    expect(uow.closed).toBe(true);
    const c = uow.commit();
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toEqual({ reason: "already-closed" });
  });

  it("rollback() discards all staged writes", () => {
    const { factory, repo } = newStack();
    const ctx = ctxForTenant(TENANT_A);
    const uow = unwrap(factory.open(ctx));
    uow.execute((session) => {
      repo.save({
        ctx,
        session,
        entity: widget("w1", TENANT_A, "first"),
        expected: guard("w1", 0),
      });
    });
    const r = uow.rollback();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.discardedWrites).toBe(1);
    expect(repo.listByTenant(ctx).length).toBe(0);
  });

  it("publish() stages an event in the same atomic boundary as the state change", () => {
    const { factory, outbox, repo } = newStack();
    const ctx = ctxForTenant(TENANT_A);
    const uow = unwrap(factory.open(ctx));
    uow.execute((session) => {
      repo.save({
        ctx,
        session,
        entity: widget("w1", TENANT_A, "first"),
        expected: guard("w1", 0),
      });
    });
    uow.publish({
      type: "widget:created",
      payload: { id: "w1" },
      idempotencyKey: "widget:w1:create",
      occurredAt: NOW,
    });
    const r = uow.commit();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.stagedWrites).toBe(1);
      expect(r.value.stagedEvents).toBe(1);
    }
    expect(repo.listByTenant(ctx).length).toBe(1);
    expect(outbox.pending({ ctx, now: NOW + 1 }).length).toBe(1);
  });

  it("rollback() after publish() discards the event (no residue)", () => {
    const { factory, outbox, repo } = newStack();
    const ctx = ctxForTenant(TENANT_A);
    const uow = unwrap(factory.open(ctx));
    uow.execute((session) => {
      repo.save({
        ctx,
        session,
        entity: widget("w1", TENANT_A, "first"),
        expected: guard("w1", 0),
      });
    });
    uow.publish({
      type: "widget:created",
      payload: {},
      idempotencyKey: "k1",
      occurredAt: NOW,
    });
    uow.rollback();
    expect(repo.listByTenant(ctx).length).toBe(0);
    expect(outbox.pending({ ctx, now: NOW + 1 }).length).toBe(0);
  });

  it("commit on a closed unit refuses (already-closed)", () => {
    const { factory } = newStack();
    const ctx = ctxForTenant(TENANT_A);
    const uow = unwrap(factory.open(ctx));
    uow.commit();
    const r = uow.commit();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toEqual({ reason: "already-closed" });
  });

  it("execute on a closed unit refuses (already-closed)", () => {
    const { factory } = newStack();
    const ctx = ctxForTenant(TENANT_A);
    const uow = unwrap(factory.open(ctx));
    uow.commit();
    const r = uow.execute(() => 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toEqual({ reason: "already-closed" });
  });

  it("publish on a closed unit refuses (already-closed)", () => {
    const { factory } = newStack();
    const ctx = ctxForTenant(TENANT_A);
    const uow = unwrap(factory.open(ctx));
    uow.commit();
    const r = uow.publish({
      type: "t1",
      payload: {},
      idempotencyKey: "k1",
      occurredAt: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toEqual({ reason: "already-closed" });
  });

  it("execute can return a value through the unit boundary", () => {
    const { factory } = newStack();
    const ctx = ctxForTenant(TENANT_A);
    const uow = unwrap(factory.open(ctx));
    const r = uow.execute(() => "value-returned");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("value-returned");
    uow.commit();
  });
});
