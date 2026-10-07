/**
 * @fleetos/agent — Wave 3 deterministic reconciliation diff (F230A).
 *
 * The F220A `edge-path.ts` shipped a basic `planReconciliation` that
 * handles local-ahead/remote-ahead via integer head comparison. F230A
 * advances to a STRUCTURAL reconciliation diff:
 *
 *   - **IntentState** — the agent's local intent state (a typed map of
 *     key -> value with sequence numbers).
 *   - **TwinState** — the authoritative twin's state (structurally
 *     identical; the agent consumes the twin's projection via an
 *     injected port, never imports the twin package).
 *   - **computeReconciliationDiff** — pure function: same (local, remote)
 *     -> byte-identical diff. The diff is a typed object with `localOnly`,
 *     `remoteOnly`, and `common` lists, sorted by key for canonical
 *     comparison.
 *   - **ReconciliationOutcome** — `in-sync | local-ahead | remote-ahead |
 *     divergent`. `in-sync` = the two states are byte-identical.
 *     `divergent` = a key exists in both but with different values (the
 *     twin is authoritative; the agent must adopt the twin's value).
 *
 * The diff algorithm is pure and testable: same inputs -> byte-identical
 * diff. The agent uses the diff to decide what to fetch from the twin
 * (remote-only entries) and what to discard (local-only entries that the
 * twin doesn't know about).
 *
 * Pure TypeScript. No I/O, no servers, no databases. Persistence lands at
 * F211 (TL lane).
 */

import { createHash } from "node:crypto";
import type { AgentIdLike, TenantIdLike } from "./agent.js";
import type { AuditEventRef } from "./kernel.js";

export type { AuditEventRef };

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// IntentState + TwinState — structurally identical shapes. The agent's
// local intent is a map of key -> { value, seq }. The twin's projection
// is the same shape. The agent never imports the twin package.
// ---------------------------------------------------------------------------

export interface IntentEntry {
  readonly value: string;
  readonly seq: number;
  readonly updatedAt: number;
}

export type IntentState = ReadonlyMap<string, IntentEntry>;
export type TwinState = ReadonlyMap<string, IntentEntry>;

// ---------------------------------------------------------------------------
// IntentReconciliationDiff — the typed diff between local intent and remote twin.
// ---------------------------------------------------------------------------

export interface DiffEntry {
  readonly key: string;
  readonly local?: IntentEntry;
  readonly remote?: IntentEntry;
  readonly status: "common" | "local-only" | "remote-only" | "divergent";
}

export interface IntentReconciliationDiff {
  readonly agentId: AgentIdLike;
  readonly tenantId: TenantIdLike;
  readonly at: number;
  readonly entries: ReadonlyArray<DiffEntry>; // sorted by key
  readonly outcome: "in-sync" | "local-ahead" | "remote-ahead" | "divergent";
  readonly localOnlyCount: number;
  readonly remoteOnlyCount: number;
  readonly commonCount: number;
  readonly divergentCount: number;
  readonly digest: string; // sha-256 over the canonical diff representation
}

// ---------------------------------------------------------------------------
// computeReconciliationDiff — pure function. Same (local, remote) ->
// byte-identical diff. The diff is sorted by key; each entry's status is
// machine-stable.
// ---------------------------------------------------------------------------

export function computeReconciliationDiff(
  agentId: AgentIdLike,
  tenantId: TenantIdLike,
  local: IntentState,
  remote: TwinState,
  at: number,
): IntentReconciliationDiff {
  const keys = new Set<string>([...local.keys(), ...remote.keys()]);
  const sortedKeys = [...keys].sort();
  const entries: DiffEntry[] = [];
  let localOnly = 0;
  let remoteOnly = 0;
  let common = 0;
  let divergent = 0;

  for (const key of sortedKeys) {
    const l = local.get(key);
    const r = remote.get(key);
    if (l && r) {
      if (l.value === r.value && l.seq === r.seq) {
        entries.push({ key, local: l, remote: r, status: "common" });
        common++;
      } else {
        entries.push({ key, local: l, remote: r, status: "divergent" });
        divergent++;
      }
    } else if (l) {
      entries.push({ key, local: l, status: "local-only" });
      localOnly++;
    } else if (r) {
      entries.push({ key, remote: r, status: "remote-only" });
      remoteOnly++;
    }
  }

  const outcome: IntentReconciliationDiff["outcome"] = (() => {
    if (divergent > 0) return "divergent";
    if (localOnly > 0 && remoteOnly === 0) return "local-ahead";
    if (remoteOnly > 0 && localOnly === 0) return "remote-ahead";
    if (localOnly === 0 && remoteOnly === 0 && divergent === 0) return "in-sync";
    return "divergent"; // both local-only and remote-only present = divergent
  })();

  // Canonical digest: sorted entries -> stable string -> sha-256.
  const canonical = entries
    .map((e) => `${e.key}:${e.status}:${e.local?.value ?? ""}:${e.local?.seq ?? ""}:${e.remote?.value ?? ""}:${e.remote?.seq ?? ""}`)
    .join("|");
  const digest = digestOf(agentId, tenantId, "recon-diff", canonical, at);

  return {
    agentId,
    tenantId,
    at,
    entries,
    outcome,
    localOnlyCount: localOnly,
    remoteOnlyCount: remoteOnly,
    commonCount: common,
    divergentCount: divergent,
    digest,
  };
}

// ---------------------------------------------------------------------------
// applyReconciliation — the agent's converge step. The twin is
// authoritative (A2); the agent adopts the twin's values for divergent
// entries and discards local-only entries that the twin doesn't know
// about (the twin's omission is authoritative — the agent must not
// invent state the twin doesn't have).
//
// Returns the new IntentState (pure function: same inputs -> same output).
// ---------------------------------------------------------------------------

export function applyReconciliation(
  local: IntentState,
  diff: IntentReconciliationDiff,
): IntentState {
  const next = new Map<string, IntentEntry>();
  // Adopt common entries as-is.
  for (const entry of diff.entries) {
    if (entry.status === "common" && entry.local) {
      next.set(entry.key, entry.local);
    } else if (entry.status === "remote-only" && entry.remote) {
      // Adopt the twin's value (the agent was missing it).
      next.set(entry.key, entry.remote);
    } else if (entry.status === "divergent" && entry.remote) {
      // Twin is authoritative — adopt its value.
      next.set(entry.key, entry.remote);
    }
    // local-only entries are dropped (the twin doesn't know about them).
  }
  return next;
}

// ---------------------------------------------------------------------------
// verifyIntentConvergence — after applying the diff, the local state MUST equal
// the remote state. Returns true if they match (byte-identical).
// ---------------------------------------------------------------------------

export function verifyIntentConvergence(local: IntentState, remote: TwinState): boolean {
  if (local.size !== remote.size) return false;
  for (const [key, l] of local) {
    const r = remote.get(key);
    if (!r) return false;
    if (l.value !== r.value || l.seq !== r.seq) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Audit emission for the reconciliation step.
// ---------------------------------------------------------------------------

export function emitReconciliationAudit(
  diff: IntentReconciliationDiff,
): AuditEventRef {
  return {
    actor: diff.agentId,
    intent: `agent:reconcile:${diff.outcome}`,
    tenant: diff.tenantId,
    timestamp: diff.at,
    digest: digestOf(diff.agentId, diff.tenantId, diff.outcome, diff.digest, diff.at),
  };
}

// ---------------------------------------------------------------------------
// Helpers for constructing IntentState / TwinState in tests.
// ---------------------------------------------------------------------------

export function makeIntentState(entries: ReadonlyArray<{ readonly key: string; readonly value: string; readonly seq: number; readonly updatedAt: number }>): IntentState {
  const map = new Map<string, IntentEntry>();
  for (const e of entries) {
    map.set(e.key, { value: e.value, seq: e.seq, updatedAt: e.updatedAt });
  }
  return map;
}

export function makeTwinState(entries: ReadonlyArray<{ readonly key: string; readonly value: string; readonly seq: number; readonly updatedAt: number }>): TwinState {
  return makeIntentState(entries);
}
