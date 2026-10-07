/**
 * @fleetos/agent-organizations — org-state snapshots as a PURE FOLD over
 * the org event journal (F230C).
 *
 * Pattern mirrored from `packages/mission/src/journal.ts` (the packet's
 * designated exemplar): append-only entries, each carrying a digest
 * CHAINED to its predecessor; the org state is a pure fold — replaying
 * the journal reproduces the snapshot exactly; a tampered or gapped
 * chain is detected at the earliest broken seq. This package cannot
 * import @fleetos/* (A20 + packet rule), so the digest is the lane's
 * established FNV-1a convention instead of the kernel's digestOf —
 * flagged for TL adjudication in the evidence report.
 *
 * Laws: A8 (tenant-scoped, fail-closed chain verification), A19
 * (digest-stamped, machine-verifiable).
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";
import { fnv1a32 } from "./internal-digest.js";

// ---------------------------------------------------------------------------
// Org journal events.
// ---------------------------------------------------------------------------

export type OrgEventKind =
  | "org-created"
  | "team-added"
  | "agent-enrolled"
  | "agent-removed"
  | "role-assigned"
  | "role-activated"
  | "role-relieved"
  | "budget-allocated"
  | "budget-consumed"
  | "budget-replenished"
  | "policy-updated";

export interface OrgEvent {
  readonly kind: OrgEventKind;
  readonly teamId?: string;
  readonly agentId?: string;
  readonly roleId?: string;
  readonly capability?: string;
  readonly units?: number;
  readonly spendMinor?: number;
  readonly reason?: string;
}

export interface OrgJournalEntry {
  readonly seq: number;
  readonly tenantId: string;
  readonly organizationId: string;
  readonly event: OrgEvent;
  readonly at: number;
  readonly digest: string;
  readonly prevDigest: string | null;
}

// ---------------------------------------------------------------------------
// Digest chaining.
// ---------------------------------------------------------------------------

function serializeOrgEvent(event: OrgEvent): string {
  return [
    event.kind,
    event.teamId ?? "",
    event.agentId ?? "",
    event.roleId ?? "",
    event.capability ?? "",
    event.units ?? 0,
    event.spendMinor ?? 0,
    event.reason ?? "",
  ].join("|");
}

export function orgGenesisDigest(tenantId: string, organizationId: string): string {
  return `org_${fnv1a32(["genesis", tenantId, organizationId])}`;
}

/** Chained entry digest — verifiable, byte-identical for identical inputs. */
export function orgEntryDigest(
  prevDigest: string | null,
  entry: Omit<OrgJournalEntry, "digest" | "prevDigest">,
): string {
  return `orgevt_${fnv1a32([
    prevDigest ?? orgGenesisDigest(entry.tenantId, entry.organizationId),
    entry.seq,
    entry.tenantId,
    entry.organizationId,
    serializeOrgEvent(entry.event),
    entry.at,
  ])}`;
}

/** Build the next journal entry (digest chained to `prevDigest`). Pure. */
export function nextOrgEntry(input: {
  readonly tenant: TenantScope;
  readonly organizationId: string;
  readonly event: OrgEvent;
  readonly at: number;
  readonly prev: OrgJournalEntry | null;
}): OrgJournalEntry {
  const prevDigest = input.prev ? input.prev.digest : null;
  const seq = input.prev ? input.prev.seq + 1 : 1;
  const base = {
    seq,
    tenantId: input.tenant.tenantId,
    organizationId: input.organizationId,
    event: input.event,
    at: input.at,
  };
  return { ...base, digest: orgEntryDigest(prevDigest, base), prevDigest };
}

export type OrgChainVerification =
  | {
      readonly ok: true;
      readonly tenantId: string;
      readonly organizationId: string;
      readonly entries: number;
    }
  | {
      readonly ok: false;
      readonly reasonCode: "CHAIN_EMPTY" | "CHAIN_SEQ_GAP" | "CHAIN_DIGEST_MISMATCH" | "CHAIN_TENANT_MISMATCH" | "CHAIN_ORG_MISMATCH";
      readonly brokenAtSeq: number | null;
    };

/**
 * Verify the journal chain (genesis → seq 1 → …): seqs are contiguous,
 * prevDigest links are exact, digests recompute, tenant/org are uniform.
 * Tampering is reported at the EARLIEST broken seq.
 */
export function verifyOrgJournalChain(entries: readonly OrgJournalEntry[]): OrgChainVerification {
  if (entries.length === 0) {
    return { ok: false, reasonCode: "CHAIN_EMPTY", brokenAtSeq: null };
  }
  const first = entries[0] as OrgJournalEntry;
  let prevDigest: string | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as OrgJournalEntry;
    if (entry.seq !== i + 1) {
      return { ok: false, reasonCode: "CHAIN_SEQ_GAP", brokenAtSeq: entry.seq };
    }
    if (entry.tenantId !== first.tenantId) {
      return { ok: false, reasonCode: "CHAIN_TENANT_MISMATCH", brokenAtSeq: entry.seq };
    }
    if (entry.organizationId !== first.organizationId) {
      return { ok: false, reasonCode: "CHAIN_ORG_MISMATCH", brokenAtSeq: entry.seq };
    }
    if (entry.prevDigest !== prevDigest) {
      return { ok: false, reasonCode: "CHAIN_DIGEST_MISMATCH", brokenAtSeq: entry.seq };
    }
    const expected = orgEntryDigest(prevDigest, {
      seq: entry.seq,
      tenantId: entry.tenantId,
      organizationId: entry.organizationId,
      event: entry.event,
      at: entry.at,
    });
    if (entry.digest !== expected) {
      return { ok: false, reasonCode: "CHAIN_DIGEST_MISMATCH", brokenAtSeq: entry.seq };
    }
    prevDigest = entry.digest;
  }
  return {
    ok: true,
    tenantId: first.tenantId,
    organizationId: first.organizationId,
    entries: entries.length,
  };
}

// ---------------------------------------------------------------------------
// The snapshot — the PURE FOLD over the journal.
// ---------------------------------------------------------------------------

export interface OrgSnapshot {
  readonly organizationId: string;
  readonly tenantId: string;
  readonly journalLength: number;
  readonly teams: readonly { readonly teamId: string; readonly members: readonly string[] }[];
  readonly enrolledAgents: readonly string[];
  readonly removedAgents: readonly string[];
  /** Concurrent (assigned+active, NOT relieved) role count per agent. */
  readonly concurrentRolesByAgent: Readonly<Record<string, number>>;
  readonly relievedRoleCount: number;
  readonly budgetTotals: {
    readonly allocatedUnits: number;
    readonly consumedUnits: number;
    readonly allocatedSpendMinor: number;
    readonly consumedSpendMinor: number;
  };
  /** Digest stamped over the folded state — deterministic. */
  readonly digest: string;
}

/**
 * Fold the org journal into an org-state snapshot. PURE: identical
 * entries produce a byte-identical snapshot (including digest). The fold
 * is mechanical — legality is enforced by the writers; the journal is
 * the durable record (same discipline as the mission fold).
 */
export function foldOrgSnapshot(entries: readonly OrgJournalEntry[]): OrgSnapshot {
  const teams = new Map<string, string[]>();
  const enrolled: string[] = [];
  const removed: string[] = [];
  const activeRoles = new Map<string, number>();
  let relievedRoleCount = 0;
  let allocatedUnits = 0;
  let consumedUnits = 0;
  let allocatedSpendMinor = 0;
  let consumedSpendMinor = 0;

  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  for (const entry of sorted) {
    const event = entry.event;
    switch (event.kind) {
      case "org-created":
        break;
      case "team-added": {
        const teamId = event.teamId ?? "";
        if (!teams.has(teamId)) teams.set(teamId, []);
        break;
      }
      case "agent-enrolled": {
        const agentId = event.agentId ?? "";
        if (!enrolled.includes(agentId)) enrolled.push(agentId);
        break;
      }
      case "agent-removed": {
        const agentId = event.agentId ?? "";
        if (!removed.includes(agentId)) removed.push(agentId);
        break;
      }
      case "role-assigned": {
        const agentId = event.agentId ?? "";
        activeRoles.set(agentId, (activeRoles.get(agentId) ?? 0) + 1);
        break;
      }
      case "role-activated":
        // assigned → active stays concurrent (no double count).
        break;
      case "role-relieved": {
        const agentId = event.agentId ?? "";
        const current = activeRoles.get(agentId) ?? 0;
        if (current > 0) activeRoles.set(agentId, current - 1);
        relievedRoleCount++;
        break;
      }
      case "budget-allocated": {
        allocatedUnits += event.units ?? 0;
        allocatedSpendMinor += event.spendMinor ?? 0;
        break;
      }
      case "budget-consumed": {
        consumedUnits += event.units ?? 0;
        consumedSpendMinor += event.spendMinor ?? 0;
        break;
      }
      case "budget-replenished": {
        allocatedUnits += event.units ?? 0;
        allocatedSpendMinor += event.spendMinor ?? 0;
        break;
      }
      case "policy-updated":
        break;
    }
  }

  const concurrentRolesByAgent: Record<string, number> = {};
  for (const [agentId, count] of activeRoles) {
    concurrentRolesByAgent[agentId] = count;
  }

  const first = sorted[0];
  const snapshotBase = {
    organizationId: first ? first.organizationId : "",
    tenantId: first ? first.tenantId : "",
    journalLength: sorted.length,
    teams: [...teams.entries()]
      .map(([teamId, members]) => ({ teamId, members: [...members] }))
      .sort((a, b) => (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0)),
    enrolledAgents: [...enrolled],
    removedAgents: [...removed],
    concurrentRolesByAgent,
    relievedRoleCount,
    budgetTotals: {
      allocatedUnits,
      consumedUnits,
      allocatedSpendMinor,
      consumedSpendMinor,
    },
  };
  return { ...snapshotBase, digest: computeOrgSnapshotDigest(snapshotBase) };
}

/**
 * Snapshot digest — stamped over the folded state (law A19). Deterministic
 * serialization: teams sorted by teamId, agent lists in journal order.
 */
export function computeOrgSnapshotDigest(snapshot: Omit<OrgSnapshot, "digest">): string {
  const teamParts = snapshot.teams
    .map((t) => `${t.teamId}:${t.members.join(",")}`)
    .join(";");
  const roleParts = Object.keys(snapshot.concurrentRolesByAgent)
    .sort()
    .map((agentId) => `${agentId}=${snapshot.concurrentRolesByAgent[agentId] ?? 0}`)
    .join(";");
  return `orgsnap_${fnv1a32([
    snapshot.organizationId,
    snapshot.tenantId,
    snapshot.journalLength,
    teamParts,
    snapshot.enrolledAgents.join(","),
    snapshot.removedAgents.join(","),
    roleParts,
    snapshot.relievedRoleCount,
    snapshot.budgetTotals.allocatedUnits,
    snapshot.budgetTotals.consumedUnits,
    snapshot.budgetTotals.allocatedSpendMinor,
    snapshot.budgetTotals.consumedSpendMinor,
  ])}`;
}

/**
 * Tenant-scoped snapshot read: fail-closed — a journal whose entries do
 * not uniformly belong to the requesting tenant refuses (no leak).
 */
export function readOrgSnapshotForTenant(
  tenant: TenantScope,
  entries: readonly OrgJournalEntry[],
): OrgSnapshot | null {
  const tenantCheck = validateTenantScope(tenant);
  if (!tenantCheck.ok) return null;
  const chain = verifyOrgJournalChain(entries);
  if (!chain.ok) return null;
  if (chain.tenantId !== tenantCheck.scope.tenantId) return null;
  return foldOrgSnapshot(entries);
}
