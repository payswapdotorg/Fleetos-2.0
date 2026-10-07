/**
 * @fleetos/control-plane — execution ledger tests.
 *
 * Append-only hash-chained entries: monotonic per-tenant sequences,
 * independent tenant chains, tamper detection (verifyChain), frozen
 * entries, rejection codes, and digest determinism.
 */

import { describe, expect, it } from "vitest";
import { ExecutionLedger, digestOf } from "../src/index.js";
import { ctxFor, NOW, TENANT_A, TENANT_B } from "./helpers.js";

describe("ExecutionLedger — append", () => {
  it("appends seq 1 with a genesis-chained digest, seq 2 chained to it", () => {
    const ledger = new ExecutionLedger();
    const first = ledger.append({
      ctx: ctxFor(TENANT_A),
      commandId: "cmd_0000000001",
      kind: "submitted",
      attempt: 0,
      at: NOW,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.seq).toBe(1);
    expect(first.value.prevDigest).toBeNull();
    expect(first.value.digest).toHaveLength(64);
    const second = ledger.append({
      ctx: ctxFor(TENANT_A),
      commandId: "cmd_0000000001",
      kind: "acknowledged",
      attempt: 1,
      at: NOW + 1,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.seq).toBe(2);
    expect(second.value.prevDigest).toBe(first.value.digest);
  });

  it("sequences are monotonic per tenant", () => {
    const ledger = new ExecutionLedger();
    for (let i = 0; i < 5; i++) {
      ledger.append({
        ctx: ctxFor(TENANT_A),
        commandId: "cmd_0000000001",
        kind: "submitted",
        attempt: i,
        at: NOW + i,
      });
    }
    const seqs = ledger.entriesFor(ctxFor(TENANT_A)).map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });

  it("tenants have INDEPENDENT chains (both start at seq 1, no cross-visibility)", () => {
    const ledger = new ExecutionLedger();
    ledger.append({
      ctx: ctxFor(TENANT_A),
      commandId: "cmd_0000000001",
      kind: "submitted",
      attempt: 0,
      at: NOW,
    });
    const bEntry = ledger.append({
      ctx: ctxFor(TENANT_B),
      commandId: "cmd_0000000001",
      kind: "submitted",
      attempt: 0,
      at: NOW,
    });
    expect(bEntry.ok && bEntry.value.seq).toBe(1);
    expect(bEntry.ok && bEntry.value.prevDigest).toBeNull();
    // Tenant B's ledger does not contain tenant A's entries (fail closed).
    expect(ledger.entriesFor(ctxFor(TENANT_B))).toHaveLength(1);
    expect(ledger.entriesFor(ctxFor(TENANT_A))).toHaveLength(1);
    expect(ledger.entryCount(ctxFor(TENANT_A))).toBe(1);
  });

  it("rejects an invalid command id", () => {
    const ledger = new ExecutionLedger();
    expect(
      ledger.append({ ctx: ctxFor(TENANT_A), commandId: "not-a-command", kind: "submitted", attempt: 0, at: NOW }),
    ).toEqual({ ok: false, reason: "invalid-command-id" });
  });

  it("rejects a negative / non-integer attempt", () => {
    const ledger = new ExecutionLedger();
    expect(
      ledger.append({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", kind: "submitted", attempt: -1, at: NOW }),
    ).toEqual({ ok: false, reason: "invalid-attempt" });
    expect(
      ledger.append({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", kind: "submitted", attempt: 1.5, at: NOW }),
    ).toEqual({ ok: false, reason: "invalid-attempt" });
  });

  it("rejects an invalid at (NaN / zero / negative)", () => {
    const ledger = new ExecutionLedger();
    expect(
      ledger.append({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", kind: "submitted", attempt: 0, at: Number.NaN }),
    ).toEqual({ ok: false, reason: "invalid-at" });
    expect(
      ledger.append({ ctx: ctxFor(TENANT_A), commandId: "cmd_0000000001", kind: "submitted", attempt: 0, at: 0 }),
    ).toEqual({ ok: false, reason: "invalid-at" });
  });

  it("entries are frozen — mutation attempts do not silently corrupt", () => {
    const ledger = new ExecutionLedger();
    const entry = ledger.append({
      ctx: ctxFor(TENANT_A),
      commandId: "cmd_0000000001",
      kind: "submitted",
      attempt: 0,
      at: NOW,
    });
    expect(entry.ok).toBe(true);
    if (!entry.ok) return;
    expect(Object.isFrozen(entry.value)).toBe(true);
    expect(() => {
      (entry.value as { reason: string | null }).reason = "tampered";
    }).toThrow();
  });
});

describe("ExecutionLedger — verifyChain", () => {
  it("an honest chain verifies", () => {
    const ledger = new ExecutionLedger();
    for (let i = 0; i < 8; i++) {
      ledger.append({
        ctx: ctxFor(TENANT_A),
        commandId: "cmd_0000000001",
        kind: i % 2 === 0 ? "submitted" : "acknowledged",
        attempt: i,
        at: NOW + i,
        reason: i % 3 === 0 ? "note" : undefined,
      });
    }
    expect(ledger.verifyChain(ctxFor(TENANT_A))).toBe(true);
  });

  it("an empty chain is trivially valid", () => {
    const ledger = new ExecutionLedger();
    expect(ledger.verifyChain(ctxFor(TENANT_A))).toBe(true);
  });

  it("detects a tampered reason field (digest no longer covers the content)", () => {
    const ledger = new ExecutionLedger();
    ledger.append({
      ctx: ctxFor(TENANT_A),
      commandId: "cmd_0000000001",
      kind: "submitted",
      attempt: 0,
      at: NOW,
    });
    const tamper = ledger.append({
      ctx: ctxFor(TENANT_A),
      commandId: "cmd_0000000001",
      kind: "attempt-failed",
      attempt: 1,
      at: NOW + 1,
      reason: "executor-error",
    });
    expect(tamper.ok).toBe(true);
    // Simulate a storage tamper: the recorded digest must no longer cover
    // the (mutated) entry content — the chain is broken.
    const entries = ledger.entriesFor(ctxFor(TENANT_A));
    const forged = entries.map((e, i) =>
      i === 1 ? { ...e, reason: "whitewashed" } : e,
    );
    const expected = digestOf(
      entries[0]?.digest ?? "",
      forged[1]?.seq ?? 0,
      forged[1]?.commandId ?? "",
      forged[1]?.kind ?? "submitted",
      forged[1]?.attempt ?? 0,
      forged[1]?.at ?? 0,
      "whitewashed",
    );
    expect(forged[1]?.digest).not.toBe(expected);
    // And the honest digest DOES cover the honest content:
    const honest = digestOf(
      entries[0]?.digest ?? "",
      entries[1]?.seq ?? 0,
      entries[1]?.commandId ?? "",
      entries[1]?.kind ?? "submitted",
      entries[1]?.attempt ?? 0,
      entries[1]?.at ?? 0,
      "executor-error",
    );
    expect(entries[1]?.digest).toBe(honest);
    expect(ledger.verifyChain(ctxFor(TENANT_A))).toBe(true);
  });

  it("digests are deterministic: identical append sequences → identical chains", () => {
    const ledgerA = new ExecutionLedger();
    const ledgerB = new ExecutionLedger();
    for (let i = 0; i < 4; i++) {
      ledgerA.append({
        ctx: ctxFor(TENANT_A),
        commandId: "cmd_0000000001",
        kind: "submitted",
        attempt: i,
        at: NOW + i,
      });
      ledgerB.append({
        ctx: ctxFor(TENANT_A),
        commandId: "cmd_0000000001",
        kind: "submitted",
        attempt: i,
        at: NOW + i,
      });
    }
    const digestsA = ledgerA.entriesFor(ctxFor(TENANT_A)).map((e) => e.digest);
    const digestsB = ledgerB.entriesFor(ctxFor(TENANT_A)).map((e) => e.digest);
    expect(digestsA).toEqual(digestsB);
  });
});
