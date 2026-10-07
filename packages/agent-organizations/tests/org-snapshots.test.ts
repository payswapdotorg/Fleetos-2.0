/**
 * @fleetos/agent-organizations — F230C org-snapshot tests: journal fold,
 * chained digests, tamper detection, tenant fail-closed reads.
 */
import { describe, expect, it } from "vitest";
import {
  foldOrgSnapshot,
  nextOrgEntry,
  orgEntryDigest,
  orgGenesisDigest,
  readOrgSnapshotForTenant,
  verifyOrgJournalChain,
  type OrgEvent,
  type OrgJournalEntry,
  type TenantScope,
} from "../src/index.js";

const TENANT: TenantScope = { tenantId: "acme" };

function buildJournal(events: readonly { event: OrgEvent; at: number }[]): OrgJournalEntry[] {
  let prev: OrgJournalEntry | null = null;
  const entries: OrgJournalEntry[] = [];
  for (const { event, at } of events) {
    const entry = nextOrgEntry({ tenant: TENANT, organizationId: "org-1", event, at, prev });
    entries.push(entry);
    prev = entry;
  }
  return entries;
}

const SCENARIO: readonly { event: OrgEvent; at: number }[] = [
  { event: { kind: "org-created" }, at: 1 },
  { event: { kind: "agent-enrolled", agentId: "agent-1" }, at: 2 },
  { event: { kind: "agent-enrolled", agentId: "agent-2" }, at: 3 },
  { event: { kind: "team-added", teamId: "team-b" }, at: 4 },
  { event: { kind: "team-added", teamId: "team-a" }, at: 5 },
  { event: { kind: "role-assigned", agentId: "agent-1", roleId: "role-ops" }, at: 6 },
  { event: { kind: "role-assigned", agentId: "agent-1", roleId: "role-obs" }, at: 7 },
  { event: { kind: "role-activated", agentId: "agent-1", roleId: "role-ops" }, at: 8 },
  { event: { kind: "role-relieved", agentId: "agent-1", roleId: "role-obs", reason: "rotation" }, at: 9 },
  { event: { kind: "budget-allocated", capability: "model_invoke", units: 1000, spendMinor: 50000 }, at: 10 },
  { event: { kind: "budget-consumed", capability: "model_invoke", units: 400, spendMinor: 15000 }, at: 11 },
  { event: { kind: "budget-replenished", capability: "model_invoke", units: 500, spendMinor: 25000 }, at: 12 },
  { event: { kind: "agent-removed", agentId: "agent-2", reason: "offboarded" }, at: 13 },
];

// ---------------------------------------------------------------------------
// Chain building + verification.
// ---------------------------------------------------------------------------

describe("org journal chain", () => {
  it("builds contiguous seqs with chained prevDigests and orgevt_ digests", () => {
    const journal = buildJournal(SCENARIO);
    expect(journal.length).toBe(13);
    expect(journal[0]).toMatchObject({ seq: 1, prevDigest: null });
    expect(journal[12]).toMatchObject({ seq: 13 });
    expect(journal[12]?.prevDigest).toBe(journal[11]?.digest);
    for (const entry of journal) expect(entry.digest).toMatch(/^orgevt_[0-9a-f]{8}$/);
  });

  it("the genesis digest is deterministic", () => {
    expect(orgGenesisDigest("acme", "org-1")).toBe(orgGenesisDigest("acme", "org-1"));
    expect(orgGenesisDigest("acme", "org-1")).not.toBe(orgGenesisDigest("acme", "org-2"));
  });

  it("verifies a pristine chain", () => {
    const journal = buildJournal(SCENARIO);
    expect(verifyOrgJournalChain(journal)).toEqual({
      ok: true,
      tenantId: "acme",
      organizationId: "org-1",
      entries: 13,
    });
  });

  it("detects tampering at the EARLIEST broken seq", () => {
    const journal = buildJournal(SCENARIO);
    const tampered: OrgJournalEntry[] = journal.map((e) =>
      e.seq === 5 ? { ...e, event: { kind: "policy-updated" } } : e,
    );
    const result = verifyOrgJournalChain(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.brokenAtSeq).toBe(5);
  });

  it("detects a seq gap", () => {
    const journal = buildJournal(SCENARIO);
    const gapped = journal.filter((e) => e.seq !== 5);
    const result = verifyOrgJournalChain(gapped);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("CHAIN_SEQ_GAP");
  });

  it("detects a cross-tenant entry (fail-closed)", () => {
    const journal = buildJournal(SCENARIO);
    const mixed: OrgJournalEntry[] = journal.map((e) =>
      e.seq === 7 ? { ...e, tenantId: "other", digest: orgEntryDigest(e.prevDigest, { ...e }) } : e,
    );
    const result = verifyOrgJournalChain(mixed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasonCode).toBe("CHAIN_TENANT_MISMATCH");
  });

  it("refuses an empty chain with CHAIN_EMPTY", () => {
    expect(verifyOrgJournalChain([])).toMatchObject({ ok: false, reasonCode: "CHAIN_EMPTY" });
  });
});

// ---------------------------------------------------------------------------
// The fold.
// ---------------------------------------------------------------------------

describe("foldOrgSnapshot — the pure fold", () => {
  const journal = buildJournal(SCENARIO);

  it("folds teams deterministically sorted by teamId regardless of journal order", () => {
    const snapshot = foldOrgSnapshot(journal);
    expect(snapshot.teams.map((t) => t.teamId)).toEqual(["team-a", "team-b"]);
  });

  it("folds enrollment/removal, concurrency and relief counts", () => {
    const snapshot = foldOrgSnapshot(journal);
    expect(snapshot.enrolledAgents).toEqual(["agent-1", "agent-2"]);
    expect(snapshot.removedAgents).toEqual(["agent-2"]);
    // agent-1: 2 assigned, 1 relieved (activation is concurrency-neutral):
    expect(snapshot.concurrentRolesByAgent["agent-1"]).toBe(1);
    expect(snapshot.relievedRoleCount).toBe(1);
  });

  it("folds budget totals: allocated+replenished vs consumed", () => {
    const snapshot = foldOrgSnapshot(journal);
    expect(snapshot.budgetTotals).toEqual({
      allocatedUnits: 1500,
      consumedUnits: 400,
      allocatedSpendMinor: 75000,
      consumedSpendMinor: 15000,
    });
  });

  it("is pure: identical entries → byte-identical snapshot (digest included)", () => {
    const a = foldOrgSnapshot(journal);
    const b = foldOrgSnapshot(journal);
    expect(a).toEqual(b);
    // Input order (already seq-sorted here) — reordering the ARRAY must
    // not change the fold:
    const reordered = [...journal].reverse();
    expect(foldOrgSnapshot(reordered)).toEqual(a);
  });

  it("the snapshot digest is stamped and journal-length sensitive", () => {
    const snapshot = foldOrgSnapshot(journal);
    expect(snapshot.digest).toMatch(/^orgsnap_[0-9a-f]{8}$/);
    const shorter = foldOrgSnapshot(journal.slice(0, 5));
    expect(shorter.digest).not.toBe(snapshot.digest);
  });

  it("an empty journal folds to an empty snapshot deterministically", () => {
    const snapshot = foldOrgSnapshot([]);
    expect(snapshot.journalLength).toBe(0);
    expect(snapshot.digest).toMatch(/^orgsnap_[0-9a-f]{8}$/);
  });
});

// ---------------------------------------------------------------------------
// Tenant fail-closed reads.
// ---------------------------------------------------------------------------

describe("readOrgSnapshotForTenant — fail-closed", () => {
  it("returns the snapshot for the owning tenant", () => {
    const journal = buildJournal(SCENARIO);
    const snapshot = readOrgSnapshotForTenant(TENANT, journal);
    expect(snapshot?.digest).toBe(foldOrgSnapshot(journal).digest);
  });

  it("returns null for another tenant (no existence leak)", () => {
    const journal = buildJournal(SCENARIO);
    expect(readOrgSnapshotForTenant({ tenantId: "other" }, journal)).toBeNull();
  });

  it("returns null when the chain is broken", () => {
    const journal = buildJournal(SCENARIO);
    const tampered = journal.map((e) => (e.seq === 3 ? { ...e, at: 999 } : e));
    expect(readOrgSnapshotForTenant(TENANT, tampered)).toBeNull();
  });

  it("returns null for an invalid tenant scope", () => {
    const journal = buildJournal(SCENARIO);
    expect(readOrgSnapshotForTenant({ tenantId: "" }, journal)).toBeNull();
  });
});
