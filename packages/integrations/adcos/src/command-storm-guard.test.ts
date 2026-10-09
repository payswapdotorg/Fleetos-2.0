/**
 * @fleetos/adcos — Wave 8 retry-storm protection + bounded sweep tests (F280A).
 *
 * Covers:
 *   - Delivery dedup under repeated delivery (logical-time window semantics
 *     documented AND pinned at the exact boundary); bounded memory with
 *     counted pressure eviction; fail-closed cross-tenant keying.
 *   - Dispatch rate guard: backoff enforcement (before/at eligibleAt),
 *     per-command and per-tenant rate budgets actually hit; storm
 *     simulated; tenant isolation fail-closed in BOTH directions;
 *     deterministic sliding-window prune; budget resets after the window.
 *   - Bounded expiry sweeps: at most maxPerSweep expired per call with an
 *     honest remainingDue; deterministic due ordering (expiresAt, commandId);
 *     invalid bound refused; journal chain stays verifiable after sweeps.
 */

import { describe, it, expect } from "vitest";
import {
  admitDispatchAttempt,
  emptyDeliveryDedupWindow,
  emptyDispatchRateGuard,
  expireAdcosCommandsBounded,
  observeDelivery,
  pruneDispatchRateGuard,
  sweepDeliveryDedupWindow,
  type DeliveryDedupWindow,
  type DispatchRateGuard,
  type DispatchRatePolicy,
} from "./command-storm-guard.js";
import {
  emptyCommandJournal,
  verifyCommandJournal,
  type CommandJournalState,
} from "./command-journal.js";
import {
  issueAdcosCommand,
  type IssueCommandInput,
} from "./command-lifecycle.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_globex";
const ACTOR = "edge-op";

function issueOne(
  state: CommandJournalState,
  key: string,
  at: number,
  tenantId = TENANT_A,
  expiresAt?: number,
): { state: CommandJournalState; commandId: string } {
  const input: IssueCommandInput = {
    tenantId,
    deviceId: "dev_truck-001",
    kind: "reboot",
    idempotencyKey: key,
    actor: ACTOR,
    at,
    expiresAt,
  };
  const r = issueAdcosCommand(state, input);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("issue failed");
  return { state: r.state, commandId: r.commandId };
}

// ---------------------------------------------------------------------------
// Delivery dedup window
// ---------------------------------------------------------------------------

describe("adcos command-storm-guard: delivery dedup window", () => {
  it("first delivery is recorded; a duplicate within the window replays the recorded outcome digest", () => {
    let w = emptyDeliveryDedupWindow({ windowMs: 1000, maxEntries: 16 });
    const first = observeDelivery(w, {
      tenantId: TENANT_A,
      commandId: "cmd_1",
      at: NOW,
      outcomeDigest: "out-abc",
    });
    expect(first.ok && !first.duplicate).toBe(true);
    if (first.ok && !first.duplicate) w = first.window;
    const dup = observeDelivery(w, {
      tenantId: TENANT_A,
      commandId: "cmd_1",
      at: NOW + 500,
      outcomeDigest: "out-IGNORED",
    });
    expect(dup.ok && dup.duplicate).toBe(true);
    if (dup.ok && dup.duplicate) {
      expect(dup.entry.outcomeDigest).toBe("out-abc"); // NOT re-executed — replayed
      expect(dup.entry.at).toBe(NOW);
    }
  });

  it("window boundary: a delivery at EXACTLY at + windowMs counts as first again (documented semantics)", () => {
    let w = emptyDeliveryDedupWindow({ windowMs: 1000, maxEntries: 16 });
    const first = observeDelivery(w, { tenantId: TENANT_A, commandId: "cmd_1", at: NOW, outcomeDigest: "d1" });
    if (first.ok && !first.duplicate) w = first.window;
    const atEdge = observeDelivery(w, { tenantId: TENANT_A, commandId: "cmd_1", at: NOW + 1000, outcomeDigest: "d2" });
    expect(atEdge.ok && !atEdge.duplicate).toBe(true); // stale at the boundary
    const justBefore = observeDelivery(w, { tenantId: TENANT_A, commandId: "cmd_1", at: NOW + 999, outcomeDigest: "d3" });
    expect(justBefore.ok && justBefore.duplicate).toBe(true); // still suppressed inside
  });

  it("bounded memory: pressure evicts the OLDEST entry and the eviction is COUNTED", () => {
    let w = emptyDeliveryDedupWindow({ windowMs: 10_000, maxEntries: 2 });
    for (const [id, at] of [["cmd_1", NOW], ["cmd_2", NOW + 1]] as const) {
      const r = observeDelivery(w, { tenantId: TENANT_A, commandId: id, at, outcomeDigest: `d-${id}` });
      if (r.ok && !r.duplicate) w = r.window;
    }
    expect(w.entries.size).toBe(2);
    const r = observeDelivery(w, { tenantId: TENANT_A, commandId: "cmd_3", at: NOW + 2, outcomeDigest: "d3" });
    expect(r.ok && !r.duplicate).toBe(true);
    if (r.ok && !r.duplicate) {
      expect(r.window.entries.size).toBe(2); // bounded
      expect(r.window.pressureEvicted).toBe(1); // counted — never hidden
      expect(r.window.entries.has(`${TENANT_A}|cmd_1`)).toBe(false); // oldest evicted
    }
  });

  it("cross-tenant keying is FAIL-CLOSED: the same commandId from another tenant does NOT dedup", () => {
    let w = emptyDeliveryDedupWindow({ windowMs: 1000, maxEntries: 16 });
    const a = observeDelivery(w, { tenantId: TENANT_A, commandId: "cmd_1", at: NOW, outcomeDigest: "d-a" });
    if (a.ok && !a.duplicate) w = a.window;
    const b = observeDelivery(w, { tenantId: TENANT_B, commandId: "cmd_1", at: NOW + 100, outcomeDigest: "d-b" });
    expect(b.ok && !b.duplicate).toBe(true); // separate entry — tenant separation
    if (b.ok && !b.duplicate) {
      expect(b.window.entries.size).toBe(2);
      expect(b.window.entries.get(`${TENANT_A}|cmd_1`)?.outcomeDigest).toBe("d-a");
      expect(b.window.entries.get(`${TENANT_B}|cmd_1`)?.outcomeDigest).toBe("d-b");
    }
  });

  it("missing tenant / command ids are refused (typed codes)", () => {
    const w = emptyDeliveryDedupWindow({ windowMs: 1000, maxEntries: 16 });
    const noTenant = observeDelivery(w, { tenantId: "", commandId: "cmd_1", at: NOW, outcomeDigest: "d" });
    expect(noTenant.ok).toBe(false);
    if (!noTenant.ok) expect(noTenant.reason).toBe("missing-tenant-id");
    const noCommand = observeDelivery(w, { tenantId: TENANT_A, commandId: "", at: NOW, outcomeDigest: "d" });
    expect(noCommand.ok).toBe(false);
    if (!noCommand.ok) expect(noCommand.reason).toBe("missing-command-id");
  });

  it("sweep evicts expired entries with reason dedup-window-expired (bounded memory)", () => {
    let w: DeliveryDedupWindow = emptyDeliveryDedupWindow({ windowMs: 1000, maxEntries: 16 });
    for (const [id, at] of [["cmd_1", NOW], ["cmd_2", NOW + 500]] as const) {
      const r = observeDelivery(w, { tenantId: TENANT_A, commandId: id, at, outcomeDigest: `d-${id}` });
      if (r.ok && !r.duplicate) w = r.window;
    }
    const sweep = sweepDeliveryDedupWindow(w, NOW + 1499); // cmd_1 expired; cmd_2 (exp NOW+1500) still inside
    expect(sweep.evicted.map((e) => e.entry.commandId)).toEqual(["cmd_1"]);
    expect(sweep.evicted[0]?.reason).toBe("dedup-window-expired");
    expect(sweep.window.entries.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Dispatch rate guard — retry-storm protection
// ---------------------------------------------------------------------------

describe("adcos command-storm-guard: dispatch rate guard", () => {
  const policy: DispatchRatePolicy = {
    windowMs: 1000,
    maxAttemptsPerCommandPerWindow: 3,
    maxDispatchesPerTenantPerWindow: 5,
  };

  it("a retry BEFORE the backoff ladder's nextRetryAt is refused with retry-backoff-not-elapsed", () => {
    const guard = emptyDispatchRateGuard(policy);
    const r = admitDispatchAttempt(guard, {
      tenantId: TENANT_A,
      commandId: "cmd_1",
      at: NOW + 100,
      nextRetryAt: NOW + 200, // ladder says wait until NOW+200
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("retry-backoff-not-elapsed");
      expect(r.eligibleAt).toBe(NOW + 200); // the honest eligibility
    }
  });

  it("boundary: a retry AT exactly nextRetryAt is admitted", () => {
    const guard = emptyDispatchRateGuard(policy);
    const r = admitDispatchAttempt(guard, {
      tenantId: TENANT_A,
      commandId: "cmd_1",
      at: NOW + 200,
      nextRetryAt: NOW + 200,
    });
    expect(r.ok).toBe(true);
  });

  it("per-command rate budget: the 4th attempt within one window is refused (storm hit)", () => {
    let guard: DispatchRateGuard = emptyDispatchRateGuard(policy);
    for (let i = 0; i < 3; i++) {
      const r = admitDispatchAttempt(guard, {
        tenantId: TENANT_A,
        commandId: "cmd_1",
        at: NOW + i, // same logical window
      });
      expect(r.ok).toBe(true);
      if (r.ok) guard = r.guard;
    }
    const storm = admitDispatchAttempt(guard, { tenantId: TENANT_A, commandId: "cmd_1", at: NOW + 3 });
    expect(storm.ok).toBe(false);
    if (!storm.ok) {
      expect(storm.reason).toBe("command-dispatch-rate-exceeded");
      expect(storm.windowCount).toBe(3); // honest numbers
      expect(storm.windowLimit).toBe(3);
    }
  });

  it("per-tenant budget: a fleet-wide storm is refused with tenant-dispatch-rate-exceeded", () => {
    let guard: DispatchRateGuard = emptyDispatchRateGuard(policy);
    // Five DIFFERENT commands each below the per-command cap — but together
    // they exhaust the per-tenant budget (maxDispatchesPerTenantPerWindow: 5).
    for (let i = 1; i <= 5; i++) {
      const r = admitDispatchAttempt(guard, { tenantId: TENANT_A, commandId: `cmd_${i}`, at: NOW });
      expect(r.ok).toBe(true);
      if (r.ok) guard = r.guard;
    }
    const storm = admitDispatchAttempt(guard, { tenantId: TENANT_A, commandId: "cmd_6", at: NOW });
    expect(storm.ok).toBe(false);
    if (!storm.ok) {
      expect(storm.reason).toBe("tenant-dispatch-rate-exceeded");
      expect(storm.windowCount).toBe(5);
      expect(storm.windowLimit).toBe(5);
    }
  });

  it("tenant isolation is FAIL-CLOSED both ways: tenant A's storm never locks out tenant B", () => {
    let guard: DispatchRateGuard = emptyDispatchRateGuard(policy);
    for (let i = 1; i <= 5; i++) {
      const r = admitDispatchAttempt(guard, { tenantId: TENANT_A, commandId: `cmd_${i}`, at: NOW });
      if (r.ok) guard = r.guard;
    }
    expect(admitDispatchAttempt(guard, { tenantId: TENANT_A, commandId: "cmd_a", at: NOW }).ok).toBe(false);
    const b = admitDispatchAttempt(guard, { tenantId: TENANT_B, commandId: "cmd_b", at: NOW });
    expect(b.ok).toBe(true); // B's budget untouched by A's storm
  });

  it("sliding window: the budget resets after the logical window passes (deterministic prune)", () => {
    let guard: DispatchRateGuard = emptyDispatchRateGuard(policy);
    for (let i = 1; i <= 3; i++) {
      const r = admitDispatchAttempt(guard, { tenantId: TENANT_A, commandId: "cmd_1", at: NOW });
      if (r.ok) guard = r.guard;
    }
    expect(admitDispatchAttempt(guard, { tenantId: TENANT_A, commandId: "cmd_1", at: NOW + 1 }).ok).toBe(false);
    const pruned = pruneDispatchRateGuard(guard, NOW + 1000); // window elapsed
    const fresh = admitDispatchAttempt(pruned, { tenantId: TENANT_A, commandId: "cmd_1", at: NOW + 1000 });
    expect(fresh.ok).toBe(true); // budget reset in the new window
  });

  it("missing tenant / command ids fail closed", () => {
    const guard = emptyDispatchRateGuard(policy);
    const noTenant = admitDispatchAttempt(guard, { tenantId: "", commandId: "cmd_1", at: NOW });
    expect(noTenant.ok).toBe(false);
    if (!noTenant.ok) expect(noTenant.reason).toBe("missing-tenant-id");
    const noCommand = admitDispatchAttempt(guard, { tenantId: TENANT_A, commandId: "", at: NOW });
    expect(noCommand.ok).toBe(false);
    if (!noCommand.ok) expect(noCommand.reason).toBe("missing-command-id");
  });
});

// ---------------------------------------------------------------------------
// Bounded expiry sweeps — batch sweeps with bounds
// ---------------------------------------------------------------------------

describe("adcos command-storm-guard: bounded expiry sweeps", () => {
  function fleetOfDueCommands(count: number, tenantId = TENANT_A): CommandJournalState {
    let state = emptyCommandJournal();
    for (let i = 1; i <= count; i++) {
      // expiresAt varies so the due ordering is exercised end-to-end.
      const issued = issueOne(state, `key-${i}`, NOW + i, tenantId, NOW + 10_000 + (count - i));
      state = issued.state;
    }
    return state;
  }

  it("expires at most maxPerSweep due commands and reports the honest remainingDue backlog", () => {
    const state = fleetOfDueCommands(7);
    const r = expireAdcosCommandsBounded(state, {
      tenantId: TENANT_A,
      now: NOW + 20_000, // everything is due
      actor: ACTOR,
      maxPerSweep: 3,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.expired.length).toBe(3);
      expect(r.remainingDue).toBe(4); // honest partial sweep — never hidden
      expect(verifyCommandJournal(r.state.events)).toEqual({ ok: true }); // chain intact
    }
  });

  it("due ordering is deterministic: earliest expiresAt first, commandId breaks ties", () => {
    const state = fleetOfDueCommands(6);
    const r = expireAdcosCommandsBounded(state, {
      tenantId: TENANT_A,
      now: NOW + 20_000,
      actor: ACTOR,
      maxPerSweep: 6,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Fleet built with expiresAt = NOW+10000+(count-i) — cmd issued with
      // key-1 has the LATEST deadline; key-6 the earliest.
      const byId = state.byId;
      const expected = [...byId.values()]
        .filter((rec) => rec.expiresAt !== null)
        .sort((a, b) => {
          const ea = a.expiresAt ?? 0;
          const eb = b.expiresAt ?? 0;
          return ea !== eb ? ea - eb : a.commandId < b.commandId ? -1 : 1;
        })
        .map((rec) => rec.commandId);
      expect(r.expired).toEqual(expected);
    }
  });

  it("repeated bounded sweeps drain the backlog deterministically and keep the journal verifiable", () => {
    let state = fleetOfDueCommands(5);
    const drained: string[] = [];
    const expectedPerRound = [2, 2, 1]; // 5 due, max 2 per sweep
    for (const expected of expectedPerRound) {
      const r = expireAdcosCommandsBounded(state, {
        tenantId: TENANT_A,
        now: NOW + 20_000,
        actor: ACTOR,
        maxPerSweep: 2,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.expired.length).toBe(expected);
      drained.push(...r.expired);
      state = r.state;
      expect(verifyCommandJournal(state.events)).toEqual({ ok: true });
    }
    const final = expireAdcosCommandsBounded(state, {
      tenantId: TENANT_A,
      now: NOW + 20_000,
      actor: ACTOR,
      maxPerSweep: 2,
    });
    expect(final.ok).toBe(true);
    if (final.ok) {
      expect(final.expired).toEqual([]); // backlog fully drained
      expect(final.remainingDue).toBe(0);
      expect(drained.length).toBe(5); // every due command eventually expired
    }
  });

  it("invalid sweep bound (< 1) is refused with invalid-sweep-bound", () => {
    const state = fleetOfDueCommands(2);
    const r = expireAdcosCommandsBounded(state, {
      tenantId: TENANT_A,
      now: NOW + 20_000,
      actor: ACTOR,
      maxPerSweep: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid-sweep-bound");
  });

  it("nothing due: the sweep appends NO events and expires nothing", () => {
    const state = fleetOfDueCommands(3);
    const before = state.events.length;
    const r = expireAdcosCommandsBounded(state, {
      tenantId: TENANT_A,
      now: NOW + 5_000, // before any deadline
      actor: ACTOR,
      maxPerSweep: 10,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.expired).toEqual([]);
      expect(r.remainingDue).toBe(0);
      expect(r.state.events.length).toBe(before);
    }
  });

  it("tenant-scoped: a bounded sweep only expires the sweeping tenant's commands", () => {
    // ONE journal holding both tenants' due commands.
    let shared = emptyCommandJournal();
    for (const tenant of [TENANT_A, TENANT_B]) {
      for (let i = 1; i <= 2; i++) {
        const issued = issueOne(shared, `key-${tenant}-${i}`, NOW + i, tenant, NOW + 10_000);
        shared = issued.state;
      }
    }
    const r = expireAdcosCommandsBounded(shared, {
      tenantId: TENANT_A,
      now: NOW + 20_000,
      actor: ACTOR,
      maxPerSweep: 10,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.expired.length).toBe(2); // only tenant A's commands
      const bRecords = [...r.state.byId.values()].filter((rec) => rec.tenantId === TENANT_B);
      expect(bRecords.every((rec) => rec.phase === "issued")).toBe(true); // B untouched
      expect(verifyCommandJournal(r.state.events)).toEqual({ ok: true });
    }
  });
});
