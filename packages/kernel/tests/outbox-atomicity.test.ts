/**
 * @fleetos/kernel — outbox atomicity + idempotent drain tests (law A14).
 *
 * The dual-write-gap killer: events written in the SAME transaction as
 * the state change. A committed state change with a lost event is
 * IMPOSSIBLE (machine-tested). A rolled-back transaction leaves NO
 * events (machine-tested). Drain contract: at-least-once delivery with
 * idempotency keys — a redelivered event is acknowledged identically,
 * never re-applied twice at the reader seam. Pending/Failed/Delivered/
 * DeadLetter states with retry policy types (bounded backoff).
 */

import { describe, it, expect } from "vitest";
import {
  InMemoryKernelDriver,
  InMemoryOutbox,
  type TenantContext,
  makeTenantContext,
  DEFAULT_RETRY_POLICY,
  nextAttemptAt,
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

function newOutbox(driver: InMemoryKernelDriver): {
  driver: InMemoryKernelDriver;
  outbox: InMemoryOutbox;
} {
  // The driver exposes the per-tenant keyspaces via its openSession method;
  // the outbox needs access to the keyspace map. The driver's
  // keyspaceFor(tenantId) returns the (creating if absent) keyspace.
  // We construct an outbox that reaches the keyspaces via the driver's
  // snapshot/lookup surface.
  const keyspaceMap = (driver as unknown as { keyspaces: Map<string, unknown> }).keyspaces as Map<
    string,
    ReturnType<typeof driver.keyspaceFor>
  >;
  const outbox = new InMemoryOutbox({ keyspaces: keyspaceMap });
  return { driver, outbox };
}

describe("outbox A14 — atomicity (commit-with-event)", () => {
  it("publish() within an active session stages the event; pending() returns it after commit", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    session.stage((s) => s.put("widgets", "w1", { id: "w1", name: "first" }));
    const pub = outbox.publish({
      session,
      event: {
        type: "widget:created",
        payload: { id: "w1" },
        idempotencyKey: "widget:w1:create",
        occurredAt: NOW,
      },
    });
    expect(pub.ok).toBe(true);
    if (pub.ok) {
      expect(pub.value.state).toBe("PENDING");
      expect(pub.value.type).toBe("widget:created");
    }
    // Before commit: pending() returns nothing
    expect(outbox.pending({ ctx, now: NOW }).length).toBe(0);
    session.commit();
    // After commit: pending() returns the event
    const pending = outbox.pending({ ctx, now: NOW + 1 });
    expect(pending.length).toBe(1);
    expect(pending[0]?.type).toBe("widget:created");
  });

  it("publish() refuses when session is not active (session-not-active)", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    // NOT calling begin()
    const r = outbox.publish({
      session,
      event: {
        type: "widget:created",
        payload: {},
        idempotencyKey: "k1",
        occurredAt: NOW,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("session-not-active");
  });

  it("publish() refuses on missing type (missing-type)", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    const r = outbox.publish({
      session,
      event: {
        type: "",
        payload: {},
        idempotencyKey: "k1",
        occurredAt: NOW,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-type");
  });

  it("publish() refuses on missing idempotency key (missing-idempotency-key)", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    const r = outbox.publish({
      session,
      event: {
        type: "widget:created",
        payload: {},
        idempotencyKey: "",
        occurredAt: NOW,
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("missing-idempotency-key");
  });

  it("THE DUAL-WRITE-GAP IMPOSSIBILITY PROOF — commit applies both state AND event atomically", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    // Stage BOTH a state write AND an event in the same transaction.
    session.stage((s) => s.put("widgets", "w1", { id: "w1", name: "first" }));
    outbox.publish({
      session,
      event: {
        type: "widget:created",
        payload: { id: "w1" },
        idempotencyKey: "widget:w1:create",
        occurredAt: NOW,
      },
    });
    // Before commit: state not durable, event not durable
    const ks = driver.keyspaceFor(ctx.tenantId);
    expect(ks.collections.get("widgets")).toBeUndefined();
    expect(ks.outbox.events.size).toBe(0);
    // Commit — both become durable atomically
    session.commit();
    expect(ks.collections.get("widgets")?.get("w1")).toEqual({ id: "w1", name: "first" });
    expect(ks.outbox.events.size).toBe(1);
    // THERE IS NO PATH WHERE THE STATE IS COMMITTED WITHOUT THE EVENT.
    // There is no path where the event is committed without the state.
  });

  it("THE ROLLBACK-NO-EVENT INVARIANT — rollback discards both state AND event", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    session.stage((s) => s.put("widgets", "w1", { id: "w1", name: "first" }));
    outbox.publish({
      session,
      event: {
        type: "widget:created",
        payload: { id: "w1" },
        idempotencyKey: "widget:w1:create",
        occurredAt: NOW,
      },
    });
    const r = session.rollback();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.discardedWrites).toBe(1);
      expect(r.value.discardedEvents).toBe(1);
    }
    // A rolled-back transaction leaves NO events.
    const ks = driver.keyspaceFor(ctx.tenantId);
    expect(ks.collections.get("widgets")).toBeUndefined();
    expect(ks.outbox.events.size).toBe(0);
    expect(outbox.pending({ ctx, now: NOW + 1 }).length).toBe(0);
  });

  it("multiple events in the same session get monotonic per-tenant revisions", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    outbox.publish({
      session,
      event: { type: "t1", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    outbox.publish({
      session,
      event: { type: "t2", payload: {}, idempotencyKey: "k2", occurredAt: NOW },
    });
    outbox.publish({
      session,
      event: { type: "t3", payload: {}, idempotencyKey: "k3", occurredAt: NOW },
    });
    session.commit();
    const pending = outbox.pending({ ctx, now: NOW + 1 });
    expect(pending.length).toBe(3);
    expect(pending[0]?.revision).toBe(1);
    expect(pending[1]?.revision).toBe(2);
    expect(pending[2]?.revision).toBe(3);
  });

  it("causationId and correlationId thread through the event", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    const r = outbox.publish({
      session,
      event: {
        type: "widget:created",
        payload: {},
        idempotencyKey: "k1",
        occurredAt: NOW,
        causationId: "cause-1",
        correlationId: "corr-1",
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.causationId).toBe("cause-1");
      expect(r.value.correlationId).toBe("corr-1");
    }
  });
});

describe("outbox A14 — idempotent drain", () => {
  it("ack() marks a pending event DELIVERED and records the idempotency key", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    outbox.publish({
      session,
      event: {
        type: "widget:created",
        payload: { id: "w1" },
        idempotencyKey: "widget:w1:create",
        occurredAt: NOW,
      },
    });
    session.commit();
    const pending = outbox.pending({ ctx, now: NOW + 1 });
    expect(pending.length).toBe(1);
    const eventId = pending[0]!.id;
    const ack = outbox.ack({
      ctx,
      eventId,
      idempotencyKey: "widget:w1:create",
      now: NOW + 2,
    });
    expect(ack.ok).toBe(true);
    if (ack.ok) {
      expect(ack.value.outcome).toBe("newly-acknowledged");
      expect(ack.value.event.state).toBe("DELIVERED");
    }
    // After ack: the event is no longer drappable
    expect(outbox.pending({ ctx, now: NOW + 3 }).length).toBe(0);
  });

  it("THE REDELIVERED-EVENT INVARIANT — re-acking the same event returns already-acknowledged and does NOT mutate", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    outbox.publish({
      session,
      event: {
        type: "widget:created",
        payload: {},
        idempotencyKey: "k1",
        occurredAt: NOW,
      },
    });
    session.commit();
    const pending = outbox.pending({ ctx, now: NOW + 1 });
    const eventId = pending[0]!.id;
    // First ack — newly-acknowledged
    const ack1 = outbox.ack({
      ctx,
      eventId,
      idempotencyKey: "k1",
      now: NOW + 2,
    });
    expect(ack1.ok).toBe(true);
    if (ack1.ok) expect(ack1.value.outcome).toBe("newly-acknowledged");
    // Second ack (redelivery) — already-acknowledged, no mutation
    const ack2 = outbox.ack({
      ctx,
      eventId,
      idempotencyKey: "k1",
      now: NOW + 3,
    });
    expect(ack2.ok).toBe(true);
    if (ack2.ok) {
      expect(ack2.value.outcome).toBe("already-acknowledged");
      expect(ack2.value.event.state).toBe("DELIVERED");
      // The deliveryAttempts count is NOT incremented by re-ack
      expect(ack2.value.event.deliveryAttempts).toBe(0);
      // lastAttemptedAt is from the FIRST ack — re-ack does not overwrite
      expect(ack2.value.event.lastAttemptedAt).toBe(NOW + 2);
    }
  });

  it("ack() refuses with mismatched idempotency key (idempotency-key-mismatch)", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    outbox.publish({
      session,
      event: { type: "t1", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    const pending = outbox.pending({ ctx, now: NOW + 1 });
    const eventId = pending[0]!.id;
    // Wrong idempotency key — refused
    const r = outbox.ack({
      ctx,
      eventId,
      idempotencyKey: "WRONG",
      now: NOW + 2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("idempotency-key-mismatch");
  });

  it("ack() refuses on unknown event (event-not-found)", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const r = outbox.ack({
      ctx,
      eventId: "obx_evt_does_not_exist",
      idempotencyKey: "k1",
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("event-not-found");
  });

  it("ack() refuses on cross-tenant access (event-not-found — fail-closed at the keyspace boundary)", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    // Publish as tenant A
    const ctxA = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctxA, now: NOW });
    session.begin();
    outbox.publish({
      session,
      event: { type: "t1", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    const pending = outbox.pending({ ctx: ctxA, now: NOW + 1 });
    const eventId = pending[0]!.id;
    // Attempt ack as tenant B — cross-tenant access fails closed at the
    // keyspace boundary (tenant B's keyspace has no record of this event,
    // so the outbox returns event-not-found rather than revealing existence).
    const ctxB = ctxForTenant(TENANT_B);
    const r = outbox.ack({
      ctx: ctxB,
      eventId,
      idempotencyKey: "k1",
      now: NOW + 2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("event-not-found");
  });

  it("pending() returns events in revision ASC order", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    for (let i = 0; i < 5; i++) {
      outbox.publish({
        session,
        event: {
          type: `t${i}`,
          payload: { idx: i },
          idempotencyKey: `k${i}`,
          occurredAt: NOW + i,
        },
      });
    }
    session.commit();
    const pending = outbox.pending({ ctx, now: NOW + 10 });
    expect(pending.length).toBe(5);
    expect(pending.map((e) => e.revision)).toEqual([1, 2, 3, 4, 5]);
    expect(pending.map((e) => e.type)).toEqual(["t0", "t1", "t2", "t3", "t4"]);
  });

  it("pending() respects the limit option", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    for (let i = 0; i < 5; i++) {
      outbox.publish({
        session,
        event: {
          type: `t${i}`,
          payload: {},
          idempotencyKey: `k${i}`,
          occurredAt: NOW + i,
        },
      });
    }
    session.commit();
    const pending = outbox.pending({ ctx, limit: 2, now: NOW + 10 });
    expect(pending.length).toBe(2);
    expect(pending[0]?.type).toBe("t0");
    expect(pending[1]?.type).toBe("t1");
  });

  it("pending() returns empty for cross-tenant reads", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctxA = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctxA, now: NOW });
    session.begin();
    outbox.publish({
      session,
      event: { type: "t1", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    const ctxB = ctxForTenant(TENANT_B);
    expect(outbox.pending({ ctx: ctxB, now: NOW + 1 }).length).toBe(0);
  });

  it("state() returns the event's current state, null for cross-tenant", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctxA = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctxA, now: NOW });
    session.begin();
    outbox.publish({
      session,
      event: { type: "t1", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    const pending = outbox.pending({ ctx: ctxA, now: NOW + 1 });
    const eventId = pending[0]!.id;
    expect(outbox.state(ctxA, eventId)).toBe("PENDING");
    const ctxB = ctxForTenant(TENANT_B);
    expect(outbox.state(ctxB, eventId)).toBe(null);
  });

  it("findById() returns the event, null for cross-tenant", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctxA = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctxA, now: NOW });
    session.begin();
    outbox.publish({
      session,
      event: { type: "t1", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    const pending = outbox.pending({ ctx: ctxA, now: NOW + 1 });
    const eventId = pending[0]!.id;
    expect(outbox.findById(ctxA, eventId)?.type).toBe("t1");
    const ctxB = ctxForTenant(TENANT_B);
    expect(outbox.findById(ctxB, eventId)).toBe(null);
  });
});

describe("outbox A14 — retry policy (bounded backoff)", () => {
  it("nextAttemptAt() returns null when max attempts is exhausted", () => {
    const policy = { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 };
    expect(nextAttemptAt(policy, 1, NOW)).toBe(NOW + 100);
    expect(nextAttemptAt(policy, 2, NOW)).toBe(NOW + 200);
    expect(nextAttemptAt(policy, 3, NOW)).toBe(null); // exhausted
  });

  it("nextAttemptAt() respects the maxDelayMs cap", () => {
    const policy = { ...DEFAULT_RETRY_POLICY, maxDelayMs: 500 };
    // attempt 4 with maxAttempts=5 — schedules attempt 5 with
    // base 100 * factor^3 = 800, capped to 500.
    const next = nextAttemptAt(policy, 4, NOW);
    expect(next).toBe(NOW + 500);
  });

  it("markFailed() transitions PENDING -> FAILED and schedules next attempt", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    outbox.publish({
      session,
      event: { type: "t1", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    const pending = outbox.pending({ ctx, now: NOW + 1 });
    const eventId = pending[0]!.id;
    const r = outbox.markFailed({ ctx, eventId, reason: "transient", now: NOW + 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.state).toBe("FAILED");
      expect(r.value.deliveryAttempts).toBe(1);
      expect(r.value.lastFailureReason).toBe("transient");
      expect(r.value.nextAttemptAt).not.toBeNull();
    }
  });

  it("markFailed() respects the future-attempt window — pending() skips FAILED events until the window opens", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    outbox.publish({
      session,
      event: { type: "t1", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    const pending = outbox.pending({ ctx, now: NOW + 1 });
    const eventId = pending[0]!.id;
    outbox.markFailed({ ctx, eventId, reason: "transient", now: NOW + 2 });
    // Event is FAILED with nextAttemptAt in the future — skipped
    expect(outbox.pending({ ctx, now: NOW + 3 }).length).toBe(0);
    // After the retry window opens, the event is drappable again
    const future = NOW + 1000;
    expect(outbox.pending({ ctx, now: future }).length).toBe(1);
  });

  it("markFailed() moves to DEAD_LETTER after the policy is exhausted", () => {
    const driver = new InMemoryKernelDriver();
    const policy = { ...DEFAULT_RETRY_POLICY, maxAttempts: 2 };
    // Construct an outbox with the small policy
    const keyspaceMap = (driver as unknown as { keyspaces: Map<string, unknown> }).keyspaces as Map<
      string,
      ReturnType<typeof driver.keyspaceFor>
    >;
    const outbox = new InMemoryOutbox({ keyspaces: keyspaceMap, policy });
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    outbox.publish({
      session,
      event: { type: "t1", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    const pending = outbox.pending({ ctx, now: NOW + 1 });
    const eventId = pending[0]!.id;
    // Attempt 1 — schedules retry
    outbox.markFailed({ ctx, eventId, reason: "r1", now: NOW + 2 });
    // Attempt 2 — exhausted; dead-letter
    const r2 = outbox.markFailed({ ctx, eventId, reason: "r2", now: NOW + 1000 });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.value.state).toBe("DEAD_LETTER");
      expect(r2.value.nextAttemptAt).toBeNull();
    }
    // DEAD_LETTER events are NOT drappable
    expect(outbox.pending({ ctx, now: NOW + 100_000 }).length).toBe(0);
  });

  it("markFailed() on a DEAD_LETTER event is a no-op (still DEAD_LETTER)", () => {
    const driver = new InMemoryKernelDriver();
    const policy = { ...DEFAULT_RETRY_POLICY, maxAttempts: 1 };
    const keyspaceMap = (driver as unknown as { keyspaces: Map<string, unknown> }).keyspaces as Map<
      string,
      ReturnType<typeof driver.keyspaceFor>
    >;
    const outbox = new InMemoryOutbox({ keyspaces: keyspaceMap, policy });
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    outbox.publish({
      session,
      event: { type: "t1", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    const pending = outbox.pending({ ctx, now: NOW + 1 });
    const eventId = pending[0]!.id;
    outbox.markFailed({ ctx, eventId, reason: "first", now: NOW + 2 });
    const r2 = outbox.markFailed({ ctx, eventId, reason: "second", now: NOW + 100 });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.value.state).toBe("DEAD_LETTER");
  });

  it("markFailed() on a DELIVERED event is a no-op (still DELIVERED)", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctx = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctx, now: NOW });
    session.begin();
    outbox.publish({
      session,
      event: { type: "t1", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    const pending = outbox.pending({ ctx, now: NOW + 1 });
    const eventId = pending[0]!.id;
    outbox.ack({ ctx, eventId, idempotencyKey: "k1", now: NOW + 2 });
    const r = outbox.markFailed({ ctx, eventId, reason: "should-noop", now: NOW + 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.state).toBe("DELIVERED");
  });

  it("markFailed() refuses on cross-tenant access (event-not-found — fail-closed)", () => {
    const driver = new InMemoryKernelDriver();
    const { outbox } = newOutbox(driver);
    const ctxA = ctxForTenant(TENANT_A);
    const session = driver.openSession({ tenant: ctxA, now: NOW });
    session.begin();
    outbox.publish({
      session,
      event: { type: "t1", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    const pending = outbox.pending({ ctx: ctxA, now: NOW + 1 });
    const eventId = pending[0]!.id;
    const ctxB = ctxForTenant(TENANT_B);
    const r = outbox.markFailed({ ctx: ctxB, eventId, reason: "x", now: NOW + 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("event-not-found");
  });
});
