/**
 * @fleetos/mission — the outbox seam tests (law A14).
 *
 * The mission-owned reference adapter implementing the kernel's OutboxPort
 * TYPE over the mission store's TransactionalSession: staged-until-commit
 * publication, rollback leaves NO event residue, revision-ordered drain
 * with retry windows, idempotent ack, dead-letter exhaustion, and
 * cross-tenant fail-closed reads. Plus the session's own state machine
 * and savepoint semantics.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTBOX_RETRY_POLICY,
  InMemoryMissionOutbox,
  MissionStore,
  outboxRetryDelayMs,
} from "../src/outbox.js";
import { ctxFor, NOW, TENANT_A, TENANT_B } from "./helpers.js";

describe("MissionTransactionSession — the session state machine", () => {
  it("begin → active; commit applies staged writes", () => {
    const store = new MissionStore();
    const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW });
    expect(session.state).toBe("open");
    session.begin();
    expect(session.state).toBe("active");
    session.stage((stage) => stage.put("missions", "m1", { id: "m1" }));
    const commit = session.commit();
    expect(commit.ok).toBe(true);
    expect(session.state).toBe("committed");
    expect(store.get(ctxFor(TENANT_A).tenantId, "missions", "m1")).toEqual({ id: "m1" });
  });

  it("rollback discards staged writes entirely", () => {
    const store = new MissionStore();
    const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW });
    session.begin();
    session.stage((stage) => stage.put("missions", "m1", { id: "m1" }));
    const rollback = session.rollback();
    expect(rollback.ok && rollback.value.discardedWrites).toBe(1);
    expect(store.get(ctxFor(TENANT_A).tenantId, "missions", "m1")).toBeNull();
  });

  it("operations after commit are refused with illegal-state", () => {
    const store = new MissionStore();
    const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW });
    session.begin();
    session.commit();
    expect(session.begin()).toMatchObject({ ok: false, reason: { reason: "illegal-state" } });
    expect(session.commit()).toMatchObject({ ok: false, reason: { reason: "illegal-state" } });
    expect(session.rollback()).toMatchObject({ ok: false, reason: { reason: "illegal-state" } });
  });

  it("staging requires an active session", () => {
    const store = new MissionStore();
    const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW });
    const staged = session.stage(() => 1);
    expect(staged).toMatchObject({ ok: false, reason: { reason: "illegal-state" } });
  });

  it("savepoints: rollbackTo discards writes staged AFTER the savepoint", () => {
    const store = new MissionStore();
    const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW });
    session.begin();
    session.stage((stage) => stage.put("missions", "before", { v: 1 }));
    session.checkpoint("sp1");
    session.stage((stage) => stage.put("missions", "after", { v: 2 }));
    session.rollbackTo("sp1");
    session.commit();
    expect(store.get(ctxFor(TENANT_A).tenantId, "missions", "before")).toEqual({ v: 1 });
    expect(store.get(ctxFor(TENANT_A).tenantId, "missions", "after")).toBeNull();
  });

  it("duplicate savepoint names are refused", () => {
    const store = new MissionStore();
    const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW });
    session.begin();
    session.checkpoint("sp1");
    expect(session.checkpoint("sp1")).toMatchObject({
      ok: false,
      reason: { reason: "duplicate-savepoint" },
    });
  });
});

describe("InMemoryMissionOutbox — publish staging (A14)", () => {
  it("an event is invisible to pending() BEFORE commit and visible after", () => {
    const store = new MissionStore();
    const outbox = new InMemoryMissionOutbox({ stores: store.stores });
    const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW });
    session.begin();
    const published = outbox.publish({
      session,
      event: { type: "mission.created", payload: {}, idempotencyKey: "mj::1", occurredAt: NOW },
    });
    expect(published.ok).toBe(true);
    expect(outbox.pending({ ctx: ctxFor(TENANT_A), now: NOW })).toHaveLength(0);
    session.commit();
    expect(outbox.pending({ ctx: ctxFor(TENANT_A), now: NOW })).toHaveLength(1);
  });

  it("THE ROLLBACK-NO-EVENT INVARIANT — a rolled-back session leaves NO event residue", () => {
    const store = new MissionStore();
    const outbox = new InMemoryMissionOutbox({ stores: store.stores });
    const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW });
    session.begin();
    session.stage((stage) => stage.put("missions", "m1", { id: "m1" }));
    outbox.publish({
      session,
      event: { type: "mission.created", payload: {}, idempotencyKey: "mj::1", occurredAt: NOW },
    });
    session.rollback();
    expect(outbox.pending({ ctx: ctxFor(TENANT_A), now: NOW })).toHaveLength(0);
    expect(outbox.eventsFor(ctxFor(TENANT_A))).toHaveLength(0);
    expect(store.get(ctxFor(TENANT_A).tenantId, "missions", "m1")).toBeNull();
  });

  it("publish validations: session-not-active / missing-type / missing-idempotency-key", () => {
    const store = new MissionStore();
    const outbox = new InMemoryMissionOutbox({ stores: store.stores });
    const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW });
    expect(
      outbox.publish({
        session,
        event: { type: "t", payload: {}, idempotencyKey: "k", occurredAt: NOW },
      }),
    ).toEqual({ ok: false, reason: "session-not-active" });
    session.begin();
    expect(
      outbox.publish({
        session,
        event: { type: "", payload: {}, idempotencyKey: "k", occurredAt: NOW },
      }),
    ).toEqual({ ok: false, reason: "missing-type" });
    expect(
      outbox.publish({
        session,
        event: { type: "t", payload: {}, idempotencyKey: "", occurredAt: NOW },
      }),
    ).toEqual({ ok: false, reason: "missing-idempotency-key" });
  });
});

describe("InMemoryMissionOutbox — drain contract", () => {
  function publishThree(outbox: InMemoryMissionOutbox, store: MissionStore) {
    for (let i = 1; i <= 3; i++) {
      const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW + i });
      session.begin();
      outbox.publish({
        session,
        event: {
          type: `mission.evt${i}`,
          payload: { i },
          idempotencyKey: `mj::${i}`,
          occurredAt: NOW + i,
        },
      });
      session.commit();
    }
  }

  it("pending returns events in revision order", () => {
    const store = new MissionStore();
    const outbox = new InMemoryMissionOutbox({ stores: store.stores });
    publishThree(outbox, store);
    const pending = outbox.pending({ ctx: ctxFor(TENANT_A), now: NOW + 100 });
    expect(pending.map((e) => e.idempotencyKey)).toEqual(["mj::1", "mj::2", "mj::3"]);
    expect(pending.map((e) => e.revision)).toEqual([1, 2, 3]);
  });

  it("pending respects the limit", () => {
    const store = new MissionStore();
    const outbox = new InMemoryMissionOutbox({ stores: store.stores });
    publishThree(outbox, store);
    expect(outbox.pending({ ctx: ctxFor(TENANT_A), limit: 2, now: NOW + 100 })).toHaveLength(2);
  });

  it("pending skips events whose retry window has not opened", () => {
    const store = new MissionStore();
    const outbox = new InMemoryMissionOutbox({ stores: store.stores });
    publishThree(outbox, store);
    const event = outbox.pending({ ctx: ctxFor(TENANT_A), now: NOW + 100 })[0];
    expect(event).toBeDefined();
    if (!event) return;
    outbox.markFailed({ ctx: ctxFor(TENANT_A), eventId: event.id, reason: "down", now: NOW + 100 });
    expect(outbox.pending({ ctx: ctxFor(TENANT_A), now: NOW + 100 })).toHaveLength(2);
    expect(
      outbox.pending({ ctx: ctxFor(TENANT_A), now: NOW + 100 + DEFAULT_OUTBOX_RETRY_POLICY.baseDelayMs }),
    ).toHaveLength(3);
  });

  it("cross-tenant pending returns an empty array (fail closed)", () => {
    const store = new MissionStore();
    const outbox = new InMemoryMissionOutbox({ stores: store.stores });
    publishThree(outbox, store);
    expect(outbox.pending({ ctx: ctxFor(TENANT_B), now: NOW + 100 })).toEqual([]);
    expect(outbox.eventsFor(ctxFor(TENANT_B))).toEqual([]);
  });
});

describe("InMemoryMissionOutbox — ack", () => {
  it("ack moves PENDING → DELIVERED", () => {
    const store = new MissionStore();
    const outbox = new InMemoryMissionOutbox({ stores: store.stores });
    const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW });
    session.begin();
    const published = outbox.publish({
      session,
      event: { type: "t", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    const ack = outbox.ack({
      ctx: ctxFor(TENANT_A),
      eventId: published.value.id,
      idempotencyKey: "k1",
      now: NOW + 1,
    });
    expect(ack.ok && ack.value.outcome).toBe("newly-acknowledged");
    expect(ack.ok && ack.value.event.state).toBe("DELIVERED");
  });

  it("THE REDELIVERED-EVENT INVARIANT — re-ack is already-acknowledged and does NOT mutate", () => {
    const store = new MissionStore();
    const outbox = new InMemoryMissionOutbox({ stores: store.stores });
    const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW });
    session.begin();
    const published = outbox.publish({
      session,
      event: { type: "t", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    if (!published.ok) return;
    outbox.ack({ ctx: ctxFor(TENANT_A), eventId: published.value.id, idempotencyKey: "k1", now: NOW + 1 });
    const again = outbox.ack({
      ctx: ctxFor(TENANT_A),
      eventId: published.value.id,
      idempotencyKey: "k1",
      now: NOW + 2,
    });
    expect(again.ok && again.value.outcome).toBe("already-acknowledged");
    const event = outbox.findById(ctxFor(TENANT_A), published.value.id);
    expect(event?.lastAttemptedAt).toBe(NOW + 1); // unchanged by the re-ack
    expect(event?.state).toBe("DELIVERED");
  });

  it("ack with a mismatched idempotency key is refused", () => {
    const store = new MissionStore();
    const outbox = new InMemoryMissionOutbox({ stores: store.stores });
    const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW });
    session.begin();
    const published = outbox.publish({
      session,
      event: { type: "t", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    if (!published.ok) return;
    expect(
      outbox.ack({ ctx: ctxFor(TENANT_A), eventId: published.value.id, idempotencyKey: "WRONG", now: NOW + 1 }),
    ).toEqual({ ok: false, reason: "idempotency-key-mismatch" });
  });

  it("ack on an unknown / cross-tenant event is event-not-found (fail closed)", () => {
    const store = new MissionStore();
    const outbox = new InMemoryMissionOutbox({ stores: store.stores });
    const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW });
    session.begin();
    const published = outbox.publish({
      session,
      event: { type: "t", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    if (!published.ok) return;
    expect(
      outbox.ack({ ctx: ctxFor(TENANT_B), eventId: published.value.id, idempotencyKey: "k1", now: NOW + 1 }),
    ).toEqual({ ok: false, reason: "event-not-found" });
    expect(outbox.state(ctxFor(TENANT_B), published.value.id)).toBeNull();
    expect(outbox.findById(ctxFor(TENANT_B), published.value.id)).toBeNull();
  });
});

describe("InMemoryMissionOutbox — markFailed / dead-letter", () => {
  function publishOne() {
    const store = new MissionStore();
    const outbox = new InMemoryMissionOutbox({
      stores: store.stores,
      policy: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 30_000, backoffBps: 20_000 },
    });
    const session = store.openSession({ ctx: ctxFor(TENANT_A), now: NOW });
    session.begin();
    const published = outbox.publish({
      session,
      event: { type: "t", payload: {}, idempotencyKey: "k1", occurredAt: NOW },
    });
    session.commit();
    return { store, outbox, eventId: published.ok ? published.value.id : "" };
  }

  it("markFailed schedules the retry at EXACTLY now + delay (integer bps math)", () => {
    const { outbox, eventId } = publishOne();
    const failed = outbox.markFailed({ ctx: ctxFor(TENANT_A), eventId, reason: "down", now: NOW });
    expect(failed.ok && failed.value.state).toBe("FAILED");
    expect(failed.ok && failed.value.nextAttemptAt).toBe(NOW + 100);
    expect(failed.ok && failed.value.deliveryAttempts).toBe(1);
  });

  it("the retry ladder is exact: 100 then 200", () => {
    const { outbox, eventId } = publishOne();
    const first = outbox.markFailed({ ctx: ctxFor(TENANT_A), eventId, reason: "down", now: NOW });
    expect(first.ok && first.value.nextAttemptAt).toBe(NOW + 100);
    const second = outbox.markFailed({
      ctx: ctxFor(TENANT_A),
      eventId,
      reason: "down",
      now: NOW + 100,
    });
    expect(second.ok && second.value.nextAttemptAt).toBe(NOW + 300);
  });

  it("exhausting the policy dead-letters (no nextAttemptAt, excluded from pending)", () => {
    const { outbox, eventId } = publishOne();
    outbox.markFailed({ ctx: ctxFor(TENANT_A), eventId, reason: "down", now: NOW });
    outbox.markFailed({ ctx: ctxFor(TENANT_A), eventId, reason: "down", now: NOW + 100 });
    const third = outbox.markFailed({
      ctx: ctxFor(TENANT_A),
      eventId,
      reason: "down",
      now: NOW + 300,
    });
    expect(third.ok && third.value.state).toBe("DEAD_LETTER");
    expect(third.ok && third.value.nextAttemptAt).toBeNull();
    expect(outbox.pending({ ctx: ctxFor(TENANT_A), now: NOW + 1_000_000 })).toHaveLength(0);
  });

  it("markFailed on an unknown event is event-not-found", () => {
    const { outbox } = publishOne();
    expect(
      outbox.markFailed({ ctx: ctxFor(TENANT_A), eventId: "mobx_evt_999", reason: "x", now: NOW }),
    ).toEqual({ ok: false, reason: "event-not-found" });
  });
});

describe("outboxRetryDelayMs — the pure retry function", () => {
  it("computes the deterministic basis-point series", () => {
    const policy = { maxAttempts: 4, baseDelayMs: 1_000, maxDelayMs: 25_000, backoffBps: 15_000 };
    expect(outboxRetryDelayMs(policy, 1)).toBe(1_000);
    expect(outboxRetryDelayMs(policy, 2)).toBe(1_500);
    expect(outboxRetryDelayMs(policy, 3)).toBe(2_250);
    expect(outboxRetryDelayMs(policy, 4)).toBeNull();
  });
});
