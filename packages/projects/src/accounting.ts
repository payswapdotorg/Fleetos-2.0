/**
 * @fleetos/projects — Budget envelope + append-only actuals ledger with
 * audit digests and deterministic breach detection.
 *
 * Wave 2 lane C (F220C) operational-truth grade.
 *
 * Laws: A1 (single source of truth — the ledger is the accounting
 * authority), A8, A19 (append-only, hash-verifiable), A20.
 *
 * Pure and deterministic. Money is INTEGER minor units. Time is an
 * explicit `number` input. Breach thresholds are integer basis points.
 */

import type { TenantScope } from "./contracts.js";
import { validateTenantScope } from "./contracts.js";

// ---------------------------------------------------------------------------
// Budget envelope.
// ---------------------------------------------------------------------------

export interface BudgetEnvelope {
  readonly projectId: string;
  readonly tenant: TenantScope;
  /** Integer limit in minor units (e.g. cents). Never a float. */
  readonly limitMinorUnits: number;
}

/** Warning threshold in basis points of the envelope limit (90%). */
export const BUDGET_WARNING_THRESHOLD_BPS = 9000;

// ---------------------------------------------------------------------------
// Append-only actuals ledger.
// ---------------------------------------------------------------------------

export type LedgerEntryKind = "actual" | "commitment" | "credit";

export interface LedgerEntry {
  readonly seq: number;
  readonly projectId: string;
  readonly kind: LedgerEntryKind;
  /** Positive for actuals/commitments, negative for credits. Never zero. */
  readonly amountMinorUnits: number;
  readonly recordedAt: number;
  readonly note: string | null;
  /**
   * Chained audit digest (law A19): digest of this entry's content linked
   * to the previous entry's digest. Byte-identical for byte-identical
   * histories.
   */
  readonly digest: string;
}

export interface ActualsLedger {
  readonly projectId: string;
  readonly tenant: TenantScope;
  readonly entries: readonly LedgerEntry[];
}

export type LedgerPostResult =
  | { readonly ok: true; readonly ledger: ActualsLedger }
  | { readonly ok: false; readonly reasonCode: LedgerReasonCode };

export type LedgerReasonCode =
  | "TENANT_SCOPE_MISSING"
  | "TENANT_MISMATCH"
  | "PROJECT_MISMATCH"
  | "NEGATIVE_LIMIT"
  | "ZERO_AMOUNT"
  | "NON_INTEGER_AMOUNT"
  | "OUT_OF_SEQUENCE";

export function emptyLedger(envelope: BudgetEnvelope): LedgerPostResult {
  const tenantCheck = validateTenantScope(envelope.tenant);
  if (!tenantCheck.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (!Number.isInteger(envelope.limitMinorUnits) || envelope.limitMinorUnits < 0) {
    return { ok: false, reasonCode: "NEGATIVE_LIMIT" };
  }
  return {
    ok: true,
    ledger: { projectId: envelope.projectId, tenant: envelope.tenant, entries: [] },
  };
}

export function computeEntryDigest(
  previousDigest: string,
  entry: {
    readonly seq: number;
    readonly projectId: string;
    readonly kind: LedgerEntryKind;
    readonly amountMinorUnits: number;
    readonly recordedAt: number;
    readonly note: string | null;
  },
): string {
  const parts = [
    previousDigest,
    String(entry.seq),
    entry.projectId,
    entry.kind,
    String(entry.amountMinorUnits),
    String(entry.recordedAt),
    entry.note ?? "",
  ];
  const joined = parts.join("\u241f");
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return `ledger_${hash.toString(16).padStart(8, "0")}`;
}

const GENESIS_DIGEST = "ledger_genesis";

/**
 * postLedgerEntry — appends one entry to the ledger. The sequence number
 * is assigned by the ledger (entries.length + 1); a caller-supplied seq
 * mismatch would be an out-of-order replay and is refused. Entries are
 * append-only: the input ledger is never mutated.
 */
export function postLedgerEntry(
  ledger: ActualsLedger,
  envelope: BudgetEnvelope,
  entry: {
    readonly kind: LedgerEntryKind;
    readonly amountMinorUnits: number;
    readonly recordedAt: number;
    readonly note?: string | null;
  },
): LedgerPostResult {
  const ledgerTenant = validateTenantScope(ledger.tenant);
  if (!ledgerTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const envelopeTenant = validateTenantScope(envelope.tenant);
  if (!envelopeTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (ledgerTenant.scope.tenantId !== envelopeTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH" };
  }
  if (ledger.projectId !== envelope.projectId) {
    return { ok: false, reasonCode: "PROJECT_MISMATCH" };
  }
  if (!Number.isInteger(entry.amountMinorUnits)) {
    return { ok: false, reasonCode: "NON_INTEGER_AMOUNT" };
  }
  if (entry.amountMinorUnits === 0) {
    return { ok: false, reasonCode: "ZERO_AMOUNT" };
  }
  const seq = ledger.entries.length + 1;
  const previousDigest =
    ledger.entries.length === 0
      ? GENESIS_DIGEST
      : (ledger.entries[ledger.entries.length - 1]?.digest ?? GENESIS_DIGEST);
  const newEntry: LedgerEntry = {
    seq,
    projectId: ledger.projectId,
    kind: entry.kind,
    amountMinorUnits: entry.amountMinorUnits,
    recordedAt: entry.recordedAt,
    note: entry.note ?? null,
    digest: computeEntryDigest(previousDigest, {
      seq,
      projectId: ledger.projectId,
      kind: entry.kind,
      amountMinorUnits: entry.amountMinorUnits,
      recordedAt: entry.recordedAt,
      note: entry.note ?? null,
    }),
  };
  return {
    ok: true,
    ledger: { ...ledger, entries: [...ledger.entries, newEntry] },
  };
}

export type LedgerChainVerification =
  | { readonly ok: true; readonly entryCount: number }
  | { readonly ok: false; readonly reasonCode: "CHAIN_BROKEN"; readonly firstBrokenSeq: number };

/**
 * verifyLedgerChain — recomputes every digest in the chain. Any tampered
 * or reordered entry breaks the chain at the earliest affected seq.
 */
export function verifyLedgerChain(ledger: ActualsLedger): LedgerChainVerification {
  let previousDigest = GENESIS_DIGEST;
  for (let i = 0; i < ledger.entries.length; i++) {
    const entry = ledger.entries[i];
    if (entry === undefined) continue;
    if (entry.seq !== i + 1) {
      return { ok: false, reasonCode: "CHAIN_BROKEN", firstBrokenSeq: i + 1 };
    }
    const expected = computeEntryDigest(previousDigest, entry);
    if (entry.digest !== expected) {
      return { ok: false, reasonCode: "CHAIN_BROKEN", firstBrokenSeq: entry.seq };
    }
    previousDigest = entry.digest;
  }
  return { ok: true, entryCount: ledger.entries.length };
}

// ---------------------------------------------------------------------------
// Budget position + breach detection with severity.
// ---------------------------------------------------------------------------

export type BudgetBreachSeverity = "none" | "warning" | "breach";

export interface BudgetPosition {
  readonly projectId: string;
  readonly tenant: TenantScope;
  readonly limitMinorUnits: number;
  readonly spentMinorUnits: number;
  readonly remainingMinorUnits: number;
  /** Integer basis points of the limit (floor). Deterministic. */
  readonly utilizationBps: number;
  readonly severity: BudgetBreachSeverity;
  readonly breachAmountMinorUnits: number;
}

export type BudgetPositionResult =
  | { readonly ok: true; readonly position: BudgetPosition }
  | { readonly ok: false; readonly reasonCode: LedgerReasonCode };

/**
 * computeBudgetPosition — deterministic accounting projection. The spent
 * total is the signed sum of all ledger entries (credits are negative).
 * Severity: "breach" when spent exceeds the limit; "warning" when
 * utilization (integer bps, floored) is at or above
 * BUDGET_WARNING_THRESHOLD_BPS; otherwise "none". Integer math only.
 */
export function computeBudgetPosition(
  ledger: ActualsLedger,
  envelope: BudgetEnvelope,
): BudgetPositionResult {
  const ledgerTenant = validateTenantScope(ledger.tenant);
  if (!ledgerTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  const envelopeTenant = validateTenantScope(envelope.tenant);
  if (!envelopeTenant.ok) return { ok: false, reasonCode: "TENANT_SCOPE_MISSING" };
  if (ledgerTenant.scope.tenantId !== envelopeTenant.scope.tenantId) {
    return { ok: false, reasonCode: "TENANT_MISMATCH" };
  }
  if (ledger.projectId !== envelope.projectId) {
    return { ok: false, reasonCode: "PROJECT_MISMATCH" };
  }
  if (!Number.isInteger(envelope.limitMinorUnits) || envelope.limitMinorUnits < 0) {
    return { ok: false, reasonCode: "NEGATIVE_LIMIT" };
  }
  let spentMinorUnits = 0;
  for (const entry of ledger.entries) {
    spentMinorUnits += entry.amountMinorUnits;
  }
  const limit = envelope.limitMinorUnits;
  const utilizationBps =
    limit === 0 ? (spentMinorUnits > 0 ? 10000 : 0) : Math.floor((spentMinorUnits * 10000) / limit);
  let severity: BudgetBreachSeverity = "none";
  if (spentMinorUnits > limit) {
    severity = "breach";
  } else if (utilizationBps >= BUDGET_WARNING_THRESHOLD_BPS) {
    severity = "warning";
  }
  const breachAmountMinorUnits = Math.max(0, spentMinorUnits - limit);
  return {
    ok: true,
    position: {
      projectId: ledger.projectId,
      tenant: ledger.tenant,
      limitMinorUnits: limit,
      spentMinorUnits,
      remainingMinorUnits: limit - spentMinorUnits,
      utilizationBps,
      severity,
      breachAmountMinorUnits,
    },
  };
}
