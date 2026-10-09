/**
 * @fleetos/adcos — Wave 8 journal compaction SAFE mode tests (F280A).
 *
 * Covers:
 *   - Fail-closed compaction: invalid cutoff; non-terminal commands in the
 *     prefix are REFUSED with their ids surfaced.
 *   - The compacted journal verifies with the SAME digest chain semantics
 *     (the full journal's own verifier + the compaction anchor).
 *   - Tamper evidence: forged anchor, mutated retained audit digest,
 *     dropped retained event (seq hole), tampered checkpoint summary.
 *   - Chain prefix invariance + state equivalence: appending identical new
 *     events to the full journal and to the compacted journal yields the
 *     identical final chain digest and identical live state projections.
 *   - Idempotency-key dedup SURVIVES compaction (and stays tenant-scoped).
 *   - cutoff=0 no-op compaction; full-journal cutoff (retained empty).
 */

import { describe, it, expect } from "vitest";
import {
  compactCommandJournal,
  liveStateFromCompacted,
  resumeFromCompacted,
  verifyCompactedCommandJournal,
} from "./journal-compaction.js";
import {
  emptyCommandJournal,
  foldCommandJournal,
  verifyCommandJournal,
  type CommandJournalEvent,
  type CommandJournalState,
} from "./command-journal.js";
import {
  acknowledgeAdcosCommand,
  dispatchAdcosCommand,
  issueAdcosCommand,
  reconcileAdcosCommand,
  recordAdcosResult,
  type IssueCommandInput,
} from "./command-lifecycle.js";
import type { EdgeAdcosRetryPolicy } from "./edge-adapter.js";

const NOW = 1_727_000_000_000;
const TENANT_A = "tnt_acme";
const TENANT_B = "tnt_globex";
const ACTOR = "edge-op";
const POLICY: EdgeAdcosRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 400,
  backoffFactor: 2,
};

function issue(state: CommandJournalState, key: string, at: number, tenantId = TENANT_A): {
  state: CommandJournalState;
  commandId: string;
} {
  const input: IssueCommandInput = {
    tenantId,
    deviceId: "dev_truck-001",
    kind: "reboot",
    idempotencyKey: key,
    actor: ACTOR,
    at,
  };
  const r = issueAdcosCommand(state, input);
  if (!r.ok) throw new Error("issue failed");
  return { state: r.state, commandId: r.commandId };
}

/** Drive one command through the full lifecycle to a TERMINAL (reconciled) phase. */
function completeCommand(state: CommandJournalState, key: string, at: number, tenantId = TENANT_A): CommandJournalState {
  let s = issue(state, key, at, tenantId).state;
  const commandId = [...s.byId.keys()].find((id) => s.byId.get(id)?.idempotencyKey === key)!;
  s = dispatchOk(s, commandId, at + 1);
  const ack = acknowledgeAdcosCommand(s, { tenantId, commandId, at: at + 2, requestId: `req-${key}`, actor: ACTOR });
  if (!ack.ok) throw new Error("ack failed");
  s = ack.state;
  const res = recordAdcosResult(s, { tenantId, commandId, at: at + 3, ok: true, resultDigest: `res-${key}`, actor: ACTOR });
  if (!res.ok) throw new Error("result failed");
  s = res.state;
  const rec = reconcileAdcosCommand(s, { tenantId, commandId, at: at + 4, actor: ACTOR });
  if (!rec.ok) throw new Error("reconcile failed");
  return rec.state;
}

function dispatchOk(state: CommandJournalState, commandId: string, at: number, tenantId = TENANT_A): CommandJournalState {
  const r = dispatchAdcosCommand(state, { tenantId, commandId, at, actor: ACTOR, policy: POLICY });
  if (!r.ok) throw new Error("dispatch failed");
  return r.state;
}

/** A journal with N terminal commands (5 events each) + one LIVE issued command. */
function mixedJournal(terminalCount: number): { state: CommandJournalState; liveCommandId: string } {
  let state = emptyCommandJournal();
  for (let i = 1; i <= terminalCount; i++) {
    state = completeCommand(state, `key-${i}`, NOW + i * 100);
  }
  const live = issue(state, "key-live", NOW + 100_000);
  return { state: live.state, liveCommandId: live.commandId };
}

// ---------------------------------------------------------------------------
// Fail-closed compaction refusals
// ---------------------------------------------------------------------------

describe("adcos journal-compaction: fail-closed refusals", () => {
  it("refuses invalid cutoff (negative / beyond seq / non-integer)", () => {
    const { state } = mixedJournal(2);
    expect(compactCommandJournal(state, { cutoffSeq: -1, compactedAt: NOW }).ok).toBe(false);
    expect(compactCommandJournal(state, { cutoffSeq: state.seq + 1, compactedAt: NOW }).ok).toBe(false);
    expect(compactCommandJournal(state, { cutoffSeq: 1.5, compactedAt: NOW }).ok).toBe(false);
    const r = compactCommandJournal(state, { cutoffSeq: -1, compactedAt: NOW });
    if (!r.ok) expect(r.reason).toBe("invalid-cutoff");
  });

  it("refuses non-terminal commands in the prefix and SURFACES their ids", () => {
    // 2 terminal commands (10 events) + a LIVE issued command at the end.
    const { state, liveCommandId } = mixedJournal(2);
    // Cutoff covers the live command's issued event -> non-terminal.
    const r = compactCommandJournal(state, { cutoffSeq: state.seq, compactedAt: NOW });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("non-terminal-in-prefix");
      expect(r.offendingCommandIds).toEqual([liveCommandId]);
    }
  });

  it("cutoff exactly at the boundary BEFORE the live command compacts safely", () => {
    const { state } = mixedJournal(2);
    const terminalEvents = state.seq - 1; // live command has 1 event (issued)
    const r = compactCommandJournal(state, { cutoffSeq: terminalEvents, compactedAt: NOW });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SAFE compaction + verification with the same chain semantics
// ---------------------------------------------------------------------------

describe("adcos journal-compaction: SAFE compaction verifies identically", () => {
  it("compacts a fully-terminal prefix; stats are exact; retained bytes unchanged", () => {
    let state = emptyCommandJournal();
    for (let i = 1; i <= 3; i++) state = completeCommand(state, `key-${i}`, NOW + i * 100);
    const cutoff = state.seq; // everything is terminal
    const r = compactCommandJournal(state, { cutoffSeq: cutoff, compactedAt: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.compacted;
    expect(c.stats.removedEvents).toBe(15); // 3 commands × 5 events
    expect(c.stats.retainedEvents).toBe(0);
    expect(c.stats.terminalCommands).toBe(3);
    expect(c.retained).toEqual([]);
    expect(c.cutoffSeq).toBe(cutoff);
    expect(verifyCompactedCommandJournal(c)).toEqual({ ok: true });
  });

  it("retained suffix bytes are UNCHANGED from the full journal", () => {
    const { state } = mixedJournal(2); // 11 events: 10 terminal + 1 live issued
    const r = compactCommandJournal(state, { cutoffSeq: 10, compactedAt: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const retainedInFull = state.events.filter((e) => e.seq > 10);
    expect(r.compacted.retained).toEqual(retainedInFull); // byte-identical
  });

  it("partial compaction: live command's events are retained and the anchor chains them", () => {
    const { state, liveCommandId } = mixedJournal(2);
    const r = compactCommandJournal(state, { cutoffSeq: 10, compactedAt: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.compacted;
    expect(c.retained.map((e) => e.kind)).toEqual(["issued"]);
    expect(c.retained[0]?.commandId).toBe(liveCommandId);
    // The anchor is the chain root of the removed prefix — the retained
    // event's digest still verifies against it (same chain rule).
    expect(verifyCompactedCommandJournal(c)).toEqual({ ok: true });
    // And the LIVE state after compaction carries the live command forward.
    const live = liveStateFromCompacted(c);
    expect(live.byId.get(liveCommandId)?.phase).toBe("issued");
  });

  it("forged anchor breaks the chain (audit-chain-broken) — the anchor is verifiable", () => {
    const { state } = mixedJournal(2);
    const r = compactCommandJournal(state, { cutoffSeq: 10, compactedAt: NOW });
    if (!r.ok) return;
    const forged = { ...r.compacted, anchor: "adcos:command-journal:genesis" }; // wrong root
    const v = verifyCompactedCommandJournal(forged);
    expect(v.ok).toBe(false);
    if (!v.ok && v.kind === "chain") {
      expect(v.failures[0]?.reason).toBe("audit-chain-broken");
    }
  });

  it("mutating a retained event's audit digest breaks the chain", () => {
    const { state } = mixedJournal(2);
    const r = compactCommandJournal(state, { cutoffSeq: 10, compactedAt: NOW });
    if (!r.ok) return;
    const [first, ...rest] = r.compacted.retained;
    if (!first) return;
    const tampered: CommandJournalEvent = {
      ...first,
      audit: { ...first.audit, digest: `${first.audit.digest.slice(0, 8)}0`.padEnd(64, "0") },
    };
    const v = verifyCompactedCommandJournal({ ...r.compacted, retained: [tampered, ...rest] });
    expect(v.ok).toBe(false);
    if (!v.ok && v.kind === "chain") {
      expect(v.failures.some((f) => f.reason === "audit-chain-broken")).toBe(true);
    }
  });

  it("dropping a retained event (seq hole) fails with seq-out-of-order", () => {
    // A journal with TWO live commands after the cutoff: dropping the first
    // retained event leaves a seq hole the verifier must catch.
    let state = emptyCommandJournal();
    state = completeCommand(state, "key-1", NOW);
    const liveA = issue(state, "key-live-a", NOW + 1000);
    const liveB = issue(liveA.state, "key-live-b", NOW + 1100);
    const cutoff = state.seq;
    const r = compactCommandJournal(liveB.state, { cutoffSeq: cutoff, compactedAt: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hole = r.compacted.retained.slice(1); // drop seq = cutoff+1
    const v = verifyCompactedCommandJournal({ ...r.compacted, retained: hole });
    expect(v.ok).toBe(false);
    if (!v.ok && v.kind === "chain") {
      expect(v.failures[0]?.reason).toBe("seq-out-of-order");
    }
  });

  it("tampering the checkpoint's command records fails summary-mismatch", () => {
    const { state } = mixedJournal(2);
    const r = compactCommandJournal(state, { cutoffSeq: 10, compactedAt: NOW });
    if (!r.ok) return;
    const byId = new Map(r.compacted.checkpoint.state.byId);
    const someId = byId.keys().next().value;
    if (someId === undefined) return;
    const rec = byId.get(someId)!;
    byId.set(someId, { ...rec, terminalAt: (rec.terminalAt ?? 0) + 1 }); // forged record
    const tampered = {
      ...r.compacted,
      checkpoint: {
        ...r.compacted.checkpoint,
        state: { ...r.compacted.checkpoint.state, byId },
      },
    };
    const v = verifyCompactedCommandJournal(tampered);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.kind).toBe("summary-mismatch");
  });
});

// ---------------------------------------------------------------------------
// Chain prefix invariance + state equivalence (THE SAFE property)
// ---------------------------------------------------------------------------

describe("adcos journal-compaction: prefix invariance + state equivalence", () => {
  it("appending identical new events to full vs compacted yields the IDENTICAL final chain digest", () => {
    // Full journal: 2 terminal commands + 1 live command; compact at 10.
    const { state, liveCommandId } = mixedJournal(2);
    const r = compactCommandJournal(state, { cutoffSeq: 10, compactedAt: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Drive the live command to terminal on BOTH branches with IDENTICAL
    // inputs — the events must byte-match, so the appended events list is
    // literally the same.
    const driveTerminal = (s: CommandJournalState): CommandJournalState => {
      let out = dispatchOk(s, liveCommandId, NOW + 100_001);
      const ack = acknowledgeAdcosCommand(out, { tenantId: TENANT_A, commandId: liveCommandId, at: NOW + 100_002, requestId: "req-live", actor: ACTOR });
      if (!ack.ok) throw new Error("ack failed");
      out = ack.state;
      const res = recordAdcosResult(out, { tenantId: TENANT_A, commandId: liveCommandId, at: NOW + 100_003, ok: true, resultDigest: "res-live", actor: ACTOR });
      if (!res.ok) throw new Error("result failed");
      out = res.state;
      const rec = reconcileAdcosCommand(out, { tenantId: TENANT_A, commandId: liveCommandId, at: NOW + 100_004, actor: ACTOR });
      if (!rec.ok) throw new Error("reconcile failed");
      return rec.state;
    };

    const fullFinal = driveTerminal(state);
    const appendedEvents = fullFinal.events.filter((e) => e.seq > 10);
    const compactFinal = resumeFromCompacted(r.compacted, appendedEvents);

    // THE SAFE PROPERTY: identical final chain digest + identical projections.
    expect(compactFinal.lastAuditDigest).toBe(fullFinal.lastAuditDigest);
    expect(compactFinal.seq).toBe(fullFinal.seq);
    expect(compactFinal.byId).toEqual(fullFinal.byId);
    expect(compactFinal.byIdempotencyKey).toEqual(fullFinal.byIdempotencyKey);
    // Both journals verify: the full one directly, the compacted one via its anchor.
    expect(verifyCommandJournal(fullFinal.events)).toEqual({ ok: true });
    expect(verifyCompactedCommandJournal(r.compacted)).toEqual({ ok: true });
  });

  it("the compacted checkpoint folds the retained suffix to the live state (fold equivalence)", () => {
    const { state } = mixedJournal(2);
    const r = compactCommandJournal(state, { cutoffSeq: 10, compactedAt: NOW });
    if (!r.ok) return;
    const live = liveStateFromCompacted(r.compacted);
    expect(live.seq).toBe(state.seq);
    expect(live.lastAuditDigest).toBe(state.lastAuditDigest);
    expect(live.byId).toEqual(state.byId);
    expect(live.byIdempotencyKey).toEqual(state.byIdempotencyKey);
    // Memory bound: the live state after compaction carries ONLY retained events.
    expect(live.events.length).toBe(1);
    expect(state.events.length).toBe(11);
  });

  it("idempotency-key dedup SURVIVES compaction — re-issue returns the EXISTING command", () => {
    let state = emptyCommandJournal();
    state = completeCommand(state, "key-1", NOW); // 5 events, terminal
    const r = compactCommandJournal(state, { cutoffSeq: 5, compactedAt: NOW });
    if (!r.ok) return;
    const live = liveStateFromCompacted(r.compacted);
    const reissue = issueAdcosCommand(live, {
      tenantId: TENANT_A,
      deviceId: "dev_truck-001",
      kind: "reboot",
      idempotencyKey: "key-1", // SAME key as the compacted-away command
      actor: ACTOR,
      at: NOW + 50,
    });
    expect(reissue.ok).toBe(true);
    if (reissue.ok) {
      expect(reissue.duplicate).toBe(true); // dedup index preserved across compaction
      expect(reissue.commandId).toBe(state.byId.values().next().value?.commandId);
    }
  });

  it("post-compaction idempotency stays TENANT-SCOPED (cross-tenant same key issues a NEW command)", () => {
    let state = emptyCommandJournal();
    state = completeCommand(state, "key-1", NOW); // tenant A command
    const r = compactCommandJournal(state, { cutoffSeq: 5, compactedAt: NOW });
    if (!r.ok) return;
    const live = liveStateFromCompacted(r.compacted);
    const foreign = issueAdcosCommand(live, {
      tenantId: TENANT_B, // different tenant, SAME idempotency key
      deviceId: "dev_pump-002",
      kind: "reboot",
      idempotencyKey: "key-1",
      actor: ACTOR,
      at: NOW + 50,
    });
    expect(foreign.ok).toBe(true);
    if (foreign.ok) {
      expect(foreign.duplicate).toBe(false); // fail-closed tenant separation
      expect(foreign.state.byIdempotencyKey.get(`${TENANT_B}|key-1`)).toBe(foreign.commandId);
    }
  });

  it("cutoff 0 is a well-defined no-op: anchor = genesis, retained = everything", () => {
    const { state } = mixedJournal(1);
    const r = compactCommandJournal(state, { cutoffSeq: 0, compactedAt: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compacted.anchor).toBe("adcos:command-journal:genesis");
    expect(r.compacted.retained.length).toBe(state.events.length);
    expect(r.compacted.stats.removedEvents).toBe(0);
    expect(verifyCompactedCommandJournal(r.compacted)).toEqual({ ok: true });
  });

  it("fold(full journal) equals the original state the compaction consumed", () => {
    const { state } = mixedJournal(3);
    const refold = foldCommandJournal(state.events);
    expect(refold.byId).toEqual(state.byId);
    expect(refold.lastAuditDigest).toBe(state.lastAuditDigest);
    expect(refold.seq).toBe(state.seq);
  });
});
