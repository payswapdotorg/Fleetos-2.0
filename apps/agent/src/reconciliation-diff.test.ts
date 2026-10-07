/**
 * @fleetos/agent — Wave 3 reconciliation diff tests (F230A).
 *
 * Covers:
 *   - computeReconciliationDiff: pure, deterministic (same inputs -> byte-identical diff)
 *   - Outcome classification: in-sync, local-ahead, remote-ahead, divergent
 *   - applyReconciliation: twin is authoritative (adopts remote for divergent; drops local-only)
 *   - verifyIntentConvergence: true after applying the diff
 *   - Audit emission stability
 *   - Edge cases: empty states, identical states, all-divergent states
 */

import { describe, it, expect } from "vitest";
import {
  applyReconciliation,
  computeReconciliationDiff,
  emitReconciliationAudit,
  makeIntentState,
  makeTwinState,
  verifyIntentConvergence,
  type IntentEntry,
} from "./reconciliation-diff.js";

const NOW = 1_727_000_000_000;
const AGENT = "agent-001";
const TENANT = "tnt_acme";

function entry(value: string, seq: number, updatedAt = NOW): IntentEntry {
  return { value, seq, updatedAt };
}

// ---------------------------------------------------------------------------
// Pure + deterministic
// ---------------------------------------------------------------------------

describe("agent reconciliation-diff: determinism", () => {
  it("same inputs -> byte-identical diff (deterministic)", () => {
    const local = makeIntentState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const remote = makeTwinState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const d1 = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    const d2 = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    expect(d1.digest).toBe(d2.digest);
    expect(d1.entries).toEqual(d2.entries);
  });

  it("different insertion order of identical entries -> identical diff (canonical)", () => {
    const local1 = makeIntentState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }, { key: "b", value: "2", seq: 1, updatedAt: NOW }]);
    const local2 = makeIntentState([{ key: "b", value: "2", seq: 1, updatedAt: NOW }, { key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const remote = makeTwinState([]);
    const d1 = computeReconciliationDiff(AGENT, TENANT, local1, remote, NOW);
    const d2 = computeReconciliationDiff(AGENT, TENANT, local2, remote, NOW);
    expect(d1.digest).toBe(d2.digest);
    expect(d1.entries.map((e) => e.key)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Outcome classification
// ---------------------------------------------------------------------------

describe("agent reconciliation-diff: outcome classification", () => {
  it("in-sync: identical local + remote", () => {
    const local = makeIntentState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const remote = makeTwinState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const d = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    expect(d.outcome).toBe("in-sync");
    expect(d.commonCount).toBe(1);
    expect(d.localOnlyCount).toBe(0);
    expect(d.remoteOnlyCount).toBe(0);
    expect(d.divergentCount).toBe(0);
  });

  it("local-ahead: local has entries remote doesn't", () => {
    const local = makeIntentState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const remote = makeTwinState([]);
    const d = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    expect(d.outcome).toBe("local-ahead");
    expect(d.localOnlyCount).toBe(1);
  });

  it("remote-ahead: remote has entries local doesn't", () => {
    const local = makeIntentState([]);
    const remote = makeTwinState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const d = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    expect(d.outcome).toBe("remote-ahead");
    expect(d.remoteOnlyCount).toBe(1);
  });

  it("divergent: same key, different value", () => {
    const local = makeIntentState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const remote = makeTwinState([{ key: "a", value: "2", seq: 1, updatedAt: NOW }]);
    const d = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    expect(d.outcome).toBe("divergent");
    expect(d.divergentCount).toBe(1);
  });

  it("divergent: same key, same value, different seq", () => {
    const local = makeIntentState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const remote = makeTwinState([{ key: "a", value: "1", seq: 2, updatedAt: NOW }]);
    const d = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    expect(d.outcome).toBe("divergent");
  });

  it("both local-only and remote-only present -> divergent", () => {
    const local = makeIntentState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const remote = makeTwinState([{ key: "b", value: "2", seq: 1, updatedAt: NOW }]);
    const d = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    expect(d.outcome).toBe("divergent");
    expect(d.localOnlyCount).toBe(1);
    expect(d.remoteOnlyCount).toBe(1);
  });

  it("empty local + empty remote -> in-sync", () => {
    const d = computeReconciliationDiff(AGENT, TENANT, makeIntentState([]), makeTwinState([]), NOW);
    expect(d.outcome).toBe("in-sync");
    expect(d.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// applyReconciliation — twin is authoritative
// ---------------------------------------------------------------------------

describe("agent reconciliation-diff: apply (twin authoritative)", () => {
  it("adopts remote-only entries (agent was missing them)", () => {
    const local = makeIntentState([]);
    const remote = makeTwinState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const d = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    const next = applyReconciliation(local, d);
    expect(next.get("a")?.value).toBe("1");
  });

  it("adopts remote value for divergent entries (twin wins)", () => {
    const local = makeIntentState([{ key: "a", value: "local-value", seq: 1, updatedAt: NOW }]);
    const remote = makeTwinState([{ key: "a", value: "remote-value", seq: 2, updatedAt: NOW }]);
    const d = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    const next = applyReconciliation(local, d);
    expect(next.get("a")?.value).toBe("remote-value");
    expect(next.get("a")?.seq).toBe(2);
  });

  it("drops local-only entries (twin doesn't know about them)", () => {
    const local = makeIntentState([
      { key: "a", value: "1", seq: 1, updatedAt: NOW },
      { key: "local-only", value: "x", seq: 1, updatedAt: NOW },
    ]);
    const remote = makeTwinState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const d = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    const next = applyReconciliation(local, d);
    expect(next.has("local-only")).toBe(false);
    expect(next.has("a")).toBe(true);
  });

  it("preserves common entries as-is", () => {
    const local = makeIntentState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const remote = makeTwinState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const d = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    const next = applyReconciliation(local, d);
    expect(next.get("a")).toEqual(entry("1", 1, NOW));
  });
});

// ---------------------------------------------------------------------------
// verifyIntentConvergence
// ---------------------------------------------------------------------------

describe("agent reconciliation-diff: verifyIntentConvergence", () => {
  it("true after applying the diff (remote-ahead case)", () => {
    const local = makeIntentState([]);
    const remote = makeTwinState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const d = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    const next = applyReconciliation(local, d);
    expect(verifyIntentConvergence(next, remote)).toBe(true);
  });

  it("true after applying the diff (divergent case)", () => {
    const local = makeIntentState([{ key: "a", value: "local", seq: 1, updatedAt: NOW }]);
    const remote = makeTwinState([{ key: "a", value: "remote", seq: 2, updatedAt: NOW }]);
    const d = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    const next = applyReconciliation(local, d);
    expect(verifyIntentConvergence(next, remote)).toBe(true);
  });

  it("false if local still has entries remote doesn't", () => {
    const local = makeIntentState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const remote = makeTwinState([]);
    expect(verifyIntentConvergence(local, remote)).toBe(false);
  });

  it("false if values differ", () => {
    const local = makeIntentState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const remote = makeTwinState([{ key: "a", value: "2", seq: 1, updatedAt: NOW }]);
    expect(verifyIntentConvergence(local, remote)).toBe(false);
  });

  it("true for two empty states", () => {
    expect(verifyIntentConvergence(makeIntentState([]), makeTwinState([]))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Audit emission
// ---------------------------------------------------------------------------

describe("agent reconciliation-diff: audit", () => {
  it("emitReconciliationAudit produces intent agent:reconcile:<outcome>", () => {
    const local = makeIntentState([]);
    const remote = makeTwinState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const d = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    const audit = emitReconciliationAudit(d);
    expect(audit.intent).toBe("agent:reconcile:remote-ahead");
    expect(audit.actor).toBe(AGENT);
    expect(audit.tenant).toBe(TENANT);
  });

  it("audit digest is stable for identical diffs", () => {
    const local = makeIntentState([{ key: "a", value: "1", seq: 1, updatedAt: NOW }]);
    const remote = makeTwinState([{ key: "a", value: "2", seq: 2, updatedAt: NOW }]);
    const d1 = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    const d2 = computeReconciliationDiff(AGENT, TENANT, local, remote, NOW);
    expect(emitReconciliationAudit(d1).digest).toBe(emitReconciliationAudit(d2).digest);
  });
});
