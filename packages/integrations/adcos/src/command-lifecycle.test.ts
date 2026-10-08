/**
 * @fleetos/adcos — Wave 5 command lifecycle tests (F250A).
 *
 * Covers: issue + idempotent re-issue; dispatch/ack/result/reconcile;
 * expired + dead-letter terminal paths; backoff ladder determinism;
 * fold replay == state; checkpoint resume; tenant fail-closed; audit
 * chain + journal tamper detection.
 */

import { describe, it, expect } from "vitest";
import {
  backoffLadder,
  dispatchAdcosCommand,
  expireAdcosCommands,
  issueAdcosCommand,
  acknowledgeAdcosCommand,
  reconcileAdcosCommand,
  recordAdcosDispatchFailure,
  recordAdcosResult,
} from "./command-lifecycle.js";
import {
  checkpointCommandJournal,
  emptyCommandJournal,
  foldCommandJournal,
  resumeCommandJournal,
  verifyCommandJournal,
  type CommandJournalState,
} from "./command-journal.js";
import { defaultRetryPolicy } from "./edge-adapter.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_other";
const DEVICE_1 = "dev_truck-001";
const POLICY = defaultRetryPolicy(); // maxAttempts 3, base 100, factor 2, cap 5000
const ACTOR = "actor:dispatcher-01";

function issue(state: CommandJournalState, key = "key-1", at = NOW, expiresAt?: number) {
  return issueAdcosCommand(state, {
    tenantId: TENANT_A,
    deviceId: DEVICE_1,
    kind: "connect",
    idempotencyKey: key,
    actor: ACTOR,
    at,
    expiresAt,
  });
}

function issueOk(state: CommandJournalState, key = "key-1", at = NOW, expiresAt?: number): { commandId: string; state: CommandJournalState } {
  const r = issue(state, key, at, expiresAt);
  if (!r.ok || r.duplicate) throw new Error("issue failed in fixture");
  return { commandId: r.commandId, state: r.state };
}

describe("adcos command-lifecycle: issue + idempotency", () => {
  it("issues a command into the journal with a content-addressed id", () => {
    const r = issue(emptyCommandJournal());
    expect(r.ok).toBe(true);
    if (r.ok && !r.duplicate) {
      expect(r.commandId).toMatch(/^cmd_/);
      expect(r.event.kind).toBe("issued");
      expect(r.state.byId.get(r.commandId)?.phase).toBe("issued");
    }
  });

  it("re-issuing the same idempotency key is idempotent (duplicate=true, no new event)", () => {
    const first = issueOk(emptyCommandJournal());
    const again = issue(first.state);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.duplicate).toBe(true);
      expect(again.commandId).toBe(first.commandId);
      expect(again.state.events.length).toBe(first.state.events.length);
    }
  });

  it("the same key under ANOTHER tenant is a different command (tenant-scoped dedup)", () => {
    const a = issueOk(emptyCommandJournal());
    const b = issueAdcosCommand(emptyCommandJournal(), {
      tenantId: TENANT_B, deviceId: DEVICE_1, kind: "connect",
      idempotencyKey: "key-1", actor: ACTOR, at: NOW,
    });
    expect(b.ok).toBe(true);
    if (b.ok && !b.duplicate) expect(b.commandId).not.toBe(a.commandId);
  });

  it("refuses missing tenant / device / idempotency key", () => {
    const s = emptyCommandJournal();
    expect(issueAdcosCommand(s, { tenantId: "", deviceId: DEVICE_1, kind: "connect", idempotencyKey: "k", actor: ACTOR, at: NOW })).toMatchObject({ ok: false, reason: "missing-tenant-id" });
    expect(issueAdcosCommand(s, { tenantId: TENANT_A, deviceId: "", kind: "connect", idempotencyKey: "k", actor: ACTOR, at: NOW })).toMatchObject({ ok: false, reason: "missing-device-id" });
    expect(issueAdcosCommand(s, { tenantId: TENANT_A, deviceId: DEVICE_1, kind: "connect", idempotencyKey: "", actor: ACTOR, at: NOW })).toMatchObject({ ok: false, reason: "missing-idempotency-key" });
  });

  it("refuses a deadline at or before the issue time", () => {
    const r = issueAdcosCommand(emptyCommandJournal(), {
      tenantId: TENANT_A, deviceId: DEVICE_1, kind: "connect",
      idempotencyKey: "k", actor: ACTOR, at: NOW, expiresAt: NOW,
    });
    expect(r).toMatchObject({ ok: false, reason: "invalid-deadline" });
  });
});

describe("adcos command-lifecycle: happy path + terminal paths", () => {
  it("walks issue -> dispatch -> ack -> result -> reconcile", () => {
    let s = issueOk(emptyCommandJournal()).state;
    const id = [...s.byId.keys()][0]!;
    const d = dispatchAdcosCommand(s, { tenantId: TENANT_A, commandId: id, at: NOW + 1, actor: ACTOR, policy: POLICY });
    expect(d.ok).toBe(true);
    if (d.ok) s = d.state;
    const a = acknowledgeAdcosCommand(s, { tenantId: TENANT_A, commandId: id, at: NOW + 2, requestId: "req_1", actor: ACTOR });
    expect(a.ok).toBe(true);
    if (a.ok) s = a.state;
    const r = recordAdcosResult(s, { tenantId: TENANT_A, commandId: id, at: NOW + 3, ok: true, resultDigest: "d1", actor: ACTOR });
    expect(r.ok).toBe(true);
    if (r.ok) s = r.state;
    const rec = reconcileAdcosCommand(s, { tenantId: TENANT_A, commandId: id, at: NOW + 4, actor: ACTOR });
    expect(rec.ok).toBe(true);
    if (rec.ok) {
      expect(rec.record.phase).toBe("reconciled");
      expect(rec.record.terminalAt).toBe(NOW + 4);
    }
  });

  it("refuses transitions out of order (illegal-transition / already-in-state)", () => {
    const s = issueOk(emptyCommandJournal()).state;
    const id = [...s.byId.keys()][0]!;
    expect(acknowledgeAdcosCommand(s, { tenantId: TENANT_A, commandId: id, at: NOW, requestId: "r", actor: ACTOR })).toMatchObject({ ok: false, reason: "illegal-transition" });
    expect(recordAdcosResult(s, { tenantId: TENANT_A, commandId: id, at: NOW, ok: true, resultDigest: "d", actor: ACTOR })).toMatchObject({ ok: false, reason: "illegal-transition" });
    const d = dispatchAdcosCommand(s, { tenantId: TENANT_A, commandId: id, at: NOW, actor: ACTOR, policy: POLICY });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(dispatchAdcosCommand(d.state, { tenantId: TENANT_A, commandId: id, at: NOW, actor: ACTOR, policy: POLICY })).toMatchObject({ ok: false, reason: "already-in-state" });
      expect(reconcileAdcosCommand(d.state, { tenantId: TENANT_A, commandId: id, at: NOW, actor: ACTOR })).toMatchObject({ ok: false, reason: "illegal-transition" });
    }
  });

  it("cross-tenant commandId is unknown-command (fail-closed)", () => {
    const s = issueOk(emptyCommandJournal()).state;
    const id = [...s.byId.keys()][0]!;
    expect(dispatchAdcosCommand(s, { tenantId: TENANT_B, commandId: id, at: NOW, actor: ACTOR, policy: POLICY })).toMatchObject({ ok: false, reason: "unknown-command" });
    expect(dispatchAdcosCommand(s, { tenantId: TENANT_A, commandId: "cmd_missing", at: NOW, actor: ACTOR, policy: POLICY })).toMatchObject({ ok: false, reason: "unknown-command" });
  });

  it("expires issued/dispatched commands past their deadline (deterministic order)", () => {
    let s = emptyCommandJournal();
    s = issueOk(s, "key-a", NOW, NOW + 5_000).state;
    s = issueOk(s, "key-b", NOW, NOW + 5_000).state;
    const sweep = expireAdcosCommands(s, { tenantId: TENANT_A, now: NOW + 10_000, actor: ACTOR });
    expect(sweep.expired.length).toBe(2);
    expect(sweep.expired).toEqual([...sweep.expired].sort());
    for (const id of sweep.expired) {
      expect(sweep.state.byId.get(id)?.phase).toBe("expired");
    }
    // expired is terminal
    expect(dispatchAdcosCommand(sweep.state, { tenantId: TENANT_A, commandId: sweep.expired[0]!, at: NOW + 11_000, actor: ACTOR, policy: POLICY })).toMatchObject({ ok: false, reason: "illegal-transition" });
  });

  it("does not expire commands before their deadline", () => {
    const s = issueOk(emptyCommandJournal(), "key-a", NOW, NOW + 5_000).state;
    const sweep = expireAdcosCommands(s, { tenantId: TENANT_A, now: NOW + 1, actor: ACTOR });
    expect(sweep.expired).toEqual([]);
  });

  it("permanent failure dead-letters immediately (no ladder)", () => {
    let s = issueOk(emptyCommandJournal()).state;
    const id = [...s.byId.keys()][0]!;
    s = dispatchStep(s, id, NOW + 1);
    const r = recordAdcosDispatchFailure(s, { tenantId: TENANT_A, commandId: id, at: NOW + 2, code: "device-not-found", actor: ACTOR, policy: POLICY });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.event.kind).toBe("dead-lettered");
      expect(r.record.phase).toBe("dead-letter");
      expect(r.record.deadLetterCode).toBe("device-not-found");
    }
  });

  it("transient failure climbs the backoff ladder; exhaustion dead-letters", () => {
    let s = issueOk(emptyCommandJournal()).state;
    const id = [...s.byId.keys()][0]!;
    const backoffs: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const d = dispatchAdcosCommand(s, { tenantId: TENANT_A, commandId: id, at: NOW + attempt, actor: ACTOR, policy: POLICY });
      expect(d.ok).toBe(true);
      if (!d.ok) return;
      s = d.state;
      const f = recordAdcosDispatchFailure(s, { tenantId: TENANT_A, commandId: id, at: NOW + attempt, code: "provider-unavailable", actor: ACTOR, policy: POLICY });
      expect(f.ok).toBe(true);
      if (!f.ok) return;
      s = f.state;
      if (f.event.kind === "dispatch-failed") backoffs.push(f.event.backoffMs);
    }
    expect(backoffs).toEqual([100, 200]); // the F230A ladder, deterministic; 3rd attempt exhausts
    const record = s.byId.get(id)!;
    expect(record.phase).toBe("dead-letter"); // attempts 3/3 exhausted
    expect(record.deadLetterCode).toBe("provider-unavailable");
  });

  it("retry-exhausted dispatch refusal after the ladder is spent", () => {
    let s = issueOk(emptyCommandJournal()).state;
    const id = [...s.byId.keys()][0]!;
    for (let i = 1; i <= 2; i++) {
      s = dispatchStep(s, id, NOW + i);
      const f = recordAdcosDispatchFailure(s, { tenantId: TENANT_A, commandId: id, at: NOW + i, code: "rate-limited", actor: ACTOR, policy: POLICY });
      if (f.ok) s = f.state;
    }
    // attempts = 2 of 3 — one more dispatch is allowed
    const d = dispatchAdcosCommand(s, { tenantId: TENANT_A, commandId: id, at: NOW + 3, actor: ACTOR, policy: POLICY });
    expect(d.ok).toBe(true);
    if (d.ok) {
      const f2 = recordAdcosDispatchFailure(d.state, { tenantId: TENANT_A, commandId: id, at: NOW + 3, code: "rate-limited", actor: ACTOR, policy: POLICY });
      expect(f2.ok).toBe(true);
      if (f2.ok) expect(f2.event.kind).toBe("dead-lettered");
    }
  });
});

function dispatchStep(s: CommandJournalState, id: string, at: number): CommandJournalState {
  const d = dispatchAdcosCommand(s, { tenantId: TENANT_A, commandId: id, at, actor: ACTOR, policy: POLICY });
  if (!d.ok) throw new Error("dispatch failed in fixture");
  return d.state;
}

describe("adcos command-lifecycle: fold + checkpoint + verification", () => {
  it("fold replay == state (byte-identical records)", () => {
    let s = emptyCommandJournal();
    s = issueOk(s, "key-a", NOW).state;
    s = dispatchStep(s, [...s.byId.keys()][0]!, NOW + 1);
    s = issueOk(s, "key-b", NOW + 2).state;
    const replayed = foldCommandJournal(s.events);
    expect(replayed.byId).toEqual(s.byId);
    expect(replayed.byIdempotencyKey).toEqual(s.byIdempotencyKey);
    expect(replayed.seq).toBe(s.seq);
    expect(replayed.lastAuditDigest).toBe(s.lastAuditDigest);
  });

  it("checkpoint + resume equals a full fold", () => {
    let s = issueOk(emptyCommandJournal(), "key-a", NOW).state;
    const id = [...s.byId.keys()][0]!;
    s = dispatchStep(s, id, NOW + 1);
    const checkpoint = checkpointCommandJournal(s);
    const acked = acknowledgeAdcosCommand(s, { tenantId: TENANT_A, commandId: id, at: NOW + 2, requestId: "req_9", actor: ACTOR });
    if (!acked.ok) throw new Error("ack failed in fixture");
    const resumed = resumeCommandJournal(checkpoint, acked.state.events);
    expect(resumed).toEqual(acked.state);
    expect(resumed.byId.get(id)?.phase).toBe("acknowledged");
  });

  it("verifyCommandJournal passes on a real journal and detects tampering", () => {
    let s = issueOk(emptyCommandJournal(), "key-a", NOW).state;
    const id = [...s.byId.keys()][0]!;
    s = dispatchStep(s, id, NOW + 1);
    expect(verifyCommandJournal(s.events).ok).toBe(true);

    const tamperedKind = [...s.events];
    (tamperedKind[1] as { kind: string }).kind = "acknowledged";
    expect(verifyCommandJournal(tamperedKind).ok).toBe(false);

    const tamperedAudit = s.events.map((e) => ({ ...e }));
    (tamperedAudit[0]!.audit as { digest: string }).digest = "deadbeef";
    const broken = verifyCommandJournal(tamperedAudit);
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.failures.some((f) => f.reason === "audit-chain-broken")).toBe(true);

    const reordered = [s.events[1]!, s.events[0]!];
    const seqFail = verifyCommandJournal(reordered);
    expect(seqFail.ok).toBe(false);
    if (!seqFail.ok) expect(seqFail.failures[0]?.reason).toBe("seq-out-of-order");
  });

  it("backoff ladder: transient climbs, permanent is empty, caps at maxDelayMs", () => {
    expect(backoffLadder(POLICY, "transient")).toEqual([100, 200, 400]);
    expect(backoffLadder(POLICY, "permanent")).toEqual([]);
    const longLadder = backoffLadder({ maxAttempts: 6, baseDelayMs: 1000, maxDelayMs: 4000, backoffFactor: 2 }, "transient");
    expect(longLadder).toEqual([1000, 2000, 4000, 4000, 4000, 4000]);
  });
});
