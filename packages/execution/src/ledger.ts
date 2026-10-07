/**
 * @fleetos/execution — Execution ledger (F220B, Wave 2).
 *
 * Append-only, hash-chained, REPLAYABLE. Every consequential queue operation
 * (submit / ack / complete / fail / retry / dead-letter) appends one entry
 * with an AUDIT DIGEST per entry. The ledger is the truth grade companion to
 * the pure command-queue state: the queue state can be REBUILT from the
 * ledger by deterministic replay (`replayExecutionLedger`).
 *
 * Laws:
 *  - A19: append-only, tenant-scoped, hash-verifiable, machine-readable.
 *  - A8: entries are tenant-scoped; a mismatched tenant REFUSES the append.
 *  - Determinism: same entries => same digests => same replayed state. No
 *    wall-clock — `at` is an explicit number input.
 */

// ---------------------------------------------------------------------------
// Entry vocabulary
// ---------------------------------------------------------------------------

export type ExecutionLedgerKind =
  | "submitted"
  | "acked"
  | "completed"
  | "failed"
  | "retried"
  | "dead-lettered";

export interface ExecutionLedgerEntry {
  /** 0-based position — monotonically increasing. */
  readonly index: number;
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly kind: ExecutionLedgerKind;
  readonly at: number;
  /** Free-form audit detail — failure reason, output digest, etc. */
  readonly detail: string;
  readonly previousDigest: string | null;
  /** Audit digest of THIS entry — hash over the canonical entry fields. */
  readonly entryDigest: string;
}

export type LedgerRefusalCode =
  | "ledger.missing-tenant"
  | "ledger.tenant-mismatch"
  | "ledger.missing-key"
  | "ledger.invalid-at"
  | "ledger.invalid-index";

export type LedgerAppendResult =
  | { readonly ok: true; readonly ledger: readonly ExecutionLedgerEntry[]; readonly entry: ExecutionLedgerEntry }
  | { readonly ok: false; readonly reason: LedgerRefusalCode };

export type LedgerVerification = {
  readonly verified: boolean;
  readonly checkedEntries: number;
  readonly brokenAt: number | null;
  readonly reason: LedgerBreakReason | null;
};

export type LedgerBreakReason =
  | "ledger.index_gap"
  | "ledger.tenant_mismatch"
  | "ledger.previous_digest_mismatch"
  | "ledger.entry_digest_mismatch"
  | "ledger.first_entry_has_previous";

// ---------------------------------------------------------------------------
// Deterministic digests (local — no cross-package imports)
// ---------------------------------------------------------------------------

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Canonical audit digest of one ledger entry — deterministic over the entry fields. */
export function executionEntryDigest(entry: {
  readonly previousDigest: string | null;
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly kind: ExecutionLedgerKind;
  readonly at: number;
  readonly detail: string;
  readonly index: number;
}): string {
  const parts = [
    entry.previousDigest ?? "",
    entry.tenantId,
    entry.idempotencyKey,
    entry.kind,
    String(entry.at),
    entry.detail,
    String(entry.index),
  ];
  return fnv1a(parts.join("|"));
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

/**
 * Append one entry to the ledger — append-only and hash-chained.
 *
 * Refuses: missing tenant, tenant mismatch against the chain (A8), missing
 * idempotency key, invalid `at`, invalid explicit index.
 *
 * The `index` is derived from the chain length by default; an explicit index
 * is accepted only when it equals the next position (replay compatibility).
 */
export function appendExecutionLedger(
  ledger: readonly ExecutionLedgerEntry[],
  input: {
    readonly tenantId: string;
    readonly idempotencyKey: string;
    readonly kind: ExecutionLedgerKind;
    readonly at: number;
    readonly detail?: string;
    readonly index?: number;
  },
): LedgerAppendResult {
  if (input.tenantId === "") return { ok: false, reason: "ledger.missing-tenant" };
  if (input.idempotencyKey === "") return { ok: false, reason: "ledger.missing-key" };
  if (!Number.isInteger(input.at) || input.at < 0) return { ok: false, reason: "ledger.invalid-at" };

  const lastIndex = ledger.length - 1;
  const last: ExecutionLedgerEntry | null = lastIndex >= 0 ? (ledger[lastIndex] ?? null) : null;
  if (last !== null && last.tenantId !== input.tenantId) {
    return { ok: false, reason: "ledger.tenant-mismatch" };
  }
  const index = input.index ?? ledger.length;
  if (!Number.isInteger(index) || index !== ledger.length) {
    return { ok: false, reason: "ledger.invalid-index" };
  }

  const entry: ExecutionLedgerEntry = {
    index,
    tenantId: input.tenantId,
    idempotencyKey: input.idempotencyKey,
    kind: input.kind,
    at: input.at,
    detail: input.detail ?? "",
    previousDigest: last === null ? null : last.entryDigest,
    entryDigest: "",
  };
  const entryDigest = executionEntryDigest({ ...entry, index });
  const sealed: ExecutionLedgerEntry = { ...entry, entryDigest };
  return { ok: true, ledger: [...ledger, sealed], entry: sealed };
}

// ---------------------------------------------------------------------------
// Verify — hash-chain integrity (law A19)
// ---------------------------------------------------------------------------

/**
 * Verify the ledger hash chain. Checks: contiguous indexes, tenant
 * consistency, previous-digest linkage, and every entry's audit digest.
 */
export function verifyExecutionLedger(ledger: readonly ExecutionLedgerEntry[]): LedgerVerification {
  if (ledger.length === 0) {
    return { verified: true, checkedEntries: 0, brokenAt: null, reason: null };
  }
  const tenantId = ledger[0]!.tenantId;
  let previousDigest: string | null = null;
  for (let i = 0; i < ledger.length; i += 1) {
    const entry = ledger[i]!;
    if (entry.index !== i) {
      return { verified: false, checkedEntries: i, brokenAt: i, reason: "ledger.index_gap" };
    }
    if (entry.tenantId !== tenantId) {
      return { verified: false, checkedEntries: i, brokenAt: i, reason: "ledger.tenant_mismatch" };
    }
    if (i === 0) {
      if (entry.previousDigest !== null) {
        return { verified: false, checkedEntries: i, brokenAt: i, reason: "ledger.first_entry_has_previous" };
      }
    } else if (entry.previousDigest !== previousDigest) {
      return { verified: false, checkedEntries: i, brokenAt: i, reason: "ledger.previous_digest_mismatch" };
    }
    const expected = executionEntryDigest(entry);
    if (expected !== entry.entryDigest) {
      return { verified: false, checkedEntries: i, brokenAt: i, reason: "ledger.entry_digest_mismatch" };
    }
    previousDigest = entry.entryDigest;
  }
  return { verified: true, checkedEntries: ledger.length, brokenAt: null, reason: null };
}

/** Tamper with an entry's detail — test helper proving tamper detection. */
export function tamperExecutionEntry(
  ledger: readonly ExecutionLedgerEntry[],
  index: number,
  detail: string,
): readonly ExecutionLedgerEntry[] {
  return ledger.map((e) => (e.index === index ? { ...e, detail } : e));
}

// ---------------------------------------------------------------------------
// Replay — the ledger rebuilds the queue view deterministically
// ---------------------------------------------------------------------------

/** The replayed per-command view: status, attempts and last event per key. */
export interface ReplayedCommand {
  readonly idempotencyKey: string;
  readonly status: "queued" | "in-flight" | "completed" | "dead-lettered";
  readonly attempts: number;
  readonly lastEventAt: number;
  readonly lastKind: ExecutionLedgerKind;
  readonly lastFailureReason: string | null;
}

export type ReplayResult =
  | { readonly ok: true; readonly commands: readonly ReplayedCommand[] }
  | { readonly ok: false; readonly reason: LedgerBreakReason | "ledger.tenant_mismatch" };

/**
 * Replay the ledger into the per-command view — deterministic.
 *
 * The replayed view sorts by idempotencyKey (stable iteration). Replaying
 * the same ledger twice MUST produce byte-identical output — this is the
 * machine-tested replayability contract.
 */
export function replayExecutionLedger(ledger: readonly ExecutionLedgerEntry[]): ReplayResult {
  const commands = new Map<string, ReplayedCommand>();
  let tenantId: string | null = null;

  for (const entry of ledger) {
    if (tenantId === null) tenantId = entry.tenantId;
    if (entry.tenantId !== tenantId) return { ok: false, reason: "ledger.tenant_mismatch" };

    const current = commands.get(entry.idempotencyKey);
    switch (entry.kind) {
      case "submitted":
        commands.set(entry.idempotencyKey, {
          idempotencyKey: entry.idempotencyKey,
          status: "queued",
          attempts: 1,
          lastEventAt: entry.at,
          lastKind: entry.kind,
          lastFailureReason: null,
        });
        break;
      case "acked":
        if (current === undefined) return { ok: false, reason: "ledger.index_gap" };
        commands.set(entry.idempotencyKey, { ...current, status: "in-flight", lastEventAt: entry.at, lastKind: entry.kind });
        break;
      case "completed":
        if (current === undefined) return { ok: false, reason: "ledger.index_gap" };
        commands.set(entry.idempotencyKey, { ...current, status: "completed", lastEventAt: entry.at, lastKind: entry.kind });
        break;
      case "failed":
      case "retried":
        if (current === undefined) return { ok: false, reason: "ledger.index_gap" };
        commands.set(entry.idempotencyKey, {
          ...current,
          status: "queued",
          attempts: current.attempts + 1,
          lastEventAt: entry.at,
          lastKind: entry.kind,
          lastFailureReason: entry.detail === "" ? current.lastFailureReason : entry.detail,
        });
        break;
      case "dead-lettered":
        if (current === undefined) return { ok: false, reason: "ledger.index_gap" };
        commands.set(entry.idempotencyKey, {
          ...current,
          status: "dead-lettered",
          lastEventAt: entry.at,
          lastKind: entry.kind,
          lastFailureReason: entry.detail === "" ? current.lastFailureReason : entry.detail,
        });
        break;
    }
  }

  const sorted = [...commands.values()].sort((a, b) =>
    a.idempotencyKey < b.idempotencyKey ? -1 : a.idempotencyKey > b.idempotencyKey ? 1 : 0,
  );
  return { ok: true, commands: sorted };
}

/**
 * Replay-determinism machine test: two replays of the same ledger MUST be
 * byte-identical (canonical JSON equality).
 */
export function verifyExecutionLedgerReplayDeterminism(ledger: readonly ExecutionLedgerEntry[]): {
  readonly deterministic: boolean;
} {
  const a = replayExecutionLedger(ledger);
  const b = replayExecutionLedger(ledger);
  return { deterministic: JSON.stringify(a) === JSON.stringify(b) };
}
