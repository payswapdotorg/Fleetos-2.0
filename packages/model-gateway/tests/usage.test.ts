/**
 * @fleetos/model-gateway — F230C usage-accounting tests: append-only
 * ledger, chained digests, BudgetCheckPort seam, idempotency.
 */
import { describe, expect, it } from "vitest";
import {
  appendUsage,
  sumUsageLedger,
  usageEntryDigest,
  verifyUsageLedgerChain,
  type BudgetCheckPort,
  type UsageLedgerEntry,
} from "../src/index.js";

/** Local test double for the BudgetCheckPort TYPE seam. */
function makePort(
  decisions: Readonly<Record<string, { ok: true; remainingUnits: number; remainingSpendMinor: number } | { ok: false; reasonCode: string }>>,
): BudgetCheckPort {
  return {
    check(input) {
      const key = `${input.tenantId}|${input.agentId}|${input.capability}|${input.unitsRequested}|${input.spendRequestedMinor}`;
      const decision = decisions[key];
      if (decision) return decision;
      return { ok: true, remainingUnits: 1000000, remainingSpendMinor: 1000000 };
    },
  };
}

const ALWAYS_OK_PORT: BudgetCheckPort = makePort({});

function usageInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "acme",
    agentId: "agent-1",
    requestRef: "req-1",
    modelId: "model-x",
    providerId: "prov-a",
    capability: "model_invoke",
    units: 500,
    costMinor: 2000,
    at: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Appending.
// ---------------------------------------------------------------------------

describe("appendUsage", () => {
  it("appends the first entry with seq 1, genesis prevDigest and a usage_ digest", () => {
    const result = appendUsage([], ALWAYS_OK_PORT, usageInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.appended.seq).toBe(1);
      expect(result.appended.prevDigest).toBeNull();
      expect(result.appended.digest).toMatch(/^usage_[0-9a-f]{8}$/);
      expect(result.ledger.length).toBe(1);
    }
  });

  it("chains subsequent entries to their predecessor and assigns seqs", () => {
    const first = appendUsage([], ALWAYS_OK_PORT, usageInput());
    if (!first.ok) throw new Error("first append failed");
    const second = appendUsage(first.ledger, ALWAYS_OK_PORT, usageInput({ requestRef: "req-2", units: 100 }));
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.appended.seq).toBe(2);
      expect(second.appended.prevDigest).toBe(first.appended.digest);
    }
  });

  it("never mutates the input ledger (append-only, pure)", () => {
    const first = appendUsage([], ALWAYS_OK_PORT, usageInput());
    if (!first.ok) throw new Error("first append failed");
    const before = first.ledger.length;
    appendUsage(first.ledger, ALWAYS_OK_PORT, usageInput({ requestRef: "req-2" }));
    expect(first.ledger.length).toBe(before);
  });

  it("refuses a duplicate requestRef with the conflicting seq (idempotency — retries never double-charge)", () => {
    const first = appendUsage([], ALWAYS_OK_PORT, usageInput());
    if (!first.ok) throw new Error("first append failed");
    const retry = appendUsage(first.ledger, ALWAYS_OK_PORT, usageInput());
    expect(retry.ok).toBe(false);
    if (!retry.ok) {
      expect(retry.reasonCode).toBe("DUPLICATE_REQUEST_REF");
      expect(retry.conflictingSeq).toBe(1);
    }
  });

  it("propagates the org budget refusal with BUDGET_REFUSED_BY_ORG — never a silent drop", () => {
    const port = makePort({
      "acme|agent-1|model_invoke|500|2000": { ok: false, reasonCode: "SPEND_EXHAUSTED" },
    });
    const result = appendUsage([], port, usageInput());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("BUDGET_REFUSED_BY_ORG");
      expect(result.budgetReasonCode).toBe("SPEND_EXHAUSTED");
    }
  });

  it("refuses cross-tenant appends into an existing ledger (fail-closed)", () => {
    const first = appendUsage([], ALWAYS_OK_PORT, usageInput());
    if (!first.ok) throw new Error("first append failed");
    const cross = appendUsage(first.ledger, ALWAYS_OK_PORT, usageInput({ tenantId: "other", requestRef: "req-2" }));
    expect(cross).toMatchObject({ ok: false, reasonCode: "TENANT_MISMATCH" });
  });

  it("refuses malformed entries with typed codes", () => {
    expect(appendUsage([], ALWAYS_OK_PORT, usageInput({ tenantId: "" }))).toMatchObject({ ok: false, reasonCode: "TENANT_ID_EMPTY" });
    expect(appendUsage([], ALWAYS_OK_PORT, usageInput({ requestRef: "" }))).toMatchObject({ ok: false, reasonCode: "REQUEST_REF_EMPTY" });
    expect(appendUsage([], ALWAYS_OK_PORT, usageInput({ modelId: "" }))).toMatchObject({ ok: false, reasonCode: "MODEL_ID_EMPTY" });
    expect(appendUsage([], ALWAYS_OK_PORT, usageInput({ providerId: "" }))).toMatchObject({ ok: false, reasonCode: "PROVIDER_ID_EMPTY" });
    expect(appendUsage([], ALWAYS_OK_PORT, usageInput({ capability: "" }))).toMatchObject({ ok: false, reasonCode: "CAPABILITY_EMPTY" });
    expect(appendUsage([], ALWAYS_OK_PORT, usageInput({ units: -1 }))).toMatchObject({ ok: false, reasonCode: "NEGATIVE_UNITS" });
    expect(appendUsage([], ALWAYS_OK_PORT, usageInput({ costMinor: -1 }))).toMatchObject({ ok: false, reasonCode: "NEGATIVE_COST" });
    expect(appendUsage([], ALWAYS_OK_PORT, usageInput({ units: 1.5 }))).toMatchObject({ ok: false, reasonCode: "NON_INTEGER_AMOUNT" });
    expect(appendUsage([], ALWAYS_OK_PORT, usageInput({ at: -1 }))).toMatchObject({ ok: false, reasonCode: "NEGATIVE_TIME" });
  });

  it("is deterministic: same ledger + same port decision → same chained digest", () => {
    const a = appendUsage([], ALWAYS_OK_PORT, usageInput());
    const b = appendUsage([], ALWAYS_OK_PORT, usageInput());
    if (a.ok && b.ok) expect(a.appended.digest).toBe(b.appended.digest);
    else throw new Error("expected ok");
  });
});

// ---------------------------------------------------------------------------
// Chain verification + totals.
// ---------------------------------------------------------------------------

describe("verifyUsageLedgerChain + totals", () => {
  function ledgerOf(count: number): UsageLedgerEntry[] {
    let ledger: UsageLedgerEntry[] = [];
    for (let i = 0; i < count; i++) {
      const result = appendUsage(ledger, ALWAYS_OK_PORT, usageInput({ requestRef: `req-${i + 1}`, units: 100, costMinor: 250 }));
      if (!result.ok) throw new Error("append failed");
      ledger = [...ledger, result.appended];
    }
    return ledger;
  }

  it("verifies a pristine multi-entry chain", () => {
    const ledger = ledgerOf(3);
    expect(verifyUsageLedgerChain(ledger)).toEqual({ ok: true, entries: 3 });
  });

  it("detects tampering at the earliest broken seq", () => {
    const ledger = ledgerOf(3);
    const tampered = ledger.map((e) => (e.seq === 2 ? { ...e, units: 999 } : e));
    const result = verifyUsageLedgerChain(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasonCode).toBe("CHAIN_DIGEST_MISMATCH");
      expect(result.brokenAtSeq).toBe(2);
    }
  });

  it("refuses an empty ledger with CHAIN_EMPTY", () => {
    expect(verifyUsageLedgerChain([])).toMatchObject({ ok: false, reasonCode: "CHAIN_EMPTY" });
  });

  it("sumUsageLedger totals units and integer minor-unit cost", () => {
    const ledger = ledgerOf(3);
    expect(sumUsageLedger(ledger)).toEqual({ totalUnits: 300, totalCostMinor: 750, entries: 3 });
  });

  it("usageEntryDigest chains deterministically off the predecessor", () => {
    const base = {
      seq: 1,
      tenantId: "acme",
      agentId: "agent-1",
      requestRef: "req-1",
      modelId: "model-x",
      providerId: "prov-a",
      capability: "model_invoke",
      units: 1,
      costMinor: 1,
      at: 1,
    };
    expect(usageEntryDigest(null, base)).toBe(usageEntryDigest(null, base));
    expect(usageEntryDigest("usage_deadbeef", base)).not.toBe(usageEntryDigest(null, base));
  });
});
