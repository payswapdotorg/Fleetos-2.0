/**
 * @fleetos/workloads — Allocation lifecycle + deterministic capacity
 * accounting + scheduling windows + idempotent demand application.
 *
 * Wave 2 lane C (F220C) operational-truth grade.
 *
 * Laws: A1, A4 (consequential transitions are gated; over-commit refused,
 * never clamped), A8 (tenant-scoped, fail-closed), A19 (audit digests on
 * lifecycle transitions), A20.
 *
 * Everything here is pure and deterministic. Time is an explicit `number`
 * input (epoch ms) — never Date.now(). Money/units are integers.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// Allocation lifecycle: proposed → committed → active → released/retired.
// ---------------------------------------------------------------------------

export type AllocationLifecycleStatus =
  | "proposed"
  | "committed"
  | "active"
  | "released"
  | "retired";

export interface AllocationLifecycleRecord {
  readonly id: string;
  readonly tenant: TenantScope;
  readonly owner: string;
  readonly units: number;
  readonly status: AllocationLifecycleStatus;
  /**
   * Idempotency key for the demand that produced this allocation. Two
   * applications of the same demand key must never double-commit.
   */
  readonly demandKey: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly terminalReason: string | null;
}

export type AllocationLifecycleCommand =
  | { type: "commit" }
  | { type: "activate" }
  | { type: "release"; reason: string }
  | { type: "retire"; reason: string };

export type AllocationLifecycleResult =
  | { readonly ok: true; readonly next: AllocationLifecycleRecord }
  | { readonly ok: false; readonly reasonCode: AllocationLifecycleReasonCode };

export type AllocationLifecycleReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "ILLEGAL_TRANSITION"
  | "RELEASE_REASON_REQUIRED"
  | "RETIRE_REASON_REQUIRED"
  | "NEGATIVE_UNITS";

const ALLOCATION_ALLOWED: Readonly<
  Record<AllocationLifecycleStatus, readonly AllocationLifecycleCommand["type"][]>
> = {
  proposed: ["commit", "release"],
  committed: ["activate", "release"],
  active: ["release", "retire"],
  released: [],
  retired: [],
};

export function transitionAllocation(
  current: AllocationLifecycleRecord,
  command: AllocationLifecycleCommand,
  at: number,
): AllocationLifecycleResult {
  const tenantCheck = validateTenantScope(current.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (!Number.isInteger(current.units) || current.units < 0) {
    return { ok: false, reasonCode: "NEGATIVE_UNITS" };
  }
  const allowed = ALLOCATION_ALLOWED[current.status] ?? [];
  if (!allowed.includes(command.type)) {
    return { ok: false, reasonCode: "ILLEGAL_TRANSITION" };
  }
  switch (command.type) {
    case "commit":
      return { ok: true, next: { ...current, status: "committed", updatedAt: at } };
    case "activate":
      return { ok: true, next: { ...current, status: "active", updatedAt: at } };
    case "release":
      if (!command.reason || command.reason.trim().length === 0) {
        return { ok: false, reasonCode: "RELEASE_REASON_REQUIRED" };
      }
      return {
        ok: true,
        next: {
          ...current,
          status: "released",
          updatedAt: at,
          terminalReason: command.reason,
        },
      };
    case "retire":
      if (!command.reason || command.reason.trim().length === 0) {
        return { ok: false, reasonCode: "RETIRE_REASON_REQUIRED" };
      }
      return {
        ok: true,
        next: {
          ...current,
          status: "retired",
          updatedAt: at,
          terminalReason: command.reason,
        },
      };
  }
}

/** Stable digest over an allocation lifecycle record (law A19). */
export function computeAllocationDigest(record: AllocationLifecycleRecord): string {
  const parts = [
    record.id,
    record.tenant.tenantId,
    record.owner,
    String(record.units),
    record.status,
    record.demandKey,
    String(record.createdAt),
    String(record.updatedAt),
    record.terminalReason ?? "",
  ];
  let hash = 0x811c9dc5;
  const joined = parts.join("\u241f");
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `alloc_${hash.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// Deterministic capacity accounting. The ledger tracks units reserved by
// allocations in a RESERVATION state (committed or active). Committing
// reserves; releasing/retiring restores EXACTLY the record's units.
// Over-commit is refused with the exact overshoot — never clamped.
// ---------------------------------------------------------------------------

export interface CapacityLedger {
  readonly owner: string;
  readonly tenant: TenantScope;
  readonly maxUnits: number;
  /** Units currently reserved by committed/active allocations. */
  readonly reservedUnits: number;
}

export type CapacityAccountingReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "OWNER_MISMATCH"
  | "NEGATIVE_UNITS"
  | "EXCEEDS_CAPACITY"
  | "NOT_RESERVED";

export type LifecycleWithLedgerResult =
  | {
      readonly ok: true;
      readonly next: AllocationLifecycleRecord;
      readonly ledger: CapacityLedger;
    }
  | {
      readonly ok: false;
      readonly reasonCode: AllocationLifecycleReasonCode | CapacityAccountingReasonCode;
      readonly overshootUnits: number;
    };

const RESERVING_STATUSES: ReadonlySet<AllocationLifecycleStatus> = new Set([
  "committed",
  "active",
]);

/**
 * applyLifecycleToLedger — applies a lifecycle transition AND keeps the
 * capacity ledger invariant in one atomic pure step:
 *   - proposed → committed reserves `record.units` (refused with the exact
 *     overshoot if that would exceed maxUnits);
 *   - committed/active → released/retired restores exactly `record.units`
 *     (refused if the ledger does not hold the reservation);
 *   - committed → active is reservation-neutral (no double counting).
 */
export function applyLifecycleToLedger(
  ledger: CapacityLedger,
  record: AllocationLifecycleRecord,
  command: AllocationLifecycleCommand,
  at: number,
): LifecycleWithLedgerResult {
  const transition = transitionAllocation(record, command, at);
  if (!transition.ok) return { ...transition, overshootUnits: 0 };
  const ledgerTenant = validateTenantScope(ledger.tenant);
  const recordTenant = validateTenantScope(record.tenant);
  if (!ledgerTenant.ok || !recordTenant.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", overshootUnits: 0 };
  }
  if (ledgerTenant.scope.tenantId !== recordTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH", overshootUnits: 0 };
  }
  if (ledger.owner !== record.owner) {
    return { ok: false, reasonCode: "OWNER_MISMATCH", overshootUnits: 0 };
  }
  if (command.type === "commit") {
    const total = ledger.reservedUnits + record.units;
    if (total > ledger.maxUnits) {
      return {
        ok: false,
        reasonCode: "EXCEEDS_CAPACITY",
        overshootUnits: total - ledger.maxUnits,
      };
    }
    return {
      ok: true,
      next: transition.next,
      ledger: { ...ledger, reservedUnits: total },
    };
  }
  if (command.type === "release" || command.type === "retire") {
    if (!RESERVING_STATUSES.has(record.status)) {
      // proposed → release: nothing was reserved; ledger unchanged.
      return { ok: true, next: transition.next, ledger };
    }
    if (ledger.reservedUnits < record.units) {
      return { ok: false, reasonCode: "NOT_RESERVED", overshootUnits: 0 };
    }
    return {
      ok: true,
      next: transition.next,
      ledger: { ...ledger, reservedUnits: ledger.reservedUnits - record.units },
    };
  }
  // activate: reservation-neutral.
  return { ok: true, next: transition.next, ledger };
}

// ---------------------------------------------------------------------------
// Scheduling windows — start/end ordering validity + overlap detection
// with deterministic tie-breaks.
// ---------------------------------------------------------------------------

export interface SchedulingWindow {
  readonly id: string;
  readonly tenant: TenantScope;
  readonly owner: string;
  readonly start: number;
  readonly end: number;
}

export type WindowValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reasonCode: WindowReasonCode };

export type WindowReasonCode = "TENANT_SCOPE_MISSING" | "START_NOT_BEFORE_END";

export function validateWindow(window: SchedulingWindow): WindowValidation {
  const tenantCheck = validateTenantScope(window.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (!(window.start < window.end)) {
    return { ok: false, reasonCode: "START_NOT_BEFORE_END" };
  }
  return { ok: true };
}

export interface WindowOverlap {
  readonly a: string;
  readonly b: string;
  readonly tieBreakRule: "window-id-lexical";
}

/**
 * detectWindowOverlaps — pure, deterministic. Two windows overlap iff they
 * belong to the same (tenant, owner) AND `a.start < b.end && b.start < a.end`
 * (touching boundaries do NOT overlap). Output is sorted by (a, b) id and
 * each pair is listed in lexical id order — the deterministic tie-break —
 * recorded as `tieBreakRule: "window-id-lexical"` (identical ranges are
 * always reported lexically, never in input order).
 */
export function detectWindowOverlaps(
  windows: readonly SchedulingWindow[],
): readonly WindowOverlap[] {
  const valid = windows.filter((w) => validateWindow(w).ok);
  const sorted = [...valid].sort(
    (x, y) =>
      x.tenant.tenantId.localeCompare(y.tenant.tenantId) ||
      x.owner.localeCompare(y.owner) ||
      x.start - y.start ||
      x.end - y.end ||
      x.id.localeCompare(y.id),
  );
  const out: WindowOverlap[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const x: SchedulingWindow | undefined = sorted[i];
      const y: SchedulingWindow | undefined = sorted[j];
      if (x === undefined || y === undefined) continue;
      if (x.tenant.tenantId !== y.tenant.tenantId) break;
      if (x.owner !== y.owner) continue;
      if (y.start >= x.end) break;
      if (x.start < y.end && y.start < x.end) {
        const [a, b] = x.id.localeCompare(y.id) <= 0 ? [x.id, y.id] : [y.id, x.id];
        out.push({ a, b, tieBreakRule: "window-id-lexical" });
      }
    }
  }
  out.sort((p, q) => p.a.localeCompare(q.a) || p.b.localeCompare(q.b));
  return out;
}

// ---------------------------------------------------------------------------
// Idempotent re-apply of an allocation demand. Same demand key → same
// result, no double-commit. Same key + different payload → conflict.
// ---------------------------------------------------------------------------

export interface AppliedDemand {
  readonly demandKey: string;
  readonly units: number;
  readonly demandDigest: string;
}

export interface IdempotentAllocationLedger {
  readonly tenant: TenantScope;
  readonly owner: string;
  readonly maxUnits: number;
  readonly allocatedUnits: number;
  readonly applications: readonly AppliedDemand[];
}

export type IdempotentApplyResult =
  | {
      readonly ok: true;
      readonly ledger: IdempotentAllocationLedger;
      readonly duplicate: boolean;
      readonly demandKey: string;
    }
  | {
      readonly ok: false;
      readonly reasonCode: IdempotentApplyReasonCode;
      readonly overshootUnits: number;
    };

export type IdempotentApplyReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "OWNER_MISMATCH"
  | "NEGATIVE_UNITS"
  | "EXCEEDS_CAPACITY"
  | "IDEMPOTENCY_KEY_EMPTY"
  | "IDEMPOTENCY_KEY_CONFLICT";

export function computeDemandDigest(
  tenantId: string,
  owner: string,
  units: number,
): string {
  const joined = [tenantId, owner, String(units)].join("\u241f");
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `demand_${hash.toString(16).padStart(8, "0")}`;
}

/**
 * applyDemandIdempotent — re-applying a demand with the SAME key and the
 * SAME payload returns the unchanged ledger with `duplicate: true` (the
 * allocation is never double-committed). Same key + different payload is
 * a typed conflict. New keys accumulate under the capacity invariant.
 */
export function applyDemandIdempotent(
  ledger: IdempotentAllocationLedger,
  demand: {
    readonly owner: string;
    readonly tenant: TenantScope;
    readonly units: number;
    readonly demandKey: string;
  },
): IdempotentApplyResult {
  const ledgerTenant = validateTenantScope(ledger.tenant);
  if (!ledgerTenant.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", overshootUnits: 0 };
  }
  const demandTenant = validateTenantScope(demand.tenant);
  if (!demandTenant.ok) {
    return { ok: false, reasonCode: "TENANT_SCOPE_MISSING", overshootUnits: 0 };
  }
  if (ledgerTenant.scope.tenantId !== demandTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH", overshootUnits: 0 };
  }
  if (ledger.owner !== demand.owner) {
    return { ok: false, reasonCode: "OWNER_MISMATCH", overshootUnits: 0 };
  }
  if (!demand.demandKey || demand.demandKey.length === 0) {
    return { ok: false, reasonCode: "IDEMPOTENCY_KEY_EMPTY", overshootUnits: 0 };
  }
  if (!Number.isInteger(demand.units) || demand.units < 0) {
    return { ok: false, reasonCode: "NEGATIVE_UNITS", overshootUnits: 0 };
  }
  const digest = computeDemandDigest(
    demandTenant.scope.tenantId,
    demand.owner,
    demand.units,
  );
  const existing = ledger.applications.find((a) => a.demandKey === demand.demandKey);
  if (existing) {
    if (existing.demandDigest === digest && existing.units === demand.units) {
      return { ok: true, ledger, duplicate: true, demandKey: demand.demandKey };
    }
    return { ok: false, reasonCode: "IDEMPOTENCY_KEY_CONFLICT", overshootUnits: 0 };
  }
  const total = ledger.allocatedUnits + demand.units;
  if (total > ledger.maxUnits) {
    return {
      ok: false,
      reasonCode: "EXCEEDS_CAPACITY",
      overshootUnits: total - ledger.maxUnits,
    };
  }
  return {
    ok: true,
    ledger: {
      ...ledger,
      allocatedUnits: total,
      applications: [
        ...ledger.applications,
        { demandKey: demand.demandKey, units: demand.units, demandDigest: digest },
      ],
    },
    duplicate: false,
    demandKey: demand.demandKey,
  };
}
