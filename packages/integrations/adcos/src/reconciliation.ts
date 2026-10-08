/**
 * @fleetos/adcos — Wave 5 reconciliation diff engine (F250A).
 *
 * Deterministic set-diff between ADAPTER-OBSERVED state (sessions and/or
 * commands the adapter sees) and the TWIN-AUTHORITATIVE records. The
 * resolution rule mirrors the F230A law:
 *
 *   - conflict (same id, different digest) -> adopt the twin's digest;
 *   - twin-only -> adopt the twin's record;
 *   - adapter-only -> DROP (the twin's omission is authoritative);
 *   - in-sync -> no action.
 *
 * Outputs are classified per record (`in-sync` / `adapter-ahead` /
 * `twin-ahead` / `conflict`) plus an overall outcome. Fail-closed on
 * tenant mismatch (an adapter record from another tenant refuses the
 * whole reconciliation — never silently filtered) and on invalid `now`.
 *
 * Pure deterministic TypeScript; sorted-by-id everywhere, so the diff is
 * byte-identical for identical inputs regardless of input order.
 */

import { createHash } from "node:crypto";
import type { TenantIdLike } from "./adcos.js";

function digestOf(...parts: ReadonlyArray<string | number>): string {
  const text = parts.map((p) => String(p)).join("|");
  return createHash("sha256").update(text).digest("hex");
}

// ---------------------------------------------------------------------------
// Inputs + classification.
// ---------------------------------------------------------------------------

/** A minimal (id, digest) pair — sessions and commands both reconcile as this. */
export interface ReconcileRecord {
  readonly id: string;
  readonly digest: string;
  /** Required on the adapter side; fail-closed against the reconciliation tenant. */
  readonly tenantId?: string;
}

export type ReconciliationEntryClass =
  | "in-sync"
  | "adapter-ahead"
  | "twin-ahead"
  | "conflict";

export interface ReconciliationEntry {
  readonly id: string;
  readonly class: ReconciliationEntryClass;
  readonly adapterDigest: string | null;
  readonly twinDigest: string | null;
}

export type ReconciliationOutcome =
  | "in-sync"
  | "adapter-ahead"
  | "twin-ahead"
  | "conflict";

export interface AdcosReconciliationDiff {
  readonly tenantId: TenantIdLike;
  readonly at: number;
  readonly entries: ReadonlyArray<ReconciliationEntry>; // sorted by id
  readonly counts: {
    readonly inSync: number;
    readonly adapterAhead: number;
    readonly twinAhead: number;
    readonly conflict: number;
  };
  readonly outcome: ReconciliationOutcome;
  readonly digest: string;
}

export type ReconciliationRejectionCode =
  | "missing-tenant-id"
  | "invalid-now"
  | "tenant-mismatch" // fail-closed: adapter record from another tenant
  | "missing-record-id"
  | "missing-record-digest"
  | "duplicate-record"; // duplicate id within one side

export type ReconciliationDiffResult =
  | { readonly ok: true; readonly diff: AdcosReconciliationDiff }
  | { readonly ok: false; readonly reason: ReconciliationRejectionCode };

// ---------------------------------------------------------------------------
// The diff.
// ---------------------------------------------------------------------------

export function computeReconciliationDiff(input: {
  readonly tenantId: TenantIdLike;
  readonly now: number;
  readonly adapterRecords: ReadonlyArray<ReconcileRecord>;
  readonly twinRecords: ReadonlyArray<ReconcileRecord>;
}): ReconciliationDiffResult {
  if (input.tenantId === "") return { ok: false, reason: "missing-tenant-id" };
  if (!Number.isFinite(input.now) || input.now <= 0) return { ok: false, reason: "invalid-now" };
  for (const r of input.adapterRecords) {
    if (r.tenantId !== undefined && r.tenantId !== input.tenantId) {
      return { ok: false, reason: "tenant-mismatch" }; // fail-closed, whole call
    }
  }

  const adapter = indexRecords(input.adapterRecords);
  if (!adapter.ok) return adapter;
  const twin = indexRecords(input.twinRecords);
  if (!twin.ok) return twin;

  const ids = [...new Set([...adapter.map.keys(), ...twin.map.keys()])].sort();
  const entries: ReconciliationEntry[] = [];
  let inSync = 0;
  let adapterAhead = 0;
  let twinAhead = 0;
  let conflict = 0;

  for (const id of ids) {
    const a = adapter.map.get(id) ?? null;
    const t = twin.map.get(id) ?? null;
    let cls: ReconciliationEntryClass;
    if (a !== null && t !== null) {
      cls = a === t ? "in-sync" : "conflict";
    } else if (a !== null) {
      cls = "adapter-ahead";
    } else {
      cls = "twin-ahead";
    }
    if (cls === "in-sync") inSync += 1;
    else if (cls === "adapter-ahead") adapterAhead += 1;
    else if (cls === "twin-ahead") twinAhead += 1;
    else conflict += 1;
    entries.push({ id, class: cls, adapterDigest: a, twinDigest: t });
  }

  const outcome: ReconciliationOutcome =
    conflict > 0 || (adapterAhead > 0 && twinAhead > 0)
      ? "conflict"
      : adapterAhead > 0
        ? "adapter-ahead"
        : twinAhead > 0
          ? "twin-ahead"
          : "in-sync";

  const diff: AdcosReconciliationDiff = {
    tenantId: input.tenantId,
    at: input.now,
    entries,
    counts: { inSync, adapterAhead, twinAhead, conflict },
    outcome,
    digest: reconciliationDigest(input.tenantId, input.now, entries),
  };
  return { ok: true, diff };
}

function indexRecords(
  records: ReadonlyArray<ReconcileRecord>,
):
  | { readonly ok: true; readonly map: ReadonlyMap<string, string> }
  | { readonly ok: false; readonly reason: ReconciliationRejectionCode } {
  const map = new Map<string, string>();
  for (const r of records) {
    if (r.id === "") return { ok: false, reason: "missing-record-id" };
    if (r.digest === "") return { ok: false, reason: "missing-record-digest" };
    if (map.has(r.id)) return { ok: false, reason: "duplicate-record" };
    map.set(r.id, r.digest);
  }
  return { ok: true, map };
}

function reconciliationDigest(
  tenantId: TenantIdLike,
  at: number,
  entries: ReadonlyArray<ReconciliationEntry>,
): string {
  const parts: string[] = [tenantId, String(at)];
  for (const e of entries) {
    parts.push(e.id, e.class, e.adapterDigest ?? "-", e.twinDigest ?? "-");
  }
  return digestOf(...parts);
}

// ---------------------------------------------------------------------------
// Twin-authoritative resolution.
// ---------------------------------------------------------------------------

/** Tamper-evident re-verification of a diff's own digest (recompute + compare). */
export function verifyReconciliationDiff(diff: AdcosReconciliationDiff): boolean {
  return reconciliationDigest(diff.tenantId, diff.at, diff.entries) === diff.digest;
}

export type ReconciliationActionKind = "adopt-twin" | "drop-adapter" | "none";

export interface ReconciliationAction {
  readonly id: string;
  readonly action: ReconciliationActionKind;
}

export interface ReconciliationPlan {
  readonly tenantId: TenantIdLike;
  readonly actions: ReadonlyArray<ReconciliationAction>; // sorted by id
  readonly digest: string;
}

export function resolveReconciliation(
  diff: AdcosReconciliationDiff,
): ReconciliationPlan {
  const actions = diff.entries
    .map((e): ReconciliationAction => {
      switch (e.class) {
        case "in-sync": return { id: e.id, action: "none" };
        case "conflict": return { id: e.id, action: "adopt-twin" };
        case "twin-ahead": return { id: e.id, action: "adopt-twin" };
        case "adapter-ahead": return { id: e.id, action: "drop-adapter" }; // twin omission is authoritative
      }
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    tenantId: diff.tenantId,
    actions,
    digest: digestOf(diff.tenantId, "resolve", ...actions.map((a) => `${a.id}:${a.action}`)),
  };
}

/** Apply a plan to the adapter-observed records (twin-authoritative). */
export function applyReconciliation(
  adapterRecords: ReadonlyArray<ReconcileRecord>,
  plan: ReconciliationPlan,
  twinRecords: ReadonlyArray<ReconcileRecord>,
): ReadonlyArray<ReconcileRecord> {
  const twinById = new Map(twinRecords.map((r) => [r.id, r] as const));
  const actionById = new Map(plan.actions.map((a) => [a.id, a.action] as const));
  const out: ReconcileRecord[] = [];
  for (const r of adapterRecords) {
    const action = actionById.get(r.id) ?? "none";
    if (action === "drop-adapter") continue; // twin omission wins
    if (action === "adopt-twin") {
      const twinRecord = twinById.get(r.id);
      if (twinRecord) {
        out.push({ ...r, digest: twinRecord.digest });
        continue;
      }
    }
    out.push(r);
  }
  // Twin-only records are adopted verbatim (deterministic id order).
  for (const id of [...twinById.keys()].sort()) {
    const action = actionById.get(id) ?? "none";
    if (action === "adopt-twin" && !adapterRecords.some((r) => r.id === id)) {
      out.push(twinById.get(id)!);
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Post-condition: every id is in-sync between the two sides. */
export function verifyReconciliation(
  left: ReadonlyArray<ReconcileRecord>,
  right: ReadonlyArray<ReconcileRecord>,
): boolean {
  if (left.length !== right.length) return false;
  const byId = new Map(right.map((r) => [r.id, r.digest] as const));
  for (const r of left) {
    const other = byId.get(r.id);
    if (other === undefined || other !== r.digest) return false;
  }
  return true;
}
