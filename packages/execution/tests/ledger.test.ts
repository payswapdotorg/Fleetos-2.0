/**
 * Execution ledger tests (F220B, Wave 2).
 *
 * Behavior under test: append-only hash chain, audit digest per entry, entry
 * verification (tamper detection), tenant fail-closed appends, deterministic
 * replay (queue view rebuilt from the ledger).
 */
import { describe, it, expect } from "vitest";
import {
  appendExecutionLedger,
  verifyExecutionLedger,
  tamperExecutionEntry,
  replayExecutionLedger,
  verifyExecutionLedgerReplayDeterminism,
  executionEntryDigest,
} from "../src/index.ts";
import type { ExecutionLedgerEntry, ExecutionLedgerKind } from "../src/index.ts";

function entry(index: number, key: string, kind: ExecutionLedgerKind, at = index * 100, detail = ""): {
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly kind: ExecutionLedgerKind;
  readonly at: number;
  readonly detail: string;
} {
  return { tenantId: "t1", idempotencyKey: key, kind, at, detail };
}

function build(entries: ReturnType<typeof entry>[]): readonly ExecutionLedgerEntry[] {
  let ledger: readonly ExecutionLedgerEntry[] = [];
  for (const e of entries) {
    const r = appendExecutionLedger(ledger, e);
    if (!r.ok) throw new Error(r.reason);
    ledger = r.ledger;
  }
  return ledger;
}

describe("ledger append", () => {
  it("appends entries with contiguous indexes and a chained previousDigest", () => {
    const ledger = build([entry(0, "k1", "submitted"), entry(1, "k1", "acked"), entry(2, "k1", "completed", 200, "succeeded")]);
    expect(ledger).toHaveLength(3);
    expect(ledger[0]!.index).toBe(0);
    expect(ledger[0]!.previousDigest).toBeNull();
    expect(ledger[1]!.previousDigest).toBe(ledger[0]!.entryDigest);
    expect(ledger[2]!.previousDigest).toBe(ledger[1]!.entryDigest);
  });

  it("every entry carries its own audit digest — deterministic over the entry fields", () => {
    const ledger = build([entry(0, "k1", "submitted", 100)]);
    const e = ledger[0]!;
    expect(e.entryDigest).toBe(
      executionEntryDigest({ previousDigest: null, tenantId: "t1", idempotencyKey: "k1", kind: "submitted", at: 100, detail: "", index: 0 }),
    );
  });

  it("refuses a missing tenant scope", () => {
    const r = appendExecutionLedger([], { tenantId: "", idempotencyKey: "k", kind: "submitted", at: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ledger.missing-tenant");
  });

  it("refuses a tenant mismatch against the chain (A8 fail-closed)", () => {
    const ledger = build([entry(0, "k1", "submitted")]);
    const r = appendExecutionLedger(ledger, { tenantId: "t2", idempotencyKey: "k2", kind: "submitted", at: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ledger.tenant-mismatch");
  });

  it("refuses a missing idempotency key and an invalid at", () => {
    expect(appendExecutionLedger([], { tenantId: "t1", idempotencyKey: "", kind: "submitted", at: 1 }).ok).toBe(false);
    expect(appendExecutionLedger([], { tenantId: "t1", idempotencyKey: "k", kind: "submitted", at: -1 }).ok).toBe(false);
    expect(appendExecutionLedger([], { tenantId: "t1", idempotencyKey: "k", kind: "submitted", at: 1.5 }).ok).toBe(false);
  });

  it("refuses an explicit index that does not equal the next position", () => {
    expect(appendExecutionLedger([], { tenantId: "t1", idempotencyKey: "k", kind: "submitted", at: 1, index: 5 }).ok).toBe(false);
    const ledger = build([entry(0, "k1", "submitted")]);
    const ok = appendExecutionLedger(ledger, { tenantId: "t1", idempotencyKey: "k", kind: "submitted", at: 2, index: 1 });
    expect(ok.ok).toBe(true);
  });
});

describe("ledger verification (tamper detection, law A19)", () => {
  it("verifies a healthy chain", () => {
    const ledger = build([
      entry(0, "k1", "submitted"),
      entry(1, "k1", "acked"),
      entry(2, "k1", "completed", 200, "succeeded"),
      entry(3, "k2", "submitted", 300),
    ]);
    const v = verifyExecutionLedger(ledger);
    expect(v.verified).toBe(true);
    expect(v.checkedEntries).toBe(4);
    expect(v.reason).toBeNull();
  });

  it("verifies an empty chain as trivially true", () => {
    const v = verifyExecutionLedger([]);
    expect(v.verified).toBe(true);
    expect(v.checkedEntries).toBe(0);
  });

  it("detects a tampered detail (entry digest mismatch)", () => {
    const ledger = build([entry(0, "k1", "submitted", 100), entry(1, "k1", "acked", 200)]);
    const tampered = tamperExecutionEntry(ledger, 1, "tampered-detail");
    const v = verifyExecutionLedger(tampered);
    expect(v.verified).toBe(false);
    expect(v.brokenAt).toBe(1);
    if (v.reason) expect(v.reason).toBe("ledger.entry_digest_mismatch");
  });

  it("detects a broken previous-digest link", () => {
    const ledger = build([entry(0, "k1", "submitted"), entry(1, "k1", "acked")]);
    const broken: readonly ExecutionLedgerEntry[] = ledger.map((e) =>
      e.index === 1 ? { ...e, previousDigest: "deadbeef" } : e,
    );
    const v = verifyExecutionLedger(broken);
    expect(v.verified).toBe(false);
    if (v.reason) expect(v.reason).toBe("ledger.previous_digest_mismatch");
  });

  it("detects a first entry that wrongly carries a previous digest", () => {
    const ledger = build([entry(0, "k1", "submitted")]);
    const broken: readonly ExecutionLedgerEntry[] = [{ ...ledger[0]!, previousDigest: "deadbeef" }];
    const v = verifyExecutionLedger(broken);
    expect(v.verified).toBe(false);
    if (v.reason) expect(v.reason).toBe("ledger.first_entry_has_previous");
  });

  it("detects an index gap", () => {
    const ledger = build([entry(0, "k1", "submitted"), entry(1, "k1", "acked")]);
    const broken: readonly ExecutionLedgerEntry[] = [{ ...ledger[1]!, index: 3 }];
    const v = verifyExecutionLedger(broken);
    expect(v.verified).toBe(false);
    if (v.reason) expect(v.reason).toBe("ledger.index_gap");
  });

  it("detects a mid-chain tenant swap", () => {
    const ledger = build([entry(0, "k1", "submitted"), entry(1, "k1", "acked")]);
    const broken: readonly ExecutionLedgerEntry[] = ledger.map((e) =>
      e.index === 1 ? { ...e, tenantId: "t2" } : e,
    );
    const v = verifyExecutionLedger(broken);
    expect(v.verified).toBe(false);
    if (v.reason) expect(v.reason).toBe("ledger.tenant_mismatch");
  });
});

describe("ledger replay — the queue view rebuilt deterministically", () => {
  it("replays a submit/ack/complete lifecycle to the completed view", () => {
    const ledger = build([
      entry(0, "k1", "submitted", 100),
      entry(1, "k1", "acked", 150),
      entry(2, "k1", "completed", 200, "succeeded"),
    ]);
    const r = replayExecutionLedger(ledger);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.commands).toHaveLength(1);
      expect(r.commands[0]!.status).toBe("completed");
      expect(r.commands[0]!.attempts).toBe(1);
      expect(r.commands[0]!.lastKind).toBe("completed");
    }
  });

  it("replays retries: attempts increment and the command re-queues", () => {
    const ledger = build([
      entry(0, "k1", "submitted", 100),
      entry(1, "k1", "acked", 110),
      entry(2, "k1", "retried", 120, "device busy"),
      entry(3, "k1", "acked", 2_320),
    ]);
    const r = replayExecutionLedger(ledger);
    if (!r.ok) throw new Error(String(r.reason));
    expect(r.commands[0]!.attempts).toBe(2);
    expect(r.commands[0]!.status).toBe("in-flight");
    expect(r.commands[0]!.lastFailureReason).toBe("device busy");
  });

  it("replays dead-lettering with the preserved failure reason", () => {
    const ledger = build([
      entry(0, "k1", "submitted", 100),
      entry(1, "k1", "acked", 110),
      entry(2, "k1", "dead-lettered", 120, "exhausted retries"),
    ]);
    const r = replayExecutionLedger(ledger);
    if (!r.ok) throw new Error(String(r.reason));
    expect(r.commands[0]!.status).toBe("dead-lettered");
    expect(r.commands[0]!.lastFailureReason).toBe("exhausted retries");
  });

  it("replays multiple commands sorted by idempotencyKey (deterministic iteration)", () => {
    const ledger = build([
      entry(0, "z-key", "submitted", 100),
      entry(1, "a-key", "submitted", 100),
      entry(2, "z-key", "acked", 110),
    ]);
    const r = replayExecutionLedger(ledger);
    if (!r.ok) throw new Error(String(r.reason));
    expect(r.commands.map((c) => c.idempotencyKey)).toEqual(["a-key", "z-key"]);
  });

  it("replay is deterministic — two replays are byte-identical (machine-tested)", () => {
    const ledger = build([
      entry(0, "k1", "submitted", 100),
      entry(1, "k1", "acked", 110),
      entry(2, "k1", "retried", 120, "x"),
      entry(3, "k2", "submitted", 130),
      entry(4, "k2", "dead-lettered", 140, "y"),
    ]);
    expect(verifyExecutionLedgerReplayDeterminism(ledger).deterministic).toBe(true);
    const a = replayExecutionLedger(ledger);
    const b = replayExecutionLedger(ledger);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("replay refuses a ledger whose events appear without a submit (broken stream)", () => {
    const ledger = build([entry(0, "k1", "acked", 100)]);
    const r = replayExecutionLedger(ledger);
    expect(r.ok).toBe(false);
  });

  it("replay refuses a mixed-tenant ledger (A8)", () => {
    const ledger = build([entry(0, "k1", "submitted", 100)]);
    // Hand-build a t2 entry to simulate a corrupted cross-tenant append.
    const corrupted: readonly ExecutionLedgerEntry[] = [...ledger, {
      index: 1,
      tenantId: "t2",
      idempotencyKey: "k1",
      kind: "acked",
      at: 110,
      detail: "",
      previousDigest: ledger[0]!.entryDigest,
      entryDigest: "x",
    }];
    const r = replayExecutionLedger(corrupted);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ledger.tenant_mismatch");
  });
});
